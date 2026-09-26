-- =====================================================================
-- 0033 — أساس احتساب المقطوع: بالعمل، أو بالكلمة، أو بدقيقة التسجيل
--   (ملاحظة ١٢٤): من الأعمال ما يُقطع له مبلغ ثابت كالمطوية، ومنها ما
--   يُحتسب بعدد كلماته كالكتاب، ومنها ما يُحتسب بمدة تسجيله. فصار لكل
--   نوع عمل: أساسه ومبلغه.
-- =====================================================================

alter table public.pay_rates
  add column if not exists basis text not null default 'work';
alter table public.member_pay_rates
  add column if not exists basis text not null default 'work';

do $$
begin
  alter table public.pay_rates drop constraint if exists pay_rates_basis_check;
  alter table public.pay_rates add constraint pay_rates_basis_check
    check (basis in ('work', 'word', 'minute'));
  alter table public.member_pay_rates drop constraint if exists member_pay_rates_basis_check;
  alter table public.member_pay_rates add constraint member_pay_rates_basis_check
    check (basis in ('work', 'word', 'minute'));
end $$;

comment on column public.pay_rates.basis
  is 'أساس الاحتساب: work مقطوع لكل عمل · word لكل كلمة · minute لكل دقيقة تسجيل (ملاحظة ١٢٤)';

-- ---------------------------------------------------------------------
-- ضبط التسعيرة بأساسها
-- ---------------------------------------------------------------------
drop function if exists public.set_pay_rate(text, numeric);
create or replace function public.set_pay_rate(p_kind text, p_amount numeric, p_basis text default 'work')
returns void language plpgsql security definer set search_path = public as $$
declare v_basis text := coalesce(nullif(trim(p_basis), ''), 'work');
begin
  if not public.is_manager() then raise exception 'ضبط التسعيرة لمدير المشروع وحده' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'المبلغ لا يكون سالبًا'; end if;
  if v_basis not in ('work', 'word', 'minute') then raise exception 'أساس احتساب غير معروف'; end if;
  insert into public.pay_rates (work_kind, amount, basis, updated_by, updated_at)
  values (p_kind, coalesce(p_amount, 0), v_basis, auth.uid(), now())
  on conflict (work_kind) do update
    set amount = excluded.amount, basis = excluded.basis,
        updated_by = excluded.updated_by, updated_at = now();
end $$;

drop function if exists public.set_member_rate(uuid, text, numeric);
create or replace function public.set_member_rate(p_member uuid, p_kind text, p_amount numeric,
                                                  p_basis text default 'work')
returns void language plpgsql security definer set search_path = public as $$
declare v_basis text := coalesce(nullif(trim(p_basis), ''), 'work');
begin
  if not public.is_manager() then raise exception 'تخصيص التسعيرة لمدير المشروع وحده' using errcode = '42501'; end if;
  if p_amount is null then
    delete from public.member_pay_rates where member_id = p_member and work_kind = p_kind;
    return;
  end if;
  if p_amount < 0 then raise exception 'المبلغ لا يكون سالبًا'; end if;
  if v_basis not in ('work', 'word', 'minute') then raise exception 'أساس احتساب غير معروف'; end if;
  insert into public.member_pay_rates (member_id, work_kind, amount, basis, updated_by, updated_at)
  values (p_member, p_kind, p_amount, v_basis, auth.uid(), now())
  on conflict (member_id, work_kind) do update
    set amount = excluded.amount, basis = excluded.basis,
        updated_by = excluded.updated_by, updated_at = now();
end $$;

grant execute on function public.set_pay_rate(text, numeric, text) to authenticated;
grant execute on function public.set_member_rate(uuid, text, numeric, text) to authenticated;

-- أساس العمل للعضو: تخصيصه، فالعام، فالمقطوع
create or replace function public.rate_basis_for(p_member uuid, p_kind text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select basis from public.member_pay_rates where member_id = p_member and work_kind = p_kind),
    (select basis from public.pay_rates where work_kind = p_kind),
    'work')
$$;

grant execute on function public.rate_basis_for(uuid, text) to authenticated;

-- مستحقّ عملٍ بعينه: بالعمل، أو بكلماته، أو بدقائق تسجيله
create or replace function public.work_amount(p_member uuid, p_kind text, p_words int, p_seconds int)
returns numeric language sql stable security definer set search_path = public as $$
  select round(case public.rate_basis_for(p_member, p_kind)
    when 'word'   then public.rate_for(p_member, p_kind) * coalesce(p_words, 0)
    when 'minute' then public.rate_for(p_member, p_kind) * ceil(coalesce(p_seconds, 0) / 60.0)
    else public.rate_for(p_member, p_kind)
  end, 2)
$$;

