-- =====================================================================
-- 0107 — ما لا مسجدَ له لا يضيع (إصلاحٌ في أثر ملاحظة ٣١٦)
--
--   الأسبوعُ يُعرَض صفَّين: الحرامُ والنبوي. فإذا رُفعت خطبةٌ ولم
--   يُعرَف مسجدُها — وملفاتُ بعض اللغات لا تذكره في ترويستها — لم
--   تقع في صفٍّ منهما، فبقيت محفوظةً في القاعدة غائبةً عن الشاشة:
--   يَعُدُّها الإحصاءُ ولا يراها صاحبُها ولا يستطيع تصحيحَها.
--
--   فعلاجُه من وجهين:
--   ١) تُعرَض في أسبوعها صفًّا ثالثًا موسومًا «بلا مسجد»، فتُفتح
--      وتُعدَّل كغيرها.
--   ٢) ولا تدخل بالرفع الجماعي أصلًا بلا مسجد: يُردُّ البندُ ويُبيَّن
--      سببُه في جدول المراجعة، فالجمعةُ لا تُعرَف إلا بحرمِها.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) أسابيعُ العام تُرجع معها ما لا مسجدَ له في كلِّ جمعة
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
                   s.sermon_type, s.n_langs
              from s where s.friday_on = f.friday_on and s.mosque = 'makkah' limit 1) x),
         (select to_jsonb(x) from (
            select s.id, s.title, s.khateeb, s.seq, s.sermon_date, s.hijri_text,
                   s.sermon_type, s.n_langs
              from s where s.friday_on = f.friday_on and s.mosque = 'madinah' limit 1) x),
         -- ما لا مسجدَ له: يُعرَض ليُصحَّح، ولا يبقى غائبًا (إصلاح ٣١٦)
         (select jsonb_agg(to_jsonb(x) order by x.sermon_date, x.seq) from (
            select s.id, s.title, s.khateeb, s.seq, s.sermon_date, s.hijri_text,
                   s.sermon_type, s.n_langs
              from s where s.friday_on = f.friday_on and s.mosque is null) x),
         (select coalesce(sum(s.n_langs), 0)::int from s where s.friday_on = f.friday_on)
    from fridays f
   where public.my_role() is not null
   order by f.week_no
$$;
grant execute on function public.arch_weeks(int, uuid) to authenticated;

comment on function public.arch_weeks(int, uuid) is
  'أسابيعُ العام: الجمعةُ ورقمُها، وخطبتا الحرمين فيها، وما لم يُعرَف مسجدُه (ملاحظتا ٣٠٣ و٣١٦)';

-- وكشفُ ما لا مسجدَ له في العام كلِّه، ليُصحَّح جملةً
create or replace function public.arch_no_mosque(p_year int)
returns table (id uuid, title text, khateeb text, seq int, sermon_date date,
               hijri_text text, week_no int, n_langs int)
language sql stable security definer set search_path = public as $$
  select m.id, m.title, m.khateeb, m.seq, m.sermon_date, m.hijri_text, m.week_no,
         (select count(*)::int from public.arch_versions v where v.sermon_id = m.id)
    from public.arch_sermons m
   where public.my_role() is not null
     and m.h_year = p_year and m.mosque is null
   order by m.sermon_date, m.seq
$$;
grant execute on function public.arch_no_mosque(int) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) الرفعُ الجماعي: لا خطبةَ بلا مسجد
-- ---------------------------------------------------------------------
do $do$
declare v_src text; v_new text; v_old text; v_fix text;
begin
  v_src := pg_get_functiondef('public.import_arch_sermons(jsonb)'::regprocedure);
  if position('بلا مسجد' in v_src) > 0 then return; end if;

  v_old := 'v_why := case when v_date is null then ''بلا تاريخ''';
  v_fix := 'v_why := case when v_date is null then ''بلا تاريخ''
                  when v_mos is null then ''بلا مسجد''';
  if position(v_old in v_src) = 0 then
    raise exception 'import_arch_sermons: لم يُوجد موضعُ الترقيع';
  end if;
  v_new := replace(v_src, v_old, v_fix);
  execute v_new;
end $do$;

notify pgrst, 'reload schema';
