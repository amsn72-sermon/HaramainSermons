-- =====================================================================
-- 0109 — تنفيذُ الدوال مُغلَقٌ بأصله لا مفتوحٌ بأصله (ثغرةٌ قديمة)
--
--   في 0001 كُتب سطرٌ واحد:
--       revoke execute on all functions in schema public from public, anon;
--   وهو يصيب ما كان موجودًا يومئذٍ لا ما يُنشَأ بعدَه. وPostgreSQL
--   يمنح كلَّ دالةٍ جديدةٍ التنفيذَ لـ PUBLIC بأصلها، و anon عضوٌ في
--   PUBLIC. فكلُّ دالةٍ أُنشئت في 0002–0108 — وهي المئات — صارت
--   مفتوحةً للزائر الذي لم يُسجِّلْ دخولًا.
--
--   وأكثرُها محروسٌ من داخله: يسأل عن my_role() أو is_manager() فيردُّ
--   الزائرَ. لكنَّ طائفةً لا حارسَ لها، فيها ما يكتب:
--     page_set_section / page_prepend_block / page_set_card_icons
--         — تُعيد كتابةَ صفحات الموقع العامّ، وهي أدواتُ تهجيرٍ لا
--           واجهةٌ تُستدعى.
--     enqueue_notification — تُدخل بريدًا في طابور الإرسال بنصٍّ
--           يكتبه المُستدعي، باسم المنصة.
--     meet_base — تُفشي رابطَ القاعة ورمزَ بوّابتها، وقد نصَّت
--           ملاحظةٌ سابقةٌ على أنَّ رابط القاعة لا يُتداول.
--
--   فالعلاجُ من ثلاثة أوجه:
--   ١) يُلتقَط ما يصل إليه العضوُ اليومَ فيُثبَّت له، ثم يُنزَع التنفيذُ
--      عن PUBLIC و anon عن الدوالِّ كلِّها، ويُعاد إلى anon ما قُصد
--      كشفُه وحدَه (الموقعُ العامُّ والتحقّقُ من الوثائق).
--   ٢) ويُجعَل الأصلُ في الجديد الإغلاقَ: كلُّ دالةٍ تُنشَأ بعد اليوم
--      لا تنفيذَ فيها إلا بمنحٍ مكتوب.
--   ٣) ويُنزَع التنفيذُ عن الدوالِّ الداخليةِ التي لا تُستدعى من
--      الواجهة أصلًا — تُنادَى من داخل دوالَّ محروسةٍ فتعمل كما كانت.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) ما يصل إليه العضوُ اليومَ يبقى له، ولا يُفتَح له جديد
-- ---------------------------------------------------------------------
do $do$
declare r record;
begin
  create temp table _auth_keep as
    select p.oid, p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and has_function_privilege('authenticated', p.oid, 'execute');

  revoke execute on all functions in schema public from public;
  revoke execute on all functions in schema public from anon;

  for r in select sig from _auth_keep loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;

  drop table _auth_keep;
end $do$;

-- وما قُصد كشفُه للزائر يُعاد إليه وحدَه: الموقعُ العامُّ، وصفحاتُ
-- التعريف، والتحقّقُ من وثيقةٍ أو شهادةٍ أو بطاقة، وبابُ التسجيل،
-- ودوالُّ الصلاحية التي تُقيَّم داخل السياسات فتردُّ الزائرَ بـ«لا».
grant execute on function public.my_role(), public.is_admin(), public.is_manager(),
  public.is_supervisor(), public.can_view_reports(), public.is_viewer(),
  public.can_see_track(uuid), public.plain_text(text) to anon;
