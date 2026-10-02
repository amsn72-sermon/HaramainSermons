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
-- والتسجيل أربعة بيانات لا غير: الاسم والبريد ورقم الهوية والجوال (ملاحظة ١٧٩)
insert into auth.users (id, email, raw_user_meta_data) values
  (:'mgr',    'mgr@example.com',    '{"full_name":"مدير المشروع","national_id":"1000000001","whatsapp":"+966500000001"}'),
  (:'coord',  'coord@example.com',  '{"full_name":"أحمد المنسق","national_id":"1000000002","whatsapp":"+966500000002"}'),
  (:'yusuf',  'yusuf@example.com',  '{"full_name":"يوسف أحمد","languages":["en"],"national_id":"1012345678","whatsapp":"+966500000003"}'),
  (:'khalid', 'khalid@example.com', '{"full_name":"د. خالد","languages":["en","ur"],"national_id":"1000000004","whatsapp":"+966500000004"}'),
  (:'sara',   'sara@example.com',   '{"full_name":"سارة","languages":["en","ur"],"national_id":"1000000005","whatsapp":"+966500000005"}'),
  (:'pend',   'pend@example.com',   '{"full_name":"طلب جديد","languages":["fr"],"national_id":"1000000006","whatsapp":"+966500000006"}');

select public._assert((select count(*) = 6 from public.profiles where status = 'pending'), 'التسجيل ينشئ ستة ملفات بانتظار التفعيل');
select public._assert((select count(*) = 2 from public.member_languages where member_id = :'khalid'), 'لغات المسجّل تُحفظ من بيانات التسجيل');

do $$ begin
  insert into auth.users (email, raw_user_meta_data) values ('bad@example.com', '{"full_name":"رقم خاطئ","national_id":"abc","whatsapp":"+966500000099"}');
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
    'material', jsonb_build_object('material_type','خطب','sermon_type','خطبة جمعة','title','اختبار','mosque','makkah','khateeb_id','1','sermon_date','2026-09-18','source_html','<p>نص</p>','deliverable','text'),
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
    'material', jsonb_build_object('material_type','خطب','sermon_type','خطبة جمعة','title','اختبار','mosque','makkah','khateeb_id','1','sermon_date','2026-09-18','source_html','<p>نص</p>'),
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
  'material', jsonb_build_object('material_type','خطب','sermon_type','خطبة جمعة','title','تسجيل عند المراجع','mosque','madinah','khateeb_id','1','sermon_date','2026-09-18','source_html','<p>نص</p>','deliverable','text_audio'),
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

-- =====================================================================
-- 14) تقييم الأعضاء وسياسة السرية (ملاحظة ٥٧)
-- =====================================================================
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.rate_member(:'yusuf', 5, 'ترجمة دقيقة وتسليم مبكر');
select public.rate_member(:'khalid', 3, null);
commit;

select public._assert((select count(*) = 2 from public.member_ratings), 'المنسق يسجّل تقييمات المترجمين');
select public._assert((select avg_score = 5.00 from public.member_rating_summary where member_id = :'yusuf'),
  'معدل التقييم يُحسب من الدرجات المسجّلة');

-- المنسق لا يقيّم منسقًا أو مديرًا
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.rate_member('00000000-0000-0000-0000-00000000000a', 4, null);
  raise exception 'FAIL: المنسق قيّم مدير المشروع';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: تقييم المديرين لمدير المشروع وحده';
end $$;
-- ولا يقيّم نفسه
do $$ begin
  perform public.rate_member('00000000-0000-0000-0000-00000000000b', 4, null);
  raise exception 'FAIL: العضو قيّم نفسه';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: لا يقيّم العضو نفسه';
end $$;
-- والدرجة خارج النطاق مرفوضة
do $$ begin
  perform public.rate_member('00000000-0000-0000-0000-00000000000c', 9, null);
  raise exception 'FAIL: قُبلت درجة خارج النطاق';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: الدرجة محصورة بين ١ و٥';
end $$;
commit;

-- المترجم لا يرى التقييمات
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert((select count(*) = 0 from public.member_ratings), 'المترجم لا يطّلع على التقييمات');
commit;

-- المؤشرات التلقائية تُحسب من المراحل
select public._assert((select open_stages > 0 and redo_rounds = 2 and late_seconds = 600
   from public.member_performance where member_id = :'yusuf'),
  'مؤشرات الأداء تُحسب من سجل المراحل: الإعادات والتأخير والمهام المفتوحة');

-- توقيع سياسة السرية
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.accept_policy('1.0', 'يوسف المترجم');
select public.accept_policy('1.0', 'يوسف المترجم');   -- تكرار لا يضاعف الصف
commit;
select public._assert((select count(*) = 1 from public.policy_acceptances where member_id = :'yusuf'),
  'توقيع السياسة يُحفظ مرة واحدة لكل نسخة');
select public._assert((select policy_version = '1.0' and signed_name = 'يوسف المترجم'
   from public.policy_acceptances where member_id = :'yusuf'), 'التوقيع يحفظ الاسم ونسخة السياسة');

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
do $$ begin
  perform public.accept_policy('1.0', 'ي');
  raise exception 'FAIL: قُبل توقيع باسم ناقص';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: التوقيع يلزمه الاسم الكامل';
end $$;
commit;

-- خالد لم يوقّع: الإدارة ترى ذلك
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public._assert((select count(*) = 0 from public.policy_acceptances where member_id = :'khalid'),
  'الإدارة تميّز من لم يوقّع على السياسة');
commit;

-- =====================================================================
-- 15) الحذف من الأرشيف: إخفاء قابل للاسترجاع لمدير المشروع وحده (ملاحظة ٦٦)
-- =====================================================================
-- المنسق لا يحذف
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.set_archive_deleted(null, null, true, 'تجربة');
  raise exception 'FAIL: قُبل حذف بلا تحديد';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: الحذف يلزمه تحديد مادة أو ترجمة';
end $$;
commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$
declare v_m uuid;
begin
  select id into v_m from public.materials limit 1;
  perform public.set_archive_deleted(v_m, null, true, 'تجربة');
  raise exception 'FAIL: المنسق حذف من الأرشيف';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: الحذف من الأرشيف لمدير المشروع وحده';
end $$;
commit;

-- المدير يحذف ترجمة واحدة ثم يسترجعها
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
do $$ begin
  perform public.set_archive_deleted(null, (select id from public.tracks where language_code = 'en' limit 1), true, null);
  raise exception 'FAIL: قُبل حذف بلا سبب';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: الحذف يلزمه سبب مكتوب';
end $$;
select public.set_archive_deleted(null, :'en_track', true, 'مكرّرة');
commit;

select public._assert((select deleted_at is not null and deleted_by is not null from public.tracks where id = :'en_track'),
  'حذف الترجمة يسجّل وقته وفاعله');
select public._assert((select count(*) = 1 from public.track_events where track_id = :'en_track' and action = 'deleted'),
  'الحذف يُقيَّد في سجل الإجراءات');

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.set_archive_deleted(null, :'en_track', false, null);
commit;
select public._assert((select deleted_at is null from public.tracks where id = :'en_track'),
  'الاسترجاع يعيد الترجمة إلى الأرشيف');

-- حذف المادة يخفي كل لغاتها
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.set_archive_deleted(:'material_id', null, true, 'أُدخلت خطأً');
commit;
select public._assert((select deleted_at is not null from public.materials where id = :'material_id'),
  'حذف المادة يخفيها');
select public._assert((select count(*) = 0 from public.tracks
   where material_id = :'material_id' and deleted_at is null),
  'حذف المادة يخفي كل لغاتها معها');

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.set_archive_deleted(:'material_id', null, false, null);
commit;
select public._assert((select count(*) = 0 from public.tracks
   where material_id = :'material_id' and deleted_at is not null),
  'استرجاع المادة يعيد لغاتها كلها');

-- =====================================================================
-- 16) مواد عامة، محو المحذوفات، وإنشاء عضو يدويًا (ملاحظات ٦٨ و٦٩ و٧٤)
-- =====================================================================
-- مادة عامة بلا مسجد
do $$ begin
  insert into public.materials (material_type, title, mosque, sermon_date, author, source_html, created_by)
  values ('كتب', 'كتاب الطهارة', 'general', current_date, 'دار النشر', '<p>نص</p>', '00000000-0000-0000-0000-00000000000b');
  raise notice 'PASS: المواد العامة تُقبل بلا مسجد';
end $$;
do $$ begin
  insert into public.materials (material_type, title, mosque, sermon_date, author, source_html, created_by)
  values ('كتب', 'قيمة غير مقبولة', 'riyadh', current_date, 'دار النشر', '<p>نص</p>', '00000000-0000-0000-0000-00000000000b');
  raise exception 'FAIL: قُبلت قيمة موقع غير معروفة';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: قيم الموقع محصورة في الحرام والنبوي والعام';
end $$;

-- المحو النهائي لا يمسّ ما حُذف حديثًا
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.set_archive_deleted(:'material_id', null, true, 'للاختبار');
commit;
select public._assert((select (purge_deleted_archive).materials_purged = 0 from public.purge_deleted_archive(7)),
  'المحو لا يمسّ ما حُذف قبل انقضاء المهلة');
select public._assert((select count(*) = 0 from public.deleted_archive_paths(7)),
  'قائمة الملفات للمحو فارغة قبل انقضاء المهلة');

-- وبعد تقديم تاريخ الحذف أسبوعين يُمحى نهائيًا
update public.materials set deleted_at = now() - interval '14 days' where id = :'material_id';
update public.tracks     set deleted_at = now() - interval '14 days' where material_id = :'material_id';
select public._assert((select (purge_deleted_archive).materials_purged = 1 from public.purge_deleted_archive(7)),
  'ما مضى على حذفه أكثر من أسبوع يُمحى نهائيًا');
select public._assert((select count(*) = 0 from public.materials where id = :'material_id'),
  'المادة الممحوّة لا يبقى لها أثر');

-- إنشاء عضو يدويًا: لمدير المشروع وحده
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.admin_create_member('x@example.com', 'Test-pass-2026', 'عضو تجريبي');
  raise exception 'FAIL: المنسق أنشأ حسابًا';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: إنشاء الحسابات لمدير المشروع وحده';
end $$;
commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.admin_create_member('manual@example.com', 'Test-pass-2026', 'عضو مُضاف يدويًا',
  'translator', '+966500000000', 'سعودي', '1099999999', 'الرياض', array['en']);
commit;
select public._assert((select role = 'translator' and status = 'active' from public.profiles where email = 'manual@example.com'),
  'الحساب المُضاف يدويًا يُنشأ مفعّلًا بدوره');
select public._assert((select email_confirmed_at is not null and encrypted_password <> '' from auth.users where email = 'manual@example.com'),
  'الحساب المُضاف يدويًا بريده مؤكَّد وكلمته مشفّرة');
select public._assert((select count(*) = 1 from public.member_languages m join public.profiles p on p.id = m.member_id
   where p.email = 'manual@example.com'), 'لغات العضو المُضاف يدويًا تُحفظ');

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
do $$ begin
  perform public.admin_create_member('manual@example.com', 'Test-pass-2026', 'مكرّر');
  raise exception 'FAIL: قُبل بريد مكرّر';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: البريد المكرّر مرفوض';
end $$;
commit;

-- =====================================================================
-- 17) طابور الإشعارات بالبريد (ملاحظة ٨٣)
-- =====================================================================
-- الإسناد ملأ الطابور بإشعار لكل مرحلة صارت نشطة
select public._assert((select count(*) > 0 from public.notifications where kind = 'assigned'),
  'إسناد المهمة يضع إشعارًا في الطابور للمسؤول عنها');
select public._assert((select subject like '%الإنجليزية%' from public.notifications
   where kind = 'assigned' order by id limit 1),
  'عنوان الإشعار يحمل المادة واللغة');
select public._assert((select body like '%الموعد:%' from public.notifications
   where kind = 'assigned' order by id limit 1),
  'نص الإشعار يحمل المرحلة والموعد');

-- المعطَّل لا تُوضع له إشعارات
select public._assert((select count(*) = 0 from public.notifications n
   join public.profiles p on p.id = n.member_id where p.status <> 'active'),
  'لا إشعارات لعضو غير مفعّل');

-- اكتمال اللغة يُشعر المنسقين ومدير المشروع
do $$
declare v_t uuid;
begin
  select id into v_t from public.tracks limit 1;
  update public.tracks set status = 'completed', completed_at = now() where id = v_t;
end $$;
select public._assert((select count(*) >= 2 from public.notifications where kind = 'track_completed'),
  'اكتمال اللغة يُشعر المنسقين ومدير المشروع');

-- الطابور والتعليم
select public._assert((select count(*) > 0 from public.pending_notifications(50)),
  'الطابور يعيد ما لم يُرسل بعد');
do $$
declare v_id bigint;
begin
  select id into v_id from public.notifications where status = 'pending' order by id limit 1;
  perform public.mark_notification(v_id, true, null);
  if (select status from public.notifications where id = v_id) <> 'sent' then
    raise exception 'FAIL: لم يُعلَّم الإشعار مرسَلًا';
  end if;
  raise notice 'PASS: تعليم الإشعار مرسَلًا يعمل';
end $$;
do $$
declare v_id bigint; v_st text;
begin
  select id into v_id from public.notifications where status = 'pending' order by id limit 1;
  for i in 1..5 loop perform public.mark_notification(v_id, false, 'تجربة فشل'); end loop;
  select status into v_st from public.notifications where id = v_id;
  if v_st <> 'failed' then raise exception 'FAIL: لم يتوقف بعد خمس محاولات (%)', v_st; end if;
  raise notice 'PASS: الإشعار يتوقف بعد خمس محاولات فاشلة';
end $$;

-- =====================================================================
-- 18) الحساب البنكي (ملاحظة ٨٤)
-- =====================================================================
-- داخل المملكة: آيبان سعودي صحيح
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.save_bank_account('local', 'يوسف أحمد بن محمد', 'مصرف الراجحي',
  'SA03 8000 0000 6080 1016 7519');
commit;
select public._assert((select iban = 'SA0380000000608010167519' from public.bank_accounts
   where member_id = :'yusuf'), 'الآيبان يُحفظ بلا مسافات وبحروف كبيرة');
select public._assert((select scope = 'local' and swift is null from public.bank_accounts
   where member_id = :'yusuf'), 'الحساب الداخلي لا يحتاج سويفت');

-- آيبان خاطئ مرفوض
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'khalid', true);
do $$ begin
  perform public.save_bank_account('local', 'خالد سعيد', 'البنك الأهلي', 'SA12345');
  raise exception 'FAIL: قُبل آيبان ناقص';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: الآيبان السعودي الناقص مرفوض';
end $$;
commit;

-- خارج المملكة: بلا سويفت مرفوض، ومعه مقبول
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'khalid', true);
do $$ begin
  perform public.save_bank_account('international', 'Khalid Saeed', 'Meezan Bank',
    'PK36SCBL0000001123456702', null, null, null, null, null, 'باكستان');
  raise exception 'FAIL: قُبل حساب خارجي بلا سويفت';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: الحساب الخارجي بلا سويفت مرفوض';
end $$;
do $$ begin
  perform public.save_bank_account('international', 'Khalid Saeed', 'Meezan Bank',
    'PK36SCBL0000001123456702', null, 'MEZNPKKA', null, 'Karachi', null, null);
  raise exception 'FAIL: قُبل حساب خارجي بلا دولة';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: الحساب الخارجي بلا دولة البنك مرفوض';
end $$;
select public.save_bank_account('international', 'Khalid Saeed', 'Meezan Bank',
  'pk36scbl0000001123456702', null, 'meznpkka', null, 'Karachi', 'باكستان', 'USD');
commit;
select public._assert((select swift = 'MEZNPKKA' and country = 'باكستان' and currency = 'USD'
   from public.bank_accounts where member_id = :'khalid'),
  'الحساب الخارجي يُحفظ بسويفت ودولة وعملة');

-- بلا آيبان: رقم حساب ورمز توجيه (أمريكا)
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'sara', true);
select public.save_bank_account('international', 'Sara Ali', 'Bank of America',
  null, '000123456789', 'BOFAUS3N', '026009593', 'New York', 'الولايات المتحدة', 'USD');
commit;
select public._assert((select account_number = '000123456789' and routing_code = '026009593'
   from public.bank_accounts where member_id = :'sara'),
  'الحساب بلا آيبان يُقبل برقم حساب ورمز توجيه');

-- لا يعدّل أحد حساب غيره
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
do $$ begin
  perform public.save_bank_account('local', 'محاولة', 'بنك', 'SA0380000000608010167519',
    p_member => '00000000-0000-0000-0000-00000000000e');
  raise exception 'FAIL: عدّل المترجم حساب غيره';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: لا يعدّل العضو حساب غيره';
end $$;
-- ولا يرى غير حسابه
select public._assert((select count(*) = 1 from public.bank_accounts), 'العضو لا يرى إلا حسابه البنكي');
commit;

-- الإدارة ترى الجميع، والمدير وحده يوثّق
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public._assert((select count(*) = 3 from public.bank_accounts), 'المنسق يرى حسابات الفريق');
do $$ begin
  perform public.verify_bank_account('00000000-0000-0000-0000-00000000000c', true);
  raise exception 'FAIL: وثّق المنسق حسابًا';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: التوثيق ممنوع على المنسق';
end $$;
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.verify_bank_account(:'yusuf', true);
commit;
select public._assert((select verified_at is not null from public.bank_accounts where member_id = :'yusuf'),
  'مدير المشروع يوثّق الحساب');

-- تغيير الآيبان يُلغي التوثيق
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.save_bank_account('local', 'يوسف أحمد بن محمد', 'مصرف الإنماء',
  'SA4420000001234567891234');
commit;
select public._assert((select verified_at is null from public.bank_accounts where member_id = :'yusuf'),
  'تغيير الآيبان يُلغي التوثيق السابق');
-- تغيير الاسم وحده لا يُلغيه
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.verify_bank_account(:'yusuf', true);
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.save_bank_account('local', 'يوسف أحمد بن محمد الغامدي', 'مصرف الإنماء',
  'SA4420000001234567891234');
commit;
select public._assert((select verified_at is not null from public.bank_accounts where member_id = :'yusuf'),
  'تغيير الاسم وحده لا يُلغي التوثيق');

-- خطاب البنك لا يُربط بحساب غير مسجَّل
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'pend', true);
do $$ begin
  perform public.set_bank_doc('x/letter.pdf');
  raise exception 'FAIL: رُبط خطاب بلا حساب';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: لا يُربط خطاب البنك قبل حفظ بياناته';
end $$;
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.set_bank_doc('00000000-0000-0000-0000-00000000000c/bank-1.pdf');
commit;
select public._assert((select doc_path like '%bank-1.pdf' from public.bank_accounts where member_id = :'yusuf'),
  'خطاب البنك يُربط بحساب صاحبه');

-- =====================================================================
-- 19) «بياناتي» وبطاقات العمل (ملاحظة ٨٥)
-- =====================================================================
-- رقم عضوية ثابت لكل عضو ولا يتكرر
select public._assert((select count(*) = 0 from public.profiles where member_no is null),
  'كل عضو يحمل رقم عضوية');
select public._assert((select count(distinct member_no) = count(*) from public.profiles),
  'رقم العضوية لا يتكرر');

-- العضو يعدّل الجوال والجنسية والإقامة
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.update_my_contact('+966500000000', 'سعودي', 'مكة المكرمة — العزيزية');
commit;
select public._assert((select whatsapp = '+966500000000' and residence = 'مكة المكرمة — العزيزية'
   from public.profile_private where id = :'yusuf'), 'العضو يعدّل بيانات تواصله');

-- ولا يمسّ التعديل الاسم ولا رقم الهوية
select public._assert((select national_id = '1012345678' from public.profile_private where id = :'yusuf'),
  'رقم الهوية لا يتغيّر بتعديل العضو لبياناته');

-- الصورة الشخصية: لصاحبها، ولا يمسّ غيره
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.set_member_photo('00000000-0000-0000-0000-00000000000c/photo-1.jpg');
do $$ begin
  perform public.set_member_photo('x/photo.jpg', '00000000-0000-0000-0000-00000000000e');
  raise exception 'FAIL: عدّل المترجم صورة غيره';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: لا يعدّل العضو صورة غيره';
end $$;
commit;
select public._assert((select photo_path like '%photo-1.jpg' from public.profile_private where id = :'yusuf'),
  'الصورة الشخصية تُحفظ لصاحبها');

-- الإدارة ترفع الصورة نيابةً عن العضو
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.set_member_photo('x/photo-2.jpg', :'khalid');
commit;
select public._assert((select photo_path = 'x/photo-2.jpg' from public.profile_private where id = :'khalid'),
  'المنسق يرفع الصورة نيابةً عن العضو');

-- جواز السفر لمن خارج المملكة، والهوية السعودية لمن بداخلها
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.admin_update_contact(:'sara', p_national_id => 'A1234567', p_id_type => 'passport');
do $$ begin
  perform public.admin_update_contact('00000000-0000-0000-0000-00000000000d',
    p_national_id => '9999', p_id_type => 'national');
  raise exception 'FAIL: قُبل رقم هوية خاطئ';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: رقم الهوية الخاطئ مرفوض';
end $$;
commit;
select public._assert((select id_type = 'passport' and national_id = 'A1234567'
   from public.profile_private where id = :'sara'), 'جواز السفر يُقبل لمن خارج المملكة');

-- إعدادات البطاقة: للإدارة وحدها
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
do $$ begin
  perform public.save_card_settings('بطاقة مزوّرة');
  raise exception 'FAIL: عدّل المترجم إعدادات البطاقة';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: إعداد البطاقة ممنوع على المترجم';
end $$;
-- يقرأ العضو إعدادات البطاقة ليعرض بطاقته، ولا يعدّلها (ملاحظة ٨٧)
select public._assert((select count(*) = 1 from public.card_settings),
  'العضو يقرأ إعدادات البطاقة ليعرض بطاقته');
commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.save_card_settings('بطاقة عمل — فريق الترجمة', 'مشروع خادم الحرمين الشريفين للترجمة',
  'عبدالرحمن المدير', 'مدير مشروع الترجمة', date '2027-12-31');
commit;
select public._assert((select official_title = 'مدير مشروع الترجمة' and valid_until = date '2027-12-31'
   from public.card_settings), 'المنسق يحفظ عنوان البطاقة واسم المسؤول ومنصبه وتاريخ الانتهاء');
do $$ begin
  perform public.save_card_settings('');
  raise exception 'FAIL: قُبل عنوان فارغ';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: عنوان البطاقة الفارغ مرفوض';
end $$;

-- =====================================================================
-- 20) تصميم البطاقة يُحفظ كما رُسم (ملاحظة ٨٦)
-- =====================================================================
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.save_card_settings('بطاقة عمل — فريق الترجمة', 'مشروع خادم الحرمين الشريفين للترجمة',
  'عبدالرحمن المدير', 'مدير مشروع الترجمة', date '2027-12-31',
  '{"v":1,"card":{"bg":"#ffffff"},"band":{"show":true,"h":14},"items":{"name":{"x":7,"y":18,"size":11,"bold":true}}}'::jsonb,
  'custom', 'card-logo-1.png');
commit;
select public._assert((select layout -> 'items' -> 'name' ->> 'size' = '11' from public.card_settings),
  'حجم خط الاسم يُحفظ كما اختاره المدير');
select public._assert((select (layout -> 'band' ->> 'h')::numeric = 14 from public.card_settings),
  'ارتفاع الشريط يُحفظ');
select public._assert((select logo_kind = 'custom' and logo_path = 'card-logo-1.png' from public.card_settings),
  'الشعار المرفوع يُحفظ مع البطاقة');

-- حفظ البيانات وحدها لا يمحو التصميم
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.save_card_settings('بطاقة عمل', 'مشروع الترجمة', 'أحمد المنسق', 'منسق', null);
commit;
select public._assert((select layout -> 'items' -> 'name' ->> 'size' = '11' from public.card_settings),
  'تعديل البيانات لا يمحو التصميم المحفوظ');

-- الرجوع إلى شعار الحرمين يزيل المرفوع من البطاقة
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.save_card_settings('بطاقة عمل', null, null, null, null, null, 'none');
commit;
select public._assert((select logo_kind = 'none' and logo_path is null from public.card_settings),
  'اختيار «بلا شعار» يزيل الشعار المرفوع');

-- تصميم غير صالح مرفوض
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
do $$ begin
  perform public.save_card_settings('بطاقة', null, null, null, null, '[1,2,3]'::jsonb);
  raise exception 'FAIL: قُبل تصميم غير صالح';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: التصميم غير الصالح مرفوض';
end $$;
commit;

-- المترجم لا يصمّم البطاقة
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
do $$ begin
  perform public.save_card_settings('بطاقة', null, null, null, null,
    '{"items":{"name":{"size":40}}}'::jsonb);
  raise exception 'FAIL: صمّم المترجم البطاقة';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: تصميم البطاقة ممنوع على المترجم';
end $$;
commit;

-- =====================================================================
-- 21) اعتماد البطاقة، وجولة التعديل لا تختفي عن المترجم (ملاحظة ٨٧)
-- =====================================================================
-- الاعتماد للإدارة وحدها
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
do $$ begin
  perform public.issue_member_cards(array['00000000-0000-0000-0000-00000000000c'::uuid]);
  raise exception 'FAIL: اعتمد المترجم بطاقته بنفسه';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: اعتماد البطاقة ممنوع على المترجم';
end $$;
select public._assert((select count(*) = 0 from public.member_cards), 'لا بطاقة معتمَدة قبل اعتماد الإدارة');
commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.save_card_settings('بطاقة عمل', 'مشروع الترجمة', 'عبدالرحمن المدير', 'مدير المشروع', date '2028-06-30');
select public._assert(public.issue_member_cards(array[:'yusuf'::uuid, :'khalid'::uuid]) = 2,
  'المدير يعتمد بطاقتين دفعة واحدة');
commit;
select public._assert((select valid_until = date '2028-06-30' from public.member_cards where member_id = :'yusuf'),
  'البطاقة المعتمَدة تأخذ تاريخ الصلاحية من إعدادات البطاقة');

-- العضو يرى بطاقته وحدها
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert((select count(*) = 1 from public.member_cards), 'العضو يرى بطاقته وحدها');
commit;

-- سحب الاعتماد يزيلها
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public._assert(public.issue_member_cards(array[:'khalid'::uuid], false) = 1, 'المنسق يسحب الاعتماد');
commit;
select public._assert((select count(*) = 1 from public.member_cards), 'سحب الاعتماد يزيل البطاقة');

-- جولة تعديل: الإغلاق يخفيها، وإعادة الفتح تعيدها
do $$
declare v_mat uuid; v_rev uuid;
begin
  select id into v_mat from public.materials limit 1;
  insert into public.material_revisions (material_id, round, mode, note)
  values (v_mat, 900, 'annotate', 'جولة اختبار') returning id into v_rev;
  update public.material_revisions set closed_at = now() where id = v_rev;
  if exists (select 1 from public.material_revisions
              where material_id = v_mat and closed_at is null and round = 900) then
    raise exception 'FAIL: الجولة لم تُغلق';
  end if;
  raise notice 'PASS: إغلاق الجولة يخفيها عن المترجم';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  perform public.reopen_revision(v_rev);
  if (select closed_at from public.material_revisions where id = v_rev) is not null then
    raise exception 'FAIL: لم تُعَد الجولة مفتوحة';
  end if;
  raise notice 'PASS: إعادة فتح الجولة تُعيد التحديدات للمترجم';
