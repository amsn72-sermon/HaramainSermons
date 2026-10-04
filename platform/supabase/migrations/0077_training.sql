-- =====================================================================
-- 0077 — التدريبُ على الترجمة ومكتبةُ مواده (ملاحظة ٢٣٢)
--
--   التدريبُ داخل قاعات التدريب لا في قائمةٍ مستقلة: خططٌ لها أهدافُها
--   ووحداتُها ومدّتُها، ومدرِّبون من خبراء المترجمين أنفسهم، وسجلُّ تأهيلٍ
--   لكلِّ عضو. ومعها مكتبةُ موادَّ تُرفع فيها ملفاتُ PDF وPowerPoint،
--   تُشارَك من الإدارة إلى العضو أو إلى قاعةٍ بعينها، ولكلِّ مشاركةٍ
--   مفتاحٌ: يُتاح التنزيلُ أو تكون للمشاهدة فقط.
--
--   وحدُّ «المنع» مبيَّنٌ لا مُدَّعًى: يُمنع زرُّ التنزيل، ويُقصَّر أجلُ
--   الرابط، ويُوسَم المعروضُ باسم قارئه فيُعرف ناقله — وأمّا تصويرُ
--   الشاشة فلا يمنعه متصفحٌ في الدنيا.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) المدرِّبون: من المترجمين الخبراء أنفسهم
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_trainer boolean not null default false;

comment on column public.profiles.is_trainer is
  'مدرِّبٌ من خبراء الفريق — يُعدّ الخطط ويرفع المواد ويدرّب (ملاحظة ٢٣٢)';

create or replace function public.is_trainer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and status = 'active' and is_trainer)
$$;
grant execute on function public.is_trainer() to authenticated;

