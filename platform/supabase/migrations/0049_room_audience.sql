-- =====================================================================
-- 0049 — لكل فريقٍ قاعاته (ملاحظة ١٧٧)
--   قاعات الترجمة التخصصية لا يراها إلا المترجمون المتخصصون،
--   وقاعات الإرشاد المكاني لا يراها إلا المرشدون.
--   ومدير المشروع ومدير المشروع من الهيئة والمنسقون يرون الجميع.
-- =====================================================================

alter table public.rooms
  add column if not exists audience text not null default 'all';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_audience_check') then
    alter table public.rooms add constraint rooms_audience_check
      check (audience in ('all', 'translation', 'field'));
  end if;
end $$;

comment on column public.rooms.audience
  is 'جمهور القاعة: all للجميع، translation للترجمة التخصصية، field للإرشاد المكاني (ملاحظة ١٧٧)';

-- من يرى هذه القاعة؟ الإدارة ترى الجميع، وكلُّ فريقٍ يرى قاعاته وما هو للجميع
create or replace function public.can_see_room(p_audience text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() or public.is_supervisor() then true
    when coalesce(p_audience, 'all') = 'all' then true
    when p_audience = 'translation' then
      exists (select 1 from public.profiles p
               where p.id = auth.uid() and p.status = 'active'
                 and coalesce(p.track, 'translation') = 'translation')
    when p_audience = 'field' then
      exists (select 1 from public.profiles p
               where p.id = auth.uid() and p.status = 'active' and p.track = 'field')
    else false
  end;
$$;
grant execute on function public.can_see_room(text) to authenticated;

drop policy if exists "read rooms" on public.rooms;
create policy "read rooms" on public.rooms for select to authenticated
  using (public.can_see_room(audience));

-- حفظ القاعة يقبل جمهورها
create or replace function public.save_room(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_cap int := coalesce((p ->> 'capacity')::int, 25);
        v_url text := nullif(trim(coalesce(p ->> 'join_url', '')), '');
        v_kind text := coalesce(nullif(p ->> 'kind', ''), 'meeting');
        v_aud text := coalesce(nullif(p ->> 'audience', ''), 'all');
begin
  if not public.is_admin_for('rooms') then
    raise exception 'إدارة القاعات للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p ->> 'name', '')), '') is null then raise exception 'اكتب اسم القاعة'; end if;
  if v_cap < 2 or v_cap > 1000 then raise exception 'سعة القاعة بين ٢ و١٠٠٠'; end if;
  if v_kind not in ('meeting', 'training') then raise exception 'نوع القاعة غير معروف'; end if;
  if v_aud not in ('all', 'translation', 'field') then raise exception 'جمهور القاعة غير معروف'; end if;
  if v_url is not null and v_url !~* '^https://' then
    raise exception 'رابط القاعة يبدأ بـ https://';
  end if;

  if v_id is null then
    insert into public.rooms (name, description, capacity, join_url, kind, audience, sort, created_by)
    values (trim(p ->> 'name'), nullif(trim(coalesce(p ->> 'description', '')), ''), v_cap, v_url,
            v_kind, v_aud, coalesce((p ->> 'sort')::int, 0), auth.uid())
    returning id into v_id;
  else
    update public.rooms
       set name = trim(p ->> 'name'),
           description = nullif(trim(coalesce(p ->> 'description', '')), ''),
           capacity = v_cap,
           join_url = v_url,
           kind = v_kind,
           audience = v_aud,
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
    if not found then raise exception 'القاعة غير موجودة'; end if;
  end if;
  return v_id;
end $$;

-- صفّ اللقاء يحمل جمهور قاعته أيضًا
create or replace view public.meeting_rows with (security_invoker = true) as
select m.*,
       r.name as room_name,
       r.capacity as room_capacity,
       p.full_name as organizer,
       (select count(*) from public.meeting_invitees i where i.meeting_id = m.id)                      as invited,
       (select count(*) from public.meeting_invitees i where i.meeting_id = m.id and i.joined_at is not null) as attended,
       exists (select 1 from public.meeting_invitees i
                where i.meeting_id = m.id and i.member_id = auth.uid())                                as i_am_invited,
       m.starts_at + make_interval(mins => m.minutes)                                                  as ends_at,
       coalesce(r.kind, 'meeting') as room_kind,
       coalesce(r.audience, 'all') as room_audience
  from public.meetings m
  left join public.rooms r on r.id = m.room_id
  left join public.profiles p on p.id = m.created_by;

-- ---------------------------------------------------------------------
-- القاعات الأربع: لكل فريقٍ اجتماعُه وتدريبُه
-- ---------------------------------------------------------------------
insert into public.rooms (name, description, capacity, kind, audience, join_url, sort)
values
  ('قاعة اجتماعات الترجمة التخصصية', 'اجتماعات فريق الترجمة التخصصية', 40, 'meeting', 'translation',
   'https://meet.jit.si/haramain-ijtimaa-tarjamah-1447', 3),
  ('قاعة تدريب الترجمة التخصصية', 'دورات وورش فريق الترجمة التخصصية', 40, 'training', 'translation',
   'https://meet.jit.si/haramain-tadreeb-tarjamah-1447', 4),
  ('قاعة اجتماعات الإرشاد المكاني', 'اجتماعات فريق الإرشاد المكاني', 40, 'meeting', 'field',
   'https://meet.jit.si/haramain-ijtimaa-irshad-1447', 5),
  ('قاعة تدريب الإرشاد المكاني', 'دورات وورش فريق الإرشاد المكاني', 40, 'training', 'field',
   'https://meet.jit.si/haramain-tadreeb-irshad-1447', 6)
on conflict (name) do nothing;

notify pgrst, 'reload schema';