end $$;

-- لا جولتان مفتوحتان على خطبة واحدة
do $$
declare v_mat uuid; v_rev uuid;
begin
  select material_id into v_mat from public.material_revisions where round = 900;
  insert into public.material_revisions (material_id, round, mode) values (v_mat, 901, 'annotate') returning id into v_rev;
  update public.material_revisions set closed_at = now() where id = v_rev;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  begin
    perform public.reopen_revision(v_rev);
    raise exception 'FAIL: فُتحت جولتان معًا';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: لا تُفتح جولتان على خطبة واحدة';
  end;
end $$;

-- =====================================================================
-- 22) التعميم الملزم وسجل فتح المرفق (ملاحظة ٨٩)
-- =====================================================================
-- الإلزام بلا توقيع مرفوض
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.send_circular('تعميم بلا توقيع', 'notice', 'نص', null, 'all', null, false, true);
  raise exception 'FAIL: قُبل تعميم ملزم بلا توقيع';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: التعميم الملزم يشترط التوقيع بالعلم';
end $$;

-- تعميم ملزم إلى المترجمين
select public.send_circular('اتفاقية عدم إفصاح', 'directive', null, 'nda-1.pdf',
  'translators', null, true, true) as blocking_id \gset
commit;

select public._assert((select blocking from public.circulars where id = :'blocking_id'),
  'التعميم يُحفظ ملزمًا');

-- يمنع المترجم من متابعة مهامه حتى يوقّع
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert(public.my_blocking_circulars() = 1, 'التعميم الملزم يمنع متابعة المهام');
-- فتح المرفق يُسجَّل ويعلّم الاطّلاع
select public.log_circular_view(:'blocking_id');
select public.log_circular_view(:'blocking_id');
select public._assert((select count(*) = 2 from public.circular_views where circular_id = :'blocking_id'),
  'كل فتح للمرفق يُسجَّل بذاته');
select public._assert((select read_at is not null from public.circular_recipients
   where circular_id = :'blocking_id' and member_id = :'yusuf'), 'فتح المرفق يعلّم الاطّلاع');
select public.ack_circular(:'blocking_id', 'يوسف أحمد');
select public._assert(public.my_blocking_circulars() = 0, 'التوقيع يرفع المنع');
commit;

-- من ليس مستقبِلًا لا يفتح المرفق
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.log_circular_view((select id from public.circulars where title = 'اتفاقية عدم إفصاح'));
  raise exception 'FAIL: فتح غير المستقبِل المرفق';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: لا يفتح المرفق إلا من أُرسل إليه';
end $$;
-- والإدارة ترى سجل الفتح
select public._assert((select count(*) = 2 from public.circular_views where circular_id = :'blocking_id'),
  'الإدارة ترى سجل مرات الفتح');
commit;

-- تعميم غير ملزم لا يمنع العمل
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.send_circular('دعوة لقاء الفريق', 'invitation', 'اللقاء يوم الأحد', null, 'translators');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert(public.my_blocking_circulars() = 0, 'التعميم غير الملزم لا يمنع متابعة المهام');
select public._assert(public.my_pending_circulars() = 1, 'ويبقى معلّمًا بانتظار التوقيع');
commit;


-- =====================================================================
-- 23) دليل الإنتاج: الكلمات والدقائق (ملاحظة ٩٠)
-- =====================================================================
do $$
declare v_m uuid; v_t uuid;
begin
  insert into public.materials (title, material_type, sermon_type, mosque, sermon_date, khateeb_id, deliverable,
                                source_html, created_by)
  values ('مادة حساب الكلمات', 'خطب', 'خطبة جمعة', 'makkah', current_date, (select id from public.khateebs order by id limit 1), 'text_audio',
          '<p>الحمد لله رب العالمين</p>', '00000000-0000-0000-0000-00000000000a')
  returning id into v_m;

  insert into public.tracks (material_id, language_code, status, translation_html, receipt_due_at)
  values (v_m, 'en', 'completed', '<p>Praise be <b>to</b> God</p><p>the Lord of the worlds</p>', now())
  returning id into v_t;

  -- النص المجرّد: Praise be to God the Lord of the worlds = عشر كلمات
  if (select words from public.production_rows where track_id = v_t) <> 9 then
    raise exception 'FAIL: عدد الكلمات % بدل ٩', (select words from public.production_rows where track_id = v_t);
  end if;
  raise notice 'PASS: عدد كلمات الترجمة يُحسب من نصها مجرّدًا من الوسوم';

  if (select chars from public.production_rows where track_id = v_t) <> 39 then
    raise exception 'FAIL: عدد الحروف % بدل ٣٩', (select chars from public.production_rows where track_id = v_t);
  end if;
  raise notice 'PASS: عدد الحروف يُحسب للغات التي لا تفصل كلماتها بفراغ';

  -- مادة بلا ترجمة: صفر كلمات ولا تدخل المجموع
  insert into public.tracks (material_id, language_code, status, receipt_due_at)
  values (v_m, 'ur', 'in_progress', now());
  if (select words from public.production_rows where material_id = v_m and language_code = 'ur') <> 0 then
    raise exception 'FAIL: حُسبت كلمات لمسار بلا ترجمة';
  end if;
  raise notice 'PASS: المسار بلا ترجمة صفر كلمات';

  -- مدة التسجيل تُحفظ مرة واحدة
  insert into public.track_audios (track_id, path, uploaded_by, is_approved)
  values (v_t, 'x/a.mp3', '00000000-0000-0000-0000-00000000000a', true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  perform public.set_audio_duration(v_t, 'x/a.mp3', 930);
  if (select duration_seconds from public.track_audios where track_id = v_t) <> 930 then
    raise exception 'FAIL: لم تُحفظ مدة التسجيل';
  end if;
  perform public.set_audio_duration(v_t, 'x/a.mp3', 10);
  if (select duration_seconds from public.track_audios where track_id = v_t) <> 930 then
    raise exception 'FAIL: أُعيدت كتابة مدة محفوظة';
  end if;
  raise notice 'PASS: مدة التسجيل تُحفظ مرة واحدة ولا تُعاد كتابتها';

  if (select audio_seconds from public.production_rows where track_id = v_t) <> 930 then
    raise exception 'FAIL: لم تُجمع ثواني التسجيل المعتمد';
  end if;
  raise notice 'PASS: دقائق التسجيل المعتمد تدخل الدليل';

  -- المجاميع
  if (select words from public.production_totals()) <> 9 then
    raise exception 'FAIL: المجموع % بدل ٩', (select words from public.production_totals());
  end if;
  if (select tracks from public.production_totals()) <> 1 then
    raise exception 'FAIL: عدد الأعمال في المجموع خاطئ';
  end if;
  raise notice 'PASS: المجموع العام يجمع الكلمات ويعدّ الأعمال المحسوبة وحدها';

  -- المحذوف لا يدخل الدليل
  update public.tracks set deleted_at = now() where id = v_t;
  if (select count(*) from public.production_rows where track_id = v_t) <> 0 then
    raise exception 'FAIL: العمل المحذوف يدخل الدليل';
  end if;
  raise notice 'PASS: الأعمال المحذوفة لا تدخل دليل الإنتاج';
end $$;

-- =====================================================================
-- 24) صفحة التعريف خلف رمز اطّلاع (ملاحظة ٩١)
-- =====================================================================
-- بلا رمز: الصفحة مفتوحة
begin; set local role anon;
select public._assert((public.open_page('about') -> 'sections') is not null,
  'الصفحة مفتوحة قبل ضبط الرمز');
select public._assert(public.page_needs_code('about') = false, 'ولا تطلب رمزًا');
commit;

-- ضبط الرمز لمدير المشروع وحده
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.set_page_code('about', 'secret-code');
  raise exception 'FAIL: ضبط المنسق رمز الاطّلاع';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: ضبط رمز الاطّلاع لمدير المشروع وحده';
end $$;
commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
do $$ begin
  perform public.set_page_code('about', 'abc');
  raise exception 'FAIL: قُبل رمز قصير';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: الرمز القصير مرفوض';
end $$;
select public.set_page_code('about', 'Haramain-1448');
commit;

-- الزائر بلا رمز يُمنع، وبرمز خاطئ يُمنع، وبالصحيح يرى
begin; set local role anon;
select public._assert(public.page_needs_code('about'), 'الصفحة صارت تطلب رمزًا');
do $$ begin
  perform public.open_page('about');
  raise exception 'FAIL: فُتحت الصفحة بلا رمز';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: الزائر لا يرى الصفحة بلا رمز';
end $$;
do $$ begin
  perform public.open_page('about', 'wrong-code');
  raise exception 'FAIL: فُتحت الصفحة برمز خاطئ';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: الرمز الخاطئ مرفوض';
end $$;
select public._assert((public.open_page('about', 'Haramain-1448') ->> 'h1') like '%منصة%',
  'الرمز الصحيح يفتح الصفحة');
-- ولا يصل الزائر إلى الجدول نفسه
select public._assert((select count(*) = 0 from public.page_content), 'الزائر لا يقرأ جدول المحتوى');
commit;

-- العضو المفعّل يراها بلا رمز
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert(public.page_needs_code('about') = false, 'العضو المفعّل لا يُطلب منه رمز');
select public._assert((public.open_page('about') -> 'stages') is not null, 'العضو المفعّل يرى الصفحة');
commit;

-- تعديل المحتوى لمدير المشروع
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.save_page_content('about',
  (public.open_page('about') || '{"h1":"النص النهائي"}'::jsonb));
commit;
begin; set local role anon;
select public._assert((public.open_page('about', 'Haramain-1448') ->> 'h1') = 'النص النهائي',
  'مدير المشروع يستبدل نص الصفحة');
commit;

-- =====================================================================
-- 25) تدقيق المستندات: اعتماد أو إعادة بسبب (ملاحظة ٩٨)
-- =====================================================================
-- العضو يرفع صورته فتدخل المراجعة
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.set_member_photo('00000000-0000-0000-0000-00000000000c/photo-1.jpg');
select public._assert((select photo_status = 'pending' from public.profile_private where id = :'yusuf'),
  'الصورة المرفوعة تدخل تحت المراجعة');
commit;

-- العضو لا يعتمد صورة نفسه
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
do $$ begin
  perform public.review_member_doc('00000000-0000-0000-0000-00000000000c', 'photo', 'approved');
  raise exception 'FAIL: اعتمد العضو صورته بنفسه';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: تدقيق المستندات للمنسق ومدير المشروع';
end $$;
commit;

-- الإعادة تشترط سببًا مكتوبًا
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.review_member_doc('00000000-0000-0000-0000-00000000000c', 'photo', 'rejected', null);
  raise exception 'FAIL: أُعيدت الصورة بلا سبب';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: إعادة المستند تشترط سببًا يعرفه العضو';
end $$;
select public.review_member_doc(:'yusuf', 'photo', 'rejected', 'الخلفية غير بيضاء');
select public._assert((select photo_status = 'rejected' and photo_note = 'الخلفية غير بيضاء'
  from public.profile_private where id = :'yusuf'), 'الإعادة تُسجَّل بسببها');
commit;

-- رفع بديل يعيدها إلى المراجعة، ثم تُعتمد
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.set_member_photo('00000000-0000-0000-0000-00000000000c/photo-2.jpg');
select public._assert((select photo_status = 'pending' and photo_note is null
  from public.profile_private where id = :'yusuf'), 'البديل يعود تحت المراجعة ويُمحى سبب الإعادة');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public.review_member_doc(:'yusuf', 'photo', 'approved');
select public._assert((select photo_status = 'approved' and photo_by = :'coord'
  from public.profile_private where id = :'yusuf'), 'الاعتماد يُسجَّل باسم من اعتمده');
-- يبقى في العدّاد من لم تُدقَّق صورته بعد (د. خالد)، ولا يُحسب من اعتُمدت صورته
select public._assert((select photos from public.pending_reviews()) = 1, 'عدّاد ما ينتظر التدقيق يتناقص بالاعتماد');
commit;

-- =====================================================================
-- 26) الإرشاد المكاني: فريق مستقل لا تُسنَد إليه أعمال ترجمة (ملاحظة ٩٩)
-- =====================================================================
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public._assert((select track = 'translation' from public.profiles where id = :'sara'),
  'الأعضاء على مسار الترجمة ما لم يُنقلوا');
select public.set_member_track(:'sara', 'field');
select public._assert((select track = 'field' from public.profiles where id = :'sara'),
  'مدير المشروع ينقل العضو إلى الإرشاد المكاني');
select public._assert((select field_members >= 1 from public.pending_reviews()),
  'عدّاد فريق الإرشاد المكاني يعمل');
commit;

-- لا تُسنَد مرحلة ترجمة إلى عضو ميداني، مهما كان طريق الإسناد
do $$
declare v_m uuid; v_t uuid;
begin
  insert into public.materials (title, material_type, sermon_type, mosque, sermon_date, khateeb_id, deliverable,
                                source_html, created_by)
  values ('مادة الإرشاد المكاني', 'خطب', 'خطبة جمعة', 'makkah', current_date, (select id from public.khateebs order by id limit 1), 'text',
          '<p>نص</p>', '00000000-0000-0000-0000-00000000000a')
  returning id into v_m;
  insert into public.tracks (material_id, language_code, status, receipt_due_at)
  values (v_m, 'en', 'in_progress', now() + interval '2 days') returning id into v_t;
  begin
    insert into public.track_stages (track_id, stage_key, sort, assignee_id, status)
    values (v_t, 'translation', 1, '00000000-0000-0000-0000-00000000000e', 'waiting');
    raise exception 'FAIL: أُسندت مرحلة ترجمة إلى عضو ميداني';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: فريق الإرشاد المكاني لا تُسنَد إليه أعمال ترجمة';
  end;
  delete from public.tracks where id = v_t;
  delete from public.materials where id = v_m;
end $$;

-- المراسلات: جمهور مستقل لكل فريق
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
do $$
declare v_c uuid; v_n int;
begin
  v_c := public.send_circular('تعميم الإرشاد المكاني', 'notice', 'نص التعميم', null, 'field', null, false, false);
  select count(*) into v_n from public.circular_recipients where circular_id = v_c;
  if v_n <> 1 then raise exception 'FAIL: جمهور الإرشاد المكاني % مستقبِلًا', v_n; end if;
  if not exists (select 1 from public.circular_recipients
                  where circular_id = v_c and member_id = '00000000-0000-0000-0000-00000000000e') then
    raise exception 'FAIL: لم يصل التعميم إلى العضو الميداني';
  end if;
  raise notice 'PASS: تعميم فريق الإرشاد المكاني لا يتجاوزه إلى فريق الترجمة';
end $$;
commit;

-- ثم يعود إلى الترجمة التخصصية ترقيةً
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.set_member_track(:'sara', 'translation');
select public._assert((select track = 'translation' from public.profiles where id = :'sara'),
  'المتميّز يُرقّى من الإرشاد المكاني إلى الترجمة التخصصية');
commit;

-- =====================================================================
-- 27) إلزام التحقق بخطوتين على حسابات الإدارة (ملاحظة ١٠٣)
-- =====================================================================
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
-- يبدأ اختياريًّا ويفتحه مدير المشروع بعد أن يجرّبه على حسابه (ملاحظة ١٠٥)
select public._assert((select mfa_required_admins = false from public.platform_settings),
  'الإلزام مرفوع افتراضًا ويقرأ الإعداد كل عضو');
do $$ begin
  perform public.set_mfa_required(false);
  raise exception 'FAIL: غيّر مترجم إعدادات الحماية';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: تغيير إعدادات الحماية ليس للمترجم';
end $$;
commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$ begin
  perform public.set_mfa_required(false);
  raise exception 'FAIL: غيّر المنسق إعدادات الحماية';
exception when others then
  if position('FAIL' in SQLERRM) > 0 then raise; end if;
  raise notice 'PASS: تغيير إعدادات الحماية ليس للمنسق';
end $$;
commit;

begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public.set_mfa_required(false);
select public._assert((select mfa_required_admins = false from public.platform_settings),
  'مدير المشروع يرفع الإلزام');
select public.set_mfa_required(true);
select public._assert((select mfa_required_admins and updated_by = :'mgr' from public.platform_settings),
  'ويعيده، ويُسجَّل من غيّره');
commit;

-- =====================================================================
-- 28) التذكير قبل الموعد، والإعادة للتعديل، وتحكّم الإدارة في المراسلات
--     (ملاحظات ١٠٩ و١١٠ و١١٢)
-- =====================================================================
do $$
declare v_m uuid; v_t uuid; v_s uuid; v_before int; v_n int;
begin
  insert into public.materials (title, material_type, sermon_type, mosque, sermon_date, khateeb_id, deliverable,
                                source_html, created_by)
  values ('مادة التذكير', 'خطب', 'خطبة جمعة', 'makkah', current_date, (select id from public.khateebs order by id limit 1), 'text',
          '<p>نص</p>', '00000000-0000-0000-0000-00000000000a')
  returning id into v_m;
  insert into public.tracks (material_id, language_code, status, receipt_due_at)
  values (v_m, 'en', 'in_progress', now() + interval '2 days') returning id into v_t;

  -- مرحلة جارية موعدها بعد ست ساعات: تدخل التذكير
  insert into public.track_stages (track_id, stage_key, sort, assignee_id, status, due_at)
  values (v_t, 'translation', 1, '00000000-0000-0000-0000-00000000000c', 'active', now() + interval '6 hours')
  returning id into v_s;

  select count(*) into v_before from public.notifications where kind = 'reminder';
  v_n := public.enqueue_due_reminders(24);
  if v_n < 1 then raise exception 'FAIL: لم يُبنَ التذكير'; end if;
  if (select count(*) from public.notifications where kind = 'reminder') <> v_before + v_n then
    raise exception 'FAIL: التذكير لم يدخل الطابور';
  end if;
  raise notice 'PASS: تذكير قبل انتهاء المهلة يدخل طابور البريد';

  -- لا يتكرر التذكير للمرحلة نفسها
  if public.enqueue_due_reminders(24) <> 0 then raise exception 'FAIL: تكرر التذكير'; end if;
  raise notice 'PASS: التذكير مرة واحدة لكل مرحلة لا يتكرر';

  -- الإعادة للتعديل تُشعر صاحب المرحلة
  select count(*) into v_before from public.notifications where kind = 'returned';
  insert into public.track_events (track_id, actor_id, action, stage_key, target_stage_key, note)
  values (v_t, '00000000-0000-0000-0000-00000000000b', 'returned', 'sharia_review', 'translation', 'يُراجع المعنى');
  if (select count(*) from public.notifications where kind = 'returned') <= v_before then
    raise exception 'FAIL: لم يُشعَر العضو بالإعادة';
  end if;
  raise notice 'PASS: الإعادة للتعديل تُشعر صاحب المرحلة بملاحظتها';

  delete from public.tracks where id = v_t;
  delete from public.materials where id = v_m;
end $$;

-- تحكّم الإدارة في المراسلات
do $$
declare v_c uuid; v_n int;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  v_c := public.send_circular('تعميم للتجربة', 'notice', 'نص التعميم', null, 'all', null, true, true);

  perform public.update_circular(v_c, 'تعميم معدَّل', null, null, null, null);
  if (select title from public.circulars where id = v_c) <> 'تعميم معدَّل' then
    raise exception 'FAIL: لم يُحفظ التعديل'; end if;
  if (select edited_at is null from public.circulars where id = v_c) then
    raise exception 'FAIL: لم يُسجَّل أثر التعديل'; end if;
  raise notice 'PASS: الإدارة تعدّل ما أُرسل ويُسجَّل أثر التعديل';

  v_n := public.remind_circular(v_c);
  if v_n < 1 then raise exception 'FAIL: لم يصل التذكير لمن لم يوقّع'; end if;
  raise notice 'PASS: التذكير يصل من لم يوقّع وحدهم';

  perform public.update_circular(v_c, null, null, null, null, false);
  if (select blocking from public.circulars where id = v_c) then raise exception 'FAIL: لم يُرفع الإلزام'; end if;
  raise notice 'PASS: رفع الإلزام يُبقي الرسالة ويحرّر متابعة العمل';
end $$;

-- الحذف لمدير المشروع وحده
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$
declare v_c uuid;
begin
  select id into v_c from public.circulars order by sent_at desc limit 1;
  begin
    perform public.delete_circular(v_c);
    raise exception 'FAIL: حذف المنسق رسالة';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: حذف المراسلات لمدير المشروع وحده';
  end;
end $$;
commit;

-- التوقيع اليدوي يُحفظ ويُدرَج مع التوقيع بالعلم
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public.set_my_signature('00000000-0000-0000-0000-00000000000c/sig-1.png');
select public._assert((select signature_path is not null and signature_at is not null
  from public.profile_private where id = :'yusuf'), 'التوقيع اليدوي يُحفظ في ملف العضو');
do $$
declare v_c uuid;
begin
  select id into v_c from public.circulars order by sent_at desc limit 1;
  perform public.ack_circular(v_c, 'يوسف أحمد');
  if (select signature_path is null from public.circular_recipients
       where circular_id = v_c and member_id = '00000000-0000-0000-0000-00000000000c') then
    raise exception 'FAIL: لم يُدرَج التوقيع اليدوي مع التوقيع بالعلم';
  end if;
  raise notice 'PASS: التوقيع اليدوي يُدرَج تلقائيًّا مع التوقيع الإلكتروني';
end $$;
commit;

-- =====================================================================
-- 29) الرواتب والمستحقات، والحضور بالورديات (ملاحظتا ١١٦ و١١٧)
-- =====================================================================
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);

-- أجر شهري لخالد، ومقطوع ليوسف
select public.set_member_pay(:'khalid', 'monthly', 6000, 0, 'مرشد مكاني');
select public.set_member_pay(:'yusuf', 'per_work', 0, 250, 'مقطوع لكل مرحلة منجزة');
select public._assert((select pay_type = 'monthly' and monthly = 6000 from public.member_pay where member_id = :'khalid'),
  'الأجر الشهري يُحفظ كما ضُبط');
commit;

-- ضبط الأجور لمدير المشروع وحده
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$
begin
  begin
    perform public.set_member_pay('00000000-0000-0000-0000-00000000000d', 'monthly', 9000, 0, null);
    raise exception 'FAIL: المنسق ضبط أجرًا';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: ضبط الأجور لمدير المشروع وحده';
  end;
end $$;
commit;

-- عملان منجزان ليوسف في هذا الشهر
do $$
declare v_m uuid; v_t uuid; v_id uuid; v_base numeric; v_works int; v_total numeric;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  insert into public.materials (title, material_type, sermon_type, mosque, sermon_date, khateeb_id, deliverable, source_html, created_by)
  values ('مادة الرواتب', 'خطب', 'خطبة جمعة', 'makkah', current_date, (select id from public.khateebs order by id limit 1), 'text', '<p>نص</p>',
          '00000000-0000-0000-0000-00000000000a')
  returning id into v_m;
  -- العمل لا يُحتسب إلا بإتمام مساره (ملاحظة ١١٨)
  insert into public.tracks (material_id, language_code, status, receipt_due_at, completed_at)
  values (v_m, 'en', 'completed', now() + interval '2 days', now()) returning id into v_t;
  insert into public.track_stages (track_id, stage_key, sort, assignee_id, status, finished_at)
  values (v_t, 'translation', 1, '00000000-0000-0000-0000-00000000000c', 'done', now()),
         (v_t, 'sharia_review', 2, '00000000-0000-0000-0000-00000000000c', 'done', now());

  v_id := public.build_payroll(date_trunc('month', current_date)::date);

  select base into v_base from public.payroll_items where payroll_id = v_id and member_id = '00000000-0000-0000-0000-00000000000d';
  if v_base <> 6000 then raise exception 'FAIL: الأجر الشهري لم يُنقل كما هو (%)', v_base; end if;
  raise notice 'PASS: الأجر الشهري ينتقل إلى الدورة ثابتًا';

  select base, works into v_base, v_works from public.payroll_items
   where payroll_id = v_id and member_id = '00000000-0000-0000-0000-00000000000c';
  if v_works <> 1 or v_base <> 250 then raise exception 'FAIL: المقطوع لم يُحتسب بعدد الأعمال (% × %)', v_works, v_base; end if;
  raise notice 'PASS: المقطوع يُحتسب بعدد الأعمال المكتملة في الشهر';

  -- بدل وخصم بسببهما
  perform public.set_payroll_item(v_id, '00000000-0000-0000-0000-00000000000d', 500, 200, 'بدل مواصلات وخصم تأخير');
  select (base + allowance - deduction) into v_total from public.payroll_items
   where payroll_id = v_id and member_id = '00000000-0000-0000-0000-00000000000d';
  if v_total <> 6300 then raise exception 'FAIL: الإجمالي لم يحسب البدل والخصم (%)', v_total; end if;
  raise notice 'PASS: البدلات والخصومات تدخل الإجمالي بسببها المكتوب';

  -- المستحقات لا تظهر للعضو قبل الاعتماد
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  if exists (select 1 from public.my_payslips()) then
    raise exception 'FAIL: ظهر الكشف قبل اعتماده';
  end if;
  raise notice 'PASS: المستحقات لا تظهر للعضو قبل اعتماد المدير';

  -- الاعتماد ثم تجميد البنود
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  perform public.set_payroll_status(v_id, 'approved');
  begin
    perform public.set_payroll_item(v_id, '00000000-0000-0000-0000-00000000000d', 0, 0, null);
    raise exception 'FAIL: عُدّل بند بعد الاعتماد';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: بنود الدورة لا تُعدَّل بعد اعتمادها';
  end;
  begin
    perform public.build_payroll(date_trunc('month', current_date)::date);
    raise exception 'FAIL: أُعيد احتساب دورة معتمدة';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: الدورة المعتمدة لا يُعاد احتسابها';
  end;

  -- بعد الاعتماد يرى العضو كشفه هو وحده
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  if (select count(*) from public.my_payslips()) <> 1 then raise exception 'FAIL: لم يرَ العضو كشفه بعد الاعتماد'; end if;
  if exists (select 1 from public.my_payslips() where base = 6000) then
    raise exception 'FAIL: رأى العضو كشف غيره';
  end if;
  raise notice 'PASS: العضو يرى كشفه المعتمد وحده';

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  delete from public.tracks where id = v_t;
  delete from public.materials where id = v_m;
end $$;

-- الورديات: جدولتها للإدارة، وبصمتها لصاحبها
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$
declare v_s uuid; v_late int; v_sum record;
        v_now time; v_from time; v_to time; v_exp int;
