-- =====================================================================
-- 0022 — الإرشاد المكاني: فريق المترجمين الميدانيين (ملاحظة ٩٩)
--   المشروع فريقان: مترجمون متخصصون تُدار أعمالهم وتُوثَّق في المنصة،
--   ومترجمون ميدانيون لا تُترجم لهم مواد ولا تُسند إليهم مراحل، وإنما
--   تُوثَّق بياناتهم وحساباتهم كموظفين، وتُصدر لهم بطاقات العمل.
-- =====================================================================

alter table public.profiles
  add column if not exists track text not null default 'translation';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_track_check') then
    alter table public.profiles
      add constraint profiles_track_check check (track in ('translation', 'field'));
  end if;
end $$;

create index if not exists profiles_track_idx on public.profiles (track);

comment on column public.profiles.track
  is 'مسار العضو: translation فريق الترجمة المتخصصة، field فريق الإرشاد المكاني (ملاحظة ٩٩)';

-- الصفة المعلنة عند التسجيل تقبل «ميداني»
alter table public.profile_private drop constraint if exists profile_private_applied_as_check;
alter table public.profile_private
  add constraint profile_private_applied_as_check
  check (applied_as is null or applied_as in ('translator', 'coordinator', 'field'));

-- ---------------------------------------------------------------------
-- التسجيل: من تقدّم مرشدًا ميدانيًّا يُفتح حسابه على مسار الإرشاد
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_lang text;
  v_as   text := nullif(trim(m ->> 'applied_as'), '');
  v_type text := nullif(trim(m ->> 'id_type'), '');
begin
  if v_as is not null and v_as not in ('translator', 'coordinator', 'field') then v_as := null; end if;
  if v_type is null or v_type not in ('national', 'passport') then v_type := 'national'; end if;

  insert into public.profiles (id, full_name, email, track)
  values (new.id, coalesce(nullif(trim(m ->> 'full_name'), ''), split_part(new.email, '@', 1)), new.email,
          case when v_as = 'field' then 'field' else 'translation' end);

  insert into public.profile_private (id, whatsapp, nationality, national_id, residence, applied_as, id_type)
  values (new.id, m ->> 'whatsapp', m ->> 'nationality',
          nullif(upper(trim(coalesce(m ->> 'national_id', ''))), ''), m ->> 'residence', v_as, v_type);

  for v_lang in select jsonb_array_elements_text(coalesce(m -> 'languages', '[]'::jsonb)) loop
    insert into public.member_languages (member_id, language_code)
    select new.id, v_lang where exists (select 1 from public.languages where code = v_lang and is_active)
    on conflict do nothing;
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- نقل العضو بين الفريقين — بيد المنسق ومدير المشروع
-- ---------------------------------------------------------------------
create or replace function public.set_member_track(p_member uuid, p_track text)
returns void language plpgsql security definer set search_path = public as $$
declare v_target public.profiles;
begin
  if not public.is_admin() then raise exception 'نقل الأعضاء بين الفريقين للمنسق ومدير المشروع' using errcode = '42501'; end if;
  if p_track not in ('translation', 'field') then raise exception 'فريق غير معروف'; end if;
  select * into v_target from public.profiles where id = p_member for update;
  if not found then raise exception 'العضو غير موجود'; end if;
  if not public.is_manager() and v_target.role <> 'translator' then
    raise exception 'نقل المنسقين والمديرين لمدير المشروع وحده' using errcode = '42501';
  end if;
  -- لا يُنقل إلى الإرشاد المكاني من لديه مهمة ترجمة قائمة
  if p_track = 'field' and exists (
    select 1 from public.track_stages s
     where s.assignee_id = p_member and s.status in ('waiting', 'active')
  ) then
    raise exception 'لا يُنقل عضو لديه مهمة ترجمة قائمة — أعد إسناد مهامه أولًا';
  end if;
  update public.profiles set track = p_track where id = p_member;
end $$;

