-- =====================================================================
-- ٠١٢٨ — تعديلُ الأصل بعد الإسناد، والهويةُ البصريةُ بإصداراتها،
--        وتعيينُ مشرف اللغة بصلاحية، وإسنادُ لغة مقطع البثّ
--        (ملاحظات ٤٥٨ و٤٥٩ و٤٦٠ و٤٦١ و٤٦٦)
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) تعيينُ مشرف اللغة صلاحيةٌ تُمنَح (ملاحظة ٤٥٩)
--
--   كان بيد مدير المشروع وحدَه، فيُستحدَث له مفتاحٌ مغلقٌ بأصله
--   يفتحه المديرُ لمن يشاء من المنسقين. والشرطُ باقٍ: لا يُعيَّن
--   مشرفًا إلا من اعتُمدت له تلك اللغة.
-- ---------------------------------------------------------------------
insert into public.perm_keys (key, label, sort, parent, grp, default_open, sensitive, viewable)
values ('lang_sup_set', 'تعيينُ مشرف اللغة', 168, 'team', 'الأعضاء', false, false, false)
on conflict (key) do update
  set label = excluded.label, sort = excluded.sort,
      parent = excluded.parent, grp = excluded.grp;

create or replace function public.may_set_lang_sup()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_manager() or public.has_perm('lang_sup_set')
$$;
grant execute on function public.may_set_lang_sup() to authenticated;

do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_lang_supervisor' limit 1;
  if v_src is null then raise exception 'set_lang_supervisor غيرُ موجودة'; end if;
  v_new := replace(v_src, 'if not public.is_manager() then',
                          'if not public.may_set_lang_sup() then');
  if v_new = v_src then raise exception 'لم يُعثر على شرط المدير في set_lang_supervisor'; end if;
  execute v_new;
end $do$;

-- ---------------------------------------------------------------------
-- ٢) تعديلُ الأصل والعملُ جارٍ (ملاحظتا ٤٦٠ و٤٦١)
--
--   في المنصة بابٌ قائمٌ لتعديل الأصل: جولةُ تعديلٍ فيها نسخةٌ جديدةٌ
--   من ملفِّ الشيخ أو تظليلٌ على الأصل أو ملاحظةٌ نصّية (٠٠٠٤). غير
--   أنَّ ذلك البابَ يُعيد المراحلَ إلى أهلها ويُبطل ما بعدها — وهو
--   المرادُ بعد الاعتماد. وأمّا إذا ورد التعديلُ **والترجمةُ جارية**
--   فلا يُعاد شيءٌ ولا يُبطَل عمل: إنما يُخبَر أهلُ المادة فيُصحّحون
--   وهم في مواضعهم. فجُعلت للجولة صفةُ «إخبارٍ» لا إعادة.
-- ---------------------------------------------------------------------
alter table public.material_revisions
  add column if not exists is_notice   boolean not null default false,
  add column if not exists notified_at timestamptz;

comment on column public.material_revisions.is_notice is
  'جولةُ إخبارٍ بتعديل الأصل والعملُ جارٍ: لا تُعيد مرحلةً ولا تُبطل عملًا (ملاحظة ٤٦٠)';

-- إقرارُ الاطّلاع: يُقيَّد باسمه ووقته، وبه يسكت الشريط عن صاحبه
create table if not exists public.revision_acks (
  revision_id uuid not null references public.material_revisions (id) on delete cascade,
  member_id   uuid not null references public.profiles (id) on delete cascade,
  acked_at    timestamptz not null default now(),
  primary key (revision_id, member_id)
);
alter table public.revision_acks enable row level security;
drop policy if exists "see own revision acks" on public.revision_acks;
create policy "see own revision acks" on public.revision_acks for select
  using (member_id = auth.uid() or public.is_admin());
grant select on public.revision_acks to authenticated;

-- نوعٌ جديدٌ في طابور الإشعارات، يُضاف إلى الأنواع القائمة ولا يُلغيها
do $do$
declare v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relname = 'notifications'
     and c.conname = 'notifications_kind_check';
  if v_def is null then
    alter table public.notifications add constraint notifications_kind_check
      check (kind in ('assigned', 'track_completed', 'returned', 'source_changed'));
    return;
  end if;
  if position('source_changed' in v_def) > 0 then return; end if;
  alter table public.notifications drop constraint notifications_kind_check;
  execute 'alter table public.notifications add constraint notifications_kind_check '
    || replace(v_def, 'ARRAY[', 'ARRAY[''source_changed''::text, ');