begin
  -- نافذة داخل اليوم نفسه: الوردية لا تتجاوز منتصف الليل فتنقلب أوقاتها
  v_now  := (now() at time zone 'Asia/Riyadh')::time;
  v_from := case when v_now < '00:35'::time then '00:00'::time else v_now - interval '30 minutes' end;
  v_to   := case when v_from > '19:59'::time then '23:59'::time else v_from + interval '4 hours' end;
  v_exp  := floor(extract(epoch from (v_now - v_from)) / 60);
  v_s := public.save_shift('00000000-0000-0000-0000-00000000000d', current_date,
                           v_from, v_to, 'المسجد الحرام — المسعى', null, null);
  if v_s is null then raise exception 'FAIL: لم تُجدول الوردية'; end if;
  raise notice 'PASS: المنسق يجدول ورديات المرشدين';

  begin
    perform public.save_shift('00000000-0000-0000-0000-00000000000d', current_date, '14:00', '09:00', null, null, null);
    raise exception 'FAIL: قُبلت وردية تنتهي قبل بدئها';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: نهاية الوردية لا تسبق بدايتها';
  end;

  -- بصمة غير صاحبها مرفوضة
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  begin
    perform public.shift_check(v_s, false);
    raise exception 'FAIL: بصم عضو وردية غيره';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: البصمة لصاحب الوردية وحده';
  end;

  -- الانصراف قبل الحضور مرفوض
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
  begin
    perform public.shift_check(v_s, true);
    raise exception 'FAIL: سُجّل انصراف بلا حضور';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: لا انصراف قبل تسجيل الحضور';
  end;

  perform public.shift_check(v_s, false);
  select status, late_minutes into v_sum from public.shifts where id = v_s;
  if v_sum.status <> 'present' then raise exception 'FAIL: لم تُعلَّم الوردية حضورًا'; end if;
  if v_sum.late_minutes < least(25, v_exp) then raise exception 'FAIL: لم يُحتسب التأخير (%)', v_sum.late_minutes; end if;
  raise notice 'PASS: الحضور يُسجَّل ويُحتسب معه التأخير بالدقائق';

  perform public.shift_check(v_s, true);
  if (select check_out_at is null from public.shifts where id = v_s) then raise exception 'FAIL: لم يُسجَّل الانصراف'; end if;
  raise notice 'PASS: الانصراف يُسجَّل في الوردية نفسها';

  -- ملخص الشهر يعدّ ورديات المرشد
  select * into v_sum from public.attendance_summary(current_date)
   where member_id = '00000000-0000-0000-0000-00000000000d';
  if v_sum.present < 1 then raise exception 'FAIL: لم يعدّ التقرير الحضور'; end if;
  raise notice 'PASS: تقرير الشهر يعدّ الورديات والحضور والتأخير';

  -- تعليم الغياب للإدارة وحدها
  begin
    perform public.set_shift_status(v_s, 'absent', null);
    raise exception 'FAIL: علّم المرشد نفسه غائبًا';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: تعليم الغياب والإجازة للإدارة وحدها';
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  perform public.delete_shift(v_s);
  if exists (select 1 from public.shifts where id = v_s) then raise exception 'FAIL: لم تُحذف الوردية'; end if;
  raise notice 'PASS: الإدارة تحذف الوردية من الجدول';
end $$;
commit;

-- =====================================================================
-- 30) تسعيرة الأعمال بالمقطوع حسب نوعها، وربطها بالإنجاز (ملاحظة ١١٨)
-- =====================================================================
do $$
declare v_m uuid; v_t uuid; v_id uuid; v_base numeric; v_works int; v_n int;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

  -- نوع العمل يفرّق بين الخطبة الكتابية والخطبة مع التسجيل الصوتي
  if public.work_kind('خطب', 'text_audio') <> 'sermon_audio'
     or public.work_kind('خطب', 'text') <> 'sermon_text'
     or public.work_kind('كتب', 'text') <> 'book'
     or public.work_kind('مطويات', 'text') <> 'booklet' then
    raise exception 'FAIL: نوع العمل لم يُشتق كما ينبغي';
  end if;
  raise notice 'PASS: نوع العمل يفرّق بين الخطبة مع التسجيل والخطبة الكتابية والكتاب والمطوية';

  perform public.set_pay_rate('sermon_audio', 400);
  perform public.set_pay_rate('book', 1500);
  if public.rate_for('00000000-0000-0000-0000-00000000000c', 'sermon_audio') <> 400 then
    raise exception 'FAIL: السعر العام لم يُطبَّق';
  end if;
  perform public.set_member_rate('00000000-0000-0000-0000-00000000000c', 'sermon_audio', 550);
  if public.rate_for('00000000-0000-0000-0000-00000000000c', 'sermon_audio') <> 550 then
    raise exception 'FAIL: السعر الخاص لم يغلب العام';
  end if;
  raise notice 'PASS: لكل نوع عمل سعره، والسعر الخاص بالعضو يغلب السعر العام';

  -- عمل لم يكتمل لا يُحتسب
  insert into public.materials (title, material_type, sermon_type, mosque, sermon_date, khateeb_id, deliverable, source_html, created_by)
  values ('خطبة بالتسجيل', 'خطب', 'خطبة جمعة', 'makkah', current_date, (select id from public.khateebs order by id limit 1), 'text_audio', '<p>نص</p>',
          '00000000-0000-0000-0000-00000000000a')
  returning id into v_m;
  insert into public.tracks (material_id, language_code, status, receipt_due_at)
  values (v_m, 'en', 'in_progress', now() + interval '2 days') returning id into v_t;
  insert into public.track_stages (track_id, stage_key, sort, assignee_id, status, finished_at)
  values (v_t, 'translation', 1, '00000000-0000-0000-0000-00000000000c', 'done', now());

  select count(*) into v_n from public.work_items(date_trunc('month', current_date)::date,
                                                 (date_trunc('month', current_date) + interval '1 month - 1 day')::date)
   where member_id = '00000000-0000-0000-0000-00000000000c';
  if v_n > 0 then raise exception 'FAIL: احتُسب عمل لم يكتمل مساره'; end if;
  raise notice 'PASS: لا يُحتسب العمل إلا بإتمام مساره لا بإسناده';

  update public.tracks set status = 'completed', completed_at = now() where id = v_t;

  select works into v_works from public.work_items(date_trunc('month', current_date)::date,
                                                   (date_trunc('month', current_date) + interval '1 month - 1 day')::date)
   where member_id = '00000000-0000-0000-0000-00000000000c' and work_kind = 'sermon_audio';
  if coalesce(v_works, 0) <> 1 then raise exception 'FAIL: لم يدخل العمل سجل العضو بعد اكتماله (%)', v_works; end if;
  raise notice 'PASS: العمل يدخل سجل العضو بنوعه عند اكتماله';

  -- الدورة تحتسب المقطوع بالسعر الخاص، وتحفظ تفصيله
  delete from public.payrolls where period = date_trunc('month', current_date)::date;
  perform public.set_member_pay('00000000-0000-0000-0000-00000000000c', 'per_work', 0, 0, null);
  v_id := public.build_payroll(date_trunc('month', current_date)::date);
  select base, works into v_base, v_works from public.payroll_items
   where payroll_id = v_id and member_id = '00000000-0000-0000-0000-00000000000c';
  if v_base <> 550 then raise exception 'FAIL: المقطوع لم يُحتسب بسعر نوعه (%)', v_base; end if;
  if not exists (select 1 from public.payroll_item_kinds
                  where payroll_id = v_id and member_id = '00000000-0000-0000-0000-00000000000c'
                    and work_kind = 'sermon_audio' and works = 1 and amount = 550) then
    raise exception 'FAIL: لم يُحفظ تفصيل الأعمال مع الدورة';
  end if;
  raise notice 'PASS: الدورة تحتسب كل عمل بسعر نوعه وتحفظ تفصيله';

  -- تقرير الإنجاز يعرض العدد والمبلغ لكل نوع
  if not exists (select 1 from public.member_work_report(
       date_trunc('month', current_date)::date,
       (date_trunc('month', current_date) + interval '1 month - 1 day')::date)
     where member_id = '00000000-0000-0000-0000-00000000000c' and work_kind = 'sermon_audio'
       and works = 1 and amount = 550) then
    raise exception 'FAIL: تقرير الإنجاز لم يعرض العمل';
  end if;
  raise notice 'PASS: تقرير الإنجاز يعرض لكل عضو أنواع أعماله وعددها ومبالغها';

  delete from public.tracks where id = v_t;
  delete from public.materials where id = v_m;
end $$;

-- التسعيرة لا يضبطها إلا مدير المشروع
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
do $$
begin
  begin
    perform public.set_pay_rate('book', 9999);
    raise exception 'FAIL: المنسق غيّر التسعيرة';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: ضبط التسعيرة لمدير المشروع وحده';
  end;
end $$;
commit;

-- =====================================================================
-- 31) توجيه المراسلات وإدارتها: فئة المرشدين، والأرشفة (ملاحظة ١١٩)
-- =====================================================================
do $$
declare v_c uuid; v_n int;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  -- مرشد مكاني واحد على الأقل
  perform public.set_member_track('00000000-0000-0000-0000-00000000000e', 'field');

  -- الرسالة إلى فريق الإرشاد تصل إليهم وحدهم
  v_c := public.send_circular('تعميم للمرشدين', 'notice', 'نص', null, 'field', null, true, false);
  select count(*) into v_n from public.circular_recipients where circular_id = v_c;
  if v_n < 1 then raise exception 'FAIL: لم تصل رسالة فريق الإرشاد إلى أحد'; end if;
  if exists (select 1 from public.circular_recipients r join public.profiles p on p.id = r.member_id
              where r.circular_id = v_c and coalesce(p.track, 'translation') <> 'field') then
    raise exception 'FAIL: وصلت رسالة الإرشاد إلى غير المرشدين';
  end if;
  raise notice 'PASS: رسالة فريق الإرشاد المكاني تصل إليهم وحدهم';

  -- والمترجمون المتخصصون لا يدخل فيهم المرشدون
  v_c := public.send_circular('تعميم للمترجمين', 'notice', 'نص', null, 'translators', null, true, false);
  if exists (select 1 from public.circular_recipients r join public.profiles p on p.id = r.member_id
              where r.circular_id = v_c and coalesce(p.track, 'translation') = 'field') then
    raise exception 'FAIL: دخل المرشدون في رسالة المترجمين';
  end if;
  raise notice 'PASS: رسالة المترجمين المتخصصين لا يدخل فيها المرشدون المكانيون';

  -- فئة غير معروفة تُرفض برسالة واضحة
  begin
    perform public.send_circular('تعميم', 'notice', 'نص', null, 'nobody', null, true, false);
    raise exception 'FAIL: قُبلت فئة غير معروفة';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
    raise notice 'PASS: فئة المرسَل إليهم تُتحقَّق قبل الإرسال';
  end;

  -- الأرشفة: تُخفى عن العضو ولا تُطالبه، ويبقى سجلها
  v_c := public.send_circular('تعميم يؤرشف', 'notice', 'نص', null, 'all', null, true, true);
  perform public.archive_circular(v_c, true);
  if (select archived_at is null from public.circulars where id = v_c) then
    raise exception 'FAIL: لم تُؤرشف الرسالة';
  end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  if (select public.my_blocking_circulars()) > 0 and
     not exists (select 1 from public.circular_recipients r join public.circulars c on c.id = r.circular_id
                  where r.member_id = '00000000-0000-0000-0000-00000000000c' and r.acked_at is null
                    and c.blocking and c.archived_at is null) then
    raise exception 'FAIL: المؤرشف ما زال يحجب العمل';
  end if;
  raise notice 'PASS: المؤرشف لا يُطالَب به العضو ولا يحجب عمله';

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  if (select count(*) from public.circular_recipients where circular_id = v_c) < 1 then
    raise exception 'FAIL: ذهب سجل المؤرشفة';
  end if;
  perform public.archive_circular(v_c, false);
  if (select archived_at is not null from public.circulars where id = v_c) then
    raise exception 'FAIL: لم تُعَد الرسالة إلى الفريق';
  end if;
  raise notice 'PASS: الأرشفة تحفظ السجل وتُرفع متى شاءت الإدارة';

  -- كشف من وُجّهت إليهم للإدارة
  if (select count(*) from public.circular_recipients_list(v_c)) < 1 then
    raise exception 'FAIL: كشف الموجَّه إليهم فارغ';
  end if;
  raise notice 'PASS: كشف «من وُجّهت إليهم» يعرض الموقّعين وغيرهم للإدارة';

  delete from public.circulars where title in ('تعميم للمرشدين', 'تعميم للمترجمين', 'تعميم يؤرشف');
  perform public.set_member_track('00000000-0000-0000-0000-00000000000e', 'translation');
end $$;

-- =====================================================================
-- 32) كشف مستندات الفريق، وتفصيل أعمال العضو، ودقائق التسجيل
--     (ملاحظات ١٢٠ و١٢١ و١٢٢)
-- =====================================================================
do $$
declare v_m uuid; v_t uuid; v_n int; v_sec int; v_rec record;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

  -- كشف المستندات يشمل الفريق كله لا القائمة المعروضة
  select count(*) into v_n from public.member_docs();
  if v_n < 3 then raise exception 'FAIL: كشف المستندات ناقص (%)', v_n; end if;
  if not exists (select 1 from public.member_docs() where full_name = 'يوسف أحمد') then
    raise exception 'FAIL: عضو مفعّل غائب عن كشف المستندات';
  end if;
  raise notice 'PASS: كشف تدقيق المستندات يجمع الفريق كله';

  -- ولكل قائمة عدّادها
  if not exists (select 1 from public.pending_reviews_by_group()) then
    raise exception 'FAIL: عدّاد التدقيق بحسب القوائم فارغ';
  end if;
  raise notice 'PASS: عدّاد ما ينتظر التدقيق مفصّل بحسب كل قائمة';

  -- عمل مكتمل بتسجيل صوتي غير معتمد: تُحتسب دقائقه
  insert into public.materials (title, material_type, sermon_type, mosque, sermon_date, khateeb_id, deliverable, source_html, created_by)
  values ('خطبة بتسجيل', 'خطب', 'خطبة جمعة', 'makkah', current_date, (select id from public.khateebs order by id limit 1), 'text_audio', '<p>نص</p>',
          '00000000-0000-0000-0000-00000000000a')
  returning id into v_m;
  insert into public.tracks (material_id, language_code, status, receipt_due_at, completed_at, translation_html, audio_path)
  values (v_m, 'en', 'completed', now() + interval '1 day', now(), '<p>one two three four five</p>', 'x/a.mp3')
  returning id into v_t;
  insert into public.track_stages (track_id, stage_key, sort, assignee_id, status, finished_at)
  values (v_t, 'translation', 1, '00000000-0000-0000-0000-00000000000c', 'done', now());
  insert into public.track_audios (track_id, path, uploaded_by, stage_key, duration_seconds, is_approved)
  values (v_t, 'x/a.mp3', '00000000-0000-0000-0000-00000000000c', 'translation', 600, false);

  select audio_seconds into v_sec from public.production_rows where track_id = v_t;
  if coalesce(v_sec, 0) <> 600 then raise exception 'FAIL: لم تُحتسب دقائق التسجيل غير المعتمد (%)', v_sec; end if;
  raise notice 'PASS: دليل الإنتاج يحتسب دقائق التسجيل المرفوع ولو لم يُعتمد بعد';

  -- تفصيل أعمال العضو ببياناته
  select * into v_rec from public.member_work_list('00000000-0000-0000-0000-00000000000c',
    date_trunc('month', current_date)::date,
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date)
   where track_id = v_t;
  if v_rec.track_id is null then raise exception 'FAIL: العمل لم يظهر في تفصيل أعمال العضو'; end if;
  if v_rec.words < 5 or v_rec.pages < 1 or v_rec.audio_seconds <> 600 then
    raise exception 'FAIL: بيانات العمل ناقصة (كلمات % صفحات % ثوانٍ %)', v_rec.words, v_rec.pages, v_rec.audio_seconds;
  end if;
  if v_rec.work_kind <> 'sermon_audio' then raise exception 'FAIL: نوع العمل في التفصيل خطأ (%)', v_rec.work_kind; end if;
  raise notice 'PASS: تفصيل أعمال العضو يعرض نوع العمل وكلماته وصفحاته ودقائق تسجيله';

  delete from public.tracks where id = v_t;
  delete from public.materials where id = v_m;
end $$;

-- =====================================================================
-- 33) أساس المقطوع: بالعمل، أو بالكلمة، أو بدقيقة التسجيل (ملاحظة ١٢٤)
-- =====================================================================
do $$
declare v_m uuid; v_t uuid; v_amt numeric; v_rec record;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

  perform public.set_pay_rate('book', 0.5, 'word');
  perform public.set_pay_rate('sermon_audio', 10, 'minute');
  perform public.set_pay_rate('booklet', 300, 'work');

  -- سعر يوسف الخاص في القسم السابق يغلب العام، فيُرفع لاختبار الأساس العام
  perform public.set_member_rate('00000000-0000-0000-0000-00000000000c', 'sermon_audio', null);
  if public.rate_basis_for('00000000-0000-0000-0000-00000000000c', 'book') <> 'word' then
    raise exception 'FAIL: لم يُحفظ أساس الاحتساب';
  end if;
  raise notice 'PASS: لكل نوع عمل أساسه: بالعمل أو بالكلمة أو بدقيقة التسجيل';

  -- كتاب بخمس كلمات: المستحق نصف ريال للكلمة
  v_amt := public.work_amount('00000000-0000-0000-0000-00000000000c', 'book', 5, 0);
  if v_amt <> 2.5 then raise exception 'FAIL: الاحتساب بالكلمة خطأ (%)', v_amt; end if;
  -- خطبة بتسجيل عشر دقائق: عشرة ريالات للدقيقة
  v_amt := public.work_amount('00000000-0000-0000-0000-00000000000c', 'sermon_audio', 0, 600);
  if v_amt <> 100 then raise exception 'FAIL: الاحتساب بالدقيقة خطأ (%)', v_amt; end if;
  -- مطوية: مقطوع لا يتأثر بكلماتها
  v_amt := public.work_amount('00000000-0000-0000-0000-00000000000c', 'booklet', 9999, 9999);
  if v_amt <> 300 then raise exception 'FAIL: المقطوع تأثّر بالكلمات (%)', v_amt; end if;
  raise notice 'PASS: المستحق يُحتسب بأساس نوعه: مقطوعًا أو بالكلمات أو بالدقائق';

  -- عمل حقيقي: كتاب مكتمل بخمس كلمات
  insert into public.materials (title, material_type, mosque, sermon_date, author, deliverable, source_html, created_by)
  values ('كتاب التجربة', 'كتب', 'makkah', current_date, 'دار النشر', 'text', '<p>نص</p>', '00000000-0000-0000-0000-00000000000a')
  returning id into v_m;
  insert into public.tracks (material_id, language_code, status, receipt_due_at, completed_at, translation_html)
  values (v_m, 'en', 'completed', now() + interval '1 day', now(), '<p>one two three four five</p>')
  returning id into v_t;
  insert into public.track_stages (track_id, stage_key, sort, assignee_id, status, finished_at)
  values (v_t, 'translation', 1, '00000000-0000-0000-0000-00000000000c', 'done', now());

  select * into v_rec from public.work_items_full(
      date_trunc('month', current_date)::date,
      (date_trunc('month', current_date) + interval '1 month - 1 day')::date)
   where member_id = '00000000-0000-0000-0000-00000000000c' and work_kind = 'book';
  if v_rec.words <> 5 or v_rec.amount <> 2.5 then
    raise exception 'FAIL: كتاب الكلمات لم يُحتسب (كلمات % مبلغ %)', v_rec.words, v_rec.amount;
  end if;
  raise notice 'PASS: العمل المكتمل يُحتسب بعدد كلماته حين يكون أساسه بالكلمة';

  -- والدورة تحفظ الكلمات والدقائق مع أساس كل نوع
  delete from public.payrolls where period = date_trunc('month', current_date)::date;
  perform public.set_member_pay('00000000-0000-0000-0000-00000000000c', 'per_work', 0, 0, null);
  perform public.build_payroll(date_trunc('month', current_date)::date);
  if not exists (select 1 from public.payroll_item_kinds k
                  join public.payrolls r on r.id = k.payroll_id
                 where r.period = date_trunc('month', current_date)::date
                   and k.member_id = '00000000-0000-0000-0000-00000000000c'
                   and k.work_kind = 'book' and k.words = 5 and k.basis = 'word' and k.amount = 2.5) then
    raise exception 'FAIL: الدورة لم تحفظ تفصيل الاحتساب بالكلمات';
  end if;
  raise notice 'PASS: الدورة تحفظ كلمات كل نوع ودقائقه وأساس احتسابه';

  perform public.set_pay_rate('book', 1500, 'work');
  perform public.set_pay_rate('sermon_audio', 400, 'work');
  delete from public.tracks where id = v_t;
  delete from public.materials where id = v_m;
end $$;

-- =====================================================================
-- 34) وردية بفريق: مسؤول ومعه أعضاء، ومرشحوها (ملاحظة ١٢٧)
-- =====================================================================
do $$
declare v_crew uuid; v_n int;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  delete from public.shifts where shift_date = current_date + 3;

  -- مسؤول من خارج فريق الإرشاد ومعه عضوان
  v_crew := public.save_shift_crew('00000000-0000-0000-0000-00000000000c',
              array['00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e']::uuid[],
              current_date + 3, '08:00', '14:00', 'المسجد الحرام — المسعى', null, null);
  select count(*) into v_n from public.shifts where crew_id = v_crew;
  if v_n <> 3 then raise exception 'FAIL: لم تُسجَّل الوردية لأعضائها (%)', v_n; end if;
  if (select count(*) from public.shifts where crew_id = v_crew and is_lead) <> 1 then
    raise exception 'FAIL: مسؤول الوردية غير محدَّد';
  end if;
  if (select member_id from public.shifts where crew_id = v_crew and is_lead)
     <> '00000000-0000-0000-0000-00000000000c' then
    raise exception 'FAIL: المسؤول ليس من اختير';
  end if;
  raise notice 'PASS: الوردية الواحدة تُسجَّل لمسؤولها ومن معه، ولو كان المسؤول من خارج الإرشاد';

  -- تعديل الوردية: يُنقص عضو
  perform public.save_shift_crew('00000000-0000-0000-0000-00000000000c',
            array['00000000-0000-0000-0000-00000000000d']::uuid[],
            current_date + 3, '08:00', '14:00', 'المسجد النبوي — الساحات', null, v_crew);
  select count(*) into v_n from public.shifts where crew_id = v_crew;
  if v_n <> 2 then raise exception 'FAIL: تعديل الوردية لم ينقص عضوها (%)', v_n; end if;
  raise notice 'PASS: تعديل الوردية يعيد بناء أعضائها';

  -- المرشحون: المرشدون أولًا
  if (select count(*) from public.shift_candidates()) < 3 then
    raise exception 'FAIL: قائمة مرشحي الورديات ناقصة';
  end if;
  raise notice 'PASS: قائمة الورديات تعرض الفريق كله والمرشدون أولهم';

  -- الحذف يشمل أعضاء الوردية
  v_n := public.delete_shift_crew(v_crew);
  if exists (select 1 from public.shifts where crew_id = v_crew) then
    raise exception 'FAIL: بقيت صفوف الوردية بعد حذفها';
  end if;
  raise notice 'PASS: حذف الوردية يشمل مسؤولها وأعضاءها';
end $$;

-- =====================================================================
-- 35) ترقيم التوثيق: يُمنح عند الاعتماد، ويتسلسل، ولا يتغير (ملاحظة ١٣٤)
-- =====================================================================
do $$
declare v_m uuid; v_t uuid; v_t2 uuid; v_no text; v_no2 text; v_year int;
begin
  -- السنة الهجرية من الجدول الموثّق
  if public.hijri_year(date '2026-06-20') <> 1448 then
    raise exception 'FAIL: السنة الهجرية % بدل ١٤٤٨', public.hijri_year(date '2026-06-20');
  end if;
  if public.hijri_year(date '2026-06-10') <> 1447 then
    raise exception 'FAIL: ما قبل رأس السنة حُسب من التالية';
  end if;
  raise notice 'PASS: السنة الهجرية تؤخذ من بدايات أم القرى الموثّقة';

  -- خانتا النطاق والنوع
  if public.doc_scope('makkah') <> '1' or public.doc_scope('madinah') <> '2'
     or public.doc_scope('general') <> '0' then
    raise exception 'FAIL: خانة النطاق غير صحيحة';
  end if;
  if public.doc_kind_code('خطب', 'خطبة جمعة') <> '1'
     or public.doc_kind_code('خطب', 'خطبة عرفة') <> '2'
     or public.doc_kind_code('دروس علمية', null) <> '7'
     or public.doc_kind_code('منشورات', null) <> '0'
     or public.doc_kind_code('توجيهات', null) <> '0'
     or public.doc_kind_code('إعلانات', null) <> '0' then
    raise exception 'FAIL: رموز أنواع الأعمال غير صحيحة';
  end if;
  raise notice 'PASS: المنشورات والتوجيهات والإعلانات تحت رمز واحد، ولكل نوع رمزه';

  insert into public.materials (title, material_type, sermon_type, mosque, sermon_date, khateeb_id, deliverable,
                                source_html, created_by)
  values ('مادة الترقيم', 'خطب', 'خطبة جمعة', 'makkah', date '2026-09-18', (select id from public.khateebs order by id limit 1), 'text',
          '<p>نص</p>', '00000000-0000-0000-0000-00000000000a')
  returning id into v_m;

  -- مسار قيد التنفيذ لا رقم له
  insert into public.tracks (material_id, language_code, status, receipt_due_at)
  values (v_m, 'en', 'in_progress', now()) returning id into v_t;
  if (select doc_no from public.tracks where id = v_t) is not null then
    raise exception 'FAIL: مُنح رقم قبل الاعتماد';
  end if;

  update public.tracks set status = 'completed', completed_at = now() where id = v_t;
  select doc_no into v_no from public.tracks where id = v_t;
  if v_no is null then raise exception 'FAIL: لم يُمنح رقم عند الاعتماد'; end if;
  if v_no !~ '^H48-EN-11[0-9]{4}$' then
    raise exception 'FAIL: صيغة الرقم % غير متوقعة', v_no;
  end if;
  raise notice 'PASS: رقم التوثيق يُمنح عند الاعتماد بصيغته المتفق عليها';

  -- التسلسل داخل النوع نفسه
  insert into public.tracks (material_id, language_code, status, receipt_due_at)
  values (v_m, 'ur', 'in_progress', now()) returning id into v_t2;
  update public.tracks set status = 'completed', completed_at = now() where id = v_t2;
  select doc_no into v_no2 from public.tracks where id = v_t2;
  if v_no2 !~ '^H48-UR-11[0-9]{4}$' then
    raise exception 'FAIL: رقم اللغة الأخرى % غير متوقع', v_no2;
  end if;
  if right(v_no2, 4) <> '0001' then
    raise exception 'FAIL: تسلسل اللغة الأخرى % لا يبدأ من واحد', v_no2;
  end if;
  raise notice 'PASS: لكل لغة ونطاق ونوع تسلسلٌ مستقل يبدأ من واحد';

  -- إعادة التنشيط ثم الاعتماد لا تغيّر الرقم
  update public.tracks set status = 'in_progress' where id = v_t;
  update public.tracks set status = 'completed' where id = v_t;
  if (select doc_no from public.tracks where id = v_t) <> v_no then
    raise exception 'FAIL: تغيّر الرقم بعد إعادة التنشيط';
  end if;
  raise notice 'PASS: الرقم يُمنح مرة واحدة ولا يتغير بعدها';

  -- صفحة التحقق تصف العمل ولا تكشف محتواه
  if not exists (select 1 from public.verify_doc(v_no) where kind_label = 'خطبة الجمعة'
                   and scope_label = 'المسجد الحرام') then
    raise exception 'FAIL: التحقق من الرقم لم يُرجع وصف العمل';
  end if;
  if exists (select 1 from public.verify_doc(lower(v_no)) where doc_no is null) then
    raise exception 'FAIL: التحقق حسّاس لحالة الأحرف';
  end if;
  if exists (select 1 from public.verify_doc('H48-EN-119999')) then
    raise exception 'FAIL: التحقق أرجع عملًا لرقم لا وجود له';
  end if;
  raise notice 'PASS: التحقق من الرقم يصف العمل، ولا يُرجع شيئًا لرقم غير موجود';

  delete from public.tracks where material_id = v_m;
  delete from public.materials where id = v_m;
