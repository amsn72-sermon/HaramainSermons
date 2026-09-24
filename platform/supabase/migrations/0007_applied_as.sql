-- =====================================================================
-- 0007 — الصفة المطلوبة عند التسجيل (ملاحظة ٦٣)
--   المنسقون يسجّلون بنفس الرابط، وأكثرهم لا يترجم، فلا تلزمه لغات.
--   الصفة إفصاح من المتقدّم لا صلاحية: الدور يبقى بيد مدير المشروع.
-- =====================================================================

alter table public.profile_private
  add column if not exists applied_as text
  check (applied_as is null or applied_as in ('translator', 'coordinator'));

comment on column public.profile_private.applied_as
  is 'الصفة التي تقدّم بها العضو: مترجم أو منسق/إداري — للاسترشاد عند المراجعة لا للصلاحية';

-- تسجيل الصفة عند إنشاء الحساب
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_lang text;
  v_as   text := nullif(trim(m ->> 'applied_as'), '');
begin
  if v_as is not null and v_as not in ('translator', 'coordinator') then v_as := null; end if;

  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(nullif(trim(m ->> 'full_name'), ''), split_part(new.email, '@', 1)), new.email);

  insert into public.profile_private (id, whatsapp, nationality, national_id, residence, applied_as)
  values (new.id, m ->> 'whatsapp', m ->> 'nationality', nullif(m ->> 'national_id', ''), m ->> 'residence', v_as);

  for v_lang in select jsonb_array_elements_text(coalesce(m -> 'languages', '[]'::jsonb)) loop
    insert into public.member_languages (member_id, language_code)
    select new.id, v_lang where exists (select 1 from public.languages where code = v_lang and is_active)
    on conflict do nothing;
  end loop;
  return new;
end $$;
