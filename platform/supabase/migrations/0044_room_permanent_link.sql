-- =====================================================================
-- 0044 — رابطٌ دائم للقاعة (ملاحظة ١٦٦)
--   لكل قاعة رابط جلستها الثابت، كأنها بابٌ لا يتغير. وكل لقاء يُجدوَل
--   فيها يأخذه تلقائيًّا، ويجوز تجاوزه في لقاءٍ بعينه.
-- =====================================================================

alter table public.rooms add column if not exists join_url text;

comment on column public.rooms.join_url
  is 'رابط جلسة القاعة الدائم — يرثه كل لقاء فيها (ملاحظة ١٦٦)';

create or replace function public.save_room(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_cap int := coalesce((p ->> 'capacity')::int, 25);
        v_url text := nullif(trim(coalesce(p ->> 'join_url', '')), '');
begin
  if not public.is_admin() then
    raise exception 'إدارة القاعات للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p ->> 'name', '')), '') is null then raise exception 'اكتب اسم القاعة'; end if;
  if v_cap < 2 or v_cap > 1000 then raise exception 'سعة القاعة بين ٢ و١٠٠٠'; end if;
  if v_url is not null and v_url !~* '^https://' then
    raise exception 'رابط القاعة يبدأ بـ https://';
  end if;

  if v_id is null then
    insert into public.rooms (name, description, capacity, join_url, sort, created_by)
    values (trim(p ->> 'name'), nullif(trim(coalesce(p ->> 'description', '')), ''), v_cap, v_url,
            coalesce((p ->> 'sort')::int, 0), auth.uid())
    returning id into v_id;
  else
    update public.rooms
       set name = trim(p ->> 'name'),
           description = nullif(trim(coalesce(p ->> 'description', '')), ''),
           capacity = v_cap,
           join_url = v_url,
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
    if not found then raise exception 'القاعة غير موجودة'; end if;
  end if;
  return v_id;
end $$;

-- اللقاء يرث رابط قاعته إن لم يُكتب له رابطٌ خاص
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

  -- رابط القاعة الدائم يقوم مقام رابط اللقاء (ملاحظة ١٦٦)
  if v_url is null and v_room is not null then
    select r.join_url into v_url from public.rooms r where r.id = v_room;
  end if;
  if v_prov = 'external' and v_url is null then
    raise exception 'ألصق رابط الانضمام، أو اضبط رابطًا دائمًا للقاعة';
  end if;
  if v_url is not null and v_url !~* '^https://' then
    raise exception 'رابط الانضمام يبدأ بـ https://';
  end if;

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

  select r.capacity into v_cap from public.rooms r where r.id = v_room;
  select count(*) into v_n from public.meeting_invitees where meeting_id = v_id;
  if v_cap is not null and v_n > v_cap then
    raise warning 'عدد المدعوّين (%) يتجاوز سعة القاعة (%)', v_n, v_cap;
  end if;

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

-- والقاعتان المبدئيتان لهما رابطاهما الثابتان
update public.rooms set join_url = 'https://meet.jit.si/haramain-tadreeb-1447'
 where name = 'قاعة التدريب' and join_url is null;
update public.rooms set join_url = 'https://meet.jit.si/haramain-idara-1447'
 where name = 'قاعة الاجتماعات' and join_url is null;

notify pgrst, 'reload schema';
