-- =====================================================================
-- 0102 — أرشيفُ الخطب السنوي: أعوامٌ وأقسامٌ وأسابيع (ملاحظة ٣٠٣)
--
--   «مستودعُ الترجمة» بُني ليحفظ أعمالَ السنوات الماضية جدولًا مسطَّحًا،
--   فلم يُستعمَل: أُدخل فيه عملٌ واحدٌ تجريبيٌّ لم يُفتَح. والحاجةُ
--   الحقيقيةُ غيرُه: خطبٌ من ١٤٤٤ إلى ١٤٤٨، لكلِّ عامٍ نحوُ خمسين جمعة،
--   في كلِّ جمعةٍ خطبتان — الحرامُ والنبويّ — ولكلِّ خطبةٍ عشرُ ترجمات.
--
--   فتُبنى على ما هي عليه: العامُ أيقونة، وفيه أقسامٌ تُضاف، وفي القسم
--   أسابيعُ الجُمَع، وفي الأسبوع صفَّان، ولكلِّ خطبةٍ نسخُها بلغاتها.
--   والمجمَّعُ السنويُّ يُولَّد منها عند الطلب لا يُرفَع جاهزًا.
--
--   ويُحذف المستودعُ وما فيه: تجربةٌ لم تُستعمَل، بإذن مدير المشروع.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) مفاتيحُ الأرشيف: الرفعُ والتعديلُ والتصدير (ملاحظة ٣٠٣)
-- ---------------------------------------------------------------------
insert into public.perm_keys (key, label, sort, parent, grp, default_open, sensitive, viewable) values
  ('archive_year', 'أرشيفُ الخطب السنوي',          180, null, 'الأرشيف السنوي', false, false, true)
on conflict (key) do nothing;

insert into public.perm_keys (key, label, sort, parent, grp, default_open, sensitive, viewable) values
  ('arch_upload', 'رفعُ الخطب وإضافةُ الأعوام والأقسام', 181, 'archive_year', 'الأرشيف السنوي', false, false, false),
  ('arch_edit',   'تعديلُ بيانات الخطب وحذفُها',         182, 'archive_year', 'الأرشيف السنوي', false, false, false),
  ('arch_export', 'إصدارُ المجمَّع وتصديرُ الخطب',       183, 'archive_year', 'الأرشيف السنوي', false, false, true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- ٢) الأعوامُ والأقسام
-- ---------------------------------------------------------------------
create table if not exists public.arch_years (
  h_year     int primary key check (h_year between 1300 and 1600),
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create table if not exists public.arch_sections (
  id         uuid primary key default gen_random_uuid(),
  h_year     int not null references public.arch_years (h_year) on delete cascade,
  name       text not null check (length(btrim(name)) > 1),
  icon       text not null default 'خطب',
  sort       int  not null default 100,
  created_at timestamptz not null default now(),
  unique (h_year, name)
);

comment on table public.arch_years    is 'أعوامُ الأرشيف الهجرية (ملاحظة ٣٠٣)';
comment on table public.arch_sections is 'أقسامُ العام: «الخطب» وما يُضاف إليها (ملاحظة ٣٠٣)';

-- ---------------------------------------------------------------------
-- ٣) الخطبةُ: واحدةٌ لها نسخٌ بلغات، تُنسَب إلى جمعتها ومسجدها
-- ---------------------------------------------------------------------
create table if not exists public.arch_sermons (
  id           uuid primary key default gen_random_uuid(),
  section_id   uuid not null references public.arch_sections (id) on delete cascade,
  h_year       int  not null,
  friday_on    date,                       -- جمعةُ الأسبوع، تُحسَب من التاريخ
  week_no      int,                        -- ترتيبُ الجمعة في العام
  sermon_date  date,                       -- تاريخُ الخطبة نفسِها
  hijri_text   text,                       -- كما كُتب في الملف: «٧ محرّم ١٤٤٤هـ»
  mosque       text check (mosque is null or mosque in ('makkah', 'madinah')),
  sermon_type  text not null default 'خطبة جمعة',
  title        text not null check (length(btrim(title)) > 0),
  khateeb      text,
  seq          int,                        -- رقمُ الخطبة في العام
  notes        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id)
);

