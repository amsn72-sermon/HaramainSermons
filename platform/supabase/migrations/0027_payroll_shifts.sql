-- =====================================================================
-- 0027 — الرواتب والمستحقات، والحضور والانصراف بالورديات (ملاحظتا ١١٦ و١١٧)
--   الأجر نوعان: شهري ثابت، ومقطوع لكل عمل مُنجَز. والمرشدون المكانيون
--   عملهم ورديات في مواقع الحرمين، فحضورهم ببصمة من جوالهم، والمترجمون
--   المتخصصون يُقاس التزامهم بمواعيد التسليم لا ببصمة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) أجر كل عضو — لا يطّلع عليه إلا صاحبه والإدارة
-- ---------------------------------------------------------------------
create table if not exists public.member_pay (
  member_id  uuid primary key references public.profiles (id) on delete cascade,
  pay_type   text not null default 'none' check (pay_type in ('none', 'monthly', 'per_work')),
  monthly    numeric(12, 2) not null default 0 check (monthly >= 0),
  per_work   numeric(12, 2) not null default 0 check (per_work >= 0),
  note       text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

comment on table public.member_pay is 'نوع أجر العضو ومقداره: شهري ثابت أو مقطوع لكل عمل (ملاحظة ١١٦)';

alter table public.member_pay enable row level security;
drop policy if exists "pay read" on public.member_pay;
create policy "pay read" on public.member_pay for select using (member_id = auth.uid() or public.is_admin());

create or replace function public.set_member_pay(
  p_member uuid, p_type text, p_monthly numeric default 0, p_per_work numeric default 0, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'ضبط الأجور لمدير المشروع وحده' using errcode = '42501'; end if;
  if p_type not in ('none', 'monthly', 'per_work') then raise exception 'نوع أجر غير معروف'; end if;
  if coalesce(p_monthly, 0) < 0 or coalesce(p_per_work, 0) < 0 then raise exception 'المبلغ لا يكون سالبًا'; end if;
  insert into public.member_pay (member_id, pay_type, monthly, per_work, note, updated_by, updated_at)
  values (p_member, p_type, coalesce(p_monthly, 0), coalesce(p_per_work, 0),
          nullif(trim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (member_id) do update
    set pay_type = excluded.pay_type, monthly = excluded.monthly, per_work = excluded.per_work,
        note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
end $$;

grant execute on function public.set_member_pay(uuid, text, numeric, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) دورة رواتب شهرية وبنودها
-- ---------------------------------------------------------------------
create table if not exists public.payrolls (
  id          uuid primary key default gen_random_uuid(),
  period      date not null unique,                      -- أول يوم من الشهر
  status      text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  note        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  paid_at     timestamptz
);

create table if not exists public.payroll_items (
  id         uuid primary key default gen_random_uuid(),
  payroll_id uuid not null references public.payrolls (id) on delete cascade,
  member_id  uuid not null references public.profiles (id) on delete cascade,
  pay_type   text not null,
  base       numeric(12, 2) not null default 0,
  works      int not null default 0,        -- المراحل المنجزة في الشهر (للمقطوع)
  words      int not null default 0,
  minutes    int not null default 0,
  allowance  numeric(12, 2) not null default 0 check (allowance >= 0),
  deduction  numeric(12, 2) not null default 0 check (deduction >= 0),
  note       text,
  unique (payroll_id, member_id)
);

alter table public.payrolls enable row level security;
alter table public.payroll_items enable row level security;
drop policy if exists "payroll read" on public.payrolls;
create policy "payroll read" on public.payrolls for select using (public.is_admin());
drop policy if exists "payroll item read" on public.payroll_items;
create policy "payroll item read" on public.payroll_items for select using (public.is_admin());

-- العضو يرى مستحقاته هو بعد اعتمادها، لا كشف غيره
create or replace function public.my_payslips()
returns table (payroll_id uuid, period date, status text, pay_type text,
               base numeric, works int, allowance numeric, deduction numeric, total numeric, note text)
language sql stable security definer set search_path = public as $$
  select i.payroll_id, r.period, r.status, i.pay_type,
         i.base, i.works, i.allowance, i.deduction,
         (i.base + i.allowance - i.deduction), i.note
    from public.payroll_items i
    join public.payrolls r on r.id = i.payroll_id
   where i.member_id = auth.uid() and r.status in ('approved', 'paid')
   order by r.period desc
$$;

grant execute on function public.my_payslips() to authenticated;

comment on table public.payrolls is 'دورة رواتب شهرية: مسودة ← معتمدة ← مصروفة (ملاحظة ١١٦)';

-- الاحتساب: يبني بنود الدورة من الأجور والمراحل المنجزة في الشهر
create or replace function public.build_payroll(p_period date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_from date; v_to date; v_r record; v_status text;
begin
  if not public.is_admin() then raise exception 'احتساب الرواتب للمنسق ومدير المشروع' using errcode = '42501'; end if;
  v_from := date_trunc('month', coalesce(p_period, current_date))::date;
  v_to := (v_from + interval '1 month')::date;

  select id, status into v_id, v_status from public.payrolls where period = v_from;
  if v_id is null then
    insert into public.payrolls (period, created_by) values (v_from, auth.uid()) returning id into v_id;
  elsif v_status <> 'draft' then
    raise exception 'الدورة معتمدة، ولا تُعاد حسابتها';
  end if;

  -- البدلات والخصومات المكتوبة يدويًّا تبقى، والباقي يُعاد بناؤه
  for v_r in
    select p.id as member_id,
           coalesce(mp.pay_type, 'none') as pay_type,
           coalesce(mp.monthly, 0) as monthly, coalesce(mp.per_work, 0) as per_work,
           (select count(*) from public.track_stages s
              join public.tracks t on t.id = s.track_id
             where s.assignee_id = p.id and s.status = 'done'
               and s.finished_at >= v_from and s.finished_at < v_to
               and t.deleted_at is null)::int as works
      from public.profiles p
      left join public.member_pay mp on mp.member_id = p.id
     where p.status = 'active' and coalesce(mp.pay_type, 'none') <> 'none'
  loop
    insert into public.payroll_items (payroll_id, member_id, pay_type, base, works)
    values (v_id, v_r.member_id, v_r.pay_type,
            case when v_r.pay_type = 'monthly' then v_r.monthly else v_r.per_work * v_r.works end,
            v_r.works)
    on conflict (payroll_id, member_id) do update
      set pay_type = excluded.pay_type, base = excluded.base, works = excluded.works;
  end loop;

  -- من لم يعد له أجر يخرج من الدورة
  delete from public.payroll_items i
   where i.payroll_id = v_id
     and not exists (select 1 from public.member_pay mp
                      where mp.member_id = i.member_id and mp.pay_type <> 'none');
  return v_id;
end $$;

grant execute on function public.build_payroll(date) to authenticated;

create or replace function public.set_payroll_item(
  p_payroll uuid, p_member uuid, p_allowance numeric default 0, p_deduction numeric default 0, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not public.is_admin() then raise exception 'تعديل بنود الرواتب للمنسق ومدير المشروع' using errcode = '42501'; end if;
  select status into v_status from public.payrolls where id = p_payroll;
  if v_status is null then raise exception 'الدورة غير موجودة'; end if;
  if v_status <> 'draft' then raise exception 'الدورة معتمدة، ولا تُعدَّل بنودها'; end if;
  if coalesce(p_allowance, 0) < 0 or coalesce(p_deduction, 0) < 0 then raise exception 'المبلغ لا يكون سالبًا'; end if;

  update public.payroll_items
     set allowance = coalesce(p_allowance, 0), deduction = coalesce(p_deduction, 0),
         note = nullif(trim(coalesce(p_note, '')), '')
   where payroll_id = p_payroll and member_id = p_member;
  if not found then raise exception 'العضو ليس في هذه الدورة'; end if;
end $$;

grant execute on function public.set_payroll_item(uuid, uuid, numeric, numeric, text) to authenticated;

create or replace function public.set_payroll_status(p_payroll uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cur text;
begin
  if not public.is_manager() then raise exception 'اعتماد الرواتب لمدير المشروع وحده' using errcode = '42501'; end if;
  if p_status not in ('draft', 'approved', 'paid') then raise exception 'حالة غير معروفة'; end if;
  select status into v_cur from public.payrolls where id = p_payroll;
  if v_cur is null then raise exception 'الدورة غير موجودة'; end if;

  update public.payrolls
     set status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         paid_at = case when p_status = 'paid' then now() else null end
   where id = p_payroll;
end $$;

grant execute on function public.set_payroll_status(uuid, text) to authenticated;

-- كشف الدورة: الأسماء والحسابات المعتمدة والمبالغ
create or replace view public.payroll_sheet with (security_invoker = true) as
select i.payroll_id, r.period, r.status,
       i.member_id, p.full_name, p.member_no, pr.national_id,
       i.pay_type, i.base, i.works, i.allowance, i.deduction,
       (i.base + i.allowance - i.deduction) as total,
       b.bank_name, b.iban, (b.verified_at is not null) as bank_verified,
       i.note
from public.payroll_items i
join public.payrolls r on r.id = i.payroll_id
join public.profiles p on p.id = i.member_id
left join public.profile_private pr on pr.id = i.member_id
left join public.bank_accounts b on b.member_id = i.member_id;

grant select on public.payroll_sheet to authenticated;

-- ---------------------------------------------------------------------
-- ٣) الورديات والحضور — لفريق الإرشاد المكاني (ملاحظة ١١٧)
-- ---------------------------------------------------------------------
create table if not exists public.shifts (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.profiles (id) on delete cascade,
  shift_date  date not null,
  start_at    time not null,
  end_at      time not null,
  location    text,
  status      text not null default 'scheduled' check (status in ('scheduled', 'present', 'absent', 'leave')),
  check_in_at  timestamptz,
  check_out_at timestamptz,
  late_minutes int not null default 0,
  note        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  unique (member_id, shift_date, start_at)
);

create index if not exists shifts_date_idx on public.shifts (shift_date);

comment on table public.shifts is 'ورديات المرشدين المكانيين وحضورهم وانصرافهم (ملاحظة ١١٧)';

alter table public.shifts enable row level security;
drop policy if exists "shift read" on public.shifts;
create policy "shift read" on public.shifts for select using (member_id = auth.uid() or public.is_admin());

create or replace function public.save_shift(
  p_member uuid, p_date date, p_start time, p_end time, p_location text default null,
  p_id uuid default null, p_note text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'جدولة الورديات للمنسق ومدير المشروع' using errcode = '42501'; end if;
  if p_end <= p_start then raise exception 'نهاية الوردية بعد بدايتها'; end if;
  if not exists (select 1 from public.profiles where id = p_member and status = 'active') then
    raise exception 'العضو غير مفعّل';
  end if;

  if p_id is null then
    insert into public.shifts (member_id, shift_date, start_at, end_at, location, note, created_by)
    values (p_member, p_date, p_start, p_end, nullif(trim(coalesce(p_location, '')), ''),
            nullif(trim(coalesce(p_note, '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.shifts
       set member_id = p_member, shift_date = p_date, start_at = p_start, end_at = p_end,
           location = nullif(trim(coalesce(p_location, '')), ''), note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'الوردية غير موجودة'; end if;
  end if;
  return v_id;
end $$;

grant execute on function public.save_shift(uuid, date, time, time, text, uuid, text) to authenticated;

create or replace function public.delete_shift(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'حذف الورديات للمنسق ومدير المشروع' using errcode = '42501'; end if;
  delete from public.shifts where id = p_id;
  if not found then raise exception 'الوردية غير موجودة'; end if;
end $$;

grant execute on function public.delete_shift(uuid) to authenticated;

-- بصمة الحضور والانصراف: من جوال المرشد، لورديته هو ويومها
create or replace function public.shift_check(p_id uuid, p_out boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.shifts; v_late int;
begin
  select * into v_s from public.shifts where id = p_id for update;
  if not found then raise exception 'الوردية غير موجودة'; end if;
  if v_s.member_id <> auth.uid() and not public.is_admin() then
    raise exception 'هذه وردية غيرك' using errcode = '42501';
  end if;
  if v_s.shift_date <> (now() at time zone 'Asia/Riyadh')::date and not public.is_admin() then
    raise exception 'البصمة في يوم الوردية نفسه';
  end if;

  if p_out then
    if v_s.check_in_at is null then raise exception 'سجّل حضورك أولًا'; end if;
    update public.shifts set check_out_at = now() where id = p_id;
  else
    v_late := greatest(0, floor(extract(epoch from (
      (now() at time zone 'Asia/Riyadh') - (v_s.shift_date + v_s.start_at))) / 60)::int);
    update public.shifts
       set check_in_at = coalesce(check_in_at, now()), status = 'present',
           late_minutes = case when check_in_at is null then v_late else late_minutes end
     where id = p_id;
  end if;
end $$;

grant execute on function public.shift_check(uuid, boolean) to authenticated;

create or replace function public.set_shift_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'تعليم الحضور للمنسق ومدير المشروع' using errcode = '42501'; end if;
  if p_status not in ('scheduled', 'present', 'absent', 'leave') then raise exception 'حالة غير معروفة'; end if;
  update public.shifts
     set status = p_status, note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
   where id = p_id;
  if not found then raise exception 'الوردية غير موجودة'; end if;
end $$;

grant execute on function public.set_shift_status(uuid, text, text) to authenticated;

-- ملخص شهري للحضور: لكل عضو أيامه وتأخيره وغيابه
create or replace function public.attendance_summary(p_month date)
returns table (member_id uuid, full_name text, shifts int, present int, absent int, leaves int, late_minutes int)
language sql stable security definer set search_path = public as $$
  select s.member_id, p.full_name,
         count(*)::int,
         count(*) filter (where s.status = 'present')::int,
         count(*) filter (where s.status = 'absent')::int,
         count(*) filter (where s.status = 'leave')::int,
         coalesce(sum(s.late_minutes), 0)::int
    from public.shifts s join public.profiles p on p.id = s.member_id
   where s.shift_date >= date_trunc('month', coalesce(p_month, current_date))::date
     and s.shift_date < (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date
     and (public.is_admin() or s.member_id = auth.uid())
   group by s.member_id, p.full_name
   order by p.full_name
$$;

grant execute on function public.attendance_summary(date) to authenticated;
