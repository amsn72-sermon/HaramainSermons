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
select public._assert((select 'التسجيل الصوتي مطلوب في هذه المرحلة ولم يُرفع بعد' = any(public.stage_blockers(:'en_track'))),
  'التسجيل الصوتي إلزامي في مرحلته (ملاحظة ١٢)');
do $$ begin
  perform public.complete_stage((select id from public.tracks where language_code = 'en'), true);
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: أُتمّت الترجمة بلا تسجيل صوتي'; end if;
  raise notice 'PASS: لا إتمام بلا التسجيل الصوتي المطلوب';
end $$;
select public.set_track_audio(:'en_track', 'en-track/audio.mp3');
do $$ begin
  perform public.complete_stage((select id from public.tracks where language_code = 'en'), false);
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: إتمام بلا تأكيد المراجعة'; end if;
  raise notice 'PASS: الإتمام يتطلب تأكيد المراجعة (ملاحظة ٨)';
end $$;
commit;

-- نحاكي تأخرًا: موعد الترجمة مضى قبل عشر دقائق، ولم يبقَ للمسار كله إلا ٣٥ دقيقة
update public.track_stages set due_at = now() - interval '10 minutes'
where track_id = :'en_track' and stage_key = 'translation';
update public.tracks set deadline_at = now() + interval '35 minutes' where id = :'en_track';

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.complete_stage(:'en_track', true);
select public._assert((select count(*) = 0 from public.tracks), 'بعد الإتمام لا يعود المترجم يرى المهمة (ملاحظة ١١)');
select public._assert((select count(*) = 0 from public.materials), 'ولا يرى بيانات المادة');
select public._assert((select score between 80 and 90 and not is_open from public.my_history() where stage_key = 'translation'),
  'سجله يحفظ الإنجاز مع تقييم ينقص بقدر التأخير');
commit;

select public._assert((select late_seconds between 590 and 700 from public.track_stages
  where track_id = :'en_track' and stage_key = 'translation'), 'تأخر الترجمة (١٠ دقائق) سُجّل');
select public._assert((select status = 'active' and planned_minutes = 10 from public.track_stages
  where track_id = :'en_track' and stage_key = 'sharia_review'),
  'تأخر الترجمة يقلّص ما بعدها: المراجعة الشرعية ٢٠/٧٠ من ٣٥ دقيقة متبقية = ١٠ (ملاحظة ٣)');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'khalid', true);
select public._assert((select count(*) = 1 from public.tracks where language_code = 'en'), 'المراجع الشرعي يرى المهمة ما دامت لديه');
select public.set_track_audio(:'en_track', 'en-track/audio-v2.mp3');
select public._assert((select audio_path = 'en-track/audio-v2.mp3' from public.tracks where language_code = 'en'), 'المراجع يستبدل التسجيل الصوتي (ملاحظة ٧)');
commit;

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

-- الوقت انتهى: المرحلة التالية تأخذ الحد الأدنى (ربع نصيبها) لا صفرًا
update public.tracks set deadline_at = now() - interval '1 minute' where id = :'en_track';
-- 9) إكمال المسار
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.complete_stage(:'en_track', true); commit;
select public._assert((select planned_minutes = 5 from public.track_stages where track_id = :'en_track' and stage_key = 'sharia_review'),
  'بعد انقضاء الموعد النهائي تأخذ المرحلة حدها الأدنى (٥ من ٢٠)');
update public.tracks set deadline_at = now() + interval '2 hours' where id = :'en_track';
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'khalid', true);
select public.complete_stage(:'en_track', true); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'sara', true);
select public.complete_stage(:'en_track', true); select public.complete_stage(:'en_track', true); commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.complete_stage((select id from public.tracks where language_code = 'en'), false);
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: قبول المنسق بلا تأكيد التحقق'; end if;
  raise notice 'PASS: قبول المنسق يتطلب تأكيد التحقق من الترجمة والتسجيل';
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
select public.complete_stage(:'en_track', true);
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
commit;
select public._assert((select count(*) > 0 from public.track_events), 'حذف سجل الإجراءات من الواجهة لا أثر له');

-- 11) تغيير المسؤول (ملاحظة ١): ترجمة الأردية من خالد إلى سارة قبل الاستلام
update public.tracks set receipt_due_at = now() - interval '1 hour' where id = :'ur_track';
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
do $$ begin
  perform public.reassign_stage((select id from public.tracks where language_code = 'ur'), 'translation', '00000000-0000-0000-0000-00000000000e');
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: مترجم غيّر الإسناد'; end if;
  raise notice 'PASS: تغيير المسؤول للإدارة فقط';
end $$;
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.reassign_stage((select id from public.tracks where language_code = 'ur'), 'translation', '00000000-0000-0000-0000-00000000000c');
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: أُسند لغير مؤهل'; end if;
  raise notice 'PASS: لا يُعاد الإسناد لغير المؤهل في اللغة';
