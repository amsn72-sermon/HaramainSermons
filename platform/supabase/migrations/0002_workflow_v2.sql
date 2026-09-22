-- =====================================================================
-- 0002 — ملاحظات التجربة الأولى
--   ١. تغيير المسؤول عن مرحلة لم تكتمل، وإلغاء لغة من مادة
--   ٣. موعد نهائي للمسار كله: وقت كل مرحلة يُعاد حسابه عند بدئها من الوقت المتبقي
--   ٧، ١٢. مرحلة مسؤولة عن التسجيل الصوتي، والتسجيل إلزامي منها فصاعدًا
--   ٨. تأكيد المراجعة إلزامي في كل مرحلة
--   ١١. المترجم يرى المهمة ما دامت لديه فقط، وبعدها سجلّ مختصر بتقييم
-- =====================================================================

alter table public.tracks
  add column if not exists deadline_at     timestamptz,  -- يُحدَّد عند الاستلام
  add column if not exists audio_stage_key text;         -- المرحلة المكلّفة بالتسجيل الصوتي

alter table public.track_stages
  add column if not exists base_minutes int not null default 0 check (base_minutes >= 0); -- نصيبها الأصلي من المدة

update public.track_stages set base_minutes = planned_minutes where base_minutes = 0 and planned_minutes > 0;
update public.tracks t set audio_stage_key = 'translation'
  from public.materials m where m.id = t.material_id and m.deliverable = 'text_audio' and t.audio_stage_key is null;
update public.tracks t set deadline_at = t.accepted_at + make_interval(mins => (
    select coalesce(sum(base_minutes), 0)::int from public.track_stages s where s.track_id = t.id and not s.outside_sla))
  where t.accepted_at is not null and t.deadline_at is null;

-- ---------------------------------------------------------------------
-- ١١. الخصوصية: غير الإداري يرى المسار ما دامت المرحلة الحالية لديه فقط
-- ---------------------------------------------------------------------
create or replace function public.can_see_track(p_track uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.my_role() is not null and exists (
    select 1 from public.tracks t
    join public.track_stages s on s.track_id = t.id
    where t.id = p_track and s.assignee_id = auth.uid() and (
      (s.status = 'active' and t.current_stage_id = s.id)
      or (t.status = 'awaiting_receipt' and s.sort = (select min(sort) from public.track_stages x where x.track_id = t.id))
    )
  ))
$$;

drop policy if exists "see materials" on public.materials;
create policy "see materials" on public.materials for select using (
  public.is_admin() or exists (select 1 from public.tracks t where t.material_id = materials.id and public.can_see_track(t.id))
);

-- ملف الأصل العربي: للإدارة ولمن بيده مهمة عليه الآن
create or replace function public.can_read_source(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.materials m join public.tracks t on t.material_id = m.id
    where m.source_pdf_path = p_name and public.can_see_track(t.id)
  )
$$;
drop policy if exists "staff read sources" on storage.objects;
create policy "staff read sources" on storage.objects for select
  using (bucket_id = 'sources' and public.can_read_source(name));