create index if not exists arch_sermons_week on public.arch_sermons (h_year, friday_on, mosque);
create index if not exists arch_sermons_sec  on public.arch_sermons (section_id, sermon_date);

create table if not exists public.arch_versions (
  id            uuid primary key default gen_random_uuid(),
  sermon_id     uuid not null references public.arch_sermons (id) on delete cascade,
  language_code text not null references public.languages (code) on update cascade,
  is_source     boolean not null default false,
  body_html     text,
  file_path     text,
  audio_path    text,                      -- موضعٌ محجوزٌ للتسجيل (ملاحظة ٣٠٣)
  words         int,
  doc_no        text unique,
  uploaded_by   uuid references public.profiles (id),
  uploaded_at   timestamptz not null default now(),
  unique (sermon_id, language_code)
);

comment on table public.arch_sermons  is 'خطبةٌ واحدةٌ لها نسخٌ بلغات (ملاحظة ٣٠٣)';
comment on table public.arch_versions is 'نسخةُ الخطبة بلغتها: نصًّا أو ملفًّا أو صوتًا (ملاحظة ٣٠٣)';

alter table public.arch_years    enable row level security;
alter table public.arch_sections enable row level security;
alter table public.arch_sermons  enable row level security;
alter table public.arch_versions enable row level security;

do $do$
declare t text;
begin
  foreach t in array array['arch_years', 'arch_sections', 'arch_sermons', 'arch_versions'] loop
    execute format('drop policy if exists "read archive" on public.%I', t);
    execute format(
      'create policy "read archive" on public.%I for select using (public.my_role() is not null)', t);
  end loop;
end $do$;

-- ---------------------------------------------------------------------
-- ٤) جُمَعُ العام: تُحسَب من تقويمه لا تُدخَل يدويًّا
-- ---------------------------------------------------------------------
create or replace function public.hijri_year_bounds(p_year int)
returns table (starts_on date, ends_on date)
language sql stable set search_path = public as $$
  select y.starts_on,
         coalesce((select n.starts_on - 1 from public.hijri_years n
                    where n.h_year = p_year + 1), y.starts_on + 354)
    from public.hijri_years y where y.h_year = p_year
$$;
grant execute on function public.hijri_year_bounds(int) to authenticated;

-- الجمعةُ التي يقع فيها تاريخٌ: ٥ = الجمعة في ISO
create or replace function public.friday_of(p_date date)
returns date language sql immutable set search_path = public as $$
  select case when p_date is null then null
              else p_date + (5 - extract(isodow from p_date)::int) end
$$;
grant execute on function public.friday_of(date) to authenticated;

-- أوّلُ جمعةٍ في العام: ما وقعت داخلَ حدوده
create or replace function public.first_friday_of_year(p_year int)
returns date language sql stable set search_path = public as $$
  select case when public.friday_of(b.starts_on) >= b.starts_on
              then public.friday_of(b.starts_on)
              else public.friday_of(b.starts_on) + 7 end
    from public.hijri_year_bounds(p_year) b
$$;
grant execute on function public.first_friday_of_year(int) to authenticated;

-- رقمُ أسبوعِ تاريخٍ في عامه — واحدٌ في العرض والحفظ والتغطية
create or replace function public.arch_week_no(p_year int, p_date date)
returns int language sql stable set search_path = public as $$
  select case when p_date is null then null
              else greatest(1, ((public.friday_of(p_date)
                   - public.first_friday_of_year(p_year)) / 7) + 1) end
$$;
grant execute on function public.arch_week_no(int, date) to authenticated;

