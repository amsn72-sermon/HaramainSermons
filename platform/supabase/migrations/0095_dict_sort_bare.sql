-- =====================================================================
-- 0095 — المعجمُ يُرتَّب بالجذر لا بـ«ال» التعريف (ملاحظتا ٢٦٢ و٢٧٤)
--
--   خرج الدليلُ وكلُّ مداخله تحت حرف الألف: «الاعتكاف» و«التقوى»
--   و«الزكاة» — لأنّ «ال» تُحسب من الكلمة. والمعاجمُ تُرتِّب بالجذر:
--   الاعتكافُ في العين، والتقوى في التاء، والزكاةُ في الزاي.
-- =====================================================================

create or replace function public.ar_bare(p_text text)
returns text language sql immutable set search_path = public as $$
  select case
    when length(regexp_replace(public.ar_norm(coalesce(p_text, '')), '^ال', '')) >= 2
      then regexp_replace(public.ar_norm(coalesce(p_text, '')), '^ال', '')
    else public.ar_norm(coalesce(p_text, ''))
  end
$$;
grant execute on function public.ar_bare(text) to authenticated;

comment on function public.ar_bare(text) is
  'المصطلحُ مجرَّدًا من «ال» التعريف، للترتيب المعجمي (ملاحظة ٢٦٢)';

-- والمعجمُ يُرتَّب به، وحرفُ الفاصلة يُؤخذ منه
create or replace function public.glossary_dict(
  p_lang text, p_q text default null, p_category text default null,
  p_only_missing boolean default false
) returns table (term_id uuid, term_ar text, term_tr text, category text,
                 status text, letter text, has_explanation boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.term_ar, public.term_tr_of(t.id, p_lang), t.category, t.status,
         left(public.ar_bare(t.term_ar), 1),
         (nullif(btrim(coalesce(t.explanation, '')), '') is not null)
    from public.glossary_terms t
   where public.my_role() is not null
     and public.may_see_lang(p_lang)
     and (t.status = 'معتمد' or t.created_by = auth.uid() or public.is_admin())
     and (p_category is null or p_category = '' or t.category = p_category)
     and (not p_only_missing or public.term_tr_of(t.id, p_lang) is null)
     and (p_q is null or p_q = ''
          or public.ar_norm(t.term_ar) like '%' || public.ar_norm(p_q) || '%'
          or coalesce(public.term_tr_of(t.id, p_lang), '') ilike '%' || p_q || '%')
   order by public.ar_bare(t.term_ar)
$$;
grant execute on function public.glossary_dict(text, text, text, boolean) to authenticated;

-- وجدولُ مهمّة الترجمة كذلك، فيأتي المترجمُ على المصطلحات مرتَّبةً
create or replace function public.glossary_task_rows(p_task uuid)
returns table (term_id uuid, term_ar text, explanation text, term_tr text, done_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.term_ar, t.explanation,
         public.term_tr_of(t.id, k.language_code), x.done_at
    from public.glossary_task_terms x
    join public.glossary_tasks k on k.id = x.task_id
    join public.glossary_terms t on t.id = x.term_id
   where x.task_id = p_task
     and (k.assignee_id = auth.uid() or public.is_admin() or public.is_supervisor()
          or public.is_viewer())
   order by public.ar_bare(t.term_ar)
$$;
grant execute on function public.glossary_task_rows(uuid) to authenticated;

notify pgrst, 'reload schema';
