-- =====================================================================
-- 0042 — قاعات الاجتماعات والتدريب (ملاحظة ١٦٣، المرحلة الأولى)
--   قاعاتٌ مسمّاة لها جدول، ولقاءاتٌ بمواعيدها ومدعوّيها ودعواتها،
--   وزرُّ انضمامٍ في وقته، وسجلُّ حضورٍ يُبنى عليه لاحقًا.
--   ومجرى الصوت والصورة في هذه المرحلة رابطٌ خارجي يلصقه المنظِّم،
--   ويصير خيارًا داخليًّا حين نستضيف خادم اللقاءات عندنا.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) القاعات: اسمٌ وسعة وجدول
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  capacity    int not null default 25 check (capacity between 2 and 1000),
  is_active   boolean not null default true,
  sort        int not null default 0,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);

comment on table public.rooms is 'قاعات الاجتماعات والتدريب: اسمها وسعتها وجدولها (ملاحظة ١٦٣)';

alter table public.rooms enable row level security;
drop policy if exists "read rooms" on public.rooms;
create policy "read rooms" on public.rooms for select using (public.my_role() is not null);

insert into public.rooms (name, description, capacity, sort) values
  ('قاعة التدريب',    'الدورات التدريبية وورش العمل لفريق الترجمة', 40, 1),
  ('قاعة الاجتماعات', 'اجتماعات الإدارة والمنسقين',                 25, 2)
on conflict (name) do nothing;

create or replace function public.save_room(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_cap int := coalesce((p ->> 'capacity')::int, 25);
begin
  if not public.is_admin() then
    raise exception 'إدارة القاعات للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p ->> 'name', '')), '') is null then raise exception 'اكتب اسم القاعة'; end if;
  if v_cap < 2 or v_cap > 1000 then raise exception 'سعة القاعة بين ٢ و١٠٠٠'; end if;

  if v_id is null then
    insert into public.rooms (name, description, capacity, sort, created_by)
    values (trim(p ->> 'name'), nullif(trim(coalesce(p ->> 'description', '')), ''), v_cap,
            coalesce((p ->> 'sort')::int, 0), auth.uid())
    returning id into v_id;
  else
    update public.rooms
       set name = trim(p ->> 'name'),
           description = nullif(trim(coalesce(p ->> 'description', '')), ''),
           capacity = v_cap,
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
    if not found then raise exception 'القاعة غير موجودة'; end if;
  end if;
  return v_id;
end $$;

grant execute on function public.save_room(jsonb) to authenticated;

create or replace function public.delete_room(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'حذف القاعة لمدير المشروع' using errcode = '42501';
  end if;
  if exists (select 1 from public.meetings where room_id = p_id and starts_at > now() and status = 'scheduled') then
    raise exception 'في القاعة لقاءات قادمة — ألغها أو انقلها أولًا';
  end if;
  delete from public.rooms where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- ٢) اللقاءات: دورة أو اجتماع أو ورشة
-- ---------------------------------------------------------------------
create table if not exists public.meetings (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid references public.rooms (id) on delete set null,
  title       text not null,
  kind        text not null default 'اجتماع' check (kind in ('دورة تدريبية', 'اجتماع', 'ورشة عمل', 'أخرى')),
  starts_at   timestamptz not null,
  minutes     int not null default 60 check (minutes between 5 and 720),
  description text,
  provider    text not null default 'external' check (provider in ('external', 'internal')),
  join_url    text,
  status      text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'done')),
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create index if not exists meetings_when_idx on public.meetings (starts_at desc);

comment on table public.meetings is 'لقاءات القاعات: دورة أو اجتماع أو ورشة بموعدها ومدتها ورابط انضمامها (ملاحظة ١٦٣)';

create table if not exists public.meeting_invitees (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  member_id  uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz,
  last_seen  timestamptz,
  seconds    int not null default 0,
  primary key (meeting_id, member_id)
);

comment on table public.meeting_invitees is 'المدعوّون وحضورهم: متى دخل وكم بقي (ملاحظة ١٦٣)';

alter table public.meetings enable row level security;
alter table public.meeting_invitees enable row level security;

-- المدعوّ يرى لقاءه، والإدارة ترى الجميع — ومشرف الهيئة مدعوٌّ كغيره.
-- الفحص في دالة تتخطّى سياسات الصفوف، فلا يستدعي الجدولان أحدهما الآخر بلا نهاية.
create or replace function public.can_see_meeting(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.meetings m where m.id = p_id and m.created_by = auth.uid())
      or exists (select 1 from public.meeting_invitees i
                  where i.meeting_id = p_id and i.member_id = auth.uid())
