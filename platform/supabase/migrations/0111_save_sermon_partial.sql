-- =====================================================================
-- 0111 — حفظُ الخطبة لا يمحو ما لم يُرسَلْ (ملاحظتا ٣٤٧ و٣٤٩)
--
--   `save_arch_sermon` كانت تكتب الحقولَ كلَّها في كلِّ نداء، والحقلُ
--   الذي لا يَرِد في الطلب يُقرأ فارغًا فيُكتَب فارغًا. ونافذةُ «نسخةٌ
--   بلغة» لا ترسل إلا المعرِّفَ والقسمَ والنسخةَ وعنوانًا صوريًّا «—»،
--   فكلُّ رفعِ نسخةٍ كان يمحو تاريخَ الخطبة ومسجدَها وجمعتَها وعنوانَها.
--   فتسقط من صفِّ أسبوعها وتصير بلا مسجدٍ ولا تاريخ — وهو ما رآه
--   صاحبُها: «رفعتُ خطبةً وحدّدتُ تاريخَها فلم تظهر».
--
--   فصار التحديثُ على ما وَرَد وحدَه: ما لم يُذكَرْ في الطلب يبقى على
--   حاله، ولا يُمحى حقلٌ إلا بإرساله فارغًا صراحةً.
-- =====================================================================

create or replace function public.save_arch_sermon(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_sec uuid := nullif(p ->> 'section_id', '')::uuid;
        v_year int; v_date date; v_fri date; v_week int; v_seq int;
        v_item jsonb; v_lang text;
begin
  if not (public.is_manager() or public.is_admin_for('arch_upload')) then
    raise exception 'رفعُ الخطب بإذن مدير المشروع' using errcode = '42501';
  end if;
  if v_sec is null then raise exception 'لم يُحدَّد القسم'; end if;

  select h_year into v_year from public.arch_sections where id = v_sec;
  if v_year is null then raise exception 'قسمٌ غيرُ موجود'; end if;

  v_date := nullif(p ->> 'sermon_date', '')::date;
  v_fri  := public.friday_of(v_date);
  v_week := public.arch_week_no(v_year, v_date);

  if v_id is null then
    if nullif(btrim(coalesce(p ->> 'title', '')), '') is null then
      raise exception 'لا تُنشَأ خطبةٌ بلا عنوان';
    end if;
    select coalesce(max(seq), 0) + 1 into v_seq from public.arch_sermons where h_year = v_year;
    insert into public.arch_sermons
      (section_id, h_year, friday_on, week_no, sermon_date, hijri_text, mosque,
       sermon_type, title, khateeb, seq, notes, created_by)
    values (v_sec, v_year, v_fri, v_week, v_date, nullif(btrim(p ->> 'hijri_text'), ''),
            nullif(p ->> 'mosque', ''), coalesce(nullif(btrim(p ->> 'sermon_type'), ''), 'خطبة جمعة'),
            btrim(p ->> 'title'), nullif(btrim(p ->> 'khateeb'), ''),
            coalesce(nullif(p ->> 'seq', '')::int, v_seq),
            nullif(btrim(p ->> 'notes'), ''), auth.uid())
    returning id into v_id;
  else
    if not (public.is_manager() or public.is_admin_for('arch_edit')) then
      raise exception 'تعديلُ الخطب بإذن مدير المشروع' using errcode = '42501';
    end if;
    -- ما لم يَرِدْ في الطلب يبقى على حاله (إصلاح ٣٤٩)
    update public.arch_sermons s
       set section_id  = v_sec,
           h_year      = v_year,
           sermon_date = case when p ? 'sermon_date' then v_date else s.sermon_date end,
           friday_on   = case when p ? 'sermon_date' then v_fri  else s.friday_on end,
           week_no     = case when p ? 'sermon_date' then v_week else s.week_no end,
           hijri_text  = case when p ? 'hijri_text'
                              then nullif(btrim(p ->> 'hijri_text'), '') else s.hijri_text end,
           mosque      = case when p ? 'mosque'
                              then nullif(p ->> 'mosque', '') else s.mosque end,
           sermon_type = case when p ? 'sermon_type'
                              then coalesce(nullif(btrim(p ->> 'sermon_type'), ''), s.sermon_type)
                              else s.sermon_type end,
           title       = case when p ? 'title'
                              then coalesce(nullif(btrim(p ->> 'title'), ''), s.title)
                              else s.title end,
           khateeb     = case when p ? 'khateeb'
                              then nullif(btrim(p ->> 'khateeb'), '') else s.khateeb end,
           seq         = case when p ? 'seq'
                              then nullif(p ->> 'seq', '')::int else s.seq end,
           notes       = case when p ? 'notes'
                              then nullif(btrim(p ->> 'notes'), '') else s.notes end
     where s.id = v_id;
  end if;

  for v_item in select jsonb_array_elements(coalesce(p -> 'versions', '[]'::jsonb)) loop
    v_lang := nullif(btrim(v_item ->> 'language_code'), '');
    continue when v_lang is null;
    if not exists (select 1 from public.languages where code = v_lang) then continue; end if;
    insert into public.arch_versions
      (sermon_id, language_code, is_source, body_html, file_path, audio_path, words, uploaded_by)
    values (v_id, v_lang, coalesce((v_item ->> 'is_source')::boolean, v_lang = 'ar'),
            nullif(btrim(v_item ->> 'body_html'), ''), nullif(btrim(v_item ->> 'file_path'), ''),
            nullif(btrim(v_item ->> 'audio_path'), ''),
            nullif(v_item ->> 'words', '')::int, auth.uid())
    on conflict (sermon_id, language_code) do update
      set body_html  = coalesce(excluded.body_html, public.arch_versions.body_html),
          file_path  = coalesce(excluded.file_path, public.arch_versions.file_path),
          audio_path = coalesce(excluded.audio_path, public.arch_versions.audio_path),
          words      = coalesce(excluded.words, public.arch_versions.words),
          is_source  = excluded.is_source,
          uploaded_at = now();
  end loop;

  return v_id;
end $$;
grant execute on function public.save_arch_sermon(jsonb) to authenticated;

comment on function public.save_arch_sermon(jsonb) is
  'حفظُ خطبةٍ ونسخِها — والتحديثُ على ما وَرَد وحدَه (ملاحظتا ٣٠٣ و٣٤٩)';

notify pgrst, 'reload schema';
