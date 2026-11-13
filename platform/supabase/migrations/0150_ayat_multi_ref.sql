-- =====================================================================
-- ٠١٥٠ — الآياتُ المجموعةُ في قطعةٍ واحدة، ومقابلتُها بأصلها
--
--   يُدرِج المترجمُ ثلاثَ آياتٍ فيريدها متَّصلةً لا متفرِّقة، وقد تكون
--   من مواضعَ شتّى. فصار المرجعُ يحتمل مُدًى متعدِّدةً تفصلها فاصلة:
--   «٨:٥-٧» و«٢:٤١,٢:٧». والمقابلةُ في الخادم تمشي عليها جميعًا على
--   ترتيبها، فلا يُفلِت حرفٌ من المقابلة بحجّة الجمع.
--
--   وأرقامُ الآي تُكتَب في علاماتها كما في المصحف (محرف ٠٦DD وما بعده
--   من أرقام)، وهي من رسم الكتابة لا من نصِّ التنزيل، فتُطرَح عند
--   المقابلة كما تُطرَح أقواسُ التزيين.
-- =====================================================================

create or replace function public.check_ayat(p_spans jsonb, p_body text default null,
                                             p_min int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e jsonb; v_ref text; v_part text; v_s int; v_a1 int; v_a2 int;
  v_src text; v_one text; v_got text; v_bad jsonb := '[]'::jsonb; v_typed jsonb := '[]'::jsonb;
  v_plain text; r record; v_ok boolean;
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if (select count(*) from public.quran_ayat) = 0 then
    return jsonb_build_object('ready', false, 'bad', v_bad, 'typed', v_typed);
  end if;

  -- أ) الموسومُ يُقابَل بأصله، ولو جُمعت فيه مُدًى
  if p_spans is not null and jsonb_typeof(p_spans) = 'array' then
    for e in select * from jsonb_array_elements(p_spans) loop
      v_ref := btrim(coalesce(e ->> 'ref', ''));
      if v_ref !~ '^\d{1,3}:\d{1,3}(-\d{1,3})?(,\d{1,3}:\d{1,3}(-\d{1,3})?)*$' then
        v_bad := v_bad || jsonb_build_object('ref', v_ref, 'why', 'مرجعٌ غيرُ صحيح');
        continue;
      end if;
      v_src := '';
      v_ok := true;
      foreach v_part in array string_to_array(v_ref, ',') loop
        v_s  := split_part(v_part, ':', 1)::int;
        v_a1 := split_part(split_part(v_part, ':', 2), '-', 1)::int;
        v_a2 := coalesce(nullif(split_part(split_part(v_part, ':', 2), '-', 2), '')::int, v_a1);
        select string_agg(public.ar_plain(a.text_uthmani), ' ' order by a.aya)
          into v_one from public.quran_ayat a
         where a.sura = v_s and a.aya between v_a1 and v_a2;
        if v_one is null then
          v_bad := v_bad || jsonb_build_object('ref', v_ref, 'why', 'لا آيةَ بهذا المرجع');
          v_ok := false;
          exit;
        end if;
        v_src := btrim(v_src || ' ' || v_one);
      end loop;
      if not v_ok then continue; end if;

      -- والمكتوبُ يُجرَّد من الشكل ومن أرقام الآي وعلاماتها قبل المقابلة
      v_got := public.ar_plain(coalesce(e ->> 'text', ''));
      if coalesce(v_got, '') <> v_src then
        v_bad := v_bad || jsonb_build_object('ref', v_ref, 'why', 'النصُّ خولف عن أصله');
      end if;
    end loop;
  end if;

  -- ب) المكتوبُ بالأيدي: نصٌّ يطابق آيةً ولم يُوسَم
  v_plain := public.ar_plain(coalesce(p_body, ''));
  if v_plain is not null and length(v_plain) >= greatest(coalesce(p_min, 30), 8) then
    for r in
      select a.sura, a.aya, s.name_ar, a.text_uthmani
        from public.quran_ayat a
        left join public.quran_suras s on s.sura = a.sura
       where length(a.text_plain) >= greatest(coalesce(p_min, 30), 8)
         and position(a.text_plain in v_plain) > 0
       order by length(a.text_plain) desc
       limit 10
    loop
      v_typed := v_typed || jsonb_build_object(
        'ref', r.sura || ':' || r.aya, 'sura', r.name_ar, 'aya', r.aya,
        'text', r.text_uthmani);
    end loop;
  end if;

  return jsonb_build_object('ready', true, 'bad', v_bad, 'typed', v_typed);
end $$;
grant execute on function public.check_ayat(jsonb, text, int) to authenticated;

comment on function public.check_ayat(jsonb, text, int) is
  'مقابلةُ الآيات الموسومة بأصولها — ولو جُمعت مُدًى — وكشفُ ما كُتب بالأيدي (ملاحظتا ٥٠٠ و٥١٢)';

notify pgrst, 'reload schema';
