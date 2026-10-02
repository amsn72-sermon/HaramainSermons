-- =====================================================================
-- 0058 — حسومات العقد على نصّه (ملاحظة ١٩٦)
--   راجعنا ما بنيناه على العقد فظهرت ثلاثةُ فروق وخمسُ قواعدَ لم تُبنَ،
--   وهذا تصحيحُها:
--
--   ١) مراتبُ التقييم: ما دون السبعين نسبةُ مستخلصه سبعون مع إنذار،
--      لا تسعون. وللفرد قاعدةٌ أخرى غير قاعدة الفريق: من نزل تقييمُه
--      عن السبعين وُجّه إليه إنذارٌ خطي وحُسم عُشرُ مستحقاته الشهرية،
--      وذاك شأنٌ يخصّه لا يُحمَّل على بند الفريق.
--   ٢) الدرجةُ الشهرية مجموعُ أسابيعَ أربعة بحدٍّ أقصاه مئة، ثم يُؤخذ
--      متوسطُ أفراد الفريق — لا متوسطُ النسب الأسبوعية.
--   ٣) التكلفةُ اليومية: قيمةُ الشهر على عدد الأيام التشغيلية وعدد أفراد
--      الفريق — لا على ثلاثين دائمًا. وأيامُ الموسم تُعدّ من شهره الهجري.
--   ٤) الغيابُ الجماعي: إذا تجاوز خمسةً وأربعين في المئة من المطلوب
--      تواجدُهم في يومٍ أو فترة، حُسمت القيمةُ اليومية لذلك اليوم كاملةً،
--      وزيدت غرامةٌ يومية ستون في المئة من قيمة الفرد اليومية على عدد
--      المتغيبين في النسبة المتجاوزة.
--   ٥) البديلُ المعتمد: يُسجَّل للوردية، فيُعرف الغيابُ المغطَّى من غيره.
--   ٦) الفتراتُ ثلاثٌ في اليوم زمنُ كلٍّ ثمانِ ساعات، وتُعرف تغطيتُها.
--
--   والمنصة تحتسب ثم يصحّح مدير المشروع بسببٍ مكتوب، ويبقى المحتسَب
--   آليًّا بجانب المصحَّح فيُعرف الفرق.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) إعداداتٌ عامة: الفترات، وهل يرفع البديلُ المعتمد الحسم
-- ---------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists shift_hours         int     not null default 8,
  add column if not exists shift_count         int     not null default 3,
  add column if not exists absence_threshold   numeric not null default 45,
  add column if not exists absence_surcharge   numeric not null default 60,
  add column if not exists substitute_relieves boolean not null default true;

comment on column public.platform_settings.shift_hours is
  'زمن الفترة التشغيلية بالساعات كما في العقد: ثمانِ ساعات (ملاحظة ١٩٦)';
comment on column public.platform_settings.shift_count is
  'عدد الفترات في اليوم العادي: ثلاث (ملاحظة ١٩٦)';
comment on column public.platform_settings.absence_threshold is
  'نسبة الغياب الجماعي التي يُحسم عندها كامل اليوم: ٤٥٪ من المطلوب تواجدُهم';
comment on column public.platform_settings.absence_surcharge is
  'الغرامة اليومية الإضافية على المتغيبين في النسبة المتجاوزة: ٦٠٪ من قيمة الفرد اليومية';
comment on column public.platform_settings.substitute_relieves is
  'هل يرفع البديلُ المعتمد حسمَ يوم الغائب: نصّ العقد يحسم «للعامل الغائب أو في حال عدم توفير بديل معتمد»، فالمنصة تعدّ الغيابَ المغطَّى بديلًا معتمدًا خدمةً أُدّيت — ولمدير المشروع أن يُغلق ذلك فيُحسم كلُّ غياب';

-- ---------------------------------------------------------------------
-- ٢) البديل المعتمد: يُسجَّل للوردية فيُعرف الغيابُ المغطَّى
-- ---------------------------------------------------------------------
alter table public.shifts
  add column if not exists sub_member_id uuid references public.profiles (id),
  add column if not exists sub_approved  boolean not null default false,
  add column if not exists sub_note      text,
  add column if not exists sub_by        uuid references public.profiles (id),
  add column if not exists sub_at        timestamptz;

