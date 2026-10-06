-- =====================================================================
-- 0097 — المرفوعُ من الإدارة معتمدٌ، والقوسُ بيانٌ لا جزءٌ من المصطلح
--        (ملاحظتا ٢٧٧ و٢٧٩)
--
--   ١) الملفُّ الذي ترفعه الإدارةُ أصلُه مراجَع، فلا معنى لبقائه
--      «مقترحًا» ينتظر اعتمادًا من رافعِه نفسِه. وقد صار الاستيرادُ
--      يدخل معتمدًا منذ ٠٠٩١، فيبقى ما رُفع قبلها: يُعتمَد ما رفعته
--      الإدارةُ وحدَها، ويبقى اقتراحُ المترجمِ اقتراحًا كما هو.
--
--   ٢) ويأتي في الملفّ: «التقوى (امتثالُ الأمر)» — فالقوسُ شرحٌ أو
--      قيدٌ، لا من حروف المصطلح. فيُنزَع إلى الشرح، ويبقى المدخلُ
--      كلمةً كما في المعاجم، فيصحُّ ترتيبُه ومطابقتُه في المرصد.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) تجريدُ المصطلح من القوس: يُعاد المصطلحُ وما بين قوسيه
-- ---------------------------------------------------------------------
create or replace function public.term_split_paren(p_text text)
returns table (term text, note text)
language sql immutable set search_path = public as $$
  with s as (select btrim(coalesce(p_text, '')) t)
  select case when m[1] is not null and length(btrim(m[1])) >= 2 then btrim(m[1]) else s.t end,
         case when m[1] is not null and length(btrim(m[1])) >= 2 then nullif(btrim(m[2]), '') end
    from s
    left join lateral (
      select regexp_match(s.t, '^(.*?)[[:space:]]*[\(\[（]([^\)\]）]+)[\)\]）][[:space:]]*$') m
    ) x on true
$$;
grant execute on function public.term_split_paren(text) to authenticated;

comment on function public.term_split_paren(text) is
  'المصطلحُ مجرَّدًا من قوسه، والقوسُ بيانٌ يُضمُّ إلى الشرح (ملاحظة ٢٧٩)';

-- والاستيرادُ يُجرِّده عند الإدخال
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_glossary';
  if v_src is null then return; end if;
  if position('term_split_paren' in v_src) > 0 then return; end if;

  v_new := replace(v_src,
    '    -- الشرحُ اختياريٌّ الآن (ملاحظة ٢٤٤ أ)
    v_exp := nullif(btrim(coalesce(v_row ->> ''explanation'', '''')), '''');',
    '    -- الشرحُ اختياريٌّ الآن (ملاحظة ٢٤٤ أ)
    v_exp := nullif(btrim(coalesce(v_row ->> ''explanation'', '''')), '''');

    -- والقوسُ في المصطلح بيانٌ يُنزَع إلى الشرح (ملاحظة ٢٧٩)
    declare v_par text;
    begin
      select s.term, s.note into v_term, v_par from public.term_split_paren(v_term) s;
      if v_par is not null then
        v_exp := case when v_exp is null then v_par else v_exp || '' — '' || v_par end;
      end if;
    end;');
  if v_new = v_src then return; end if;
  execute v_new;
end $do$;

-- ومعالجةُ ما دخل قبلها: المدخلُ يُجرَّد، وقوسُه يُضَمُّ إلى شرحه،
--   وما تعارض مع مدخلٍ مجرَّدٍ قائمٍ يُترك كما هو فلا يُفقَد شيء
do $do$
declare r record; v_term text; v_note text;
begin
  for r in select id, term_ar, explanation from public.glossary_terms
            where term_ar ~ '[\(\[（]' loop
    select s.term, s.note into v_term, v_note from public.term_split_paren(r.term_ar) s;
    if v_note is null or v_term = r.term_ar then continue; end if;
    if exists (select 1 from public.glossary_terms t
                where t.term_ar = v_term and t.id <> r.id) then continue; end if;
    update public.glossary_terms
       set term_ar     = v_term,
           explanation = case when nullif(btrim(coalesce(r.explanation, '')), '') is null
                              then v_note else r.explanation || ' — ' || v_note end
     where id = r.id;
  end loop;
end $do$;

-- ---------------------------------------------------------------------
-- ٢) اعتمادُ ما رفعته الإدارةُ قبل ٠٠٩١ (ملاحظة ٢٧٧)
--    ويبقى اقتراحُ المترجمِ اقتراحًا: الاعتمادُ بيدِ الإدارة لا بيد
--    من اقترح.
-- ---------------------------------------------------------------------
update public.glossary_terms t
   set status = 'معتمد', approved_by = t.created_by, approved_at = coalesce(t.approved_at, now())
 where t.status = 'مقترح'
   and exists (select 1 from public.profiles p
                where p.id = t.created_by and p.role in ('manager', 'coordinator'));

-- ---------------------------------------------------------------------
-- ٣) الاعتمادُ جملةً: المصطلحاتُ تُعتمَد مئةً في ضغطةٍ لا واحدًا واحدًا
-- ---------------------------------------------------------------------
create or replace function public.approve_glossary_terms(
  p_ids uuid[], p_on boolean default true
) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not (public.is_manager() or public.has_perm('approve_glossary_term')) then
    raise exception 'اعتمادُ المصطلحات بيد الإدارة' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  update public.glossary_terms
     set status      = case when p_on then 'معتمد' else 'مقترح' end,
         approved_by = case when p_on then auth.uid() else null end,
         approved_at = case when p_on then now() else null end
   where id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.approve_glossary_terms(uuid[], boolean) to authenticated;

comment on function public.approve_glossary_terms(uuid[], boolean) is
  'اعتمادُ المصطلحات جملةً أو ردُّها (ملاحظة ٢٧٧)';

notify pgrst, 'reload schema';
