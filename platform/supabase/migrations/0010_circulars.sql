-- =====================================================================
-- 0010 — المراسلات: تعاميم وتوجيهات وتحذيرات ودعوات إلى الفريق (ملاحظة ٨١)
--   يرسلها المنسق أو مدير المشروع نصًّا أو مرفقًا PDF، إلى الجميع أو
--   إلى فئة أو إلى أعضاء بأعيانهم، ويوقّع العضو بالعلم فيُسجَّل وقت اطلاعه.
-- =====================================================================

create table if not exists public.circulars (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'notice'
                check (kind in ('notice', 'directive', 'warning', 'invitation')),
  title       text not null check (length(trim(title)) > 2),
  body        text,
  pdf_path    text,
  audience    text not null default 'all'
                check (audience in ('all', 'translators', 'coordinators', 'selected')),
  require_ack boolean not null default true,
  sent_by     uuid not null references public.profiles (id),
  sent_at     timestamptz not null default now(),
  closed_at   timestamptz,
  check (nullif(trim(coalesce(body, '')), '') is not null or pdf_path is not null)
);

create table if not exists public.circular_recipients (
  circular_id uuid not null references public.circulars (id) on delete cascade,
  member_id   uuid not null references public.profiles (id) on delete cascade,
  read_at     timestamptz,
  acked_at    timestamptz,
  signed_name text,
  primary key (circular_id, member_id)
);

create index if not exists circular_recipients_member_idx
  on public.circular_recipients (member_id, acked_at);

alter table public.circulars           enable row level security;
alter table public.circular_recipients enable row level security;

drop policy if exists "see circulars" on public.circulars;
create policy "see circulars" on public.circulars for select using (
  public.is_admin() or exists (
    select 1 from public.circular_recipients r
     where r.circular_id = id and r.member_id = auth.uid())
);

drop policy if exists "see own receipt" on public.circular_recipients;
create policy "see own receipt" on public.circular_recipients for select
  using (member_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- إرسال تعميم
-- ---------------------------------------------------------------------
create or replace function public.send_circular(
  p_title    text,
  p_kind     text default 'notice',
  p_body     text default null,
  p_pdf_path text default null,
  p_audience text default 'all',
  p_members  uuid[] default null,
  p_require_ack boolean default true
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_aud text := coalesce(nullif(trim(p_audience), ''), 'all'); v_n int;
begin
  if not public.is_admin() then raise exception 'إرسال المراسلات للمنسقين ومدير المشروع' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'اكتب عنوان الرسالة'; end if;
  if nullif(trim(coalesce(p_body, '')), '') is null and p_pdf_path is null then
    raise exception 'اكتب نص الرسالة أو أرفق ملف PDF';
  end if;

  insert into public.circulars (kind, title, body, pdf_path, audience, require_ack, sent_by)
  values (coalesce(nullif(trim(p_kind), ''), 'notice'), trim(p_title),
          nullif(trim(coalesce(p_body, '')), ''), p_pdf_path, v_aud, coalesce(p_require_ack, true), auth.uid())
  returning id into v_id;

  insert into public.circular_recipients (circular_id, member_id)
  select v_id, p.id from public.profiles p
   where p.status = 'active'
     and case v_aud
           when 'all'          then true
           when 'translators'  then p.role = 'translator'
           when 'coordinators' then p.role in ('coordinator', 'manager')
           when 'selected'     then p.id = any (coalesce(p_members, '{}'))
         end
  on conflict do nothing;

  select count(*) into v_n from public.circular_recipients where circular_id = v_id;
  if v_n = 0 then
    delete from public.circulars where id = v_id;
    raise exception 'لا مستقبِل لهذه الرسالة';
  end if;
  return v_id;
end $$;

grant execute on function public.send_circular(text, text, text, text, text, uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------
-- تسجيل الاطلاع، ثم التوقيع بالعلم
-- ---------------------------------------------------------------------
create or replace function public.mark_circular_read(p_circular uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.circular_recipients
     set read_at = coalesce(read_at, now())
   where circular_id = p_circular and member_id = auth.uid();
end $$;

create or replace function public.ack_circular(p_circular uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_name, ''))) < 3 then raise exception 'اكتب اسمك الكامل توقيعًا بالعلم'; end if;
  update public.circular_recipients
     set read_at = coalesce(read_at, now()), acked_at = coalesce(acked_at, now()), signed_name = trim(p_name)
   where circular_id = p_circular and member_id = auth.uid();
  if not found then raise exception 'هذه الرسالة ليست موجّهة إليك'; end if;
end $$;

grant execute on function public.mark_circular_read(uuid) to authenticated;
grant execute on function public.ack_circular(uuid, text) to authenticated;

-- عدد ما لم يُوقَّع عليه — لشارة «المراسلات» في قائمة المترجم
create or replace function public.my_pending_circulars()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.circular_recipients r
    join public.circulars c on c.id = r.circular_id
   where r.member_id = auth.uid() and r.acked_at is null and c.require_ack
$$;

grant execute on function public.my_pending_circulars() to authenticated;

-- ملخص التوقيعات لكل تعميم — للإدارة
create or replace view public.circular_stats with (security_invoker = true) as
select c.id as circular_id,
       count(r.member_id)::int                                  as recipients,
       count(r.member_id) filter (where r.acked_at is not null)::int as acked,
       count(r.member_id) filter (where r.read_at  is not null)::int as opened
from public.circulars c
left join public.circular_recipients r on r.circular_id = c.id
group by c.id;

grant select on public.circular_stats to authenticated;

-- حاوية مرفقات التعاميم (خاصة)
insert into storage.buckets (id, name, public) values ('circulars', 'circulars', false)
on conflict (id) do nothing;

drop policy if exists "admin uploads circulars" on storage.objects;
create policy "admin uploads circulars" on storage.objects for insert
  with check (bucket_id = 'circulars' and public.is_admin());

drop policy if exists "recipients read circulars" on storage.objects;
create policy "recipients read circulars" on storage.objects for select using (
  bucket_id = 'circulars' and (
    public.is_admin() or exists (
      select 1 from public.circulars c
        join public.circular_recipients r on r.circular_id = c.id
       where c.pdf_path = storage.objects.name and r.member_id = auth.uid())
  )
);

comment on table public.circulars is 'تعاميم وتوجيهات وتحذيرات ودعوات إلى فريق الترجمة (ملاحظة ٨١)';