-- أسابيعُ العام: الجمعةُ ورقمُها، وما فيها من الخطب
create or replace function public.arch_weeks(p_year int, p_section uuid default null)
returns table (week_no int, friday_on date, makkah jsonb, madinah jsonb, langs int)
language sql stable security definer set search_path = public as $$
  with b as (select * from public.hijri_year_bounds(p_year)),
  fridays as (
    select row_number() over (order by d)::int as week_no, d::date as friday_on
      from b, generate_series(public.first_friday_of_year(p_year), b.ends_on, interval '7 day') d
  ),
  s as (
    select m.*, (select count(*) from public.arch_versions v where v.sermon_id = m.id) as n_langs
      from public.arch_sermons m
     where m.h_year = p_year
       and (p_section is null or m.section_id = p_section)
  )
  select f.week_no, f.friday_on,
         (select to_jsonb(x) from (
            select s.id, s.title, s.khateeb, s.seq, s.sermon_date, s.hijri_text,
                   s.sermon_type, s.n_langs
              from s where s.friday_on = f.friday_on and s.mosque = 'makkah' limit 1) x),
         (select to_jsonb(x) from (
            select s.id, s.title, s.khateeb, s.seq, s.sermon_date, s.hijri_text,
                   s.sermon_type, s.n_langs
              from s where s.friday_on = f.friday_on and s.mosque = 'madinah' limit 1) x),
         (select coalesce(sum(s.n_langs), 0)::int from s where s.friday_on = f.friday_on)
    from fridays f
   where public.my_role() is not null
   order by f.week_no
$$;
grant execute on function public.arch_weeks(int, uuid) to authenticated;

comment on function public.arch_weeks(int, uuid) is
  'أسابيعُ العام: الجمعةُ ورقمُها، وخطبتا الحرمين فيها (ملاحظة ٣٠٣)';

-- وما لا يقع في جمعة — العيدان وعرفةُ والاستسقاء — يُعرَض مستقلًّا
create or replace function public.arch_occasions(p_year int, p_section uuid default null)
returns table (id uuid, title text, khateeb text, mosque text, sermon_type text,
               sermon_date date, hijri_text text, seq int, n_langs int)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.khateeb, m.mosque, m.sermon_type, m.sermon_date,
         m.hijri_text, m.seq,
         (select count(*)::int from public.arch_versions v where v.sermon_id = m.id)
    from public.arch_sermons m
   where public.my_role() is not null
     and m.h_year = p_year
     and (p_section is null or m.section_id = p_section)
     and m.sermon_type <> 'خطبة جمعة'
   order by m.sermon_date
$$;
grant execute on function public.arch_occasions(int, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٥) بطاقاتُ الأعوام: عددُ خطبها ولغاتها
-- ---------------------------------------------------------------------
create or replace function public.arch_year_tiles()
returns table (h_year int, sermons int, versions int, langs int, sections int)
language sql stable security definer set search_path = public as $$
  select y.h_year,
         (select count(*)::int from public.arch_sermons m where m.h_year = y.h_year),
         (select count(*)::int from public.arch_versions v
            join public.arch_sermons m on m.id = v.sermon_id where m.h_year = y.h_year),
         (select count(distinct v.language_code)::int from public.arch_versions v
            join public.arch_sermons m on m.id = v.sermon_id where m.h_year = y.h_year),
         (select count(*)::int from public.arch_sections s where s.h_year = y.h_year)
    from public.arch_years y
   where public.my_role() is not null
   order by y.h_year desc
$$;
grant execute on function public.arch_year_tiles() to authenticated;

create or replace function public.arch_section_tiles(p_year int)
returns table (id uuid, name text, icon text, sermons int, versions int)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.icon,
         (select count(*)::int from public.arch_sermons m where m.section_id = s.id),
         (select count(*)::int from public.arch_versions v
            join public.arch_sermons m on m.id = v.sermon_id where m.section_id = s.id)
    from public.arch_sections s
   where public.my_role() is not null and s.h_year = p_year
   order by s.sort, s.name