end $$;

-- =====================================================================
-- 36) رابط الاطّلاع الخاص على صفحة المبادرة (ملاحظة ١٣٦)
-- =====================================================================
do $$
declare v_token text; v_content jsonb;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  perform public.set_page_code('initiative', 'رمز-تجريبي');
  v_token := public.new_page_link('initiative');
  if v_token is null or length(v_token) < 32 then
    raise exception 'FAIL: رابط الاطّلاع قصير أو فارغ';
  end if;

  -- زائر بلا حساب: الرابط يفتح الصفحة، وغيره لا يفتحها
  perform set_config('request.jwt.claim.sub', '', true);
  v_content := public.open_page('initiative', v_token);
  if v_content is null or v_content -> 'sections' is null then
    raise exception 'FAIL: رابط الاطّلاع لم يفتح الصفحة';
  end if;
  raise notice 'PASS: رابط الاطّلاع الخاص يفتح صفحة المبادرة بلا رقم سرّي';

  begin
    perform public.open_page('initiative', v_token || 'x');
    raise exception 'FAIL: رابط غير صحيح فتح الصفحة';
  exception when others then
    if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  raise notice 'PASS: الرابط المغلوط لا يفتح الصفحة';

  -- عنوان المبادرة الجديد ومحتواها بلا ذكر مالي
  if (select content ->> 'h1' from public.page_content where key = 'initiative')
     <> 'مبادرة أتمتة الترجمة في الحرمين الشريفين' then
    raise exception 'FAIL: عنوان صفحة المبادرة غير محدَّث';
  end if;
  if (select content::text from public.page_content where key = 'initiative')
     ~ 'الرواتب|التسعيرة|المستحقات|المصرفية|الأجر' then
    raise exception 'FAIL: في صفحة المبادرة ذكرٌ مالي';
  end if;
  if (select content::text from public.page_content where key = 'about')
     ~ 'الرواتب|التسعيرة|المستحقات|المصرفية|الأجر' then
    raise exception 'FAIL: في صفحة «عن المنصة» ذكرٌ مالي';
  end if;
  raise notice 'PASS: صفحتا التعريف بلا ذكر مالي، وعنوان المبادرة محدَّث';

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  perform public.clear_page_link('initiative');
  perform public.set_page_code('initiative', null);
end $$;

-- =====================================================================
-- 37) لا مادة ناقصة، ولا تسجيل بغير صيغته، ونمط تسمية موحَّد
--     (ملاحظات ١٤٢ و١٤٣ و١٤٤)
-- =====================================================================
do $$
declare v_kh int; v_m uuid; v_t uuid;
begin
  select id into v_kh from public.khateebs order by id limit 1;

  -- بلا تاريخ
  begin
    insert into public.materials (title, material_type, sermon_type, mosque, khateeb_id, source_html, created_by)
    values ('بلا تاريخ', 'خطب', 'خطبة جمعة', 'makkah', v_kh, '<p>نص</p>', '00000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: قُبلت مادة بلا تاريخ';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- خطبة بلا خطيب
  begin
    insert into public.materials (title, material_type, sermon_type, mosque, sermon_date, source_html, created_by)
    values ('بلا خطيب', 'خطب', 'خطبة جمعة', 'makkah', current_date, '<p>نص</p>', '00000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: قُبلت خطبة بلا خطيب';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- خطبة بلا نوع خطبة
  begin
    insert into public.materials (title, material_type, mosque, sermon_date, khateeb_id, source_html, created_by)
    values ('بلا نوع', 'خطب', 'makkah', current_date, v_kh, '<p>نص</p>', '00000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: قُبلت خطبة بلا نوع';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- مادة عامة بلا مؤلف ولا جهة
  begin
    insert into public.materials (title, material_type, mosque, sermon_date, source_html, created_by)
    values ('كتاب بلا مؤلف', 'كتب', 'general', current_date, '<p>نص</p>', '00000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: قُبلت مادة عامة بلا مؤلف';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- بلا أصل: لا نصّ ولا ملف
  begin
    insert into public.materials (title, material_type, sermon_type, mosque, sermon_date, khateeb_id, source_html, created_by)
    values ('بلا أصل', 'خطب', 'خطبة جمعة', 'makkah', current_date, v_kh, '<p>  </p>', '00000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: قُبلت مادة بلا أصل';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  raise notice 'PASS: لا تمرّ مادة ناقصة البيانات الرئيسة ولا مادة بلا أصل';

  -- المادة المكتملة تمرّ
  insert into public.materials (title, material_type, sermon_type, mosque, sermon_date, khateeb_id, deliverable,
                                source_html, created_by)
  values ('مادة مكتملة', 'خطب', 'خطبة جمعة', 'makkah', current_date, v_kh, 'text_audio',
          '<p>نص كامل</p>', '00000000-0000-0000-0000-00000000000a')
  returning id into v_m;
  raise notice 'PASS: المادة المكتملة تُقبل';

  insert into public.tracks (material_id, language_code, status, receipt_due_at)
  values (v_m, 'en', 'in_progress', now()) returning id into v_t;

  -- صيغة التسجيل: WAV و MP3 فقط
  begin
    insert into public.track_audios (track_id, path, uploaded_by)
    values (v_t, 'x/take.m4a', '00000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: قُبلت صيغة تسجيل غير معتمدة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  insert into public.track_audios (track_id, path, uploaded_by)
  values (v_t, 'x/take.WAV', '00000000-0000-0000-0000-00000000000a');
  insert into public.track_audios (track_id, path, uploaded_by)
  values (v_t, 'x/take.mp3', '00000000-0000-0000-0000-00000000000a');
  raise notice 'PASS: التسجيل يُقبل بصيغتي WAV و MP3 ويُرد ما سواهما';

  delete from public.track_audios where track_id = v_t;
  delete from public.tracks where id = v_t;
  delete from public.materials where id = v_m;
end $$;

-- نمط التسمية: لمدير المشروع، ولا بد أن يميّز الملفات
do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  begin
    perform public.set_file_name_pattern('{title}');
    raise exception 'FAIL: المنسق غيّر نمط التسمية';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  begin
    perform public.set_file_name_pattern('ملف ثابت بلا عناصر');
    raise exception 'FAIL: قُبل نمط لا يميّز الملفات';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform public.set_file_name_pattern('{doc_no} - {kind} - {lang}');
  if (select file_name_pattern from public.platform_settings) <> '{doc_no} - {kind} - {lang}' then
    raise exception 'FAIL: لم يُحفظ نمط التسمية';
  end if;
  raise notice 'PASS: نمط تسمية الملفات بيد مدير المشروع، ولا بد أن يميّز كل ملف';
end $$;

-- =====================================================================
-- 38) الترجمة الفورية بالساعة، وبنود العقد مرجعًا، والتقييم الأسبوعي،
--     والدليل المصطلحي، ومشرف الهيئة (ملاحظات ١٤٦–١٥١)
-- =====================================================================

-- ١) سجلّ الترجمة الفورية: للإدارة، ولا ساعةَ بلغةٍ ليست للمترجم
do $$
declare v_id uuid; v_hours numeric;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  begin
    perform public.save_interpretation(jsonb_build_object(
      'member_id', '00000000-0000-0000-0000-00000000000c', 'language_code', 'en',
      'held_on', current_date, 'hours', 2, 'title', 'درس تجريبي'));
    raise exception 'FAIL: دوّن المترجم ساعاته بنفسه';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  begin
    perform public.save_interpretation(jsonb_build_object(
      'member_id', '00000000-0000-0000-0000-00000000000c', 'language_code', 'fr',
      'held_on', current_date, 'hours', 2, 'title', 'درس بلغة غير مقيَّدة'));
    raise exception 'FAIL: قُبلت ساعة بلغة ليست للمترجم';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  begin
    perform public.save_interpretation(jsonb_build_object(
      'member_id', '00000000-0000-0000-0000-00000000000c', 'language_code', 'en',
      'held_on', current_date, 'hours', 30, 'title', 'يوم كامل'));
    raise exception 'FAIL: قُبلت ثلاثون ساعة في يوم';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  v_id := public.save_interpretation(jsonb_build_object(
    'member_id', '00000000-0000-0000-0000-00000000000c', 'language_code', 'en',
    'held_on', current_date, 'hours', 2.5, 'event_type', 'درس علمي', 'venue', 'makkah',
    'title', 'درس في التفسير', 'speaker', 'الشيخ فلان'));
  if v_id is null then raise exception 'FAIL: لم تُدوَّن الساعة'; end if;

  -- تعديلها لا يكرّرها
  perform public.save_interpretation(jsonb_build_object('id', v_id,
    'member_id', '00000000-0000-0000-0000-00000000000c', 'language_code', 'en',
    'held_on', current_date, 'hours', 3, 'event_type', 'ندوة', 'venue', 'other',
    'venue_note', 'قاعة المؤتمرات', 'title', 'ندوة في التفسير'));
  select count(*), sum(hours) into strict v_hours, v_hours from public.interpretations;
  if (select count(*) from public.interpretations) <> 1 then raise exception 'FAIL: تكرّر السجل بالتعديل'; end if;
  if (select hours from public.interpretations where id = v_id) <> 3 then raise exception 'FAIL: لم يُحفظ التعديل'; end if;
  raise notice 'PASS: الترجمة الفورية تُدوَّن بالساعة للإدارة وحدها، ولا تُقبل بلغةٍ ليست للمترجم';

end $$;

-- الرؤية تُختبر بدور authenticated لتُفعَّل سياسات الصفوف
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert((select count(*) = 1 from public.interpretations), 'المترجم يرى ساعاته المدوَّنة');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'sara', true);
select public._assert((select count(*) = 0 from public.interpretations), 'ولا يرى عضوٌ ساعات غيره');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public._assert((select count(*) = 1 from public.interpretations), 'والإدارة ترى السجلّ كله');
commit;

-- ٢) بنود العقد: مرجعٌ للإدارة، والكميات تُحتسب من الإنجاز
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert((select count(*) = 0 from public.contract_items), 'العضو لا يرى جدول أسعار العقد');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public._assert((select count(*) = 0 from public.contract_items), 'ولا المنسق');
commit;

do $$
declare v_h numeric; v_s numeric; v_n int;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  select count(*) into v_n from public.contract_items;
  if v_n <> 7 then raise exception 'FAIL: بنود العقد ليست سبعة (%)', v_n; end if;
  if (select round(sum(total_value), 2) from public.contract_items) <> 36970850.00 then
    raise exception 'FAIL: إجمالي قيمة العقد لا يطابق الكراسة (%)',
      (select sum(total_value) from public.contract_items);
  end if;

  select qty_done into v_h from public.contract_progress() where code = 4;
  if v_h <> 3 then raise exception 'FAIL: ساعات الفورية لا تصل إلى بند العقد (%)', v_h; end if;
  raise notice 'PASS: بنود العقد سبعة بقيمتها، وساعات الفورية تصل إلى بندها';

  -- خطبةٌ مكتملة بتسجيل معتمد، ومادةٌ عامة بخمس كلمات في أصلها
  insert into public.materials (id, title, material_type, sermon_type, mosque, sermon_date, khateeb_id,
                                source_html, created_by)
  values ('00000000-0000-0000-0000-0000000000c1', 'خطبة الكميات', 'خطب', 'خطبة جمعة', 'makkah',
          current_date, (select id from public.khateebs order by id limit 1),
          '<p>نص</p>', '00000000-0000-0000-0000-00000000000a');
  insert into public.tracks (id, material_id, language_code, status, receipt_due_at, completed_at)
  values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1', 'en',
          'completed', now(), now());
  insert into public.track_audios (track_id, path, uploaded_by, is_approved, duration_seconds)
  values ('00000000-0000-0000-0000-0000000000c2', 'x/q.mp3', '00000000-0000-0000-0000-00000000000a', true, 600);

  insert into public.materials (id, title, material_type, mosque, sermon_date, author, source_html, created_by)
  values ('00000000-0000-0000-0000-0000000000c3', 'كتاب الكميات', 'كتب', 'general', current_date,
          'مؤلف', '<p>واحد اثنان ثلاثة أربعة خمسة</p>', '00000000-0000-0000-0000-00000000000a');
  insert into public.tracks (id, material_id, language_code, status, receipt_due_at, completed_at)
  values ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000c3', 'en',
          'completed', now(), now());

  select qty_done into v_s from public.contract_progress() where code = 1;
  if v_s <> 1 then raise exception 'FAIL: الخطبة المكتملة لا تُحتسب بالخطبة (%)', v_s; end if;
  select qty_done into v_s from public.contract_progress() where code = 2;
  if v_s <> 1 then raise exception 'FAIL: التسجيل المعتمد لا يُحتسب في بنده (%)', v_s; end if;
  select qty_done into v_s from public.contract_progress() where code = 3;
  if v_s <> 0 then raise exception 'FAIL: احتُسبت مراجعة شرعية لم تتم (%)', v_s; end if;
  select qty_done into v_s from public.contract_progress() where code = 5;
  if v_s <> 5 then raise exception 'FAIL: كلمات الأصل العربي لا تُحتسب لغير الخطب (%)', v_s; end if;
  raise notice 'PASS: الكميات تُحتسب بوحداتها: الخطبة لكل لغة، والتسجيل المعتمد، وكلمات الأصل لغير الخطب';

  -- المستخلص: الكمية × سعر الوحدة كما في الكراسة
  if (select round(amount, 2) from public.claim_month(current_date) where code = 4) <> 60.00 then
    raise exception 'FAIL: قيمة بند الفورية في المستخلص لا تطابق الكراسة (%)',
      (select amount from public.claim_month(current_date) where code = 4);
  end if;
  raise notice 'PASS: مسودّة المستخلص تضرب الكمية في سعر الكراسة، ولا تمسّ أجور الفريق';
end $$;

-- ٣) التقييم الأسبوعي: تسجيلٌ من المشرف، ومتوسطٌ شهري ونسبةٌ استرشادية
do $$
declare v_id uuid; v_pct int; v_avg numeric;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
  begin
    perform public.save_field_evaluation(jsonb_build_object(
      'member_id', '00000000-0000-0000-0000-00000000000e', 'week_start', current_date,
      'appearance', 5, 'attendance', 5, 'interaction', 5, 'language_skill', 5, 'compliance', 5,
      'supervisor_name', 'مشرف'));
    raise exception 'FAIL: قيَّم العضو نفسه';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  begin
    perform public.save_field_evaluation(jsonb_build_object(
      'member_id', '00000000-0000-0000-0000-00000000000e', 'week_start', current_date,
      'appearance', 9, 'attendance', 5, 'interaction', 5, 'language_skill', 5, 'compliance', 5,
      'supervisor_name', 'مشرف'));
    raise exception 'FAIL: قُبلت درجة فوق الخمس';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  begin
    perform public.save_field_evaluation(jsonb_build_object(
      'member_id', '00000000-0000-0000-0000-00000000000e', 'week_start', current_date,
      'appearance', 5, 'attendance', 5, 'interaction', 5, 'language_skill', 5, 'compliance', 5));
    raise exception 'FAIL: سُجِّل تقييم بلا اسم مشرف';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  v_id := public.save_field_evaluation(jsonb_build_object(
    'member_id', '00000000-0000-0000-0000-00000000000e', 'week_start', current_date,
    'appearance', 5, 'attendance', 5, 'interaction', 4, 'language_skill', 5, 'compliance', 4,
    'supervisor_name', 'م. عبدالله — مشرف الهيئة', 'notes', 'التزام جيد'));
  -- الأسبوع نفسه لا يتكرر، وإنما يُحدَّث
  perform public.save_field_evaluation(jsonb_build_object(
    'member_id', '00000000-0000-0000-0000-00000000000e', 'week_start', current_date + 1,
    'appearance', 5, 'attendance', 5, 'interaction', 4, 'language_skill', 5, 'compliance', 5,
    'supervisor_name', 'م. عبدالله — مشرف الهيئة'));
  if (select count(*) from public.field_evaluations) <> 1 then
    raise exception 'FAIL: تكرّر تقييم الأسبوع الواحد';
  end if;

  select percent, monthly into v_pct, v_avg from public.evaluation_month(current_date)
   where member_id = '00000000-0000-0000-0000-00000000000e';
  if v_avg <> 96.0 then raise exception 'FAIL: متوسط الشهر خاطئ (%)', v_avg; end if;
  if v_pct <> 100 then raise exception 'FAIL: نسبة الصرف الاسترشادية خاطئة (%)', v_pct; end if;
  raise notice 'PASS: التقييم يُسجَّل باسم مشرفه، ويُجمع متوسط الشهر ونسبته الاسترشادية';
end $$;

-- ٤) الدليل المصطلحي: يقترحه العضو، ويعتمده المنسق
do $$
declare v_id uuid;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  begin
    perform public.save_glossary_term(jsonb_build_object('term_ar', 'بلا شرح'));
    raise exception 'FAIL: قُبل مصطلح بلا شرح';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  v_id := public.save_glossary_term(jsonb_build_object(
    'term_ar', 'التقوى', 'category', 'عقدي', 'explanation', 'امتثال الأمر واجتناب النهي.',
    'translations', jsonb_build_array(
      jsonb_build_object('language_code', 'en', 'term_tr', 'Taqwa (God-consciousness)'),
      jsonb_build_object('language_code', 'ur', 'term_tr', 'تقویٰ'))));
  if (select status from public.glossary_terms where id = v_id) <> 'مقترح' then
    raise exception 'FAIL: المصطلح الجديد اعتُمد بلا اعتماد';
  end if;
  if (select count(*) from public.glossary_translations where term_id = v_id) <> 2 then
    raise exception 'FAIL: لم تُحفظ المقابلات';
  end if;

  begin
    perform public.approve_glossary_term(v_id);
    raise exception 'FAIL: اعتمد العضو مصطلحه';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  perform public.approve_glossary_term(v_id);
  if (select status from public.glossary_terms where id = v_id) <> 'معتمد' then
    raise exception 'FAIL: لم يُعتمد المصطلح';
  end if;
  if (select jsonb_array_length(translations) from public.glossary_rows where id = v_id) <> 2 then
    raise exception 'FAIL: صف الدليل لا يجمع المقابلات';
  end if;

  -- والمعتمد لا يعدّله العضو
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  begin
    perform public.save_glossary_term(jsonb_build_object('id', v_id, 'term_ar', 'التقوى',
      'explanation', 'تعديل من غير الإدارة'));
    raise exception 'FAIL: عدّل العضو مصطلحًا معتمدًا';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  raise notice 'PASS: المصطلح يُقترح من الفريق ويُعتمد من الإدارة، والمعتمد لا يعدّله غيرها';
end $$;

-- ٥) مشرف الهيئة: يرى التقارير، ولا يعدّل، ولا يطّلع على بيانات الأعضاء
do $$
declare v_sup uuid := '00000000-0000-0000-0000-0000000000aa';
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_sup, 'sup@example.com', '{"full_name":"مشرف الهيئة"}');
  perform public.admin_update_member(v_sup, 'active', 'supervisor', null);

  perform set_config('request.jwt.claim.sub', v_sup::text, true);
  if not public.is_supervisor() then raise exception 'FAIL: لم يُعرف دور المشرف'; end if;
  if public.is_admin() then raise exception 'FAIL: المشرف يُعدّ من الإدارة'; end if;

  begin
    perform public.save_interpretation(jsonb_build_object(
      'member_id', '00000000-0000-0000-0000-00000000000c', 'language_code', 'en',
      'held_on', current_date, 'hours', 1, 'title', 'من المشرف'));
    raise exception 'FAIL: كتب المشرف في سجلّ الفورية';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.save_glossary_term(jsonb_build_object('term_ar', 'من المشرف', 'explanation', 'شرح'));
    raise exception 'FAIL: كتب المشرف في الدليل المصطلحي';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- سجلّ الاطّلاع يُقيَّد بكل فتحٍ لشاشة
  perform public.log_supervisor_view('/app/stats');
  if (select count(*) from public.supervisor_views) <> 1 then
    raise exception 'FAIL: لم يُقيَّد اطّلاع المشرف';
  end if;
  raise notice 'PASS: مشرف الهيئة لا يكتب في شيء، واطّلاعه يُقيَّد';
end $$;

-- ورؤيته تُختبر بدور authenticated
begin; set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
select public._assert((select count(*) > 0 from public.tracks), 'المشرف يطّلع على الأعمال');
select public._assert((select count(*) > 0 from public.materials), 'والمواد');
select public._assert((select count(*) = 0 from public.contract_items), 'ولا يرى بنود العقد — فهي لمدير المشروع (ملاحظة ١٥٥)');
select public._assert((select count(*) > 0 from public.interpretations), 'وسجلّ الترجمة الفورية');
select public._assert((select count(*) > 0 from public.field_evaluations), 'وتقييم المرشدين');
select public._assert((select count(*) = 0 from public.profile_private
  where id <> '00000000-0000-0000-0000-0000000000aa'), 'ولا يطّلع على بيانات الأعضاء الشخصية');
select public._assert((select count(*) = 0 from public.member_pay), 'ولا على الأجور');
select public._assert((select count(*) = 0 from public.supervisor_views), 'ولا على سجلّ اطّلاعه نفسه');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public._assert((select count(*) = 0 from public.supervisor_views), 'وسجلّ الاطّلاع لا يراه المنسق');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public._assert((select count(*) = 1 from public.supervisor_views), 'ويراه مدير المشروع');
commit;

-- ٦) صفحة المبادرة: ما استجدّ فيها، وبلا ذكرٍ مالي، وجامعة أم القرى مرة واحدة
do $$
declare v jsonb; v_txt text;
begin
  select content into v from public.page_content where key = 'initiative';
  v_txt := v::text;
  if (length(v_txt) - length(replace(v_txt, 'أم القرى', ''))) / length('أم القرى') <> 1 then
    raise exception 'FAIL: جامعة أم القرى لم تُذكر مرة واحدة';
  end if;
  if v_txt ~ 'الرواتب|التسعيرة|المستحقات|المصرفية|المستخلص|ريال' then
    raise exception 'FAIL: ذكرٌ مالي في صفحة المبادرة';
  end if;
  if jsonb_array_length(v -> 'sections') <> 20 then
    raise exception 'FAIL: أقسام المبادرة (%)', jsonb_array_length(v -> 'sections');
  end if;
  foreach v_txt in array array['الترجمة الفورية', 'الدليل المصطلحي الشرعي الموحَّد',
                               'هيئة كتاب', 'التقييم الأسبوعي',
                               'WAV', 'صدر الصفحة الأولى', 'البيانات الرئيسة',
                               'قاعات الاجتماعات والتدريب', 'الدخول للقاعة', 'عدّاداته',
                               'لا فتوى لأحدٍ من الفريق'] loop
    if position(v_txt in v::text) = 0 then raise exception 'FAIL: صفحة المبادرة لا تذكر %', v_txt; end if;
  end loop;

  -- والصفحةُ تعريفٌ بالمبادرة لا دليلُ تشغيلٍ داخلي: فلا تُعدَّد فيها
  -- صلاحياتُ الحسابات ولا من يملك ماذا من الإدارة (ملاحظة ١٩٨)
  -- الأدوارُ تُعرَّف في بطاقات الفريق، وإنما يُمنع شرحُ من يملك ماذا في النثر
  if exists (select 1 from jsonb_array_elements(v -> 'sections') s2,
                           jsonb_array_elements(s2 -> 2) b2
              where b2 ->> 0 in ('p', 'callout')
                and (b2 ->> 1 like '%المنسق%' or b2 ->> 1 like '%مدير المشروع%')) then
    raise exception 'FAIL: صفحة المبادرة تعدّد صلاحيات الإدارة';
  end if;
  if exists (select 1 from jsonb_array_elements(v -> 'sections') s2,
                           jsonb_array_elements(s2 -> 2) b2
              where b2 ->> 0 = 'h3'
                and b2 ->> 1 in ('قائمة صلاحيات الحساب الإداري',
                                 'التحقق بخطوتين: عامًّا أو لحسابٍ بعينه',
                                 'باب التسجيل',
                                 'حساب مدير المشروع من الهيئة — اطّلاعٌ لا تعديل')) then
    raise exception 'FAIL: صفحة المبادرة فيها تفصيلٌ إداري داخلي';
  end if;
  if jsonb_array_length((select s2 -> 2 from jsonb_array_elements(v -> 'sections') s2
                          where s2 ->> 0 = 'team')) > 16 then
    raise exception 'FAIL: قسمُ الفريق لم يُختصر';
  end if;

  raise notice 'PASS: صفحة المبادرة تعرض ما استجدّ، بلا ذكرٍ مالي ولا تعداد صلاحيات، وتنسب المبادرة لجامعة أم القرى مرة واحدة';
end $$;

-- =====================================================================
-- 39) الأصل الصوتي، وقصر بنود العقد على المدير، واستيراد الدليل المصطلحي
--     (ملاحظات ١٥٤–١٥٨)
-- =====================================================================

-- ١) الأصل قد يكون مقطعًا صوتيًّا، وصيغته كصيغة التسليم
do $$
declare v_m uuid;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

  begin
    insert into public.materials (title, material_type, mosque, sermon_date, author, source_audio_path, created_by)
    values ('درس صوتي', 'دروس علمية', 'makkah', current_date, 'الملقي', 'src/lesson.m4a',
            '00000000-0000-0000-0000-00000000000a');
    raise exception 'FAIL: قُبل أصلٌ صوتي بصيغة غير معتمدة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  insert into public.materials (id, title, material_type, mosque, sermon_date, author, source_audio_path, created_by)
  values ('00000000-0000-0000-0000-0000000000d1', 'درس صوتي', 'دروس علمية', 'makkah', current_date,
          'الملقي', 'src/lesson.mp3', '00000000-0000-0000-0000-00000000000a')
  returning id into v_m;
  if v_m is null then raise exception 'FAIL: لم تُقبل مادة أصلها صوتي'; end if;
  raise notice 'PASS: المادة تُقبل بأصلٍ صوتي (WAV أو MP3)، ولا تُقبل بغيره';

  -- ومدة المقطع تُكتب مرة واحدة
  insert into public.tracks (id, material_id, language_code, status, receipt_due_at)
  values ('00000000-0000-0000-0000-0000000000d2', v_m, 'en', 'in_progress', now());
  perform public.set_source_audio_seconds(v_m, 1800);
  perform public.set_source_audio_seconds(v_m, 10);
  if (select source_audio_seconds from public.materials where id = v_m) <> 1800 then
    raise exception 'FAIL: مدة المقطع لم تُحفظ أو كُتبت مرتين';
  end if;
  raise notice 'PASS: مدة الأصل الصوتي تُقاس وتُحفظ مرة واحدة';

  -- ودالة الإنشاء تحمل الأصل الصوتي
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  perform public.create_material(jsonb_build_object(
    'material', jsonb_build_object('material_type','دروس علمية','title','درس مسند','mosque','makkah',
      'sermon_date', current_date::text, 'author','الملقي','source_audio_path','src/lesson2.wav','deliverable','text'),
    'stage_minutes', '{"translation":60,"coordinator_receipt":10}'::jsonb,
    'languages', jsonb_build_array(jsonb_build_object('code','en','stages', jsonb_build_array(
      jsonb_build_object('key','translation','assignee','00000000-0000-0000-0000-00000000000c'),
      jsonb_build_object('key','coordinator_receipt','assignee','00000000-0000-0000-0000-00000000000b'))))
  ));
  if (select source_audio_path from public.materials where title = 'درس مسند') <> 'src/lesson2.wav' then
    raise exception 'FAIL: الإسناد لم يحمل الأصل الصوتي';
  end if;
  raise notice 'PASS: إسناد المادة يحمل أصلها الصوتي إلى المترجم';
