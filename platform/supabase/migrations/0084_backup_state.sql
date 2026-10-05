-- =====================================================================
-- 0084 — حالُ النسخ الاحتياطية في المنصة (ملاحظة ٢٤٧ د و هـ)
--
--   النسخةُ الليليّةُ تعمل بلا صوت، فإن توقّفت توقّفت صامتة. وأسوأُ ما
--   في الأمر أن يُكتشف ذلك يومَ الحاجة. فصار لكلِّ تشغيلٍ أثرٌ في قاعدة
--   البيانات، تعرضه بطاقةٌ في المنصة: متى آخرُ نسخةٍ ناجحة، وكم حجمُها،
--   ومنذ كم ساعة. وإن فشلت أُرسل إشعارٌ لمدير المشروع.
-- =====================================================================

create table if not exists public.backup_runs (
  id          bigserial primary key,
  ran_at      timestamptz not null default now(),
  ok          boolean     not null,
  db_bytes    bigint,
  files_bytes bigint,
  target      text,                  -- اسمُ الحاوية أو الوجهة
  note        text
);

create index if not exists backup_runs_at on public.backup_runs (ran_at desc);

alter table public.backup_runs enable row level security;

drop policy if exists "read backup runs" on public.backup_runs;
create policy "read backup runs" on public.backup_runs
  for select using (public.is_manager());

comment on table public.backup_runs is 'أثرُ كلِّ تشغيلٍ للنسخة الاحتياطية (ملاحظة ٢٤٧)';

-- حالُ النسخ: آخرُ ناجحةٍ وآخرُ تشغيلٍ وكم فشلت متتاليةً
create or replace function public.backup_state()
returns table (last_ok timestamptz, last_run timestamptz, last_run_ok boolean,
               db_bytes bigint, files_bytes bigint, hours numeric, fails int)
language sql stable security definer set search_path = public as $$
  -- الترتيبُ بالمعرّف لا بالوقت: تشغيلان في ثانيةٍ واحدةٍ لهما الطابعُ نفسُه
  with ok_run as (
    select * from public.backup_runs where ok order by id desc limit 1
  ), any_run as (
    select * from public.backup_runs order by id desc limit 1
  )
  select (select ran_at from ok_run),
         (select ran_at from any_run),
         (select ok from any_run),
         (select db_bytes from ok_run),
         (select files_bytes from ok_run),
         round(extract(epoch from (now() - (select ran_at from ok_run))) / 3600.0, 1),
         (select count(*)::int from public.backup_runs r
           where not r.ok and r.id > coalesce((select id from ok_run), 0))
  where public.is_manager()
$$;

grant execute on function public.backup_state() to authenticated;

-- يسجّلها سكربتُ النسخ بحساب قاعدة البيانات لا بحساب مستخدم
create or replace function public.log_backup_run(
  p_ok boolean, p_db bigint default null, p_files bigint default null,
  p_target text default null, p_note text default null
) returns void language sql security definer set search_path = public as $$
  insert into public.backup_runs (ok, db_bytes, files_bytes, target, note)
  values (p_ok, p_db, p_files, p_target, p_note)
$$;

revoke execute on function public.log_backup_run(boolean, bigint, bigint, text, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
