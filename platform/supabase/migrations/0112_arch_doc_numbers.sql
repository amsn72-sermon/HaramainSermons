-- =====================================================================
-- 0112 — ترميزُ أرشيف الخطب كترميز أرشيف الترجمة (ملاحظتا ٣٤٣ و٣٤٥)
--
--   في أرشيف الترجمة لكلِّ عملٍ بلغته رقمُ توثيقٍ يُطبع في صدر صفحته
--   الأولى ومعه رمزُ تحقُّقِه، ويُرجَع به إلى أصله. وأرشيفُ الخطب كان
--   فيه عمودُ `doc_no` خاليًا لا يُملأ، فلا ترميزَ في صفِّه ولا في
--   مُخرَجه.
--
--   فجُعل على أصلِه نفسِه، من مِعْدادِ الأرقام نفسِه (doc_serials)،
--   فلا يتصادم الأرشيفان ولا يتكرّر رقم:
--   ١) للخطبة رقمُها، يُعرَض في صفِّها بعد عنوانها.
--   ٢) ولكلِّ نسخةٍ بلغتها رقمُها، يُطبع في تصديرها مع باركوده.
--   ٣) والرقمُ يُمنح مرةً واحدةً ولا يتبدّل بتعديلٍ بعده.
-- =====================================================================

alter table public.arch_sermons add column if not exists doc_no     text;
alter table public.arch_sermons add column if not exists doc_no_at  timestamptz;

create unique index if not exists arch_sermons_doc_no_key
  on public.arch_sermons (doc_no) where doc_no is not null;

comment on column public.arch_sermons.doc_no is
  'رقمُ توثيق الخطبة في الأرشيف — يُعرَض في صفِّها (ملاحظة ٣٤٥)';

-- ---------------------------------------------------------------------
-- ١) منحُ الرقم: لغةٌ وحرمٌ ونوعٌ وعام، من المِعْداد الموحَّد
-- ---------------------------------------------------------------------
create or replace function public.arch_doc_no(p_year int, p_lang text,
  p_mosque text, p_type text) returns text
language plpgsql security definer set search_path = public as $$
declare v_scope text; v_kind text; v_serial int;
begin
  v_scope := public.doc_scope(p_mosque);
  v_kind  := public.doc_kind_code('خطب', p_type);
  insert into public.doc_serials (h_year, lang, scope, kind, last)
  values (p_year, upper(p_lang), v_scope, v_kind, 1)
  on conflict (h_year, lang, scope, kind)
  do update set last = doc_serials.last + 1
  returning last into v_serial;
  return public.doc_no_text(p_year, p_lang, v_scope, v_kind, v_serial);
end $$;
revoke execute on function public.arch_doc_no(int, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- ٢) الخطبةُ تأخذ رقمَها متى عُرف عامُها — ولا يتبدّل بعدُ
-- ---------------------------------------------------------------------
create or replace function public.stamp_arch_sermon_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.doc_no is null and new.h_year is not null then
    new.doc_no := public.arch_doc_no(new.h_year, 'ar', new.mosque,
                    coalesce(new.sermon_type, 'خطبة جمعة'));
    new.doc_no_at := now();
  end if;
  return new;
end $$;

drop trigger if exists stamp_arch_sermon_no on public.arch_sermons;
create trigger stamp_arch_sermon_no
  before insert or update on public.arch_sermons
  for each row execute function public.stamp_arch_sermon_no();

-- ---------------------------------------------------------------------
-- ٣) وكلُّ نسخةٍ بلغتها تأخذ رقمَها متى صار فيها نصٌّ أو ملف
-- ---------------------------------------------------------------------
create or replace function public.stamp_arch_version_no() returns trigger
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if new.doc_no is not null then return new; end if;
  if nullif(btrim(coalesce(new.body_html, '')), '') is null
     and new.file_path is null then
    return new;                       -- نسخةٌ خاويةٌ لا تُرقَّم
  end if;
  select h_year, mosque, sermon_type into v
    from public.arch_sermons where id = new.sermon_id;
  if v.h_year is null then return new; end if;
  new.doc_no := public.arch_doc_no(v.h_year, new.language_code, v.mosque,
                  coalesce(v.sermon_type, 'خطبة جمعة'));
  return new;
end $$;

drop trigger if exists stamp_arch_version_no on public.arch_versions;
create trigger stamp_arch_version_no
  before insert or update on public.arch_versions
  for each row execute function public.stamp_arch_version_no();