comment on column public.shifts.sub_member_id is
  'البديل عن صاحب الوردية إن غاب (ملاحظة ١٩٦)';
comment on column public.shifts.sub_approved is
  'بديلٌ معتمد: أقرّه مدير المشروع، فالخدمةُ أُدّيت ولا يُحسم يومُها';

create or replace function public.set_shift_substitute(p_id uuid, p_sub uuid,
                                                       p_approved boolean default false,
                                                       p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_date date;
begin
  if not public.is_admin() then
    raise exception 'البديل المعتمد للإدارة' using errcode = '42501';
  end if;
  select member_id, shift_date into v_owner, v_date from public.shifts where id = p_id;
  if v_owner is null then raise exception 'الوردية غير موجودة'; end if;
  if p_sub is not null and p_sub = v_owner then
    raise exception 'البديل غير صاحب الوردية';
  end if;
  if p_sub is null and coalesce(p_approved, false) then
    raise exception 'اختر البديل قبل اعتماده';
  end if;

  update public.shifts
     set sub_member_id = p_sub,
         sub_approved  = coalesce(p_approved, false) and p_sub is not null,
         sub_note      = nullif(trim(coalesce(p_note, '')), ''),
         sub_by        = auth.uid(),
         sub_at        = now()
   where id = p_id;
end $$;
grant execute on function public.set_shift_substitute(uuid, uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) الفترة التشغيلية من وقت بدء الوردية — ثلاثٌ زمنُ كلٍّ ثمانِ ساعات
-- ---------------------------------------------------------------------
create or replace function public.shift_period(p_start time) returns text
language sql immutable set search_path = public as $$
  select case
    when p_start is null then null
    when p_start >= time '06:00' and p_start < time '14:00' then 'morning'
    when p_start >= time '14:00' and p_start < time '22:00' then 'evening'
    else 'night'
  end;
$$;
grant execute on function public.shift_period(time) to authenticated;

comment on function public.shift_period(time) is
  'الفترة التشغيلية: صباحية ٦–١٤، ومسائية ١٤–٢٢، وليلية ما بقي (ملاحظة ١٩٦)';

-- تغطيةُ الفترات الثلاث في يومٍ وموقعٍ وفريق: المطلوب والحاضر
create or replace function public.shift_coverage(p_date date, p_city text default null,
                                                 p_track text default null)
returns table (period text, required int, present int, absent int, hours_ok int, hours_bad int)
language sql stable security definer set search_path = public as $$
  select public.shift_period(s.start_at)                                   as period,
         count(*)::int                                                      as required,
         count(*) filter (where s.check_in_at is not null)::int             as present,
         count(*) filter (where s.check_in_at is null
                            and not s.sub_approved)::int                    as absent,
         count(*) filter (where extract(epoch from (s.end_at - s.start_at)) / 3600
                                = (select coalesce(shift_hours, 8) from public.platform_settings where id))::int,
         count(*) filter (where extract(epoch from (s.end_at - s.start_at)) / 3600
                               <> (select coalesce(shift_hours, 8) from public.platform_settings where id))::int
    from public.shifts s
    join public.profiles p on p.id = s.member_id
   where s.shift_date = p_date
     and public.is_admin()
     and (p_city  is null or p.city = p_city)
     and (p_track is null or coalesce(p.track, 'translation') = p_track)
   group by 1
   order by 1
$$;
grant execute on function public.shift_coverage(date, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) الأيام التشغيلية في الشهر: السنةُ أيامُ شهرها، والموسمُ أيامُ موسمه
-- ---------------------------------------------------------------------
create or replace function public.ops_operating_days(p_month date, p_season text)
returns int language sql stable set search_path = public as $$
  select case coalesce(p_season, 'year')
    when 'ramadan' then greatest(1, (
      select count(*)::int from generate_series(date_trunc('month', p_month)::date,
             (date_trunc('month', p_month) + interval '1 month - 1 day')::date,
             interval '1 day') d where public.hijri_month(d::date) = 9))
    when 'hajj' then greatest(1, (
      select count(*)::int from generate_series(date_trunc('month', p_month)::date,
             (date_trunc('month', p_month) + interval '1 month - 1 day')::date,
             interval '1 day') d where public.hijri_month(d::date) = 12))
    else extract(day from (date_trunc('month', p_month)
                           + interval '1 month - 1 day'))::int
  end;
$$;
grant execute on function public.ops_operating_days(date, text) to authenticated;

comment on function public.ops_operating_days(date, text) is
  'عدد الأيام التشغيلية في الشهر: أيامُ الشهر الميلادي لبند السنة، وأيامُ الموسم في شهره الهجري (ملاحظة ١٩٦)';

-- ولمدير المشروع أن يُثبت للشهر عددًا غيرَ المحتسَب
alter table public.ops_month
  add column if not exists operating_days       int,
  add column if not exists collective_deduction numeric(14,2);

-- والفراغُ يعني «احتسِبه آليًّا»: كان صفرًا لا يُفرَّق عن الإثبات، فيُبطل
-- حسمَ الغياب كلَّه إذا أُثبت للشهر عددُ أفراده وحده (ملاحظة ١٩٦)
alter table public.ops_month alter column short_days drop not null;
update public.ops_month set short_days = null
 where short_days = 0 and deduction is null;

comment on column public.ops_month.operating_days is
  'الأيام التشغيلية المثبتة لهذا الشهر، إن خالفت المحتسَب (ملاحظة ١٩٦)';
comment on column public.ops_month.collective_deduction is
  'حسمُ الغياب الجماعي المثبت لهذا الشهر، إن خالف المحتسَب';

-- ---------------------------------------------------------------------
-- ٥) الغياب فردًا فردًا: ما غُطّي ببديلٍ معتمد وما لم يُغطَّ
-- ---------------------------------------------------------------------
create or replace function public.ops_absence(p_month date, p_code int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_item public.ops_items; v_from date; v_to date; v_track text;
        v_all int := 0; v_cov int := 0; v_leave int := 0; v_relieve boolean;
begin
  select * into v_item from public.ops_items where code = p_code;
  if not found or v_item.role_key not in ('field', 'answers') then
    return jsonb_build_object('absent', 0, 'covered', 0, 'uncovered', 0);
  end if;
  v_from := date_trunc('month', p_month)::date;
  v_to   := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_track := case when v_item.role_key = 'answers' then 'answers' else 'field' end;
  select coalesce(substitute_relieves, true) into v_relieve
    from public.platform_settings where id;

  -- الوردية المجدولة حقٌّ على المتعاقد تغطيتُها، والإجازةُ منها: فمن لم
  -- يُسجَّل له حضورٌ فغيابٌ، إلا أن يكون له بديلٌ معتمد قام مقامه
  select count(*), count(*) filter (where s.sub_approved),
         count(*) filter (where s.status = 'leave')
    into v_all, v_cov, v_leave
    from public.shifts s
    join public.profiles p on p.id = s.member_id
   where s.shift_date between v_from and v_to
     and s.check_in_at is null
     and coalesce(p.track, 'translation') = v_track
     and (v_item.mosque is null or p.city = v_item.mosque);

  v_all := coalesce(v_all, 0); v_cov := coalesce(v_cov, 0);
  if not coalesce(v_relieve, true) then v_cov := 0; end if;
  return jsonb_build_object('absent', v_all, 'covered', v_cov,
                            'leave', coalesce(v_leave, 0),
                            'uncovered', greatest(0, v_all - v_cov));
end $$;
grant execute on function public.ops_absence(date, int) to authenticated;

-- والتقصيرُ المحسوم: ما لم يُغطَّ ببديلٍ معتمد
create or replace function public.ops_short_days(p_month date, p_code int)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((public.ops_absence(p_month, p_code) ->> 'uncovered')::numeric, 0)
$$;
grant execute on function public.ops_short_days(date, int) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) الغياب الجماعي: يومٌ أو فترةٌ تجاوز غيابُها ٤٥٪ من المطلوب تواجدُهم
--    فيُحسم اليومُ كاملًا، وتُزاد غرامةُ ٦٠٪ على المتغيبين في الزائد.
--    ولا يُحتسب اليومُ مرتين: إن تجاوز اليومُ كلُّه أُخذ مرةً واحدة،
--    وإلا أُخذت فتراتُه المتجاوزة.
-- ---------------------------------------------------------------------
create or replace function public.ops_collective(p_month date, p_code int)
returns table (on_date date, period text, required int, absent int, pct numeric,
               allowed int, excess int, day_cost numeric, surcharge numeric, total numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_item public.ops_items; v_from date; v_to date; v_track text;
        v_days int; v_staff int; v_thr numeric; v_sur numeric;
        v_day_cost numeric; v_person numeric; r record;
begin
  select * into v_item from public.ops_items where code = p_code;
  if not found or v_item.role_key not in ('field', 'answers') then return; end if;
  if not public.is_manager() then return; end if;

  v_from  := date_trunc('month', p_month)::date;
  v_to    := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_track := case when v_item.role_key = 'answers' then 'answers' else 'field' end;

  select coalesce(absence_threshold, 45), coalesce(absence_surcharge, 60)
    into v_thr, v_sur from public.platform_settings where id;

  select coalesce(om.operating_days, public.ops_operating_days(v_from, v_item.season)),
         coalesce(om.staff_count, v_item.staff_count)
    into v_days, v_staff
    from (select 1) x
    left join public.ops_month om on om.code = p_code and om.month = v_from;

  v_days     := greatest(1, coalesce(v_days, 30));
  v_staff    := greatest(1, coalesce(v_staff, 1));
  v_person   := round(v_item.unit_cost / v_days, 2);               -- قيمة الفرد اليومية
  v_day_cost := round(v_item.unit_cost * v_staff / v_days, 2);     -- قيمة التشغيل اليومية

  for r in
    with sh as (
      select s.shift_date as d, public.shift_period(s.start_at) as prd,
             (s.check_in_at is null and not s.sub_approved) as miss
        from public.shifts s
        join public.profiles p on p.id = s.member_id
       where s.shift_date between v_from and v_to
         and coalesce(p.track, 'translation') = v_track
         and (v_item.mosque is null or p.city = v_item.mosque)
    ), by_day as (
      select d, 'day'::text as prd, count(*)::int as req,
             count(*) filter (where miss)::int as abs
        from sh group by d
    ), by_prd as (
      select d, prd, count(*)::int as req, count(*) filter (where miss)::int as abs
        from sh group by d, prd
    )
    select d.d, d.prd, d.req, d.abs from by_day d
     where d.req > 0 and d.abs * 100.0 / d.req > v_thr
    union all
    select p.d, p.prd, p.req, p.abs from by_prd p
     where p.req > 0 and p.abs * 100.0 / p.req > v_thr
       and not exists (select 1 from by_day d
                        where d.d = p.d and d.abs * 100.0 / d.req > v_thr)
    order by 1, 2
  loop
    on_date   := r.d;
    period    := r.prd;
    required  := r.req;
    absent    := r.abs;
    pct       := round(r.abs * 100.0 / r.req, 1);
    allowed   := floor(r.req * v_thr / 100.0)::int;
    excess    := greatest(0, r.abs - allowed);
    day_cost  := v_day_cost;
    surcharge := round(v_person * v_sur / 100.0 * excess, 2);
    total     := day_cost + surcharge;
    return next;
  end loop;
end $$;
grant execute on function public.ops_collective(date, int) to authenticated;

-- ---------------------------------------------------------------------
-- ٧) التقييم الشهري على صيغة العقد: مجموعُ أربعة أسابيعَ بحدِّ مئة،
--    ثم متوسطُ أفراد الفريق، ثم مرتبتُه من الجدول
-- ---------------------------------------------------------------------
create or replace function public.ops_eval(p_month date, p_code int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_item public.ops_items; v_from date; v_to date; v_track text;
        v_avg numeric; v_n int; v_short int; v_below int;
begin
  select * into v_item from public.ops_items where code = p_code;
  if not found or v_item.role_key not in ('field', 'answers') then
    return jsonb_build_object('avg', null, 'pct', 100, 'n', 0, 'warn', false,
                              'weeks_short', 0, 'below', 0);
  end if;
  v_from := date_trunc('month', p_month)::date;
  v_to   := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_track := case when v_item.role_key = 'answers' then 'answers' else 'field' end;

  -- الأسبوع يُحسب في الشهر الذي فيه أكثرُ أيامه، فلا يسقط عند المفصل
  with w as (
    select e.member_id,
           sum(e.appearance + e.attendance + e.interaction
               + e.language_skill + e.compliance)::numeric as pts,
           count(*)::int as weeks
      from public.field_evaluations e
      join public.profiles p on p.id = e.member_id
     where (e.week_start + 3) between v_from and v_to
       and coalesce(p.track, 'translation') = v_track
       and (v_item.mosque is null or p.city = v_item.mosque)
     group by e.member_id
  ), s as (
    select member_id, least(100, pts) as score, weeks from w
  )
  select round(avg(score), 1), count(*)::int,
         count(*) filter (where weeks < 4)::int,
         count(*) filter (where score < 70)::int
    into v_avg, v_n, v_short, v_below
    from s;

  if v_avg is null then
    return jsonb_build_object('avg', null, 'pct', 100, 'n', 0, 'warn', false,
                              'weeks_short', 0, 'below', 0);
  end if;
  return jsonb_build_object(
    'avg', v_avg, 'n', v_n, 'weeks_short', coalesce(v_short, 0),
    'below', coalesce(v_below, 0), 'warn', v_avg < 70,
    'pct', case when v_avg >= 90 then 100
                when v_avg >= 80 then  90
                when v_avg >= 70 then  80
                else 70 end);     -- أقلُّ من سبعين: سبعون مع إنذار (ملاحظة ١٩٦)
end $$;
grant execute on function public.ops_eval(date, int) to authenticated;

comment on function public.ops_eval(date, int) is
  'مرتبةُ مستخلص الشهر من متوسط أداء الفريق: ٩٠–١٠٠ ← ١٠٠٪، ٨٠–٨٩ ← ٩٠٪، ٧٠–٧٩ ← ٨٠٪، وأقلُّ من ٧٠ ← ٧٠٪ مع إنذار (ملاحظة ١٩٦)';

-- ودرجةُ كل فرد بأسابيعه، ومن نزل عن السبعين فله إنذارٌ وحسمُ عُشرِ مستحقاته
create or replace function public.ops_eval_members(p_month date, p_code int)
returns table (member_id uuid, name text, weeks int, score numeric,
               warn boolean, cut_pct int)
language plpgsql stable security definer set search_path = public as $$
declare v_item public.ops_items; v_from date; v_to date; v_track text;
begin
  select * into v_item from public.ops_items where code = p_code;
  if not found or not public.is_manager() then return; end if;
  v_from := date_trunc('month', p_month)::date;
  v_to   := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_track := case when v_item.role_key = 'answers' then 'answers' else 'field' end;

  return query
    select e.member_id, p.full_name, count(*)::int,
           least(100, sum(e.appearance + e.attendance + e.interaction
                          + e.language_skill + e.compliance))::numeric as sc,
           least(100, sum(e.appearance + e.attendance + e.interaction
                          + e.language_skill + e.compliance)) < 70,
           case when least(100, sum(e.appearance + e.attendance + e.interaction
                                    + e.language_skill + e.compliance)) < 70
                then 10 else 0 end
      from public.field_evaluations e
      join public.profiles p on p.id = e.member_id
     where (e.week_start + 3) between v_from and v_to
       and coalesce(p.track, 'translation') = v_track
       and (v_item.mosque is null or p.city = v_item.mosque)
     group by e.member_id, p.full_name
     order by 4 asc, 2;
end $$;
grant execute on function public.ops_eval_members(date, int) to authenticated;

comment on function public.ops_eval_members(date, int) is
  'درجةُ الفرد الشهرية مجموعَ أسابيعه بحدِّ مئة، ومن نزل عن السبعين فإنذارٌ خطي وحسمُ ١٠٪ من مستحقاته — قاعدةُ الفرد لا الفريق (ملاحظة ١٩٦)';

-- ---------------------------------------------------------------------
-- ٨) التقرير: يُضمّ إليه الأيامُ التشغيلية والبديلُ والغيابُ الجماعي
-- ---------------------------------------------------------------------
drop function if exists public.ops_report(date);
create function public.ops_report(p_month date)
returns table (code int, name text, mosque text, season text, days int,
               staff_count int, unit_cost numeric, total_cost numeric,
               op_days int, day_cost numeric, person_day numeric,
               absent_days numeric, covered_days numeric, leave_days numeric,
               short_days numeric, deduction numeric,
               coll_days int, coll_absent int, coll_deduction numeric,
               eval_avg numeric, eval_pct int, eval_cut numeric, eval_warn boolean,
               eval_n int, eval_weeks_short int, eval_below int,
               net numeric, note text, is_manual boolean, is_custom boolean)
