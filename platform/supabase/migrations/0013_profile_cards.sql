-- =====================================================================
-- 0013 — «بياناتي» وبطاقات العمل (ملاحظة ٨٥)
--   • رقم عضوية ثابت لكل عضو، يظهر على البطاقة.
--   • صورة شخصية ٤×٦ بشروط الصور الرسمية، يرفعها صاحبها أو الإدارة.
--   • الاسم ورقم الهوية بيانات أساسية: لا يعدّلها العضو، بل الإدارة.
--   • إعدادات بطاقة العمل: عنوانها، واسم المسؤول ومنصبه، وتاريخ الانتهاء.
-- =====================================================================

-- ---------------------------------------------------------------------
-- رقم العضوية: تسلسل ثابت لا يتغيّر بتغيّر الترتيب
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists member_no int;

do $$
begin
  if not exists (select 1 from pg_class where relname = 'profiles_member_no_seq') then
    create sequence public.profiles_member_no_seq start with 1001;
  end if;
end $$;

-- ترقيم من سجّل قبل هذا الترحيل بترتيب تسجيله
update public.profiles p set member_no = s.n
from (select id, 1000 + row_number() over (order by created_at, id) as n
        from public.profiles where member_no is null) s
where p.id = s.id and p.member_no is null;

select setval('public.profiles_member_no_seq',
  greatest(coalesce((select max(member_no) from public.profiles), 1000), 1000) + 1, false);

alter table public.profiles alter column member_no set default nextval('public.profiles_member_no_seq');
alter table public.profiles alter column member_no set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_member_no_key') then
    alter table public.profiles add constraint profiles_member_no_key unique (member_no);
  end if;
end $$;

comment on column public.profiles.member_no is 'رقم العضوية الظاهر على بطاقة العمل (ملاحظة ٨٥)';

-- ---------------------------------------------------------------------
-- الصورة الشخصية ونوع الهوية
-- ---------------------------------------------------------------------
alter table public.profile_private add column if not exists photo_path text;
alter table public.profile_private add column if not exists id_type text not null default 'national';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profile_private_id_type_check') then
    alter table public.profile_private add constraint profile_private_id_type_check
      check (id_type in ('national', 'passport'));
  end if;
end $$;

-- الهوية الوطنية أو الإقامة عشرة أرقام، وجواز السفر لمن خارج المملكة
alter table public.profile_private drop constraint if exists profile_private_national_id_check;
alter table public.profile_private add constraint profile_private_national_id_check check (
  national_id is null
  or (id_type = 'national' and national_id ~ '^[12][0-9]{9}$')
  or (id_type = 'passport' and national_id ~ '^[A-Z0-9]{5,15}$')
);

comment on column public.profile_private.photo_path is 'الصورة الشخصية ٤×٦ لبطاقة العمل (ملاحظة ٨٥)';
comment on column public.profile_private.id_type   is 'national: هوية أو إقامة سعودية، passport: جواز سفر لمن خارج المملكة';