$$;
grant execute on function public.arch_section_tiles(int) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) الإنشاءُ والتعديل — بمفاتيحها (ملاحظة ٣٠٣)
-- ---------------------------------------------------------------------
create or replace function public.add_arch_year(p_year int, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_admin_for('arch_upload')) then
    raise exception 'إضافةُ الأعوام بإذن مدير المشروع' using errcode = '42501';
  end if;
  if p_year is null or p_year < 1300 or p_year > 1600 then
    raise exception 'عامٌ هجريٌّ غيرُ صحيح';
  end if;
  insert into public.arch_years (h_year, note, created_by)
  values (p_year, nullif(btrim(p_note), ''), auth.uid())
  on conflict (h_year) do nothing;
  -- ويُنشأ قسمُ «الخطب» معه، فهو المحتاجُ إليه اليوم
  insert into public.arch_sections (h_year, name, icon, sort)
  values (p_year, 'الخطب', 'خطب', 10)
  on conflict (h_year, name) do nothing;
  return p_year;
end $$;
grant execute on function public.add_arch_year(int, text) to authenticated;

create or replace function public.add_arch_section(p_year int, p_name text, p_icon text default 'خطب')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.is_manager() or public.is_admin_for('arch_upload')) then
    raise exception 'إضافةُ الأقسام بإذن مدير المشروع' using errcode = '42501';
  end if;
  insert into public.arch_sections (h_year, name, icon)
  values (p_year, btrim(p_name), coalesce(nullif(btrim(p_icon), ''), 'خطب'))
  on conflict (h_year, name) do update set icon = excluded.icon
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.add_arch_section(int, text, text) to authenticated;

-- حفظُ خطبةٍ ونسخِها: يُنشئ أو يُعدّل، ويضع الخطبةَ في جمعتها
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
    select coalesce(max(seq), 0) + 1 into v_seq from public.arch_sermons where h_year = v_year;
    insert into public.arch_sermons
      (section_id, h_year, friday_on, week_no, sermon_date, hijri_text, mosque,
       sermon_type, title, khateeb, seq, notes, created_by)
    values (v_sec, v_year, v_fri, v_week, v_date, nullif(btrim(p ->> 'hijri_text'), ''),
            nullif(p ->> 'mosque', ''), coalesce(nullif(btrim(p ->> 'sermon_type'), ''), 'خطبة جمعة'),
            btrim(p ->> 'title'), nullif(btrim(p ->> 'khateeb'), ''), v_seq,
            nullif(btrim(p ->> 'notes'), ''), auth.uid())
    returning id into v_id;
  else
    if not (public.is_manager() or public.is_admin_for('arch_edit')) then
      raise exception 'تعديلُ الخطب بإذن مدير المشروع' using errcode = '42501';
    end if;
    update public.arch_sermons
       set section_id = v_sec, h_year = v_year, friday_on = v_fri, week_no = v_week,
           sermon_date = v_date, hijri_text = nullif(btrim(p ->> 'hijri_text'), ''),
           mosque = nullif(p ->> 'mosque', ''),
           sermon_type = coalesce(nullif(btrim(p ->> 'sermon_type'), ''), 'خطبة جمعة'),
           title = btrim(p ->> 'title'), khateeb = nullif(btrim(p ->> 'khateeb'), ''),
           notes = nullif(btrim(p ->> 'notes'), '')
     where id = v_id;
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

create or replace function public.delete_arch_sermon(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_admin_for('arch_edit')) then
    raise exception 'حذفُ الخطب بإذن مدير المشروع' using errcode = '42501';
  end if;
  delete from public.arch_sermons where id = p_id;
end $$;
grant execute on function public.delete_arch_sermon(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٧) نسخُ الخطبة الواحدة، ومصفوفةُ التغطية
-- ---------------------------------------------------------------------
create or replace function public.arch_sermon(p_id uuid)
returns table (id uuid, title text, khateeb text, mosque text, sermon_type text,
               sermon_date date, hijri_text text, week_no int, seq int, h_year int,
               notes text, versions jsonb)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.khateeb, m.mosque, m.sermon_type, m.sermon_date,
         m.hijri_text, m.week_no, m.seq, m.h_year, m.notes,
         coalesce((select jsonb_agg(to_jsonb(x) order by x.is_source desc, x.language_code)
                     from (select v.language_code, v.is_source, v.doc_no,
                                  (v.file_path is not null)  as has_file,
                                  (v.audio_path is not null) as has_audio,
                                  (nullif(btrim(coalesce(v.body_html, '')), '') is not null) as has_text,
                                  v.words, v.uploaded_at
                             from public.arch_versions v where v.sermon_id = m.id) x), '[]'::jsonb)
    from public.arch_sermons m
   where m.id = p_id and public.my_role() is not null
