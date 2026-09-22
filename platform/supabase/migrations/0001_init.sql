-- =====================================================================
-- منصة إدارة ترجمة الحرمين — المخطط الأساسي
-- يُشغَّل مرة واحدة في Supabase: SQL Editor ← New query ← لصق ← Run
--
-- المبادئ:
--   • كل انتقال في سير العمل يمر عبر دوال (RPC) تتحقق من الصلاحية والمدخلات؛
--     لا يملك المتصفح صلاحية تعديل حالة المسار مباشرة.
--   • سجل الإجراءات غير قابل للتعديل أو الحذف من الواجهة.
--   • الوقت يُحسب لكل مرحلة من لحظة بدئها، ويُسجَّل التأخير ويبقى بعد الإنجاز.
--   • البيانات الحساسة (الهوية، الإقامة، واتس آب) في جدول مستقل بصلاحيات أضيق.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- الأنواع
-- ---------------------------------------------------------------------
create type public.app_role      as enum ('manager', 'coordinator', 'translator');
create type public.member_status as enum ('pending', 'active', 'disabled');
create type public.track_status  as enum ('awaiting_receipt', 'in_progress', 'awaiting_approval', 'completed');
create type public.stage_status  as enum ('waiting', 'active', 'done');

-- ---------------------------------------------------------------------
-- البيانات المرجعية
-- ---------------------------------------------------------------------
create table public.languages (
  code        text primary key,
  name_ar     text not null unique,
  native_name text not null,
  dir         text not null default 'ltr' check (dir in ('ltr', 'rtl')),
  is_core     boolean not null default false,   -- لغة رئيسية لا تُعطَّل
  is_active   boolean not null default true,
  sort        int not null default 100
);

create table public.khateebs (
  id        serial primary key,
  name      text not null,
  mosque    text not null check (mosque in ('makkah', 'madinah')),
  is_active boolean not null default true,
  sort      int not null default 100,
  unique (name, mosque)
);

create table public.workflow_stages (
  key           text primary key,
  name_ar       text not null,
  sort          int not null,
  is_required   boolean not null default false,  -- لا يمكن تجاوزها
  outside_sla   boolean not null default false,  -- خارج وقت التنفيذ (اعتماد المدير)
  assignee_role public.app_role not null default 'translator',
  weight        numeric not null default 1 check (weight >= 0), -- نصيبها الافتراضي من المدة
  is_active     boolean not null default true
);

-- ---------------------------------------------------------------------
-- الأعضاء
-- ---------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null check (length(trim(full_name)) > 1),
  email      text not null,
  role       public.app_role not null default 'translator',
  status     public.member_status not null default 'pending',
  created_at timestamptz not null default now()
);

-- بيانات حساسة: يراها صاحبها والمنسق والمدير فقط
create table public.profile_private (
  id          uuid primary key references public.profiles (id) on delete cascade,
  whatsapp    text,
  nationality text,
  -- اختياري: المترجم عن بُعد قد لا يملك هوية أو إقامة سعودية
  national_id text check (national_id is null or national_id ~ '^[12][0-9]{9}$'),
  residence   text,
  iqama_path  text
);

create table public.member_languages (
  member_id     uuid not null references public.profiles (id) on delete cascade,
  language_code text not null references public.languages (code) on update cascade,
  primary key (member_id, language_code)
);

-- ---------------------------------------------------------------------
-- المواد ومسارات اللغات
-- ---------------------------------------------------------------------
create table public.materials (
  id                  uuid primary key default gen_random_uuid(),
  material_type       text not null,
  sermon_type         text,
  title               text not null check (length(trim(title)) > 0),
  mosque              text not null check (mosque in ('makkah', 'madinah')),
  khateeb_id          int references public.khateebs (id),
  sermon_date         date,
  author              text,
  audience            text,
  channel             text,
  purpose             text,
  instructions        text,
  source_html         text,
  source_pdf_path     text,
  deliverable         text not null default 'text_audio' check (deliverable in ('text', 'text_audio')),
  priority            text not null default 'normal' check (priority in ('normal', 'urgent', 'emergency')),
  receipt_minutes     int  not null default 120 check (receipt_minutes > 0),
  reminder_minutes    int  not null default 15  check (reminder_minutes >= 0),
  escalate_to_manager boolean not null default false,
  feed_record_id      text,  -- ربط اختياري بسجل الخطبة في أرشيف يوتيوب
  created_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now(),
  constraint materials_has_source check (
    nullif(trim(coalesce(source_html, '')), '') is not null or source_pdf_path is not null
  )
);