$$;

grant execute on function public.can_see_meeting(uuid) to authenticated;

drop policy if exists "see meetings" on public.meetings;
create policy "see meetings" on public.meetings for select using (public.can_see_meeting(id));

drop policy if exists "see invitees" on public.meeting_invitees;
create policy "see invitees" on public.meeting_invitees for select
  using (member_id = auth.uid() or public.can_see_meeting(meeting_id));

-- ---------------------------------------------------------------------
-- ٣) جدولة اللقاء: لا يتعارض لقاءان في قاعة واحدة
-- ---------------------------------------------------------------------
create or replace function public.save_meeting(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_room uuid := nullif(p ->> 'room_id', '')::uuid;
        v_start timestamptz := (p ->> 'starts_at')::timestamptz;
        v_min int := coalesce((p ->> 'minutes')::int, 60);
        v_prov text := coalesce(nullif(p ->> 'provider', ''), 'external');
        v_url text := nullif(trim(coalesce(p ->> 'join_url', '')), '');
        v_who uuid; v_cap int; v_n int; v_title text;
begin
  if not public.is_admin() then
    raise exception 'جدولة اللقاءات للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  v_title := nullif(trim(coalesce(p ->> 'title', '')), '');
  if v_title is null then raise exception 'اكتب عنوان اللقاء'; end if;
  if v_start is null then raise exception 'حدّد موعد اللقاء'; end if;
  if v_min < 5 or v_min > 720 then raise exception 'مدة اللقاء بين ٥ دقائق و١٢ ساعة'; end if;
  if v_prov = 'external' and v_url is null then
    raise exception 'ألصق رابط الانضمام، أو اختر القاعة الداخلية حين تتوفر';
  end if;
  if v_url is not null and v_url !~* '^https://' then
    raise exception 'رابط الانضمام يبدأ بـ https://';
  end if;

  -- القاعة لا تُحجز مرتين في وقت واحد
  if v_room is not null and exists (
       select 1 from public.meetings m
        where m.room_id = v_room and m.status = 'scheduled'
          and (v_id is null or m.id <> v_id)
          and tstzrange(m.starts_at, m.starts_at + make_interval(mins => m.minutes))
              && tstzrange(v_start, v_start + make_interval(mins => v_min))) then
    raise exception 'القاعة محجوزة في هذا الوقت — اختر وقتًا أو قاعة أخرى';
  end if;

  if v_id is null then
    insert into public.meetings (room_id, title, kind, starts_at, minutes, description, provider, join_url, created_by)
    values (v_room, v_title, coalesce(nullif(p ->> 'kind', ''), 'اجتماع'), v_start, v_min,
            nullif(trim(coalesce(p ->> 'description', '')), ''), v_prov, v_url, auth.uid())
    returning id into v_id;
  else
    update public.meetings
       set room_id = v_room, title = v_title, kind = coalesce(nullif(p ->> 'kind', ''), kind),
           starts_at = v_start, minutes = v_min,
           description = nullif(trim(coalesce(p ->> 'description', '')), ''),
           provider = v_prov, join_url = v_url, updated_at = now()
     where id = v_id and status <> 'cancelled';
    if not found then raise exception 'اللقاء غير موجود أو ملغًى'; end if;
  end if;

  -- المدعوّون: تُستبدل القائمة كاملةً، ويُحفظ حضور من دخل
  if p ? 'invitees' then
    delete from public.meeting_invitees i
     where i.meeting_id = v_id and i.joined_at is null
       and not (i.member_id::text in (select jsonb_array_elements_text(p -> 'invitees')));
    for v_who in select (jsonb_array_elements_text(p -> 'invitees'))::uuid loop
      insert into public.meeting_invitees (meeting_id, member_id)
      select v_id, v_who
       where exists (select 1 from public.profiles pr where pr.id = v_who and pr.status = 'active')
      on conflict do nothing;
    end loop;
  end if;

  -- السعة تُنبَّه ولا تُمنع: القاعة الخارجية قد تتسع لأكثر
  select r.capacity into v_cap from public.rooms r where r.id = v_room;
  select count(*) into v_n from public.meeting_invitees where meeting_id = v_id;
  if v_cap is not null and v_n > v_cap then
    raise warning 'عدد المدعوّين (%) يتجاوز سعة القاعة (%)', v_n, v_cap;
  end if;

  -- الدعوة: تصل كل مدعوّ في بريده
  insert into public.notifications (member_id, kind, subject, body)
  select i.member_id, 'assigned',
         'دعوة: ' || v_title,
         'دُعيت إلى ' || coalesce(nullif(p ->> 'kind', ''), 'اجتماع') || ' بعنوان «' || v_title || '»، '
         || 'يوم ' || to_char(v_start at time zone 'Asia/Riyadh', 'YYYY-MM-DD') || ' الساعة '
         || to_char(v_start at time zone 'Asia/Riyadh', 'HH24:MI') || ' بتوقيت الرياض، ومدته '
         || v_min || ' دقيقة. وزرّ الانضمام يظهر في المنصة قبل الموعد بربع ساعة.'
    from public.meeting_invitees i
   where i.meeting_id = v_id and i.joined_at is null;

  return v_id;
end $$;

grant execute on function public.save_meeting(jsonb) to authenticated;

create or replace function public.cancel_meeting(p_id uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'إلغاء اللقاء للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  update public.meetings set status = case when p_on then 'cancelled' else 'scheduled' end, updated_at = now()
   where id = p_id;
  if not found then raise exception 'اللقاء غير موجود'; end if;
end $$;

grant execute on function public.cancel_meeting(uuid, boolean) to authenticated;

create or replace function public.delete_meeting(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'حذف اللقاء لمدير المشروع' using errcode = '42501';
  end if;
  delete from public.meetings where id = p_id;
end $$;

grant execute on function public.delete_meeting(uuid) to authenticated;
grant execute on function public.delete_room(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) الانضمام: في وقته، ولمن دُعي — ويُقيَّد حضوره
-- ---------------------------------------------------------------------
create or replace function public.join_meeting(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_m public.meetings; v_ok boolean;
begin
  select * into v_m from public.meetings where id = p_id;
  if v_m.id is null then raise exception 'اللقاء غير موجود'; end if;
  if v_m.status <> 'scheduled' then raise exception 'اللقاء ملغًى'; end if;

  select exists (select 1 from public.meeting_invitees i
                  where i.meeting_id = p_id and i.member_id = auth.uid())
      or v_m.created_by = auth.uid() or public.is_admin() into v_ok;
  if not v_ok then raise exception 'لم تُدعَ إلى هذا اللقاء' using errcode = '42501'; end if;

  -- يُفتح قبل الموعد بربع ساعة، ويبقى مفتوحًا نصف ساعة بعد انتهائه
  if now() < v_m.starts_at - interval '15 minutes' then
    raise exception 'لم يحن وقت اللقاء بعد';
  end if;
  if now() > v_m.starts_at + make_interval(mins => v_m.minutes) + interval '30 minutes' then
    raise exception 'انتهى وقت اللقاء';
  end if;

  insert into public.meeting_invitees (meeting_id, member_id, joined_at, last_seen)
  values (p_id, auth.uid(), now(), now())
  on conflict (meeting_id, member_id) do update
    set joined_at = coalesce(public.meeting_invitees.joined_at, now()), last_seen = now();

  return v_m.join_url;
end $$;

grant execute on function public.join_meeting(uuid) to authenticated;

-- نبضة حضور: تُحدّث المدة كل دقيقة ما دام اللقاء مفتوحًا
create or replace function public.meeting_ping(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.meeting_invitees
     set seconds = seconds + least(greatest(extract(epoch from (now() - coalesce(last_seen, now())))::int, 0), 180),
         last_seen = now()
   where meeting_id = p_id and member_id = auth.uid() and joined_at is not null;
end $$;

grant execute on function public.meeting_ping(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٥) صفٌّ جاهز للشاشة: اللقاء بقاعته ومدعوّيه وحال المستخدم منه
-- ---------------------------------------------------------------------
create or replace view public.meeting_rows with (security_invoker = true) as
select m.*,
       r.name as room_name,
       r.capacity as room_capacity,
       p.full_name as organizer,
       (select count(*) from public.meeting_invitees i where i.meeting_id = m.id)                      as invited,
       (select count(*) from public.meeting_invitees i where i.meeting_id = m.id and i.joined_at is not null) as attended,
       exists (select 1 from public.meeting_invitees i
                where i.meeting_id = m.id and i.member_id = auth.uid())                                as i_am_invited,
       m.starts_at + make_interval(mins => m.minutes)                                                  as ends_at
  from public.meetings m
  left join public.rooms r on r.id = m.room_id
  left join public.profiles p on p.id = m.created_by;

comment on view public.meeting_rows is 'اللقاء بقاعته ومنظِّمه وعدد مدعوّيه وحاضريه (ملاحظة ١٦٣)';

notify pgrst, 'reload schema';