language plpgsql stable security definer set search_path = public as $$
declare r record; v_mo date := date_trunc('month', p_month)::date;
        v_ab jsonb; v_ev jsonb; v_total numeric; v_ded numeric; v_cut numeric;
        v_cd int; v_ca int; v_coll numeric;
begin
  if not public.is_manager() then return; end if;

  for r in
    select o.*, om.staff_count as m_staff, om.short_days as m_short,
           om.deduction as m_ded, om.note as m_note,
           om.operating_days as m_days, om.collective_deduction as m_coll
      from public.ops_items o
      left join public.ops_month om on om.code = o.code and om.month = v_mo
     where o.is_active and public.month_in_season(v_mo, o.season)
     order by o.sort, o.code
  loop
    staff_count := greatest(1, coalesce(r.m_staff, r.staff_count));
    unit_cost   := r.unit_cost;
    v_total     := round(r.unit_cost * staff_count, 2);

    -- التكلفة اليومية: قيمةُ الشهر على الأيام التشغيلية وعدد الأفراد
    op_days    := greatest(1, coalesce(r.m_days,
                    public.ops_operating_days(v_mo, r.season)));
    person_day := round(r.unit_cost / op_days, 2);
    day_cost   := round(v_total / op_days, 2);

    -- الغياب: ما غُطّي ببديلٍ معتمد وما لم يُغطَّ
    v_ab         := public.ops_absence(v_mo, r.code);
    absent_days  := coalesce((v_ab ->> 'absent')::numeric, 0);
    covered_days := coalesce((v_ab ->> 'covered')::numeric, 0);
    leave_days   := coalesce((v_ab ->> 'leave')::numeric, 0);
    short_days   := coalesce(r.m_short, (v_ab ->> 'uncovered')::numeric, 0);
    v_ded        := coalesce(r.m_ded, round(person_day * short_days, 2));

    -- الغياب الجماعي: يومٌ كامل وغرامةٌ على المتغيبين في الزائد
    select count(*)::int, coalesce(sum(c.excess), 0)::int, coalesce(sum(c.total), 0)
      into v_cd, v_ca, v_coll
      from public.ops_collective(v_mo, r.code) c;
    coll_days      := coalesce(v_cd, 0);
    coll_absent    := coalesce(v_ca, 0);
    coll_deduction := coalesce(r.m_coll, v_coll, 0);

    -- ثم مرتبةُ التقييم على ما بقي
    v_ev             := public.ops_eval(v_mo, r.code);
    eval_avg         := nullif(v_ev ->> 'avg', '')::numeric;
    eval_pct         := (v_ev ->> 'pct')::int;
    eval_warn        := (v_ev ->> 'warn')::boolean;
    eval_n           := coalesce((v_ev ->> 'n')::int, 0);
    eval_weeks_short := coalesce((v_ev ->> 'weeks_short')::int, 0);
    eval_below       := coalesce((v_ev ->> 'below')::int, 0);
    v_cut := round((v_total - v_ded - coll_deduction) * (100 - eval_pct) / 100.0, 2);

    code := r.code; name := r.name; mosque := r.mosque; season := r.season;
    days := r.days; total_cost := v_total; deduction := v_ded; eval_cut := v_cut;
    net  := v_total - v_ded - coll_deduction - v_cut;
    note := coalesce(r.m_note, r.note);
    is_manual := (r.m_ded is not null) or (r.m_staff is not null)
                 or (r.m_days is not null) or (r.m_coll is not null);
    is_custom := r.is_custom;
    return next;
  end loop;
