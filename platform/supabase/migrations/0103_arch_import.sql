-- =====================================================================
-- 0103 — الرفعُ الجماعيُّ للمجمَّع: خطبُ العام في ملفٍ واحد (ملاحظة ٣٠٥)
--
--   يَرفع مديرُ المشروع ملفَ وورد واحدًا فيه خطبُ العام كلُّها — كما هي
--   عندَه منذ ١٤٤٤ — فتُقرأ في المتصفح، وتُشقُّ عند كلِّ صفحةِ عنوان،
--   ويُستنبطُ من متنِها قبلَ كلِّ خطبةٍ تاريخُها ومسجدُها وخطيبُها
--   ولغتُها، ثم يُعرض ذلك كلُّه جدولَ مراجعةٍ يُصحَّح فيه ما أخطأ
--   الاستنباطُ. ولا يُكتب في الأرشيف شيءٌ حتى يُعتمدَ الجدول.
--
--   وهذه الدالةُ هي خطوةُ الاعتماد وحدَها: تضع كلَّ خطبةٍ في جمعتها،
--   وتَضمُّ ما اتّفق تاريخُه ومسجدُه في خطبةٍ واحدةٍ تتعدّد نسخُها
--   باللغات، فلا تتكرّرُ الجمعةُ مرّتين لأنّ لغتَها جاءت في ملفَّين.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الخطبةُ القائمةُ في جمعتها: الضمُّ لا التكرار
-- ---------------------------------------------------------------------
create or replace function public.arch_match_sermon(
  p_section uuid, p_date date, p_mosque text, p_type text default null)
returns uuid language sql stable set search_path = public as $$
  select s.id
    from public.arch_sermons s
   where s.section_id = p_section
     and p_mosque is not null
     and s.mosque = p_mosque
     and p_date is not null
     and s.friday_on = public.friday_of(p_date)
     and coalesce(s.sermon_type, '') = coalesce(nullif(btrim(p_type), ''), s.sermon_type, '')
   order by s.sermon_date = p_date desc, s.created_at
   limit 1
$$;
grant execute on function public.arch_match_sermon(uuid, date, text, text) to authenticated;

comment on function public.arch_match_sermon(uuid, date, text, text) is
  'الخطبةُ القائمةُ في جمعةِ هذا التاريخ ومسجدِه، إن كانت (ملاحظة ٣٠٥)';