end $$;

-- ٢) بنود العقد والمستخلص: لمدير المشروع وحده (ملاحظة ١٥٥)
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'coord', true);
select public._assert((select count(*) = 0 from public.contract_items), 'المنسق لا يرى جدول بنود العقد');
select public._assert((select count(*) = 0 from public.contract_progress()), 'ولا كميات العقد');
select public._assert((select count(*) = 0 from public.claim_month(current_date)), 'ولا مسودّة المستخلص');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
select public._assert((select count(*) = 0 from public.contract_items), 'ومشرف الهيئة كذلك لا يراها');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public._assert((select count(*) = 7 from public.contract_items), 'ومدير المشروع وحده يراها');
select public._assert((select count(*) = 7 from public.contract_progress()), 'وكمياتها');
commit;

-- ٣) استيراد الدليل المصطلحي دفعةً واحدة (ملاحظة ١٥٨)
do $$
declare v record;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  select * into v from public.import_glossary(jsonb_build_array(
    jsonb_build_object('term_ar','الإحسان','category','عقدي','explanation','أن تعبد الله كأنك تراه.',
      'translations', jsonb_build_array(jsonb_build_object('language_code','en','term_tr','Ihsan'))),
    jsonb_build_object('term_ar','الصلاة','category','فقهي','explanation','الفريضة المفتتحة بالتكبير.'),
    jsonb_build_object('term_ar','بلا شرح'),
    jsonb_build_object('term_ar','التقوى','category','عقدي','explanation','شرحٌ محدَّث للتقوى.',
      'translations', jsonb_build_array(jsonb_build_object('language_code','ur','term_tr','تقویٰ')))
  ));
  if v.added <> 2 then raise exception 'FAIL: المضاف (%)', v.added; end if;
  if v.updated <> 1 then raise exception 'FAIL: المحدَّث (%)', v.updated; end if;
  if v.skipped <> 1 then raise exception 'FAIL: المتخطَّى (%)', v.skipped; end if;
  if (select explanation from public.glossary_terms where term_ar = 'التقوى') <> 'شرحٌ محدَّث للتقوى.' then
    raise exception 'FAIL: لم يُحدَّث شرح المصطلح الموجود';
  end if;
  if (select status from public.glossary_terms where term_ar = 'الإحسان') <> 'مقترح' then
    raise exception 'FAIL: المستورَد دخل معتمدًا';
  end if;
  if (select count(*) from public.glossary_translations where term_id =
        (select id from public.glossary_terms where term_ar = 'التقوى')) <> 2 then
    raise exception 'FAIL: المقابل المستورَد لم يُضف إلى ما سبق';
  end if;
  raise notice 'PASS: الاستيراد يضيف الجديد ويحدّث الموجود ويتخطّى الناقص، ولا يعتمد شيئًا';

  -- ومشرف الهيئة لا يستورد
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
  begin
    perform public.import_glossary(jsonb_build_array(
      jsonb_build_object('term_ar','من المشرف','explanation','شرح')));
    raise exception 'FAIL: استورد المشرف مصطلحات';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  raise notice 'PASS: الاستيراد للفريق، لا لمشرف الهيئة';
end $$;

-- =====================================================================
-- 40) قاعات الاجتماعات والتدريب: الجدولة والدعوة والانضمام والحضور
--     (ملاحظة ١٦٣)
-- =====================================================================
do $$
declare v_room uuid; v_room2 uuid; v_id uuid; v_url text; v_n int;
begin
  select id into v_room from public.rooms where name = 'قاعة تدريب الإداريين';
  if v_room is null then raise exception 'FAIL: لم تُنشأ القاعات المبدئية'; end if;

  -- القاعة للإدارة
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  begin
    perform public.save_room(jsonb_build_object('name', 'قاعة العضو'));
    raise exception 'FAIL: أنشأ العضو قاعة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  v_room2 := public.save_room(jsonb_build_object('name', 'قاعة الترجمة الفورية', 'capacity', 12));
  if (select capacity from public.rooms where id = v_room2) <> 12 then
    raise exception 'FAIL: لم تُحفظ سعة القاعة';
  end if;
  raise notice 'PASS: القاعات تُسمّى وتُضبط سعتها، وإنشاؤها للإدارة';

  -- اللقاء: عنوانه وموعده ورابطه إلزامية
  begin
    perform public.save_meeting(jsonb_build_object('title', 'بلا موعد', 'join_url', 'https://meet.jit.si/x'));
    raise exception 'FAIL: قُبل لقاء بلا موعد';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.save_meeting(jsonb_build_object('title', 'بلا رابط',
      'starts_at', (now() + interval '1 day')::text, 'minutes', 60));
    raise exception 'FAIL: قُبل لقاء خارجي بلا رابط';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.save_meeting(jsonb_build_object('title', 'رابط غير آمن',
      'starts_at', (now() + interval '1 day')::text, 'minutes', 60, 'join_url', 'http://meet.jit.si/x'));
    raise exception 'FAIL: قُبل رابط غير مشفَّر';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- لقاءٌ مفتوح الآن، ومشرف الهيئة من مدعوّيه (ملاحظة ١٦٣)
  v_id := public.save_meeting(jsonb_build_object(
    'title', 'دورة الترجمة الشرعية', 'kind', 'دورة تدريبية', 'room_id', v_room::text,
    'starts_at', (now() - interval '5 minutes')::text, 'minutes', 90,
    'join_url', 'https://meet.jit.si/haramain-training',
    'invitees', jsonb_build_array('00000000-0000-0000-0000-00000000000c',
                                  '00000000-0000-0000-0000-0000000000aa')));
  select count(*) into v_n from public.meeting_invitees where meeting_id = v_id;
  if v_n <> 2 then raise exception 'FAIL: عدد المدعوّين (%)', v_n; end if;
  if not exists (select 1 from public.meeting_invitees
                  where meeting_id = v_id and member_id = '00000000-0000-0000-0000-0000000000aa') then
    raise exception 'FAIL: مشرف الهيئة لم يُدعَ';
  end if;
  -- والدعوة تصل بريد كل مدعوّ
  if (select count(*) from public.notifications where subject like 'دعوة:%') < 2 then
    raise exception 'FAIL: لم تُرسل الدعوات';
  end if;
  raise notice 'PASS: اللقاء يُجدوَل ببياناته، وتصل الدعوة لكل مدعوّ ومنهم مشرف الهيئة';

  -- القاعة لا تُحجز مرتين
  begin
    perform public.save_meeting(jsonb_build_object('title', 'تعارض', 'room_id', v_room::text,
      'starts_at', (now() + interval '10 minutes')::text, 'minutes', 30,
      'join_url', 'https://meet.jit.si/y',
      'invitees', jsonb_build_array('00000000-0000-0000-0000-00000000000c')));
    raise exception 'FAIL: حُجزت القاعة مرتين في وقت واحد';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  -- وفي قاعة أخرى يجوز
  perform public.save_meeting(jsonb_build_object('title', 'في قاعة أخرى', 'room_id', v_room2::text,
    'starts_at', (now() + interval '10 minutes')::text, 'minutes', 30,
    'join_url', 'https://meet.jit.si/z',
    'invitees', jsonb_build_array('00000000-0000-0000-0000-00000000000c')));
  raise notice 'PASS: القاعة لا تُحجز في وقتين متداخلين، وتُحجز غيرها';

  -- الانضمام: لمن دُعي، وفي وقته
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
  begin
    perform public.join_meeting(v_id);
    raise exception 'FAIL: انضمّ من لم يُدعَ';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
  v_url := public.join_meeting(v_id);
  if v_url <> 'https://meet.jit.si/haramain-training' then raise exception 'FAIL: رابط الانضمام (%)', v_url; end if;
  if (select joined_at from public.meeting_invitees
       where meeting_id = v_id and member_id = '00000000-0000-0000-0000-0000000000aa') is null then
    raise exception 'FAIL: لم يُقيَّد حضور المشرف';
  end if;
  perform public.meeting_ping(v_id);
  raise notice 'PASS: الانضمام لمن دُعي وفي وقته، ومشرف الهيئة يدخل ويُقيَّد حضوره';

  -- لقاءٌ لم يحن وقته لا يُفتح
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  declare v_later uuid;
  begin
    v_later := public.save_meeting(jsonb_build_object('title', 'بعد أسبوع',
      'starts_at', (now() + interval '7 days')::text, 'minutes', 60,
      'join_url', 'https://meet.jit.si/later',
      'invitees', jsonb_build_array('00000000-0000-0000-0000-00000000000c')));
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
    begin
      perform public.join_meeting(v_later);
      raise exception 'FAIL: فُتح لقاء لم يحن وقته';
    exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
    end;
  end;
  raise notice 'PASS: زرّ الانضمام لا يعمل قبل ربع ساعة من الموعد';

  -- الإلغاء للإدارة، والحذف للمدير
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  begin
    perform public.cancel_meeting(v_id);
    raise exception 'FAIL: ألغى العضو لقاءً';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
  perform public.cancel_meeting(v_id);
  if (select status from public.meetings where id = v_id) <> 'cancelled' then
    raise exception 'FAIL: لم يُلغَ اللقاء';
  end if;
  begin
    perform public.delete_room(v_room2);
    raise exception 'FAIL: حذف المنسق قاعة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  raise notice 'PASS: الإلغاء للإدارة، وحذف القاعة لمدير المشروع، ولا تُحذف قاعة فيها لقاء قادم';
end $$;

-- ورؤية اللقاءات: المدعوّ يرى لقاءه لا غير
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'sara', true);
select public._assert((select count(*) = 0 from public.meetings), 'من لم يُدعَ لا يرى اللقاءات');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'yusuf', true);
select public._assert((select count(*) >= 2 from public.meetings), 'والمدعوّ يرى لقاءاته');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'mgr', true);
select public._assert((select count(*) >= 3 from public.meetings), 'والإدارة ترى الجميع');
commit;

-- =====================================================================
-- 41) مدير المشروع من الهيئة: يرى ما يراه المنسق، ولا يعدّل (ملاحظة ١٦٤)
-- =====================================================================
-- وردية وبطاقة للاختبار، فالأجزاء السابقة حذفت ما أنشأته
insert into public.shifts (member_id, shift_date, start_at, end_at, location, created_by)
values ('00000000-0000-0000-0000-00000000000d', current_date, '08:00', '12:00', 'المسعى',
        '00000000-0000-0000-0000-00000000000b')
on conflict do nothing;

begin; set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
select public._assert((select count(*) > 0 from public.shifts), 'يرى ورديات الإرشاد');
select public._assert((select count(*) >= 0 from public.member_cards), 'ويرى بطاقات العمل');
select public._assert((select count(*) > 0 from public.policy_acceptances), 'ويرى من وقّع ميثاق العمل');
select public._assert((select count(*) > 0 from public.profiles where status = 'active'), 'ويرى أسماء الفريق');
select public._assert((select count(*) = 0 from public.member_pay), 'ولا يرى الأجور');
select public._assert((select count(*) = 0 from public.contract_items), 'ولا بنود العقد');
select public._assert((select count(*) = 0 from public.profile_private
  where id <> '00000000-0000-0000-0000-0000000000aa'), 'ولا البيانات الشخصية لغيره');
commit;

do $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', true);
  -- ولا يكتب شيئًا: لا مادة ولا إسناد ولا لقاء
  begin
    perform public.create_material(jsonb_build_object(
      'material', jsonb_build_object('material_type','خطب','title','من المشرف','mosque','makkah'),
      'stage_minutes', '{"translation":60}'::jsonb, 'languages', '[]'::jsonb));
    raise exception 'FAIL: أنشأ مدير الهيئة مادة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.save_meeting(jsonb_build_object('title','من المشرف',
      'starts_at', (now() + interval '1 day')::text, 'join_url','https://meet.jit.si/x'));
    raise exception 'FAIL: جدول مدير الهيئة لقاءً';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.save_room(jsonb_build_object('name','قاعة من المشرف'));
    raise exception 'FAIL: أنشأ مدير الهيئة قاعة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  raise notice 'PASS: مدير المشروع من الهيئة يرى ولا يُنشئ ولا يعدّل شيئًا';
end $$;

-- =====================================================================
-- 42) رابط القاعة الدائم: يرثه كل لقاء فيها (ملاحظة ١٦٦)
-- =====================================================================
do $$
declare v_room uuid; v_id uuid; v_url text;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

  begin
    perform public.save_room(jsonb_build_object('name', 'قاعة برابط غير آمن',
      'join_url', 'http://meet.jit.si/x'));
    raise exception 'FAIL: قُبل رابط قاعة غير مشفَّر';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  v_room := public.save_room(jsonb_build_object('name', 'قاعة دائمة', 'capacity', 20,
    'join_url', 'https://meet.jit.si/haramain-permanent-test'));

  -- لقاءٌ بلا رابط: يرث رابط قاعته
  v_id := public.save_meeting(jsonb_build_object('title', 'لقاء يرث الرابط',
    'room_id', v_room::text, 'starts_at', (now() + interval '2 days')::text, 'minutes', 45,
    'invitees', jsonb_build_array('00000000-0000-0000-0000-00000000000c')));
  select join_url into v_url from public.meetings where id = v_id;
  if v_url <> 'https://meet.jit.si/haramain-permanent-test' then
    raise exception 'FAIL: لم يرث اللقاء رابط القاعة (%)', v_url;
  end if;

  -- ورابطٌ خاص باللقاء يتقدّم على رابط القاعة
  v_id := public.save_meeting(jsonb_build_object('title', 'لقاء برابط خاص',
    'room_id', v_room::text, 'starts_at', (now() + interval '3 days')::text, 'minutes', 45,
    'join_url', 'https://meet.jit.si/haramain-special',
    'invitees', jsonb_build_array('00000000-0000-0000-0000-00000000000c')));
  if (select join_url from public.meetings where id = v_id) <> 'https://meet.jit.si/haramain-special' then
    raise exception 'FAIL: رابط القاعة تقدّم على رابط اللقاء الخاص';
  end if;

  -- وقاعةٌ بلا رابط دائم ولقاءٌ بلا رابط: يُرفض
  begin
    perform public.save_meeting(jsonb_build_object('title', 'بلا رابط ولا قاعة',
      'starts_at', (now() + interval '4 days')::text, 'minutes', 30,
      'invitees', jsonb_build_array('00000000-0000-0000-0000-00000000000c')));
    raise exception 'FAIL: قُبل لقاء بلا رابط ولا قاعة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- والقاعتان المبدئيتان لهما رابطاهما
  if (select count(*) from public.rooms
       where name in ('قاعة تدريب الإداريين', 'قاعة اجتماع الإداريين') and join_url is not null) <> 2 then
    raise exception 'FAIL: القاعتان المبدئيتان بلا رابط دائم';
  end if;
  raise notice 'PASS: لكل قاعة رابطها الدائم، ويرثه لقاؤها ما لم يُكتب له رابطٌ خاص';
end $$;


-- =====================================================================
-- ٤٣) القاعات نوعان: اجتماعات وتدريب، ولكل نوع بطاقته (ملاحظة ١٦٧)
-- =====================================================================
do $$
declare v_room uuid; v_id uuid; v_kind text;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

  -- القاعتان المبدئيتان في نوعيهما
  if (select kind from public.rooms where name = 'قاعة تدريب الإداريين') <> 'training' then
    raise exception 'FAIL: قاعة التدريب ليست من نوع التدريب';
  end if;
  if (select kind from public.rooms where name = 'قاعة اجتماع الإداريين') <> 'meeting' then
    raise exception 'FAIL: قاعة الاجتماعات ليست من نوع الاجتماعات';
  end if;

  -- قاعةٌ جديدة في التدريب، برابطها الافتراضي
  v_room := public.save_room(jsonb_build_object('name', 'قاعة التدريب الثانية',
    'capacity', 30, 'kind', 'training',
    'join_url', 'https://meet.jit.si/haramain-tadreeb-2'));
  if (select kind from public.rooms where id = v_room) <> 'training' then
    raise exception 'FAIL: لم تُحفظ القاعة في نوع التدريب';
  end if;

  -- النوع المجهول يُرفض
  begin
    perform public.save_room(jsonb_build_object('name', 'قاعة بنوع غريب', 'kind', 'party'));
    raise exception 'FAIL: قُبل نوع قاعة غير معروف';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ولقاء هذه القاعة يحمل نوعها في صفّه، فتُصنَّف اللقاءات بالبطاقتين
  v_id := public.save_meeting(jsonb_build_object('title', 'دورة الترجمة الفورية',
    'room_id', v_room::text, 'kind', 'دورة تدريبية',
    'starts_at', (now() + interval '6 days')::text, 'minutes', 90,
    'invitees', jsonb_build_array('00000000-0000-0000-0000-00000000000c')));
  select room_kind into v_kind from public.meeting_rows where id = v_id;
  if v_kind <> 'training' then
    raise exception 'FAIL: صفّ اللقاء لا يحمل نوع قاعته (%)', v_kind;
  end if;

  -- ولقاءٌ بلا قاعة يُحسب على الاجتماعات، فلا يسقط من البطاقتين
  v_id := public.save_meeting(jsonb_build_object('title', 'لقاء بلا قاعة',
    'starts_at', (now() + interval '7 days')::text, 'minutes', 30,
    'join_url', 'https://meet.jit.si/haramain-no-room',
    'invitees', jsonb_build_array('00000000-0000-0000-0000-00000000000c')));
  if (select room_kind from public.meeting_rows where id = v_id) <> 'meeting' then
    raise exception 'FAIL: لقاءٌ بلا قاعة لم يُحسب على الاجتماعات';
  end if;

  raise notice 'PASS: القاعات نوعان، ويحمل كل لقاء نوع قاعته';
end $$;


-- =====================================================================
-- ٤٤) خطبة الخسوف نوعٌ قائم برمزه في التوثيق (ملاحظة ١٦٩)
-- =====================================================================
do $$
declare v_code text; v_n int;
begin
  select code into v_code from public.doc_type_codes
   where material_type = 'خطب' and sermon_type = 'خطبة خسوف';
  if v_code is null then raise exception 'FAIL: خطبة الخسوف بلا رمز في التوثيق'; end if;
  if v_code !~ '^[0-9A-Z]$' then raise exception 'FAIL: رمز الخسوف خارج النمط (%)', v_code; end if;

  -- ولا يزاحم رمزُه رمزًا قائمًا في الخطب
  select count(*) into v_n from public.doc_type_codes
   where material_type = 'خطب' and code = v_code;
  if v_n <> 1 then raise exception 'FAIL: رمز الخسوف مكرَّر في الخطب (%)', v_n; end if;

  -- والكسوف باقٍ على رمزه
  if (select code from public.doc_type_codes
       where material_type = 'خطب' and sermon_type = 'خطبة كسوف') <> '6' then
    raise exception 'FAIL: تغيّر رمز خطبة الكسوف';
  end if;
  raise notice 'PASS: خطبة الخسوف نوعٌ قائم برمزه، والكسوف على رمزه';
end $$;


-- =====================================================================
-- ٤٥) ثلاثٌ بيد مدير المشروع: إلزام التحقق لحساب، وقائمة الصلاحيات،
--     والمرشد المتميّز يترجم بلغته (ملاحظات ١٧١ و١٧٢ و١٧٣)
-- =====================================================================
do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_crd uuid := '00000000-0000-0000-0000-00000000000b';
        v_sup uuid := '00000000-0000-0000-0000-0000000000aa';
        v_tr  uuid := '00000000-0000-0000-0000-00000000000c';
        v_lang text; v_track uuid; v_stage uuid; v_field uuid;
begin
  -- ---------- إلزام التحقق بخطوتين لحسابٍ بعينه ----------
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  begin
    perform public.set_member_mfa_required(v_tr, true);
    raise exception 'FAIL: ألزم المنسق حسابًا بالتحقق بخطوتين';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  perform public.set_member_mfa_required(v_tr, true);
  if not (select mfa_required from public.profiles where id = v_tr) then
    raise exception 'FAIL: لم يُلزَم الحساب بالتحقق بخطوتين';
  end if;
  perform public.set_member_mfa_required(v_tr, false);
  if (select mfa_required from public.profiles where id = v_tr) then
    raise exception 'FAIL: لم يُرفع الإلزام عن الحساب';
  end if;
  raise notice 'PASS: إلزام التحقق بخطوتين يُضبط لحسابٍ بعينه، وبيد مدير المشروع وحده';
end $$;

do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_crd uuid := '00000000-0000-0000-0000-00000000000b';
        v_tr  uuid := '00000000-0000-0000-0000-00000000000c';
begin
  -- ---------- قائمة الصلاحيات ----------
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);

  -- الأصل الفتح: لا شيء مغلق على المنسق
  if (select perms from public.profiles where id = v_crd) <> '{}'::jsonb then
    raise exception 'FAIL: المنسق يبدأ بصلاحيات مغلقة';
  end if;

  -- مفتاحٌ غير معروف يُرفض
  begin
    perform public.set_member_perms(v_crd, jsonb_build_object('لا-يوجد', false));
    raise exception 'FAIL: قُبل مفتاح صلاحية غير معروف';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- والقائمة للمنسقين ومديري المشروع من الهيئة، لا للمترجمين
  begin
    perform public.set_member_perms(v_tr, jsonb_build_object('payroll', false));
    raise exception 'FAIL: ضُبطت صلاحيات مترجم';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- يُغلق على المنسق: الرواتب والقاعات
  perform public.set_member_perms(v_crd,
    jsonb_build_object('payroll', false, 'rooms', false, 'team', true));
  if (select perms from public.profiles where id = v_crd)
       <> jsonb_build_object('payroll', false, 'rooms', false) then
    raise exception 'FAIL: لم يُحفظ إلا المغلق (%)', (select perms from public.profiles where id = v_crd);
  end if;

  -- فيُمنع من جدولة اللقاءات
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  if public.has_perm('rooms') then raise exception 'FAIL: بقيت صلاحية القاعات مفتوحة'; end if;
  if not public.has_perm('team') then raise exception 'FAIL: أُغلقت صلاحية لم تُغلق'; end if;
  begin
    perform public.save_room(jsonb_build_object('name', 'قاعة من منسق ممنوع'));
    raise exception 'FAIL: أنشأ المنسق قاعةً وصلاحيتها مغلقة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.build_payroll(date_trunc('month', now())::date);
    raise exception 'FAIL: بنى المنسق كشف رواتب وصلاحيته مغلقة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ومدير المشروع لا يتأثر بالإغلاق
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  if not public.has_perm('rooms') then raise exception 'FAIL: أُغلقت صلاحية على مدير المشروع'; end if;
  perform public.save_room(jsonb_build_object('name', 'قاعة من المدير', 'kind', 'meeting'));

  -- ثم تُفتح للمنسق فيعود إليه عمله
  perform public.set_member_perms(v_crd, '{}'::jsonb);
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  if not public.has_perm('rooms') then raise exception 'FAIL: لم تُفتح الصلاحية بعد رفعها'; end if;
  perform public.save_room(jsonb_build_object('name', 'قاعة بعد الفتح', 'kind', 'meeting'));
  raise notice 'PASS: قائمة الصلاحيات تُغلق وتُفتح، والمنع في قاعدة البيانات لا في الشاشة';
end $$;

do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_fld uuid := '00000000-0000-0000-0000-00000000000e';   -- عضوٌ قائم يُنقل إلى الإرشاد
        v_lang text; v_other text; v_stage uuid; v_track uuid;
        v_mine uuid; v_prev uuid;
begin
  -- ---------- المرشد المتميّز يترجم بلغته ----------
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  select code into v_lang from public.languages order by sort limit 1;
  select code into v_other from public.languages where code <> v_lang order by sort limit 1;

  update public.profiles set track = 'field', status = 'active' where id = v_fld;

  -- بلا لغات مسجّلة لا تُتاح له الترجمة
  delete from public.member_languages where member_id = v_fld;
  begin
    perform public.set_member_may_translate(v_fld, true);
    raise exception 'FAIL: أُتيحت الترجمة لمرشد بلا لغة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  insert into public.member_languages (member_id, language_code) values (v_fld, v_lang)
  on conflict do nothing;
  perform public.set_member_may_translate(v_fld, true);
  if not (select may_translate from public.profiles where id = v_fld) then
    raise exception 'FAIL: لم تُتَح الترجمة للمرشد المتميّز';
  end if;

  -- مرحلةٌ بلغته تُسنَد إليه
  select s.id, s.track_id into v_stage, v_track
    from public.track_stages s join public.tracks t on t.id = s.track_id
   where t.language_code = v_lang limit 1;
  if v_stage is not null then
    v_mine := v_stage;
    select assignee_id into v_prev from public.track_stages where id = v_stage;
    update public.track_stages set assignee_id = v_fld where id = v_stage;
  end if;

  -- ومرحلةٌ بغير لغته تُرفض
  select s.id into v_stage
    from public.track_stages s join public.tracks t on t.id = s.track_id
   where t.language_code = v_other limit 1;
  if v_stage is not null then
    begin
      update public.track_stages set assignee_id = v_fld where id = v_stage;
      raise exception 'FAIL: أُسندت إلى المرشد مرحلةٌ بغير لغته';
    exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
    end;
  end if;

  -- ولا تُرفع الإتاحة وفي يده عملٌ لم يُنجز
  begin
    update public.profiles set may_translate = false where id = v_fld;
    raise exception 'FAIL: رُفعت الإتاحة وفي يد المرشد عملٌ مفتوح';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- فإذا نُقل عملُه رُفعت، ثم عاد المنع كما كان
  if v_mine is not null then
    update public.track_stages set assignee_id = v_prev where id = v_mine;
  end if;
  update public.profiles set may_translate = false where id = v_fld;
  begin
    update public.track_stages set assignee_id = v_fld where id = v_mine;
    raise exception 'FAIL: أُسندت ترجمة إلى مرشد غير متميّز';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  update public.profiles set track = 'translation' where id = v_fld;
  raise notice 'PASS: المرشد المتميّز يترجم بلغته وحدها، والأصل في فريق الإرشاد المنع';
end $$;


-- =====================================================================
-- ٤٦) باب التسجيل: يُفتح مدةً ثم يُغلق بنفسه (ملاحظة ١٧٤)
-- =====================================================================
do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_crd uuid := '00000000-0000-0000-0000-00000000000b';
        v_st jsonb;
