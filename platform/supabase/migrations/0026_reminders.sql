-- =====================================================================
-- 0026 — التذكير قبل انتهاء المهلة، وإشعار الإعادة للتعديل (ملاحظة ١١٢)
--   التذكير يُبنى في قاعدة البيانات نفسها ويلتقطه سكربت البريد القائم،
--   فلا خدمة خارجية ولا كلفة، ولا يخرج شيء من بيانات المشروع.
-- =====================================================================

-- التذكير مرة واحدة لكل مرحلة: أثره محفوظ في الصف نفسه
alter table public.track_stages add column if not exists reminded_at timestamptz;

comment on column public.track_stages.reminded_at
  is 'وقت إرسال تذكير قرب انتهاء المهلة — يمنع تكراره (ملاحظة ١١٢)';

-- نوع جديد للإشعار: تذكير
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('assigned', 'track_completed', 'returned', 'reminder'));

-- ---------------------------------------------------------------------
-- بناء التذكيرات: كل مرحلة جارية يقترب موعدها ولم تُذكَّر بعد
-- ---------------------------------------------------------------------
create or replace function public.enqueue_due_reminders(p_hours int default 24)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_r record; v_h int := greatest(coalesce(p_hours, 24), 1);
begin
  for v_r in
    select s.id, s.assignee_id, s.stage_key, s.due_at, t.id as track_id,
           m.title, coalesce(l.name_ar, t.language_code) as lang,
           coalesce(w.name_ar, s.stage_key) as stage_name
      from public.track_stages s
      join public.tracks t on t.id = s.track_id
      join public.materials m on m.id = t.material_id
      left join public.languages l on l.code = t.language_code
      left join public.workflow_stages w on w.key = s.stage_key
     where s.status = 'active' and s.reminded_at is null
       and s.assignee_id is not null and s.due_at is not null
       and s.due_at > now() and s.due_at <= now() + make_interval(hours => v_h)
       and t.deleted_at is null
  loop
    perform public.enqueue_notification(
      v_r.assignee_id, 'reminder',
      format('تذكير بموعد: %s — %s', v_r.title, v_r.lang),
      format(E'يقترب موعد تسليم مهمتك في منصة ترجمة الحرمين.\n\nالمادة: %s\nاللغة: %s\nالمرحلة: %s\nالموعد: %s\n\nادخل المنصة لإتمامها قبل الموعد.',
             v_r.title, v_r.lang, v_r.stage_name,
             to_char(v_r.due_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')),
      v_r.track_id);
    update public.track_stages set reminded_at = now() where id = v_r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

revoke all on function public.enqueue_due_reminders(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- سكربت البريد يقرأ الطابور كل دقيقة، فيُبنى التذكير قبل القراءة
-- (فلا حاجة إلى جدولة ثانية على الخادم)
-- ---------------------------------------------------------------------
create or replace function public.pending_notifications(p_limit int default 50)
returns table (id bigint, email text, full_name text, subject text, body text)
language plpgsql security definer set search_path = public as $$
begin
  perform public.enqueue_due_reminders(24);
  return query
    select n.id, p.email, p.full_name,
           replace(replace(n.subject, E'\n', ' '), E'\r', ' '),
           replace(replace(n.body, E'\r', ''), E'\n', '\n')
      from public.notifications n join public.profiles p on p.id = n.member_id
     where n.status = 'pending' and n.attempts < 5
     order by n.created_at
     limit greatest(coalesce(p_limit, 50), 1);
end $$;

revoke all on function public.pending_notifications(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- الإعادة للتعديل: إشعار المترجم بما طُلب منه
-- ---------------------------------------------------------------------
create or replace function public.notify_returned()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_title text; v_lang text; v_to uuid; v_stage text;
begin
  if new.action <> 'returned' then return new; end if;

  select m.title, coalesce(l.name_ar, t.language_code)
    into v_title, v_lang
    from public.tracks t
    join public.materials m on m.id = t.material_id
    left join public.languages l on l.code = t.language_code
   where t.id = new.track_id;
  if v_title is null then return new; end if;

  -- المستقبِل: صاحب المرحلة التي أُعيد إليها العمل
  select s.assignee_id, coalesce(w.name_ar, s.stage_key) into v_to, v_stage
    from public.track_stages s
    left join public.workflow_stages w on w.key = s.stage_key
   where s.track_id = new.track_id
     and s.stage_key = coalesce(new.target_stage_key, new.stage_key);

  perform public.enqueue_notification(
    v_to, 'returned',
    format('أُعيد إليك للتعديل: %s — %s', v_title, v_lang),
    format(E'أُعيد إليك عمل للتعديل في منصة ترجمة الحرمين.\n\nالمادة: %s\nاللغة: %s\nالمرحلة: %s\nالملاحظة: %s\n\nادخل المنصة لمتابعته.',
           v_title, v_lang, coalesce(v_stage, '—'), coalesce(new.note, 'بلا ملاحظة مكتوبة')),
    new.track_id);
  return new;
end $$;

drop trigger if exists on_track_returned on public.track_events;
create trigger on_track_returned
  after insert on public.track_events
  for each row execute function public.notify_returned();
