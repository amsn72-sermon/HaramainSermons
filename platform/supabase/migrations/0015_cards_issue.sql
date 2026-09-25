-- =====================================================================
-- 0015 — اعتماد البطاقة للعضو، وإصلاح جولة التعديل (ملاحظة ٨٧)
--   • البطاقة تظهر في حساب المترجم بعد اعتمادها فيبرزها عند الحاجة.
--   • «إنهاء التحديد» كان يُغلق الجولة فتختفي التحديدات عن المترجم،
--     فصار الإغلاق فعلًا مستقلًّا، وأُضيفت إعادة فتح الجولة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- بطاقات معتمَدة
-- ---------------------------------------------------------------------
create table if not exists public.member_cards (
  member_id   uuid primary key references public.profiles (id) on delete cascade,
  issued_at   timestamptz not null default now(),
  issued_by   uuid references public.profiles (id),
  valid_until date
);

alter table public.member_cards enable row level security;

drop policy if exists "see own card" on public.member_cards;
create policy "see own card" on public.member_cards for select
  using (member_id = auth.uid() or public.is_admin());

grant select on public.member_cards to authenticated;

-- العضو يحتاج قراءة إعدادات البطاقة ليعرض بطاقته: لا سرّ فيها
drop policy if exists "admins read card settings" on public.card_settings;
drop policy if exists "read card settings" on public.card_settings;
create policy "read card settings" on public.card_settings for select
  using (auth.uid() is not null);

create or replace function public.issue_member_cards(p_members uuid[], p_issued boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_valid date;
begin
  if not public.is_admin() then
    raise exception 'اعتماد البطاقات للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if p_members is null or array_length(p_members, 1) is null then return 0; end if;

  if p_issued then
    select valid_until into v_valid from public.card_settings where id;
    insert into public.member_cards (member_id, issued_at, issued_by, valid_until)
    select p.id, now(), auth.uid(), v_valid
      from public.profiles p
     where p.id = any (p_members) and p.status = 'active'
    on conflict (member_id) do update
      set issued_at = now(), issued_by = auth.uid(), valid_until = excluded.valid_until;
    get diagnostics v_n = row_count;
  else
    delete from public.member_cards where member_id = any (p_members);
    get diagnostics v_n = row_count;
  end if;
  return v_n;
end $$;

grant execute on function public.issue_member_cards(uuid[], boolean) to authenticated;

comment on table public.member_cards
  is 'البطاقات المعتمَدة: يراها صاحبها في «بياناتي» ويبرزها عند الحاجة (ملاحظة ٨٧)';

-- ---------------------------------------------------------------------
-- إعادة فتح جولة تعديل أُغلقت قبل أن يراها المترجمون
-- ---------------------------------------------------------------------
create or replace function public.reopen_revision(p_revision uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_material uuid;
begin
  if not public.is_admin() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select material_id into v_material from public.material_revisions where id = p_revision;
  if v_material is null then raise exception 'جولة التعديل غير موجودة'; end if;
  -- جولة مفتوحة واحدة لكل خطبة
  if exists (select 1 from public.material_revisions
              where material_id = v_material and closed_at is null and id <> p_revision) then
    raise exception 'توجد جولة تعديل مفتوحة على هذه الخطبة';
  end if;
  update public.material_revisions set closed_at = null where id = p_revision;
end $$;

grant execute on function public.reopen_revision(uuid) to authenticated;

-- آخر جولة تعديل على الخطبة ولو أُغلقت — لتظهر للمنسق مع حالتها
create or replace function public.latest_revision(p_material uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.material_revisions
   where material_id = p_material
   order by round desc limit 1
$$;

grant execute on function public.latest_revision(uuid) to authenticated;