create table public.tracks (
  id               uuid primary key default gen_random_uuid(),
  material_id      uuid not null references public.materials (id) on delete cascade,
  language_code    text not null references public.languages (code) on update cascade,
  status           public.track_status not null default 'awaiting_receipt',
  current_stage_id uuid,
  translation_html text,
  audio_path       text,
  receipt_due_at   timestamptz not null,
  accepted_at      timestamptz,
  receipt_late_seconds int,           -- تأخر الاستلام، يُسجَّل ولا يُمحى
  completed_at     timestamptz,
  is_published     boolean not null default false,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  unique (material_id, language_code)
);

create table public.track_stages (
  id              uuid primary key default gen_random_uuid(),
  track_id        uuid not null references public.tracks (id) on delete cascade,
  stage_key       text not null references public.workflow_stages (key) on update cascade,
  sort            int  not null,
  assignee_id     uuid not null references public.profiles (id),
  status          public.stage_status not null default 'waiting',
  planned_minutes int  not null default 0 check (planned_minutes >= 0),
  outside_sla     boolean not null default false,
  started_at      timestamptz,
  due_at          timestamptz,
  finished_at     timestamptz,
  late_seconds    int,        -- مجموع التأخير في هذه المرحلة عبر كل الجولات
  rounds          int not null default 0,  -- عدد مرات تفعيلها (الإعادات ترفعه)
  unique (track_id, stage_key)
);

alter table public.tracks
  add constraint tracks_current_stage_fk
  foreign key (current_stage_id) references public.track_stages (id)
  deferrable initially deferred;

create table public.track_events (
  id               bigint generated always as identity primary key,
  track_id         uuid not null references public.tracks (id) on delete cascade,
  actor_id         uuid references public.profiles (id),
  action           text not null,
  stage_key        text,
  target_stage_key text,
  note             text,
  created_at       timestamptz not null default now()
);

create index on public.tracks (material_id);
create index on public.tracks (status);
create index on public.track_stages (assignee_id);
create index on public.track_stages (track_id, sort);
create index on public.track_events (track_id, created_at);

-- ---------------------------------------------------------------------
-- دوال مساعدة للصلاحيات
-- ---------------------------------------------------------------------
create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('manager', 'coordinator'), false)
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'manager', false)
$$;

create or replace function public.can_see_track(p_track uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.track_stages s
    where s.track_id = p_track and s.assignee_id = auth.uid()
      and public.my_role() is not null
  )
$$;

-- نص بلا وسوم HTML لفحص الفراغ
create or replace function public.plain_text(p_html text)
returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(coalesce(p_html, ''), '<[^>]*>', ' ', 'g'), '&nbsp;|\s+', ' ', 'g'))
$$;

create or replace function public.log_event(p_track uuid, p_action text, p_stage text, p_target text, p_note text)
returns void language sql security definer set search_path = public as $$
  insert into public.track_events (track_id, actor_id, action, stage_key, target_stage_key, note)
  values (p_track, auth.uid(), p_action, p_stage, p_target, nullif(trim(coalesce(p_note, '')), ''))
$$;

-- ---------------------------------------------------------------------
-- التسجيل: كل مستخدم جديد يصبح طلب تسجيل «بانتظار التفعيل»
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_lang text;
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(nullif(trim(m ->> 'full_name'), ''), split_part(new.email, '@', 1)), new.email);

  insert into public.profile_private (id, whatsapp, nationality, national_id, residence)
  values (new.id, m ->> 'whatsapp', m ->> 'nationality', nullif(m ->> 'national_id', ''), m ->> 'residence');

  for v_lang in select jsonb_array_elements_text(coalesce(m -> 'languages', '[]'::jsonb)) loop
    insert into public.member_languages (member_id, language_code)
    select new.id, v_lang where exists (select 1 from public.languages where code = v_lang and is_active)
    on conflict do nothing;
  end loop;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- إدارة الأعضاء (المنسق والمدير)
