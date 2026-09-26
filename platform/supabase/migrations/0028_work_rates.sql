-- =====================================================================
-- 0028 — تسعيرة الأعمال بالمقطوع حسب نوع العمل، وربطها بالإنجاز النهائي
--   (ملاحظة ١١٨): الخطبة كتابيةً غير الخطبة مع التسجيل الصوتي، والكتاب
--   غير المطوية. ولا يُحتسب عمل إلا بإتمام مساره، فيدخل سجل العضو بنوعه.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) نوع العمل يُشتق من نوع المادة ومما طُلب تسليمه
-- ---------------------------------------------------------------------
create or replace function public.work_kind(p_type text, p_deliverable text)
returns text language sql immutable as $$
  select case
    when p_type = 'خطب' and p_deliverable = 'text_audio' then 'sermon_audio'
    when p_type = 'خطب' then 'sermon_text'
    when p_type = 'دروس علمية' and p_deliverable = 'text_audio' then 'lesson_audio'
    when p_type = 'دروس علمية' then 'lesson_text'
    when p_type = 'كتب' then 'book'
    when p_type = 'مطويات' then 'booklet'
    when p_type = 'منشورات' then 'post'
    when p_type = 'إعلانات' then 'announcement'
    when p_type = 'توجيهات' then 'directive'
    else 'other'
  end
$$;

comment on function public.work_kind(text, text) is 'مفتاح نوع العمل للتسعيرة بالمقطوع (ملاحظة ١١٨)';