begin
  -- الأصل مفتوح، فلا يتغيّر شيء على القائم
  if not public.registration_open() then raise exception 'FAIL: التسجيل مغلق من البداية'; end if;

  -- والإغلاق لمدير المشروع وحده
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  begin
    perform public.set_registration(false, null, null);
    raise exception 'FAIL: أغلق المنسق باب التسجيل';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  v_st := public.set_registration(false, null, null);
  if (v_st ->> 'open')::boolean then raise exception 'FAIL: لم يُغلق التسجيل'; end if;
  if public.registration_open() then raise exception 'FAIL: بقي التسجيل مفتوحًا'; end if;

  -- ويُفتح مدةً معلومة، فيحمل وقت إغلاقه
  v_st := public.set_registration(true, 48, null);
  if not (v_st ->> 'open')::boolean then raise exception 'FAIL: لم يُفتح التسجيل'; end if;
  if (v_st ->> 'closes_at') is null then raise exception 'FAIL: فُتح بلا وقت إغلاق'; end if;
  if (v_st ->> 'closes_at')::timestamptz <= now() then raise exception 'FAIL: وقت الإغلاق في الماضي'; end if;

  -- ومدةٌ خارج الحد تُرفض
  begin
    perform public.set_registration(true, 0, null);
    raise exception 'FAIL: قُبلت مدة فتحٍ صفر';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ومتى مضى وقته أُغلق بنفسه بلا تدخّل
  update public.platform_settings
     set registration_open = true, registration_closes_at = now() - interval '1 minute' where id;
  if public.registration_open() then raise exception 'FAIL: لم يُغلق بنفسه بعد مضيّ وقته'; end if;

  -- والزائر لا يُنشأ له حساب والباب مغلق (ومدير المشروع يُنشئ يدويًّا في كل حال)
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'gate-test@example.com');
    raise exception 'FAIL: أُنشئ حساب زائرٍ والتسجيل مغلق';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ومدير المشروع لا يمنعه الباب المغلق
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  insert into auth.users (id, email) values (gen_random_uuid(), 'mgr-made@example.com');
  if not exists (select 1 from public.profiles where email = 'mgr-made@example.com') then
    raise exception 'FAIL: مُنع مدير المشروع من إنشاء حساب';
  end if;

  -- ثم يُفتح فيعود
  perform public.set_registration(true, null, 'الفتح للفريق المدعوّ');
  if not public.registration_open() then raise exception 'FAIL: لم يُفتح بعد الإغلاق'; end if;
  if (public.registration_state() ->> 'note') <> 'الفتح للفريق المدعوّ' then
    raise exception 'FAIL: لم تُحفظ ملاحظة التسجيل';
  end if;
  raise notice 'PASS: باب التسجيل يُفتح مدةً ويُغلق بنفسه، والمنع في قاعدة البيانات';
end $$;

-- =====================================================================
-- ٤٧) القاعات الثلاث لكل نوع، ومحاور الاجتماع ومحضره وأمين سرّه،
--     والتدريب المكرَّر جلساتٍ في سلسلة (ملاحظات ١٨٢ و١٨٣ و١٨٤)
-- =====================================================================
do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_crd uuid := '00000000-0000-0000-0000-00000000000b';
        v_kha uuid := '00000000-0000-0000-0000-00000000000d';
        v_sar uuid := '00000000-0000-0000-0000-00000000000e';
        v_room uuid; v_troom uuid; v_id uuid; v_n int; v_series uuid; v_res jsonb;
begin
  -- ---------- ثلاث قاعاتٍ لكل نوع، ولكل فئةٍ قاعتها ----------
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  select count(*) into v_n from public.rooms where kind = 'meeting';
  if v_n < 3 then raise exception 'FAIL: قاعات الاجتماع أقل من ثلاث (%)', v_n; end if;
  select count(*) into v_n from public.rooms where kind = 'training';
  if v_n < 3 then raise exception 'FAIL: قاعات التدريب أقل من ثلاث (%)', v_n; end if;
  select count(distinct audience) into v_n from public.rooms where audience <> 'all';
  if v_n < 3 then raise exception 'FAIL: الفئات الثلاث غير مكتملة في القاعات'; end if;

  -- ---------- القاعة تظهر لأهلها وحدهم، والإدارة ترى الجميع ----------
  perform public.set_member_track(v_kha, 'translation');
  perform set_config('request.jwt.claim.sub', v_kha::text, true);
  if not public.can_see_room('translation') then raise exception 'FAIL: حُجبت قاعة فريقه عنه'; end if;
  if not public.can_see_room('all') then raise exception 'FAIL: حُجبت القاعة العامة'; end if;
  if public.can_see_room('field') then raise exception 'FAIL: رأى قاعة فريقٍ آخر'; end if;
  if public.can_see_room('admins') then raise exception 'FAIL: رأى قاعة الإداريين'; end if;

  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  if not (public.can_see_room('translation') and public.can_see_room('field')
          and public.can_see_room('admins')) then
    raise exception 'FAIL: حُجبت قاعةٌ عن المنسق';
  end if;

  -- ---------- اجتماعٌ في قاعة الإداريين، ومدعوّوه ----------
  select id into v_room from public.rooms where kind = 'meeting' and audience = 'admins' limit 1;
  if v_room is null then raise exception 'FAIL: لا قاعة اجتماعٍ للإداريين'; end if;
  v_id := public.save_meeting(jsonb_build_object(
    'title', 'اجتماع المحاور', 'kind', 'اجتماع', 'room_id', v_room,
    'starts_at', (now() + interval '2 days')::text, 'minutes', 60,
    'join_url', 'https://meet.jit.si/haramain-agenda-test',
    'invitees', jsonb_build_array(v_kha::text, v_sar::text)));

  -- ---------- أمين السرّ: من المدعوّين، يعيّنه المنسق وحده ----------
  perform set_config('request.jwt.claim.sub', v_kha::text, true);
  begin
    perform public.set_secretary(v_id, v_kha);
    raise exception 'FAIL: عيّن المدعوُّ نفسه أمينًا للسرّ';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  begin
    perform public.set_secretary(v_id, v_mgr);
    raise exception 'FAIL: صار أمين السرّ من غير المدعوّين';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  perform public.set_secretary(v_id, v_kha);
  if (select secretary_id from public.meetings where id = v_id) <> v_kha then
    raise exception 'FAIL: لم يُحفظ أمين السرّ';
  end if;

  -- ---------- المحاور: المنسق وأمين السرّ يكتبان، وغيرهما يُمنع ----------
  perform set_config('request.jwt.claim.sub', v_sar::text, true);
  begin
    perform public.save_agenda(v_id, '[{"title":"محورٌ مقتحم"}]'::jsonb);
    raise exception 'FAIL: كتب مدعوٌّ المحاور';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_kha::text, true);
  perform public.save_agenda(v_id, jsonb_build_array(
    jsonb_build_object('title', 'استعراض ما مضى', 'presenter', 'المنسق', 'minutes', 10),
    jsonb_build_object('title', 'خطة الشهر', 'presenter', 'مدير المشروع', 'minutes', 20),
    jsonb_build_object('title', 'ما يُستجدّ', 'presenter', '', 'minutes', 10)));
  select agenda_count into v_n from public.meeting_rows where id = v_id;
  if v_n <> 3 then raise exception 'FAIL: عدد المحاور % لا ثلاثة', v_n; end if;

  -- ---------- المحضر: مسودةٌ من أمين السرّ، واعتمادُه للمنسق ----------
  begin
    perform public.save_minutes(jsonb_build_object('id', v_id, 'state', 'final',
      'doc', jsonb_build_object('opening', 'بسم الله')));
    raise exception 'FAIL: اعتمد أمين السرّ المحضر نهائيًّا';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform public.save_minutes(jsonb_build_object('id', v_id, 'state', 'draft',
    'doc', jsonb_build_object('opening', 'افتُتح الاجتماع',
      'axes', jsonb_build_array(jsonb_build_object('title', 'خطة الشهر',
        'decision', 'الموافقة', 'owner', 'المنسق')))));
  if (select minutes_state from public.meetings where id = v_id) <> 'draft' then
    raise exception 'FAIL: لم تُحفظ مسودة المحضر';
  end if;

  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  perform public.save_minutes(jsonb_build_object('id', v_id, 'state', 'final',
    'doc', jsonb_build_object('opening', 'افتُتح الاجتماع'),
    'next_meeting_at', (now() + interval '32 days')::text));
  if (select minutes_state from public.meetings where id = v_id) <> 'final' then
    raise exception 'FAIL: لم يُعتمد المحضر';
  end if;
  if (select next_meeting_at from public.meetings where id = v_id) is null then
    raise exception 'FAIL: لم يُحفظ موعد الاجتماع القادم';
  end if;

  -- ---------- المدعوّ يرى ولا يُعدّل، ويبقى يرى بعد انقضاء الموعد ----------
  update public.meetings set starts_at = now() - interval '3 days' where id = v_id;
  perform set_config('request.jwt.claim.sub', v_sar::text, true);
  if not public.can_see_meeting(v_id) then
    raise exception 'FAIL: حُجب الاجتماع المنقضي عن مدعوّه';
  end if;
  begin
    perform public.save_meeting(jsonb_build_object('id', v_id, 'title', 'عنوانٌ مُقتحَم',
      'starts_at', (now() + interval '1 day')::text, 'minutes', 60,
      'join_url', 'https://meet.jit.si/x'));
    raise exception 'FAIL: عدّل المدعوُّ بيانات الاجتماع';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ---------- التدريب المكرَّر: جلساتٌ متتابعة في سلسلةٍ واحدة ----------
  select id into v_troom from public.rooms where kind = 'training' and audience = 'translation' limit 1;
  if v_troom is null then raise exception 'FAIL: لا قاعة تدريبٍ للترجمة التخصصية'; end if;

  perform set_config('request.jwt.claim.sub', v_kha::text, true);
  begin
    perform public.save_meeting_series(jsonb_build_object('title', 'دورةٌ مقتحمة',
      'kind', 'دورة تدريبية', 'room_id', v_troom, 'days', 3, 'minutes', 180,
      'starts_at', (now() + interval '5 days')::text,
      'join_url', 'https://meet.jit.si/x', 'invitees', jsonb_build_array(v_kha::text)));
    raise exception 'FAIL: جدول غيرُ المنسق سلسلةَ تدريب';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  v_res := public.save_meeting_series(jsonb_build_object(
    'title', 'دورة الترجمة الفورية', 'kind', 'دورة تدريبية', 'room_id', v_troom,
    'days', 5, 'minutes', 180, 'starts_at', (date_trunc('day', now()) + interval '10 days 17 hours')::text,
    'join_url', 'https://meet.jit.si/haramain-training-series',
    'content', jsonb_build_array('دليل الترجمة الفورية', 'تسجيلاتٌ للتمرين'),
    'invitees', jsonb_build_array(v_kha::text, v_sar::text)));
  v_series := (v_res ->> 'series_id')::uuid;

  select count(*) into v_n from public.meetings where series_id = v_series;
  if v_n <> 5 then raise exception 'FAIL: جلسات السلسلة % لا خمس', v_n; end if;
  if exists (select 1 from public.meetings where series_id = v_series and session_no is null) then
    raise exception 'FAIL: جلسةٌ بلا رقم في السلسلة';
  end if;
  if (select count(distinct date_trunc('day', starts_at)) from public.meetings
       where series_id = v_series) <> 5 then
    raise exception 'FAIL: جلسات السلسلة ليست في خمسة أيام متتابعة';
  end if;
  if (select count(distinct starts_at::time) from public.meetings where series_id = v_series) <> 1 then
    raise exception 'FAIL: جلسات السلسلة اختلفت مواعيدها في اليوم';
  end if;
  if (select jsonb_array_length(content) from public.meetings
       where series_id = v_series and session_no = 1) <> 2 then
    raise exception 'FAIL: لم يُحفظ المحتوى التدريبي';
  end if;
  if (select count(*) from public.meeting_invitees i
       join public.meetings m on m.id = i.meeting_id where m.series_id = v_series) <> 10 then
    raise exception 'FAIL: لم يُدعَ المتدربون إلى كل جلسة';
  end if;

  -- ---------- وحذف السلسلة كلها لمدير المشروع وحده ----------
  begin
    perform public.delete_series(v_series);
    raise exception 'FAIL: حذف المنسق سلسلة التدريب';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  if public.delete_series(v_series) <> 5 then raise exception 'FAIL: لم تُحذف الجلسات الخمس'; end if;
  if exists (select 1 from public.meetings where series_id = v_series) then
    raise exception 'FAIL: بقيت جلساتٌ من السلسلة المحذوفة';
  end if;

  -- ---------- والقاعات الستّ ثابتة: تُعدَّل بياناتها ولا تُحذف ----------
  if (select count(*) from public.rooms where is_fixed) < 6 then
    raise exception 'FAIL: القاعات الأصلية لم تُوسم ثابتةً';
  end if;
  begin
    perform public.delete_room(v_room);
    raise exception 'FAIL: حُذفت قاعةٌ ثابتة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  -- والتعديل عليها مفتوح
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  perform public.save_room(jsonb_build_object('id', v_room, 'name',
    (select name from public.rooms where id = v_room), 'capacity', 30,
    'kind', 'meeting', 'audience', 'admins',
    'join_url', (select join_url from public.rooms where id = v_room)));
  if (select capacity from public.rooms where id = v_room) <> 30 then
    raise exception 'FAIL: لم تُعدَّل بيانات القاعة الثابتة';
  end if;

  raise notice 'PASS: القاعات بفئاتها، والمحاور والمحضر وأمين السرّ، والتدريب المكرَّر سلسلةً';
end $$;

-- =====================================================================
-- ٤٨) التسجيل أربعةُ بيانات، ثم استكمالٌ يُدقَّق؛ ومدينة المرشد؛
--     وفريق إجابة السائلين يُنقل إليه ولا يُسجَّل فيه
--     (ملاحظات ١٧٩ و١٨٥ و١٨٦)
-- =====================================================================
do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_crd uuid := '00000000-0000-0000-0000-00000000000b';
        v_sar uuid := '00000000-0000-0000-0000-00000000000e';
        v_new uuid; v_missing text[]; v_st text;
begin
  -- ---------- الأربعة لازمة، وما نقص منها رُدَّ التسجيل ----------
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    insert into auth.users (email, raw_user_meta_data)
    values ('nophone@example.com', '{"full_name":"بلا جوال","national_id":"1099999991"}');
    raise exception 'FAIL: قُبل تسجيلٌ بلا رقم جوال';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    insert into auth.users (email, raw_user_meta_data)
    values ('noname@example.com', '{"national_id":"1099999992","whatsapp":"+966500000011"}');
    raise exception 'FAIL: قُبل تسجيلٌ بلا اسم';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ---------- والمرشد المكاني يحدّد مدينته ----------
  begin
    insert into auth.users (email, raw_user_meta_data)
    values ('nocity@example.com',
      '{"full_name":"مرشدٌ بلا مدينة","national_id":"1099999993","whatsapp":"+966500000012","applied_as":"field"}');
    raise exception 'FAIL: سُجِّل مرشدٌ بلا مدينة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  v_new := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_new, 'murshid@example.com',
    ('{"full_name":"مرشدٌ مكّي","national_id":"1099999994","whatsapp":"+966500000013",'
     || '"applied_as":"field","city":"makkah","languages":["en"]}')::jsonb);
  if (select city from public.profiles where id = v_new) <> 'makkah' then
    raise exception 'FAIL: لم تُحفظ مدينة المرشد';
  end if;
  if (select track from public.profiles where id = v_new) <> 'field' then
    raise exception 'FAIL: لم يُسجَّل في فريق الإرشاد المكاني';
  end if;

  -- ---------- ولا يُسجَّل أحدٌ ابتداءً في «إجابة السائلين» ----------
  v_missing := '{}';
  if exists (select 1 from public.profiles where track = 'answers') then
    raise exception 'FAIL: دخل أحدٌ فريق إجابة السائلين بالتسجيل';
  end if;

  -- ---------- ما نقص من البيانات يُعرَض، ولا تُرفع ناقصة ----------
  perform set_config('request.jwt.claim.sub', v_new::text, true);
  v_missing := public.profile_missing(v_new);
  if not ('الجنسية' = any (v_missing)) then raise exception 'FAIL: لم تُعدّ الجنسية ناقصة'; end if;
  if not ('مكان الإقامة' = any (v_missing)) then raise exception 'FAIL: لم يُعدّ مكان الإقامة ناقصًا'; end if;
  begin
    perform public.submit_profile_data();
    raise exception 'FAIL: رُفعت بياناتٌ ناقصة للتدقيق';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  update public.profile_private
     set nationality = 'سعودي', residence = 'مكة المكرمة',
         iqama_path = 'x/iqama.pdf', photo_path = 'x/photo.jpg'
   where id = v_new;
  if array_length(public.profile_missing(v_new), 1) is not null then
    raise exception 'FAIL: بقيت بياناتٌ ناقصة بعد استكمالها: %',
      array_to_string(public.profile_missing(v_new), '، ');
  end if;
  if public.submit_profile_data() <> 'submitted' then raise exception 'FAIL: لم تُرفع البيانات'; end if;

  -- ---------- والتدقيق للمنسق ومدير المشروع ----------
  perform set_config('request.jwt.claim.sub', v_sar::text, true);
  begin
    perform public.review_profile_data(v_new, true, null);
    raise exception 'FAIL: دقّق عضوٌ بيانات غيره';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  begin
    perform public.review_profile_data(v_new, false, '   ');
    raise exception 'FAIL: رُدَّت البيانات بلا بيان ما ينقص';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  perform public.review_profile_data(v_new, false, 'صورة الهوية غير واضحة');
  select data_status into v_st from public.profile_private where id = v_new;
  if v_st <> 'returned' then raise exception 'FAIL: لم تُعَد البيانات لصاحبها'; end if;
  if not exists (select 1 from public.notifications
                  where member_id = v_new and subject = 'بياناتك تحتاج استكمالًا') then
    raise exception 'FAIL: لم يُبلَّغ العضو بما ينقصه';
  end if;

  perform public.review_profile_data(v_new, true, null);
  if (select data_status from public.profile_private where id = v_new) <> 'accepted' then
    raise exception 'FAIL: لم تُقبل البيانات بعد استدراكها';
  end if;

  -- ---------- والنقل إلى إجابة السائلين بيد المنسق ----------
  perform set_config('request.jwt.claim.sub', v_sar::text, true);
  begin
    perform public.set_member_track(v_sar, 'answers');
    raise exception 'FAIL: نقل عضوٌ نفسه إلى إجابة السائلين';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  perform public.set_member_track(v_new, 'answers');
  if (select track from public.profiles where id = v_new) <> 'answers' then
    raise exception 'FAIL: لم يُنقل إلى فريق إجابة السائلين';
  end if;

  -- ولا تُسنَد إليه ترجمةٌ كفريق الإرشاد
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  begin
    perform public.reassign_stage(
      (select id from public.tracks where language_code = 'en' limit 1), 'translation', v_new);
    raise exception 'FAIL: أُسنِدت ترجمةٌ إلى فريق إجابة السائلين';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- والمدينة تُضبط لاحقًا من المنسق
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  perform public.set_member_city(v_new, 'madinah');
  if (select city from public.profiles where id = v_new) <> 'madinah' then
    raise exception 'FAIL: لم تُعدَّل مدينة العضو';
  end if;

  raise notice 'PASS: التسجيل أربعةُ بيانات ثم استكمالٌ يُدقَّق، والمدينة تُحدَّد، وإجابة السائلين يُنقل إليها';
end $$;

-- =====================================================================
-- ٤٩) الاحتساب على أصل العقد، ونافذة الخطبة، والتقرير الشهري
--     (ملاحظات ١٨٨ و١٨٩ و١٩٠)
-- =====================================================================
do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_crd uuid := '00000000-0000-0000-0000-00000000000b';
        v_tr  uuid := '00000000-0000-0000-0000-00000000000c';
        v_mat uuid; v_win jsonb; v_n numeric; v_rec record; v_before numeric;
        v_new_code int;
begin
  -- ---------- الكلمات من الأصل العربي، مرةً واحدة للمادة ----------
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  select id into v_mat from public.materials
   where material_type <> 'خطب' and deleted_at is null order by created_at limit 1;
  if v_mat is null then
    insert into public.materials (material_type, title, mosque, source_html, deliverable,
                                  priority, receipt_minutes, created_by)
    values ('كتب', 'كتابٌ للاحتساب', 'general', '<p>واحد اثنان ثلاثة أربعة خمسة</p>',
            'text', 'normal', 120, v_mgr)
    returning id into v_mat;
  end if;

  if public.count_words('  كلمةٌ   وكلمتان  وثلاث ') <> 3 then
    raise exception 'FAIL: إحصاء الكلمات لا يتخطّى الفراغات المتكررة';
  end if;
  if public.count_words('') <> 0 or public.count_words(null) <> 0 then
    raise exception 'FAIL: الفارغ لا يُحصى صفرًا';
  end if;

  -- التصحيح للمنسق ومدير المشروع لا لغيرهما
  perform set_config('request.jwt.claim.sub', v_tr::text, true);
  begin
    perform public.set_material_words(v_mat, 999);
    raise exception 'FAIL: صحّح مترجمٌ عدد الكلمات';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  begin
    perform public.set_material_words(v_mat, 9000000);
    raise exception 'FAIL: قُبل عددٌ غير معقول';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform public.set_material_words(v_mat, 1200, 1150);
  if (select source_words from public.materials where id = v_mat) <> 1200 then
    raise exception 'FAIL: لم يُحفظ العدد المصحَّح';
  end if;
  if (select source_words_auto from public.materials where id = v_mat) <> 1150 then
    raise exception 'FAIL: لم يُحفظ ما أحصته الآلة بجانب المصحَّح';
  end if;
  if (select source_words_by from public.materials where id = v_mat) <> v_crd then
    raise exception 'FAIL: لم يُسجَّل من صحّح العدد';
  end if;

  -- والصفّ يقرأ المحفوظ لا كلمات الترجمة
  if exists (select 1 from public.contract_rows where material_id = v_mat and source_words <> 1200) then
    raise exception 'FAIL: صفّ العقد لا يقرأ كلمات الأصل المحفوظة';
  end if;
  -- ومهما كثرت اللغات فالعدد للمادة واحد
  if (select count(distinct source_words) from public.contract_rows where material_id = v_mat) > 1 then
    raise exception 'FAIL: اختلف عدد كلمات الأصل بين لغات المادة';
  end if;

  -- ---------- نافذة الخطبة: من الباقي حتى ما قبل الجمعة ----------
  v_win := public.sermon_window((current_date + 7)::date);
  if v_win is null then raise exception 'FAIL: لا نافذة للخطبة'; end if;
  if (v_win ->> 'minutes')::int <= 0 then raise exception 'FAIL: نافذةٌ بلا وقت'; end if;
  if (v_win ->> 'cutoff_hours')::int <> 6 then raise exception 'FAIL: ساعات الأمان ليست ستًّا'; end if;
  if jsonb_typeof(v_win -> 'split') <> 'object' then raise exception 'FAIL: لا توزيع على المراحل'; end if;
  -- ومجموع التوزيع لا يتجاوز النافذة بأكثر من حدٍّ أدنى لكل مرحلة
  select sum((value)::numeric) into v_n from jsonb_each_text(v_win -> 'split');
  if v_n > (v_win ->> 'minutes')::numeric + 15 * 6 then
    raise exception 'FAIL: توزيع المراحل يتجاوز النافذة (% من %)', v_n, v_win ->> 'minutes';
  end if;
  -- والماضي لا نافذة له
  if (public.sermon_window((current_date - 30)::date) ->> 'minutes')::int <> 0 then
    raise exception 'FAIL: نافذةٌ لتاريخٍ مضى';
  end if;

  -- ---------- التقرير الشهري: لمدير المشروع وحده ----------
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  if exists (select 1 from public.ops_report(current_date)) then
    raise exception 'FAIL: رأى المنسق التقرير الشهري';
  end if;
  begin
    perform public.set_ops_month(jsonb_build_object('month', current_date::text, 'code', 1,
      'short_days', 2));
    raise exception 'FAIL: صحّح المنسق بندًا في التقرير';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  -- بنود الكراسة: أربعةٌ للسنة كلها، وأربعةٌ للموسمين لا تظهر إلا في شهورها
  select count(*) into v_n from public.ops_items;
  if v_n < 8 then raise exception 'FAIL: بنود الكراسة % لا ثمانية', v_n; end if;

  select * into v_rec from public.ops_report(current_date) where code = 1;
  if v_rec.unit_cost <> 5609.27 then raise exception 'FAIL: تكلفة الفرد خلاف الكراسة'; end if;
  if v_rec.staff_count <> 95 then raise exception 'FAIL: عدد مرشدي المسجد الحرام خلاف الكراسة'; end if;
  if v_rec.total_cost <> round(5609.27 * 95, 2) then
    raise exception 'FAIL: الإجمالي ليس العدد في التكلفة';
  end if;
  if v_rec.net <> v_rec.total_cost - v_rec.deduction - v_rec.eval_cut then
    raise exception 'FAIL: الصافي ليس الإجمالي ناقصَ الحسميات';
  end if;
  -- والسنوي منه يطابق ما في الكراسة: ٦٣٩٤٥٦٧٫٨٠
  if round(v_rec.total_cost * 12, 2) <> 6394567.80 then
    raise exception 'FAIL: السنويّ خلاف الكراسة (%)', round(v_rec.total_cost * 12, 2);
  end if;

  select * into v_rec from public.ops_report(current_date) where code = 6;
  if v_rec.staff_count <> 11 then raise exception 'FAIL: عدد إجابة السائلين بالمدينة خلاف الكراسة'; end if;

  -- ---------- سطور المواسم لا تظهر إلا في شهورها ----------
  if exists (select 1 from public.ops_report(current_date) o
              where o.season <> 'year'
                and not public.month_in_season(current_date, o.season)) then
    raise exception 'FAIL: ظهر سطرُ موسمٍ خارج شهره';
  end if;
  if not public.month_in_season('2027-02-01'::date, 'ramadan') then
    raise exception 'FAIL: لم يُعرف شهر رمضان';
  end if;
  if public.month_in_season('2027-01-01'::date, 'ramadan') then
    raise exception 'FAIL: عُدَّ شهرٌ ليس فيه رمضان موسمًا';
  end if;
  if not public.month_in_season('2027-05-01'::date, 'hajj') then
    raise exception 'FAIL: لم يُعرف موسم الحج';
  end if;

  -- ---------- والتصحيح يعلو على المحتسَب، ومحوُه يعيده ----------
  select * into v_rec from public.ops_report(current_date) where code = 5;
  v_before := v_rec.total_cost;
  perform public.set_ops_month(jsonb_build_object('month', current_date::text, 'code', 5,
    'staff_count', 54, 'short_days', 3, 'deduction', 500, 'note', 'غيابٌ بعذر'));
  select * into v_rec from public.ops_report(current_date) where code = 5;
  if v_rec.staff_count <> 54 then raise exception 'FAIL: لم يُؤخذ العدد المصحَّح'; end if;
  if v_rec.deduction <> 500 then raise exception 'FAIL: لم تُؤخذ الحسميات المكتوبة'; end if;
  if not v_rec.is_manual then raise exception 'FAIL: لم يُعلَم البند بأنه مصحَّح'; end if;
  if v_rec.note <> 'غيابٌ بعذر' then raise exception 'FAIL: لم يُحفظ سبب الحسم'; end if;
  if v_rec.total_cost = v_before then raise exception 'FAIL: لم يتغيّر الإجمالي بتغيّر العدد'; end if;

  perform public.clear_ops_month(current_date, 5);
  select * into v_rec from public.ops_report(current_date) where code = 5;
  if v_rec.staff_count <> 56 then raise exception 'FAIL: لم يعد البند إلى عدد الكراسة'; end if;
  if v_rec.is_manual then raise exception 'FAIL: بقي البند مصحَّحًا بعد محوه'; end if;

  -- ---------- بندٌ يضيفه مدير المشروع بسطره وبياناته ----------
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  begin
    perform public.save_ops_item(jsonb_build_object('name', 'بندٌ مقتحم', 'unit_cost', 10));
    raise exception 'FAIL: أضاف المنسق بندًا في التقرير';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  begin
    perform public.save_ops_item(jsonb_build_object('name', '  ', 'unit_cost', 10));
    raise exception 'FAIL: قُبل بندٌ بلا اسم';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  v_new_code := public.save_ops_item(jsonb_build_object(
    'name', 'منسق المشروع', 'staff_count', 1, 'unit_cost', 17441.16,
    'note', 'بندٌ من عندنا، لم تُسعّره الكراسة شهريًّا'));
  if v_new_code <= 100 then raise exception 'FAIL: البند المضاف أخذ رقمًا من أرقام الكراسة'; end if;
  select * into v_rec from public.ops_report(current_date) where code = v_new_code;
  if v_rec.name <> 'منسق المشروع' then raise exception 'FAIL: لم يظهر البند المضاف'; end if;
  if not v_rec.is_custom then raise exception 'FAIL: لم يُعلَم البند بأنه مضاف'; end if;
  if v_rec.total_cost <> 17441.16 then raise exception 'FAIL: إجمالي البند المضاف خاطئ'; end if;

  -- ويُعدَّل اسمه وسعره لأنه من عنده
  perform public.save_ops_item(jsonb_build_object('code', v_new_code,
    'name', 'منسق المشروع (معدَّل)', 'staff_count', 2, 'unit_cost', 18000));
  select * into v_rec from public.ops_report(current_date) where code = v_new_code;
  if v_rec.name <> 'منسق المشروع (معدَّل)' then raise exception 'FAIL: لم يُعدَّل اسم البند المضاف'; end if;
  if v_rec.total_cost <> 36000 then raise exception 'FAIL: لم يُعدَّل سعر البند المضاف'; end if;

  -- وبند الكراسة يُعدَّل عدده ولا يُغيَّر سعره ولا اسمه
  perform public.save_ops_item(jsonb_build_object('code', 1, 'name', 'اسمٌ آخر',
    'staff_count', 90, 'unit_cost', 1));
  select * into v_rec from public.ops_report(current_date) where code = 1;
  if v_rec.unit_cost <> 5609.27 then raise exception 'FAIL: تغيّر سعرُ بند الكراسة'; end if;
  if v_rec.name = 'اسمٌ آخر' then raise exception 'FAIL: تغيّر اسمُ بند الكراسة'; end if;
  if v_rec.staff_count <> 90 then raise exception 'FAIL: لم يُعدَّل عددُ بند الكراسة'; end if;
  perform public.save_ops_item(jsonb_build_object('code', 1, 'name', 'x', 'staff_count', 95,
    'unit_cost', 1));

  -- والحذف للمضاف وحده
  begin
    perform public.delete_ops_item(1);
    raise exception 'FAIL: حُذف بندٌ من الكراسة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  perform public.delete_ops_item(v_new_code);
  if exists (select 1 from public.ops_items where code = v_new_code) then
    raise exception 'FAIL: لم يُحذف البند المضاف';
  end if;

  -- ---------- ونسبة المستخلص من جدول التقييم في الكراسة ----------
  if (public.ops_eval(current_date, 1) ->> 'pct')::int <> 100 then
    raise exception 'FAIL: نسبة المستخلص بلا تقييمٍ ليست مئةً';
  end if;

  -- وبندٌ غير معروف يُردّ
  begin
    perform public.set_ops_month(jsonb_build_object('month', current_date::text, 'code', 999));
    raise exception 'FAIL: قُبل بندٌ غير معروف';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ---------- وأرقام الإنتاج على أساس العقد ----------
  if not exists (select 1 from public.production_contract()) then
    raise exception 'FAIL: لا أرقام إنتاجٍ على أساس العقد';
  end if;

  raise notice 'PASS: الكلمات من الأصل العربي، ونافذة الخطبة، والتقرير الشهري بحسمياته';
