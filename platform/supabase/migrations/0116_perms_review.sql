-- =====================================================================
-- 0116 — مراجعةُ منح الصلاحيات وحذفِها، ومفاتيحُ ما استُحدث
--        (ملاحظتا ٣٥٢ و٣٥٤)
--
--   ١) المنحُ كان يفتح ما فوقَ المفتاح من رؤوس — وهو صوابٌ وإلا بقي
--      الفرعُ ممنوعًا بأصله. لكنّ المنعَ بعدَه لم يكن يُغلق ما فُتح
--      لأجله، فيبقى الرأسُ مفتوحًا بعد زوال سببه. والرؤوسُ ليست
--      عناوينَ مجرّدة: «الأعضاء» و«المالية» و«العقد» مفاتيحُ تُسأل عنها
--      شاشاتٌ كاملة. فصار المنعُ يُغلق ما فُتح لأجله إذا لم يبقَ تحتَه
--      ممنوحٌ يقتضيه.
--
--   ٢) وما استُحدث من أبوابٍ كان بيد مدير المشروع وحدَه لا يُفوَّض:
--      حذفُ الشهادة، وتصميمُ قوالب المجمَّع، والترحيلُ من أرشيف
--      الترجمة، وتنقيحُ النصِّ على الكليشة، وكتابةُ المنصب. فجُعل لكلٍّ
--      مفتاحُه في جرد الصلاحيات، يُمنَح كما يُمنَح غيرُه.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) مفاتيحُ ما استُحدث
-- ---------------------------------------------------------------------
insert into public.perm_keys (key, label, sort, parent, grp, default_open, sensitive, viewable) values
  ('cert_delete',  'حذفُ شهادةٍ ملغاةٍ أو مسوّدة',         156, 'certs',        'الشهادات',        false, true,  false),
  ('arch_design',  'تصميمُ قوالب المجمَّع السنوي',          184, 'archive_year', 'الأرشيف السنوي',  false, false, false),
  ('arch_carry',   'ترحيلُ أعمال العام من أرشيف الترجمة',   185, 'archive_year', 'الأرشيف السنوي',  false, false, false),
  ('arch_refine',  'تنقيحُ نصِّ النسخة على الكليشة',         186, 'archive_year', 'الأرشيف السنوي',  false, false, false),
  ('tm_title',     'كتابةُ المنصب أمام الحساب',             118, 'team',         'الأعضاء',         false, false, false)
on conflict (key) do update
  set label = excluded.label, parent = excluded.parent, grp = excluded.grp,
      sort = excluded.sort, sensitive = excluded.sensitive, viewable = excluded.viewable;

-- وهي من مفاتيح الإدارة: لا تُفتح لمترجمٍ بأصلها (على نسق 0104)
update public.perm_keys set admin_only = true
 where key in ('cert_delete', 'arch_design', 'arch_carry', 'arch_refine', 'tm_title');