grant execute on function public.work_amount(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- الأعمال المنجزة ببياناتها ومستحقّها
-- ---------------------------------------------------------------------
create or replace function public.work_items_full(p_from date, p_to date)
returns table (member_id uuid, work_kind text, works int, words int, minutes int, amount numeric)
language sql stable security definer set search_path = public as $$
  with items as (
    select distinct on (s.assignee_id, t.id)
           s.assignee_id as member_id, t.id as track_id,
           public.work_kind(m.material_type, m.deliverable) as work_kind,
           coalesce(r.words, 0) as words, coalesce(r.audio_seconds, 0) as secs
      from public.track_stages s
      join public.tracks t on t.id = s.track_id
      join public.materials m on m.id = t.material_id
      left join public.production_rows r on r.track_id = t.id
     where s.status = 'done' and s.assignee_id is not null
       and t.status = 'completed' and t.deleted_at is null
       and t.completed_at >= p_from::timestamptz
       and t.completed_at < (p_to + 1)::timestamptz
  )
  select i.member_id, i.work_kind, count(*)::int,
         sum(i.words)::int,
         ceil(sum(i.secs) / 60.0)::int,
         sum(public.work_amount(i.member_id, i.work_kind, i.words, i.secs))
    from items i
   where public.is_admin() or i.member_id = auth.uid()
   group by i.member_id, i.work_kind
$$;

grant execute on function public.work_items_full(date, date) to authenticated;

-- تقرير الإنجاز: بأساس كل نوع وسعره وعدد كلماته ودقائقه
drop function if exists public.member_work_report(date, date);
create or replace function public.member_work_report(p_from date, p_to date)
returns table (member_id uuid, full_name text, member_no text, pay_type text,
               work_kind text, works int, words int, minutes int,
               basis text, rate numeric, amount numeric)
language sql stable security definer set search_path = public as $$
  select w.member_id, p.full_name, p.member_no, coalesce(mp.pay_type, 'none'),
         w.work_kind, w.works, w.words, w.minutes,
         public.rate_basis_for(w.member_id, w.work_kind),
         public.rate_for(w.member_id, w.work_kind),
         w.amount
    from public.work_items_full(p_from, p_to) w
    join public.profiles p on p.id = w.member_id
    left join public.member_pay mp on mp.member_id = w.member_id
   order by p.full_name, w.work_kind
$$;

grant execute on function public.member_work_report(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- تفصيل الدورة: الكلمات والدقائق تُحفظ مع كل نوع
-- ---------------------------------------------------------------------
alter table public.payroll_item_kinds add column if not exists words int not null default 0;
alter table public.payroll_item_kinds add column if not exists minutes int not null default 0;
alter table public.payroll_item_kinds add column if not exists basis text not null default 'work';

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
      insert into public.payroll_item_kinds (payroll_id, member_id, work_kind, works, words, minutes,
                                             basis, rate, amount)
      select v_id, w.member_id, w.work_kind, w.works, w.words, w.minutes,
             public.rate_basis_for(w.member_id, w.work_kind),
             public.rate_for(w.member_id, w.work_kind),
             w.amount
        from public.work_items_full(v_from, v_to) w
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

drop function if exists public.payroll_kinds(uuid);
create or replace function public.payroll_kinds(p_payroll uuid)
returns table (member_id uuid, work_kind text, works int, words int, minutes int,
               basis text, rate numeric, amount numeric)
language sql stable security definer set search_path = public as $$
  select k.member_id, k.work_kind, k.works, k.words, k.minutes, k.basis, k.rate, k.amount
    from public.payroll_item_kinds k
   where k.payroll_id = p_payroll
     and (public.is_admin() or k.member_id = auth.uid())
   order by k.work_kind
$$;

grant execute on function public.payroll_kinds(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- تفصيل أعمال العضو: المستحقّ بحسب أساس نوعه
-- ---------------------------------------------------------------------
drop function if exists public.member_work_list(uuid, date, date);
create or replace function public.member_work_list(p_member uuid, p_from date, p_to date)
returns table (
  track_id uuid, material_id uuid, title text, material_type text, sermon_type text,
  language_code text, work_kind text, completed_at timestamptz,
  words int, chars int, pages int, audio_seconds int, stages text,
  basis text, rate numeric, amount numeric
)
language sql stable security definer set search_path = public as $$
  select t.id, m.id, m.title, m.material_type, m.sermon_type,
         t.language_code,
         public.work_kind(m.material_type, m.deliverable) as work_kind,
         t.completed_at,
         coalesce(r.words, 0), coalesce(r.chars, 0),
         case when coalesce(r.words, 0) > 0 then greatest(1, ceil(r.words / 250.0))::int else 0 end,
         coalesce(r.audio_seconds, 0),
         (select string_agg(distinct coalesce(w.name_ar, s2.stage_key), ' · ')
            from public.track_stages s2
            left join public.workflow_stages w on w.key = s2.stage_key
           where s2.track_id = t.id and s2.assignee_id = p_member and s2.status = 'done'),
         public.rate_basis_for(p_member, public.work_kind(m.material_type, m.deliverable)),
         public.rate_for(p_member, public.work_kind(m.material_type, m.deliverable)),
         public.work_amount(p_member, public.work_kind(m.material_type, m.deliverable),
                            coalesce(r.words, 0), coalesce(r.audio_seconds, 0))
    from public.tracks t
    join public.materials m on m.id = t.material_id
    left join public.production_rows r on r.track_id = t.id
   where (public.is_admin() or p_member = auth.uid())
     and t.status = 'completed' and t.deleted_at is null
     and t.completed_at >= p_from::timestamptz
     and t.completed_at < (p_to + 1)::timestamptz
     and exists (select 1 from public.track_stages s
                  where s.track_id = t.id and s.assignee_id = p_member and s.status = 'done')
   order by t.completed_at desc
$$;

grant execute on function public.member_work_list(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