$$;
grant execute on function public.arch_sermon(uuid) to authenticated;

-- النصُّ نفسُه: يُقرأ لمن له الاطّلاع، ويُبنى به المجمَّع
create or replace function public.arch_version_text(p_sermon uuid, p_lang text)
returns table (body_html text, file_path text, audio_path text, doc_no text)
language sql stable security definer set search_path = public as $$
  select v.body_html, v.file_path, v.audio_path, v.doc_no
    from public.arch_versions v
   where v.sermon_id = p_sermon and v.language_code = p_lang
     and public.my_role() is not null
$$;
grant execute on function public.arch_version_text(uuid, text) to authenticated;

create or replace function public.arch_coverage(p_year int)
returns table (week_no int, friday_on date, mosque text, title text, lang_codes text[])
language sql stable security definer set search_path = public as $$
  select m.week_no, m.friday_on, m.mosque, m.title,
         coalesce(array_agg(v.language_code order by v.language_code)
                  filter (where v.language_code is not null), '{}')
    from public.arch_sermons m
    left join public.arch_versions v on v.sermon_id = m.id
   where public.my_role() is not null and m.h_year = p_year
   group by m.week_no, m.friday_on, m.mosque, m.title
   order by m.week_no, m.mosque
$$;
grant execute on function public.arch_coverage(int) to authenticated;

-- ---------------------------------------------------------------------
-- ٨) المجمَّعُ السنوي: خطبُ عامٍ بلغةٍ مرتَّبةً، يُبنى منها الكتاب
-- ---------------------------------------------------------------------
create or replace function public.arch_book(
  p_year int, p_lang text, p_mosque text default null, p_section uuid default null
) returns table (seq int, week_no int, title text, khateeb text, mosque text,
                 sermon_type text, sermon_date date, hijri_text text,
                 body_html text, doc_no text)
language sql stable security definer set search_path = public as $$
  select m.seq, m.week_no, m.title, m.khateeb, m.mosque, m.sermon_type,
         m.sermon_date, m.hijri_text, v.body_html, v.doc_no
    from public.arch_sermons m
    join public.arch_versions v on v.sermon_id = m.id and v.language_code = p_lang
   where (public.is_manager() or public.is_admin_for('arch_export')
          or public.is_admin() or public.is_supervisor() or public.is_viewer())
     and m.h_year = p_year
     and (p_mosque is null or m.mosque = p_mosque)
     and (p_section is null or m.section_id = p_section)
   order by coalesce(m.sermon_date, date '9999-12-31'), m.seq
$$;
grant execute on function public.arch_book(int, text, text, uuid) to authenticated;

comment on function public.arch_book(int, text, text, uuid) is
  'خطبُ عامٍ بلغةٍ مرتَّبةً زمنيًّا — تُبنى منها نسخةُ المجمَّع (ملاحظة ٣٠٩)';

-- لغاتُ العامِ المتاحةُ وعددُ خطبِ كلٍّ منها
create or replace function public.arch_book_langs(p_year int)
returns table (language_code text, name_ar text, n int)
language sql stable security definer set search_path = public as $$
  select v.language_code, l.name_ar, count(*)::int
    from public.arch_versions v
    join public.arch_sermons m on m.id = v.sermon_id
    join public.languages l on l.code = v.language_code
   where public.my_role() is not null and m.h_year = p_year
   group by v.language_code, l.name_ar, l.sort
   order by l.sort
$$;
grant execute on function public.arch_book_langs(int) to authenticated;

-- ---------------------------------------------------------------------
-- ٩) الأعوامُ الخمسةُ تُنشأ جاهزة (ملاحظة ٣٠٣)
-- ---------------------------------------------------------------------
insert into public.arch_years (h_year) values (1444), (1445), (1446), (1447), (1448)
on conflict (h_year) do nothing;

