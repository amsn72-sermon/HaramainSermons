-- =====================================================================
-- 0122 — اللغاتُ الثابتةُ اثنتا عشرة، وشهرُ الخطبة في التصدير، ودوامٌ
--        ثابتٌ استثناءً (ملاحظات ٣٨١ و٣٨٣ و٣٩٧)
--
--   كانت لغاتُ العام تُؤخَذ من «الرئيسة» كلِّها فتبلغ أربعَ عشرة، وفيها
--   لغتا المبادرة. والمعمولُ به في الكرّاسة: العربيةُ وإحدى عشرة لغةً
--   ثابتة — فتلك اثنتا عشرة لا أكثر.
--
--   ويُحمَل شهرُ الخطبة مع صفوف التصدير، فيُشجَّر المضغوطُ على الأشهر
--   بلا حسابٍ في المتصفح.
--
--   والأصلُ أنَّ المترجم التخصصيَّ عن بُعدٍ والمرشدَ المكانيَّ حضوريّ،
--   فلا يُخلَطان في الورديات. وقد يُحتاج نادرًا إلى دوامٍ ثابتٍ لمترجمٍ
--   تخصصيّ، فيُوسَم به وحدَه ولا يُفتَح البابُ لفريقه كلِّه.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) لغاتُ العام الافتراضية: العربيةُ والثابتةُ الفاعلة (ملاحظة ٣٨١)
--
--   والثابتةُ هي الرئيسةُ التي ليست من لغات المبادرة — كما تُعرَض في
--   شاشة اللغات تحت «اللغات الرئيسية الثابتة».
-- ---------------------------------------------------------------------
create or replace function public.arch_year_langs(p_year int)
returns table (code text, name_ar text, dir text, sort int, stored boolean)
language sql stable security definer set search_path = public as $$
  with y as (select (select a.langs from public.arch_years a where a.h_year = p_year) as langs)
  select l.code, l.name_ar, l.dir, l.sort, y.langs is not null
    from public.languages l cross join y
   where public.my_role() is not null
     and (
       case when y.langs is not null
            then l.code = any (y.langs)
            else l.code = 'ar'
                 or (l.is_core and l.is_active and not l.is_initiative and not l.is_source)
       end)
   order by case when l.code = 'ar' then 0 else 1 end, l.sort, l.code
$$;
grant execute on function public.arch_year_langs(int) to authenticated;

comment on function public.arch_year_langs(int) is
  'لغاتُ العام: العربيةُ وإحدى عشرة لغةً ثابتة، أو ما حُفظ للعام '
  '(ملاحظتا ٣٦٨ و٣٨١)';

-- ---------------------------------------------------------------------
-- ٢) يومُ الشهر الهجريُّ، وبه تُسمَّى بطاقةُ الشهر (ملاحظة ٣٧٨)
--
--   «الشهرُ الأول — ٣ محرَّم»: أولُ جُمَعِه. وكانت البطاقةُ تحمل عددَ
--   الجُمَع لا تاريخَ أولاها، فصُحِّح.
--
--   ويُحسَب اليومُ بالتقويم نفسِه الذي قُسِّمت به الأشهرُ هنا، لا
--   بتقويمِ المتصفح — فلا تُنسَب الجمعةُ إلى شهرٍ ويُكتَب لها يومٌ من
--   شهرٍ آخر. (وبين التقويمين فرقُ يومٍ أو يومَين في بعض الأشهر، وهو
--   أمرٌ أقدمُ من هذه الملاحظة، يُنظَر فيه وحدَه.)
-- ---------------------------------------------------------------------
create or replace function public.hijri_day(p_date date) returns int
language plpgsql immutable set search_path = public as $$
declare jd bigint; l bigint; n bigint; j bigint; m bigint;
begin
  if p_date is null then return null; end if;
  jd := to_char(p_date, 'J')::bigint;
  l := jd - 1948440 + 10632;
  n := (l - 1) / 10631;
  l := l - 10631 * n + 354;
  j := ((10985 - l) / 5316) * ((50 * l) / 17719) + (l / 5670) * ((43 * l) / 15238);
  l := l - ((30 - j) / 15) * ((17719 * j) / 50) - (j / 16) * ((15238 * j) / 43) + 29;
  m := (24 * l) / 709;
  return (l - (709 * m) / 24)::int;
end $$;
grant execute on function public.hijri_day(date) to anon, authenticated;

comment on function public.hijri_day(date) is
  'يومُ الشهر الهجريِّ لتاريخٍ ميلاديّ، بالتقويم الذي تُقسَّم به '
  'الأشهرُ في الأرشيف (ملاحظة ٣٧٨)';

