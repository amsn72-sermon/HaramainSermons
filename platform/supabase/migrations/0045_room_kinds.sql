-- =====================================================================
-- 0045 — القاعات نوعان: اجتماعات وتدريب (ملاحظة ١٦٧)
--   تُدخل الشاشة ببطاقتين كبيرتين، ولكل نوع قاعاته ولقاءاته.
-- =====================================================================

alter table public.rooms
  add column if not exists kind text not null default 'meeting';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_kind_check') then
    alter table public.rooms add constraint rooms_kind_check check (kind in ('meeting', 'training'));
  end if;
end $$;

comment on column public.rooms.kind
  is 'نوع القاعة: meeting اجتماعات، training تدريب (ملاحظة ١٦٧)';

update public.rooms set kind = 'training' where name = 'قاعة التدريب';

create or replace function public.save_room(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_cap int := coalesce((p ->> 'capacity')::int, 25);
        v_url text := nullif(trim(coalesce(p ->> 'join_url', '')), '');
        v_kind text := coalesce(nullif(p ->> 'kind', ''), 'meeting');
begin
  if not public.is_admin() then
    raise exception 'إدارة القاعات للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p ->> 'name', '')), '') is null then raise exception 'اكتب اسم القاعة'; end if;
  if v_cap < 2 or v_cap > 1000 then raise exception 'سعة القاعة بين ٢ و١٠٠٠'; end if;
  if v_kind not in ('meeting', 'training') then raise exception 'نوع القاعة غير معروف'; end if;
  if v_url is not null and v_url !~* '^https://' then
    raise exception 'رابط القاعة يبدأ بـ https://';
  end if;

  if v_id is null then
    insert into public.rooms (name, description, capacity, join_url, kind, sort, created_by)
    values (trim(p ->> 'name'), nullif(trim(coalesce(p ->> 'description', '')), ''), v_cap, v_url, v_kind,
            coalesce((p ->> 'sort')::int, 0), auth.uid())
    returning id into v_id;
  else
    update public.rooms
       set name = trim(p ->> 'name'),
           description = nullif(trim(coalesce(p ->> 'description', '')), ''),
           capacity = v_cap,
           join_url = v_url,
           kind = v_kind,
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
    if not found then raise exception 'القاعة غير موجودة'; end if;
  end if;
  return v_id;
end $$;

-- صفّ اللقاء يحمل نوع قاعته، فتُصنَّف اللقاءات بالبطاقتين
create or replace view public.meeting_rows with (security_invoker = true) as
-- العمود الجديد في آخر القائمة، فيقبله create or replace بلا إعادة بناء
select m.*,
       r.name as room_name,
       r.capacity as room_capacity,
       p.full_name as organizer,
       (select count(*) from public.meeting_invitees i where i.meeting_id = m.id)                      as invited,
       (select count(*) from public.meeting_invitees i where i.meeting_id = m.id and i.joined_at is not null) as attended,
       exists (select 1 from public.meeting_invitees i
                where i.meeting_id = m.id and i.member_id = auth.uid())                                as i_am_invited,
       m.starts_at + make_interval(mins => m.minutes)                                                  as ends_at,
       coalesce(r.kind, 'meeting') as room_kind
  from public.meetings m
  left join public.rooms r on r.id = m.room_id
  left join public.profiles p on p.id = m.created_by;

notify pgrst, 'reload schema';
