-- =====================================================================
-- 0006 — تقييم أداء الأعضاء، وإقرار سياسة السرية (ملاحظة ٥٧)
--   التقييم: مؤشرات تلقائية من سجل العمل + درجة يدوية من المنسق والمدير.
--   الاطلاع على التقييم للمنسقين ومدير المشروع فقط؛ لا يراه المترجم.
--   إقرار السرية: يُعرض عند أول دخول بعد التفعيل، ويُحفظ بالنسخة والاسم والتاريخ.
-- =====================================================================

-- ---------------------------------------------------------------------
-- التقييم اليدوي
-- ---------------------------------------------------------------------
create table if not exists public.member_ratings (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.profiles (id) on delete cascade,
  rater_id   uuid not null references public.profiles (id),
  track_id   uuid references public.tracks (id) on delete set null,
  stage_key  text references public.workflow_stages (key) on update cascade,
  score      int  not null check (score between 1 and 5),
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists member_ratings_member_idx on public.member_ratings (member_id, created_at desc);

alter table public.member_ratings enable row level security;
drop policy if exists "admins read ratings" on public.member_ratings;
create policy "admins read ratings" on public.member_ratings for select using (public.is_admin());

create or replace function public.rate_member(
  p_member uuid,
  p_score  int,
  p_note   text default null,
  p_track  uuid default null,
  p_stage  text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_target public.profiles; v_id uuid;
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if p_member = auth.uid() then raise exception 'لا يقيّم العضو نفسه'; end if;
  if p_score is null or p_score < 1 or p_score > 5 then raise exception 'الدرجة من ١ إلى ٥'; end if;

  select * into v_target from public.profiles where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  -- المنسق يقيّم المترجمين، ومدير المشروع يقيّم الجميع
  if not public.is_manager() and v_target.role <> 'translator' then
    raise exception 'تقييم المنسقين والمديرين لمدير المشروع فقط' using errcode = '42501';
  end if;

  insert into public.member_ratings (member_id, rater_id, track_id, stage_key, score, note)
  values (p_member, auth.uid(), p_track, nullif(trim(coalesce(p_stage, '')), ''), p_score,
          nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

grant execute on function public.rate_member(uuid, int, text, uuid, text) to authenticated;

-- حذف تقييم: صاحبه أو مدير المشروع
create or replace function public.delete_rating(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if not public.is_manager()
     and not exists (select 1 from public.member_ratings where id = p_id and rater_id = auth.uid()) then
    raise exception 'يحذف التقييم صاحبه أو مدير المشروع' using errcode = '42501';
  end if;
  delete from public.member_ratings where id = p_id;
end $$;

grant execute on function public.delete_rating(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- المؤشرات التلقائية من سجل العمل
--   security_invoker: صلاحيات القارئ هي التي تحكم ما يعود.
-- ---------------------------------------------------------------------
create or replace view public.member_performance with (security_invoker = true) as
select
  p.id                                                                                as member_id,
  count(ts.id) filter (where ts.status = 'done')                                      as done_stages,
  count(ts.id) filter (where ts.status = 'done' and coalesce(ts.late_seconds, 0) = 0) as on_time_stages,
  count(ts.id) filter (where ts.status <> 'done')                                     as open_stages,
  coalesce(sum(ts.late_seconds), 0)::bigint                                          as late_seconds,
  coalesce(sum(greatest(ts.rounds - 1, 0)), 0)::bigint                                as redo_rounds
from public.profiles p
left join public.track_stages ts on ts.assignee_id = p.id
group by p.id;

grant select on public.member_performance to authenticated;

create or replace view public.member_rating_summary with (security_invoker = true) as
select member_id,
       round(avg(score)::numeric, 2) as avg_score,
       count(*)::int                 as ratings_count,
       max(created_at)               as last_rated_at
from public.member_ratings
group by member_id;

grant select on public.member_rating_summary to authenticated;

-- ---------------------------------------------------------------------
-- إقرار سياسة السرية
-- ---------------------------------------------------------------------
create table if not exists public.policy_acceptances (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.profiles (id) on delete cascade,
  policy_key     text not null default 'confidentiality',
  policy_version text not null,
  signed_name    text not null,
  accepted_at    timestamptz not null default now(),
  unique (member_id, policy_key, policy_version)
);

alter table public.policy_acceptances enable row level security;
drop policy if exists "see own acceptance" on public.policy_acceptances;
create policy "see own acceptance" on public.policy_acceptances for select
  using (member_id = auth.uid() or public.is_admin());

create or replace function public.accept_policy(
  p_version text,
  p_name    text,
  p_key     text default 'confidentiality'
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'اكتب اسمك الكامل توقيعًا'; end if;
  if length(trim(coalesce(p_version, ''))) = 0 then raise exception 'نسخة السياسة غير محددة'; end if;
  insert into public.policy_acceptances (member_id, policy_key, policy_version, signed_name)
  values (auth.uid(), coalesce(nullif(trim(p_key), ''), 'confidentiality'), trim(p_version), trim(p_name))
  on conflict (member_id, policy_key, policy_version) do nothing;
end $$;

grant execute on function public.accept_policy(text, text, text) to authenticated;

comment on table  public.member_ratings      is 'تقييم يدوي لأداء العضو: المنسق للمترجمين والمدير للجميع (ملاحظة ٥٧)';
comment on view   public.member_performance  is 'مؤشرات تلقائية من سجل المراحل: الإنجاز والالتزام بالمواعيد والإعادات';
comment on table  public.policy_acceptances  is 'توقيع العضو على سياسة السرية التامة، بنسختها وتاريخها';