-- ---------------------------------------------------------------------
create or replace function public.admin_update_member(
  p_member uuid, p_status public.member_status default null,
  p_role public.app_role default null, p_languages text[] default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_target public.profiles;
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into v_target from public.profiles where id = p_member for update;
  if not found then raise exception 'العضو غير موجود'; end if;

  -- المنسق يدير المترجمين فقط؛ الأدوار الإدارية بيد المدير
  if not public.is_manager() and (v_target.role <> 'translator' or coalesce(p_role, 'translator') <> 'translator') then
    raise exception 'إدارة المنسقين والمديرين متاحة لمدير المشروع فقط' using errcode = '42501';
  end if;
  if p_member = auth.uid() and (p_status is distinct from null and p_status <> 'active') then
    raise exception 'لا يمكنك تعطيل حسابك';
  end if;
  if p_status = 'disabled' and exists (
    select 1 from public.track_stages s join public.tracks t on t.id = s.track_id
    where s.assignee_id = p_member and t.status <> 'completed' and s.status <> 'done'
  ) then
    raise exception 'لا يمكن تعطيل العضو لأن لديه إسنادًا ضمن مهمة لم تكتمل. أعد إسنادها أولًا.';
  end if;

  update public.profiles set
    status = coalesce(p_status, status),
    role   = coalesce(p_role, role)
  where id = p_member;

  if p_languages is not null then
    delete from public.member_languages where member_id = p_member;
    insert into public.member_languages (member_id, language_code)
    select p_member, l from unnest(p_languages) l
    where exists (select 1 from public.languages where code = l);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- إنشاء مادة وإسنادها
-- p = {
--   "material": {...الحقول...},
--   "stage_minutes": {"translation": 1994, ...},   -- قالب المدد للمسار الكامل
--   "languages": [{"code": "en", "stages": [{"key": "translation", "assignee": "uuid"}, ...]}]
-- }
-- إن اختُصر مسار لغة، يُعاد توزيع وقت المراحل المتجاوزة على مراحلها بالنسبة نفسها.
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
  v_receipt  int := coalesce((m ->> 'receipt_minutes')::int, 120);
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p -> 'languages', '[]')) = 0 then
    raise exception 'اختر لغة واحدة على الأقل';
  end if;

  insert into public.materials (
    material_type, sermon_type, title, mosque, khateeb_id, sermon_date, author, audience,
    channel, purpose, instructions, source_html, source_pdf_path, deliverable, priority,
    receipt_minutes, reminder_minutes, escalate_to_manager, feed_record_id, created_by
  ) values (
    m ->> 'material_type', m ->> 'sermon_type', m ->> 'title', m ->> 'mosque',
    nullif(m ->> 'khateeb_id', '')::int, nullif(m ->> 'sermon_date', '')::date,
    m ->> 'author', m ->> 'audience', m ->> 'channel', m ->> 'purpose', m ->> 'instructions',
    m ->> 'source_html', m ->> 'source_pdf_path', coalesce(m ->> 'deliverable', 'text_audio'),
    coalesce(m ->> 'priority', 'normal'), v_receipt,
    coalesce((m ->> 'reminder_minutes')::int, 15), coalesce((m ->> 'escalate_to_manager')::boolean, false),
    m ->> 'feed_record_id', auth.uid()
  ) returning id into v_material;

  -- مجموع مدد القالب الكامل (داخل وقت التنفيذ)
  select coalesce(sum(coalesce((p -> 'stage_minutes' ->> ws.key)::numeric, 0)), 0)
    into v_template_total
  from public.workflow_stages ws where ws.is_active and not ws.outside_sla;
  if v_template_total <= 0 then raise exception 'حدد مدة المراحل'; end if;

  for v_lang in select * from jsonb_array_elements(p -> 'languages') loop
    if not exists (select 1 from public.languages where code = v_lang ->> 'code' and is_active) then
      raise exception 'اللغة غير مفعّلة: %', v_lang ->> 'code';
    end if;

    select array_agg(s ->> 'key') into v_keys from jsonb_array_elements(v_lang -> 'stages') s;

    -- المراحل الأساسية إلزامية
    for v_ws in select * from public.workflow_stages where is_active and is_required loop
      if not (v_ws.key = any (coalesce(v_keys, '{}'))) then
        raise exception 'مرحلة «%» أساسية ولا يمكن تجاوزها (%)', v_ws.name_ar, v_lang ->> 'code';
      end if;
    end loop;

    select coalesce(sum(coalesce((p -> 'stage_minutes' ->> ws.key)::numeric, 0)), 0)
      into v_chosen_total
    from public.workflow_stages ws
    where ws.key = any (v_keys) and not ws.outside_sla;
    v_factor := case when v_chosen_total > 0 then v_template_total / v_chosen_total else 1 end;

    insert into public.tracks (material_id, language_code, receipt_due_at)
    values (v_material, v_lang ->> 'code', now() + make_interval(mins => v_receipt))
    returning id into v_track;

    for v_stage in select * from jsonb_array_elements(v_lang -> 'stages') loop
      select * into v_ws from public.workflow_stages where key = v_stage ->> 'key' and is_active;
      if not found then raise exception 'مرحلة غير معروفة: %', v_stage ->> 'key'; end if;

      select * into v_assignee from public.profiles
      where id = nullif(v_stage ->> 'assignee', '')::uuid and status = 'active';
      if not found then
        raise exception 'اختر مسؤولًا مفعّلًا لمرحلة «%» (%)', v_ws.name_ar, v_lang ->> 'code';
      end if;

      if v_ws.assignee_role = 'translator' and not exists (
        select 1 from public.member_languages
        where member_id = v_assignee.id and language_code = v_lang ->> 'code'
      ) then
        raise exception '«%» غير مؤهل في هذه اللغة (%)', v_assignee.full_name, v_lang ->> 'code';
      end if;
      if v_ws.assignee_role = 'coordinator' and v_assignee.role not in ('coordinator', 'manager') then
        raise exception 'مرحلة «%» تُسند لمنسق', v_ws.name_ar;
      end if;
      if v_ws.assignee_role = 'manager' and v_assignee.role <> 'manager' then
        raise exception 'مرحلة «%» تُسند لمدير المشروع', v_ws.name_ar;
      end if;

      v_minutes := case when v_ws.outside_sla then 0
                        else round(coalesce((p -> 'stage_minutes' ->> v_ws.key)::numeric, 0) * v_factor) end;

      insert into public.track_stages (track_id, stage_key, sort, assignee_id, planned_minutes, outside_sla)
      values (v_track, v_ws.key, v_ws.sort, v_assignee.id, v_minutes::int, v_ws.outside_sla);
    end loop;

    perform public.log_event(v_track, 'assigned', null, null, null);
  end loop;

  return v_material;
