-- =====================================================================
-- 0074 — مواقعُ العمل وجدولةُ الدوام (ملاحظتا ٢٢٧ و٢٣٣)
--
--   ٢٢٧) لكلِّ عضوٍ نمطُ عملٍ: عن بُعدٍ أو حضوري. والحضوريُّ يُسنَد له موقعٌ
--        من المواقع المنشأة. وإنشاءُ المواقع وتحريرُها وإسنادُها لمدير
--        المشروع؛ والمنسقون يطّلعون على كل شيءٍ بلا تعديل؛ وقائدُ الفريق
--        يطّلع على فريقه وحدَه.
--
--   ٢٣٣) ولا تُكتب المناوباتُ يومًا بيوم: يُضبط للعضو فترتُه وأيامُ عمله
--        وموقعُه مرةً واحدة، ثم تُولَّد مناوباتُ الشهر دفعةً، وتُعرض قبل
--        الاعتماد، ويبقى الاستثناءُ اليوميُّ على ما هو عليه.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) أيامُ العمل: ٠ الأحد … ٦ السبت
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists work_days smallint[] not null default '{0,1,2,3,4}';

comment on column public.profiles.work_days is
  'أيامُ عمل العضو: ٠ الأحد إلى ٦ السبت (ملاحظة ٢٣٣)';

-- ---------------------------------------------------------------------
-- ٢) الصلاحيات: الإنشاءُ والتحريرُ والإسنادُ لمدير المشروع وحدَه
-- ---------------------------------------------------------------------
create or replace function public.may_set_sites()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_manager()
$$;
grant execute on function public.may_set_sites() to authenticated;

comment on function public.may_set_sites() is
  'إنشاءُ مواقع العمل وتحريرُها لمدير المشروع؛ وغيرُه يطّلع (ملاحظة ٢٢٧)';

-- من يرى شاشةَ مواقع العمل: الإدارةُ كلُّها اطّلاعًا، والقائدُ لفريقه
create or replace function public.may_see_sites()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_team_lead()
$$;
grant execute on function public.may_see_sites() to authenticated;

