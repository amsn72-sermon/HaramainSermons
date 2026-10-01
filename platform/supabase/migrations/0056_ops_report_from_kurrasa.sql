-- =====================================================================
-- 0056 — التقرير الشهري على كراسة المنافسة نفسها (ملاحظة ١٩٣)
--   بنود الكراسة في «فريق الإرشاد المكاني والديني» هي وحدها التي تحمل
--   تكلفةً شهريةً للفرد، فمنها تُبنى سطور التقرير:
--     المسجد الحرام  ٩٥ مرشدًا × ٥٦٠٩٫٢٧ للسنة كلها، و١٩ لإجابة السائلين،
--                    وزيادةُ رمضان ٤٧ × ٣٥٠٠، وزيادةُ الحج ٤٧ × ٥٢٥٠.
--     المسجد النبوي  ٥٦ مرشدًا، و١١ لإجابة السائلين، وزيادتاهما ٤٠ و٤٠.
--   وسطور الموسم لا تظهر إلا في شهرها الهجري.
--   والحسم بأمرين كما نصّت الكراسة: غيابٌ يُثبت من سجلّ الدوام، ونسبةُ
--   المستخلص من متوسط التقييم الشهري (٩٠–١٠٠ ← ١٠٠٪، ٨٠–٨٩ ← ٩٠٪،
--   ٧٠–٧٩ ← ٨٠٪، وأقلُّ من ٧٠ ← إنذارٌ وحسمُ ١٠٪).
--   ولمدير المشروع أن يضيف بندًا بسطره وبياناته، فما لم تُسعّره الكراسة
--   شهريًّا يُكتب بيده.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الشهر الهجري لتاريخٍ ميلادي — ليُعرف موسمُ رمضان والحج
-- ---------------------------------------------------------------------
create or replace function public.hijri_month(p_date date) returns int
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
  return m::int;
end $$;
grant execute on function public.hijri_month(date) to anon, authenticated;

-- هل يمسّ الشهر الميلادي موسمًا هجريًّا؟ رمضان شهر ٩، والحج ذو الحجة ١٢
create or replace function public.month_in_season(p_month date, p_season text)
returns boolean language sql stable set search_path = public as $$
  select case coalesce(p_season, 'year')
    when 'year' then true
    when 'ramadan' then exists (
      select 1 from generate_series(date_trunc('month', p_month)::date,
                                    (date_trunc('month', p_month) + interval '1 month - 1 day')::date,
                                    interval '1 day') d
       where public.hijri_month(d::date) = 9)
    when 'hajj' then exists (
      select 1 from generate_series(date_trunc('month', p_month)::date,
                                    (date_trunc('month', p_month) + interval '1 month - 1 day')::date,
                                    interval '1 day') d
       where public.hijri_month(d::date) = 12)
    else true
  end;