end $$;

-- ---------------------------------------------------------------------
-- تفعيل مرحلة: العدّاد يبدأ من لحظة التفعيل لا من إرسال المادة
-- ---------------------------------------------------------------------
create or replace function public.activate_stage(p_stage uuid)
returns void language sql security definer set search_path = public as $$
  update public.track_stages set
    status      = 'active',
    started_at  = now(),
    due_at      = case when outside_sla then null else now() + make_interval(mins => planned_minutes) end,
    finished_at = null,
    rounds      = rounds + 1
  where id = p_stage;
  update public.tracks t set
    current_stage_id = p_stage,
    status = case when s.outside_sla then 'awaiting_approval'::public.track_status else 'in_progress'::public.track_status end
  from public.track_stages s where s.id = p_stage and t.id = s.track_id;
$$;

create or replace function public.current_stage(p_track uuid)
returns public.track_stages language sql stable security definer set search_path = public as $$
  select s.* from public.track_stages s join public.tracks t on t.current_stage_id = s.id
  where t.id = p_track and s.status = 'active'
$$;

-- الاستلام: يقبله مسؤول المرحلة الأولى
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
    receipt_late_seconds = greatest(0, extract(epoch from now() - receipt_due_at))::int
  where id = p_track;
  perform public.activate_stage(v_first.id);
  perform public.log_event(p_track, 'accepted', v_first.stage_key, null, null);
end $$;

-- حفظ مسودة الترجمة
create or replace function public.save_translation(p_track uuid, p_html text)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.track_stages; v_ws public.workflow_stages;
begin
  v_s := public.current_stage(p_track);
  if v_s.id is null or v_s.assignee_id is distinct from auth.uid() then
    raise exception 'التعديل متاح لمسؤول المرحلة الحالية فقط' using errcode = '42501';
  end if;
  select * into v_ws from public.workflow_stages where key = v_s.stage_key;
  if v_ws.assignee_role <> 'translator' then
    raise exception 'هذه المرحلة للمراجعة والقبول، لا لتعديل النص';
  end if;
  update public.tracks set translation_html = p_html where id = p_track;
  perform public.log_event(p_track, 'edited', v_s.stage_key, null, null);
end $$;

