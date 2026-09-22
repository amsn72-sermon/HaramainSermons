-- اختبار دورة العمل والصلاحيات كاملة على قاعدة محلية
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

\set mgr    '00000000-0000-0000-0000-00000000000a'
\set coord  '00000000-0000-0000-0000-00000000000b'
\set yusuf  '00000000-0000-0000-0000-00000000000c'
\set khalid '00000000-0000-0000-0000-00000000000d'
\set sara   '00000000-0000-0000-0000-00000000000e'
\set pend   '00000000-0000-0000-0000-00000000000f'

-- دالة تحقق: تفشل بصوت عالٍ إن لم يتحقق الشرط
create or replace function public._assert(ok boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAIL: %', msg; end if; raise notice 'PASS: %', msg; end $$;
grant execute on function public._assert(boolean, text) to anon, authenticated;

-- 1) التسجيل عبر auth.users ← يُنشئ الملف الشخصي تلقائيًا بحالة «بانتظار التفعيل»
insert into auth.users (id, email, raw_user_meta_data) values
  (:'mgr',    'mgr@example.com',    '{"full_name":"مدير المشروع"}'),
  (:'coord',  'coord@example.com',  '{"full_name":"أحمد المنسق"}'),
  (:'yusuf',  'yusuf@example.com',  '{"full_name":"يوسف أحمد","languages":["en"],"national_id":"1012345678"}'),
  (:'khalid', 'khalid@example.com', '{"full_name":"د. خالد","languages":["en","ur"]}'),
  (:'sara',   'sara@example.com',   '{"full_name":"سارة","languages":["en","ur"]}'),
  (:'pend',   'pend@example.com',   '{"full_name":"طلب جديد","languages":["fr"]}');

select public._assert((select count(*) = 6 from public.profiles where status = 'pending'), 'التسجيل ينشئ ستة ملفات بانتظار التفعيل');
select public._assert((select count(*) = 2 from public.member_languages where member_id = :'khalid'), 'لغات المسجّل تُحفظ من بيانات التسجيل');

do $$ begin
  insert into auth.users (email, raw_user_meta_data) values ('bad@example.com', '{"full_name":"رقم خاطئ","national_id":"abc"}');
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: رقم هوية غير صالح قُبل'; end if;
  raise notice 'PASS: رقم الهوية «abc» مرفوض';
end $$;

-- تفعيل أول مدير (الخطوة اليدوية الوحيدة بعد التثبيت)
update public.profiles set role = 'manager', status = 'active' where id = :'mgr';

-- 2) المدير يفعّل المنسق
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.admin_update_member(:'coord', 'active', 'coordinator', null);
commit;

-- 3) المنسق يفعّل المترجمين، ولا يستطيع ترقية أحد
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.admin_update_member(:'yusuf',  'active', null, array['en']);
select public.admin_update_member(:'khalid', 'active', null, null);
select public.admin_update_member(:'sara',   'active', null, null);
do $$ begin
  perform public.admin_update_member('00000000-0000-0000-0000-00000000000c', null, 'manager', null);
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: المنسق رقّى مترجمًا إلى مدير'; end if;
  raise notice 'PASS: المنسق لا يرقّي إلى دور إداري';
end $$;
select public._assert((select count(*) = 6 from public.profiles), 'المنسق يرى طلبات التسجيل المعلّقة');
commit;

-- المترجم لا يرى الطلبات المعلّقة
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert((select count(*) = 5 from public.profiles), 'المترجم يرى الأعضاء المفعّلين فقط');
select public._assert((select count(*) = 1 from public.profile_private), 'المترجم يرى بياناته الحساسة وحده');
commit;

-- 4) إنشاء مادة: الإنجليزية بالمسار الكامل، والأردية «مترجم ثم المنسق»
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);

do $$ begin
  perform public.create_material(jsonb_build_object(
    'material', jsonb_build_object('material_type','خطب','title','اختبار','mosque','makkah','source_html','<p>نص</p>','deliverable','text'),
    'stage_minutes', '{"translation":60,"sharia_review":20,"linguistic_review":20,"editing":20,"coordinator_receipt":10}'::jsonb,
    'languages', jsonb_build_array(jsonb_build_object('code','ur','stages', jsonb_build_array(
      jsonb_build_object('key','translation','assignee','00000000-0000-0000-0000-00000000000c'),
      jsonb_build_object('key','coordinator_receipt','assignee','00000000-0000-0000-0000-00000000000b'))))
  ));
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: أُسند مترجم غير مؤهل'; end if;
  raise notice 'PASS: رُفض إسناد مترجم غير مؤهل في اللغة (%)', sqlerrm;
end $$;