create or replace function public.set_member_trainer(p_member uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('team') then
    raise exception 'تعيينُ المدرِّبين لمن له صلاحيةُ الفريق' using errcode = '42501';
  end if;
  update public.profiles set is_trainer = coalesce(p_on, false) where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
end $$;
grant execute on function public.set_member_trainer(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) خطةُ التدريب ووحداتُها
-- ---------------------------------------------------------------------
create table if not exists public.training_plans (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  goal       text,
  audience   text,
  level      text not null default 'onboarding'
             check (level in ('onboarding', 'development', 'specialized')),
  hours      numeric(5,1),
  is_active  boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
alter table public.training_plans enable row level security;
drop policy if exists "read plans" on public.training_plans;
create policy "read plans" on public.training_plans
  for select using (public.my_role() is not null);
grant select on public.training_plans to authenticated;

comment on table public.training_plans is
  'خططُ التدريب على الترجمة: هدفُها ومدّتُها وجمهورُها (ملاحظة ٢٣٢)';

create table if not exists public.training_units (
  id       uuid primary key default gen_random_uuid(),
  plan_id  uuid not null references public.training_plans (id) on delete cascade,
  title    text not null,
  outline  text,
  hours    numeric(5,1),
  sort     int not null default 0
);
create index if not exists training_units_plan_idx on public.training_units (plan_id, sort);
alter table public.training_units enable row level security;
drop policy if exists "read units" on public.training_units;
create policy "read units" on public.training_units
  for select using (public.my_role() is not null);
grant select on public.training_units to authenticated;

create or replace function public.may_train()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_trainer()
$$;
grant execute on function public.may_train() to authenticated;

create or replace function public.save_training_plan(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_title text := nullif(trim(coalesce(p ->> 'title', '')), '');
        v_row jsonb; v_n int := 0;
begin
  if not public.may_train() then
    raise exception 'إعدادُ خطط التدريب للإدارة وللمدرِّبين' using errcode = '42501';
  end if;
  if v_title is null then raise exception 'اكتب عنوان الخطة'; end if;

  if v_id is null then
    insert into public.training_plans (title, goal, audience, level, hours, created_by)
    values (v_title, nullif(trim(coalesce(p ->> 'goal', '')), ''),
            nullif(trim(coalesce(p ->> 'audience', '')), ''),
            coalesce(nullif(trim(coalesce(p ->> 'level', '')), ''), 'onboarding'),
            nullif(p ->> 'hours', '')::numeric, auth.uid())
    returning id into v_id;
  else
    update public.training_plans
       set title = v_title,
           goal = nullif(trim(coalesce(p ->> 'goal', '')), ''),
           audience = nullif(trim(coalesce(p ->> 'audience', '')), ''),
           level = coalesce(nullif(trim(coalesce(p ->> 'level', '')), ''), level),
           hours = nullif(p ->> 'hours', '')::numeric,
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
    if not found then raise exception 'الخطة غير موجودة'; end if;
  end if;

  if p ? 'units' then
    delete from public.training_units where plan_id = v_id;
    for v_row in select * from jsonb_array_elements(coalesce(p -> 'units', '[]'::jsonb)) loop
      v_n := v_n + 1;
      if nullif(trim(coalesce(v_row ->> 'title', '')), '') is not null then
        insert into public.training_units (plan_id, title, outline, hours, sort)
        values (v_id, btrim(v_row ->> 'title'),
                nullif(trim(coalesce(v_row ->> 'outline', '')), ''),
                nullif(v_row ->> 'hours', '')::numeric, v_n);
      end if;
    end loop;
  end if;
  return v_id;
end $$;
grant execute on function public.save_training_plan(jsonb) to authenticated;

create or replace function public.delete_training_plan(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'حذفُ الخطط للإدارة' using errcode = '42501';
  end if;
  delete from public.training_plans where id = p_id;
end $$;
grant execute on function public.delete_training_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) مكتبةُ المواد
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('training', 'training', false)
on conflict (id) do nothing;

create table if not exists public.training_materials (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid references public.training_plans (id) on delete set null,
  room_id    uuid references public.rooms (id) on delete set null,
  title      text not null,
  kind       text not null default 'pdf' check (kind in ('pdf', 'slides', 'other')),
  file_path  text not null,
  view_path  text,          -- نسخةٌ للعرض في المتصفح حين يُمنع التنزيل
  size_bytes bigint,
  note       text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists training_materials_plan_idx on public.training_materials (plan_id);
alter table public.training_materials enable row level security;
grant select on public.training_materials to authenticated;

comment on table public.training_materials is
  'موادُّ التدريب: PDF وعروضٌ تُشارَك من الإدارة إلى الأعضاء (ملاحظة ٢٣٢)';

create table if not exists public.training_shares (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references public.training_materials (id) on delete cascade,
  member_id     uuid references public.profiles (id) on delete cascade,
  room_id       uuid references public.rooms (id) on delete cascade,
  may_download  boolean not null default false,
  shared_by     uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  constraint training_shares_target check (member_id is not null or room_id is not null)
);
create index if not exists training_shares_member_idx on public.training_shares (member_id);
create index if not exists training_shares_mat_idx    on public.training_shares (material_id);
alter table public.training_shares enable row level security;
grant select on public.training_shares to authenticated;

-- سجلُّ الفتح: من فُتحت له ومن فتحها ومتى
create table if not exists public.training_views (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.training_materials (id) on delete cascade,
  member_id   uuid not null references public.profiles (id) on delete cascade,
  downloaded  boolean not null default false,
  opened_at   timestamptz not null default now()
);
create index if not exists training_views_mat_idx on public.training_views (material_id, opened_at desc);
alter table public.training_views enable row level security;
grant select on public.training_views to authenticated;

-- هل شُورِكت هذه المادةُ معي، وهل يُتاح لي تنزيلُها؟
create or replace function public.my_material_access(p_material uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case
    when public.may_train() then jsonb_build_object('read', true, 'download', true)
    else jsonb_build_object(
      'read', exists (select 1 from public.training_shares s
                       where s.material_id = p_material
                         and (s.expires_at is null or s.expires_at > now())
                         and (s.member_id = auth.uid()
                              or exists (select 1 from public.meeting_invitees a
                                           join public.meetings mt on mt.id = a.meeting_id
                                          where a.member_id = auth.uid() and mt.room_id = s.room_id))),
      'download', exists (select 1 from public.training_shares s
                           where s.material_id = p_material and s.may_download
                             and (s.expires_at is null or s.expires_at > now())
                             and (s.member_id = auth.uid()
                                  or exists (select 1 from public.meeting_invitees a
                                               join public.meetings mt on mt.id = a.meeting_id
                                              where a.member_id = auth.uid() and mt.room_id = s.room_id))))
  end
$$;
grant execute on function public.my_material_access(uuid) to authenticated;

drop policy if exists "read training materials" on public.training_materials;
create policy "read training materials" on public.training_materials for select using (
  public.may_train() or (public.my_material_access(id) ->> 'read')::boolean
);

drop policy if exists "read training shares" on public.training_shares;
create policy "read training shares" on public.training_shares for select using (
  public.may_train() or member_id = auth.uid()
);

drop policy if exists "read training views" on public.training_views;
create policy "read training views" on public.training_views for select using (
  public.may_train() or member_id = auth.uid()
);

drop policy if exists "trainers upload training files" on storage.objects;
create policy "trainers upload training files" on storage.objects for insert
  with check (bucket_id = 'training' and public.may_train());

drop policy if exists "shared read training files" on storage.objects;
create policy "shared read training files" on storage.objects for select using (
  bucket_id = 'training' and (
    public.may_train() or exists (
      select 1 from public.training_materials t
       where (t.file_path = storage.objects.name or t.view_path = storage.objects.name)
         and (public.my_material_access(t.id) ->> 'read')::boolean)
  )
);

-- ---------------------------------------------------------------------
-- ٤) رفعُ المادة ومشاركتُها
-- ---------------------------------------------------------------------
create or replace function public.save_training_material(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_title text := nullif(trim(coalesce(p ->> 'title', '')), '');
begin
  if not public.may_train() then
    raise exception 'رفعُ مواد التدريب للإدارة وللمدرِّبين' using errcode = '42501';
  end if;
  if v_title is null then raise exception 'اكتب عنوان المادة'; end if;

  if v_id is null then
    if nullif(trim(coalesce(p ->> 'file_path', '')), '') is null then
      raise exception 'ارفع الملف أولًا';
    end if;
    insert into public.training_materials (plan_id, room_id, title, kind, file_path,
                                           view_path, size_bytes, note, created_by)
    values (nullif(p ->> 'plan_id', '')::uuid, nullif(p ->> 'room_id', '')::uuid,
            v_title, coalesce(nullif(trim(coalesce(p ->> 'kind', '')), ''), 'pdf'),
            btrim(p ->> 'file_path'), nullif(trim(coalesce(p ->> 'view_path', '')), ''),
            nullif(p ->> 'size_bytes', '')::bigint,
            nullif(trim(coalesce(p ->> 'note', '')), ''), auth.uid())
    returning id into v_id;
  else
    update public.training_materials
       set title = v_title,
           plan_id = nullif(p ->> 'plan_id', '')::uuid,
           room_id = nullif(p ->> 'room_id', '')::uuid,
           note = nullif(trim(coalesce(p ->> 'note', '')), '')
     where id = v_id;
    if not found then raise exception 'المادة غير موجودة'; end if;
  end if;
  return v_id;
end $$;
grant execute on function public.save_training_material(jsonb) to authenticated;

create or replace function public.delete_training_material(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.may_train() then
    raise exception 'حذفُ المواد للإدارة وللمدرِّبين' using errcode = '42501';
  end if;
  delete from public.training_materials where id = p_id;
end $$;
grant execute on function public.delete_training_material(uuid) to authenticated;

-- المشاركة: لعضوٍ بعينه أو لقاعة، ومعها مفتاحُ التنزيل
create or replace function public.share_training_material(p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_mat uuid := nullif(p ->> 'material_id', '')::uuid;
        v_dl boolean := coalesce((p ->> 'may_download')::boolean, false);
        v_room uuid := nullif(p ->> 'room_id', '')::uuid;
        v_m jsonb; v_n int := 0;
begin
  if not public.may_train() then
    raise exception 'مشاركةُ المواد للإدارة وللمدرِّبين' using errcode = '42501';
  end if;
  if v_mat is null then raise exception 'حدّد المادة'; end if;

  if v_room is not null then
    insert into public.training_shares (material_id, room_id, may_download, shared_by,
                                        expires_at)
    values (v_mat, v_room, v_dl, auth.uid(), nullif(p ->> 'expires_at', '')::timestamptz);
    v_n := v_n + 1;
  end if;

  for v_m in select * from jsonb_array_elements(coalesce(p -> 'members', '[]'::jsonb)) loop
    insert into public.training_shares (material_id, member_id, may_download, shared_by,
                                        expires_at)
    values (v_mat, (v_m #>> '{}')::uuid, v_dl, auth.uid(),
            nullif(p ->> 'expires_at', '')::timestamptz);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;
grant execute on function public.share_training_material(jsonb) to authenticated;

create or replace function public.unshare_training_material(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.may_train() then
    raise exception 'المشاركةُ للإدارة وللمدرِّبين' using errcode = '42501';
  end if;
  delete from public.training_shares where id = p_id;
end $$;
grant execute on function public.unshare_training_material(uuid) to authenticated;

-- تسجيلُ الفتح
create or replace function public.log_material_open(p_material uuid, p_download boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if not (public.my_material_access(p_material) ->> 'read')::boolean then
    raise exception 'هذه المادة غير مشارَكةٍ معك' using errcode = '42501';
  end if;
  if p_download and not (public.my_material_access(p_material) ->> 'download')::boolean then
    raise exception 'هذه المادة للمشاهدة فقط' using errcode = '42501';
  end if;
  insert into public.training_views (material_id, member_id, downloaded)
  values (p_material, auth.uid(), coalesce(p_download, false));
end $$;
grant execute on function public.log_material_open(uuid, boolean) to authenticated;

-- ما شُورك معي
create or replace function public.my_training_materials()
returns table (id uuid, title text, kind text, file_path text, view_path text,
               plan_title text, may_download boolean, shared_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.kind, t.file_path, t.view_path, pl.title,
         bool_or(s.may_download), max(s.created_at)
    from public.training_materials t
    join public.training_shares s on s.material_id = t.id
    left join public.training_plans pl on pl.id = t.plan_id
   where (s.expires_at is null or s.expires_at > now())
     and (s.member_id = auth.uid()
          or exists (select 1 from public.meeting_invitees a
                       join public.meetings mt on mt.id = a.meeting_id
                      where a.member_id = auth.uid() and mt.room_id = s.room_id))
   group by t.id, t.title, t.kind, t.file_path, t.view_path, pl.title
   order by max(s.created_at) desc
$$;
grant execute on function public.my_training_materials() to authenticated;

-- ---------------------------------------------------------------------
-- ٥) سجلُّ التأهيل
-- ---------------------------------------------------------------------
create table if not exists public.member_training (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.profiles (id) on delete cascade,
  plan_id    uuid not null references public.training_plans (id) on delete cascade,
  trainer_id uuid references public.profiles (id),
  status     text not null default 'enrolled'
             check (status in ('enrolled', 'in_progress', 'done', 'dropped')),
  started_at date,
  done_at    date,
  note       text,
  created_at timestamptz not null default now(),
  unique (member_id, plan_id)
);
create index if not exists member_training_member_idx on public.member_training (member_id);
alter table public.member_training enable row level security;
drop policy if exists "read member training" on public.member_training;
create policy "read member training" on public.member_training for select using (
  public.may_train() or member_id = auth.uid() or trainer_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = member_training.member_id and p.lead_id = auth.uid())
);
grant select on public.member_training to authenticated;

comment on table public.member_training is
  'سجلُّ تأهيل العضو: ما التحق به من خطط وما أتمّه (ملاحظة ٢٣٢)';

create or replace function public.save_member_training(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_member uuid := nullif(p ->> 'member_id', '')::uuid;
        v_plan uuid := nullif(p ->> 'plan_id', '')::uuid;
begin
  if not public.may_train() then
    raise exception 'سجلُّ التأهيل للإدارة وللمدرِّبين' using errcode = '42501';
  end if;

  if v_id is null then
    if v_member is null or v_plan is null then raise exception 'حدّد العضو والخطة'; end if;
    insert into public.member_training (member_id, plan_id, trainer_id, status,
                                        started_at, done_at, note)
    values (v_member, v_plan,
            coalesce(nullif(p ->> 'trainer_id', '')::uuid, auth.uid()),
            coalesce(nullif(trim(coalesce(p ->> 'status', '')), ''), 'enrolled'),
            nullif(p ->> 'started_at', '')::date, nullif(p ->> 'done_at', '')::date,
            nullif(trim(coalesce(p ->> 'note', '')), ''))
    on conflict (member_id, plan_id) do update
       set trainer_id = excluded.trainer_id, status = excluded.status,
           started_at = excluded.started_at, done_at = excluded.done_at,
           note = excluded.note
    returning id into v_id;
  else
    update public.member_training
       set trainer_id = coalesce(nullif(p ->> 'trainer_id', '')::uuid, trainer_id),
           status = coalesce(nullif(trim(coalesce(p ->> 'status', '')), ''), status),
           started_at = nullif(p ->> 'started_at', '')::date,
           done_at = nullif(p ->> 'done_at', '')::date,
           note = nullif(trim(coalesce(p ->> 'note', '')), '')
     where id = v_id;
    if not found then raise exception 'السجل غير موجود'; end if;
  end if;
  return v_id;
end $$;
grant execute on function public.save_member_training(jsonb) to authenticated;

create or replace function public.delete_member_training(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.may_train() then
    raise exception 'سجلُّ التأهيل للإدارة وللمدرِّبين' using errcode = '42501';
  end if;
  delete from public.member_training where id = p_id;
end $$;
grant execute on function public.delete_member_training(uuid) to authenticated;

create or replace function public.training_record(p_member uuid default null)
returns table (id uuid, member_id uuid, full_name text, plan_id uuid, plan_title text,
               level text, trainer_id uuid, trainer_name text, status text,
               started_at date, done_at date, note text)
language sql stable security definer set search_path = public as $$
  select r.id, r.member_id, p.full_name, r.plan_id, pl.title, pl.level,
         r.trainer_id, tr.full_name, r.status, r.started_at, r.done_at, r.note
    from public.member_training r
    join public.profiles p on p.id = r.member_id
    join public.training_plans pl on pl.id = r.plan_id
    left join public.profiles tr on tr.id = r.trainer_id
   where (p_member is null or r.member_id = p_member)
     and (public.may_train() or r.member_id = auth.uid()
          or r.trainer_id = auth.uid() or p.lead_id = auth.uid())
   order by p.full_name, pl.title
$$;
grant execute on function public.training_record(uuid) to authenticated;

notify pgrst, 'reload schema';
