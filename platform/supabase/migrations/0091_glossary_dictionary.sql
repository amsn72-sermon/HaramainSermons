-- =====================================================================
-- 0091 — الدليلُ معجمًا: المقابلُ والعدُّ والنطاق
--        (ملاحظات ٢٥٦ و٢٥٨ و٢٥٩)
--
--   ٢٥٦) الأساسُ في الدليل المصطلحُ العربيُّ ومقابلُه في كلِّ لغة،
--        يُعرض معجمًا لا بطاقاتٍ طوالًا. ولكلٍّ نطاقُه: المترجمُ يرى
--        لغاتِه وحدَها وأوّلُها لغتُه الأمّ، والمنسقون ومديرُ المشروع
--        ومديرُه من الهيئة يرون اللغاتِ كلَّها.
--
--   ٢٥٨) وعددُ المصطلحات في البطاقة رقمٌ بارزٌ لا سطرٌ باهت.
--
--   ٢٥٩) وما رُفع بلغتين فالأصلُ أنه مترجَمٌ مراجَع، فيدخل معتمدًا بلا
--        «مقترح» ولا طلبِ اعتماد.
--
--   وكان العدُّ يقرأ من ترجمات المعاني وحدَها، والاستيرادُ يكتب في
--   جدول المقابلات، فظهرت البطاقاتُ خاليةً وفيها ثمانمئةُ مصطلح.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) نطاقُ اللغات لكلِّ حساب (ملاحظة ٢٥٦ ز)
-- ---------------------------------------------------------------------
create or replace function public.my_glossary_langs()
returns table (code text, name_ar text, native_name text, dir text,
               is_core boolean, mine boolean, native boolean)
language sql stable security definer set search_path = public as $$
  select l.code, l.name_ar, l.native_name, l.dir, l.is_core,
         (ml.member_id is not null),
         (p.native_lang = l.code)
    from public.languages l
    left join public.profiles p on p.id = auth.uid()
    left join public.member_languages ml
           on ml.language_code = l.code and ml.member_id = auth.uid()
   where public.my_role() is not null
     -- الإدارةُ ترى اللغاتِ كلَّها، والمترجمُ ما سجّله من إتقانه
     and (public.is_admin() or public.is_supervisor() or public.is_viewer()
          or ml.member_id is not null)
   order by (p.native_lang = l.code) desc, l.is_core desc, l.sort
$$;
grant execute on function public.my_glossary_langs() to authenticated;

create or replace function public.may_see_lang(p_lang text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_supervisor() or public.is_viewer()
      or exists (select 1 from public.member_languages
                  where member_id = auth.uid() and language_code = p_lang)
$$;
grant execute on function public.may_see_lang(text) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) المقابلُ من حيث كان: جدولُ المقابلات أو ترجمةُ المعنى الأولى
-- ---------------------------------------------------------------------
create or replace function public.term_tr_of(p_term uuid, p_lang text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select gt.term_tr from public.glossary_translations gt
      where gt.term_id = p_term and gt.language_code = p_lang),
    (select tr.term_tr from public.glossary_sense_translations tr
       join public.glossary_senses s on s.id = tr.sense_id
      where s.term_id = p_term and tr.language_code = p_lang
      order by s.sort, s.label limit 1))
$$;
grant execute on function public.term_tr_of(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) المعجم: صفٌّ لكلِّ مصطلحٍ ومقابلِه، مرتَّبًا ومبحوثًا فيه
--    (ملاحظة ٢٥٦ ح و ط)
-- ---------------------------------------------------------------------
create or replace function public.glossary_dict(
  p_lang text, p_q text default null, p_category text default null,
  p_only_missing boolean default false
) returns table (term_id uuid, term_ar text, term_tr text, category text,
                 status text, letter text, has_explanation boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.term_ar, public.term_tr_of(t.id, p_lang), t.category, t.status,
         left(public.ar_norm(t.term_ar), 1),
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
   order by public.ar_norm(t.term_ar)
$$;
grant execute on function public.glossary_dict(text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) البطاقاتُ تعدّ من الجدولين معًا (ملاحظة ٢٥٨)
-- ---------------------------------------------------------------------
drop function if exists public.glossary_cards();
create function public.glossary_cards()
returns table (code text, name_ar text, native_name text, dir text, is_core boolean,
               done int, missing int, mine boolean, native boolean)
language sql stable security definer set search_path = public as $$
  with seen as (select * from public.my_glossary_langs()),
       total as (select count(*)::int n from public.glossary_terms where status = 'معتمد')
  select s.code, s.name_ar, s.native_name, s.dir, s.is_core,
         d.n,
         greatest(0, (select n from total) - d.n),
         s.mine, s.native
    from seen s
    cross join lateral (
      select count(*)::int n from public.glossary_terms t
       where t.status = 'معتمد' and public.term_tr_of(t.id, s.code) is not null) d
   order by s.native desc, s.is_core desc, s.code
$$;
grant execute on function public.glossary_cards() to authenticated;

-- ---------------------------------------------------------------------
-- ٥) الاستيرادُ يدخل معتمدًا (ملاحظة ٢٥٩)
--    الملفُّ بلغتين أصلُه أنه مترجَمٌ مراجَع. والعربيُّ وحدَه يدخل
--    ليُسنَد، فيبقى مصطلحًا معتمدًا تنتظر لغاتُه ترجمتَها.
-- ---------------------------------------------------------------------
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'import_glossary';
  if v_src is null then return; end if;

  v_new := replace(v_src,
    'values (v_term, v_cat, v_exp, ''مقترح'', auth.uid())',
    'values (v_term, v_cat, v_exp, ''معتمد'', auth.uid())');
  -- ويُختم بالاعتماد فيُعرف من اعتمده ومتى
  v_new := replace(v_new,
    'returning id into v_id;',
    'returning id into v_id;
      update public.glossary_terms
         set approved_by = auth.uid(), approved_at = now()
       where id = v_id;');
  execute v_new;
end $do$;

notify pgrst, 'reload schema';
