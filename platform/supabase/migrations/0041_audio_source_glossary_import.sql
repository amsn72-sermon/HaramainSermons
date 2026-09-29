-- =====================================================================
-- 0041 — ثلاثٌ من ملاحظات ما بعد تحديث ١٧:
--   ١) أصلُ المادة قد يكون مقطعًا صوتيًّا            (ملاحظتا ١٥٤ و١٥٧)
--   ٢) بنود العقد والمستخلص لمدير المشروع وحده       (ملاحظة ١٥٥)
--   ٣) استيراد الدليل المصطلحي دفعةً واحدة           (ملاحظة ١٥٨)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الأصل الصوتي: يُرفع الدرس أو المادة صوتًا، ويُترجم نصًّا (وصوتًا أحيانًا)
-- ---------------------------------------------------------------------
alter table public.materials
  add column if not exists source_audio_path text,
  add column if not exists source_audio_seconds int;

comment on column public.materials.source_audio_path
  is 'أصل المادة مقطعًا صوتيًّا: يسمعه المترجم ويكتب ترجمته (ملاحظة ١٥٧)';

-- القيد القديم كان يشترط نصًّا أو ملفًّا، فيتّسع للصوت
alter table public.materials drop constraint if exists materials_has_source;
alter table public.materials add constraint materials_has_source check (
  nullif(trim(coalesce(source_html, '')), '') is not null
  or source_pdf_path is not null
  or source_audio_path is not null
);

-- اكتمال المادة: نصٌّ أو ملف PDF أو مقطع صوتي — أحدها على الأقل
create or replace function public.check_material_complete()
returns trigger language plpgsql set search_path = public as $$
declare v_txt text;
begin
  if nullif(trim(coalesce(new.material_type, '')), '') is null then
    raise exception 'نوع المادة مطلوب';
  end if;
  if nullif(trim(coalesce(new.title, '')), '') is null then
    raise exception 'عنوان المادة مطلوب';
  end if;
  if new.sermon_date is null then
    raise exception 'تاريخ المادة مطلوب';
  end if;

  if new.material_type = 'خطب' then
    if nullif(trim(coalesce(new.sermon_type, '')), '') is null then
      raise exception 'نوع الخطبة مطلوب (جمعة، عرفة، عيد…)';
    end if;
    if new.khateeb_id is null then
      raise exception 'اسم الخطيب مطلوب';
    end if;
    if new.mosque not in ('makkah', 'madinah') then
      raise exception 'حدّد جهة الخطبة: المسجد الحرام أو المسجد النبوي';
    end if;
  elsif nullif(trim(coalesce(new.author, '')), '') is null then
    raise exception 'المؤلف أو الجهة المصدرة مطلوب لغير الخطب';
  end if;

  -- الأصل: نصٌّ مكتوب، أو ملف PDF، أو مقطع صوتي (ملاحظة ١٥٧)
  v_txt := nullif(trim(regexp_replace(coalesce(new.source_html, ''), '<[^>]*>', ' ', 'g')), '');
  if v_txt is null and new.source_pdf_path is null and new.source_audio_path is null then
    raise exception 'أدخل النص العربي، أو أرفق ملف الأصل (PDF)، أو ارفع المقطع الصوتي';
  end if;

  -- صيغة الأصل الصوتي كصيغة التسليم: WAV أو MP3
  if new.source_audio_path is not null and new.source_audio_path !~* '\.(wav|mp3)$' then
    raise exception 'الصيغ المعتمدة للمقطع الصوتي: WAV أو MP3 فقط';
  end if;
  return new;
end $$;

-- ومن يرى المسار يسمع أصله الصوتي
create or replace function public.can_read_source(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.materials m join public.tracks t on t.material_id = m.id
    where (m.source_pdf_path = p_name or m.source_audio_path = p_name)
      and public.can_see_track(t.id)
  )
$$;

