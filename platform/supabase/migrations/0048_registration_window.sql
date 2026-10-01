-- =====================================================================
-- 0048 — نافذة التسجيل: تُفتح وتُغلق بيد مدير المشروع (ملاحظة ١٧٤)
--   العدد قليل ومعروف، فلا يُترك الباب مفتوحًا إن انتشر الرابط.
--   وتُغلق بنفسها بعد مدةٍ يحدّدها، فلا تُنسى مفتوحة.
-- =====================================================================

alter table public.platform_settings
  add column if not exists registration_open boolean not null default true,
  add column if not exists registration_closes_at timestamptz,
  add column if not exists registration_note text;

comment on column public.platform_settings.registration_open
  is 'باب التسجيل مفتوح — يفتحه مدير المشروع ويغلقه (ملاحظة ١٧٤)';
comment on column public.platform_settings.registration_closes_at
  is 'يُغلق التسجيل بنفسه في هذا الوقت، فلا يُنسى مفتوحًا (ملاحظة ١٧٤)';

-- حال التسجيل: يقرؤه الزائر قبل أن يُسجّل، فلا يملأ نموذجًا يُردّ
create or replace function public.registration_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'open', s.registration_open
              and (s.registration_closes_at is null or now() < s.registration_closes_at),
      'closes_at', s.registration_closes_at,
      'note', s.registration_note)
      from public.platform_settings s where s.id
  ), jsonb_build_object('open', true, 'closes_at', null, 'note', null));
$$;
grant execute on function public.registration_state() to anon, authenticated;

create or replace function public.registration_open()
returns boolean language sql stable security definer set search_path = public as $$
  select (public.registration_state() ->> 'open')::boolean;
$$;
grant execute on function public.registration_open() to anon, authenticated;

-- الفتح والإغلاق — لمدير المشروع، ومعه إغلاقٌ تلقائي بالساعات
create or replace function public.set_registration(
  p_open boolean, p_hours int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_closes timestamptz;
begin
  if not public.is_manager() then
    raise exception 'فتح التسجيل وإغلاقه لمدير المشروع' using errcode = '42501';
  end if;
  if p_hours is not null and (p_hours < 1 or p_hours > 720) then
    raise exception 'مدة الفتح بين ساعة و٧٢٠ ساعة';
  end if;
  v_closes := case when coalesce(p_open, false) and p_hours is not null
                   then now() + make_interval(hours => p_hours) end;

  update public.platform_settings
     set registration_open = coalesce(p_open, false),
         registration_closes_at = v_closes,
         registration_note = nullif(trim(coalesce(p_note, '')), ''),
         updated_by = auth.uid(), updated_at = now()
   where id;
  return public.registration_state();
end $$;
grant execute on function public.set_registration(boolean, int, text) to authenticated;

-- والمنع في قاعدة البيانات لا في الشاشة: لا يُنشأ حسابٌ والباب مغلق.
-- ومدير المشروع يُنشئ الحسابات يدويًّا في كل حال.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_lang text;
  v_as   text := nullif(trim(m ->> 'applied_as'), '');
  v_type text := nullif(trim(m ->> 'id_type'), '');
begin
  if not public.registration_open() and not public.is_manager() then
    raise exception 'التسجيل مغلق حاليًّا — راجع إدارة المشروع';
  end if;

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

notify pgrst, 'reload schema';