$$;
grant execute on function public.month_in_season(date, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) بنود التقرير: ما نصّت عليه الكراسة، وما يضيفه مدير المشروع
-- ---------------------------------------------------------------------
alter table public.ops_items
  add column if not exists mosque    text,
  add column if not exists season    text not null default 'year',
  add column if not exists days      int,
  add column if not exists is_custom boolean not null default false,
  add column if not exists note      text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ops_items_season_check') then
    alter table public.ops_items add constraint ops_items_season_check
      check (season in ('year', 'ramadan', 'hajj'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ops_items_mosque_check') then
    alter table public.ops_items add constraint ops_items_mosque_check
      check (mosque is null or mosque in ('makkah', 'madinah'));
  end if;
end $$;

comment on table public.ops_items is
  'بنود التكاليف التشغيلية: ما سعّرته كراسة المنافسة شهريًّا، وما أضافه مدير المشروع (ملاحظة ١٩٣)';
comment on column public.ops_items.season is 'سطرُ الموسم لا يظهر إلا في شهره: السنة كلها، أو رمضان، أو الحج';
comment on column public.ops_items.is_custom is 'بندٌ أضافه مدير المشروع بيده، يُعدَّل ويُحذف — وبنود الكراسة لا تُحذف';

-- بنود الكراسة تحلّ محلّ ما كان، فيبقى ما أضافه مدير المشروع بيده
delete from public.ops_items where not is_custom;

insert into public.ops_items
  (code, name, staff_count, unit_cost, role_key, lang_code, mosque, season, days, sort, note)
values
  (1, 'المرشدون المكانيون — المسجد الحرام',  95, 5609.27, 'field',   null, 'makkah',  'year',    360,  1,
      'كراسة المنافسة: فريق الإرشاد المكاني والديني — ٣٦٠ يومًا'),
  (2, 'إجابة السائلين — المسجد الحرام',      19, 5609.27, 'answers', null, 'makkah',  'year',    360,  2,
      'كراسة المنافسة: إجابة السائلين — ٣٦٠ يومًا، والحضور يُثبت من سجلّ الدوام'),
  (3, 'زيادة رمضان — المسجد الحرام',         47, 3500.00, 'field',   null, 'makkah',  'ramadan',  30,  3,
      'كراسة المنافسة: ٣٠ يومًا في رمضان'),
  (4, 'زيادة الحج — المسجد الحرام',          47, 5250.00, 'field',   null, 'makkah',  'hajj',     45,  4,
      'كراسة المنافسة: ٤٥ يومًا في موسم الحج'),
  (5, 'المرشدون المكانيون — المسجد النبوي',  56, 5609.27, 'field',   null, 'madinah', 'year',    360,  5,
      'كراسة المنافسة: فريق الإرشاد المكاني والديني — ٣٦٠ يومًا'),
  (6, 'إجابة السائلين — المسجد النبوي',      11, 5609.27, 'answers', null, 'madinah', 'year',    360,  6,
      'كراسة المنافسة: إجابة السائلين — ٣٦٠ يومًا، والحضور يُثبت من سجلّ الدوام'),
  (7, 'زيادة رمضان — المسجد النبوي',         40, 3500.00, 'field',   null, 'madinah', 'ramadan',  30,  7,
      'كراسة المنافسة: ٣٠ يومًا في رمضان'),
  (8, 'زيادة الحج — المسجد النبوي',          40, 5250.00, 'field',   null, 'madinah', 'hajj',     45,  8,
      'كراسة المنافسة: ٤٥ يومًا في موسم الحج')
on conflict (code) do update
  set name = excluded.name, staff_count = excluded.staff_count, unit_cost = excluded.unit_cost,
      role_key = excluded.role_key, lang_code = excluded.lang_code, mosque = excluded.mosque,
      season = excluded.season, days = excluded.days, sort = excluded.sort,
      note = excluded.note, is_custom = false, is_active = true;

-- ---------------------------------------------------------------------
-- ٣) الغياب يُثبت من سجلّ الدوام، لكل بندٍ بموقعه وفريقه
-- ---------------------------------------------------------------------
create or replace function public.ops_short_days(p_month date, p_code int)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_from date; v_to date; v_item public.ops_items; v_n numeric := 0;
begin
  select * into v_item from public.ops_items where code = p_code;
  if not found then return 0; end if;
  v_from := date_trunc('month', p_month)::date;
  v_to   := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;

  -- وما لم يكن له دوامٌ مجدول لا يُحتسب له غياب
  if v_item.role_key not in ('field', 'answers') then return 0; end if;

  select count(*) into v_n
    from public.shifts s
    join public.profiles p on p.id = s.member_id
   where s.shift_date between v_from and v_to
     and s.check_in_at is null
     and s.status <> 'cancelled'
     and coalesce(p.track, 'translation') = case when v_item.role_key = 'answers'
                                                 then 'answers' else 'field' end
     and (v_item.mosque is null or p.city = v_item.mosque);
  return coalesce(v_n, 0);
end $$;
grant execute on function public.ops_short_days(date, int) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) نسبة المستخلص من متوسط التقييم الشهري — جدول الكراسة نفسه
-- ---------------------------------------------------------------------
create or replace function public.ops_eval(p_month date, p_code int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_item public.ops_items; v_from date; v_to date; v_avg numeric; v_n int;
begin
  select * into v_item from public.ops_items where code = p_code;
  if not found or v_item.role_key not in ('field', 'answers') then
    return jsonb_build_object('avg', null, 'pct', 100, 'n', 0, 'warn', false);
  end if;
  v_from := date_trunc('month', p_month)::date;
  v_to   := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;

  -- الأسبوع يُحسب في الشهر الذي فيه أكثرُ أيامه، فلا يسقط عند المفصل
  select round(avg(
           (e.appearance + e.attendance + e.interaction + e.language_skill + e.compliance)
           / 25.0 * 100), 1), count(*)
    into v_avg, v_n
    from public.field_evaluations e
    join public.profiles p on p.id = e.member_id
   where (e.week_start + 3) between v_from and v_to
     and coalesce(p.track, 'translation') = case when v_item.role_key = 'answers'
                                                 then 'answers' else 'field' end
     and (v_item.mosque is null or p.city = v_item.mosque);

  if v_avg is null then
    return jsonb_build_object('avg', null, 'pct', 100, 'n', 0, 'warn', false);
  end if;
  return jsonb_build_object(
    'avg', v_avg, 'n', v_n, 'warn', v_avg < 70,
    'pct', case when v_avg >= 90 then 100
                when v_avg >= 80 then 90
                when v_avg >= 70 then 80
                else 90 end);        -- أقلُّ من ٧٠: إنذارٌ وحسمُ ١٠٪
end $$;
grant execute on function public.ops_eval(date, int) to authenticated;

-- ---------------------------------------------------------------------
-- ٥) التقرير: سطرٌ لكل بند، وما خرج عن موسمه لا يُعرض
-- ---------------------------------------------------------------------
drop function if exists public.ops_report(date);
create function public.ops_report(p_month date)
returns table (code int, name text, mosque text, season text, days int,
               staff_count int, unit_cost numeric, total_cost numeric,
               short_days numeric, deduction numeric,
               eval_avg numeric, eval_pct int, eval_cut numeric, eval_warn boolean,
               net numeric, note text, is_manual boolean, is_custom boolean)