drop function if exists public.arch_month_tiles(int, uuid);
create or replace function public.arch_month_tiles(p_year int, p_section uuid default null)
returns table (h_month int, fridays int, covered int, sermons int,
               versions int, gaps int, first_friday date, first_day int)
language sql stable security definer set search_path = public as $$
  with b as (select * from public.hijri_year_bounds(p_year)),
  f as (
    select d::date as friday_on, public.hijri_month(d::date) as h_month
      from b, generate_series(public.first_friday_of_year(p_year), b.ends_on, interval '7 day') d
  ),
  s as (
    select m.friday_on, m.mosque, m.id
      from public.arch_sermons m
     where m.h_year = p_year
       and (p_section is null or m.section_id = p_section)
       and m.friday_on is not null
  ),
  g as (
    select f.h_month, f.friday_on,
           (select count(distinct x.mosque)::int from s x
             where x.friday_on = f.friday_on and x.mosque is not null) as n_mosques,
           (select count(*)::int from s x where x.friday_on = f.friday_on) as n_sermons,
           (select count(*)::int from public.arch_versions v
             where v.sermon_id in (select x.id from s x where x.friday_on = f.friday_on)) as n_versions
      from f
  )
  select g.h_month,
         count(*)::int,
         count(*) filter (where g.n_mosques >= 2)::int,
         coalesce(sum(g.n_sermons), 0)::int,
         coalesce(sum(g.n_versions), 0)::int,
         count(*) filter (where g.n_mosques < 2)::int,
         min(g.friday_on),
         public.hijri_day(min(g.friday_on))
    from g
   where public.my_role() is not null
   group by g.h_month
   order by min(g.friday_on)
$$;
grant execute on function public.arch_month_tiles(int, uuid) to authenticated;

comment on function public.arch_month_tiles(int, uuid) is
  'بطاقاتُ أشهر العام الهجرية بإحصاء جُمَعِها، ومعها يومُ أولِ جُمَعِه '
  '(ملاحظتا ٣٦٩ و٣٧٨)';

-- ---------------------------------------------------------------------
-- ٣) شهرُ الخطبة الهجريُّ مع صفوف التصدير (ملاحظة ٣٨٣)
-- ---------------------------------------------------------------------
drop function if exists public.arch_book(int, text, text, uuid, date, date);
create or replace function public.arch_book(
  p_year int, p_lang text, p_mosque text default null, p_section uuid default null,
  p_from date default null, p_to date default null
) returns table (seq int, week_no int, title text, khateeb text, mosque text,
                 sermon_type text, sermon_date date, hijri_text text,
                 body_html text, doc_no text, title_tr text, h_month int)
language sql stable security definer set search_path = public as $$
  select m.seq, m.week_no, m.title, m.khateeb, m.mosque, m.sermon_type,
         m.sermon_date, m.hijri_text, v.body_html, v.doc_no, v.title_tr,
         public.hijri_month(coalesce(m.sermon_date, m.friday_on))
    from public.arch_sermons m
    join public.arch_versions v on v.sermon_id = m.id and v.language_code = p_lang
   where (public.is_manager() or public.is_admin_for('arch_export')
          or public.is_admin() or public.is_supervisor() or public.is_viewer())
     and m.h_year = p_year
     and (p_mosque is null or m.mosque = p_mosque)
     and (p_section is null or m.section_id = p_section)
     and (p_from is null or coalesce(m.sermon_date, m.friday_on) >= p_from)
     and (p_to   is null or coalesce(m.sermon_date, m.friday_on) <= p_to)
   order by coalesce(m.sermon_date, date '9999-12-31'), m.seq
$$;
grant execute on function public.arch_book(int, text, text, uuid, date, date) to authenticated;

comment on function public.arch_book(int, text, text, uuid, date, date) is
  'خطبُ عامٍ بلغةٍ مرتَّبةً زمنيًّا بين حدَّين، ومعها شهرُها الهجريُّ — '
  'يُبنى منها المجمَّعُ والتصديرُ المشجَّر (ملاحظات ٣٠٩ و٣٧١ و٣٨٣)';

-- وأعوامُ الأرشيف التي فيها خطبٌ: منها يُبنى التصديرُ الشامل
create or replace function public.arch_export_years()
returns table (h_year int, sermons int, versions int)
language sql stable security definer set search_path = public as $$
  select y.h_year,
         (select count(*)::int from public.arch_sermons m where m.h_year = y.h_year),
         (select count(*)::int from public.arch_versions v
            join public.arch_sermons m on m.id = v.sermon_id where m.h_year = y.h_year)
    from public.arch_years y
   where public.is_manager() or public.is_admin_for('arch_export')
      or public.is_admin() or public.is_supervisor() or public.is_viewer()
   order by y.h_year
$$;
grant execute on function public.arch_export_years() to authenticated;