-- ربط ملف الصوت بعد رفعه إلى التخزين
create or replace function public.set_track_audio(p_track uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.track_stages;
begin
  v_s := public.current_stage(p_track);
  if v_s.id is null or v_s.assignee_id is distinct from auth.uid() then
    raise exception 'رفع التسجيل متاح لمسؤول المرحلة الحالية فقط' using errcode = '42501';
  end if;
  if (select deliverable from public.materials m join public.tracks t on t.material_id = m.id where t.id = p_track) <> 'text_audio' then
    raise exception 'هذه المادة لا تتطلب تسجيلًا صوتيًا';
  end if;
  update public.tracks set audio_path = p_path where id = p_track;
  perform public.log_event(p_track, 'audio_uploaded', v_s.stage_key, null, null);
end $$;

-- التحقق قبل الإتمام: تستدعيه الواجهة قبل إظهار نافذة التأكيد، ويستدعيه complete_stage أيضًا
create or replace function public.stage_blockers(p_track uuid, p_checklist boolean default false)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_s public.track_stages; v_ws public.workflow_stages; v_t public.tracks; v_m public.materials;
  v_out text[] := '{}';
begin
  v_s := public.current_stage(p_track);
  if v_s.id is null then return array['لا توجد مرحلة نشطة']; end if;
  select * into v_ws from public.workflow_stages where key = v_s.stage_key;
  select * into v_t  from public.tracks where id = p_track;
  select * into v_m  from public.materials where id = v_t.material_id;

  if v_s.assignee_id is distinct from auth.uid() then
    v_out := array_append(v_out, 'الإتمام لمسؤول المرحلة الحالية فقط');
  end if;
  if length(public.plain_text(v_t.translation_html)) = 0 then
    v_out := array_append(v_out, 'أدخل الترجمة كاملة قبل التسليم');
  end if;
  if v_ws.assignee_role = 'coordinator' then
    if not p_checklist then v_out := array_append(v_out, 'أكّد أنك تحققت من اكتمال الترجمة'); end if;
    if v_m.deliverable = 'text_audio' and v_t.audio_path is null then
      v_out := array_append(v_out, 'التسجيل الصوتي مطلوب لهذه المادة ولم يُرفع بعد');
    end if;
  end if;
  return v_out;
end $$;

-- إتمام المرحلة والانتقال للتالية
create or replace function public.complete_stage(p_track uuid, p_checklist boolean default false, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s public.track_stages; v_next public.track_stages; v_blockers text[];
begin
  perform 1 from public.tracks where id = p_track for update;
  v_blockers := public.stage_blockers(p_track, p_checklist);
  if array_length(v_blockers, 1) > 0 then raise exception '%', array_to_string(v_blockers, '، '); end if;

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

-- إعادة لمرحلة سابقة (السبب إلزامي)
create or replace function public.return_stage(p_track uuid, p_target text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.track_stages; v_target public.track_stages;
begin
  perform 1 from public.tracks where id = p_track for update;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'اكتب سبب الإعادة'; end if;
  v_s := public.current_stage(p_track);
  if v_s.id is null then raise exception 'لا توجد مرحلة نشطة'; end if;
  if v_s.assignee_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select * into v_target from public.track_stages where track_id = p_track and stage_key = p_target;
  if v_target.id is null or v_target.sort >= v_s.sort then
    raise exception 'الإعادة تكون لمرحلة سابقة فقط';
  end if;

  -- التأخير الذي وقع في المرحلة الحالية قبل إعادتها يُحفظ
  update public.track_stages set
    status = 'waiting', started_at = null, due_at = null, finished_at = null,
    late_seconds = case when id = v_s.id and not outside_sla and due_at is not null
                        then coalesce(late_seconds, 0) + greatest(0, extract(epoch from now() - due_at))::int
                        else late_seconds end
  where track_id = p_track and sort > v_target.sort and sort <= v_s.sort;

  perform public.activate_stage(v_target.id);
  perform public.log_event(p_track, 'returned', v_s.stage_key, p_target, p_reason);
end $$;

-- إدارة النشر (المدير)
create or replace function public.set_published(p_track uuid, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'النشر بيد مدير المشروع' using errcode = '42501'; end if;
  update public.tracks set is_published = p_published,
    published_at = case when p_published then now() else null end
  where id = p_track and status = 'completed';
  if not found then raise exception 'لا يُنشر إلا مسار مكتمل'; end if;
  perform public.log_event(p_track, case when p_published then 'published' else 'unpublished' end, null, null, null);
end $$;

-- ---------------------------------------------------------------------
-- الموقع العام: الترجمات المنشورة فقط، بأعمدة آمنة
-- ---------------------------------------------------------------------
create or replace function public.public_translations(p_mosque text default null, p_limit int default 100)
returns table (
  track_id uuid, material_id uuid, title text, sermon_type text, mosque text, khateeb text,
  sermon_date date, feed_record_id text, language_code text, language_name text, dir text,
  translation_html text, audio_path text, published_at timestamptz
) language sql stable security definer set search_path = public as $$
  select t.id, m.id, m.title, m.sermon_type, m.mosque, k.name, m.sermon_date, m.feed_record_id,
         l.code, l.name_ar, l.dir, t.translation_html, t.audio_path, t.published_at
  from public.tracks t
  join public.materials m on m.id = t.material_id
  join public.languages l on l.code = t.language_code
  left join public.khateebs k on k.id = m.khateeb_id
  where t.is_published and (p_mosque is null or m.mosque = p_mosque)
  order by t.published_at desc
  limit least(greatest(p_limit, 1), 500)
$$;

-- ---------------------------------------------------------------------
-- الصلاحيات على مستوى الصفوف
-- ---------------------------------------------------------------------
alter table public.languages        enable row level security;
alter table public.khateebs         enable row level security;
alter table public.workflow_stages  enable row level security;
alter table public.profiles         enable row level security;
alter table public.profile_private  enable row level security;
alter table public.member_languages enable row level security;
alter table public.materials        enable row level security;
alter table public.tracks           enable row level security;
alter table public.track_stages     enable row level security;
alter table public.track_events     enable row level security;

-- مرجعية: يقرؤها الجميع، ويعدّلها المنسق والمدير (سير العمل للمدير فقط)
create policy "read languages" on public.languages for select using (true);
create policy "admin writes languages" on public.languages for all using (public.is_admin()) with check (public.is_admin());
create policy "read khateebs" on public.khateebs for select using (true);
create policy "admin writes khateebs" on public.khateebs for all using (public.is_admin()) with check (public.is_admin());
create policy "read stages" on public.workflow_stages for select using (true);
create policy "manager writes stages" on public.workflow_stages for all using (public.is_manager()) with check (public.is_manager());

-- الأعضاء: كل عضو مفعّل يرى أسماء الفريق؛ الكتابة عبر الدوال فقط
-- المنسق والمدير يرون طلبات التسجيل؛ بقية الفريق يرون الأعضاء المفعّلين فقط
create policy "see profiles" on public.profiles for select
  using (id = auth.uid() or public.is_admin() or (public.my_role() is not null and status = 'active'));
create policy "update own name" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy "see private" on public.profile_private for select
  using (id = auth.uid() or public.is_admin());
create policy "edit own private" on public.profile_private for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy "see member languages" on public.member_languages for select
  using (member_id = auth.uid() or public.my_role() is not null);

-- العمل: الإدارة ترى الكل، والمترجم يرى ما أُسند إليه فقط
create policy "see materials" on public.materials for select using (
  public.is_admin() or exists (
    select 1 from public.tracks t join public.track_stages s on s.track_id = t.id
    where t.material_id = materials.id and s.assignee_id = auth.uid()
  )
);
create policy "see tracks" on public.tracks for select using (public.can_see_track(id));
create policy "see track stages" on public.track_stages for select using (public.can_see_track(track_id));
create policy "see track events" on public.track_events for select using (public.can_see_track(track_id));
-- لا توجد سياسات إدراج أو تعديل أو حذف لهذه الجداول: كل تغيير يمر بالدوال أعلاه.

-- تنفيذ الدوال
revoke execute on all functions in schema public from public, anon;
grant execute on function public.public_translations(text, int) to anon, authenticated;
-- دوال الصلاحيات تُقيَّم داخل السياسات حتى للزائر، وتعيد «لا» له
grant execute on function public.my_role(), public.is_admin(), public.is_manager(),
  public.can_see_track(uuid), public.plain_text(text) to anon;
grant execute on function
  public.my_role(), public.is_admin(), public.is_manager(), public.can_see_track(uuid),
  public.admin_update_member(uuid, public.member_status, public.app_role, text[]),
  public.create_material(jsonb), public.accept_track(uuid), public.save_translation(uuid, text),
  public.set_track_audio(uuid, text), public.stage_blockers(uuid, boolean),
  public.complete_stage(uuid, boolean, text), public.return_stage(uuid, text, text),
  public.set_published(uuid, boolean)
to authenticated;
-- دوال داخلية لا تُستدعى من الواجهة
revoke execute on function public.activate_stage(uuid), public.log_event(uuid, text, text, text, text),
  public.current_stage(uuid), public.handle_new_user() from authenticated;

-- ---------------------------------------------------------------------
-- التخزين
--   sources      : ملفات PDF العربية — للفريق
--   audio        : التسجيلات — قراءة عامة بمسارات غير قابلة للتخمين، والكتابة لمسؤول المرحلة
--   private-docs : صور الإقامة — لصاحبها والمنسق والمدير فقط
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('sources', 'sources', false),
  ('audio', 'audio', true),
  ('private-docs', 'private-docs', false)
on conflict (id) do nothing;

create policy "staff read sources" on storage.objects for select
  using (bucket_id = 'sources' and public.my_role() is not null);
create policy "admin upload sources" on storage.objects for insert
  with check (bucket_id = 'sources' and public.is_admin());

create policy "assignee uploads audio" on storage.objects for insert with check (
  bucket_id = 'audio' and exists (
    select 1 from public.track_stages s join public.tracks t on t.current_stage_id = s.id
    where t.id::text = (storage.foldername(name))[1] and s.assignee_id = auth.uid()
  )
);

create policy "own private docs" on storage.objects for select using (
  bucket_id = 'private-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);
create policy "upload own private docs" on storage.objects for insert with check (
  bucket_id = 'private-docs' and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------------
-- البيانات الأولية
-- ---------------------------------------------------------------------
insert into public.workflow_stages (key, name_ar, sort, is_required, outside_sla, assignee_role, weight) values
  ('translation',         'الترجمة',              10, true,  false, 'translator',  6),
  ('sharia_review',       'المراجعة الشرعية',      20, false, false, 'translator',  2),
  ('linguistic_review',   'المراجعة اللغوية',      30, false, false, 'translator',  2),
  ('editing',             'التحرير',               40, false, false, 'translator',  2),
  ('coordinator_receipt', 'استلام المنسق',         50, true,  false, 'coordinator', 1),
  ('manager_approval',    'اعتماد مدير المشروع',   60, false, true,  'manager',     0);

-- أسماء اللغات موحّدة بين المنصة والموقع العام
insert into public.languages (code, name_ar, native_name, dir, is_core, sort) values
  ('en',  'الإنجليزية',   'English',          'ltr', true, 1),
  ('ur',  'الأردية',      'اردو',             'rtl', true, 2),
  ('fr',  'الفرنسية',     'Français',         'ltr', true, 3),
  ('fa',  'الفارسية',     'فارسی',            'rtl', true, 4),
  ('ms',  'الملايوية',    'Bahasa Melayu',    'ltr', true, 5),
  ('id',  'الإندونيسية',  'Bahasa Indonesia', 'ltr', true, 6),
  ('ru',  'الروسية',      'Русский',          'ltr', true, 7),
  ('tr',  'التركية',      'Türkçe',           'ltr', true, 8),
  ('zh',  'الصينية',      '中文',              'ltr', true, 9),
  ('bn',  'البنغالية',    'বাংলা',             'ltr', true, 10),
  ('ha',  'الهوسا',       'Hausa',            'ltr', true, 11),
  ('es',  'الإسبانية',    'Español',          'ltr', true, 12),
  ('pt',  'البرتغالية',   'Português',        'ltr', true, 13),
  ('it',  'الإيطالية',    'Italiano',         'ltr', false, 20),
  ('de',  'الألمانية',    'Deutsch',          'ltr', false, 21),
  ('bs',  'البوسنية',     'Bosanski',         'ltr', false, 22),
  ('nl',  'الهولندية',    'Nederlands',       'ltr', false, 23),
  ('sv',  'السويدية',     'Svenska',          'ltr', false, 24),
  ('sq',  'الألبانية',    'Shqip',            'ltr', false, 25),
  ('fil', 'الفلبينية',    'Filipino',         'ltr', false, 26),
  ('hi',  'الهندية',      'हिन्दी',             'ltr', false, 27),
  ('ne',  'النيبالية',    'नेपाली',             'ltr', false, 28),
  ('th',  'التايلندية',   'ไทย',               'ltr', false, 29),
  ('tg',  'الطاجيكية',    'Тоҷикӣ',           'ltr', false, 30),
  ('km',  'الكمبودية',    'ខ្មែរ',              'ltr', false, 31),
  ('az',  'الأذرية',      'Azərbaycanca',     'ltr', false, 32),
  ('uz',  'الأوزبكية',    'Oʻzbekcha',        'ltr', false, 33),
  ('ja',  'اليابانية',    '日本語',             'ltr', false, 34),
  ('ko',  'الكورية',      '한국어',             'ltr', false, 35),
  ('ku',  'الكردية',      'کوردی',            'rtl', false, 36),
  ('bal', 'البلوشية',     'بلوچی',            'rtl', false, 37),
  ('pa',  'البنجابية',    'پنجابی',           'rtl', false, 38),
  ('ml',  'المليبارية',   'മലയാളം',            'ltr', false, 39),
  ('ky',  'القيرغيزية',   'Кыргызча',         'ltr', false, 40),
  ('my',  'البورمية',     'မြန်မာ',              'ltr', false, 41),
  ('vi',  'الفيتنامية',   'Tiếng Việt',       'ltr', false, 42),
  ('ps',  'البشتو',       'پښتو',             'rtl', false, 43),
  ('ta',  'التاميلية',    'தமிழ்',             'ltr', false, 44),
  ('so',  'الصومالية',    'Soomaali',         'ltr', false, 45),
  ('sw',  'السواحلية',    'Kiswahili',        'ltr', false, 46),
  ('am',  'الأمهرية',     'አማርኛ',             'ltr', false, 47),
  ('yo',  'اليورباوية',   'Yorùbá',           'ltr', false, 48),
  ('ff',  'الفلاتية',     'Fulfulde',         'ltr', false, 49),
  ('kr',  'الكانوري',     'Kanuri',           'ltr', false, 50),
  ('dje', 'الزبرماوية',   'Zarma',            'ltr', false, 51),
  ('bm',  'البامبارية',   'Bamanankan',       'ltr', false, 52),
  ('ig',  'الإيبو',       'Igbo',             'ltr', false, 53),
  ('igl', 'إغالا',        'Igala',            'ltr', false, 54),
  ('dyo', 'جولا',         'Jóola',            'ltr', false, 55),
  ('wo',  'الولوفية',     'Wolof',            'ltr', false, 56);

insert into public.khateebs (name, mosque, sort) values
  ('فضيلة الشيخ الدكتور صالح بن عبدالله بن حميد', 'makkah', 1),
  ('فضيلة الشيخ الدكتور عبدالرحمن بن عبدالعزيز السديس', 'makkah', 2),
  ('فضيلة الشيخ الدكتور أسامة بن عبدالله خياط', 'makkah', 3),
  ('فضيلة الشيخ الدكتور ماهر بن حمد المعيقلي', 'makkah', 4),
  ('فضيلة الشيخ الدكتور عبدالله بن عواد الجهني', 'makkah', 5),
  ('فضيلة الشيخ الدكتور فيصل بن جميل غزاوي', 'makkah', 6),
  ('فضيلة الشيخ الدكتور بندر بن عبدالعزيز بليلة', 'makkah', 7),
  ('فضيلة الشيخ الدكتور ياسر بن راشد الدوسري', 'makkah', 8),
  ('فضيلة الشيخ الدكتور بدر بن محمد التركي', 'makkah', 9),
  ('فضيلة الشيخ الدكتور الوليد بن خالد الشمسان', 'makkah', 10),
  ('فضيلة الشيخ الدكتور عبدالله بن عبدالرحمن البعيجان', 'madinah', 1),
  ('فضيلة الشيخ الدكتور صلاح بن محمد البدير', 'madinah', 2),
  ('فضيلة الشيخ الدكتور حسين بن عبدالعزيز آل الشيخ', 'madinah', 3),
  ('فضيلة الشيخ الدكتور علي بن عبدالرحمن الحذيفي', 'madinah', 4),
  ('فضيلة الشيخ الدكتور عبدالباري بن عواض الثبيتي', 'madinah', 5),
  ('فضيلة الشيخ الدكتور عبدالمحسن بن محمد القاسم', 'madinah', 6),
  ('فضيلة الشيخ الدكتور خالد بن سليمان المهنا', 'madinah', 7),
  ('فضيلة الشيخ الدكتور أحمد بن علي الحذيفي', 'madinah', 8),
  ('فضيلة الشيخ الدكتور محمد بن أحمد برهجي', 'madinah', 9),
  ('فضيلة الشيخ الدكتور عبدالله بن عبدالمحسن القرافي', 'madinah', 10),
  ('فضيلة الشيخ الدكتور صالح بن عواد المغامسي', 'madinah', 11),
  ('فضيلة الشيخ الدكتور أحمد بن طالب بن حميد', 'madinah', 12);

-- ---------------------------------------------------------------------
-- بعد تشغيل هذا الملف وإنشاء حسابك من شاشة التسجيل، فعّل نفسك مديرًا للمشروع:
--   update public.profiles set role = 'manager', status = 'active' where email = 'بريدك@example.com';
-- ---------------------------------------------------------------------