-- ---------------------------------------------------------------------
-- ٢) المنعُ يُغلق ما فُتح لأجله
-- ---------------------------------------------------------------------
create or replace function public.close_orphan_parents(p_member uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  for a in
    with recursive up as (
      select k.key, k.parent from public.perm_keys k where k.key = p_key
      union all
      select k.key, k.parent from public.perm_keys k join up u on k.key = u.parent)
    select key from up where key <> p_key
  loop
    -- لا يُغلَق إلا ما فُتح تبعًا، ولم يبقَ تحتَه ممنوحٌ يقتضيه
    if exists (select 1 from public.member_perms mp
                where mp.member_id = p_member and mp.perm_key = a.key
                  and mp.allowed and mp.reason like 'فُتح لأجل %')
       and not exists (
         with recursive down as (
           select k.key from public.perm_keys k where k.parent = a.key
           union all
           select k.key from public.perm_keys k join down d on k.parent = d.key)
         select 1 from down d
           join public.member_perms mp on mp.perm_key = d.key
          where mp.member_id = p_member and mp.allowed
            and (mp.expires_at is null or mp.expires_at > now()))
    then
      delete from public.member_perms
       where member_id = p_member and perm_key = a.key;
    end if;
  end loop;
end $$;
revoke execute on function public.close_orphan_parents(uuid, text)
  from public, anon, authenticated;

do $do$
declare v_src text; v_old text;
begin
  v_src := pg_get_functiondef('public.set_member_perm(uuid, text, boolean, timestamptz, text)'::regprocedure);
  if position('close_orphan_parents' in v_src) > 0 then return; end if;

  v_old := '  perform public.log_admin(''perm'', p_member,';
  if position(v_old in v_src) = 0 then
    raise exception 'set_member_perm: لم يُوجد موضعُ الترقيع';
  end if;
  execute replace(v_src, v_old,
    '  -- والمنعُ يُغلق ما فُتح لأجله فلا يبقى رأسٌ مفتوحًا بلا سبب (ملاحظة ٣٥٢)'
    || E'\n'
    || '  if p_allowed is null or p_allowed = false then'  || E'\n'
    || '    perform public.close_orphan_parents(p_member, p_key);' || E'\n'
    || '  end if;' || E'\n' || E'\n'
    || v_old);
end $do$;

-- ---------------------------------------------------------------------
-- ٣) وتُفوَّض الأبوابُ المستحدثة لمن مُنح مفتاحَها
-- ---------------------------------------------------------------------
do $do$
declare r record; v_src text;
begin
  for r in select * from (values
      ('public.delete_certificate(uuid)',
       'حذفُ الشهادات بيد مدير المشروع', 'cert_delete'),
      ('public.save_book_template_by_id(uuid, text, jsonb, int, boolean)',
       'قوالبُ المجمَّع بإذن مدير المشروع', 'arch_design'),
      ('public.delete_book_template(uuid)',
       'قوالبُ المجمَّع بإذن مدير المشروع', 'arch_design'),
      ('public.carry_year_to_archive(int, uuid, uuid[], boolean)',
       'ترحيلُ الخطب بإذن مدير المشروع', 'arch_carry'),
      ('public.set_job_title(uuid, text)',
       'المسمّى الوظيفيُّ بيد مدير المشروع', 'tm_title')
    ) as t(sig, msg, key)
  loop
    if to_regprocedure(r.sig) is null then continue; end if;
    v_src := pg_get_functiondef(to_regprocedure(r.sig));
    if position(r.key in v_src) > 0 then continue; end if;
    -- الحارسُ القديمُ «is_manager()» وحدَه يصير «أو مَن مُنح المفتاح»
    if position('if not public.is_manager() then' in v_src) > 0 then
      v_src := replace(v_src, 'if not public.is_manager() then',
        format('if not (public.is_manager() or public.is_admin_for(%L)) then', r.key));
    elsif position('if not (public.is_manager() or public.is_admin_for(''arch_export'')) then' in v_src) > 0 then
      v_src := replace(v_src,
        'if not (public.is_manager() or public.is_admin_for(''arch_export'')) then',
        format('if not (public.is_manager() or public.is_admin_for(%L)'
               || ' or public.is_admin_for(''arch_export'')) then', r.key));
    elsif position('if not (public.is_manager() or public.is_admin_for(''arch_upload'')) then' in v_src) > 0 then
      v_src := replace(v_src,
        'if not (public.is_manager() or public.is_admin_for(''arch_upload'')) then',
        format('if not (public.is_manager() or public.is_admin_for(%L)'
               || ' or public.is_admin_for(''arch_upload'')) then', r.key));
    else
      raise notice 'لم يُعرَف حارسُ %، فتُرك على حاله', r.sig;
      continue;
    end if;
    execute v_src;
  end loop;
end $do$;

notify pgrst, 'reload schema';
