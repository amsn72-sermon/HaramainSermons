-- =====================================================================
-- 0073 — فتراتُ الدوام جدولًا يُحرَّر، والقيادةُ بالأسماء (ملاحظة ٢٢٨)
--
--   كانت الفتراتُ الثلاثُ مكتوبةً في الدالّة لا تتبدّل: ٦ و١٤ و٢٢. فصارت
--   جدولًا: اسمٌ وبدايةٌ ونهايةٌ وترتيبٌ وتفعيل، مبذورًا بثلاثٍ من السابعة
--   صباحًا، تُحرَّر أوقاتُها ويُزاد عليها ويُعطَّل منها.
--
--   وكانت القيادةُ بالنطاق — مدينةٌ وفترة — فصارت بالأسماء: يُسنَد العضوُ
--   إلى قائدِه بعينه، ولكلِّ عضوٍ قائدٌ واحدٌ لا غير، فإن نُقل إلى قائدٍ
--   خرج من فريق الأول من نفسه. والقادةُ يتعدّدون: في المدينة ثلاثةٌ أو
--   أربعةٌ يقودون الفريق. ومعهم «مشرفُ فريق الترجمة» يُعيَّن من المترجمين
--   الخبراء أنفسِهم، يبقى مترجمًا ويُشرف على من يُسمَّون له.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) جدولُ الفترات
-- ---------------------------------------------------------------------
create table if not exists public.duty_periods (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  start_at   time not null,
  end_at     time not null,
  sort       int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.duty_periods is
  'فتراتُ الدوام: اسمُها وأوقاتُها وترتيبُها — تُحرَّر من المنصة (ملاحظة ٢٢٨)';

alter table public.duty_periods enable row level security;
drop policy if exists "read periods" on public.duty_periods;
create policy "read periods" on public.duty_periods
  for select using (public.my_role() is not null);
grant select on public.duty_periods to authenticated;

-- ثلاثُ فتراتٍ من السابعة صباحًا، كلُّ فترةٍ ثمانِ ساعات
insert into public.duty_periods (code, name, start_at, end_at, sort) values
  ('morning', 'الفترة الصباحية', time '07:00', time '15:00', 1),
  ('evening', 'الفترة المسائية', time '15:00', time '23:00', 2),
  ('night',   'الفترة الليلية',  time '23:00', time '07:00', 3)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- ٢) الفترةُ من وقت البدء — تُقرأ من الجدول لا من نصٍّ مكتوب
--    وتُحتسب الليليةُ بالالتفاف حول منتصف الليل
-- ---------------------------------------------------------------------
create or replace function public.shift_period(p_start time) returns text
language sql stable set search_path = public as $$
  select code from public.duty_periods
   where is_active
     and p_start is not null
     and case when start_at <= end_at
              then p_start >= start_at and p_start < end_at
              else p_start >= start_at or p_start < end_at
         end
   order by sort, start_at
   limit 1
$$;
grant execute on function public.shift_period(time) to authenticated;

comment on function public.shift_period(time) is
  'الفترةُ التي يقع فيها وقتُ البدء، من جدول الفترات (ملاحظة ٢٢٨)';

-- اسمُ الفترة للعرض
create or replace function public.period_label(p_code text) returns text
language sql stable set search_path = public as $$
  select name from public.duty_periods where code = p_code
