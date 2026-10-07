-- =====================================================================
-- 0099 — المفاتيحُ تُربَط بحُرّاسها (ملاحظة ٣١٤)
--
--   مُنح منسّقٌ مفتاحَ «التحقّق من صحّة الحساب المصرفي» فلم يستطع. وتتبُّعُ
--   العلّة كشف أنّها ليست في مفتاحٍ واحد:
--
--   فالتحديثُ ٠٠٨٧ أنشأ سبعةً وخمسين مفتاحًا مفصَّلًا، ولم يُعِد ربطَ
--   الدوالِّ بها. فبقيت الدوالُّ تسأل عمّا كانت تسأل عنه قبلها: إمّا
--   مفتاحًا عامًّا (banks · team · materials)، وإمّا الدورَ وحدَه
--   (is_manager). فالمنحُ يقع في موضعه والدالةُ لا تنظر إليه.
--
--   ومن مئةٍ وسبعين دالةٍ محروسة: ستٌّ وستون على مفتاحٍ عامّ، وسبعٌ
--   وستون على الدور وحدَه، واثنتا عشرة وحدَها تسأل عن مفتاحٍ مفصَّل.
--
--   وكُشفت معها ثغرةٌ أخطر: perm_allowed تُجيز المفتاحَ المجهول. فمن
--   سأل عن مفتاحٍ لا وجودَ له في الجدول أُذن له — لأنّ bool_and على
--   صفرِ صفوفٍ يُعيد null فيُقلَب إلى true. فتُسَدّ.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) المفتاحُ المجهولُ ممنوعٌ لا مأذون
--    والتعديلُ في موضعه لا إعادةُ كتابة: ففي ٠٠٨٨ فرعٌ لحساب المتابعة
--    لا يُفقَد.
-- ---------------------------------------------------------------------
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'perm_allowed';
  if v_src is null then return; end if;
  if position('مفتاحٌ مجهول' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    '  select case',
    '  -- لا مفتاحَ فلا إذن: المجهولُ يُمنع ولا يُجاز — مفتاحٌ مجهول (ملاحظة ٣١٤)
  select case
    when not exists (select 1 from public.perm_keys where key = p_key) then false');
  if v_new <> v_src then execute v_new; end if;
end $do$;

-- ---------------------------------------------------------------------
-- ٢) مفاتيحُ نقصت، منها ما استعملناه بغير تسجيل
-- ---------------------------------------------------------------------
insert into public.perm_keys (key, label, sort, parent, grp, default_open, sensitive, viewable) values
  ('gl_approve',   'اعتمادُ المصطلحات وردُّها',          144, 'glossary', 'الدليل المصطلحي', true,  false, false),
  ('gl_watch',     'مرصدُ المصطلحات: المسحُ والتوليد',   146, 'glossary', 'الدليل المصطلحي', false, false, false),
  ('docs_id_view', 'الاطّلاعُ على صورة الهوية',          131, 'team',     'الأعضاء',         false, true,  true),
  ('circ_delete',  'حذفُ مراسلة',                       173, 'circulars','المراسلات',       false, false, false),
  ('sh_sites_edit','إنشاءُ مواقع العمل وإسنادُها',       166, 'shifts',   'الميدان',         false, false, false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- ٢ب) ما كان المنسّقُ يعمله قبل التفصيل يبقى له: تدقيقُ المستندات
--     عملُه المنصوصُ في شاشته، فلا يُنزَع منه بالربط (ملاحظة ٣١٤)
-- ---------------------------------------------------------------------
--   وكذلك: إرسالُ المراسلات ومتابعةُ التوقيع عليها، واستيرادُ الدليل،
--   واللغاتُ والخطباءُ مرجعان يُضيف إليهما المنسّق. وهي أعمالُه
--   المنصوصةُ في «عن المنصة»، فلا تُنزَع منه بالربط.
update public.perm_keys set default_open = true
 where key in ('docs_check', 'docs_verify', 'circ_send', 'gl_import',
               'st_languages', 'st_khateebs');

