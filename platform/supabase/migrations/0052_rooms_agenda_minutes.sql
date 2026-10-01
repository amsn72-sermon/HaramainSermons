-- =====================================================================
-- 0052 — القاعات الستّ، ومحاور الاجتماع ومحضره، والتدريب المكرَّر
--   (ملاحظات ١٧٧ و١٨٢ و١٨٣ و١٨٤)
--   • لكل بابٍ ثلاث قاعات: الترجمة التخصصية · الإرشاد المكاني · الإداريون.
--   • ولكل اجتماع محاورُه قبله ومحضرُه بعده، وأمينُ سرٍّ يُسجّل.
--   • والمدعوّ يشاهد ولا يعدّل، ويبقى له بعد الأرشفة.
--   • والتدريب إمّا لمرةٍ واحدة وإمّا مكرَّرًا جلساتٍ في سلسلة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) جمهورٌ ثالث: الإداريون — ومعه القاعات الستّ
-- ---------------------------------------------------------------------
alter table public.rooms drop constraint if exists rooms_audience_check;
alter table public.rooms add constraint rooms_audience_check
  check (audience in ('all', 'translation', 'field', 'admins'));

create or replace function public.can_see_room(p_audience text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() or public.is_supervisor() then true
    when coalesce(p_audience, 'all') = 'all' then true
    when p_audience = 'admins' then false        -- للإدارة وحدها، وقد فُصلت أعلاه
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
  if v_aud not in ('all', 'translation', 'field', 'admins') then raise exception 'جمهور القاعة غير معروف'; end if;
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
           capacity = v_cap, join_url = v_url, kind = v_kind, audience = v_aud,
           is_active = coalesce((p ->> 'is_active')::boolean, is_active)
     where id = v_id;
    if not found then raise exception 'القاعة غير موجودة'; end if;
  end if;
  return v_id;
end $$;

-- القاعتان العامّتان تصيران قاعتَي الإداريين، وتكتمل الستّ
update public.rooms
   set name = 'قاعة اجتماع الإداريين', audience = 'admins',
       description = 'اجتماعات مدير المشروع والمنسقين'
 where name = 'قاعة الاجتماعات';

update public.rooms
   set name = 'قاعة تدريب الإداريين', audience = 'admins',
       description = 'دورات وورش مدير المشروع والمنسقين'
 where name = 'قاعة التدريب';

insert into public.rooms (name, description, capacity, kind, audience, join_url, sort)
values
  ('قاعة اجتماع الإداريين', 'اجتماعات مدير المشروع والمنسقين', 25, 'meeting', 'admins',
   'https://meet.jit.si/haramain-ijtimaa-idara-1447', 1),
  ('قاعة تدريب الإداريين', 'دورات وورش مدير المشروع والمنسقين', 25, 'training', 'admins',
   'https://meet.jit.si/haramain-tadreeb-idara-1447', 2)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- ١ب) القاعات الستّ ثابتةٌ: تُعدَّل بياناتها ولا تُحذف (ملاحظة ١٧٨)
-- ---------------------------------------------------------------------
alter table public.rooms add column if not exists is_fixed boolean not null default false;
comment on column public.rooms.is_fixed is 'قاعةٌ أصليةٌ للفريق: تُعدَّل ولا تُحذف (ملاحظة ١٧٨)';

update public.rooms set is_fixed = true
 where audience in ('translation', 'field', 'admins')
   and kind in ('meeting', 'training');