do $$ begin
  perform public.create_material(jsonb_build_object(
    'material', jsonb_build_object('material_type','خطب','title','اختبار','mosque','makkah','source_html','<p>نص</p>'),
    'stage_minutes', '{"translation":60,"coordinator_receipt":10}'::jsonb,
    'languages', jsonb_build_array(jsonb_build_object('code','en','stages', jsonb_build_array(
      jsonb_build_object('key','translation','assignee','00000000-0000-0000-0000-00000000000c'))))
  ));
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: قُبل مسار بلا استلام المنسق'; end if;
  raise notice 'PASS: المرحلة الأساسية لا تُتجاوز (%)', sqlerrm;
end $$;

select public.create_material(jsonb_build_object(
  'material', jsonb_build_object('material_type','خطب','sermon_type','خطبة جمعة','title','فضل الإحسان',
    'mosque','makkah','khateeb_id','1','sermon_date','2026-09-18','source_html','<p>نص الخطبة</p>','deliverable','text_audio'),
  'stage_minutes', '{"translation":60,"sharia_review":20,"linguistic_review":20,"editing":20,"coordinator_receipt":10}'::jsonb,
  'languages', jsonb_build_array(
    jsonb_build_object('code','en','stages', jsonb_build_array(
      jsonb_build_object('key','translation','assignee','00000000-0000-0000-0000-00000000000c'),
      jsonb_build_object('key','sharia_review','assignee','00000000-0000-0000-0000-00000000000d'),
      jsonb_build_object('key','linguistic_review','assignee','00000000-0000-0000-0000-00000000000e'),
      jsonb_build_object('key','editing','assignee','00000000-0000-0000-0000-00000000000e'),
      jsonb_build_object('key','coordinator_receipt','assignee','00000000-0000-0000-0000-00000000000b'),
      jsonb_build_object('key','manager_approval','assignee','00000000-0000-0000-0000-00000000000a'))),
    jsonb_build_object('code','ur','stages', jsonb_build_array(
      jsonb_build_object('key','translation','assignee','00000000-0000-0000-0000-00000000000d'),
      jsonb_build_object('key','coordinator_receipt','assignee','00000000-0000-0000-0000-00000000000b'))))
)) as material_id \gset
commit;

select id as en_track from public.tracks where language_code = 'en' \gset
select id as ur_track from public.tracks where language_code = 'ur' \gset

select public._assert(
  (select planned_minutes = 111 from public.track_stages where track_id = :'ur_track' and stage_key = 'translation')
  and (select planned_minutes = 19 from public.track_stages where track_id = :'ur_track' and stage_key = 'coordinator_receipt'),
  'المسار المختصر يأخذ وقت المراحل المتجاوزة (١١١ + ١٩ = ١٣٠ دقيقة)');
select public._assert(
  (select sum(planned_minutes) = 130 from public.track_stages where track_id = :'en_track'),
  'المسار الكامل يساوي مدة القالب ١٣٠ دقيقة');

-- 5) الرؤية: يوسف يرى مساره فقط، والطلب المعلّق لا يرى شيئًا، والزائر لا يرى شيئًا
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert((select count(*) = 1 from public.tracks), 'يوسف يرى مسار الإنجليزية وحده');
select public._assert((select count(*) = 1 from public.materials), 'يوسف يرى المادة المسندة إليه');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'pend', true);
select public._assert((select count(*) = 0 from public.tracks), 'العضو غير المفعّل لا يرى أي مسار');
commit;
begin; set local role anon;
select public._assert((select count(*) = 0 from public.tracks), 'الزائر لا يرى المسارات');
select public._assert((select count(*) = 0 from public.public_translations()), 'لا شيء منشور قبل الاعتماد');
select public._assert((select count(*) = 50 from public.languages), 'الزائر يقرأ قائمة اللغات الموحّدة (٥٠)');
commit;

-- 6) الاستلام: العدّاد لا يبدأ قبله، ولا يستلم إلا مسؤول المرحلة الأولى
select public._assert((select due_at is null from public.track_stages where track_id = :'en_track' and stage_key = 'translation'),
  'لا موعد للترجمة قبل الاستلام');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'khalid', true);
do $$ begin
  perform public.accept_track((select id from public.tracks where language_code = 'en'));
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: غير المسؤول استلم المهمة'; end if;
  raise notice 'PASS: الاستلام لمسؤول المرحلة الأولى فقط';
end $$;
commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.accept_track(:'en_track');
select public._assert((select due_at > now() + interval '59 minutes' from public.track_stages
  where track_id = :'en_track' and stage_key = 'translation'), 'موعد الترجمة = لحظة الاستلام + ٦٠ دقيقة');

-- 7) التحقق قبل التأكيد: الواجهة تسأل أولًا، فلا تظهر نافذة تأكيد لطلب سيُرفض
select public._assert((select 'أدخل الترجمة كاملة قبل التسليم' = any(public.stage_blockers(:'en_track'))),
  'stage_blockers يكشف الترجمة الفارغة قبل نافذة التأكيد');
