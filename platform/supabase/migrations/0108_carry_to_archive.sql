-- =====================================================================
-- 0108 — ترحيلُ خطب العام من أرشيف الترجمة إلى أرشيف الخطب (ملاحظة ٣٣٧)
--
--   أرشيفُ الترجمة سِجلُّ عملٍ: مادةٌ ومساراتُ لغاتِها ومراحلُها
--   وأزمنتُها. وأرشيفُ الخطب كتابٌ: عامٌ وأسابيعُ جُمَعِه وخطبتاه في
--   كلِّ جمعةٍ بنسخها. فإذا انقضى العامُ نُقلت أعمالُه المنجَزةُ إلى
--   موضعها من الكتاب: الخطبةُ تُنشأ أو تُضَمُّ إلى جمعتها، ونصُّ كلِّ
--   لغةٍ يصير نسخةً، والعربيُّ أصلًا.
--
--   وثلاثةُ أصولٍ في هذا الباب:
--   ١) لا يُنقَل إلا المنجَز: ما له تاريخُ إنجازٍ ولم يُحذَف.
--   ٢) ولا يُكرَّر: كلُّ نسخةٍ تحمل مسارَها الذي جاءت منه، فإعادةُ
--      الترحيل تُحدِّث ولا تُنشئ ثانيةً.
--   ٣) ولا يُمَسُّ أرشيفُ الترجمة: النقلُ نسخٌ لا نقلَ حقيقيّ، فالسِّجلُّ
--      يبقى على حاله للمراجعة والمحاسبة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) النسخةُ تعرف مسارَها: فلا تُنقَل مرتين
-- ---------------------------------------------------------------------
alter table public.arch_versions
  add column if not exists from_track_id uuid references public.tracks (id) on delete set null;

create index if not exists arch_versions_track on public.arch_versions (from_track_id);

comment on column public.arch_versions.from_track_id is
  'مسارُ الترجمة الذي رُحِّلت منه هذه النسخة، إن رُحِّلت (ملاحظة ٣٣٧)';

-- ---------------------------------------------------------------------
-- ٢) العامُ الهجريُّ لتاريخٍ ميلادي: يُعرَف من حدود الأعوام المحفوظة
-- ---------------------------------------------------------------------
create or replace function public.hijri_year_of(p_date date)
returns int language sql stable set search_path = public as $$
  select y.h_year
    from public.hijri_years y
   where p_date is not null
     and p_date >= y.starts_on
     and p_date <= coalesce((select n.starts_on - 1 from public.hijri_years n
                              where n.h_year = y.h_year + 1), y.starts_on + 354)
   order by y.starts_on desc
   limit 1
$$;
grant execute on function public.hijri_year_of(date) to authenticated;

comment on function public.hijri_year_of(date) is
  'العامُ الهجريُّ الذي يقع فيه تاريخٌ ميلاديّ (ملاحظة ٣٣٧)';

-- ---------------------------------------------------------------------
-- ٣) المعاينة: ما يصلح للترحيل في عامٍ، وما رُحِّل منه
-- ---------------------------------------------------------------------
create or replace function public.arch_carry_preview(p_year int, p_section uuid default null)
returns table (material_id uuid, title text, mosque text, sermon_type text,
               sermon_date date, khateeb text, langs int, carried int,
               has_source boolean, friday_on date, week_no int, matched uuid)