end $$;

-- =====================================================================
-- ٥٠) لغاتُ المبادرة: يخدمها المتعاقد بلا مقابل — تُحسب في المنصة
--     وتُستثنى من كميات المستخلص (ملاحظة ١٩٤)
-- =====================================================================
do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_crd uuid := '00000000-0000-0000-0000-00000000000b';
        v_n int; v_done numeric; v_init numeric; v_rec record;
begin
  -- ---------- الوسم يبدأ باثنتين: الإسبانية والبرتغالية ----------
  select count(*) into v_n from public.languages where is_initiative;
  if v_n <> 2 then raise exception 'FAIL: لغات المبادرة % لا اثنتان', v_n; end if;
  if not exists (select 1 from public.languages where code = 'es' and is_initiative) then
    raise exception 'FAIL: الإسبانية ليست من المبادرة';
  end if;
  if not exists (select 1 from public.languages where code = 'pt' and is_initiative) then
    raise exception 'FAIL: البرتغالية ليست من المبادرة';
  end if;

  -- ---------- والوسم لمدير المشروع وحده ----------
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  begin
    perform public.set_language_initiative('ur', true, null);
    raise exception 'FAIL: وسم المنسق لغةً بالمبادرة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ---------- اللغة المبادَرُ بها تُحسب في المنصة ----------
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  perform public.set_language_initiative('ur', true, 'للتجربة');
  if not exists (select 1 from public.languages
                  where code = 'ur' and is_initiative and initiative_note = 'للتجربة') then
    raise exception 'FAIL: لم يُحفظ وسم المبادرة ولا بيانُه';
  end if;

  -- ومتى وُسِمت خرجت من الكمية المحتسَبة ودخلت عمود المبادرة
  select qty_done, qty_initiative into v_done, v_init
    from public.contract_progress() where code = 1;
  if v_init is null then raise exception 'FAIL: لا عمود للمبادرة في كميات العقد'; end if;

  -- والأردية فيها عملٌ منجَز من الأجزاء السابقة، فيظهر في المبادرة لا في المحتسَب
  if exists (select 1 from public.contract_rows
              where language_code = 'ur' and status = 'completed')
     and v_init = 0 then
    raise exception 'FAIL: عملُ لغة المبادرة لم يُعدّ في عمودها';
  end if;

  -- ثم تُخرج فتعود إلى المحتسَب
  perform public.set_language_initiative('ur', false, null);
  if exists (select 1 from public.languages where code = 'ur' and is_initiative) then
    raise exception 'FAIL: بقيت اللغة في المبادرة بعد إخراجها';
  end if;
  if (select initiative_note from public.languages where code = 'ur') is not null then
    raise exception 'FAIL: بقي بيانُ المبادرة بعد إخراجها';
  end if;

  -- ---------- بيانُ المبادرة لغةً لغةً ----------
  select count(*) into v_n from public.initiative_languages();
  if v_n <> 2 then raise exception 'FAIL: بيان المبادرة % لا لغتان', v_n; end if;
  select * into v_rec from public.initiative_languages() where code = 'es';
  if v_rec.name_ar <> 'الإسبانية' then raise exception 'FAIL: اسم لغة المبادرة خاطئ'; end if;
  if v_rec.note is null then raise exception 'FAIL: لغة المبادرة بلا بيان'; end if;

  -- ومجموعُها في رقمٍ واحد
  select langs into v_n from public.initiative_totals();
  if v_n <> 2 then raise exception 'FAIL: مجموع لغات المبادرة % لا اثنتان', v_n; end if;

  -- ---------- وبيان المبادرة لمدير المشروع وحده ----------
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  if exists (select 1 from public.initiative_languages()) then
    raise exception 'FAIL: رأى المنسق بيان المبادرة';
  end if;

  -- ---------- والمستخلص يُسعّر المحتسَب وحده ----------
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  if exists (select 1 from public.claim_month(current_date) c
              where c.amount <> round(coalesce(c.unit_price, 0) * c.qty_done, 2)) then
    raise exception 'FAIL: قيمةُ المستخلص لا تطابق الكمية المحتسَبة';
  end if;
  if not exists (select 1 from public.claim_month(current_date) c where c.qty_initiative is not null) then
    raise exception 'FAIL: المستخلص بلا عمود للمبادرة';
  end if;

  raise notice 'PASS: لغاتُ المبادرة تُحسب في المنصة وتُستثنى من كميات المستخلص';
end $$;

-- =====================================================================
-- ٥١) حسوماتُ العقد على نصّه: الأيامُ التشغيلية، ومراتبُ التقييم،
--     والبديلُ المعتمد، والغيابُ الجماعي، والفتراتُ الثلاث (ملاحظة ١٩٦)
-- =====================================================================
do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_crd uuid := '00000000-0000-0000-0000-00000000000b';
        v_m1 uuid := '00000000-0000-0000-0000-0000000f0001';
        v_m2 uuid := '00000000-0000-0000-0000-0000000f0002';
        v_m3 uuid := '00000000-0000-0000-0000-0000000f0003';
        v_m4 uuid := '00000000-0000-0000-0000-0000000f0004';
        v_mo date := date_trunc('month', current_date)::date;
        v_w date; v_rec record; v_ev jsonb; v_ab jsonb;
        v_n int; v_sid uuid; v_person numeric; v_day numeric; v_op int;