grant execute on function public.public_translations(text, int) to anon;
grant execute on function public.open_page(text, text) to anon;
grant execute on function public.page_needs_code(text) to anon;
grant execute on function public.registration_state() to anon;
grant execute on function public.registration_open() to anon;
grant execute on function public.verify_doc(text) to anon;
grant execute on function public.verify_certificate(text, text) to anon;
grant execute on function public.verify_card(text, text) to anon;
grant execute on function public.hijri_year(date) to anon;
grant execute on function public.hijri_year_calc(date) to anon;
grant execute on function public.hijri_month(date) to anon;
grant execute on function public.count_pages(int) to anon;

-- ---------------------------------------------------------------------
-- ٢) والأصلُ في الجديد الإغلاق: لا تنفيذَ إلا بمنحٍ مكتوب
-- ---------------------------------------------------------------------
--
--   و«alter default privileges … revoke execute on functions from public»
--   لا يُجدي: جُرِّب فبقي `=X/postgres` في كلِّ دالةٍ جديدة — فالمنحُ
--   المضمَّنُ لـ PUBLIC في الدوال لا يُنزَع بهذا الباب. فالحارسُ إذن
--   مُطلِقُ أحداثٍ ينزع PUBLIC عن كلِّ دالةٍ تُنشَأ في public.
--
--   ولا يُنزَع عن anon: فمنحُ anon مكتوبٌ صريحٌ في الهجرات، وهو عضوٌ
--   في PUBLIC، فنزعُ PUBLIC يكفي لإغلاق الباب المضمَّن ويُبقي الصريح.
--   وSupabase يضع في تنصيبه كذلك:
--       alter default privileges in schema public
--         grant execute on functions to anon, authenticated, service_role;
--   وهذا منحٌ مخزَّنٌ يُنزَع بالباب نفسِه، فيُنزَع عن anon وحدَه،
--   ويبقى authenticated فلا تنكسر هجرةٌ نسي كاتبُها سطرَ المنح.
do $do$
declare r text;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then return; end if;
  foreach r in array array['postgres', 'supabase_admin', current_user] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('alter default privileges for role %I in schema public '
                     'revoke execute on functions from anon', r);
    end if;
  end loop;
end $do$;

create or replace function public.lock_new_function()
returns event_trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select c.objid, c.object_identity
      from pg_event_trigger_ddl_commands() c
     where c.object_type = 'function'
  loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where p.oid = r.objid and n.nspname = 'public') then
      execute format('revoke execute on function %s from public', r.object_identity);
    end if;
  end loop;
end $$;

comment on function public.lock_new_function() is
  'ينزع التنفيذَ المضمَّنَ لـ PUBLIC عن كلِّ دالةٍ تُنشَأ في public (إصلاح أمنيّ)';

-- وهي نفسُها أُنشئت قبل أن يقوم الحارسُ، فتُغلَق بيدها
revoke execute on function public.lock_new_function() from public, anon, authenticated;

do $do$
begin
  drop event trigger if exists lock_new_function;
  create event trigger lock_new_function on ddl_command_end
    when tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
    execute function public.lock_new_function();
exception when insufficient_privilege or feature_not_supported then
  -- لا صلاحيةَ لمُطلِقات الأحداث في هذا التنصيب: تبقى النزعاتُ الصريحةُ
  --   أعلاه، ويُكتَب في كلِّ هجرةٍ جديدةٍ منحُها بيدها
  raise warning 'تعذّر تثبيتُ حارس الدوال الجديدة — راجِعِ المنحَ يدويًّا';
end $do$;