end $$;
grant execute on function public.ops_report(date) to authenticated;

comment on function public.ops_report(date) is
  'التقرير الشهري على نصّ العقد: الأيامُ التشغيلية، والغيابُ وبديلُه، والغيابُ الجماعي، ومرتبةُ التقييم (ملاحظتا ١٩٣ و١٩٦)';

-- ---------------------------------------------------------------------
-- ٩) إثباتُ الشهر: يُضمّ إليه عددُ الأيام وحسمُ الغياب الجماعي
-- ---------------------------------------------------------------------
create or replace function public.set_ops_month(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_mo date := date_trunc('month', (p ->> 'month')::date)::date;
        v_code int := (p ->> 'code')::int;
begin
  if not public.is_manager() then
    raise exception 'التقرير الشهري لمدير المشروع' using errcode = '42501';
  end if;
  if v_mo is null or v_code is null then raise exception 'حدّد الشهر والبند'; end if;
  if not exists (select 1 from public.ops_items where code = v_code) then
    raise exception 'بندٌ غير معروف';
  end if;
  if nullif(p ->> 'operating_days', '') is not null
     and (p ->> 'operating_days')::int not between 1 and 31 then
    raise exception 'الأيام التشغيلية بين ١ و٣١';
  end if;

  insert into public.ops_month (month, code, staff_count, short_days, deduction,
                                operating_days, collective_deduction, note,
                                updated_by, updated_at)
  values (v_mo, v_code,
          nullif(p ->> 'staff_count', '')::int,
          nullif(p ->> 'short_days', '')::numeric,
          nullif(p ->> 'deduction', '')::numeric,
          nullif(p ->> 'operating_days', '')::int,
          nullif(p ->> 'collective_deduction', '')::numeric,
          nullif(trim(coalesce(p ->> 'note', '')), ''),
          auth.uid(), now())
  on conflict (month, code) do update
    set staff_count          = excluded.staff_count,
        short_days           = excluded.short_days,
        deduction            = excluded.deduction,
        operating_days       = excluded.operating_days,
        collective_deduction = excluded.collective_deduction,
        note                 = excluded.note,
        updated_by           = excluded.updated_by,
        updated_at           = now();
end $$;
grant execute on function public.set_ops_month(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- ١٠) «عن المبادرة»: بيانُ الفترات والبديل والغياب الجماعي
--     — بلا ذكرٍ مالي ولا تسعيرة، فذاك شأنٌ داخلي
-- ---------------------------------------------------------------------
do $$
declare v jsonb; v_s jsonb; v_id text; v_blocks jsonb; v_new jsonb := '[]'::jsonb;
begin
  select content into v from public.page_content where key = 'initiative';
  if v is null then return; end if;

  for v_s in select jsonb_array_elements(v -> 'sections') loop
    v_id := v_s ->> 0;
    v_blocks := v_s -> 2;

    if v_id = 'how' and not (v_blocks::text like '%ثلاثُ فترات%') then
      v_blocks := v_blocks || jsonb_build_array(
        jsonb_build_array('h3', 'ثلاثُ فتراتٍ في اليوم'),
        jsonb_build_array('p', 'يقوم الإرشاد المكاني وإجابة السائلين على ثلاث فتراتٍ '
          || 'في اليوم، زمنُ كل فترةٍ ثمانِ ساعاتٍ تشغيلية، فتُغطّى المواقع من أول النهار '
          || 'إلى آخر الليل. وتُجدول المنصة الورديات على هذه الفترات، وتُبيّن تغطية كلِّ '
          || 'فترةٍ بموقعها: من طُلب تواجده ومن حضر.'),
        jsonb_build_array('h3', 'البديلُ المعتمد'),
        jsonb_build_array('p', 'إذا غاب أحدُ أفراد الفريق فعلى المتعاقد أن يوفّر بديلًا '
          || 'مؤهلًا يُعتمد، فلا تنقص التغطية. وتُسجّل المنصة البديل في وردية صاحبها، '
          || 'فيُعرف الغيابُ الذي غُطّي من الذي لم يُغطَّ، ولا يُترك ذلك للذاكرة.'));
    end if;

    v_new := v_new || jsonb_build_array(jsonb_build_array(v_s -> 0, v_s -> 1, v_blocks));
  end loop;

  update public.page_content
     set content = jsonb_set(v, '{sections}', v_new), updated_at = now()
   where key = 'initiative';
end $$;

notify pgrst, 'reload schema';