-- مدة الأصل الصوتي تُقاس في المتصفح، فتُكتب مرة واحدة
create or replace function public.set_source_audio_seconds(p_material uuid, p_seconds int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_seconds is null or p_seconds <= 0 or p_seconds > 86400 then return; end if;
  if not (public.is_admin() or exists (
        select 1 from public.tracks t where t.material_id = p_material and public.can_see_track(t.id))) then
    return;
  end if;
  update public.materials set source_audio_seconds = p_seconds
   where id = p_material and source_audio_seconds is null;
end $$;

grant execute on function public.set_source_audio_seconds(uuid, int) to authenticated;

-- إنشاء المادة يحمل الأصل الصوتي كما يحمل ملف PDF (ملاحظة ١٥٧)
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
    instructions, source_html, source_pdf_path, source_audio_path, deliverable, priority,
    receipt_minutes, reminder_minutes, escalate_to_manager, feed_record_id, created_by
  ) values (
    m ->> 'material_type', m ->> 'sermon_type', m ->> 'title', m ->> 'mosque',
    nullif(m ->> 'khateeb_id', '')::int, nullif(m ->> 'sermon_date', '')::date,
    m ->> 'author', m ->> 'instructions',
    m ->> 'source_html', m ->> 'source_pdf_path', nullif(m ->> 'source_audio_path', ''), v_deliv,
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

grant execute on function public.create_material(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) بنود العقد والمستخلص: لمدير المشروع وحده (ملاحظة ١٥٥)
-- ---------------------------------------------------------------------
drop policy if exists "read contract items" on public.contract_items;
create policy "read contract items" on public.contract_items for select using (public.is_manager());

create or replace function public.contract_progress(p_from date default null, p_to date default null)
returns table (code int, name text, unit text, unit_price numeric, qty_contracted numeric,
               qty_done numeric, total_value numeric, note text)
language sql stable security definer set search_path = public as $$
  with done as (
    select * from public.contract_rows
     where status = 'completed'
       and (p_from is null or coalesce(completed_at::date, sermon_date) >= p_from)
       and (p_to   is null or coalesce(completed_at::date, sermon_date) <= p_to)
  ), hours as (
    select coalesce(sum(i.hours), 0) as h from public.interpretations i
     where (p_from is null or i.held_on >= p_from) and (p_to is null or i.held_on <= p_to)
  )
  select c.code, c.name, c.unit, c.unit_price, c.qty_contracted,
         case c.measure
           when 'sermon'               then (select count(*) from done where is_sermon)
           when 'sermon_audio'         then (select count(*) from done where is_sermon and has_audio)
           when 'sermon_sharia'        then (select count(*) from done where is_sermon and has_sharia)
           when 'interpretation_hours' then (select h from hours)
           when 'words'                then (select coalesce(sum(source_words), 0) from done where not is_sermon)
           when 'words_review'         then (select coalesce(sum(source_words), 0) from done where not is_sermon)
           else 0 end::numeric as qty_done,
         c.total_value, c.note
    from public.contract_items c
   where public.is_manager()
   order by c.code
$$;

-- ---------------------------------------------------------------------
-- ٣) استيراد الدليل المصطلحي دفعةً واحدة من ملف (ملاحظة ١٥٨)
--    [{ term_ar, category, explanation, translations: [{language_code, term_tr, note}] }]
--    الموجود يُحدَّث والجديد يُضاف، ولا يُمسّ اعتماد مصطلح معتمد.
-- ---------------------------------------------------------------------
create or replace function public.import_glossary(p_rows jsonb)
returns table (added int, updated int, skipped int)
language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_tr jsonb; v_id uuid; v_term text; v_cat text;
        v_added int := 0; v_updated int := 0; v_skipped int := 0;
begin
  if public.my_role() is null or public.is_supervisor() then
    raise exception 'استيراد الدليل المصطلحي للفريق' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'الملف غير مقروء'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'الحد الأقصى ٥٠٠٠ مصطلح في المرة الواحدة'; end if;

  for v_row in select jsonb_array_elements(p_rows) loop
    v_term := nullif(trim(coalesce(v_row ->> 'term_ar', '')), '');
    if v_term is null or nullif(trim(coalesce(v_row ->> 'explanation', '')), '') is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_cat := coalesce(nullif(trim(coalesce(v_row ->> 'category', '')), ''), 'عام');
    if v_cat not in ('عقدي', 'فقهي', 'دعوي', 'عام') then v_cat := 'عام'; end if;

    select id into v_id from public.glossary_terms where term_ar = v_term;
    if v_id is null then
      insert into public.glossary_terms (term_ar, category, explanation, status, created_by)
      values (v_term, v_cat, trim(v_row ->> 'explanation'), 'مقترح', auth.uid())
      returning id into v_id;
      v_added := v_added + 1;
    else
      update public.glossary_terms
         set category = v_cat, explanation = trim(v_row ->> 'explanation')
       where id = v_id;
      v_updated := v_updated + 1;
    end if;

    for v_tr in select jsonb_array_elements(coalesce(v_row -> 'translations', '[]'::jsonb)) loop
      if nullif(trim(coalesce(v_tr ->> 'term_tr', '')), '') is not null
         and exists (select 1 from public.languages where code = v_tr ->> 'language_code') then
        insert into public.glossary_translations (term_id, language_code, term_tr, note)
        values (v_id, v_tr ->> 'language_code', trim(v_tr ->> 'term_tr'),
                nullif(trim(coalesce(v_tr ->> 'note', '')), ''))
        on conflict (term_id, language_code) do update
          set term_tr = excluded.term_tr, note = coalesce(excluded.note, public.glossary_translations.note);
      end if;
    end loop;
  end loop;

  return query select v_added, v_updated, v_skipped;
end $$;

grant execute on function public.import_glossary(jsonb) to authenticated;

notify pgrst, 'reload schema';