language plpgsql stable security definer set search_path = public as $$
declare r record; v_mo date := date_trunc('month', p_month)::date;
        v_days numeric; v_short numeric; v_ded numeric; v_total numeric;
        v_ev jsonb; v_cut numeric;
begin
  if not public.is_manager() then return; end if;

  for r in
    select o.*, om.staff_count as m_staff, om.short_days as m_short,
           om.deduction as m_ded, om.note as m_note
      from public.ops_items o
      left join public.ops_month om on om.code = o.code and om.month = v_mo
     where o.is_active and public.month_in_season(v_mo, o.season)
     order by o.sort, o.code
  loop
    staff_count := coalesce(r.m_staff, r.staff_count);
    unit_cost   := r.unit_cost;
    v_total     := round(r.unit_cost * staff_count, 2);
    v_days      := greatest(1, coalesce(r.days, 30));
    -- سطر السنة يُصرف شهرًا بشهر، فالقسمة على ثلاثين لا على ٣٦٠
    if r.season = 'year' then v_days := 30; end if;

    v_short := coalesce(r.m_short, public.ops_short_days(v_mo, r.code));
    v_ded   := coalesce(r.m_ded, round(r.unit_cost / v_days * v_short, 2));

    v_ev      := public.ops_eval(v_mo, r.code);
    eval_avg  := nullif(v_ev ->> 'avg', '')::numeric;
    eval_pct  := (v_ev ->> 'pct')::int;
    eval_warn := (v_ev ->> 'warn')::boolean;
    v_cut     := round((v_total - v_ded) * (100 - eval_pct) / 100.0, 2);

    code := r.code; name := r.name; mosque := r.mosque; season := r.season;
    days := r.days; total_cost := v_total; short_days := v_short; deduction := v_ded;
    eval_cut := v_cut; net := v_total - v_ded - v_cut;
    note := coalesce(r.m_note, r.note);
    is_manual := (r.m_ded is not null) or (r.m_staff is not null);
    is_custom := r.is_custom;
    return next;
  end loop;
