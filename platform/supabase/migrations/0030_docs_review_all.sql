-- =====================================================================
-- 0030 — تدقيق مستندات الفريق كلّه في كشف واحد (ملاحظة ١٢٠)
--   كانت شاشة التدقيق تعتمد على قائمة الفريق المعروضة، فيقع أن يُرفع
--   مستند ولا يظهر لمن يدقّق. فصار للإدارة كشفٌ مستقلّ يجمع كل عضو
--   مفعَّل وحال مستنداته، ومنه يُعتمد أو يُعاد.
-- =====================================================================

create or replace function public.member_docs()
returns table (
  member_id uuid, full_name text, email text, member_no text,
  role text, track text, status text,
  photo_path text, photo_status text, photo_note text, photo_at timestamptz,
  iqama_path text, iqama_status text, iqama_note text, iqama_at timestamptz,
  national_id text, bank_verified boolean, has_bank boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.member_no,
         p.role, coalesce(p.track, 'translation'), p.status,
         v.photo_path, v.photo_status::text, v.photo_note, v.photo_at,
         v.iqama_path, v.iqama_status::text, v.iqama_note, v.iqama_at,
         v.national_id,
         (b.verified_at is not null), (b.member_id is not null)
    from public.profiles p
    left join public.profile_private v on v.id = p.id
    left join public.bank_accounts b on b.member_id = p.id
   where public.is_admin() and p.status <> 'disabled'
   order by
     (case when v.photo_path is not null and v.photo_status = 'pending' then 0
           when v.iqama_path is not null and v.iqama_status = 'pending' then 0
           else 1 end),
     p.full_name
$$;

grant execute on function public.member_docs() to authenticated;

comment on function public.member_docs()
  is 'كشف مستندات الفريق كله للإدارة: ما ينتظر التدقيق أولًا (ملاحظة ١٢٠)';

-- عدّادات ما ينتظر التدقيق، مفصّلة بحسب القائمة ليظهر الرقم على تبويبها
create or replace function public.pending_reviews_by_group()
returns table (grp text, photos int, iqamas int, banks int, joins int)
language sql stable security definer set search_path = public as $$
  select case when p.role in ('manager', 'coordinator') then 'admins'
              when coalesce(p.track, 'translation') = 'field' then 'field'
              else 'translators' end as grp,
         count(*) filter (where v.photo_path is not null and v.photo_status = 'pending')::int,
         count(*) filter (where v.iqama_path is not null and v.iqama_status = 'pending')::int,
         count(*) filter (where b.member_id is not null and b.verified_at is null)::int,
         count(*) filter (where p.status = 'pending')::int
    from public.profiles p
    left join public.profile_private v on v.id = p.id
    left join public.bank_accounts b on b.member_id = p.id
   where public.is_admin() and p.status <> 'disabled'
   group by 1
$$;

grant execute on function public.pending_reviews_by_group() to authenticated;

-- ولا يُنسى مَن رفع مستنده قبل إضافة حقول التدقيق: يدخل الطابور بحاله
update public.profile_private
   set photo_at = photo_at
 where photo_path is not null and photo_status = 'pending' and photo_at is not null;
