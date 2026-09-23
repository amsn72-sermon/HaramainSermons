-- =====================================================================
-- 0004 — إعادة تنشيط الخطبة بعد اعتمادها للتعديل على «أصل الخطبة»
--   التعديل يأتي غالبًا من الشيخ نفسه على نصه العربي: حذف أو إضافة أو
--   إعادة صياغة. فيُعاد تنشيط الخطبة بأحد ثلاثة أوجه:
--     ١. تظليل مواضع التعديل على ملف الأصل مع تحديد نوع كل تعديل
--     ٢. إرفاق ملف أصل جديد (نسخة الشيخ المعدّلة) مع حفظ النسخة السابقة
--     ٣. ملاحظة نصية عامة
--   والمنسق يختار اللغات التي تتأثر والمرحلة التي تعود إليها،
--   وله أن يطلب إعادة التسجيل الصوتي.
-- =====================================================================

-- نسخ ملف الأصل: النسخة ١ هي الملف الأول، وكل تعديل يضيف نسخة
create table if not exists public.material_sources (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  path        text not null,
  version     int  not null check (version > 0),
  note        text,
  uploaded_by uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  unique (material_id, version)
);

-- جولة تعديل واحدة على الخطبة
create table if not exists public.material_revisions (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  round       int  not null check (round > 0),
  mode        text not null check (mode in ('annotate', 'new_source', 'note')),
  note        text,
  source_id   uuid references public.material_sources (id),
  redo_audio  boolean not null default false,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  unique (material_id, round)
);

-- تحديد على صفحة من الأصل: إحداثيات نسبية (٠..١) فلا تتأثر بحجم العرض
create table if not exists public.revision_marks (
  id          uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.material_revisions (id) on delete cascade,
  page        int  not null check (page > 0),
  x           numeric not null check (x >= 0 and x <= 1),
  y           numeric not null check (y >= 0 and y <= 1),
  w           numeric not null check (w > 0 and w <= 1),
  h           numeric not null check (h > 0 and h <= 1),
  kind        text not null check (kind in ('delete', 'add', 'rephrase', 'fix', 'other')),
  note        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);

create index if not exists material_sources_idx   on public.material_sources (material_id, version desc);
create index if not exists material_revisions_idx on public.material_revisions (material_id, round desc);
create index if not exists revision_marks_idx     on public.revision_marks (revision_id, page);

-- التسجيل الصوتي الذي يلزم تجديده بعد التعديل: كل تسجيل قبل هذا الوقت لا يكفي
alter table public.tracks add column if not exists audio_required_after timestamptz;

-- النسخة الأولى من الأصل لكل مادة قائمة
insert into public.material_sources (material_id, path, version, note, uploaded_by, created_at)
select m.id, m.source_pdf_path, 1, 'النسخة الأولى', m.created_by, m.created_at
from public.materials m
where m.source_pdf_path is not null
  and not exists (select 1 from public.material_sources s where s.material_id = m.id);

-- ---------------------------------------------------------------------
-- من يرى أي مسار من المادة يرى تعديلاتها ونسخ أصلها
-- ---------------------------------------------------------------------
create or replace function public.can_see_material(p_material uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.tracks t
    where t.material_id = p_material and public.can_see_track(t.id)
  )
$$;

alter table public.material_sources   enable row level security;
alter table public.material_revisions enable row level security;
alter table public.revision_marks     enable row level security;

drop policy if exists "see material sources" on public.material_sources;
create policy "see material sources" on public.material_sources for select
  using (public.can_see_material(material_id));

drop policy if exists "see material revisions" on public.material_revisions;
create policy "see material revisions" on public.material_revisions for select
  using (public.can_see_material(material_id));

drop policy if exists "see revision marks" on public.revision_marks;
create policy "see revision marks" on public.revision_marks for select
  using (exists (select 1 from public.material_revisions r
                 where r.id = revision_id and public.can_see_material(r.material_id)));

grant select on public.material_sources, public.material_revisions, public.revision_marks to authenticated;