end $do$;

-- ـــ فتحُ جولة إخبار: لا تمسُّ مرحلةً ولا تُبطل عملًا
create or replace function public.open_notice(
  p_material uuid, p_mode text, p_note text default null, p_source uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_rev uuid; v_round int;
begin
  if not public.is_admin() then
    raise exception 'تعديلُ الأصل للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if p_mode not in ('annotate', 'new_source', 'note') then
    raise exception 'نوعُ التعديل غيرُ معروف';
  end if;
  if p_mode = 'note' and length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'اكتبْ بيانَ التعديل';
  end if;
  perform 1 from public.materials where id = p_material and deleted_at is null for update;
  if not found then raise exception 'الخطبة غير موجودة'; end if;
  -- جولةُ إخبارٍ مفتوحةٌ تُستكمَل ولا تُستأنَف غيرُها
  select id into v_rev from public.material_revisions
   where material_id = p_material and is_notice and closed_at is null
     and notified_at is null and created_by = auth.uid()
   order by round desc limit 1;
  if v_rev is not null then
    update public.material_revisions
       set mode = p_mode, note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note),
           source_id = coalesce(p_source, source_id)
     where id = v_rev;
    return v_rev;
  end if;
  select coalesce(max(round), 0) + 1 into v_round
    from public.material_revisions where material_id = p_material;
  insert into public.material_revisions
    (material_id, round, mode, note, source_id, is_notice, created_by)
  values (p_material, v_round, p_mode, nullif(btrim(coalesce(p_note, '')), ''),
          p_source, true, auth.uid())
  returning id into v_rev;
  return v_rev;
end $$;
grant execute on function public.open_notice(uuid, text, text, uuid) to authenticated;