-- ---------------------------------------------------------------------
-- ٣. التفعيل: وقت المرحلة = نصيبها من الوقت المتبقي حتى الموعد النهائي
--    تأخُّر مرحلة يقلّص ما بعدها، وإنجازها مبكرًا يزيده. لكل مرحلة حد أدنى
--    ربع نصيبها الأصلي حتى لا تبدأ مرحلة متأخرةً من أول لحظة.
-- ---------------------------------------------------------------------
drop function if exists public.activate_stage(uuid);
create function public.activate_stage(p_stage uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s public.track_stages; v_t public.tracks;
  v_left numeric; v_weights numeric; v_minutes int;
begin
  select * into v_s from public.track_stages where id = p_stage;
  select * into v_t from public.tracks where id = v_s.track_id;

  if v_s.outside_sla then
    v_minutes := 0;
  elsif v_t.deadline_at is null then
    v_minutes := v_s.base_minutes;
  else
    v_left := extract(epoch from v_t.deadline_at - now()) / 60;
    select coalesce(sum(base_minutes), 0) into v_weights from public.track_stages
    where track_id = v_s.track_id and not outside_sla and sort >= v_s.sort;
    v_minutes := greatest(
      ceil(v_s.base_minutes * 0.25),
      case when v_weights > 0 then round(greatest(v_left, 0) * v_s.base_minutes / v_weights) else v_s.base_minutes end
    )::int;
  end if;

  update public.track_stages set
    status          = 'active',
    started_at      = now(),
    planned_minutes = v_minutes,
    due_at          = case when outside_sla then null else now() + make_interval(mins => v_minutes) end,
    finished_at     = null,
    rounds          = rounds + 1
  where id = p_stage;
  update public.tracks set
    current_stage_id = p_stage,
    status = case when v_s.outside_sla then 'awaiting_approval'::public.track_status else 'in_progress'::public.track_status end
  where id = v_s.track_id;
end $$;
revoke execute on function public.activate_stage(uuid) from public, anon, authenticated;

create or replace function public.accept_track(p_track uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.tracks; v_first public.track_stages;
begin
  select * into v_t from public.tracks where id = p_track for update;
  if not found then raise exception 'المسار غير موجود'; end if;
  if v_t.status <> 'awaiting_receipt' then raise exception 'تم استلام هذه المهمة مسبقًا'; end if;

  select * into v_first from public.track_stages where track_id = p_track order by sort limit 1;
  if v_first.assignee_id is distinct from auth.uid() then
    raise exception 'الاستلام لمسؤول المرحلة الأولى فقط' using errcode = '42501';
  end if;

  update public.tracks set
    accepted_at = now(),
    receipt_late_seconds = greatest(0, extract(epoch from now() - receipt_due_at))::int,
    deadline_at = now() + make_interval(mins => (
      select coalesce(sum(base_minutes), 0)::int from public.track_stages where track_id = p_track and not outside_sla))
  where id = p_track;
  perform public.activate_stage(v_first.id);
  perform public.log_event(p_track, 'accepted', v_first.stage_key, null, null);
end $$;

-- ---------------------------------------------------------------------
-- إنشاء المادة: base_minutes، ومرحلة التسجيل الصوتي لكل لغة
-- ---------------------------------------------------------------------
create or replace function public.create_material(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  m          jsonb := p -> 'material';
  v_material uuid;
  v_lang     jsonb;
  v_stage    jsonb;
  v_track    uuid;
  v_ws       public.workflow_stages;
  v_assignee public.profiles;
  v_template_total numeric;
  v_chosen_total   numeric;
  v_factor   numeric;
  v_minutes  numeric;
  v_keys     text[];
  v_audio    text;
  v_receipt  int := coalesce((m ->> 'receipt_minutes')::int, 120);
  v_deliv    text := coalesce(m ->> 'deliverable', 'text_audio');
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p -> 'languages', '[]')) = 0 then
    raise exception 'اختر لغة واحدة على الأقل';
  end if;

  insert into public.materials (
    material_type, sermon_type, title, mosque, khateeb_id, sermon_date, author,
    instructions, source_html, source_pdf_path, deliverable, priority,
    receipt_minutes, reminder_minutes, escalate_to_manager, feed_record_id, created_by
  ) values (
    m ->> 'material_type', m ->> 'sermon_type', m ->> 'title', m ->> 'mosque',
    nullif(m ->> 'khateeb_id', '')::int, nullif(m ->> 'sermon_date', '')::date,
    m ->> 'author', m ->> 'instructions',
    m ->> 'source_html', m ->> 'source_pdf_path', v_deliv,
    coalesce(m ->> 'priority', 'normal'), v_receipt,
    coalesce((m ->> 'reminder_minutes')::int, 15), coalesce((m ->> 'escalate_to_manager')::boolean, false),
    m ->> 'feed_record_id', auth.uid()
  ) returning id into v_material;

  select coalesce(sum(coalesce((p -> 'stage_minutes' ->> ws.key)::numeric, 0)), 0)
    into v_template_total
  from public.workflow_stages ws where ws.is_active and not ws.outside_sla;
  if v_template_total <= 0 then raise exception 'حدد مدة المراحل'; end if;

  for v_lang in select * from jsonb_array_elements(p -> 'languages') loop
    if not exists (select 1 from public.languages where code = v_lang ->> 'code' and is_active) then
      raise exception 'اللغة غير مفعّلة: %', v_lang ->> 'code';
    end if;

    select array_agg(s ->> 'key') into v_keys from jsonb_array_elements(v_lang -> 'stages') s;

    for v_ws in select * from public.workflow_stages where is_active and is_required loop
      if not (v_ws.key = any (coalesce(v_keys, '{}'))) then
        raise exception 'مرحلة «%» أساسية ولا يمكن تجاوزها (%)', v_ws.name_ar, v_lang ->> 'code';
      end if;
    end loop;

    -- ١٢. مرحلة التسجيل: من مراحل المترجمين المختارة لهذه اللغة
    v_audio := null;
    if v_deliv = 'text_audio' then
      v_audio := coalesce(nullif(v_lang ->> 'audio_stage', ''), 'translation');
      if not (v_audio = any (v_keys)) or not exists (
        select 1 from public.workflow_stages where key = v_audio and assignee_role = 'translator'
      ) then
        raise exception 'اختر مرحلة التسجيل الصوتي من مراحل هذه اللغة (%)', v_lang ->> 'code';
      end if;
    end if;

    select coalesce(sum(coalesce((p -> 'stage_minutes' ->> ws.key)::numeric, 0)), 0)
      into v_chosen_total
    from public.workflow_stages ws
    where ws.key = any (v_keys) and not ws.outside_sla;
    v_factor := case when v_chosen_total > 0 then v_template_total / v_chosen_total else 1 end;

    insert into public.tracks (material_id, language_code, receipt_due_at, audio_stage_key)
    values (v_material, v_lang ->> 'code', now() + make_interval(mins => v_receipt), v_audio)
    returning id into v_track;

    for v_stage in select * from jsonb_array_elements(v_lang -> 'stages') loop
      select * into v_ws from public.workflow_stages where key = v_stage ->> 'key' and is_active;
      if not found then raise exception 'مرحلة غير معروفة: %', v_stage ->> 'key'; end if;

      select * into v_assignee from public.profiles
      where id = nullif(v_stage ->> 'assignee', '')::uuid and status = 'active';
      if not found then
        raise exception 'اختر مسؤولًا مفعّلًا لمرحلة «%» (%)', v_ws.name_ar, v_lang ->> 'code';
      end if;
      perform public.check_assignee(v_ws, v_assignee, v_lang ->> 'code');

      v_minutes := case when v_ws.outside_sla then 0
                        else round(coalesce((p -> 'stage_minutes' ->> v_ws.key)::numeric, 0) * v_factor) end;

      insert into public.track_stages (track_id, stage_key, sort, assignee_id, planned_minutes, base_minutes, outside_sla)
      values (v_track, v_ws.key, v_ws.sort, v_assignee.id, v_minutes::int, v_minutes::int, v_ws.outside_sla);
    end loop;

    perform public.log_event(v_track, 'assigned', null, null, null);
  end loop;

  return v_material;
end $$;

-- أهلية المسؤول لمرحلة (مشتركة بين الإنشاء وتغيير المسؤول)
create or replace function public.check_assignee(v_ws public.workflow_stages, v_assignee public.profiles, p_lang text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if v_assignee.status <> 'active' then raise exception '«%» غير مفعّل', v_assignee.full_name; end if;
  if v_ws.assignee_role = 'translator' and not exists (
    select 1 from public.member_languages where member_id = v_assignee.id and language_code = p_lang
  ) then
    raise exception '«%» غير مؤهل في هذه اللغة (%)', v_assignee.full_name, p_lang;
  end if;
  if v_ws.assignee_role = 'coordinator' and v_assignee.role not in ('coordinator', 'manager') then
    raise exception 'مرحلة «%» تُسند لمنسق', v_ws.name_ar;
  end if;
  if v_ws.assignee_role = 'manager' and v_assignee.role <> 'manager' then
    raise exception 'مرحلة «%» تُسند لمدير المشروع', v_ws.name_ar;
  end if;
end $$;
revoke execute on function public.check_assignee(public.workflow_stages, public.profiles, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- ١. تغيير المسؤول عن مرحلة لم تكتمل
-- ---------------------------------------------------------------------
create or replace function public.reassign_stage(p_track uuid, p_stage text, p_assignee uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.tracks; v_s public.track_stages; v_ws public.workflow_stages; v_a public.profiles; v_first int;
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into v_t from public.tracks where id = p_track for update;
  if not found then raise exception 'المسار غير موجود'; end if;
  if v_t.status = 'completed' then raise exception 'المسار مكتمل'; end if;
  select * into v_s from public.track_stages where track_id = p_track and stage_key = p_stage;
  if not found then raise exception 'المرحلة غير موجودة في هذا المسار'; end if;
  if v_s.status = 'done' then raise exception 'المرحلة أُنجزت ولا يمكن تغيير مسؤولها'; end if;
  if v_s.assignee_id = p_assignee then return; end if;
  select * into v_ws from public.workflow_stages where key = p_stage;
  select * into v_a from public.profiles where id = p_assignee;
  if not found then raise exception 'العضو غير موجود'; end if;
  perform public.check_assignee(v_ws, v_a, v_t.language_code);

  update public.track_stages set assignee_id = p_assignee where id = v_s.id;
  -- إن كانت بانتظار الاستلام يبدأ للمسؤول الجديد مهلة استلام كاملة
  select min(sort) into v_first from public.track_stages where track_id = p_track;
  if v_t.status = 'awaiting_receipt' and v_s.sort = v_first then
    update public.tracks set receipt_due_at = now() + make_interval(mins => (
      select receipt_minutes from public.materials where id = v_t.material_id)) where id = p_track;
  end if;
  perform public.log_event(p_track, 'reassigned', p_stage, null, v_a.full_name);
end $$;

-- إلغاء لغة من مادة قبل اكتمالها (تُحذف المادة إن لم تبقَ لها لغات)
create or replace function public.cancel_track(p_track uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.tracks;
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into v_t from public.tracks where id = p_track for update;
  if not found then raise exception 'المسار غير موجود'; end if;
  if v_t.status = 'completed' then raise exception 'لا يُلغى مسار مكتمل'; end if;
  delete from public.tracks where id = p_track;
  delete from public.materials m where m.id = v_t.material_id
    and not exists (select 1 from public.tracks where material_id = m.id);
end $$;

-- ---------------------------------------------------------------------
-- ٧، ١٢. التسجيل الصوتي: يرفعه أو يستبدله مسؤول مرحلة التسجيل وما بعدها
-- ---------------------------------------------------------------------
create or replace function public.audio_open_for(p_track uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select cur.sort >= a.sort
    from public.tracks t
    join public.track_stages cur on cur.id = t.current_stage_id
    join public.track_stages a on a.track_id = t.id and a.stage_key = t.audio_stage_key
    where t.id = p_track
  ), false)
$$;

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
  update public.tracks set audio_path = p_path where id = p_track;
  perform public.log_event(p_track, 'audio_uploaded', v_s.stage_key, null, null);
end $$;

-- ما يمنع الإتمام (بلا بند التأكيد؛ التأكيد يُطلب في نافذة الإتمام)
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
  if v_t.audio_stage_key is not null and v_t.audio_path is null and public.audio_open_for(p_track) then
    v_out := array_append(v_out, 'التسجيل الصوتي مطلوب في هذه المرحلة ولم يُرفع بعد');
  end if;
  return v_out;
end $$;

create or replace function public.complete_stage(p_track uuid, p_checklist boolean default false, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s public.track_stages; v_next public.track_stages; v_blockers text[];
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
      is_published = true, published_at = now()
    where id = p_track;
    perform public.log_event(p_track, 'published', null, null, null);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- ١١. سجل العضو: ما أنجزه وما ينتظره، بالبيانات الرئيسية فقط، مع التقييم
--   التقييم = ١٠٠ × المدة المخصصة ÷ (المدة المخصصة + التأخير)
--   في الوقت = ١٠٠، وتأخير بقدر المدة نفسها = ٥٠، ويقل كلما زاد التأخير
-- ---------------------------------------------------------------------
create or replace function public.my_history()
returns table (
  track_id uuid, title text, sermon_type text, material_type text, mosque text, sermon_date date,
  language_code text, stage_key text, stage_status public.stage_status, track_status public.track_status,
  started_at timestamptz, finished_at timestamptz, planned_minutes int, late_seconds int,
  score int, is_open boolean
) language sql stable security definer set search_path = public as $$
  select t.id, m.title, m.sermon_type, m.material_type, m.mosque, m.sermon_date,
         t.language_code, s.stage_key, s.status, t.status,
         s.started_at, s.finished_at, s.planned_minutes, s.late_seconds,
         case when s.status = 'done' and not s.outside_sla and s.planned_minutes > 0
              then round(100.0 * s.planned_minutes * 60 / (s.planned_minutes * 60 + coalesce(s.late_seconds, 0)))::int end,
         public.can_see_track(t.id)
  from public.track_stages s
  join public.tracks t on t.id = s.track_id
  join public.materials m on m.id = t.material_id
  where s.assignee_id = auth.uid()
  order by coalesce(s.finished_at, s.started_at, t.created_at) desc
$$;

grant execute on function public.can_read_source(text), public.audio_open_for(uuid) to authenticated;
grant execute on function public.can_see_track(uuid) to anon, authenticated;
grant execute on function public.reassign_stage(uuid, text, uuid), public.cancel_track(uuid), public.my_history(),
  public.accept_track(uuid), public.create_material(jsonb), public.set_track_audio(uuid, text),
  public.stage_blockers(uuid, boolean), public.complete_stage(uuid, boolean, text) to authenticated;

-- ٢. حقول لم تعد تُطلب في النموذج (تبقى الأعمدة للمواد القديمة)
comment on column public.materials.audience is 'لم يعد يُطلب — ملاحظة التجربة ٢';
comment on column public.materials.channel  is 'لم يعد يُطلب — ملاحظة التجربة ٢';
comment on column public.materials.purpose  is 'لم يعد يُطلب — ملاحظة التجربة ٢';