-- قراءة ملفات الأصل من المخزن: النسخة الحالية وكل نسخة سابقة
create or replace function public.can_read_source(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or exists (
      select 1 from public.materials m join public.tracks t on t.material_id = m.id
      where m.source_pdf_path = p_name and public.can_see_track(t.id))
    or exists (
      select 1 from public.material_sources s
      where s.path = p_name and public.can_see_material(s.material_id))
$$;

-- ---------------------------------------------------------------------
-- إضافة نسخة جديدة من الأصل (ملف الشيخ المعدّل)
-- ---------------------------------------------------------------------
create or replace function public.add_source_version(p_material uuid, p_path text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_v int;
begin
  if not public.is_admin() then
    raise exception 'إرفاق أصل جديد للمنسق ومدير المشروع فقط' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_path, '')), '') is null then raise exception 'لم يُرفع ملف'; end if;
  perform 1 from public.materials where id = p_material for update;
  select coalesce(max(version), 0) + 1 into v_v from public.material_sources where material_id = p_material;

  insert into public.material_sources (material_id, path, version, note, uploaded_by)
  values (p_material, p_path, v_v, p_note, auth.uid())
  returning id into v_id;

  update public.materials set source_pdf_path = p_path where id = p_material;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- إعادة تنشيط الخطبة للتعديل