-- ---------------------------------------------------------------------
-- العضو يعدّل ما ليس أساسيًّا من بياناته
-- ---------------------------------------------------------------------
create or replace function public.update_my_contact(
  p_whatsapp    text default null,
  p_nationality text default null,
  p_residence   text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  insert into public.profile_private (id) values (auth.uid()) on conflict (id) do nothing;
  update public.profile_private set
    whatsapp    = nullif(trim(coalesce(p_whatsapp, '')), ''),
    nationality = nullif(trim(coalesce(p_nationality, '')), ''),
    residence   = nullif(trim(coalesce(p_residence, '')), '')
  where id = auth.uid();
end $$;

grant execute on function public.update_my_contact(text, text, text) to authenticated;

comment on function public.update_my_contact(text, text, text)
  is 'تعديل الجوال والجنسية ومكان الإقامة — أما الاسم ورقم الهوية فمن الإدارة (ملاحظة ٨٥)';

-- ---------------------------------------------------------------------
-- الصورة الشخصية: يرفعها صاحبها، أو الإدارة نيابةً عنه
-- ---------------------------------------------------------------------
create or replace function public.set_member_photo(p_path text, p_member uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_member uuid := coalesce(p_member, auth.uid());
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if v_member <> auth.uid() and not public.is_admin() then
    raise exception 'لا تُعدّل صورة غيرك' using errcode = '42501';
  end if;
  insert into public.profile_private (id) values (v_member) on conflict (id) do nothing;
  update public.profile_private set photo_path = nullif(trim(coalesce(p_path, '')), '')
   where id = v_member;
end $$;

grant execute on function public.set_member_photo(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- إعدادات بطاقة العمل: صف واحد يشترك فيه الفريق
-- ---------------------------------------------------------------------
create table if not exists public.card_settings (
  id             boolean primary key default true check (id),
  title          text not null default 'بطاقة عمل' check (length(trim(title)) > 1),
  subtitle       text,
  official_name  text,
  official_title text,
  valid_until    date,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id)
);

insert into public.card_settings (id, title, subtitle)
values (true, 'بطاقة عمل', 'مشروع خادم الحرمين الشريفين للترجمة')
on conflict (id) do nothing;

alter table public.card_settings enable row level security;
drop policy if exists "admins read card settings" on public.card_settings;
create policy "admins read card settings" on public.card_settings for select using (public.is_admin());

create or replace function public.save_card_settings(
  p_title          text,
  p_subtitle       text default null,
  p_official_name  text default null,
  p_official_title text default null,
  p_valid_until    date default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'إعداد البطاقة للمنسق ومدير المشروع' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'اكتب عنوان البطاقة'; end if;
  insert into public.card_settings (id) values (true) on conflict (id) do nothing;
  update public.card_settings set
    title          = trim(p_title),
    subtitle       = nullif(trim(coalesce(p_subtitle, '')), ''),
    official_name  = nullif(trim(coalesce(p_official_name, '')), ''),
    official_title = nullif(trim(coalesce(p_official_title, '')), ''),
    valid_until    = p_valid_until,
    updated_at     = now(),
    updated_by     = auth.uid()
  where id;
end $$;

grant execute on function public.save_card_settings(text, text, text, text, date) to authenticated;

comment on table public.card_settings
  is 'عنوان بطاقة العمل واسم المسؤول ومنصبه وتاريخ انتهاء البطاقة (ملاحظة ٨٥)';

-- ---------------------------------------------------------------------
-- تسجيل الصورة ونوع الهوية عند إنشاء الحساب
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_lang text;
  v_as   text := nullif(trim(m ->> 'applied_as'), '');
  v_type text := nullif(trim(m ->> 'id_type'), '');
begin
  if v_as is not null and v_as not in ('translator', 'coordinator') then v_as := null; end if;
  if v_type is null or v_type not in ('national', 'passport') then v_type := 'national'; end if;

  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(nullif(trim(m ->> 'full_name'), ''), split_part(new.email, '@', 1)), new.email);

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

-- الإدارة تعدّل نوع الهوية مع رقمها
create or replace function public.admin_update_contact(
  p_member      uuid,
  p_full_name   text default null,
  p_whatsapp    text default null,
  p_nationality text default null,
  p_national_id text default null,
  p_residence   text default null,
  p_id_type     text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_target public.profiles; v_nid text; v_type text;
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select * into v_target from public.profiles where id = p_member for update;
  if not found then raise exception 'العضو غير موجود'; end if;

  if not public.is_manager() and v_target.role <> 'translator' then
    raise exception 'تعديل بيانات المنسقين والمديرين لمدير المشروع فقط' using errcode = '42501';
  end if;

  insert into public.profile_private (id) values (p_member) on conflict (id) do nothing;

  v_type := nullif(trim(coalesce(p_id_type, '')), '');
  if v_type is not null and v_type not in ('national', 'passport') then v_type := null; end if;
  if v_type is null then select id_type into v_type from public.profile_private where id = p_member; end if;

  v_nid := nullif(upper(trim(coalesce(p_national_id, ''))), '');
  if v_nid is not null then
    if v_type = 'passport' then
      if v_nid !~ '^[A-Z0-9]{5,15}$' then raise exception 'رقم الجواز من خمسة إلى خمسة عشر حرفًا ورقمًا'; end if;
    elsif v_nid !~ '^[12][0-9]{9}$' then
      raise exception 'رقم الهوية أو الإقامة يبدأ بـ ١ أو ٢ ويتكوّن من عشرة أرقام';
    end if;
  end if;

  if nullif(trim(coalesce(p_full_name, '')), '') is not null then
    if length(trim(p_full_name)) < 3 then raise exception 'الاسم قصير'; end if;
    update public.profiles set full_name = trim(p_full_name) where id = p_member;
  end if;

  update public.profile_private set
    whatsapp    = coalesce(nullif(trim(coalesce(p_whatsapp, '')), ''), whatsapp),
    nationality = coalesce(nullif(trim(coalesce(p_nationality, '')), ''), nationality),
    id_type     = v_type,
    national_id = coalesce(v_nid, national_id),
    residence   = coalesce(nullif(trim(coalesce(p_residence, '')), ''), residence)
  where id = p_member;
end $$;

grant execute on function public.admin_update_contact(uuid, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- حاوية الصور الشخصية (خاصة)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('member-photos', 'member-photos', false)
on conflict (id) do nothing;

drop policy if exists "own photo read" on storage.objects;
create policy "own photo read" on storage.objects for select using (
  bucket_id = 'member-photos' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
);

drop policy if exists "own photo write" on storage.objects;
create policy "own photo write" on storage.objects for insert with check (
  bucket_id = 'member-photos' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
);

drop policy if exists "own photo update" on storage.objects;
create policy "own photo update" on storage.objects for update using (
  bucket_id = 'member-photos' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
);