-- ---------------------------------------------------------------------
-- ٢) التسعيرة العامة، وتخصيصها لعضو بعينه عند الحاجة
-- ---------------------------------------------------------------------
create table if not exists public.pay_rates (
  work_kind  text primary key,
  amount     numeric(12, 2) not null default 0 check (amount >= 0),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_pay_rates (
  member_id  uuid not null references public.profiles (id) on delete cascade,
  work_kind  text not null,
  amount     numeric(12, 2) not null default 0 check (amount >= 0),
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (member_id, work_kind)
);

insert into public.pay_rates (work_kind) values
  ('sermon_text'), ('sermon_audio'), ('lesson_text'), ('lesson_audio'),
  ('book'), ('booklet'), ('post'), ('announcement'), ('directive'), ('other')
on conflict (work_kind) do nothing;

alter table public.pay_rates enable row level security;
alter table public.member_pay_rates enable row level security;
drop policy if exists "rates read" on public.pay_rates;
create policy "rates read" on public.pay_rates for select using (auth.uid() is not null);
drop policy if exists "member rates read" on public.member_pay_rates;
create policy "member rates read" on public.member_pay_rates for select
  using (member_id = auth.uid() or public.is_admin());

create or replace function public.set_pay_rate(p_kind text, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'ضبط التسعيرة لمدير المشروع وحده' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'المبلغ لا يكون سالبًا'; end if;
  insert into public.pay_rates (work_kind, amount, updated_by, updated_at)
  values (p_kind, coalesce(p_amount, 0), auth.uid(), now())
  on conflict (work_kind) do update
    set amount = excluded.amount, updated_by = excluded.updated_by, updated_at = now();
end $$;

create or replace function public.set_member_rate(p_member uuid, p_kind text, p_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'تخصيص التسعيرة لمدير المشروع وحده' using errcode = '42501'; end if;
  if p_amount is null then
    delete from public.member_pay_rates where member_id = p_member and work_kind = p_kind;
    return;
  end if;
  if p_amount < 0 then raise exception 'المبلغ لا يكون سالبًا'; end if;
  insert into public.member_pay_rates (member_id, work_kind, amount, updated_by, updated_at)
  values (p_member, p_kind, p_amount, auth.uid(), now())
  on conflict (member_id, work_kind) do update
    set amount = excluded.amount, updated_by = excluded.updated_by, updated_at = now();
end $$;

grant execute on function public.set_pay_rate(text, numeric) to authenticated;
grant execute on function public.set_member_rate(uuid, text, numeric) to authenticated;

-- سعر العمل للعضو: تخصيصه، فالتسعيرة العامة، فالمقطوع القديم في ملفه
create or replace function public.rate_for(p_member uuid, p_kind text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select amount from public.member_pay_rates where member_id = p_member and work_kind = p_kind),
    nullif((select amount from public.pay_rates where work_kind = p_kind), 0),
    (select per_work from public.member_pay where member_id = p_member),
    0)
$$;

grant execute on function public.rate_for(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) الأعمال المنجزة: لا تُحتسب إلا بإتمام المسار، وتُنسب لمن أنجز فيه
-- ---------------------------------------------------------------------
create or replace function public.work_items(p_from date, p_to date)
returns table (member_id uuid, work_kind text, works int)
language sql stable security definer set search_path = public as $$
  select x.member_id, x.work_kind, count(*)::int
    from (
      select distinct s.assignee_id as member_id, t.id as track_id,
             public.work_kind(m.material_type, m.deliverable) as work_kind
        from public.track_stages s
        join public.tracks t on t.id = s.track_id
        join public.materials m on m.id = t.material_id
       where s.status = 'done' and s.assignee_id is not null
         and t.status = 'completed' and t.deleted_at is null
         and t.completed_at >= p_from::timestamptz
         and t.completed_at < (p_to + 1)::timestamptz
    ) x
   where public.is_admin() or x.member_id = auth.uid()
   group by x.member_id, x.work_kind
$$;

grant execute on function public.work_items(date, date) to authenticated;

-- تقرير الإنجاز: لكل عضو أنواع أعماله وعددها ومبلغها
create or replace function public.member_work_report(p_from date, p_to date)
returns table (member_id uuid, full_name text, member_no text, pay_type text,
               work_kind text, works int, rate numeric, amount numeric)
language sql stable security definer set search_path = public as $$
  select w.member_id, p.full_name, p.member_no, coalesce(mp.pay_type, 'none'),
         w.work_kind, w.works,
         public.rate_for(w.member_id, w.work_kind),
         (w.works * public.rate_for(w.member_id, w.work_kind))
    from public.work_items(p_from, p_to) w
    join public.profiles p on p.id = w.member_id
    left join public.member_pay mp on mp.member_id = w.member_id
   order by p.full_name, w.work_kind
$$;

grant execute on function public.member_work_report(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) تفصيل بنود الدورة حسب نوع العمل، يُحفظ مع الدورة فلا يتغيّر بعد اعتمادها
-- ---------------------------------------------------------------------
create table if not exists public.payroll_item_kinds (
  payroll_id uuid not null references public.payrolls (id) on delete cascade,
  member_id  uuid not null references public.profiles (id) on delete cascade,
  work_kind  text not null,
  works      int not null default 0,
  rate       numeric(12, 2) not null default 0,
  amount     numeric(12, 2) not null default 0,
  primary key (payroll_id, member_id, work_kind)
);

alter table public.payroll_item_kinds enable row level security;
drop policy if exists "payroll kinds read" on public.payroll_item_kinds;
create policy "payroll kinds read" on public.payroll_item_kinds for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- ٥) الاحتساب: المقطوع صار بحسب نوع كل عمل
-- ---------------------------------------------------------------------
create or replace function public.build_payroll(p_period date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_from date; v_to date; v_r record; v_status text;
        v_base numeric; v_works int;
begin
  if not public.is_admin() then raise exception 'احتساب الرواتب للمنسق ومدير المشروع' using errcode = '42501'; end if;
  v_from := date_trunc('month', coalesce(p_period, current_date))::date;
  v_to := (v_from + interval '1 month - 1 day')::date;

  select id, status into v_id, v_status from public.payrolls where period = v_from;
  if v_id is null then
    insert into public.payrolls (period, created_by) values (v_from, auth.uid()) returning id into v_id;
  elsif v_status <> 'draft' then
    raise exception 'الدورة معتمدة، ولا تُعاد حسابتها';
  end if;

  delete from public.payroll_item_kinds where payroll_id = v_id;

  for v_r in
    select p.id as member_id, coalesce(mp.pay_type, 'none') as pay_type, coalesce(mp.monthly, 0) as monthly
      from public.profiles p
      left join public.member_pay mp on mp.member_id = p.id
     where p.status = 'active' and coalesce(mp.pay_type, 'none') <> 'none'
  loop
    v_base := 0; v_works := 0;

    if v_r.pay_type = 'monthly' then
      v_base := v_r.monthly;
    else
      insert into public.payroll_item_kinds (payroll_id, member_id, work_kind, works, rate, amount)
      select v_id, w.member_id, w.work_kind, w.works,
             public.rate_for(w.member_id, w.work_kind),
             w.works * public.rate_for(w.member_id, w.work_kind)
        from public.work_items(v_from, v_to) w
       where w.member_id = v_r.member_id;

      select coalesce(sum(amount), 0), coalesce(sum(works), 0) into v_base, v_works
        from public.payroll_item_kinds where payroll_id = v_id and member_id = v_r.member_id;
    end if;

    insert into public.payroll_items (payroll_id, member_id, pay_type, base, works)
    values (v_id, v_r.member_id, v_r.pay_type, v_base, v_works)
    on conflict (payroll_id, member_id) do update
      set pay_type = excluded.pay_type, base = excluded.base, works = excluded.works;
  end loop;

  delete from public.payroll_items i
   where i.payroll_id = v_id
     and not exists (select 1 from public.member_pay mp
                      where mp.member_id = i.member_id and mp.pay_type <> 'none');
  return v_id;
end $$;

grant execute on function public.build_payroll(date) to authenticated;

-- تفصيل بند العضو كما يُعرض في الكشف: «خطبة مع تسجيل ×٣ · كتاب ×١»
create or replace function public.payroll_kinds(p_payroll uuid)
returns table (member_id uuid, work_kind text, works int, rate numeric, amount numeric)
language sql stable security definer set search_path = public as $$
  select k.member_id, k.work_kind, k.works, k.rate, k.amount
    from public.payroll_item_kinds k
   where k.payroll_id = p_payroll
     and (public.is_admin() or k.member_id = auth.uid())
   order by k.work_kind
$$;

grant execute on function public.payroll_kinds(uuid) to authenticated;
