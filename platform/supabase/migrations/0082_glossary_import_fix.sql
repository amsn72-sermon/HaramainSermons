-- =====================================================================
-- 0082 — إصلاحُ استيراد الدليل الإرشادي للمصطلحات (ملاحظة ٢٤٤)
--
--   كان الاستيرادُ يشترط الشرحَ فيتخطّى كلَّ مصطلحٍ بلا شرح. والقواميسُ
--   مقابلاتٌ بلا شروح، فملفٌّ من ثمانمئة مصطلحٍ كان يدخل منه صفرٌ.
--   وكان يقبل أربعةَ تصنيفاتٍ من الثمانية المعتمدة، فيحوّل «مناسك»
--   و«توجيهات» و«أعلام» و«قرآني» إلى «عام».
--
--   فصار: الشرحُ اختياري، والتصنيفاتُ الثمانيةُ كلُّها، ووضعان —
--   «إضافة» لا تمحو مقابلًا قائمًا، و«استبدال» يحلّ محلَّه — وتقريرٌ
--   يبيّن كم أُضيف وكم حُدِّث وكم تُخطّي ولماذا.
-- =====================================================================

-- الشرحُ لم يَعُد إلزاميًّا في العمود نفسِه، فالقاموسُ مقابلاتٌ بلا شروح
alter table public.glossary_terms alter column explanation drop not null;

drop function if exists public.import_glossary(jsonb);

create or replace function public.import_glossary(
  p_rows jsonb,
  p_mode text default 'add'          -- 'add' يُبقي القائم، 'replace' يحلّ محلَّه
) returns table (added int, updated int, skipped int,
                 translations int, skipped_blank int, bad_lang int)
language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_tr jsonb; v_id uuid; v_term text; v_cat text; v_exp text;
        v_code text; v_text text; v_replace boolean := (coalesce(p_mode,'add') = 'replace');
begin
  if public.my_role() is null or public.is_supervisor() then
    raise exception 'استيراد الدليل المصطلحي للفريق' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'الملف غير مقروء'; end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'الحد الأقصى ٥٠٠٠ مصطلح في المرة الواحدة';
  end if;

  added := 0; updated := 0; skipped := 0;
  translations := 0; skipped_blank := 0; bad_lang := 0;

  for v_row in select jsonb_array_elements(p_rows) loop
    v_term := nullif(btrim(coalesce(v_row ->> 'term_ar', '')), '');

    -- الصفُّ بلا مصطلحٍ عربيٍّ لا يُقرأ: هو المفتاح
    if v_term is null then
      skipped := skipped + 1; skipped_blank := skipped_blank + 1;
      continue;
    end if;

    -- الشرحُ اختياريٌّ الآن (ملاحظة ٢٤٤ أ)
    v_exp := nullif(btrim(coalesce(v_row ->> 'explanation', '')), '');

    -- التصنيفاتُ الثمانيةُ المعتمدة (ملاحظة ٢٤٤ ب)
    v_cat := coalesce(nullif(btrim(coalesce(v_row ->> 'category', '')), ''), 'عام');
    if v_cat not in ('عقدي','فقهي','دعوي','توجيهات','مناسك','أعلام','قرآني','عام') then
      v_cat := 'عام';
    end if;

    select id into v_id from public.glossary_terms where term_ar = v_term;

    if v_id is null then
      insert into public.glossary_terms (term_ar, category, explanation, status, created_by)
      values (v_term, v_cat, v_exp, 'مقترح', auth.uid())
      returning id into v_id;
      added := added + 1;
    else
      -- الشرحُ القائمُ لا يُمحى بفراغٍ من الملف
      update public.glossary_terms
         set category    = v_cat,
             explanation = case when v_exp is null then explanation else v_exp end
       where id = v_id;
      updated := updated + 1;
    end if;

    for v_tr in select jsonb_array_elements(coalesce(v_row -> 'translations', '[]'::jsonb)) loop
      v_code := nullif(btrim(coalesce(v_tr ->> 'language_code', '')), '');
      v_text := nullif(btrim(coalesce(v_tr ->> 'term_tr', '')), '');
      if v_text is null then continue; end if;
      if v_code is null or not exists (select 1 from public.languages where code = v_code) then
        bad_lang := bad_lang + 1;
        continue;
      end if;

      insert into public.glossary_translations (term_id, language_code, term_tr, note)
      values (v_id, v_code, v_text, nullif(btrim(coalesce(v_tr ->> 'note','')), ''))
      on conflict (term_id, language_code) do update
        set term_tr = case when v_replace then excluded.term_tr
                           else coalesce(nullif(btrim(public.glossary_translations.term_tr), ''),
                                         excluded.term_tr) end,
            note    = coalesce(excluded.note, public.glossary_translations.note);
      translations := translations + 1;
    end loop;
  end loop;

  return next;
end $$;

comment on function public.import_glossary(jsonb, text) is
  'استيرادُ الدليل: الشرحُ اختياري، والتصنيفاتُ الثمانية، وإضافةٌ أو استبدال (ملاحظة ٢٤٤)';

grant execute on function public.import_glossary(jsonb, text) to authenticated;

notify pgrst, 'reload schema';
