-- ---------------------------------------------------------------------
-- 0003: نسخ التسجيل الصوتي المتعددة
-- المترجم أو المراجع يرفع تسجيلًا، ويبقى السابق محفوظًا باسم صاحبه،
-- ومدير المشروع قبل الاعتماد يختار النسخة (أو النسختين) المعتمدة.
-- ---------------------------------------------------------------------

create table if not exists public.track_audios (
  id           uuid primary key default gen_random_uuid(),
  track_id     uuid not null references public.tracks(id) on delete cascade,
  path         text not null,
  uploaded_by  uuid not null references public.profiles(id),
  stage_key    text,
  is_approved  boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists track_audios_track_idx on public.track_audios (track_id, created_at desc);
alter table public.track_audios enable row level security;

-- من يرى المسار يرى تسجيلاته؛ والكتابة عبر الدوال فقط
drop policy if exists "see track audios" on public.track_audios;
create policy "see track audios" on public.track_audios for select
  using (public.can_see_track(track_id) or public.is_admin());

-- نقل التسجيل الحالي (إن وُجد) إلى الجدول الجديد بوصفه النسخة المعتمدة
insert into public.track_audios (track_id, path, uploaded_by, stage_key, is_approved, created_at)
select t.id, t.audio_path, coalesce(s.assignee_id, (select id from public.profiles where role = 'manager' limit 1)),
       t.audio_stage_key, true, now()
from public.tracks t
left join public.track_stages s on s.track_id = t.id and s.stage_key = t.audio_stage_key
where t.audio_path is not null
  and not exists (select 1 from public.track_audios a where a.track_id = t.id);

-- ---------------------------------------------------------------------
-- رفع نسخة جديدة: تُضاف ولا تُحذف السابقة، وتصبح هي المعروضة حتى الاعتماد
-- ---------------------------------------------------------------------
create or replace function public.set_track_audio(p_track uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.track_stages;
begin
  v_s := public.current_stage(p_track);
  if v_s.id is null or v_s.assignee_id is distinct from auth.uid() then
    raise exception 'رفع التسجيل متاح لمسؤول المرحلة الحالية فقط' using errcode = '42501';
  end if;
  if (select audio_stage_key from public.tracks where id = p_track) is null then
    raise exception 'هذه المادة لا تتطلب تسجيلًا صوتيًا';
  end if;
  if not public.audio_open_for(p_track) then
    raise exception 'التسجيل الصوتي مسند إلى مرحلة لاحقة';
  end if;

  insert into public.track_audios (track_id, path, uploaded_by, stage_key)
  values (p_track, p_path, auth.uid(), v_s.stage_key);

  -- النسخة الأحدث هي المعروضة ما لم يعتمد المدير غيرها لاحقًا
  update public.tracks set audio_path = p_path where id = p_track;
  perform public.log_event(p_track, 'audio_uploaded', v_s.stage_key, null, null);
end $$;

-- ---------------------------------------------------------------------
-- اعتماد نسخة أو أكثر: لمدير المشروع (أو من يصل إلى مرحلة الاعتماد)
-- ---------------------------------------------------------------------
create or replace function public.approve_track_audios(p_track uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_first text; v_n int;
begin
  if not public.is_manager() then
    raise exception 'اعتماد التسجيل لمدير المشروع فقط' using errcode = '42501';
  end if;
  select count(*) into v_n from public.track_audios where track_id = p_track and id = any(p_ids);
  if v_n = 0 then raise exception 'اختر تسجيلًا واحدًا على الأقل'; end if;

  update public.track_audios set is_approved = (id = any(p_ids)) where track_id = p_track;

  select path into v_first from public.track_audios
   where track_id = p_track and is_approved order by created_at limit 1;
  update public.tracks set audio_path = v_first where id = p_track;
  perform public.log_event(p_track, 'audio_approved', null, null,
    case when v_n > 1 then 'اعتُمدت ' || v_n || ' تسجيلات' else 'اعتُمد تسجيل واحد' end);
end $$;

grant execute on function public.approve_track_audios(uuid, uuid[]) to authenticated;
grant select on public.track_audios to authenticated;

comment on table public.track_audios is 'نسخ التسجيل الصوتي لكل مسار: من رفعها ومتى وأيها معتمدة (ملاحظة التجربة ١٦)';