-- ---------------------------------------------------------------------
-- ٤) وما سبق من خطبٍ ونسخٍ يُرقَّم مرةً واحدةً بترتيب تاريخه
-- ---------------------------------------------------------------------
do $do$
declare r record;
begin
  for r in select id, h_year, mosque, sermon_type from public.arch_sermons
            where doc_no is null and h_year is not null
            order by h_year, sermon_date nulls last, seq nulls last, created_at loop
    update public.arch_sermons
       set doc_no = public.arch_doc_no(r.h_year, 'ar', r.mosque,
                      coalesce(r.sermon_type, 'خطبة جمعة')),
           doc_no_at = now()
     where id = r.id;
  end loop;

  for r in select v.id, v.language_code, m.h_year, m.mosque, m.sermon_type
             from public.arch_versions v
             join public.arch_sermons m on m.id = v.sermon_id
            where v.doc_no is null and m.h_year is not null
              and (nullif(btrim(coalesce(v.body_html, '')), '') is not null
                   or v.file_path is not null)
            order by m.h_year, m.sermon_date nulls last, v.language_code loop
    update public.arch_versions
       set doc_no = public.arch_doc_no(r.h_year, r.language_code, r.mosque,
                      coalesce(r.sermon_type, 'خطبة جمعة'))
     where id = r.id;
  end loop;
end $do$;

-- ---------------------------------------------------------------------
-- ٥) والرقمُ يُعرَض مع الخطبة في أسابيعها وفي بطاقتها
-- ---------------------------------------------------------------------
drop function if exists public.arch_weeks(int, uuid);
create or replace function public.arch_weeks(p_year int, p_section uuid default null)
returns table (week_no int, friday_on date, makkah jsonb, madinah jsonb,
               others jsonb, langs int)
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
                   s.sermon_type, s.doc_no, s.n_langs
              from s where s.friday_on = f.friday_on and s.mosque = 'makkah' limit 1) x),
         (select to_jsonb(x) from (
            select s.id, s.title, s.khateeb, s.seq, s.sermon_date, s.hijri_text,
                   s.sermon_type, s.doc_no, s.n_langs
              from s where s.friday_on = f.friday_on and s.mosque = 'madinah' limit 1) x),
         (select jsonb_agg(to_jsonb(x) order by x.sermon_date, x.seq) from (
            select s.id, s.title, s.khateeb, s.seq, s.sermon_date, s.hijri_text,
                   s.sermon_type, s.doc_no, s.n_langs
              from s where s.friday_on = f.friday_on and s.mosque is null) x),
         (select coalesce(sum(s.n_langs), 0)::int from s where s.friday_on = f.friday_on)
    from fridays f
   where public.my_role() is not null
   order by f.week_no
$$;
grant execute on function public.arch_weeks(int, uuid) to authenticated;

comment on function public.arch_weeks(int, uuid) is
  'أسابيعُ العام: الجمعةُ ورقمُها، وخطبتا الحرمين بترميزهما، وما لا مسجدَ له '
  '(ملاحظات ٣٠٣ و٣١٦ و٣٤٥)';

drop function if exists public.arch_occasions(int, uuid);
create or replace function public.arch_occasions(p_year int, p_section uuid default null)
returns table (id uuid, title text, khateeb text, mosque text, sermon_type text,
               sermon_date date, hijri_text text, seq int, doc_no text, n_langs int)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.khateeb, m.mosque, m.sermon_type, m.sermon_date,
         m.hijri_text, m.seq, m.doc_no,
         (select count(*)::int from public.arch_versions v where v.sermon_id = m.id)
    from public.arch_sermons m
   where public.my_role() is not null
     and m.h_year = p_year
     and (p_section is null or m.section_id = p_section)
     and m.sermon_type <> 'خطبة جمعة'
   order by m.sermon_date
$$;
grant execute on function public.arch_occasions(int, uuid) to authenticated;

drop function if exists public.arch_sermon(uuid);
create or replace function public.arch_sermon(p_id uuid)
returns table (id uuid, title text, khateeb text, mosque text, sermon_type text,
               sermon_date date, hijri_text text, week_no int, seq int, h_year int,
               notes text, doc_no text, versions jsonb)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.khateeb, m.mosque, m.sermon_type, m.sermon_date,
         m.hijri_text, m.week_no, m.seq, m.h_year, m.notes, m.doc_no,
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

drop function if exists public.arch_no_mosque(int);
create or replace function public.arch_no_mosque(p_year int)
returns table (id uuid, title text, khateeb text, seq int, sermon_date date,
               hijri_text text, week_no int, doc_no text, n_langs int)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.khateeb, m.seq, m.sermon_date, m.hijri_text, m.week_no, m.doc_no,
         (select count(*)::int from public.arch_versions v where v.sermon_id = m.id)
    from public.arch_sermons m
   where public.my_role() is not null
     and m.h_year = p_year and m.mosque is null
   order by m.sermon_date, m.seq
$$;
grant execute on function public.arch_no_mosque(int) to authenticated;

notify pgrst, 'reload schema';
