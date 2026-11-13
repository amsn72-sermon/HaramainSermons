-- =====================================================================
-- ٠١٤٦ — المخاطَبون على محورين، وتذكيرُ من لم يوقِّع الميثاق
--        (ملاحظتا ٥ و١٠ من دفعة ٥٠٢)
--
--   كان اختيارُ المخاطَبين محورًا واحدًا: إمّا فئةٌ وإمّا مدينة، فلا
--   يُقال «المرشدون المكانيون في المدينة المنورة». فصار المحوران معًا:
--   الفئةُ تُضيَّق بالمدينة، ويبقى انتقاءُ الأفراد بأعيانهم فوقهما.
--
--   ويُضاف بابٌ ثانٍ: تذكيرُ من لم يوقِّع الميثاق من شاشته، يعمل في
--   المعروض وحدَه لا في الفريق كلِّه، ولا يُثقَل العضوُ بتذكيرين في يوم.
-- =====================================================================

-- ـــ ١) المخاطَبون: الفئةُ والمدينةُ معًا
drop function if exists public.mail_audience(text, text);
create or replace function public.mail_audience(
  p_audience text default 'all', p_city text default null)
returns table (id uuid, full_name text, email text, track text, city text,
               member_no int, signed boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, coalesce(p.track, 'translation'), p.city,
         p.member_no,
         exists (select 1 from public.policy_acceptances a where a.member_id = p.id)
    from public.profiles p
    left join public.profile_private pp on pp.id = p.id
   where public.is_admin_for('circulars')
     and p.status = 'active' and coalesce(p.email, '') <> ''
     -- المحورُ الأول: الفئة
     and case coalesce(p_audience, 'all')
           when 'all'         then true
           when 'translators' then coalesce(p.track, 'translation') = 'translation'
           when 'field'       then coalesce(p.track, '') = 'field'
           when 'answers'     then coalesce(p.track, '') = 'answers'
           when 'admins'      then p.role in ('manager', 'coordinator', 'supervisor', 'viewer')
           when 'nodata'      then pp.id is null or pp.national_id is null
                                   or pp.photo_path is null or pp.signature_path is null
           when 'unsigned'    then not exists (
                                     select 1 from public.policy_acceptances a
                                      where a.member_id = p.id)
           else true
         end
     -- والمحورُ الثاني: المدينة، تُضيَّق بها الفئةُ ولا تُبدِّلها.
     --   وقيمةُ «بلا مدينةٍ مسجَّلة» تُطلَب بـnone، والفراغُ يعني المدنَ كلَّها
     and case
           when nullif(btrim(coalesce(p_city, '')), '') is null then true
           when btrim(p_city) = 'none' then coalesce(p.city, '') = ''
           else coalesce(p.city, '') = btrim(p_city)
         end
   order by p.full_name
$$;
grant execute on function public.mail_audience(text, text) to authenticated;

comment on function public.mail_audience(text, text) is
  'المخاطَبون برسالةٍ بالفئة والمدينة معًا (ملاحظتا ٥٠١ و٥٠٢)';

-- ـــ ٢) تذكيرُ من لم يوقِّع الميثاق
--
--   يُستدعى بقائمة أعضاءٍ بأعيانهم — هم المعروضون في الشاشة بعد
--   ترشيحها بالفريق والمدينة — فلا يذهب التذكيرُ إلى من ليس في النظر.
--   ومن وقَّع لا يُذكَّر ولو كان في القائمة، ومن ذُكِّر اليومَ لا يُذكَّر
--   ثانيةً، فالتذكيرُ تنبيهٌ لا مضايقة.
create table if not exists public.charter_reminders (
  member_id  uuid not null references public.profiles (id) on delete cascade,
  policy_key text not null,
  at         timestamptz not null default now(),
  by_whom    uuid references public.profiles (id)
);
create index if not exists charter_reminders_at
  on public.charter_reminders (member_id, policy_key, at desc);
alter table public.charter_reminders enable row level security;
drop policy if exists "read charter reminders" on public.charter_reminders;
create policy "read charter reminders" on public.charter_reminders for select
  to authenticated using (public.is_admin());

comment on table public.charter_reminders is
  'تذكيراتُ الميثاق: من ذُكِّر ومتى وبيد من (ملاحظة ٥٠٢)';

create or replace function public.remind_charter(
  p_members uuid[], p_key text default 'policy', p_version text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record; v_title text; v_body text;
begin
  if not public.is_admin_for('tm_edit') then
    raise exception 'تذكيرُ الميثاق لمن يملك تعديلَ الفريق' using errcode = '42501';
  end if;
  if p_members is null or array_length(p_members, 1) is null then return 0; end if;
  if array_length(p_members, 1) > 500 then
    raise exception 'التذكيرُ دفعةً واحدةً لخمسمئةٍ على الأكثر';
  end if;

  for r in
    select p.id, p.full_name
      from public.profiles p
     where p.id = any (p_members) and p.status = 'active'
       -- من وقَّع النسخةَ المطلوبةَ لا يُذكَّر
       and not exists (
             select 1 from public.policy_acceptances a
              where a.member_id = p.id
                and coalesce(a.policy_key, 'policy') = coalesce(p_key, 'policy')
                and (p_version is null or a.policy_version = p_version))
       -- ولا يُذكَّر من ذُكِّر في اليوم نفسِه
       and not exists (
             select 1 from public.charter_reminders c
              where c.member_id = p.id
                and c.policy_key = coalesce(p_key, 'policy')
                and c.at > now() - interval '20 hours')
  loop
    v_title := 'يلزمك التوقيعُ على ميثاق العمل';
    v_body := 'لم يصل توقيعُك على ميثاق العمل'
      || coalesce(' — النسخة ' || p_version, '') || '. '
      || 'والعملُ في المشروع لا يتمُّ قبله. '
      || 'ادخلْ إلى المنصة وافتحْ «ميثاق العمل» فتقرأه وتوقِّع عليه.';
    perform public.enqueue_notification(r.id, 'data_reminder', v_title, v_body, null);
    insert into public.charter_reminders (member_id, policy_key, by_whom)
    values (r.id, coalesce(p_key, 'policy'), auth.uid());
    v_n := v_n + 1;
  end loop;

  perform public.log_admin('charter_remind', null,
    jsonb_build_object('n', v_n, 'key', p_key, 'version', p_version));
  return v_n;
end $$;
grant execute on function public.remind_charter(uuid[], text, text) to authenticated;

comment on function public.remind_charter(uuid[], text, text) is
  'تذكيرُ من لم يوقِّع الميثاق من المعروضين، مرّةً في اليوم (ملاحظة ٥٠٢)';

-- ـــ ٣) وآخرُ تذكيرٍ لكلِّ عضوٍ ليُرى في الكشف
create or replace function public.charter_reminded(p_key text default 'policy')
returns table (member_id uuid, at timestamptz, n int)
language sql stable security definer set search_path = public as $$
  select c.member_id, max(c.at), count(*)::int
    from public.charter_reminders c
   where c.policy_key = coalesce(p_key, 'policy') and public.is_admin_for('tm_view')
   group by c.member_id
$$;
grant execute on function public.charter_reminded(text) to authenticated;

notify pgrst, 'reload schema';