-- ---------------------------------------------------------------------
-- ٤) دوامٌ ثابتٌ لمترجمٍ تخصصيٍّ — استثناءٌ نادرٌ بقرار المدير (٣٩٧)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists fixed_shift boolean not null default false;

comment on column public.profiles.fixed_shift is
  'مترجمٌ تخصصيٌّ له دوامٌ ثابتٌ استثناءً، فيدخل جدولَ الورديات (ملاحظة ٣٩٧)';

create or replace function public.set_fixed_shift(p_member uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_admin_for('sh_view')) then
    raise exception 'تحديدُ الدوام الثابت بإذن مدير المشروع' using errcode = '42501';
  end if;
  update public.profiles set fixed_shift = coalesce(p_on, false) where id = p_member;
  if not found then raise exception 'لا عضوَ بهذا المعرِّف'; end if;
  perform public.log_admin('fixed_shift', p_member,
    jsonb_build_object('on', coalesce(p_on, false)));
  return coalesce(p_on, false);
end $$;
grant execute on function public.set_fixed_shift(uuid, boolean) to authenticated;

-- ومن يدخل جدولَ الورديات: الميدانُ كلُّه، ومن وُسِم بالدوام الثابت
create or replace function public.shift_people()
returns table (id uuid, full_name text, member_no int, track text, city text,
               role text, fixed_shift boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.member_no, p.track::text, p.city::text, p.role::text,
         p.fixed_shift
    from public.profiles p
   where public.my_role() is not null
     and p.status = 'active'
     and (p.track = 'field' or p.fixed_shift)
   order by p.full_name
$$;
grant execute on function public.shift_people() to authenticated;

comment on function public.shift_people() is
  'من يدخل جدولَ الورديات: المرشدون المكانيّون، ومن وُسِم بدوامٍ ثابت '
  '(ملاحظتا ٣٩٦ و٣٩٧)';

-- والمرشَّحون للوردية كانوا الفريقَ كلَّه، فصاروا الميدانَ ومن وُسِم —
--   فلا يُخلَط المترجمُ التخصصيُّ بالمرشد المكانيّ (ملاحظة ٣٩٦)
drop function if exists public.shift_candidates();
create or replace function public.shift_candidates()
returns table (member_id uuid, full_name text, member_no text, role text,
               track text, is_field boolean, fixed_shift boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.member_no, p.role::text,
         coalesce(p.track, 'translation')::text,
         (coalesce(p.track, 'translation') = 'field'),
         p.fixed_shift
    from public.profiles p
   where public.is_admin() and p.status = 'active'
     and (coalesce(p.track, 'translation') = 'field' or p.fixed_shift)
   order by (coalesce(p.track, 'translation') = 'field') desc, p.full_name
$$;
grant execute on function public.shift_candidates() to authenticated;

comment on function public.shift_candidates() is
  'مرشَّحو الوردية: الميدانُ ومن وُسِم بدوامٍ ثابتٍ استثناءً (ملاحظتا ٣٩٦ و٣٩٧)';

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ٥) الدليلُ الإرشاديُّ يُفتَح للمترجم بلغته الأمِّ ولو لم تُسجَّلْ في
--    «لغاتِ العضو»
--
--   كان المترجمُ لا يرى في الدليل إلا لغةً مسجَّلةً له في
--   `member_languages`. فمن أُضيف وله لغةٌ أمٌّ في ملفِّه ولم تُسجَّلْ
--   في الجدول، فُتح له الدليلُ خاليًا من البطاقات ومن عمود المقابل —
--   وهو يرى المصطلحاتِ العربيةَ وحدَها. فتُضمُّ اللغةُ الأمُّ إلى ما
--   يراه، ويبقى سائرُ اللغات على إذنها.
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
     -- الإدارةُ ترى اللغاتِ كلَّها، والمترجمُ ما سجّله من إتقانه ولغتَه الأمّ
     and (public.is_admin() or public.is_supervisor() or public.is_viewer()
          or ml.member_id is not null
          or (p.native_lang is not null and p.native_lang = l.code))
   order by (p.native_lang = l.code) desc, l.is_core desc, l.sort
$$;
grant execute on function public.my_glossary_langs() to authenticated;

comment on function public.my_glossary_langs() is
  'لغاتُ الدليل التي يراها العضو: ما سُجِّل من إتقانه ولغتُه الأمّ '
  '(ملاحظتا ٢٥٨ و٣٩٨)';

create or replace function public.may_see_lang(p_lang text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_supervisor() or public.is_viewer()
      or exists (select 1 from public.member_languages
                  where member_id = auth.uid() and language_code = p_lang)
      or exists (select 1 from public.profiles
                  where id = auth.uid() and native_lang = p_lang)
$$;
grant execute on function public.may_see_lang(text) to authenticated;

notify pgrst, 'reload schema';