-- ---------------------------------------------------------------------
-- ٣) الربط: لكلِّ دالةٍ مفتاحُها المفصَّل
--    والطريقةُ طريقةُ ٠٠٤٧: تُقرأ الدالةُ وتُعاد كتابتُها بحارسها
--    الجديد، فلا يُفقَد ما أُضيف إليها في ترحيلٍ لاحق.
-- ---------------------------------------------------------------------
do $do$
declare
  -- الدالةُ ← مفتاحُها المفصَّل
  v_map jsonb := '{}'::jsonb;
  r record; v_src text; v_new text; v_key text; v_done int := 0; v_skip int := 0;
begin
  v_map := v_map || jsonb_build_object('create_material', 'mat_add', 'add_source_version', 'mat_edit', 'set_material_words', 'mat_edit', 'set_material_text_plan', 'mat_edit', 'set_source_audio_seconds', 'mat_edit', 'reassign_stage', 'mat_assign', 'return_stage', 'mat_return', 'cancel_track', 'mat_edit', 'reopen_material', 'apr_reopen', 'close_revision', 'apr_close', 'reopen_revision', 'apr_reopen', 'add_revision_mark', 'apr_close', 'delete_revision_mark', 'apr_close', 'set_audio_duration', 'apr_close', 'approve_track_audios', 'apr_final', 'set_published', 'apr_final', 'admin_create_member', 'tm_add', 'admin_update_member', 'tm_edit', 'admin_update_contact', 'tm_edit', 'admin_set_iqama', 'tm_edit');
  v_map := v_map || jsonb_build_object('set_member_track', 'tm_edit', 'set_member_photo', 'tm_edit', 'set_member_city', 'tm_edit', 'set_member_lead', 'tm_edit', 'set_member_trainer', 'tm_edit', 'set_member_may_translate', 'tm_edit', 'set_member_mfa_exempt', 'tm_edit', 'set_member_mfa_required', 'tm_edit', 'admin_clear_mfa', 'tm_edit', 'set_member_langs', 'tm_edit', 'set_native_lang', 'tm_edit', 'set_assignable_langs', 'tm_edit', 'set_lang_role', 'tm_edit', 'review_member_doc', 'docs_check', 'review_profile_data', 'docs_check', 'remind_profile_data', 'docs_check', 'save_bank_account', 'bank_check', 'set_bank_doc', 'bank_check', 'verify_bank_account', 'bank_verify', 'build_payroll', 'pay_run');
  v_map := v_map || jsonb_build_object('set_payroll_item', 'pay_run', 'set_member_pay', 'pay_run', 'set_member_rate', 'pay_run', 'set_pay_rate', 'pay_run', 'set_payroll_status', 'pay_approve', 'save_penalty', 'penalties', 'delete_penalty', 'penalties', 'set_penalty_state', 'penalties', 'save_claim_row', 'ctr_claim', 'reset_claim_row', 'ctr_claim', 'save_claim_columns', 'ctr_claim', 'set_ops_month', 'ctr_qty', 'save_ops_item', 'ctr_qty', 'delete_ops_item', 'ctr_qty', 'clear_ops_month', 'ctr_qty', 'set_language_initiative', 'ctr_initiative', 'save_shift', 'sh_schedule', 'delete_shift', 'sh_schedule', 'save_shift_crew', 'sh_schedule', 'delete_shift_crew', 'sh_schedule');
  v_map := v_map || jsonb_build_object('set_shift_status', 'sh_schedule', 'generate_shifts', 'sh_schedule', 'save_duty_period', 'sh_schedule', 'delete_duty_period', 'sh_schedule', 'set_member_schedule', 'sh_schedule', 'set_shift_substitute', 'sh_edit_punch', 'save_work_site', 'sh_sites_edit', 'set_member_site', 'sh_sites_edit', 'save_glossary_term', 'gl_add', 'propose_glossary_term', 'gl_add', 'save_glossary_sense', 'gl_add', 'approve_glossary_term', 'gl_approve', 'review_glossary_term', 'gl_approve', 'approve_glossary_terms', 'gl_approve', 'delete_glossary_term', 'gl_delete', 'delete_glossary_sense', 'gl_delete', 'import_glossary', 'gl_import', 'scan_terms', 'gl_watch', 'ignore_candidate', 'gl_watch', 'purge_candidates', 'gl_watch');
  v_map := v_map || jsonb_build_object('promote_candidates', 'gl_watch', 'send_circular', 'circ_send', 'update_circular', 'circ_send', 'archive_circular', 'circ_send', 'remind_circular', 'circ_send', 'delete_circular', 'circ_delete', 'set_file_name_pattern', 'st_workflow', 'set_doc_type_code', 'st_workflow', 'set_hijri_year_start', 'st_workflow', 'set_registration', 'st_workflow', 'set_archive_deleted', 'mat_delete');

  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in (select jsonb_object_keys(v_map))
  loop
    v_key := v_map ->> r.proname;
    v_src := pg_get_functiondef(r.oid);

    -- رُبطت من قبل بمفتاحها المفصَّل
    if position(format('(%L)', v_key) in v_src) > 0 then
      v_skip := v_skip + 1; continue;
    end if;

    v_new := v_src;

    -- أ) ما كان على مفتاحٍ عامّ: يصير على المفصَّل
    v_new := regexp_replace(v_new,
      'public\.is_admin_for\(''[a-z_]+''\)',
      format('public.is_admin_for(%L)', v_key), 'g');

    -- ب) ما كان على الدور وحدَه: يُضَمُّ إليه المفتاح، فمن مُنحه عمل.
    --    و is_admin_for لا has_perm: فالمفتاحُ المفتوحُ بأصله يصدُق على
    --    المترجم كما يصدُق على الإداري، والعملُ إداريٌّ لا يُفتَح لغيره.
    v_new := replace(v_new,
      'not public.is_manager() then',
      format('not (public.is_manager() or public.is_admin_for(%L)) then', v_key));
    -- ولا يُمَسُّ حارسٌ وُضع لمدير المشروع بعينه داخلَ دالةٍ لغيره:
    --   كتفعيل التسجيل الإداريِّ في admin_update_member (ملاحظة ٢٧٠)
    v_new := replace(v_new,
      'if not (public.is_manager() or public.my_role() = ''coordinator''',
      format('if not (public.is_manager() or public.is_admin_for(%L) or public.my_role() = ''coordinator''', v_key));

    if v_new <> v_src then
      execute v_new;
      v_done := v_done + 1;
    else
      v_skip := v_skip + 1;
    end if;
  end loop;
  raise notice 'رُبطت % دالةً بمفاتيحها، وتُخطّيت %', v_done, v_skip;