end $$;
grant execute on function public.ops_report(date) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) بندٌ يضيفه مدير المشروع بسطره وبياناته (ملاحظة ١٩٣)
-- ---------------------------------------------------------------------
create or replace function public.save_ops_item(p jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_code int := nullif(p ->> 'code', '')::int;
        v_name text := nullif(trim(coalesce(p ->> 'name', '')), '');
        v_cost numeric := nullif(p ->> 'unit_cost', '')::numeric;
        v_n int := coalesce(nullif(p ->> 'staff_count', '')::int, 1);
        v_season text := coalesce(nullif(p ->> 'season', ''), 'year');
        v_mosque text := nullif(p ->> 'mosque', '');
        v_days int := nullif(p ->> 'days', '')::int;
        v_role text := nullif(p ->> 'role_key', '');
        v_custom boolean;
begin
  if not public.is_manager() then
    raise exception 'بنود التقرير لمدير المشروع' using errcode = '42501';
  end if;
  if v_name is null then raise exception 'اكتب اسم البند'; end if;
  if v_cost is null or v_cost < 0 then raise exception 'اكتب التكلفة الشهرية للفرد'; end if;
  if v_n < 1 or v_n > 9999 then raise exception 'عدد الأفراد بين ١ و٩٩٩٩'; end if;
  if v_season not in ('year', 'ramadan', 'hajj') then raise exception 'الموسم غير معروف'; end if;
  if v_mosque is not null and v_mosque not in ('makkah', 'madinah') then
    raise exception 'الموقع: المسجد الحرام أو المسجد النبوي';
  end if;

  if v_code is null then
    -- البند الجديد يأخذ رقمًا بعد المئة، فتبقى أرقام الكراسة كما هي
    select coalesce(max(code), 100) + 1 into v_code from public.ops_items where code > 100;
    insert into public.ops_items
      (code, name, staff_count, unit_cost, role_key, mosque, season, days,
       sort, is_custom, note)
    values (v_code, v_name, v_n, v_cost, v_role, v_mosque, v_season,
            coalesce(v_days, case v_season when 'ramadan' then 30 when 'hajj' then 45 else 360 end),
            100 + v_code, true, nullif(trim(coalesce(p ->> 'note', '')), ''));
    return v_code;
  end if;

  select is_custom into v_custom from public.ops_items where code = v_code;
  if v_custom is null then raise exception 'البند غير موجود'; end if;

  -- بنود الكراسة: يُعدَّل عددها وملاحظتها، ولا يُغيَّر سعرها ولا اسمها
  if v_custom then
    update public.ops_items
       set name = v_name, staff_count = v_n, unit_cost = v_cost, role_key = v_role,
           mosque = v_mosque, season = v_season,
           days = coalesce(v_days, days), note = nullif(trim(coalesce(p ->> 'note', '')), '')
     where code = v_code;
  else
    update public.ops_items
       set staff_count = v_n, note = coalesce(nullif(trim(coalesce(p ->> 'note', '')), ''), note)
     where code = v_code;
  end if;
  return v_code;
end $$;
grant execute on function public.save_ops_item(jsonb) to authenticated;

create or replace function public.delete_ops_item(p_code int)
returns void language plpgsql security definer set search_path = public as $$
declare v_custom boolean; v_name text;
begin
  if not public.is_manager() then
    raise exception 'بنود التقرير لمدير المشروع' using errcode = '42501';
  end if;
  select is_custom, name into v_custom, v_name from public.ops_items where code = p_code;
  if v_custom is null then raise exception 'البند غير موجود'; end if;
  if not v_custom then
    raise exception 'بند «%» من كراسة المنافسة: يُعدَّل عددُه ولا يُحذف', v_name;
  end if;
  delete from public.ops_items where code = p_code;
end $$;
grant execute on function public.delete_ops_item(int) to authenticated;

-- ---------------------------------------------------------------------
-- ٧) «عن المبادرة»: بيانٌ أن الاحتساب يرجع إلى الكراسة ومواسمها وتقييمها
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

    if v_id = 'outputs' and not (v_blocks::text like '%مواسم العمل%') then
      v_blocks := v_blocks || jsonb_build_array(
        jsonb_build_array('h3', 'مواسم العمل في الاحتساب'),
        jsonb_build_array('p', 'يفرّق الاحتساب بين أيام السنة ومواسمها: فلموسمي رمضان والحج '
          || 'عددٌ من المرشدين زائدٌ على عدد السنة، ولا يُحتسب ذلك الزائد إلا في شهره الهجري. '
          || 'وتعرف المنصة الشهر الهجري من تاريخه الميلادي، فلا يُدخَل ذلك يدويًّا.'),
        jsonb_build_array('h3', 'التقييم الشهري ومراتبه'),
        jsonb_build_array('p', 'يُجمع تقييم مشرفي الهيئة الأسبوعي بمعاييره الخمسة في متوسطٍ شهري، '
          || 'وله مراتبُ معتمدة يُقاس عليها أداء الفريق، ومن نزل عن المرتبة الدنيا وُجّه إليه '
          || 'إنذارٌ خطي. والمنصة تسجّل ما يصلها من مشرفي الهيئة وتحتسب المتوسط، '
          || 'ولا تُصدر تقييمًا من نفسها ولا تُعدّله.'),
        jsonb_build_array('h3', 'الغياب يُثبت لا يُقدَّر'),
        jsonb_build_array('p', 'يُحتسب التقصير من سجلّ الدوام نفسه: ورديةٌ مجدولة لم يُسجَّل فيها '
          || 'حضور. ويبقى لمدير المشروع تصحيح ما خالف الواقع بسببٍ مكتوب، '
          || 'ويُحفظ المحتسَب آليًّا بجانب المصحَّح فيُعرف الفرق.'));
    end if;

    v_new := v_new || jsonb_build_array(jsonb_build_array(v_s -> 0, v_s -> 1, v_blocks));
  end loop;

  update public.page_content
     set content = jsonb_set(v, '{sections}', v_new), updated_at = now()
   where key = 'initiative';
end $$;

notify pgrst, 'reload schema';
