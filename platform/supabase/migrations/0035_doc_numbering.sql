-- =====================================================================
-- 0035 — ترقيم التوثيق: رقم واحد لكل عمل مكتمل، يُطبع عليه ويُفهرَس به (ملاحظة ١٣٤)
--
--   H48-EN-120042
--   │  │  │ ││ └──── تسلسل العمل داخل نوعه، أربعة أرقام تتجدد كل سنة هجرية
--   │  │  │ └─────── نوع العمل: 1 جمعة · 2 عرفة · 3 أضحى · 4 فطر · 5 استسقاء
--   │  │  │           · 6 كسوف · 7 درس علمي · 8 كتاب · 9 مطوية
--   │  │  │           · 0 منشورات وتوجيهات وإعلانات   (ويمتد إلى الحروف A–Z)
--   │  │  └───────── النطاق: 0 عام · 1 تابع لمكة · 2 تابع للمدينة
--   │  └──────────── رمز اللغة بحرفين لاتينيين
--   └─────────────── H وسنتان من التاريخ الهجري
--
--   يُمنح الرقم مرّة واحدة عند اكتمال المسار واعتماده، ولا يتغير بعدها ولو
--   أُعيد تنشيط العمل وعُدِّل. والتسلسل مستقل لكل (سنة + لغة + نطاق + نوع).
-- =====================================================================

-- ---------------------------------------------------------------------
-- السنة الهجرية: جدول موثّق لبدايات السنوات (أم القرى) وحسابٌ احتياطي
-- ---------------------------------------------------------------------
create table if not exists public.hijri_years (
  h_year    int  primary key check (h_year between 1300 and 1600),
  starts_on date not null unique,
  verified  boolean not null default true,
  note      text
);
comment on table public.hijri_years is 'بدايات السنوات الهجرية (١ محرّم) بتقويم أم القرى — مرجع ترقيم التوثيق';

insert into public.hijri_years (h_year, starts_on, note) values
  (1445, date '2023-07-19', 'أم القرى'),
  (1446, date '2024-07-07', 'أم القرى'),
  (1447, date '2025-06-26', 'أم القرى'),
  (1448, date '2026-06-16', 'أم القرى')
on conflict (h_year) do nothing;

-- حساب السنة الهجرية بالتقويم الحسابي (يُستعمل خارج المدى الموثّق)
create or replace function public.hijri_year_calc(p_date date) returns int
language plpgsql immutable set search_path = public as $$
declare jd bigint; l bigint; n bigint; j bigint;
begin
  if p_date is null then return null; end if;
  jd := to_char(p_date, 'J')::bigint;
  l := jd - 1948440 + 10632;
  n := (l - 1) / 10631;
  l := l - 10631 * n + 354;
  j := ((10985 - l) / 5316) * ((50 * l) / 17719) + (l / 5670) * ((43 * l) / 15238);
  l := l - ((30 - j) / 15) * ((17719 * j) / 50) - (j / 16) * ((15238 * j) / 43) + 29;
  return (30 * n + j - 30)::int;
end $$;

-- السنة الهجرية لتاريخ ميلادي: من الجدول الموثّق إن كان التاريخ داخل مداه
create or replace function public.hijri_year(p_date date) returns int
language plpgsql stable set search_path = public as $$
declare v int;
begin
  if p_date is null then return null; end if;
  select h_year into v from public.hijri_years where starts_on <= p_date order by starts_on desc limit 1;
  if v is not null and exists (select 1 from public.hijri_years where starts_on > p_date) then
    return v;
  end if;
  return public.hijri_year_calc(p_date);
end $$;