select public.save_translation(:'en_track', '<p>&nbsp;</p>');
do $$ begin
  perform public.complete_stage((select id from public.tracks where language_code = 'en'));
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: سُلّمت ترجمة فارغة'; end if;
  raise notice 'PASS: ترجمة من مسافات ووسوم فقط مرفوضة';
end $$;
select public.save_translation(:'en_track', '<p>Excellence (Ihsan) is the highest level of faith.</p>');
select public.set_track_audio(:'en_track', 'en-track/audio.mp3');
commit;

-- نحاكي تأخرًا: الموعد مضى قبل عشر دقائق
update public.track_stages set due_at = now() - interval '10 minutes'
where track_id = :'en_track' and stage_key = 'translation';

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.complete_stage(:'en_track');
commit;

select public._assert((select late_seconds between 590 and 700 from public.track_stages
  where track_id = :'en_track' and stage_key = 'translation'), 'تأخر الترجمة (١٠ دقائق) سُجّل');
select public._assert((select status = 'active' and due_at > now() + interval '19 minutes' from public.track_stages
  where track_id = :'en_track' and stage_key = 'sharia_review'),
  'المراجعة الشرعية تبدأ الآن بمدتها كاملة — تأخر السابق لا يأكل وقتها');

-- 8) الإعادة: السبب إلزامي، والتأخير المسجل لا يُمحى
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'khalid', true);
do $$ begin
  perform public.return_stage((select id from public.tracks where language_code = 'en'), 'translation', '  ');
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: إعادة بلا سبب'; end if;
  raise notice 'PASS: الإعادة بلا سبب مرفوضة';
end $$;
select public.return_stage(:'en_track', 'translation', 'يرجى مراجعة المصطلحات الشرعية');
commit;
select public._assert((select status = 'active' and rounds = 2 and late_seconds between 590 and 700
  from public.track_stages where track_id = :'en_track' and stage_key = 'translation'),
  'الترجمة عادت نشطة (الجولة ٢) مع بقاء سجل التأخير');

-- 9) إكمال المسار
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.complete_stage(:'en_track'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'khalid', true);
select public.complete_stage(:'en_track'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'sara', true);
select public.complete_stage(:'en_track'); select public.complete_stage(:'en_track'); commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.complete_stage((select id from public.tracks where language_code = 'en'), false);
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: قبول المنسق بلا تأكيد التحقق'; end if;
  raise notice 'PASS: قبول المنسق يتطلب تأكيد التحقق';
end $$;
select public.complete_stage(:'en_track', true);
commit;
select public._assert((select status = 'awaiting_approval' from public.tracks where id = :'en_track'),
  'المسار بانتظار اعتماد المدير');

-- المنسق لا يعتمد مكان المدير
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.complete_stage((select id from public.tracks where language_code = 'en'));
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: المنسق اعتمد بدل المدير'; end if;
  raise notice 'PASS: المنسق لا يعتمد مرحلة المدير';
end $$;
commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.complete_stage(:'en_track');
commit;

-- 10) النشر والموقع العام
begin; set local role anon;
select public._assert((select count(*) = 1 from public.public_translations()), 'الاعتماد النهائي ينشر الترجمة على الموقع العام');
select public._assert((select language_name = 'الإنجليزية' and khateeb like '%بن حميد' from public.public_translations()),
  'الموقع العام يعرض اسم اللغة والخطيب');
commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
do $$ begin
  perform public.set_published((select id from public.tracks where language_code = 'en'), false);
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: مترجم أخفى منشورًا'; end if;
  raise notice 'PASS: إخفاء المنشور بيد المدير فقط';
end $$;
-- السجل غير قابل للتلاعب
delete from public.track_events;
select public._assert((select count(*) > 0 from public.track_events), 'حذف سجل الإجراءات من الواجهة لا أثر له');
commit;

-- 11) لا يُعطَّل عضو لديه إسناد قائم (مسار الأردية لم يُستلم)
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
do $$ begin
  perform public.admin_update_member('00000000-0000-0000-0000-00000000000d', 'disabled', null, null);
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: عُطّل عضو لديه إسناد'; end if;
  raise notice 'PASS: لا يُعطَّل عضو لديه إسناد قائم';
end $$;
commit;

-- 12) السجل الكامل
\echo '--- سجل الإجراءات ---'
select to_char(e.created_at, 'HH24:MI:SS') || ' · ' || p.full_name || ' · ' || e.action
       || coalesce(' · ' || e.stage_key, '') || coalesce(' → ' || e.target_stage_key, '') || coalesce(' · ' || e.note, '')
from public.track_events e join public.profiles p on p.id = e.actor_id
where e.track_id = :'en_track' order by e.id;
\echo '--- مراحل الإنجليزية ---'
select stage_key || ' · ' || status || ' · rounds=' || rounds || ' · late=' || coalesce(late_seconds::text, '-')
from public.track_stages where track_id = :'en_track' order by sort;