create or replace function public.delete_room(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_fixed boolean; v_name text; v_n int;
begin
  if not public.is_admin_for('rooms') then
    raise exception 'حذف القاعات للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  select is_fixed, name into v_fixed, v_name from public.rooms where id = p_id;
  if not found then raise exception 'القاعة غير موجودة'; end if;
  if v_fixed then
    raise exception 'قاعة «%» من قاعات الفريق الأصلية: تُعدَّل بياناتها ولا تُحذف', v_name;
  end if;
  select count(*) into v_n from public.meetings
   where room_id = p_id and status = 'scheduled' and starts_at > now();
  if v_n > 0 then
    raise exception 'في «%» % لقاءً قادمًا: انقلها أو ألغِها أولًا', v_name, v_n;
  end if;
  delete from public.rooms where id = p_id;
end $$;
grant execute on function public.delete_room(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) محاور الاجتماع ومحضره
-- ---------------------------------------------------------------------
alter table public.meetings
  add column if not exists agenda        jsonb not null default '[]'::jsonb,
  add column if not exists minutes_doc   jsonb,
  add column if not exists secretary_id  uuid references public.profiles (id),
  add column if not exists chair_id      uuid references public.profiles (id),
  add column if not exists next_meeting_at timestamptz,
  add column if not exists minutes_state text not null default 'none',
  add column if not exists series_id     uuid,
  add column if not exists session_no    int,
  add column if not exists content       jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'meetings_minutes_state_check') then
    alter table public.meetings add constraint meetings_minutes_state_check
      check (minutes_state in ('none', 'draft', 'final'));
  end if;
end $$;

comment on column public.meetings.agenda is 'محاور الاجتماع وبنوده قبل انعقاده (ملاحظة ١٨٢)';
comment on column public.meetings.minutes_doc is 'محضر الاجتماع على الصيغة النموذجية (ملاحظة ١٨٢)';
comment on column public.meetings.secretary_id is 'أمين سرّ الاجتماع: يسجّل النقاط والقرارات';
comment on column public.meetings.series_id is 'سلسلة التدريب المكرَّر: جلساتها تحمل معرّفًا واحدًا (ملاحظة ١٨٤)';
comment on column public.meetings.content is 'المحتوى التدريبي: ملفات وروابط (ملاحظة ١٨٤)';

-- محاور الاجتماع — للمنسق ومدير المشروع وأمين السرّ
create or replace function public.save_agenda(p_id uuid, p_agenda jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_sec uuid;
begin
  select secretary_id into v_sec from public.meetings where id = p_id;
  if not found then raise exception 'الاجتماع غير موجود'; end if;
  if not (public.is_admin_for('rooms') or v_sec = auth.uid()) then
    raise exception 'كتابة المحاور للمنسق وأمين السرّ' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_agenda, '[]'::jsonb)) <> 'array' then
    raise exception 'المحاور قائمةٌ مرقَّمة';
  end if;
  update public.meetings
     set agenda = coalesce(p_agenda, '[]'::jsonb), updated_at = now()
   where id = p_id;
end $$;
grant execute on function public.save_agenda(uuid, jsonb) to authenticated;