create or replace function public.set_member_site(p_member uuid, p_site uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'إسنادُ مواقع العمل لمدير المشروع' using errcode = '42501';
  end if;
  update public.profiles set site_id = p_site where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
end $$;
grant execute on function public.set_member_site(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) نمطُ العمل والفترةُ وأيامُها — ضبطةٌ واحدةٌ في ملف العضو
-- ---------------------------------------------------------------------
create or replace function public.set_member_schedule(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_member uuid := nullif(p ->> 'member_id', '')::uuid;
        v_mode   text := nullif(trim(coalesce(p ->> 'work_mode', '')), '');
        v_period text := nullif(trim(coalesce(p ->> 'duty_period', '')), '');
        v_site   uuid := nullif(p ->> 'site_id', '')::uuid;
        v_days   smallint[];
        v_d      jsonb;
begin
  if not public.is_manager() then
    raise exception 'ضبطُ أماكن العمل وأوقاتِه لمدير المشروع' using errcode = '42501';
  end if;
  if v_member is null then raise exception 'حدّد العضو'; end if;
  if v_mode is not null and v_mode not in ('remote', 'onsite') then
    raise exception 'نمطُ العمل: عن بُعدٍ أو حضوري';
  end if;
  if v_period is not null and not exists (select 1 from public.duty_periods where code = v_period) then
    raise exception 'فترةٌ غير معروفة';
  end if;

  if p ? 'work_days' then
    v_days := '{}'::smallint[];
    for v_d in select * from jsonb_array_elements(coalesce(p -> 'work_days', '[]'::jsonb)) loop
      v_days := v_days || (v_d #>> '{}')::smallint;
    end loop;
    if array_length(v_days, 1) is null then v_days := '{}'::smallint[]; end if;
    if exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
      raise exception 'أيامُ العمل من ٠ إلى ٦';
    end if;
  end if;

  update public.profiles
     set work_mode   = coalesce(v_mode, work_mode),
         duty_period = case when p ? 'duty_period' then v_period else duty_period end,
         site_id     = case when p ? 'site_id'     then v_site   else site_id end,
         work_days   = coalesce(v_days, work_days)
   where id = v_member;
  if not found then raise exception 'العضو غير موجود'; end if;

  -- من عاد إلى العمل عن بُعدٍ لا موقعَ له ولا مناوبات
  if v_mode = 'remote' then
    update public.profiles set site_id = null, duty_period = null where id = v_member;
  end if;
end $$;
grant execute on function public.set_member_schedule(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) كشفُ أماكن العمل وأوقاتِه
-- ---------------------------------------------------------------------
create or replace function public.work_plan()
returns table (id uuid, full_name text, role text, track text, city text,
               work_mode text, site_id uuid, site_name text, duty_period text,
               period_name text, start_at time, end_at time,
               work_days smallint[], lead_id uuid, lead_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role::text, p.track, p.city,
         p.work_mode, p.site_id, w.name, p.duty_period, d.name, d.start_at, d.end_at,
         p.work_days, p.lead_id, l.full_name
    from public.profiles p
    left join public.work_sites   w on w.id = p.site_id
    left join public.duty_periods d on d.code = p.duty_period
    left join public.profiles     l on l.id = p.lead_id
   where p.status <> 'disabled'
     and (public.is_admin() or p.lead_id = auth.uid() or p.id = auth.uid())
   order by p.work_mode desc, p.track, p.city nulls last, p.full_name
$$;
grant execute on function public.work_plan() to authenticated;

-- ---------------------------------------------------------------------
-- ٥) توليدُ مناوبات الشهر (ملاحظة ٢٣٣)
--    تُعرض أولًا، فإن رُضيت اعتُمدت. ولا تُمسّ مناوبةٌ مسجَّلةٌ من قبل.
-- ---------------------------------------------------------------------
create or replace function public.generate_shifts(p_month date,
                                                  p_member uuid default null,
                                                  p_commit boolean default false)
returns table (member_id uuid, full_name text, shift_date date,
               start_at time, end_at time, location text, already boolean)
language plpgsql security definer set search_path = public as $$
-- أسماءُ الأعمدة المُخرَجة تُشبه أعمدةَ الجداول، فيُقدَّم العمودُ على المتغيّر
#variable_conflict use_column
declare v_from date; v_to date; v_n int := 0;
begin
  if not public.is_admin_for('shifts') then
    raise exception 'توليدُ المناوبات لمن له صلاحيةُ الحضور' using errcode = '42501';
  end if;
  v_from := date_trunc('month', coalesce(p_month, current_date))::date;
  v_to   := (v_from + interval '1 month - 1 day')::date;

  create temporary table if not exists gen_rows (
    member_id uuid, full_name text, shift_date date,
    start_at time, end_at time, location text, already boolean
  ) on commit drop;
  delete from gen_rows;

  insert into gen_rows
  select p.id, p.full_name, g::date, d.start_at, d.end_at, w.name,
         exists (select 1 from public.shifts s
                  where s.member_id = p.id and s.shift_date = g::date)
    from public.profiles p
    join public.duty_periods d on d.code = p.duty_period and d.is_active
    left join public.work_sites w on w.id = p.site_id
    cross join lateral generate_series(v_from, v_to, interval '1 day') g
   where p.status = 'active'
     and p.work_mode = 'onsite'
     and (p_member is null or p.id = p_member)
     and extract(dow from g)::smallint = any (p.work_days);

  if p_commit then
    insert into public.shifts (member_id, shift_date, start_at, end_at, location, created_by)
    select r.member_id, r.shift_date, r.start_at, r.end_at, r.location, auth.uid()
      from gen_rows r
     where not r.already
    on conflict (member_id, shift_date, start_at) do nothing;
    get diagnostics v_n = row_count;
  end if;

  return query select g.member_id, g.full_name, g.shift_date, g.start_at,
                      g.end_at, g.location, g.already
                 from gen_rows g
                order by g.full_name, g.shift_date;
end $$;
grant execute on function public.generate_shifts(date, uuid, boolean) to authenticated;

comment on function public.generate_shifts(date, uuid, boolean) is
  'يُولّد مناوباتِ الشهر من فترة العضو وأيام عمله — يُعرض ثم يُعتمد (ملاحظة ٢٣٣)';

notify pgrst, 'reload schema';