grant execute on function public.set_member_track(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- حاجز صارم: لا تُسنَد مرحلة ترجمة إلى عضو في فريق الإرشاد المكاني،
-- مهما كان طريق الإسناد (ملاحظة ٩٩)
-- ---------------------------------------------------------------------
create or replace function public.block_field_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.assignee_id and p.track = 'field') then
    raise exception 'فريق الإرشاد المكاني لا تُسنَد إليه أعمال ترجمة';
  end if;
  return new;
end $$;

drop trigger if exists block_field_assignment on public.track_stages;
create trigger block_field_assignment
  before insert or update of assignee_id on public.track_stages
  for each row execute function public.block_field_assignment();

-- ---------------------------------------------------------------------
-- المراسلات: فريق الإرشاد المكاني جمهور مستقل، وفريق الترجمة يخصّه ما يخصّه
-- ---------------------------------------------------------------------
alter table public.circulars drop constraint if exists circulars_audience_check;
alter table public.circulars
  add constraint circulars_audience_check
  check (audience in ('all', 'translators', 'field', 'coordinators', 'selected'));

create or replace function public.send_circular(
  p_title    text,
  p_kind     text default 'notice',
  p_body     text default null,
  p_pdf_path text default null,
  p_audience text default 'all',
  p_members  uuid[] default null,
  p_require_ack boolean default true,
  p_blocking boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_aud text := coalesce(nullif(trim(p_audience), ''), 'all'); v_n int;
begin
  if not public.is_admin() then raise exception 'إرسال المراسلات للمنسقين ومدير المشروع' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'اكتب عنوان الرسالة'; end if;
  if nullif(trim(coalesce(p_body, '')), '') is null and p_pdf_path is null then
    raise exception 'اكتب نص الرسالة أو أرفق ملف PDF';
  end if;
  if p_blocking and not p_require_ack then
    raise exception 'التعميم الملزم يشترط التوقيع بالعلم';
  end if;

  insert into public.circulars (kind, title, body, pdf_path, audience, require_ack, blocking, sent_by)
  values (coalesce(nullif(trim(p_kind), ''), 'notice'), trim(p_title),
          nullif(trim(coalesce(p_body, '')), ''), p_pdf_path, v_aud,
          coalesce(p_require_ack, true), coalesce(p_blocking, false), auth.uid())
  returning id into v_id;

  insert into public.circular_recipients (circular_id, member_id)
  select v_id, p.id from public.profiles p
   where p.status = 'active'
     and (v_aud = 'all'
       or (v_aud = 'translators'  and p.role = 'translator' and p.track = 'translation')
       or (v_aud = 'field'        and p.track = 'field')
       or (v_aud = 'coordinators' and p.role in ('coordinator', 'manager'))
       or (v_aud = 'selected'     and p.id = any (coalesce(p_members, '{}'::uuid[]))))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    delete from public.circulars where id = v_id;
    raise exception 'لا مستقبِلين لهذه الرسالة';
  end if;
  return v_id;
end $$;

grant execute on function public.send_circular(text, text, text, text, text, uuid[], boolean, boolean) to authenticated;

-- عدّاد ما ينتظر التدقيق يضمّ الفريقين معًا (ملاحظة ٩٨)
drop function if exists public.pending_reviews();

create or replace function public.pending_reviews()
returns table (photos int, iqamas int, banks int, joins int, field_members int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.profile_private p join public.profiles f on f.id = p.id
      where p.photo_path is not null and p.photo_status = 'pending' and f.status = 'active'),
    (select count(*)::int from public.profile_private p join public.profiles f on f.id = p.id
      where p.iqama_path is not null and p.iqama_status = 'pending' and f.status = 'active'),
    (select count(*)::int from public.bank_accounts where verified_at is null),
    (select count(*)::int from public.profiles where status = 'pending'),
    (select count(*)::int from public.profiles where track = 'field' and status = 'active')
  where public.is_admin()
$$;

grant execute on function public.pending_reviews() to authenticated;