--   p_mode   : annotate | new_source | note
--   p_tracks : اللغات المتأثرة (فارغ = كل لغات المادة)
--   p_stage  : المرحلة التي تعود إليها كل لغة
-- ---------------------------------------------------------------------
create or replace function public.reopen_material(
  p_material uuid, p_mode text, p_note text default null,
  p_tracks uuid[] default null, p_stage text default 'translation',
  p_redo_audio boolean default false, p_source uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_rev uuid; v_round int; v_t record; v_target public.track_stages; v_n int := 0;
begin
  if not public.is_admin() then
    raise exception 'إعادة تنشيط الخطبة للمنسق ومدير المشروع فقط' using errcode = '42501';
  end if;
  if p_mode not in ('annotate', 'new_source', 'note') then raise exception 'نوع التعديل غير معروف'; end if;
  if p_mode = 'note' and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'اكتب ملاحظة التعديل المطلوب';
  end if;
  perform 1 from public.materials where id = p_material for update;
  if not found then raise exception 'الخطبة غير موجودة'; end if;

  select coalesce(max(round), 0) + 1 into v_round from public.material_revisions where material_id = p_material;
  insert into public.material_revisions (material_id, round, mode, note, source_id, redo_audio, created_by)
  values (p_material, v_round, p_mode, nullif(trim(coalesce(p_note, '')), ''), p_source, coalesce(p_redo_audio, false), auth.uid())
  returning id into v_rev;

  for v_t in
    select * from public.tracks
    where material_id = p_material
      and (p_tracks is null or array_length(p_tracks, 1) is null or id = any(p_tracks))
  loop
    select * into v_target from public.track_stages where track_id = v_t.id and stage_key = p_stage;
    if v_target.id is null then
      raise exception 'المرحلة «%» غير موجودة في مسار %', p_stage, v_t.language_code;
    end if;

    -- المراحل من هذه المرحلة فصاعدًا تعود إلى الانتظار، والتأخير السابق محفوظ
    update public.track_stages set
      status = 'waiting', started_at = null, due_at = null, finished_at = null
    where track_id = v_t.id and sort >= v_target.sort;

    update public.tracks set
      status = 'in_progress', completed_at = null,
      is_published = false, published_at = null,
      deadline_at = null,   -- يُعاد احتساب المدة من نصيب المراحل الباقية
      audio_required_after = case when coalesce(p_redo_audio, false) then now() else audio_required_after end
    where id = v_t.id;

    perform public.activate_stage(v_target.id);
    perform public.log_event(v_t.id, 'reopened', p_stage, null,
      coalesce(nullif(trim(coalesce(p_note, '')), ''), 'إعادة تنشيط للتعديل على أصل الخطبة'));
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'اختر لغة واحدة على الأقل'; end if;
  return v_rev;
end $$;

-- ---------------------------------------------------------------------
-- تحديد موضع التعديل على الأصل ونوعه
-- ---------------------------------------------------------------------
create or replace function public.add_revision_mark(
  p_revision uuid, p_page int, p_x numeric, p_y numeric, p_w numeric, p_h numeric,
  p_kind text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_r public.material_revisions;
begin
  if not public.is_admin() then
    raise exception 'تحديد التعديل للمنسق ومدير المشروع فقط' using errcode = '42501';
  end if;
  select * into v_r from public.material_revisions where id = p_revision;
  if v_r.id is null then raise exception 'جولة التعديل غير موجودة'; end if;
  if v_r.closed_at is not null then raise exception 'جولة التعديل أُغلقت'; end if;

  insert into public.revision_marks (revision_id, page, x, y, w, h, kind, note, created_by)
  values (p_revision, p_page, greatest(0, least(1, p_x)), greatest(0, least(1, p_y)),
          greatest(0.005, least(1, p_w)), greatest(0.005, least(1, p_h)),
          p_kind, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_revision_mark(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  delete from public.revision_marks where id = p_id;
end $$;

create or replace function public.close_revision(p_revision uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  update public.material_revisions set closed_at = now() where id = p_revision and closed_at is null;
end $$;

-- ---------------------------------------------------------------------
-- التسجيل الصوتي المطلوب تجديده بعد التعديل
-- ---------------------------------------------------------------------
create or replace function public.stage_blockers(p_track uuid, p_checklist boolean default false)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_s public.track_stages; v_t public.tracks;
  v_out text[] := '{}';
begin
  v_s := public.current_stage(p_track);
  if v_s.id is null then return array['لا توجد مرحلة نشطة']; end if;
  select * into v_t from public.tracks where id = p_track;

  if v_s.assignee_id is distinct from auth.uid() then
    v_out := array_append(v_out, 'الإتمام لمسؤول المرحلة الحالية فقط');
  end if;
  if length(public.plain_text(v_t.translation_html)) = 0 then
    v_out := array_append(v_out, 'أدخل الترجمة كاملة قبل التسليم');
  end if;
  if v_t.audio_stage_key is not null and public.audio_open_for(p_track) then
    if v_t.audio_path is null then
      v_out := array_append(v_out, 'التسجيل الصوتي مطلوب في هذه المرحلة ولم يُرفع بعد');
    elsif v_t.audio_required_after is not null and not exists (
      select 1 from public.track_audios a
      where a.track_id = p_track and a.created_at > v_t.audio_required_after
    ) then
      v_out := array_append(v_out, 'التعديل يستوجب تسجيلًا صوتيًا جديدًا');
    end if;
  end if;
  return v_out;
end $$;

-- ---------------------------------------------------------------------
-- إتمام المرحلة: كما في 0002، مع إغلاق جولة التعديل عند اكتمال كل اللغات
-- ---------------------------------------------------------------------
create or replace function public.complete_stage(p_track uuid, p_checklist boolean default false, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.track_stages; v_next public.track_stages; v_blockers text[]; v_m uuid;
begin
  perform 1 from public.tracks where id = p_track for update;
  v_blockers := public.stage_blockers(p_track, p_checklist);
  if array_length(v_blockers, 1) > 0 then raise exception '%', array_to_string(v_blockers, '، '); end if;
  if not coalesce(p_checklist, false) then
    raise exception 'أكّد مراجعة الترجمة والتسجيل الصوتي قبل الإتمام';
  end if;

  v_s := public.current_stage(p_track);
  update public.track_stages set
    status = 'done',
    finished_at = now(),
    late_seconds = case when outside_sla then null
                        else coalesce(late_seconds, 0) + greatest(0, extract(epoch from now() - due_at))::int end
  where id = v_s.id;
  perform public.log_event(p_track, 'completed', v_s.stage_key, null, p_note);

  select * into v_next from public.track_stages
  where track_id = p_track and sort > v_s.sort order by sort limit 1;

  if v_next.id is not null then
    perform public.activate_stage(v_next.id);
  else
    update public.tracks set
      status = 'completed', current_stage_id = null, completed_at = now(),
      audio_required_after = null,
      is_published = true, published_at = now()
    where id = p_track;
    perform public.log_event(p_track, 'published', null, null, null);

    select material_id into v_m from public.tracks where id = p_track;
    update public.material_revisions r set closed_at = now()
    where r.material_id = v_m and r.closed_at is null
      and not exists (select 1 from public.tracks t2 where t2.material_id = v_m and t2.status <> 'completed');
  end if;
end $$;

grant execute on function public.add_source_version(uuid, text, text) to authenticated;
grant execute on function public.reopen_material(uuid, text, text, uuid[], text, boolean, uuid) to authenticated;
grant execute on function public.add_revision_mark(uuid, int, numeric, numeric, numeric, numeric, text, text) to authenticated;
grant execute on function public.delete_revision_mark(uuid) to authenticated;
grant execute on function public.close_revision(uuid) to authenticated;
grant execute on function public.can_see_material(uuid) to authenticated;

comment on table public.material_revisions is 'جولات التعديل على أصل الخطبة بعد اعتمادها (ملاحظة ٢٨)';
comment on table public.revision_marks    is 'مواضع التعديل على صفحات الأصل ونوع كل تعديل (ملاحظة ٢٨)';
comment on table public.material_sources  is 'نسخ ملف الأصل: النسخة الأولى وما يليها من نسخ الشيخ المعدّلة (ملاحظة ٢٨)';