end $do$;

-- ---------------------------------------------------------------------
-- ٤) واللغاتُ والخطباءُ يُكتَبان بمفتاحيهما لا بالدور (ملاحظة ٣١٤)
-- ---------------------------------------------------------------------
drop policy if exists "admin writes languages" on public.languages;
create policy "admin writes languages" on public.languages for all
  using (public.is_admin_for('st_languages'))
  with check (public.is_admin_for('st_languages'));

drop policy if exists "admin writes khateebs" on public.khateebs;
create policy "admin writes khateebs" on public.khateebs for all
  using (public.is_admin_for('st_khateebs'))
  with check (public.is_admin_for('st_khateebs'));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ٥) وعبارةُ «لمدير المشروع وحده» صارت غيرَ صادقة بعد الربط: فالمفتاحُ
--    يُمنَح. فتُصحَّح إلى «بإذن مدير المشروع» (ملاحظتا ٢٩٤ و٣١٤)
-- ---------------------------------------------------------------------
do $do$
declare r record; v_src text; v_new text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%has_perm(%'
       and pg_get_functiondef(p.oid) ~ 'لمدير المشروع وحده'
  loop
    v_src := pg_get_functiondef(r.oid);
    v_new := replace(v_src, 'لمدير المشروع وحده', 'بإذن مدير المشروع');
    if v_new <> v_src then execute v_new; end if;
  end loop;
end $do$;

notify pgrst, 'reload schema';