-- ـــ إرسالُ الإخبار: يصل كلَّ من بيده مرحلةٌ لم تُنجَز في أيِّ لغة
create or replace function public.send_notice(p_revision uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_r public.material_revisions; v_title text; v_n int := 0; v_who record;
        v_body text; v_marks int;
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into v_r from public.material_revisions where id = p_revision;
  if not found or not v_r.is_notice then raise exception 'جولةُ الإخبار غيرُ موجودة'; end if;
  if v_r.notified_at is not null then raise exception 'أُرسل هذا التعديلُ من قبل'; end if;
  select count(*) into v_marks from public.revision_marks where revision_id = p_revision;
  if v_r.mode = 'annotate' and v_marks = 0 then
    raise exception 'ظلِّلْ موضعَ التعديل على الأصل أولًا';
  end if;
  select title into v_title from public.materials where id = v_r.material_id;

  v_body := 'وردَ تعديلٌ على أصل المادة «' || coalesce(v_title, '') || '»: '
    || case v_r.mode
         when 'new_source' then 'رُفعت نسخةٌ جديدةٌ من الأصل.'
         when 'annotate'   then 'ظُلِّل ' || v_marks::text || ' موضعًا على الأصل.'
         else 'ملاحظةٌ من المنسق.' end
    || coalesce(' ' || v_r.note, '')
    || ' افتحْ عملَك في المنصة لتطّلع عليه — والعملُ ماضٍ، لم تُعدْ مرحلةٌ إلى أحد.';

  for v_who in
    select distinct s.assignee_id as id, t.id as track_id
      from public.tracks t
      join public.track_stages s on s.track_id = t.id
     where t.material_id = v_r.material_id and t.deleted_at is null
       and t.status <> 'completed' and s.status <> 'done'
       and s.assignee_id is not null and s.assignee_id <> auth.uid()
  loop
    perform public.enqueue_notification(v_who.id, 'source_changed',
      'وردَ تعديلٌ على الأصل — ' || coalesce(v_title, ''), v_body, v_who.track_id);
    perform public.log_event(v_who.track_id, 'source_changed', null, null,
      coalesce(v_r.note, 'تعديلٌ على الأصل'));
    v_n := v_n + 1;
  end loop;

  update public.material_revisions set notified_at = now() where id = p_revision;
  return v_n;
end $$;
grant execute on function public.send_notice(uuid) to authenticated;

-- ـــ ما يراه صاحبُ العمل: الإخباراتُ المرسلةُ في مادةٍ بيده ولم يُقرَّ بها
create or replace function public.my_notices(p_material uuid default null)
returns table (id uuid, material_id uuid, material_title text, mode text, note text,
               marks int, source_path text, by_name text, sent_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.material_id, m.title, r.mode, r.note,
         (select count(*)::int from public.revision_marks k where k.revision_id = r.id),
         (select s.path from public.material_sources s where s.id = r.source_id),
         p.full_name, r.notified_at
    from public.material_revisions r
    join public.materials m on m.id = r.material_id
    left join public.profiles p on p.id = r.created_by
   where r.is_notice and r.notified_at is not null and r.closed_at is null
     and (p_material is null or r.material_id = p_material)
     and r.created_by is distinct from auth.uid()
     and not exists (select 1 from public.revision_acks a
                      where a.revision_id = r.id and a.member_id = auth.uid())
     and exists (
       select 1 from public.tracks t
         join public.track_stages s on s.track_id = t.id
        where t.material_id = r.material_id and t.deleted_at is null
          and t.status <> 'completed' and s.status <> 'done'
          and s.assignee_id = auth.uid())
   order by r.notified_at desc
$$;
grant execute on function public.my_notices(uuid) to authenticated;

-- وتظليلاتُ جولةٍ بعينها، يراها من يرى المادة
create or replace function public.notice_marks(p_revision uuid)
returns table (id uuid, page int, x numeric, y numeric, w numeric, h numeric,
               kind text, note text)
language sql stable security definer set search_path = public as $$
  select k.id, k.page, k.x, k.y, k.w, k.h, k.kind, k.note
    from public.revision_marks k
    join public.material_revisions r on r.id = k.revision_id
   where k.revision_id = p_revision and public.can_see_material(r.material_id)
   order by k.page, k.created_at
$$;
grant execute on function public.notice_marks(uuid) to authenticated;

-- ـــ إقرارُ الاطّلاع
create or replace function public.ack_notice(p_revision uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if not exists (select 1 from public.material_revisions r
                  where r.id = p_revision and r.is_notice and r.notified_at is not null) then
    raise exception 'جولةُ الإخبار غيرُ موجودة';
  end if;
  insert into public.revision_acks (revision_id, member_id)
  values (p_revision, auth.uid()) on conflict do nothing;
end $$;
grant execute on function public.ack_notice(uuid) to authenticated;

-- ومن أقرَّ به يُعرَف: يراه المنسقُ في المادة
create or replace function public.notice_acks(p_revision uuid)
returns table (member_id uuid, full_name text, acked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.member_id, p.full_name, a.acked_at
    from public.revision_acks a
    join public.profiles p on p.id = a.member_id
   where a.revision_id = p_revision and public.is_admin()
   order by a.acked_at
$$;
grant execute on function public.notice_acks(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) الهويةُ البصريةُ بإصداراتها (ملاحظة ٤٥٨)
--
--   كليشةُ الهيئة وشعارُها كانا ملفّين ثابتين في شفرة الواجهة، فإذا
--   بدّلتهما الهيئةُ رسميًّا لزم تعديلُ الشفرة. فصارا سجلًّا بإصداراتٍ
--   يبدّله مديرُ المشروع، ولا يُمحى إصدارٌ سابق: فما طُبع على إصدارٍ
--   يُعاد على إصداره كما صدر أوّلَ مرّة.
-- ---------------------------------------------------------------------
create table if not exists public.brand_assets (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('letterhead', 'logo')),
  version    int  not null,
  path       text not null,
  note       text,
  is_active  boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (kind, version)
);
create unique index if not exists brand_assets_active_idx
  on public.brand_assets (kind) where is_active;

comment on table public.brand_assets is
  'كليشةُ الهيئة وشعارُها بإصداراتهما — لا يُمحى إصدارٌ سابق (ملاحظة ٤٥٨)';

alter table public.brand_assets enable row level security;
drop policy if exists "see brand assets" on public.brand_assets;
create policy "see brand assets" on public.brand_assets for select
  using (public.my_role() is not null);
grant select on public.brand_assets to authenticated;

create or replace function public.set_brand_asset(p_kind text, p_path text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_v int; v_id uuid;
begin
  if not public.is_manager() then
    raise exception 'تبديلُ هوية الهيئة لمدير المشروع' using errcode = '42501';
  end if;
  if p_kind not in ('letterhead', 'logo') then raise exception 'نوعٌ غيرُ معروف'; end if;
  if nullif(btrim(coalesce(p_path, '')), '') is null then raise exception 'ارفعِ الصورةَ أولًا'; end if;
  select coalesce(max(version), 0) + 1 into v_v from public.brand_assets where kind = p_kind;
  update public.brand_assets set is_active = false where kind = p_kind and is_active;
  insert into public.brand_assets (kind, version, path, note, created_by)
  values (p_kind, v_v, btrim(p_path), nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.set_brand_asset(text, text, text) to authenticated;

-- وللرجوع: يُعاد إصدارٌ سابقٌ فيصير هو العامل
create or replace function public.restore_brand_asset(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_a public.brand_assets;
begin
  if not public.is_manager() then
    raise exception 'تبديلُ هوية الهيئة لمدير المشروع' using errcode = '42501';
  end if;
  select * into v_a from public.brand_assets where id = p_id;
  if not found then raise exception 'الإصدارُ غيرُ موجود'; end if;
  update public.brand_assets set is_active = false where kind = v_a.kind and is_active;
  update public.brand_assets set is_active = true where id = p_id;
end $$;
grant execute on function public.restore_brand_asset(uuid) to authenticated;

create or replace function public.brand_current()
returns table (kind text, version int, path text)
language sql stable security definer set search_path = public as $$
  select b.kind, b.version, b.path from public.brand_assets b
   where b.is_active and public.my_role() is not null
$$;
grant execute on function public.brand_current() to authenticated;

create or replace function public.brand_history(p_kind text)
returns table (id uuid, version int, path text, note text, is_active boolean,
               by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.id, b.version, b.path, b.note, b.is_active, p.full_name, b.created_at
    from public.brand_assets b
    left join public.profiles p on p.id = b.created_by
   where b.kind = p_kind and public.is_admin()
   order by b.version desc
$$;
grant execute on function public.brand_history(text) to authenticated;

-- ووسمُ ما يُنتَج بإصدار الكليشة الذي اعتُمد عليه، فيُعاد كما صدر
alter table public.tracks        add column if not exists brand_version int;
alter table public.arch_versions add column if not exists brand_version int;

create or replace function public.active_brand_version()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select version from public.brand_assets
                    where kind = 'letterhead' and is_active), 1)
$$;
grant execute on function public.active_brand_version() to authenticated;

create or replace function public.stamp_brand_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.brand_version is null then
    new.brand_version := public.active_brand_version();
  end if;
  return new;
end $$;

drop trigger if exists stamp_brand_on_track on public.tracks;
create trigger stamp_brand_on_track before insert on public.tracks
  for each row execute function public.stamp_brand_version();

drop trigger if exists stamp_brand_on_version on public.arch_versions;
create trigger stamp_brand_on_version before insert on public.arch_versions
  for each row execute function public.stamp_brand_version();

-- ---------------------------------------------------------------------
-- ٤) إسنادُ لغة مقطع البثّ بيد المنسق (ملاحظة ٤٦٦)
--
--   لغةُ المقطع تُستنبَط من عنوانه في القناة، فإن أعيا العنوانُ
--   المنصةَ أسندها المنسقُ بيده مرةً واحدةً فتُحفَظ.
-- ---------------------------------------------------------------------
create table if not exists public.stream_video_langs (
  video_id      text primary key,
  language_code text not null references public.languages (code),
  set_by        uuid references public.profiles (id),
  set_at        timestamptz not null default now()
);

alter table public.stream_video_langs enable row level security;
drop policy if exists "read video langs" on public.stream_video_langs;
create policy "read video langs" on public.stream_video_langs for select using (true);
grant select on public.stream_video_langs to anon, authenticated;

comment on table public.stream_video_langs is
  'إسنادُ لغةٍ لمقطع بثٍّ بعينه حين يُعيي العنوانُ المنصةَ (ملاحظة ٤٦٦)';

create or replace function public.set_video_lang(p_video text, p_lang text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'إسنادُ لغة المقطع للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_video, '')), '') is null then raise exception 'لا مقطعَ'; end if;
  if p_lang is null then
    delete from public.stream_video_langs where video_id = btrim(p_video);
    return;
  end if;
  if not exists (select 1 from public.languages where code = p_lang) then
    raise exception 'لغةٌ غيرُ مسجَّلة';
  end if;
  insert into public.stream_video_langs (video_id, language_code, set_by)
  values (btrim(p_video), p_lang, auth.uid())
  on conflict (video_id) do update
    set language_code = excluded.language_code, set_by = excluded.set_by, set_at = now();
end $$;
grant execute on function public.set_video_lang(text, text) to authenticated;

create or replace function public.video_langs()
returns table (video_id text, language_code text)
language sql stable security definer set search_path = public as $$
  select v.video_id, v.language_code from public.stream_video_langs v
$$;
grant execute on function public.video_langs() to anon, authenticated;