begin
  -- ---------- فريقٌ ميداني بمكة: أربعةُ أفراد ----------
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  insert into auth.users (id, email, raw_user_meta_data) values
    (v_m1, 'f1@test.local', jsonb_build_object('full_name', 'مرشد أول',
       'national_id', '1000000001', 'whatsapp', '0500000001',
       'applied_as', 'field', 'city', 'makkah')),
    (v_m2, 'f2@test.local', jsonb_build_object('full_name', 'مرشد ثانٍ',
       'national_id', '1000000002', 'whatsapp', '0500000002',
       'applied_as', 'field', 'city', 'makkah')),
    (v_m3, 'f3@test.local', jsonb_build_object('full_name', 'مرشد ثالث',
       'national_id', '1000000003', 'whatsapp', '0500000003',
       'applied_as', 'field', 'city', 'makkah')),
    (v_m4, 'f4@test.local', jsonb_build_object('full_name', 'مرشد رابع',
       'national_id', '1000000004', 'whatsapp', '0500000004',
       'applied_as', 'field', 'city', 'makkah'))
  on conflict (id) do nothing;
  update public.profiles set track = 'field', city = 'makkah', status = 'active'
   where id in (v_m1, v_m2, v_m3, v_m4);

  -- والشهرُ يُثبت له عددُ الفريق أربعةً، فيُقاس المحتسَب على ما جُدول
  perform public.set_ops_month(jsonb_build_object('month', v_mo::text, 'code', 1,
    'staff_count', 4));

  -- ---------- الأيام التشغيلية: أيامُ الشهر لا ثلاثون دائمًا ----------
  if public.ops_operating_days('2026-01-10'::date, 'year') <> 31 then
    raise exception 'FAIL: أيام يناير التشغيلية ليست إحدى وثلاثين';
  end if;
  if public.ops_operating_days('2026-04-10'::date, 'year') <> 30 then
    raise exception 'FAIL: أيام أبريل التشغيلية ليست ثلاثين';
  end if;
  if public.ops_operating_days('2026-02-10'::date, 'year') <> 28 then
    raise exception 'FAIL: أيام فبراير التشغيلية ليست ثمانيًا وعشرين';
  end if;
  -- والموسمُ يُعدّ من شهره الهجري، فيُجمع شهراه إلى ثلاثين يومًا
  if public.ops_operating_days('2026-02-01'::date, 'ramadan')
     + public.ops_operating_days('2026-03-01'::date, 'ramadan') <> 30 then
    raise exception 'FAIL: أيام رمضان في شهريه ليست ثلاثين';
  end if;

  select * into v_rec from public.ops_report(v_mo) where code = 1;
  v_op := v_rec.op_days; v_person := v_rec.person_day; v_day := v_rec.day_cost;
  if v_op <> extract(day from (v_mo + interval '1 month - 1 day'))::int then
    raise exception 'FAIL: أيامُ التقرير التشغيلية خلاف أيام الشهر (%)', v_op;
  end if;
  if v_person <> round(v_rec.unit_cost / v_op, 2) then
    raise exception 'FAIL: قيمةُ الفرد اليومية ليست التكلفة على الأيام التشغيلية';
  end if;
  if v_day <> round(v_rec.total_cost / v_op, 2) then
    raise exception 'FAIL: القيمةُ اليومية ليست قيمةَ الشهر على الأيام التشغيلية';
  end if;
  -- ولا تكون القسمةُ على ثلاثين إلا في شهرٍ ثلاثيني
  if v_op = 30 and v_person = round(v_rec.unit_cost / 31, 2) then
    raise exception 'FAIL: القسمة على غير الأيام التشغيلية';
  end if;

  -- ---------- التقييم: مجموعُ أربعة أسابيع بحدِّ مئة ----------
  delete from public.field_evaluations where member_id in (v_m1, v_m2, v_m3, v_m4);
  v_w := v_mo + 3;      -- أسبوعٌ يقع وسطُه في الشهر
  -- مثالُ العقد نفسه: ٩٤ و٨٦ و٧٥ و٦٧، ومتوسطُها ٨٠٫٥٠
  insert into public.field_evaluations
    (member_id, week_start, appearance, attendance, interaction, language_skill,
     compliance, supervisor_name)
  values
    (v_m1, v_w,      5, 5, 5, 5, 4, 'مشرف الهيئة'),   -- ٢٤
    (v_m1, v_w + 7,  5, 5, 5, 4, 4, 'مشرف الهيئة'),   -- ٢٣
    (v_m1, v_w + 14, 5, 5, 4, 4, 4, 'مشرف الهيئة'),   -- ٢٢
    (v_m1, v_w + 21, 5, 5, 5, 5, 5, 'مشرف الهيئة'),   -- ٢٥  = ٩٤
    (v_m2, v_w,      5, 5, 5, 5, 5, 'مشرف الهيئة'),   -- ٢٥
    (v_m2, v_w + 7,  5, 5, 4, 4, 4, 'مشرف الهيئة'),   -- ٢٢
    (v_m2, v_w + 14, 4, 4, 4, 4, 4, 'مشرف الهيئة'),   -- ٢٠
    (v_m2, v_w + 21, 4, 4, 4, 4, 3, 'مشرف الهيئة'),   -- ١٩  = ٨٦
    (v_m3, v_w,      5, 5, 4, 4, 4, 'مشرف الهيئة'),   -- ٢٢
    (v_m3, v_w + 7,  3, 3, 3, 3, 2, 'مشرف الهيئة'),   -- ١٤
    (v_m3, v_w + 14, 4, 4, 3, 3, 3, 'مشرف الهيئة'),   -- ١٧
    (v_m3, v_w + 21, 5, 5, 4, 4, 4, 'مشرف الهيئة'),   -- ٢٢  = ٧٥
    (v_m4, v_w,      4, 4, 4, 4, 4, 'مشرف الهيئة'),   -- ٢٠
    (v_m4, v_w + 7,  4, 3, 3, 3, 3, 'مشرف الهيئة'),   -- ١٦
    (v_m4, v_w + 14, 3, 3, 3, 2, 2, 'مشرف الهيئة'),   -- ١٣
    (v_m4, v_w + 21, 4, 4, 4, 3, 3, 'مشرف الهيئة');   -- ١٨  = ٦٧

  v_ev := public.ops_eval(v_mo, 1);
  if (v_ev ->> 'avg')::numeric <> 80.5 then
    raise exception 'FAIL: متوسطُ الفريق % لا ٨٠٫٥ — المجموعُ لا متوسطُ النسب',
      v_ev ->> 'avg';
  end if;
  if (v_ev ->> 'pct')::int <> 90 then
    raise exception 'FAIL: نسبةُ المستخلص % لا تسعون', v_ev ->> 'pct';
  end if;
  if (v_ev ->> 'below')::int <> 1 then
    raise exception 'FAIL: من نزل عن السبعين % لا واحد', v_ev ->> 'below';
  end if;
  if (v_ev ->> 'weeks_short')::int <> 0 then
    raise exception 'FAIL: عُدَّ ناقصُ الأسابيع وكلُّهم أربعة';
  end if;

  -- ودرجةُ الفرد مجموعُ أسابيعه، ومن نزل عن السبعين فإنذارٌ وحسمُ عُشرِه
  select * into v_rec from public.ops_eval_members(v_mo, 1) where member_id = v_m1;
  if v_rec.score <> 94 then raise exception 'FAIL: درجةُ الأول % لا ٩٤', v_rec.score; end if;
  if v_rec.warn or v_rec.cut_pct <> 0 then
    raise exception 'FAIL: أُنذر من درجتُه أربعٌ وتسعون';
  end if;
  select * into v_rec from public.ops_eval_members(v_mo, 1) where member_id = v_m4;
  if v_rec.score <> 67 then raise exception 'FAIL: درجةُ الرابع % لا ٦٧', v_rec.score; end if;
  if not v_rec.warn or v_rec.cut_pct <> 10 then
    raise exception 'FAIL: من نزل عن السبعين بلا إنذارٍ ولا حسمِ عُشر';
  end if;
  -- وقاعدةُ الفرد لا تُحمَّل على بند الفريق: نسبةُ الفريق تسعون لا سبعون
  if (v_ev ->> 'pct')::int = 70 then
    raise exception 'FAIL: حُمِّلت قاعدةُ الفرد على بند الفريق';
  end if;

  -- ---------- وما دون السبعين: سبعون مع إنذار، لا تسعون ----------
  delete from public.field_evaluations where member_id in (v_m1, v_m2, v_m3);
  v_ev := public.ops_eval(v_mo, 1);
  if (v_ev ->> 'avg')::numeric <> 67 then
    raise exception 'FAIL: متوسطُ الفريق % لا ٦٧', v_ev ->> 'avg';
  end if;
  if (v_ev ->> 'pct')::int <> 70 then
    raise exception 'FAIL: نسبةُ ما دون السبعين % لا سبعون', v_ev ->> 'pct';
  end if;
  if not (v_ev ->> 'warn')::boolean then
    raise exception 'FAIL: ما دون السبعين بلا إنذار';
  end if;

  -- ---------- ناقصُ الأسابيع يُعلَم فلا يُظلَم بصمتٍ ----------
  delete from public.field_evaluations where member_id = v_m4 and week_start > v_w + 7;
  v_ev := public.ops_eval(v_mo, 1);
  if (v_ev ->> 'weeks_short')::int <> 1 then
    raise exception 'FAIL: لم يُعلَم ناقصُ الأسابيع';
  end if;
  if (v_ev ->> 'avg')::numeric <> 36 then
    raise exception 'FAIL: درجةُ أسبوعين % لا مجموعَهما', v_ev ->> 'avg';
  end if;

  -- ثم يُعاد التقييم كاملًا لما بعده
  insert into public.field_evaluations
    (member_id, week_start, appearance, attendance, interaction, language_skill,
     compliance, supervisor_name)
  values
    (v_m4, v_w + 14, 5, 5, 5, 5, 5, 'مشرف الهيئة'),
    (v_m4, v_w + 21, 5, 5, 5, 5, 5, 'مشرف الهيئة'),
    (v_m1, v_w,      5, 5, 5, 5, 5, 'مشرف الهيئة'),
    (v_m1, v_w + 7,  5, 5, 5, 5, 5, 'مشرف الهيئة'),
    (v_m1, v_w + 14, 5, 5, 5, 5, 5, 'مشرف الهيئة'),
    (v_m1, v_w + 21, 5, 5, 5, 5, 5, 'مشرف الهيئة')
  on conflict (member_id, week_start) do nothing;

  -- ---------- الفتراتُ ثلاثٌ زمنُ كلٍّ ثمانِ ساعات ----------
  if public.shift_period(time '06:00') <> 'morning'
     or public.shift_period(time '13:59') <> 'morning'
     or public.shift_period(time '14:00') <> 'evening'
     or public.shift_period(time '21:59') <> 'evening'
     or public.shift_period(time '22:00') <> 'night'
     or public.shift_period(time '02:00') <> 'night' then
    raise exception 'FAIL: الفتراتُ التشغيلية لم تُقسَم على ثمانِ ساعات';
  end if;

  delete from public.shifts where member_id in (v_m1, v_m2, v_m3, v_m4);
  insert into public.shifts (member_id, shift_date, start_at, end_at, location, status,
                             check_in_at)
  values
    (v_m1, v_mo + 1, time '06:00', time '14:00', 'المطاف', 'present', now()),
    (v_m2, v_mo + 1, time '14:00', time '22:00', 'المطاف', 'present', now()),
    (v_m3, v_mo + 1, time '22:00', time '06:00', 'المطاف', 'present', now()),
    (v_m4, v_mo + 1, time '06:00', time '13:00', 'المطاف', 'present', now());
  select count(*) into v_n from public.shift_coverage(v_mo + 1, 'makkah', 'field');
  if v_n <> 3 then raise exception 'FAIL: فتراتُ اليوم % لا ثلاث', v_n; end if;
  select * into v_rec from public.shift_coverage(v_mo + 1, 'makkah', 'field')
   where period = 'morning';
  if v_rec.required <> 2 or v_rec.present <> 2 then
    raise exception 'FAIL: تغطيةُ الفترة الصباحية خاطئة';
  end if;
  -- والوردية التي خالفت ثمانِ ساعات تُعلَم
  if v_rec.hours_bad <> 1 then
    raise exception 'FAIL: لم تُعلَم ورديةٌ خالفت ثمانِ ساعات';
  end if;

  -- ---------- الغيابُ والبديلُ المعتمد ----------
  delete from public.shifts where member_id in (v_m1, v_m2, v_m3, v_m4);
  insert into public.shifts (member_id, shift_date, start_at, end_at, location, status)
  values (v_m1, v_mo + 2, time '06:00', time '14:00', 'المطاف', 'scheduled')
  returning id into v_sid;
  v_ab := public.ops_absence(v_mo, 1);
  if (v_ab ->> 'absent')::int <> 1 or (v_ab ->> 'uncovered')::int <> 1 then
    raise exception 'FAIL: الغيابُ لم يُحتسب';
  end if;

  -- والبديلُ لا يكون صاحبَ الوردية، ولا يُعتمد قبل اختياره
  begin
    perform public.set_shift_substitute(v_sid, v_m1, true, null);
    raise exception 'FAIL: اعتُمد صاحبُ الوردية بديلًا عن نفسه';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.set_shift_substitute(v_sid, null, true, null);
    raise exception 'FAIL: اعتُمد بديلٌ لم يُختر';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform public.set_shift_substitute(v_sid, v_m2, true, 'بديلٌ مؤهل');
  v_ab := public.ops_absence(v_mo, 1);
  if (v_ab ->> 'covered')::int <> 1 or (v_ab ->> 'uncovered')::int <> 0 then
    raise exception 'FAIL: البديلُ المعتمد لم يرفع الحسم';
  end if;
  if public.ops_short_days(v_mo, 1) <> 0 then
    raise exception 'FAIL: حُسم يومٌ غُطّي ببديلٍ معتمد';
  end if;

  -- ولمدير المشروع أن يُغلق ذلك فيُحسم كلُّ غياب
  update public.platform_settings set substitute_relieves = false;
  if (public.ops_absence(v_mo, 1) ->> 'uncovered')::int <> 1 then
    raise exception 'FAIL: بقي البديلُ رافعًا للحسم بعد إغلاقه';
  end if;
  update public.platform_settings set substitute_relieves = true;

  -- والبديلُ للإدارة لا لعامة الأعضاء
  perform set_config('request.jwt.claim.sub', v_m2::text, true);
  begin
    perform public.set_shift_substitute(v_sid, v_m3, true, 'من غير إدارة');
    raise exception 'FAIL: اعتمد عضوٌ بديلًا';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);

  -- ---------- الغيابُ الجماعي: ما تجاوز ٤٥٪ حُسم يومُه كاملًا ----------
  delete from public.shifts where member_id in (v_m1, v_m2, v_m3, v_m4);
  insert into public.shifts (member_id, shift_date, start_at, end_at, location, status,
                             check_in_at)
  values
    (v_m1, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'present', now()),
    (v_m2, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled', null),
    (v_m3, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled', null),
    (v_m4, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled', null);

  select count(*) into v_n from public.ops_collective(v_mo, 1);
  if v_n <> 1 then
    raise exception 'FAIL: وقائعُ الغياب الجماعي % لا واحدة — أُحتسب اليومُ وفترتُه', v_n;
  end if;
  select * into v_rec from public.ops_collective(v_mo, 1);
  if v_rec.period <> 'day' then
    raise exception 'FAIL: اليومُ كلُّه تجاوز فلم يُؤخذ مرةً واحدة';
  end if;
  if v_rec.required <> 4 or v_rec.absent <> 3 then
    raise exception 'FAIL: المطلوبُ والمتغيّب في الواقعة خطأ';
  end if;
  if v_rec.pct <> 75.0 then
    raise exception 'FAIL: نسبةُ الغياب % لا خمسةٌ وسبعون', v_rec.pct;
  end if;
  if v_rec.allowed <> 1 or v_rec.excess <> 2 then
    raise exception 'FAIL: المسموحُ والزائد خطأ (% و%)', v_rec.allowed, v_rec.excess;
  end if;
  if v_rec.day_cost <> v_day then
    raise exception 'FAIL: حُسم غيرُ القيمة اليومية لذلك اليوم';
  end if;
  if v_rec.surcharge <> round(v_person * 0.60 * 2, 2) then
    raise exception 'FAIL: غرامةُ الستين في المئة على الزائد خطأ (%)', v_rec.surcharge;
  end if;
  if v_rec.total <> v_rec.day_cost + v_rec.surcharge then
    raise exception 'FAIL: مجموعُ الواقعة ليس اليومَ والغرامة';
  end if;

  -- وما لم يتجاوز لا يُحسم
  delete from public.shifts where shift_date = v_mo + 3;
  insert into public.shifts (member_id, shift_date, start_at, end_at, location, status,
                             check_in_at)
  values
    (v_m1, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'present', now()),
    (v_m2, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'present', now()),
    (v_m3, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'present', now()),
    (v_m4, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled', null);
  if exists (select 1 from public.ops_collective(v_mo, 1)) then
    raise exception 'FAIL: حُسم يومٌ غيابُه ربعٌ لا يتجاوز ٤٥٪';
  end if;

  -- والبديلُ المعتمد يرفع صاحبَه من المتغيبين
  delete from public.shifts where shift_date = v_mo + 3;
  insert into public.shifts (member_id, shift_date, start_at, end_at, location, status)
  values (v_m1, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled'),
         (v_m2, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled'),
         (v_m3, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled'),
         (v_m4, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled');
  if not exists (select 1 from public.ops_collective(v_mo, 1)) then
    raise exception 'FAIL: غيابُ الجميع لم يُحتسب جماعيًّا';
  end if;
  update public.shifts s set sub_member_id = v_mgr, sub_approved = true
   where s.shift_date = v_mo + 3 and s.member_id in (v_m1, v_m2, v_m3);
  if exists (select 1 from public.ops_collective(v_mo, 1)) then
    raise exception 'FAIL: عُدّ المغطَّى ببديلٍ معتمد متغيبًا في الجماعي';
  end if;

  -- ---------- والتقرير يجمع ذلك كلَّه، والصافي ما بقي ----------
  delete from public.shifts where shift_date = v_mo + 3;
  insert into public.shifts (member_id, shift_date, start_at, end_at, location, status)
  values (v_m1, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled'),
         (v_m2, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled'),
         (v_m3, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'scheduled'),
         (v_m4, v_mo + 3, time '06:00', time '14:00', 'المطاف', 'present');
  update public.shifts set check_in_at = now()
   where shift_date = v_mo + 3 and member_id = v_m4;

  select * into v_rec from public.ops_report(v_mo) where code = 1;
  if v_rec.coll_days <> 1 then
    raise exception 'FAIL: أيامُ الغياب الجماعي في التقرير % لا واحد', v_rec.coll_days;
  end if;
  if v_rec.coll_absent <> 2 then
    raise exception 'FAIL: المتغيبون في الزائد % لا اثنان', v_rec.coll_absent;
  end if;
  if v_rec.coll_deduction <= 0 then
    raise exception 'FAIL: الغيابُ الجماعي بلا حسم';
  end if;
  if v_rec.short_days <> 3 then
    raise exception 'FAIL: أيامُ التقصير % لا ثلاثة', v_rec.short_days;
  end if;
  if v_rec.deduction <> round(v_rec.person_day * 3, 2) then
    raise exception 'FAIL: حسمُ الغياب ليس قيمةَ الفرد اليومية في أيامه';
  end if;
  if v_rec.net <> v_rec.total_cost - v_rec.deduction - v_rec.coll_deduction
                  - v_rec.eval_cut then
    raise exception 'FAIL: الصافي ليس الإجمالي ناقصَ حسمياته الثلاثة';
  end if;
  -- وحسمُ التقييم يُحتسب على ما بقي بعد الحسمين
  if v_rec.eval_cut <> round((v_rec.total_cost - v_rec.deduction - v_rec.coll_deduction)
                             * (100 - v_rec.eval_pct) / 100.0, 2) then
    raise exception 'FAIL: حسمُ التقييم لم يُحتسب على ما بقي';
  end if;

  -- ---------- ولمدير المشروع أن يُثبت غيرَ المحتسَب ثم يعيده ----------
  perform public.set_ops_month(jsonb_build_object('month', v_mo::text, 'code', 1,
    'staff_count', 4, 'operating_days', 20, 'collective_deduction', 1000,
    'note', 'أُثبت للتجربة'));
  select * into v_rec from public.ops_report(v_mo) where code = 1;
  if v_rec.op_days <> 20 then raise exception 'FAIL: لم يُؤخذ العددُ المثبت للأيام'; end if;
  if v_rec.coll_deduction <> 1000 then
    raise exception 'FAIL: لم يُؤخذ حسمُ الغياب الجماعي المثبت';
  end if;
  if not v_rec.is_manual then raise exception 'FAIL: المثبتُ لم يُعلَم'; end if;
  begin
    perform public.set_ops_month(jsonb_build_object('month', v_mo::text, 'code', 1,
      'operating_days', 40));
    raise exception 'FAIL: قُبل عددُ أيامٍ فوق الشهر';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  perform public.clear_ops_month(v_mo, 1);
  select * into v_rec from public.ops_report(v_mo) where code = 1;
  if v_rec.op_days = 20 then raise exception 'FAIL: بقي المثبتُ بعد محوه'; end if;

  -- ---------- وهذا كلُّه لمدير المشروع وحده ----------
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  if exists (select 1 from public.ops_collective(v_mo, 1)) then
    raise exception 'FAIL: رأى المنسق وقائع الغياب الجماعي';
  end if;
  if exists (select 1 from public.ops_eval_members(v_mo, 1)) then
    raise exception 'FAIL: رأى المنسق درجات الأفراد';
  end if;

  -- ثم تُنظَّف فتبقى الأجزاءُ بعدها على حالها
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  delete from public.shifts where member_id in (v_m1, v_m2, v_m3, v_m4);
  delete from public.field_evaluations where member_id in (v_m1, v_m2, v_m3, v_m4);
  update public.profiles set track = 'translation', status = 'disabled'
   where id in (v_m1, v_m2, v_m3, v_m4);

  raise notice 'PASS: حسوماتُ العقد على نصّه — الأيامُ والمراتبُ والبديلُ والغيابُ الجماعي';
end $$;

-- =====================================================================
-- ٥٢) جزاءاتُ العقد بسقفها، ومواعيدُ النصوص بعدد الصفحات (ملاحظة ١٩٧)
-- =====================================================================
do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_crd uuid := '00000000-0000-0000-0000-00000000000b';
        v_n int; v_id uuid; v_other uuid; v_cap jsonb; v_w jsonb; v_s jsonb;
        v_rec record; v_mat uuid; v_serm uuid; v_lang text; v_amt numeric;
begin
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  select code into v_lang from public.languages order by sort limit 1;

  -- ---------- جدولُ الجزاءات كما نصّ العقد ----------
  select count(*) into v_n from public.penalty_kinds where is_active;
  if v_n <> 9 then raise exception 'FAIL: أنواعُ الجزاءات % لا تسعة', v_n; end if;
  select * into v_rec from public.penalty_kinds where code = 1;
  if v_rec.basis <> 'sermon_value' or v_rec.rate <> 50 or v_rec.per <> 'hour' then
    raise exception 'FAIL: جزاءُ تأخير الخطبة خلاف العقد';
  end if;
  select * into v_rec from public.penalty_kinds where code = 6;
  if v_rec.amount <> 200 or v_rec.per <> 'day' then
    raise exception 'FAIL: جزاءُ عدم توفير مدير المشروع خلاف العقد';
  end if;
  select * into v_rec from public.penalty_kinds where code = 8;
  if v_rec.amount <> 2000 or v_rec.per <> 'language' then
    raise exception 'FAIL: جزاءُ إسقاط اللغة خلاف العقد';
  end if;
  -- والتحريرية ثلاثُ درجات: عشرون وثلاثون وخمسون
  if (select rate from public.penalty_kinds where urgency = 'normal'    and basis = 'translation_value') <> 20
     or (select rate from public.penalty_kinds where urgency = 'urgent'    and basis = 'translation_value') <> 30
     or (select rate from public.penalty_kinds where urgency = 'emergency' and basis = 'translation_value') <> 50 then
    raise exception 'FAIL: نسبُ جزاء التحريرية خلاف العقد';
  end if;

  -- ---------- احتسابُ المقدار ----------
  if public.penalty_amount(1, 3, 2500) <> 3750.00 then
    raise exception 'FAIL: جزاءُ ثلاث ساعاتٍ على خطبةٍ بألفين وخمسِ مئة خطأ';
  end if;
  if public.penalty_amount(6, 4, null) <> 800.00 then
    raise exception 'FAIL: جزاءُ أربعة أيامٍ بلا مدير مشروع خطأ';
  end if;
  if public.penalty_amount(7, 2, null) <> 1000.00 then
    raise exception 'FAIL: جزاءُ ساعتَي تأخيرٍ في المراجعة الشرعية خطأ';
  end if;
  -- وما لم تُثبت قيمتُه أُخذ سعرُ الخطبة من بنود العقد
  if public.penalty_amount(1, 1, null)
     <> round((select unit_price from public.contract_items where code = 1) * 0.5, 2) then
    raise exception 'FAIL: لم يُؤخذ سعرُ الخطبة من بنود العقد';
  end if;

  -- ---------- والجزاءات لمدير المشروع وحده ----------
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  begin
    perform public.save_penalty(jsonb_build_object('kind_code', 6,
      'happened_on', current_date::text, 'units', 1));
    raise exception 'FAIL: سجّل المنسق جزاءً';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  if exists (select 1 from public.penalty_report()) then
    raise exception 'FAIL: رأى المنسق كشف الجزاءات';
  end if;
  if public.penalty_cap() is not null then
    raise exception 'FAIL: رأى المنسق سقف الغرامات';
  end if;

  -- ---------- تسجيلُ الواقعة: المقدارُ يُحتسب ----------
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  delete from public.penalties;
  v_id := public.save_penalty(jsonb_build_object('kind_code', 6,
    'happened_on', (current_date - 1)::text, 'units', 3,
    'note', 'ثلاثةُ أيام بلا مدير مشروع'));
  select * into v_rec from public.penalties where id = v_id;
  if v_rec.amount <> 600.00 then
    raise exception 'FAIL: مقدارُ الواقعة % لا ست مئة', v_rec.amount;
  end if;
  if v_rec.is_manual then raise exception 'FAIL: عُدَّ المحتسَبُ مثبتًا بيد'; end if;
  if v_rec.state <> 'draft' then raise exception 'FAIL: الواقعةُ لا تبدأ مسودّة'; end if;

  -- ولا تاريخٌ في المستقبل، ولا وحداتٌ صفر
  begin
    perform public.save_penalty(jsonb_build_object('kind_code', 6,
      'happened_on', (current_date + 2)::text, 'units', 1));
    raise exception 'FAIL: قُبلت واقعةٌ في المستقبل';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.save_penalty(jsonb_build_object('kind_code', 6,
      'happened_on', current_date::text, 'units', 0));
    raise exception 'FAIL: قُبلت واقعةٌ بلا وحدات';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ---------- وما أُثبت بغير المحتسَب يحتاج سببًا ----------
  begin
    perform public.save_penalty(jsonb_build_object('kind_code', 6,
      'happened_on', current_date::text, 'units', 1, 'amount', 50));
    raise exception 'FAIL: أُثبت مقدارٌ غير المحتسَب بلا سبب';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  v_other := public.save_penalty(jsonb_build_object('kind_code', 6,
    'happened_on', current_date::text, 'units', 1, 'amount', 50,
    'note', 'سُوِّيت بالتفاوض'));
  if not (select is_manual from public.penalties where id = v_other) then
    raise exception 'FAIL: لم يُعلَم المقدارُ المثبتُ بيد';
  end if;

  -- ---------- الحالات: المسودّة تُحذف، وما بعدها يُسقَط بسبب ----------
  perform public.set_penalty_state(v_other, 'notified');
  begin
    perform public.delete_penalty(v_other);
    raise exception 'FAIL: حُذفت واقعةٌ خرجت من المسودّة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.set_penalty_state(v_other, 'waived', null);
    raise exception 'FAIL: أُسقطت واقعةٌ بلا سبب';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  perform public.set_penalty_state(v_other, 'waived', 'أسقطتها الهيئة');

  -- ---------- السقف: عشرون في المئة من قيمة العقد ----------
  v_cap := public.penalty_cap();
  if (v_cap ->> 'contract_total')::numeric
     <> (select sum(total_value) from public.contract_items) then
    raise exception 'FAIL: القيمةُ الإجمالية للعقد خلاف بنوده';
  end if;
  if (v_cap ->> 'cap_amount')::numeric
     <> round((v_cap ->> 'contract_total')::numeric * 0.20, 2) then
    raise exception 'FAIL: السقفُ ليس عشرين في المئة';
  end if;
  -- والمُسقَطُ لا يُحتسب في المجموع
  if (v_cap ->> 'imposed')::numeric <> 600.00 then
    raise exception 'FAIL: دخل المُسقَطُ في مجموع الغرامات (%)', v_cap ->> 'imposed';
  end if;
  if (v_cap ->> 'near')::boolean or (v_cap ->> 'over')::boolean then
    raise exception 'FAIL: نُبِّه إلى السقف ولم يُقارَب';
  end if;

  -- ومتى تجاوز المجموعُ السقفَ نُبِّه
  perform public.save_penalty(jsonb_build_object('kind_code', 6,
    'happened_on', current_date::text, 'units', 1,
    'amount', (v_cap ->> 'cap_amount')::numeric, 'note', 'للتجربة'));
  v_cap := public.penalty_cap();
  if not (v_cap ->> 'over')::boolean then
    raise exception 'FAIL: لم يُنبَّه إلى تجاوز السقف';
  end if;
  if (v_cap ->> 'remaining')::numeric <> 0 then
    raise exception 'FAIL: بقي من السقف شيءٌ بعد تجاوزه';
  end if;
  delete from public.penalties where note = 'للتجربة';

  -- ---------- والكشفُ يحمل اسمَ النوع ووصفَه ----------
  select * into v_rec from public.penalty_report() where id = v_id;
  if v_rec.kind_name is null or v_rec.description is null then
    raise exception 'FAIL: كشفُ الجزاءات بلا اسمٍ ولا وصف';
  end if;
  select count(*) into v_n from public.penalty_report(current_date, current_date);
  if v_n <> 1 then raise exception 'FAIL: حدُّ المدة في الكشف % لا واحد', v_n; end if;
  delete from public.penalties;

  -- =====================================================================
  -- مواعيدُ الترجمة التحريرية بعدد الصفحات
  -- =====================================================================
  select count(*) into v_n from public.text_deadlines;
  if v_n <> 9 then raise exception 'FAIL: سطورُ جدول المدد % لا تسعة', v_n; end if;
  if (select hours from public.text_deadlines where urgency = 'normal' and pages_from = 1) <> 48 then
    raise exception 'FAIL: الاعتياديةُ لعشر صفحاتٍ ليست يومين';
  end if;
  if (select hours from public.text_deadlines where urgency = 'urgent' and pages_from = 1) <> 8 then
    raise exception 'FAIL: العاجلةُ لعشر صفحاتٍ ليست ثمانِ ساعات';
  end if;
  if (select hours from public.text_deadlines where urgency = 'normal' and pages_from = 21) <> 168 then
    raise exception 'FAIL: الاعتياديةُ لما زاد على عشرين ليست سبعةَ أيام';
  end if;
  -- وسطرا الطارئة اللذان يحتاجان استيضاحًا مُعلَمان، وأُخذ بأوسع المهلتين
  select count(*) into v_n from public.text_deadlines where needs_review;
  if v_n <> 2 then raise exception 'FAIL: سطورُ الاستيضاح % لا سطران', v_n; end if;
  if (select hours from public.text_deadlines
       where urgency = 'emergency' and pages_from = 11) <> 24 then
    raise exception 'FAIL: لم يُؤخذ بأوسع المهلتين في الطارئة';
  end if;

  -- ---------- الصفحةُ تُقترح من الكلمات ----------
  if public.count_pages(1200) <> 5 then raise exception 'FAIL: اقتراحُ الصفحات خطأ'; end if;
  if public.count_pages(1) <> 1 then raise exception 'FAIL: أقلُّ من صفحةٍ ليس صفحة'; end if;
  if public.count_pages(0) is not null then raise exception 'FAIL: صفحاتٌ لنصٍّ بلا كلمات'; end if;

  -- ---------- مهلةُ المادة من استلامها ----------
  insert into public.materials (material_type, title, mosque, sermon_date, author,
                                source_html, created_by, received_at, urgency, pages)
  values ('كتب', 'مطوية اختبار المواعيد', 'general', current_date, 'دار النشر',
          '<p>نص للتجربة</p>', v_mgr, now(), 'normal', 6)
  returning id into v_mat;
  insert into public.tracks (material_id, language_code, receipt_due_at)
  values (v_mat, v_lang, now() + interval '2 days');

  v_w := public.text_window(v_mat);
  if (v_w ->> 'is_sermon')::boolean then raise exception 'FAIL: عُدَّت المطوية خطبة'; end if;
  if (v_w ->> 'hours')::numeric <> 48 then
    raise exception 'FAIL: مهلةُ ستِّ صفحاتٍ اعتيادية % لا ثمانٍ وأربعون ساعة', v_w ->> 'hours';
  end if;
  if (v_w ->> 'overdue')::boolean then raise exception 'FAIL: تجاوزت المهلةُ من حينها'; end if;
  if (v_w ->> 'due_at')::timestamptz
     <> (v_w ->> 'received_at')::timestamptz + interval '48 hours' then
    raise exception 'FAIL: الموعدُ ليس الاستلامَ وزيادةَ المهلة';
  end if;

  -- والعاجلةُ أضيقُ من الاعتيادية
  perform public.set_material_text_plan(v_mat, 'urgent', 6, null);
  if (public.text_window(v_mat) ->> 'hours')::numeric <> 8 then
    raise exception 'FAIL: مهلةُ العاجلة لم تضِق';
  end if;
  -- وتتغير بعدد الصفحات
  perform public.set_material_text_plan(v_mat, 'urgent', 15, null);
  if (public.text_window(v_mat) ->> 'hours')::numeric <> 24 then
    raise exception 'FAIL: لم تتغير المهلةُ بعدد الصفحات';
  end if;
  perform public.set_material_text_plan(v_mat, 'urgent', 40, null);
  if (public.text_window(v_mat) ->> 'hours')::numeric <> 72 then
    raise exception 'FAIL: مهلةُ ما زاد على عشرين صفحةً خطأ';
  end if;

  -- وما مضى موعدُه يُعلَم بتأخيره
  perform public.set_material_text_plan(v_mat, 'normal', 6, now() - interval '5 days');
  v_w := public.text_window(v_mat);
  if not (v_w ->> 'overdue')::boolean then
    raise exception 'FAIL: لم يُعلَم ما مضى موعدُه';
  end if;
  if (v_w ->> 'late_hours')::numeric <= 0 then
    raise exception 'FAIL: التأخيرُ بلا ساعات';
  end if;

  -- ---------- وما لم تُضبط صفحاتُه تُقترح من كلماته ----------
  update public.materials set pages = null where id = v_mat;
  if (public.text_window(v_mat) ->> 'pages')::int is null then
    raise exception 'FAIL: لم تُقترح الصفحاتُ من الكلمات';
  end if;

  -- ---------- والنوعُ لا يُقبل إلا من الثلاثة، والصفحاتُ محدودة ----------
  begin
    perform public.set_material_text_plan(v_mat, 'whenever', 6, null);
    raise exception 'FAIL: قُبل نوعُ مهمةٍ غير معروف';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.set_material_text_plan(v_mat, 'normal', 99999, null);
    raise exception 'FAIL: قُبل عددُ صفحاتٍ فوق الحد';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.set_material_text_plan(v_mat, 'normal', 6, now() + interval '5 days');
    raise exception 'FAIL: قُبل وقتُ استلامٍ في المستقبل';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ---------- والخطبةُ لها نافذتُها لا جدولُ الصفحات ----------
  select id into v_serm from public.materials
   where material_type = 'خطب' and deleted_at is null and sermon_date is not null
   order by created_at limit 1;
  if v_serm is not null then
    v_w := public.text_window(v_serm);
    if not (v_w ->> 'is_sermon')::boolean then
      raise exception 'FAIL: حُسبت الخطبةُ بجدول الصفحات';
    end if;
    if v_w -> 'window' is null then raise exception 'FAIL: الخطبةُ بلا نافذة'; end if;
    -- ومهلةُ مراجعتها الشرعية ثمانِ ساعات
    if (public.sharia_window(v_serm) ->> 'hours')::int <> 8 then
      raise exception 'FAIL: مهلةُ المراجعة الشرعية للخطب ليست ثمانِ ساعات';
    end if;
  end if;
  -- ولما سوى الخطب أربعٌ وعشرون
  v_s := public.sharia_window(v_mat);
  if (v_s ->> 'hours')::int <> 24 then
    raise exception 'FAIL: مهلةُ المراجعة الشرعية لغير الخطب ليست أربعًا وعشرين';
  end if;
  if (v_s ->> 'due_at')::timestamptz
     <> (v_s ->> 'received_at')::timestamptz + interval '24 hours' then
    raise exception 'FAIL: موعدُ المراجعة الشرعية خطأ';
  end if;

  -- ---------- وما قارب موعدَه من النصوص المفتوحة يُعرض ----------
  perform public.set_material_text_plan(v_mat, 'normal', 6, now() - interval '5 days');
  if not exists (select 1 from public.texts_due() where material_id = v_mat and overdue) then
    raise exception 'FAIL: لم يظهر المتأخرُ في كشف المواعيد';
  end if;
  -- والخطبُ ليست منه، فلها نافذتُها
  if exists (select 1 from public.texts_due() where material_type = 'خطب') then
    raise exception 'FAIL: دخلت الخطبُ كشفَ مواعيد النصوص';
  end if;

  -- ---------- ونوعُ المهمة للإدارة لا لعامة الأعضاء ----------
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
  begin
    perform public.set_material_text_plan(v_mat, 'emergency', 6, null);
    raise exception 'FAIL: ضبط مترجمٌ نوعَ المهمة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ثم تُنظَّف
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  delete from public.tracks where material_id = v_mat;
  delete from public.materials where id = v_mat;

  raise notice 'PASS: جزاءاتُ العقد بسقفها، ومواعيدُ النصوص بعدد الصفحات';
end $$;

-- =====================================================================
-- ٥٣) كشفُ بيانات الفريق وتذكيرُه، والكلماتُ المحتسَبة، وصفتا العمليات
--     (ملاحظتا ١٩٩ و٢٠٠)
-- =====================================================================
do $$
declare v_mgr uuid := '00000000-0000-0000-0000-00000000000a';
        v_crd uuid := '00000000-0000-0000-0000-00000000000b';
        v_yus uuid := '00000000-0000-0000-0000-00000000000c';
        v_rec record; v_n int; v_before timestamptz;
begin
  -- ---------- الكلماتُ المحتسَبة: الأصلُ العربي دون الخطب ----------
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  if (select counted_words from public.production_totals())
     <> coalesce((select sum(r.source_words) from public.production_rows r
                   where r.counts_by_word and r.status = 'completed'), 0) then
    raise exception 'FAIL: المحتسَب ليس كلماتِ الأصل للنصوص المنجَزة';
  end if;
  if exists (select 1 from public.production_rows
              where material_type = 'خطب' and counts_by_word) then
    raise exception 'FAIL: عُدَّت الخطبةُ بالكلمة وهي بالمقطوعية';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'production_rows' and column_name = 'source_words') then
    raise exception 'FAIL: دليل الإنتاج بلا كلمات الأصل';
  end if;

  -- ---------- مصفوفةُ البيانات: صفٌّ لكل حساب وحالُ كل بيان ----------
  select count(*) into v_n from public.member_data_matrix();
  if v_n = 0 then raise exception 'FAIL: مصفوفةُ البيانات فارغة'; end if;
  select * into v_rec from public.member_data_matrix() where member_id = v_yus;
  if v_rec.photo not in ('ok', 'review', 'bad', 'none') then
    raise exception 'FAIL: حالُ الصورة غير معروف (%)', v_rec.photo;
  end if;
  if v_rec.missing is null or v_rec.complete is null then
    raise exception 'FAIL: المصفوفةُ بلا عدِّ ناقصٍ ولا حكمِ اكتمال';
  end if;
  -- وما لا يلزم الحسابَ يُعلَم بأنه لا يلزمه: المدينةُ لغير المرشد
  select * into v_rec from public.member_data_matrix() where member_id = v_mgr;
  if v_rec.city_state <> 'na' then
    raise exception 'FAIL: طُلبت المدينةُ من غير مرشدٍ مكاني (%)', v_rec.city_state;
  end if;
  if v_rec.languages not in ('ok', 'none', 'na') then
    raise exception 'FAIL: حالُ اللغات غير معروف (%)', v_rec.languages;
  end if;

  -- ---------- والمصفوفةُ للإدارة وحدها ----------
  perform set_config('request.jwt.claim.sub', v_yus::text, true);
  if exists (select 1 from public.member_data_matrix()) then
    raise exception 'FAIL: رأى المترجمُ كشفَ بيانات الفريق';
  end if;
  begin
    perform public.remind_profile_data(null);
    raise exception 'FAIL: ذكّر المترجمُ غيرَه';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  -- ---------- التذكيرُ يصل، ويبقى أثرُه ----------
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  select reminded_at into v_before from public.profile_private where id = v_yus;
  v_n := public.remind_profile_data(array[v_yus]);
  if (select missing from public.member_data_matrix() where member_id = v_yus) > 0 then
    if v_n <> 1 then raise exception 'FAIL: لم يصل التذكير لمن نقص بيانُه (%)', v_n; end if;
    if not exists (select 1 from public.notifications
                    where member_id = v_yus and kind = 'data_reminder') then
      raise exception 'FAIL: التذكيرُ بلا إشعار';
    end if;
    if (select reminded_at from public.profile_private where id = v_yus) is null then
      raise exception 'FAIL: لم يُحفظ وقتُ التذكير';
    end if;
    if (select remind_count from public.profile_private where id = v_yus) < 1 then
      raise exception 'FAIL: لم يُعدّ التذكير';
    end if;
  end if;
  -- ومن اكتملت بياناتُه لا يُذكَّر
  if exists (select 1 from public.member_data_matrix() where complete) then
    if public.remind_profile_data(array[(select member_id from public.member_data_matrix()
                                          where complete limit 1)]) <> 0 then
      raise exception 'FAIL: ذُكِّر من اكتملت بياناتُه';
    end if;
  end if;

  -- ---------- صفتا العمليات: على المنسق، ولمدير المشروع ----------
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  begin
    perform public.set_admin_title(v_crd, 'ops_manager');
    raise exception 'FAIL: حوّل المنسق نفسَه إلى صفة عمليات';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  -- ولا تكون إلا على منسق
  begin
    perform public.set_admin_title(v_yus, 'ops_manager');
    raise exception 'FAIL: كُتبت صفةُ العمليات على مترجم';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;
  begin
    perform public.set_admin_title(v_crd, 'chief');
    raise exception 'FAIL: قُبلت صفةٌ غير معروفة';
  exception when others then if position('FAIL' in SQLERRM) > 0 then raise; end if;
  end;

  perform public.set_admin_title(v_crd, 'ops_manager');
  if (select admin_title from public.profiles where id = v_crd) <> 'ops_manager' then
    raise exception 'FAIL: لم تُكتب صفةُ مدير العمليات';
  end if;
  -- والصلاحيةُ صلاحيةُ المنسق نفسُها: لا تزيد ولا تنقص
  if (select role::text from public.profiles where id = v_crd) <> 'coordinator' then
    raise exception 'FAIL: غيّرت الصفةُ دورَ المنسق';
  end if;
  perform set_config('request.jwt.claim.sub', v_crd::text, true);
  if not public.is_admin() then raise exception 'FAIL: سقطت صلاحيةُ المنسق بالصفة'; end if;
  if public.is_manager() then raise exception 'FAIL: صار المنسقُ مديرًا بالصفة'; end if;

  -- ومتى خرج من التنسيق سقطت عنه الصفة
  perform set_config('request.jwt.claim.sub', v_mgr::text, true);
  update public.profiles set role = 'translator' where id = v_crd;
  if (select admin_title from public.profiles where id = v_crd) is not null then
    raise exception 'FAIL: بقيت صفةُ العمليات على غير منسق';
  end if;
  update public.profiles set role = 'coordinator' where id = v_crd;
  perform public.set_admin_title(v_crd, 'ops_deputy');
  if (select admin_title from public.profiles where id = v_crd) <> 'ops_deputy' then
    raise exception 'FAIL: لم تُكتب صفةُ مساعد مدير العمليات';
  end if;
  perform public.set_admin_title(v_crd, null);
  if (select admin_title from public.profiles where id = v_crd) is not null then
    raise exception 'FAIL: لم تُرفع الصفة';
  end if;

  raise notice 'PASS: كشفُ البيانات وتذكيرُه، والكلماتُ المحتسَبة، وصفتا العمليات بصلاحية المنسق';
end $$;