language sql stable security definer set search_path = public as $$
  with done as (
    select t.*
      from public.tracks t
     where t.completed_at is not null
       and t.deleted_at is null
  )
  select m.id, m.title,
         case when m.mosque in ('makkah', 'madinah') then m.mosque else null end,
         coalesce(m.sermon_type, 'خطبة جمعة'),
         m.sermon_date, k.name,
         (select count(*)::int from done d where d.material_id = m.id),
         (select count(*)::int from done d
            join public.arch_versions v on v.from_track_id = d.id
           where d.material_id = m.id),
         nullif(btrim(coalesce(m.source_html, '')), '') is not null,
         public.friday_of(m.sermon_date),
         public.arch_week_no(p_year, m.sermon_date),
         case when p_section is null
                or m.mosque is null or m.mosque not in ('makkah', 'madinah') then null
              else public.arch_match_sermon(p_section, m.sermon_date, m.mosque,
                     coalesce(m.sermon_type, 'خطبة جمعة')) end
    from public.materials m
    left join public.khateebs k on k.id = m.khateeb_id
   where public.my_role() is not null
     and m.deleted_at is null
     and m.sermon_date is not null
     and public.hijri_year_of(m.sermon_date) = p_year
     and exists (select 1 from done d where d.material_id = m.id)
   order by m.sermon_date, m.mosque
$$;
grant execute on function public.arch_carry_preview(int, uuid) to authenticated;

comment on function public.arch_carry_preview(int, uuid) is
  'أعمالُ عامٍ في أرشيف الترجمة صالحةً للترحيل، وبيانُ ما رُحِّل منها (ملاحظة ٣٣٧)';