end $$;
select public.reassign_stage(:'ur_track', 'translation', :'sara');
do $$ begin
  perform public.reassign_stage((select id from public.tracks where language_code = 'en'), 'translation', '00000000-0000-0000-0000-00000000000d');
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: غُيّر مسؤول مرحلة منجزة'; end if;
  raise notice 'PASS: لا يتغير مسؤول مرحلة أُنجزت';
end $$;
commit;
select public._assert((select s.assignee_id = :'sara' and t.receipt_due_at > now() from public.track_stages s join public.tracks t on t.id = s.track_id
  where s.track_id = :'ur_track' and s.stage_key = 'translation'), 'الإسناد انتقل لسارة ومهلة الاستلام بدأت من جديد');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'khalid', true);
select public._assert((select count(*) = 0 from public.tracks where language_code = 'ur'), 'خالد لم يعد يرى مسار الأردية بعد نقله');
commit;

-- مرحلة التسجيل مسندة للمراجع اللغوي: المترجم لا يُطالب به ولا يرفعه (ملاحظة ١٢)
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.create_material(jsonb_build_object(
  'material', jsonb_build_object('material_type','خطب','title','تسجيل عند المراجع','mosque','madinah','source_html','<p>نص</p>','deliverable','text_audio'),
  'stage_minutes', '{"translation":60,"sharia_review":20,"linguistic_review":20,"editing":20,"coordinator_receipt":10}'::jsonb,
  'languages', jsonb_build_array(jsonb_build_object('code','en','audio_stage','linguistic_review','stages', jsonb_build_array(
    jsonb_build_object('key','translation','assignee','00000000-0000-0000-0000-00000000000c'),
    jsonb_build_object('key','linguistic_review','assignee','00000000-0000-0000-0000-00000000000e'),
    jsonb_build_object('key','coordinator_receipt','assignee','00000000-0000-0000-0000-00000000000b'))))
)) as m2 \gset
commit;
select id as t2 from public.tracks where material_id = :'m2' \gset
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.accept_track(:'t2');
select public.save_translation(:'t2', '<p>text</p>');
select public._assert((select coalesce(array_length(public.stage_blockers(:'t2'), 1), 0) = 0), 'المترجم يُتم بلا تسجيل حين يكون التسجيل على المراجع');
do $$ begin
  perform public.set_track_audio((select t.id from public.tracks t join public.materials m on m.id = t.material_id where m.title = 'تسجيل عند المراجع'), 'x.mp3');
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: المترجم رفع تسجيلًا مسندًا للمراجع'; end if;
  raise notice 'PASS: المترجم لا يرفع تسجيلًا مسندًا لمرحلة لاحقة';
end $$;
select public.complete_stage(:'t2', true);
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'sara', true);
select public._assert((select 'التسجيل الصوتي مطلوب في هذه المرحلة ولم يُرفع بعد' = any(public.stage_blockers(:'t2'))), 'المراجع اللغوي مطالب بالتسجيل');
commit;
-- إلغاء لغة من مادة (ملاحظة ١): المادة تُحذف حين لا تبقى لها لغات
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.cancel_track(:'t2');
commit;
select public._assert((select count(*) = 0 from public.materials where id = :'m2'), 'إلغاء آخر لغة يحذف المادة');

-- 12) لا يُعطَّل عضو لديه إسناد قائم (مسار الأردية لم يُستلم)
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
do $$ begin
  perform public.admin_update_member('00000000-0000-0000-0000-00000000000e', 'disabled', null, null);
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: عُطّل عضو لديه إسناد'; end if;
  raise notice 'PASS: لا يُعطَّل عضو لديه إسناد قائم';
end $$;
commit;

-- 12ب) نسخ التسجيل الصوتي: تُحفظ كلها، والمدير يعتمد ما يشاء (ملاحظة ١٦)
select public._assert((select count(*) >= 2 from public.track_audios where track_id = :'en_track'),
  'حُفظت نسختا التسجيل (المترجم والمراجع) ولم تُستبدل');
select public._assert((select count(distinct uploaded_by) = 2 from public.track_audios where track_id = :'en_track'),
  'كل نسخة محفوظة باسم من رفعها');

-- غير المدير لا يعتمد
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ declare v_id uuid; begin
  select id into v_id from public.track_audios limit 1;
  perform public.approve_track_audios((select track_id from public.track_audios where id = v_id), array[v_id]);
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: اعتمد المنسق التسجيل'; end if;
  raise notice 'PASS: اعتماد التسجيل لمدير المشروع فقط';
end $$;
commit;

-- المدير يعتمد النسخة الأولى، فتصبح هي المعتمدة في المسار
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.approve_track_audios(:'en_track',
  array(select id from public.track_audios where track_id = :'en_track' order by created_at limit 1));
commit;
select public._assert((select count(*) = 1 from public.track_audios where track_id = :'en_track' and is_approved),
  'اعتماد نسخة واحدة يلغي اعتماد ما سواها');
select public._assert((select t.audio_path = a.path from public.tracks t
   join public.track_audios a on a.track_id = t.id and a.is_approved where t.id = :'en_track'),
  'مسار المادة يشير إلى التسجيل المعتمد');