-- إضافة سنة هجرية أو تصحيح بدايتها — لمدير المشروع
create or replace function public.set_hijri_year_start(p_year int, p_starts date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'ضبط التقويم الهجري لمدير المشروع' using errcode = '42501'; end if;
  insert into public.hijri_years (h_year, starts_on, verified, note)
  values (p_year, p_starts, true, 'ضبط يدوي')
  on conflict (h_year) do update set starts_on = excluded.starts_on, verified = true, note = 'ضبط يدوي';
end $$;

-- ---------------------------------------------------------------------
-- رموز أنواع الأعمال: خانة واحدة، أرقامٌ اليوم وحروفٌ عند التوسّع
-- ---------------------------------------------------------------------
create table if not exists public.doc_type_codes (
  id            serial primary key,
  material_type text not null,
  sermon_type   text,
  code          text not null check (code ~ '^[0-9A-Z]$'),
  label         text not null,
  sort          int  not null default 0
);
create unique index if not exists doc_type_codes_key
  on public.doc_type_codes (material_type, coalesce(sermon_type, ''));
comment on table public.doc_type_codes is 'خانة نوع العمل في رقم التوثيق (ملاحظة ١٣٤)';

insert into public.doc_type_codes (material_type, sermon_type, code, label, sort) values
  ('خطب',        'خطبة جمعة',       '1', 'خطبة الجمعة',      1),
  ('خطب',        'خطبة عرفة',       '2', 'خطبة يوم عرفة',    2),
  ('خطب',        'خطبة عيد الأضحى', '3', 'خطبة عيد الأضحى',  3),
  ('خطب',        'خطبة عيد الفطر',  '4', 'خطبة عيد الفطر',   4),
  ('خطب',        'خطبة استسقاء',    '5', 'خطبة الاستسقاء',   5),
  ('خطب',        'خطبة كسوف',       '6', 'خطبة الكسوف',      6),
  ('دروس علمية',  null,             '7', 'درس علمي',         7),
  ('كتب',        null,              '8', 'كتاب',             8),
  ('مطويات',     null,              '9', 'مطوية',            9),
  ('منشورات',    null,              '0', 'منشور',           10),
  ('توجيهات',    null,              '0', 'توجيه',           11),
  ('إعلانات',    null,              '0', 'إعلان',           12)
on conflict (material_type, coalesce(sermon_type, '')) do nothing;

-- إضافة نوع أو تعديل رمزه — لمدير المشروع (التوسّع إلى الحروف من هنا)
create or replace function public.set_doc_type_code(
  p_material_type text, p_sermon_type text, p_code text, p_label text, p_sort int default 99
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'ضبط رموز الأنواع لمدير المشروع' using errcode = '42501'; end if;
  insert into public.doc_type_codes (material_type, sermon_type, code, label, sort)
  values (p_material_type, nullif(trim(coalesce(p_sermon_type, '')), ''), upper(p_code), p_label, p_sort)
  on conflict (material_type, coalesce(sermon_type, ''))
  do update set code = upper(excluded.code), label = excluded.label, sort = excluded.sort;
end $$;

-- ---------------------------------------------------------------------
-- عدّادات التسلسل: لكل (سنة هجرية + لغة + نطاق + نوع) عدّاد مستقل
-- ---------------------------------------------------------------------
create table if not exists public.doc_serials (
  h_year int  not null,
  lang   text not null,
  scope  text not null,
  kind   text not null,
  last   int  not null default 0,
  primary key (h_year, lang, scope, kind)
);
comment on table public.doc_serials is 'آخر تسلسل مُنح في كل نوع من كل سنة هجرية (ملاحظة ١٣٤)';

-- ---------------------------------------------------------------------
-- أعمدة الرقم في المسار
-- ---------------------------------------------------------------------
alter table public.tracks add column if not exists doc_no      text;
alter table public.tracks add column if not exists doc_no_at   timestamptz;
alter table public.tracks add column if not exists doc_h_year  int;
alter table public.tracks add column if not exists doc_serial  int;

create unique index if not exists tracks_doc_no_key on public.tracks (doc_no) where doc_no is not null;
comment on column public.tracks.doc_no is 'رقم التوثيق المطبوع على العمل (ملاحظة ١٣٤)';

-- ---------------------------------------------------------------------
-- مكوّنات الرقم
-- ---------------------------------------------------------------------
create or replace function public.doc_scope(p_mosque text) returns text
language sql immutable as $$
  select case p_mosque when 'makkah' then '1' when 'madinah' then '2' else '0' end
$$;

create or replace function public.doc_kind_code(p_material_type text, p_sermon_type text) returns text
language plpgsql stable set search_path = public as $$
declare v text;
begin
  select code into v from public.doc_type_codes
   where material_type = p_material_type
     and coalesce(sermon_type, '') = coalesce(nullif(trim(coalesce(p_sermon_type, '')), ''), '')
   limit 1;
  if v is null then
    select code into v from public.doc_type_codes
     where material_type = p_material_type and sermon_type is null limit 1;
  end if;
  return coalesce(v, 'X');     -- ما لا رمز له يُجمع تحت X حتى يُضبط رمزه
end $$;

create or replace function public.doc_no_text(p_year int, p_lang text, p_scope text, p_kind text, p_serial int)
returns text language sql immutable as $$
  select 'H' || lpad((p_year % 100)::text, 2, '0') || '-' || upper(p_lang) || '-'
         || p_scope || p_kind || lpad(p_serial::text, 4, '0')
$$;

-- ---------------------------------------------------------------------
-- منح الرقم: مرّة واحدة لكل مسار، عند الاكتمال
-- ---------------------------------------------------------------------
create or replace function public.assign_doc_no(p_track uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_t record; v_m record; v_year int; v_scope text; v_kind text; v_serial int; v_no text;
begin
  select * into v_t from public.tracks where id = p_track;
  if v_t.id is null then raise exception 'المسار غير موجود'; end if;
  if v_t.doc_no is not null then return v_t.doc_no; end if;
  if v_t.status <> 'completed' then raise exception 'رقم التوثيق يُمنح بعد اكتمال المسار واعتماده'; end if;

  select * into v_m from public.materials where id = v_t.material_id;
  -- سنة العمل: تاريخ المادة إن وُجد، وإلا تاريخ الاعتماد
  v_year  := public.hijri_year(coalesce(v_m.sermon_date, (coalesce(v_t.completed_at, now()))::date));
  v_scope := public.doc_scope(v_m.mosque);
  v_kind  := public.doc_kind_code(v_m.material_type, v_m.sermon_type);

  insert into public.doc_serials (h_year, lang, scope, kind, last)
  values (v_year, upper(v_t.language_code), v_scope, v_kind, 1)
  on conflict (h_year, lang, scope, kind)
  do update set last = doc_serials.last + 1
  returning last into v_serial;

  v_no := public.doc_no_text(v_year, v_t.language_code, v_scope, v_kind, v_serial);
  update public.tracks set doc_no = v_no, doc_no_at = now(), doc_h_year = v_year, doc_serial = v_serial
   where id = p_track;
  return v_no;
end $$;

grant execute on function public.assign_doc_no(uuid) to authenticated;

-- الرقم يُمنح في صلب الاعتماد فلا يُنسى: قبل الحفظ، عند أول اكتمال
create or replace function public.stamp_doc_no() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_m record; v_year int; v_scope text; v_kind text; v_serial int;
begin
  if new.doc_no is not null then return new; end if;
  select * into v_m from public.materials where id = new.material_id;
  if v_m.id is null then return new; end if;
  v_year  := public.hijri_year(coalesce(v_m.sermon_date, (coalesce(new.completed_at, now()))::date));
  v_scope := public.doc_scope(v_m.mosque);
  v_kind  := public.doc_kind_code(v_m.material_type, v_m.sermon_type);

  insert into public.doc_serials (h_year, lang, scope, kind, last)
  values (v_year, upper(new.language_code), v_scope, v_kind, 1)
  on conflict (h_year, lang, scope, kind)
  do update set last = doc_serials.last + 1
  returning last into v_serial;

  new.doc_no     := public.doc_no_text(v_year, new.language_code, v_scope, v_kind, v_serial);
  new.doc_no_at  := now();
  new.doc_h_year := v_year;
  new.doc_serial := v_serial;
  return new;
end $$;

drop trigger if exists on_track_doc_no on public.tracks;
create trigger on_track_doc_no
  before update of status on public.tracks
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed' and new.doc_no is null)
  execute function public.stamp_doc_no();

-- ---------------------------------------------------------------------
-- الأعمال المكتملة قبل هذا التحديث تُرقَّم بترتيب تواريخها
-- ---------------------------------------------------------------------
do $back$
declare r record; v_year int; v_scope text; v_kind text; v_serial int;
begin
  for r in
    select t.id, t.language_code, t.completed_at, m.material_type, m.sermon_type, m.mosque, m.sermon_date
      from public.tracks t join public.materials m on m.id = t.material_id
     where t.status = 'completed' and t.doc_no is null
     order by coalesce(m.sermon_date, t.completed_at::date), t.completed_at
  loop
    v_year  := public.hijri_year(coalesce(r.sermon_date, r.completed_at::date, current_date));
    v_scope := public.doc_scope(r.mosque);
    v_kind  := public.doc_kind_code(r.material_type, r.sermon_type);
    insert into public.doc_serials (h_year, lang, scope, kind, last)
    values (v_year, upper(r.language_code), v_scope, v_kind, 1)
    on conflict (h_year, lang, scope, kind)
    do update set last = doc_serials.last + 1
    returning last into v_serial;
    update public.tracks
       set doc_no = public.doc_no_text(v_year, r.language_code, v_scope, v_kind, v_serial),
           doc_no_at = coalesce(r.completed_at, now()), doc_h_year = v_year, doc_serial = v_serial
     where id = r.id;
  end loop;
end $back$;

-- ---------------------------------------------------------------------
-- التحقق من رقم مطبوع: يفتحه رمز QR، ولا يكشف إلا وصف العمل
-- ---------------------------------------------------------------------
create or replace function public.verify_doc(p_no text)
returns table (
  doc_no text, kind_label text, scope_label text, language text,
  title text, work_date date, documented_on date, is_published boolean
) language sql stable security definer set search_path = public as $$
  select t.doc_no,
         coalesce(dt.label, m.material_type),
         case m.mosque when 'makkah' then 'المسجد الحرام' when 'madinah' then 'المسجد النبوي' else 'مادة عامة' end,
         l.name_ar,
         case when t.is_published then m.title else null end,
         m.sermon_date,
         t.doc_no_at::date,
         t.is_published
    from public.tracks t
    join public.materials m on m.id = t.material_id
    left join public.languages l on l.code = t.language_code
    left join public.doc_type_codes dt
           on dt.material_type = m.material_type
          and coalesce(dt.sermon_type, '') = coalesce(m.sermon_type, '')
   where upper(replace(t.doc_no, ' ', '')) = upper(replace(trim(coalesce(p_no, '')), ' ', ''))
     and t.status = 'completed' and t.deleted_at is null and m.deleted_at is null
   limit 1
$$;

grant execute on function public.verify_doc(text) to anon, authenticated;
grant execute on function public.hijri_year(date) to anon, authenticated;
grant execute on function public.hijri_year_calc(date) to anon, authenticated;
grant execute on function public.set_hijri_year_start(int, date) to authenticated;
grant execute on function public.set_doc_type_code(text, text, text, text, int) to authenticated;

-- ---------------------------------------------------------------------
-- الصلاحيات: الجداول المرجعية تُقرأ ولا تُكتب إلا بالدوال أعلاه
-- ---------------------------------------------------------------------
alter table public.hijri_years     enable row level security;
alter table public.doc_type_codes  enable row level security;
alter table public.doc_serials     enable row level security;

drop policy if exists "read hijri years" on public.hijri_years;
create policy "read hijri years" on public.hijri_years for select using (true);

drop policy if exists "read doc types" on public.doc_type_codes;
create policy "read doc types" on public.doc_type_codes for select using (true);

drop policy if exists "admins read doc serials" on public.doc_serials;
create policy "admins read doc serials" on public.doc_serials for select using (public.is_admin());

grant select on public.hijri_years, public.doc_type_codes to anon, authenticated;
grant select on public.doc_serials to authenticated;

notify pgrst, 'reload schema';