-- محضر الاجتماع — يُحفظ مسودةً ثم يُعتمد نهائيًّا
create or replace function public.save_minutes(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
        v_state text := coalesce(nullif(p ->> 'state', ''), 'draft');
        v_sec uuid;
begin
  select secretary_id into v_sec from public.meetings where id = v_id;
  if not found then raise exception 'الاجتماع غير موجود'; end if;
  if not (public.is_admin_for('rooms') or v_sec = auth.uid()) then
    raise exception 'كتابة المحضر للمنسق وأمين السرّ' using errcode = '42501';
  end if;
  if v_state not in ('draft', 'final') then raise exception 'حال المحضر غير معروفة'; end if;
  if v_state = 'final' and not public.is_admin_for('rooms') then
    raise exception 'اعتماد المحضر للمنسق ومدير المشروع' using errcode = '42501';
  end if;

  update public.meetings
     set minutes_doc = p -> 'doc',
         minutes_state = v_state,
         chair_id = coalesce(nullif(p ->> 'chair_id', '')::uuid, chair_id),
         next_meeting_at = nullif(p ->> 'next_meeting_at', '')::timestamptz,
         updated_at = now()
   where id = v_id;
end $$;
grant execute on function public.save_minutes(jsonb) to authenticated;

create or replace function public.set_secretary(p_id uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin_for('rooms') then
    raise exception 'تعيين أمين السرّ للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if p_member is not null and not exists (
       select 1 from public.meeting_invitees i where i.meeting_id = p_id and i.member_id = p_member) then
    raise exception 'أمين السرّ من مدعوّي الاجتماع';
  end if;
  update public.meetings set secretary_id = p_member, updated_at = now() where id = p_id;
  if not found then raise exception 'الاجتماع غير موجود'; end if;
end $$;
grant execute on function public.set_secretary(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) الصفّ الجاهز يحمل المحاور والمحضر وأمين السرّ
-- ---------------------------------------------------------------------
-- الصفّ يُبنى من جديد: أعمدةُ الاجتماع زادت، و«استبدال» الصفّ لا يقبل
-- عمودًا يُدسّ في وسط القائمة
drop view if exists public.meeting_rows;
create view public.meeting_rows with (security_invoker = true) as
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
       coalesce(r.audience, 'all') as room_audience,
       sec.full_name as secretary_name,
       ch.full_name  as chair_name,
       jsonb_array_length(coalesce(m.agenda, '[]'::jsonb)) as agenda_count
  from public.meetings m
  left join public.rooms r on r.id = m.room_id
  left join public.profiles p on p.id = m.created_by
  left join public.profiles sec on sec.id = m.secretary_id
  left join public.profiles ch on ch.id = m.chair_id;

comment on view public.meeting_rows is
  'اللقاء بقاعته ومنظِّمه ومدعوّيه، ومعه أمين سرّه وعدد محاوره (ملاحظتا ١٦٣ و١٨٢)';
grant select on public.meeting_rows to authenticated;

-- ---------------------------------------------------------------------
-- ٤) التدريب المكرَّر: جلساتٌ في سلسلة واحدة
-- ---------------------------------------------------------------------
create or replace function public.save_meeting_series(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_series uuid := gen_random_uuid();
        v_days int := coalesce((p ->> 'days')::int, 1);
        v_start timestamptz := (p ->> 'starts_at')::timestamptz;
        v_ids uuid[] := '{}';
        v_one jsonb; v_id uuid; i int;
begin
  if not public.is_admin_for('rooms') then
    raise exception 'جدولة اللقاءات للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if v_days < 1 or v_days > 60 then raise exception 'عدد الجلسات بين ١ و٦٠'; end if;
  if v_start is null then raise exception 'حدّد موعد الجلسة الأولى'; end if;

  for i in 0 .. v_days - 1 loop
    v_one := (p - 'days') || jsonb_build_object(
      'id', null,
      'starts_at', (v_start + make_interval(days => i))::text,
      'title', case when v_days > 1
                    then (p ->> 'title') || ' — الجلسة ' || (i + 1)::text
                    else (p ->> 'title') end);
    v_id := public.save_meeting(v_one);
    update public.meetings
       set series_id = v_series, session_no = i + 1,
           content = coalesce(p -> 'content', '[]'::jsonb)
     where id = v_id;
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object('series_id', v_series, 'sessions', to_jsonb(v_ids));
end $$;
grant execute on function public.save_meeting_series(jsonb) to authenticated;

-- حذف السلسلة كلها — لمدير المشروع
create or replace function public.delete_series(p_series uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_manager() then
    raise exception 'حذف السلسلة لمدير المشروع' using errcode = '42501';
  end if;
  delete from public.meetings where series_id = p_series;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.delete_series(uuid) to authenticated;

-- ومن دُعي إلى لقاءٍ في قاعةٍ رأى قاعته، وإن لم تكن قاعة فريقه: فالدعوة
-- إذنٌ بها. ولولا ذلك لسقط لقاؤه من بوّابته لأن نوع القاعة يُقرأ منها.
drop policy if exists "read rooms" on public.rooms;
create policy "read rooms" on public.rooms for select to authenticated
  using (
    public.can_see_room(audience)
    or exists (select 1 from public.meeting_invitees i
                join public.meetings m on m.id = i.meeting_id
               where m.room_id = rooms.id and i.member_id = auth.uid())
  );

notify pgrst, 'reload schema';