-- ويمكن اعتماد نسختين معًا
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.approve_track_audios(:'en_track', array(select id from public.track_audios where track_id = :'en_track'));
commit;
select public._assert((select count(*) = 2 from public.track_audios where track_id = :'en_track' and is_approved),
  'يمكن اعتماد تسجيلين معًا');

-- 14) إعادة تنشيط الخطبة للتعديل على أصلها (ملاحظة ٢٨)
-- المترجم لا يعيد التنشيط
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
do $$ begin
  perform public.reopen_material((select material_id from public.tracks where language_code = 'en'),
    'note', 'أضف فقرة عن الأمانة', null, 'translation', false, null);
  raise exception 'NO_ERROR';
exception when others then
  if sqlerrm = 'NO_ERROR' then raise exception 'FAIL: أعاد المترجم تنشيط الخطبة'; end if;
  raise notice 'PASS: إعادة التنشيط للمنسق ومدير المشروع فقط';
end $$;
commit;

-- المنسق يعيد التنشيط بالتظليل على الأصل، ويطلب إعادة التسجيل الصوتي
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.reopen_material(:'material_id', 'annotate', 'تعديل من الشيخ على أصل الخطبة',
  array[:'en_track']::uuid[], 'translation', true, null) as rev \gset
commit;

select public._assert((select not is_published and status = 'in_progress' from public.tracks where id = :'en_track'),
  'إعادة التنشيط تُلغي النشر وتعيد المسار إلى العمل');
select public._assert((select s.stage_key = 'translation' from public.track_stages s
   join public.tracks t on t.current_stage_id = s.id where t.id = :'en_track'),
  'المسار عاد إلى المرحلة التي اختارها المنسق');
select public._assert((select count(*) = 1 from public.material_revisions
   where material_id = :'material_id' and closed_at is null and mode = 'annotate' and redo_audio),
  'فُتحت جولة تعديل واحدة على الأصل مع طلب إعادة التسجيل');
select public._assert((select count(*) = 1 from public.track_events
   where track_id = :'en_track' and action = 'reopened'),
  'إعادة التنشيط مسجّلة في سجل الإجراءات');

-- المنسق يحدد موضع التعديل ونوعه على صفحة الأصل
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.add_revision_mark(:'rev', 1, 0.12, 0.30, 0.70, 0.06, 'delete', 'تُحذف هذه الجملة');
select public.add_revision_mark(:'rev', 2, 0.10, 0.55, 0.75, 0.05, 'rephrase', 'تُعاد صياغتها');
commit;
select public._assert((select count(*) = 2 from public.revision_marks where revision_id = :'rev'),
  'التحديدات تُحفظ بصفحاتها وأنواعها');

-- المترجم المسند يرى التعديلات المطلوبة على الأصل
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert((select count(*) = 2 from public.revision_marks where revision_id = :'rev'),
  'المترجم المسند يرى مواضع التعديل على الأصل');
commit;

-- والتسجيل الصوتي القديم لا يكفي بعد طلب إعادته
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert(
  (select 'التعديل يستوجب تسجيلًا صوتيًا جديدًا' = any(public.stage_blockers(:'en_track', true))),
  'التسجيل السابق لا يكفي بعد طلب إعادة التسجيل');
commit;

-- إرفاق نسخة جديدة من أصل الخطبة: النسخة السابقة محفوظة
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.add_source_version(:'material_id', 'sources/khutbah-v2.pdf', 'نسخة الشيخ المعدّلة') as src \gset
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.add_source_version(:'material_id', 'sources/khutbah-v3.pdf', 'تعديل ثانٍ من الشيخ');
commit;
select public._assert((select count(*) = 2 from public.material_sources where material_id = :'material_id'),
  'كل نسخة من الأصل تُحفظ برقمها والسابقة لا تُمحى');
select public._assert((select path = 'sources/khutbah-v2.pdf' from public.material_sources
   where material_id = :'material_id' order by version limit 1),
  'النسخة الأقدم من الأصل تبقى كما هي');
select public._assert((select source_pdf_path = 'sources/khutbah-v3.pdf' from public.materials where id = :'material_id'),
  'الخطبة صارت تشير إلى أحدث نسخة من الأصل');

-- 13) السجل الكامل
\echo '--- سجل الإجراءات ---'
select to_char(e.created_at, 'HH24:MI:SS') || ' · ' || p.full_name || ' · ' || e.action
       || coalesce(' · ' || e.stage_key, '') || coalesce(' → ' || e.target_stage_key, '') || coalesce(' · ' || e.note, '')
from public.track_events e join public.profiles p on p.id = e.actor_id
where e.track_id = :'en_track' order by e.id;
\echo '--- مراحل الإنجليزية ---'
select stage_key || ' · ' || status || ' · rounds=' || rounds || ' · late=' || coalesce(late_seconds::text, '-')
from public.track_stages where track_id = :'en_track' order by sort;
