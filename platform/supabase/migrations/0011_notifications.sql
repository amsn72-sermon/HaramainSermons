-- =====================================================================
-- 0011 — طابور الإشعارات بالبريد الإلكتروني (ملاحظة ٨٣)
--   يمتلئ تلقائيًا: عند إسناد مهمة إلى عضو، وعند اكتمال كل مراحل لغة.
--   يرسله سكربت على الخادم عبر بريد الهيئة (أوراكل الرياض)، فلا يغادر
--   شيء من البيانات المملكة. الطابور مستقل عن وسيلة الإرسال.
-- =====================================================================

create table if not exists public.notifications (
  id           bigint generated always as identity primary key,
  member_id    uuid not null references public.profiles (id) on delete cascade,
  channel      text not null default 'email' check (channel in ('email')),
  kind         text not null check (kind in ('assigned', 'track_completed', 'returned')),
  subject      text not null,
  body         text not null,
  track_id     uuid references public.tracks (id) on delete set null,
  status       text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts     int  not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

create index if not exists notifications_pending_idx
  on public.notifications (status, created_at) where status = 'pending';

alter table public.notifications enable row level security;
drop policy if exists "see own notifications" on public.notifications;
create policy "see own notifications" on public.notifications for select
  using (member_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- بناء نص الإشعار من بيانات المسار
-- ---------------------------------------------------------------------
create or replace function public.enqueue_notification(
  p_member uuid, p_kind text, p_subject text, p_body text, p_track uuid default null
) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (member_id, kind, subject, body, track_id)
  select p_member, p_kind, p_subject, p_body, p_track
   where p_member is not null
     and exists (select 1 from public.profiles p where p.id = p_member and p.status = 'active');
$$;

-- عند صيرورة مرحلة نشطة: إشعار المسؤول عنها
create or replace function public.notify_stage_active()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text; v_lang text; v_stage text; v_due text; v_kind text := 'assigned';
begin
  if new.assignee_id is null then return new; end if;

  select m.title, coalesce(l.name_ar, t.language_code)
    into v_title, v_lang
  from public.tracks t
    join public.materials m on m.id = t.material_id
    left join public.languages l on l.code = t.language_code
   where t.id = new.track_id;
  if v_title is null then return new; end if;

  select coalesce(w.name_ar, new.stage_key) into v_stage
    from public.workflow_stages w where w.key = new.stage_key;
  v_due := case when new.due_at is null then 'غير محدد'
                else to_char(new.due_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') end;

  perform public.enqueue_notification(
    new.assignee_id, v_kind,
    format('مهمة جديدة: %s — %s', v_title, v_lang),
    format(E'أُسندت إليك مهمة في منصة ترجمة الحرمين.\n\nالمادة: %s\nاللغة: %s\nالمرحلة: %s\nالموعد: %s\n\nادخل المنصة لاستلامها ومتابعتها.',
           v_title, v_lang, v_stage, v_due),
    new.track_id);
  return new;
end $$;

drop trigger if exists on_stage_active on public.track_stages;
create trigger on_stage_active
  after insert or update of status, assignee_id on public.track_stages
  for each row
  when (new.status = 'active')
  execute function public.notify_stage_active();

-- عند اكتمال كل مراحل لغة: إشعار المنسقين ومدير المشروع
create or replace function public.notify_track_completed()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_lang text; v_admin record;
begin
  select m.title, coalesce(l.name_ar, new.language_code)
    into v_title, v_lang
  from public.materials m
    left join public.languages l on l.code = new.language_code
   where m.id = new.material_id;
  if v_title is null then return new; end if;

  for v_admin in select id from public.profiles
    where role in ('coordinator', 'manager') and status = 'active'
  loop
    perform public.enqueue_notification(
      v_admin.id, 'track_completed',
      format('اكتملت الترجمة: %s — %s', v_title, v_lang),
      format(E'اكتملت جميع مراحل الترجمة في منصة ترجمة الحرمين.\n\nالمادة: %s\nاللغة: %s\nوقت الاكتمال: %s\n\nتجدها في أرشيف أعمال الترجمة.',
             v_title, v_lang,
             to_char(coalesce(new.completed_at, now()) at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')),
      new.id);
  end loop;
  return new;
end $$;

drop trigger if exists on_track_completed on public.tracks;
create trigger on_track_completed
  after update of status on public.tracks
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.notify_track_completed();

-- ---------------------------------------------------------------------
-- ما ينتظر الإرسال — للسكربت على الخادم وحده
-- ---------------------------------------------------------------------
-- الأسطر تُرمَّز \n حتى يبقى كل إشعار في سطر واحد عبر psql، ويفكّها السكربت
create or replace function public.pending_notifications(p_limit int default 50)
returns table (id bigint, email text, full_name text, subject text, body text)
language sql security definer set search_path = public as $$
  select n.id, p.email, p.full_name,
         replace(replace(n.subject, E'\n', ' '), E'\r', ' '),
         replace(replace(n.body, E'\r', ''), E'\n', '\n')
  from public.notifications n join public.profiles p on p.id = n.member_id
  where n.status = 'pending' and n.attempts < 5
  order by n.created_at
  limit greatest(coalesce(p_limit, 50), 1)
$$;

create or replace function public.mark_notification(p_id bigint, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update public.notifications
     set status = case when p_ok then 'sent' else (case when attempts + 1 >= 5 then 'failed' else 'pending' end) end,
         attempts = attempts + 1,
         sent_at = case when p_ok then now() else sent_at end,
         last_error = case when p_ok then null else left(coalesce(p_error, ''), 500) end
   where id = p_id;
$$;

revoke all on function public.pending_notifications(int) from public, anon, authenticated;
revoke all on function public.mark_notification(bigint, boolean, text) from public, anon, authenticated;

comment on table public.notifications
  is 'طابور الإشعارات: يمتلئ بمحفّزات قاعدة البيانات ويرسله سكربت الخادم بالبريد (ملاحظة ٨٣)';