-- ---------------------------------------------------------------------
-- ٣) الدوالُّ الداخلية: تُنادَى من داخل المحروسات، فلا تُفتَح للواجهة
--
--    (تُستدعى من دوالَّ security definer، والمنفِّذُ فيها مالكُها،
--     فنزعُ التنفيذِ عن anon و authenticated لا يُعطّلها)
-- ---------------------------------------------------------------------
do $do$
declare r text;
begin
  foreach r in array array[
    -- أدواتُ تهجيرٍ تكتب في صفحات الموقع العامّ
    'public.page_set_section(text, jsonb, text)',
    'public.page_prepend_block(text, text, jsonb)',
    'public.page_set_card_icons(text, text, jsonb)',
    -- طابورُ البريد: يُملأ من داخل المنصة لا من خارجها
    'public.enqueue_notification(uuid, text, text, text, uuid)',
    -- رابطُ القاعة ورمزُ بوّابتها
    'public.meet_base(text, uuid)',
    -- مفتاحُ البطاقة: سرٌّ يُقرَن برقم العضو في التحقّق العامّ
    'public.ensure_card_key(uuid)',
    -- أسعارُ الأعمال: تُقرأ من خلال التقارير المحروسة لا مباشرةً
    'public.rate_for(uuid, text)',
    'public.rate_basis_for(uuid, text)',
    'public.work_amount(uuid, text, int, int)',
    -- موقعُ العمل المُسنَد وإعادةُ حساب الوردية
    'public.site_for(uuid)',
    'public.shift_recalc(uuid)',
    -- حسابُ بنود التشغيل: يدخل في تقارير محروسة
    'public.ops_absence(date, int)',
    'public.ops_short_days(date, int)',
    'public.ops_eval(date, int)'
  ] loop
    if to_regprocedure(r) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', r);
    end if;
  end loop;
end $do$;

-- ---------------------------------------------------------------------
-- ٤) وما تستدعيه الواجهةُ ولا حارسَ له: يُوضَع له حارسُه
-- ---------------------------------------------------------------------

-- ناقصُ ملفِّ العضو: لصاحبه، ولمن له كشفُ الفريق، ولقائده — لا لكلِّ أحد.
--   (كان أيُّ عضوٍ يستطيع أن يعرف عن أيِّ زميلٍ ما نقص من مستنداته)
--   (يُرقَّع موضعُه من التعريف القائم ولا يُعاد كتابةُ الدالة جملةً،
--    فقائمةُ النواقص تتغيّر بتغيُّر الحقول)
do $do$
declare v_src text; v_old text;
begin
  v_src := pg_get_functiondef('public.profile_missing(uuid)'::regprocedure);
  if position('auth.uid()' in v_src) > 0 then return; end if;
  v_old := E'  ) q;\n';
  if position(v_old in v_src) = 0 then
    raise exception 'profile_missing: لم يُوجد موضعُ الترقيع';
  end if;
  execute replace(v_src, v_old,
    E'  ) q\n'
    || E'  where p_id = auth.uid()\n'
    || E'     or public.is_admin() or public.is_admin_for(''tm_view'')\n'
    || E'     or exists (select 1 from public.profiles pl\n'
    || E'                 where pl.id = p_id and pl.lead_id = auth.uid());\n');
end $do$;

comment on function public.profile_missing(uuid) is
  'ما نقص من ملفِّ عضو — لصاحبه وللإدارة وحدَهما (إصلاح أمنيّ)';

-- أرقامُ الإنتاج على أساس العقد: لمن له الاطّلاع على التقارير وحدَه،
--   كما يُشترط للصفحة التي تعرضها (/app/stats ← rp_stats)
do $do$
declare v_src text; v_old text;
begin
  v_src := pg_get_functiondef('public.production_contract()'::regprocedure);
  if position('can_view_reports' in v_src) > 0 then return; end if;
  v_old := E'    from mats\n$function$';
  if position(v_old in v_src) = 0 then
    raise exception 'production_contract: لم يُوجد موضعُ الترقيع';
  end if;
  -- «having» لا «where»: الاستعلامُ تجميعيٌّ بلا تجميعة، فالشرطُ في
  --   where يُفرِّغ الأرقامَ ويُبقي صفَّها، وفي having يمنع الصفَّ نفسَه
  execute replace(v_src, v_old,
    E'    from mats\n'
    || E'  having public.can_view_reports() or public.is_admin()\n'
    || E'$function$');
end $do$;

notify pgrst, 'reload schema';