insert into public.arch_sections (h_year, name, icon, sort)
select y.h_year, 'الخطب', 'خطب', 10 from public.arch_years y
on conflict (h_year, name) do nothing;

-- ---------------------------------------------------------------------
-- ١٠) وحذفُ مستودع الترجمة: تجربةٌ لم تُستعمَل (ملاحظة ٣٠٣)
--     والملفُّ في المخزن يُحذف بإجراءٍ مستقلٍّ على الخادم
-- ---------------------------------------------------------------------
drop function if exists public.commit_repo_uploads(uuid);
drop function if exists public.save_repo_upload(jsonb);
drop function if exists public.delete_repo_upload(uuid);
drop function if exists public.stage_repo_upload(jsonb);
drop function if exists public.repo_guess(text);
drop function if exists public.save_repo_work(jsonb);
drop function if exists public.delete_repo_work(uuid);
drop function if exists public.delete_repo_item(uuid);
drop function if exists public.repo_type_counts();

drop view if exists public.repo_rows;
drop table if exists public.repo_uploads cascade;
drop table if exists public.repo_batches cascade;
drop table if exists public.repo_items   cascade;
drop table if exists public.repo_works   cascade;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ١١) قوالبُ المجمَّع: الغلافُ وصفحةُ عنوان الخطبة والصفحاتُ الداخلية
--     ولكلٍّ اسمُه، والافتراضيُّ لا يُمَسّ (ملاحظة ٣١٠)
-- ---------------------------------------------------------------------
create table if not exists public.book_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(btrim(name)) > 1),
  h_year     int,                       -- فارغٌ: يصلح لكلِّ عام
  tpl        jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

comment on table public.book_templates is
  'قوالبُ المجمَّع: الغلافُ وصفحةُ العنوان والصفحاتُ الداخلية (ملاحظة ٣١٠)';

alter table public.book_templates enable row level security;
drop policy if exists "read book templates" on public.book_templates;
create policy "read book templates" on public.book_templates for select
  using (public.my_role() is not null);

-- القالبُ المختارُ لعام: الخاصُّ به إن وُجد، وإلا الافتراضيُّ العام
create or replace function public.book_template(p_year int default null)
returns table (id uuid, name text, tpl jsonb)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.tpl
    from public.book_templates t
   where public.my_role() is not null
     and (t.h_year = p_year or (t.h_year is null and t.is_default))
   order by (t.h_year = p_year) desc, t.is_default desc
   limit 1
$$;
grant execute on function public.book_template(int) to authenticated;

create or replace function public.book_templates_list()
returns table (id uuid, name text, h_year int, is_default boolean, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.h_year, t.is_default, t.updated_at
    from public.book_templates t
   where public.my_role() is not null
   order by t.is_default desc, t.h_year nulls first, t.name
$$;
grant execute on function public.book_templates_list() to authenticated;

create or replace function public.save_book_template(
  p_name text, p_tpl jsonb, p_year int default null, p_default boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.is_manager() or public.is_admin_for('arch_export')) then
    raise exception 'قوالبُ المجمَّع بإذن مدير المشروع' using errcode = '42501';
  end if;
  if p_tpl is null or jsonb_typeof(p_tpl) <> 'object' then
    raise exception 'قالبٌ غيرُ مقروء';
  end if;

  insert into public.book_templates (name, h_year, tpl, is_default, updated_by)
  values (btrim(p_name), p_year, p_tpl, coalesce(p_default, false), auth.uid())
  on conflict (name) do update
    set tpl = excluded.tpl, h_year = excluded.h_year,
        is_default = excluded.is_default, updated_at = now(), updated_by = auth.uid()
  returning id into v_id;

  if coalesce(p_default, false) then
    update public.book_templates set is_default = false where id <> v_id;
  end if;
  return v_id;
end $$;
grant execute on function public.save_book_template(text, jsonb, int, boolean) to authenticated;

notify pgrst, 'reload schema';