$$;
grant execute on function public.period_label(text) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) تحريرُ الفترات — لمن له صلاحيةُ الحضور
-- ---------------------------------------------------------------------
create or replace function public.save_duty_period(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_code text := nullif(trim(coalesce(p ->> 'code', '')), '');
        v_name text := nullif(trim(coalesce(p ->> 'name', '')), '');
begin
  if not public.is_admin_for('shifts') then
    raise exception 'تحريرُ الفترات لمن له صلاحيةُ الحضور' using errcode = '42501';
  end if;
  if v_name is null then raise exception 'اكتب اسم الفترة'; end if;
  if (p ->> 'start_at') is null or (p ->> 'end_at') is null then
    raise exception 'حدّد بداية الفترة ونهايتها';
  end if;
  if (p ->> 'start_at')::time = (p ->> 'end_at')::time then
    raise exception 'بدايةُ الفترة ونهايتُها لا تتساويان';
  end if;

  if v_id is null then
    v_code := coalesce(v_code, 'p' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into public.duty_periods (code, name, start_at, end_at, sort, is_active)
      values (v_code, v_name, (p ->> 'start_at')::time, (p ->> 'end_at')::time,
              coalesce((p ->> 'sort')::int, 99), coalesce((p ->> 'is_active')::boolean, true))
      returning id into v_id;
  else
    update public.duty_periods
       set name = v_name,
           start_at = (p ->> 'start_at')::time,
           end_at   = (p ->> 'end_at')::time,
           sort     = coalesce((p ->> 'sort')::int, sort),
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
  end if;
  return v_id;
end $$;
grant execute on function public.save_duty_period(jsonb) to authenticated;

-- لا تُحذف فترةٌ عُلِّقت بها مناوبات: تُعطَّل فتبقى سجلّاتُها مقروءة
create or replace function public.delete_duty_period(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.is_admin_for('shifts') then
    raise exception 'تحريرُ الفترات لمن له صلاحيةُ الحضور' using errcode = '42501';
  end if;
  select code into v_code from public.duty_periods where id = p_id;
  if v_code is null then raise exception 'الفترة غير موجودة'; end if;
  if exists (select 1 from public.profiles where duty_period = v_code) then
    update public.duty_periods set is_active = false where id = p_id;
  else
    delete from public.duty_periods where id = p_id;
  end if;
end $$;
grant execute on function public.delete_duty_period(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) القيادةُ بالأسماء، ومعها فترةُ العضو ونمطُ عمله
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists lead_id     uuid references public.profiles (id) on delete set null,
  add column if not exists lead_kind   text,
  add column if not exists duty_period text,
  add column if not exists work_mode   text not null default 'remote';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_work_mode_check') then
    alter table public.profiles add constraint profiles_work_mode_check
      check (work_mode in ('remote', 'onsite'));
  end if;
end $$;

comment on column public.profiles.duty_period is
  'فترةُ دوام العضو من جدول الفترات (ملاحظة ٢٣٣)';
comment on column public.profiles.work_mode is
  'عن بُعدٍ أو حضوريٌّ — والحضوريُّ وحدَه يُسنَد له موقعٌ وتُولَّد له مناوبات (ملاحظة ٢٢٧)';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_lead_kind_check') then
    alter table public.profiles add constraint profiles_lead_kind_check
      check (lead_kind is null or lead_kind in ('field', 'translation'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_lead_self_check') then
    alter table public.profiles add constraint profiles_lead_self_check
      check (lead_id is null or lead_id <> id);
  end if;
end $$;

create index if not exists profiles_lead_idx on public.profiles (lead_id);

comment on column public.profiles.lead_id is
  'قائدُ هذا العضو — واحدٌ لا غير (ملاحظة ٢٢٨)';
comment on column public.profiles.lead_kind is
  'صفةُ القيادة: ميدانيٌّ أو مشرفُ فريق ترجمة — ومن لا يقود فلا صفةَ له';

-- من كان في دوره قائدًا ميدانيًّا فهو قائدٌ وإن لم تُضبط صفتُه بعد
create or replace function public.is_field_lead()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and status = 'active'
                    and (role = 'field_lead' or lead_kind = 'field'))
$$;
grant execute on function public.is_field_lead() to authenticated;

create or replace function public.is_team_lead()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and status = 'active'
                    and (role = 'field_lead' or lead_kind is not null))
$$;
grant execute on function public.is_team_lead() to authenticated;

-- نطاقي: من أُسنِد إليّ بعينه
create or replace function public.in_my_lead_scope(p_member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = p_member and lead_id = auth.uid())
$$;
grant execute on function public.in_my_lead_scope(uuid) to authenticated;

-- فريقي
create or replace function public.my_team_members()
returns table (id uuid, full_name text, role text, track text, city text,
               duty_period text, work_mode text, site_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role::text, p.track, p.city,
         p.duty_period, p.work_mode, p.site_id
    from public.profiles p
   where p.lead_id = auth.uid() and p.status <> 'disabled'
   order by p.full_name
$$;
grant execute on function public.my_team_members() to authenticated;

-- الاسمُ القديم يبقى عاملًا فلا ينكسر ما بُني عليه، وأعمدتُه تبدّلت فيُسقط أولًا
drop function if exists public.my_field_team();
create or replace function public.my_field_team()
returns table (id uuid, full_name text, role text, track text, city text,
               duty_period text, work_mode text, site_id uuid)
language sql stable security definer set search_path = public as $$
  select * from public.my_team_members()
$$;
grant execute on function public.my_field_team() to authenticated;

-- ---------------------------------------------------------------------
-- ٥) إسنادُ العضو إلى قائده — بيد مدير المشروع والمنسقين
-- ---------------------------------------------------------------------
create or replace function public.set_member_lead(p_member uuid, p_lead uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_kind text; v_role text;
begin
  if not public.is_admin_for('team') then
    raise exception 'إسنادُ القائد لمن له صلاحيةُ الفريق' using errcode = '42501';
  end if;
  if p_member is null then raise exception 'حدّد العضو'; end if;
  if p_member = p_lead then raise exception 'لا يقود العضوُ نفسَه'; end if;
  if not exists (select 1 from public.profiles where id = p_member) then
    raise exception 'العضو غير موجود';
  end if;

  if p_lead is not null then
    select lead_kind, role::text into v_kind, v_role from public.profiles where id = p_lead;
    if v_role is null then raise exception 'القائد غير موجود'; end if;
    if v_kind is null and v_role <> 'field_lead' then
      raise exception 'هذا العضو ليس قائدًا — عيّنه قائدًا أولًا';
    end if;
  end if;

  -- عمودٌ واحد، فالنقلُ إلى قائدٍ يُخرجه من فريق الأول من نفسه
  update public.profiles set lead_id = p_lead where id = p_member;
end $$;
grant execute on function public.set_member_lead(uuid, uuid) to authenticated;

-- تعيينُ قائدٍ: ميدانيٌّ بدوره، أو مشرفُ فريق ترجمةٍ من المترجمين أنفسهم
create or replace function public.set_lead_kind(p_member uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text; v_track text;
begin
  if not public.is_manager() then
    raise exception 'تعيينُ القادة لمدير المشروع' using errcode = '42501';
  end if;
  if p_kind is not null and p_kind not in ('field', 'translation') then
    raise exception 'صفةُ قيادةٍ غير معروفة';
  end if;
  select role::text, track into v_role, v_track from public.profiles where id = p_member;
  if v_role is null then raise exception 'العضو غير موجود'; end if;

  if p_kind = 'translation' and coalesce(v_track, 'translation') <> 'translation' then
    raise exception 'مشرفُ فريق الترجمة يكون من المترجمين';
  end if;
  if p_kind = 'field' and v_role <> 'field_lead' then
    raise exception 'القيادةُ الميدانية لمن دورُه قائدُ فريقٍ ميداني';
  end if;

  update public.profiles set lead_kind = p_kind where id = p_member;
  -- من رُفعت عنه الصفةُ تفرّق فريقُه فيُعاد إسنادُهم
  if p_kind is null then
    update public.profiles set lead_id = null where lead_id = p_member;
  end if;
end $$;
grant execute on function public.set_lead_kind(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) القادةُ وفِرقُهم، ومن لا قائدَ له
-- ---------------------------------------------------------------------
-- القائمةُ كاملةً للإداريين، ولغيرهم نفسُه فقط
create or replace function public.lead_teams()
returns table (lead_id uuid, lead_name text, lead_kind text, lead_role text,
               city text, members int)
language sql stable security definer set search_path = public as $$
  select l.id, l.full_name, l.lead_kind, l.role::text, l.city,
         (select count(*)::int from public.profiles m
           where m.lead_id = l.id and m.status <> 'disabled')
    from public.profiles l
   where (l.lead_kind is not null or l.role = 'field_lead')
     and (public.is_admin() or l.id = auth.uid())
   order by l.lead_kind nulls last, l.full_name
$$;
grant execute on function public.lead_teams() to authenticated;

-- من لا قائدَ له من الحضوريين وأهلِ الميدان
create or replace function public.members_without_lead()
returns table (id uuid, full_name text, role text, track text, city text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role::text, p.track, p.city
    from public.profiles p
   where public.is_admin()
     and p.status = 'active'
     and p.lead_id is null
     and p.lead_kind is null
     and p.role not in ('manager', 'coordinator', 'supervisor', 'field_lead')
   order by p.track, p.city nulls last, p.full_name
$$;
grant execute on function public.members_without_lead() to authenticated;

-- ---------------------------------------------------------------------
-- ٧) من خرج من دور القيادة تفرّق فريقُه
-- ---------------------------------------------------------------------
create or replace function public.drop_lead_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role::text <> 'field_lead' and new.lead_kind = 'field' then
    new.lead_kind := null;
  end if;
  if new.role::text <> 'field_lead' and (new.lead_city is not null or new.lead_period is not null) then
    new.lead_city := null; new.lead_period := null;
  end if;
  if new.lead_kind is null and old.lead_kind is not null then
    update public.profiles set lead_id = null where lead_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists profiles_drop_lead_scope on public.profiles;
create trigger profiles_drop_lead_scope
  before update of role, lead_kind on public.profiles
  for each row execute function public.drop_lead_scope();

notify pgrst, 'reload schema';