-- ---------------------------------------------------------------------
-- ٢) الاعتماد: جدولُ المراجعة يُكتب في الأرشيف دفعةً واحدة
--
--    p = { section_id, overwrite, items: [ {
--            sermon_date, hijri_text, mosque, title, khateeb,
--            sermon_type, notes,
--            versions: [ { language_code, is_source, body_html, words } ]
--          } ] }
--
--    والمرتجَعُ بيانُ ما جرى: ما أُنشئ وما ضُمَّ وكم نسخةً كُتبت،
--    وصفٌّ لكلِّ بندٍ برقمِه كما جاء في الجدول.
-- ---------------------------------------------------------------------
create or replace function public.import_arch_sermons(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sec uuid := nullif(p ->> 'section_id', '')::uuid;
        v_over boolean := coalesce((p ->> 'overwrite')::boolean, false);
        v_year int;
        v_item jsonb; v_ver jsonb;
        v_id uuid; v_date date; v_mos text; v_type text; v_title text;
        v_lang text; v_i int := 0;
        v_made int := 0; v_join int := 0; v_vers int := 0; v_skip int := 0;
        v_rows jsonb := '[]'::jsonb; v_act text; v_langs text[];
        v_seq int;
begin
  if not (public.is_manager() or public.is_admin_for('arch_upload')) then
    raise exception 'رفعُ الخطب بإذن مدير المشروع' using errcode = '42501';
  end if;
  if v_sec is null then raise exception 'لم يُحدَّد القسم'; end if;

  select h_year into v_year from public.arch_sections where id = v_sec;
  if v_year is null then raise exception 'قسمٌ غيرُ موجود'; end if;

  for v_item in select jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_date  := nullif(v_item ->> 'sermon_date', '')::date;
    v_mos   := nullif(v_item ->> 'mosque', '');
    v_type  := coalesce(nullif(btrim(v_item ->> 'sermon_type'), ''), 'خطبة جمعة');
    v_title := nullif(btrim(v_item ->> 'title'), '');

    -- بندٌ بلا عنوانٍ ولا تاريخٍ لا يُكتب: يُترك لصاحبه يُصحّحه
    if v_title is null or v_date is null then
      v_skip := v_skip + 1;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'i', v_i, 'action', 'skipped', 'why', 'العنوانُ أو التاريخُ ناقص'));
      continue;
    end if;

    v_id := public.arch_match_sermon(v_sec, v_date, v_mos, v_type);

    if v_id is null then
      select coalesce(max(seq), 0) + 1 into v_seq
        from public.arch_sermons where h_year = v_year;
      insert into public.arch_sermons
        (section_id, h_year, friday_on, week_no, sermon_date, hijri_text, mosque,
         sermon_type, title, khateeb, seq, notes, created_by)
      values (v_sec, v_year, public.friday_of(v_date),
              public.arch_week_no(v_year, v_date), v_date,
              nullif(btrim(v_item ->> 'hijri_text'), ''), v_mos, v_type, v_title,
              nullif(btrim(v_item ->> 'khateeb'), ''), v_seq,
              nullif(btrim(v_item ->> 'notes'), ''), auth.uid())
      returning id into v_id;
      v_made := v_made + 1;
      v_act := 'created';
    else
      -- الضمُّ لا يُفسد ما كُتب: لا يُكتب إلا على خانةٍ خاليةٍ
      -- إلا أن يُطلب الاستبدالُ صريحًا
      update public.arch_sermons s
         set title       = case when v_over then v_title else coalesce(nullif(btrim(s.title), ''), v_title) end,
             khateeb     = case when v_over then coalesce(nullif(btrim(v_item ->> 'khateeb'), ''), s.khateeb)
                                else coalesce(s.khateeb, nullif(btrim(v_item ->> 'khateeb'), '')) end,
             hijri_text  = case when v_over then coalesce(nullif(btrim(v_item ->> 'hijri_text'), ''), s.hijri_text)
                                else coalesce(s.hijri_text, nullif(btrim(v_item ->> 'hijri_text'), '')) end,
             sermon_date = coalesce(s.sermon_date, v_date),
             notes       = coalesce(s.notes, nullif(btrim(v_item ->> 'notes'), ''))
       where s.id = v_id;
      v_join := v_join + 1;
      v_act := 'merged';
    end if;

    v_langs := '{}';
    for v_ver in select jsonb_array_elements(coalesce(v_item -> 'versions', '[]'::jsonb)) loop
      v_lang := nullif(btrim(v_ver ->> 'language_code'), '');
      continue when v_lang is null;
      if not exists (select 1 from public.languages where code = v_lang) then continue; end if;
      if nullif(btrim(v_ver ->> 'body_html'), '') is null
         and nullif(btrim(v_ver ->> 'file_path'), '') is null then continue; end if;

      insert into public.arch_versions
        (sermon_id, language_code, is_source, body_html, file_path, words, uploaded_by)
      values (v_id, v_lang,
              coalesce((v_ver ->> 'is_source')::boolean, v_lang = 'ar'),
              nullif(btrim(v_ver ->> 'body_html'), ''),
              nullif(btrim(v_ver ->> 'file_path'), ''),
              nullif(v_ver ->> 'words', '')::int, auth.uid())
      on conflict (sermon_id, language_code) do update
        set body_html = case when v_over then coalesce(excluded.body_html, public.arch_versions.body_html)
                             else coalesce(public.arch_versions.body_html, excluded.body_html) end,
            file_path = coalesce(public.arch_versions.file_path, excluded.file_path),
            words     = coalesce(excluded.words, public.arch_versions.words),
            is_source = excluded.is_source,
            uploaded_at = now();
      v_vers := v_vers + 1;
      v_langs := v_langs || v_lang;
    end loop;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'i', v_i, 'action', v_act, 'sermon_id', v_id,
      'week_no', public.arch_week_no(v_year, v_date),
      'langs', to_jsonb(v_langs)));
  end loop;

  return jsonb_build_object('created', v_made, 'merged', v_join,
                            'versions', v_vers, 'skipped', v_skip,
                            'rows', v_rows);
end $$;
grant execute on function public.import_arch_sermons(jsonb) to authenticated;

comment on function public.import_arch_sermons(jsonb) is
  'اعتمادُ جدولِ المراجعة: خطبُ العام تُكتب في الأرشيف دفعةً واحدة (ملاحظة ٣٠٥)';