-- ---------------------------------------------------------------------
-- ٤) الترحيل: يُنشئ الخطبةَ أو يضمُّ إليها، ويكتب نسخَ لغاتها
--
--    p_materials: موادُّ بعينها، أو null فالعامُ كلُّه.
--    p_overwrite: هل يُستبدَل نصُّ نسخةٍ قائمةٍ أم يُبقى على حاله.
--
--    والمرتجَعُ: { created, merged, versions, skipped, rows: [...] }
-- ---------------------------------------------------------------------
create or replace function public.carry_year_to_archive(
  p_year int, p_section uuid, p_materials uuid[] default null,
  p_overwrite boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_year int;
        v_m record; v_t record;
        v_id uuid; v_created int := 0; v_merged int := 0; v_vers int := 0; v_skip int := 0;
        v_rows jsonb := '[]'::jsonb; v_why text; v_seq int;
        v_src text;
begin
  if not (public.is_manager() or public.is_admin_for('arch_upload')) then
    raise exception 'ترحيلُ الخطب بإذن مدير المشروع' using errcode = '42501';
  end if;
  if p_section is null then raise exception 'لم يُحدَّد القسم'; end if;

  select h_year into v_year from public.arch_sections where id = p_section;
  if v_year is null then raise exception 'قسمٌ غيرُ موجود'; end if;
  if v_year <> p_year then
    raise exception 'القسمُ من عامٍ آخر — اختَرْ قسمًا من عام %', p_year;
  end if;

  for v_m in
    select m.id, m.title, m.mosque, coalesce(m.sermon_type, 'خطبة جمعة') as sermon_type,
           m.sermon_date, m.source_html, k.name as khateeb
      from public.materials m
      left join public.khateebs k on k.id = m.khateeb_id
     where m.deleted_at is null
       and m.sermon_date is not null
       and public.hijri_year_of(m.sermon_date) = p_year
       and (p_materials is null or m.id = any (p_materials))
       and exists (select 1 from public.tracks t
                    where t.material_id = m.id
                      and t.completed_at is not null and t.deleted_at is null)
     order by m.sermon_date, m.mosque
  loop
    -- ما لا مسجدَ له ولا تاريخ لا يأخذ صفَّه في الكتاب (إصلاح ٣١٦)
    --   و«عامّة» ليست حرمًا: الموادُّ العامةُ لا تقع في جمعةٍ ولا تدخل
    --   صفَّ حرمٍ، فتُردُّ ويُبيَّن سببُها
    v_why := case when v_m.sermon_date is null then 'بلا تاريخ'
                  when v_m.mosque is null or v_m.mosque not in ('makkah', 'madinah')
                       then 'بلا مسجد'
                  when btrim(coalesce(v_m.title, '')) = '' then 'بلا عنوان'
                  else null end;
    if v_why is not null then
      v_skip := v_skip + 1;
      v_rows := v_rows || jsonb_build_object('material_id', v_m.id, 'title', v_m.title,
        'state', 'skipped', 'why', v_why);
      continue;
    end if;

    v_id := public.arch_match_sermon(p_section, v_m.sermon_date, v_m.mosque, v_m.sermon_type);
    if v_id is null then
      select coalesce(max(seq), 0) + 1 into v_seq from public.arch_sermons where h_year = v_year;
      insert into public.arch_sermons
        (section_id, h_year, friday_on, week_no, sermon_date, mosque, sermon_type,
         title, khateeb, seq, created_by)
      values (p_section, v_year, public.friday_of(v_m.sermon_date),
              public.arch_week_no(v_year, v_m.sermon_date), v_m.sermon_date,
              v_m.mosque, v_m.sermon_type, btrim(v_m.title), v_m.khateeb, v_seq, auth.uid())
      returning id into v_id;
      v_created := v_created + 1;
    else
      -- الخطبةُ قائمةٌ: يُستكمَل ناقصُها ولا يُمحى ما كُتب بيدٍ (ملاحظة ٣٠٥)
      update public.arch_sermons
         set khateeb = coalesce(khateeb, v_m.khateeb),
             title   = case when btrim(coalesce(title, '')) = '' then btrim(v_m.title)
                            else title end
       where id = v_id;
      v_merged := v_merged + 1;
    end if;

    -- الأصلُ العربيُّ نسخةً: من متن المادة إن كان
    v_src := nullif(btrim(coalesce(v_m.source_html, '')), '');
    if v_src is not null then
      insert into public.arch_versions (sermon_id, language_code, is_source, body_html, uploaded_by)
      values (v_id, 'ar', true, v_src, auth.uid())
      on conflict (sermon_id, language_code) do update
        set body_html = case when p_overwrite then excluded.body_html
                             else coalesce(public.arch_versions.body_html, excluded.body_html) end,
            is_source = true,
            uploaded_at = now();
      v_vers := v_vers + 1;
    end if;

    -- ثم نسخةٌ لكلِّ لغةٍ أُنجزت
    for v_t in
      select t.id, t.language_code, t.translation_html, t.audio_path
        from public.tracks t
       where t.material_id = v_m.id
         and t.completed_at is not null and t.deleted_at is null
         and nullif(btrim(coalesce(t.translation_html, '')), '') is not null
    loop
      insert into public.arch_versions
        (sermon_id, language_code, is_source, body_html, audio_path,
         from_track_id, uploaded_by)
      values (v_id, v_t.language_code, v_t.language_code = 'ar',
              v_t.translation_html, nullif(btrim(coalesce(v_t.audio_path, '')), ''),
              v_t.id, auth.uid())
      on conflict (sermon_id, language_code) do update
        set body_html = case when p_overwrite then excluded.body_html
                             else coalesce(public.arch_versions.body_html, excluded.body_html) end,
            audio_path = coalesce(public.arch_versions.audio_path, excluded.audio_path),
            from_track_id = coalesce(public.arch_versions.from_track_id, excluded.from_track_id),
            uploaded_at = now();
      v_vers := v_vers + 1;
    end loop;

    v_rows := v_rows || jsonb_build_object('material_id', v_m.id, 'sermon_id', v_id,
      'title', v_m.title, 'state', 'ok');
  end loop;

  return jsonb_build_object('created', v_created, 'merged', v_merged,
    'versions', v_vers, 'skipped', v_skip, 'rows', v_rows);
end $$;
grant execute on function public.carry_year_to_archive(int, uuid, uuid[], boolean) to authenticated;

comment on function public.carry_year_to_archive(int, uuid, uuid[], boolean) is
  'ترحيلُ أعمال عامٍ المنجَزةِ من أرشيف الترجمة إلى أرشيف الخطب (ملاحظة ٣٣٧)';

notify pgrst, 'reload schema';
