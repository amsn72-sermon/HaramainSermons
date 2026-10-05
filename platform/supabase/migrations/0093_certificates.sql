-- =====================================================================
-- 0093 — الشهادات: شهاداتُ الدورات وشهاداتُ الخبرة (ملاحظة ٢٦٧)
--
--   يُنشئها المنسقُ مسوّدةً، ويعتمدها مديرُ المشروع فتصدر ويُمنح لها
--   رقمٌ متسلسلٌ موحَّدٌ للنوعين. وعليها باركودٌ يفتح صفحةَ تحقّقٍ
--   عامّةً، لا تُسجَّل فيها دخولٌ ولا يُعرض فيها من بياناته سوى اسمه.
--
--   ولا يُخزَّن ملفُّ PDF أصلًا: تُحفظ بياناتُ الشهادة سطرًا في الجدول،
--   وتُولَّد عند الطلب من القالب والبيانات، فتكون متطابقةً في كل مرة.
--   فالأرشيفُ أرشيفُ سجلّاتٍ لا ملفّات.
--
--   والرقمُ المسحوبُ أثرٌ: الملغاةُ تبقى، ويُعلَن إلغاؤها في صفحة
--   التحقق، ولا تُحذف.
-- =====================================================================

create table if not exists public.certificates (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('course', 'experience')),
  member_id   uuid not null references public.profiles (id) on delete cascade,

  -- بياناتُ الدورة أو الخبرة
  title       text not null,
  subject     text,
  hours       numeric(8,2),
  start_on    date,
  end_on      date,
  place       text,
  provider    text,                      -- الجهةُ المنفّذة لدورةٍ خارج المنصة
  source      text not null default 'platform' check (source in ('platform', 'external')),
  plan_id     uuid,                      -- خطّةُ التدريب إن كانت على المنصة
  role_text   text,                      -- للخبرة: الدورُ الذي قام به
  body        text,                      -- للخبرة: ما باشره من أعمال

  -- التصميمُ والتوقيع (ملاحظة ٢٦٧ هـ و ك)
  design      jsonb not null default '{}'::jsonb,
  signer_name text,
  signer_role text,
  signature   text not null default 'blank' check (signature in ('image', 'blank', 'none')),

  -- الحالُ والرقمُ ومفتاحُ التحقق
  status      text not null default 'draft' check (status in ('draft', 'issued', 'revoked')),
  serial_no   text unique,
  h_year      int,
  serial      int,
  verify_key  text not null default substr(md5(gen_random_uuid()::text), 1, 8),

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  issued_by   uuid references public.profiles (id) on delete set null,
  issued_at   timestamptz,
  revoked_by  uuid references public.profiles (id) on delete set null,
  revoked_at  timestamptz,
  revoke_why  text
);

create index if not exists certificates_member on public.certificates (member_id, created_at desc);
create index if not exists certificates_status on public.certificates (status, created_at desc);

alter table public.certificates enable row level security;

drop policy if exists "read certificates" on public.certificates;
create policy "read certificates" on public.certificates for select
  using (member_id = auth.uid() or public.is_admin()
         or public.is_supervisor() or public.is_viewer());

comment on table public.certificates is
  'شهاداتُ الدورات والخبرة: سجلٌّ لا ملفّات، وتُولَّد عند الطلب (ملاحظة ٢٦٧)';

-- ---------------------------------------------------------------------
-- ١) الإنشاءُ مسوّدةً — للمنسق ومن مُنح مفتاحَها
-- ---------------------------------------------------------------------
create or replace function public.save_certificate(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_status text;
begin
  if not (public.is_manager() or public.has_perm('cert_draft')) then
    raise exception 'إنشاءُ الشهادات للمنسقين ومدير المشروع' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p ->> 'title', '')), '') is null then
    raise exception 'اكتب عنوانَ البرنامج أو الشهادة';
  end if;
  if nullif(p ->> 'member_id', '') is null then raise exception 'حدّد العضو'; end if;
  if coalesce(p ->> 'kind', '') not in ('course', 'experience') then
    raise exception 'نوعُ الشهادة: دورةٌ أو خبرة';
  end if;

  if v_id is not null then
    select status into v_status from public.certificates where id = v_id;
    if v_status is null then raise exception 'الشهادة غير موجودة'; end if;
    if v_status <> 'draft' and not public.is_manager() then
      raise exception 'الشهادةُ الصادرةُ لا تُعدَّل' using errcode = '42501';
    end if;
    update public.certificates set
      kind = p ->> 'kind', member_id = (p ->> 'member_id')::uuid,
      title = btrim(p ->> 'title'), subject = nullif(btrim(coalesce(p ->> 'subject', '')), ''),
      hours = nullif(p ->> 'hours', '')::numeric,
      start_on = nullif(p ->> 'start_on', '')::date,
      end_on = nullif(p ->> 'end_on', '')::date,
      place = nullif(btrim(coalesce(p ->> 'place', '')), ''),
      provider = nullif(btrim(coalesce(p ->> 'provider', '')), ''),
      source = coalesce(nullif(p ->> 'source', ''), 'platform'),
      plan_id = nullif(p ->> 'plan_id', '')::uuid,
      role_text = nullif(btrim(coalesce(p ->> 'role_text', '')), ''),
      body = nullif(btrim(coalesce(p ->> 'body', '')), ''),
      design = coalesce(p -> 'design', design),
      signer_name = nullif(btrim(coalesce(p ->> 'signer_name', '')), ''),
      signer_role = nullif(btrim(coalesce(p ->> 'signer_role', '')), ''),
      signature = coalesce(nullif(p ->> 'signature', ''), 'blank')
    where id = v_id;
  else
    insert into public.certificates (
      kind, member_id, title, subject, hours, start_on, end_on, place, provider,
      source, plan_id, role_text, body, design, signer_name, signer_role, signature, created_by)
    values (
      p ->> 'kind', (p ->> 'member_id')::uuid, btrim(p ->> 'title'),
      nullif(btrim(coalesce(p ->> 'subject', '')), ''), nullif(p ->> 'hours', '')::numeric,
      nullif(p ->> 'start_on', '')::date, nullif(p ->> 'end_on', '')::date,
      nullif(btrim(coalesce(p ->> 'place', '')), ''), nullif(btrim(coalesce(p ->> 'provider', '')), ''),
      coalesce(nullif(p ->> 'source', ''), 'platform'), nullif(p ->> 'plan_id', '')::uuid,
      nullif(btrim(coalesce(p ->> 'role_text', '')), ''), nullif(btrim(coalesce(p ->> 'body', '')), ''),
      coalesce(p -> 'design', '{}'::jsonb),
      nullif(btrim(coalesce(p ->> 'signer_name', '')), ''),
      nullif(btrim(coalesce(p ->> 'signer_role', '')), ''),
      coalesce(nullif(p ->> 'signature', ''), 'blank'), auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function public.save_certificate(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) الاعتمادُ والإصدار: هنا وحدَه يُمنح الرقم (ملاحظة ٢٦٧ د و و)
-- ---------------------------------------------------------------------
create or replace function public.issue_certificate(p_cert uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_year int; v_serial int; v_no text; v_status text;
begin
  if not (public.is_manager() or public.has_perm('cert_issue')) then
    raise exception 'اعتمادُ الشهادات بيد مدير المشروع' using errcode = '42501';
  end if;
  select status into v_status from public.certificates where id = p_cert;
  if v_status is null then raise exception 'الشهادة غير موجودة'; end if;
  if v_status = 'issued' then raise exception 'الشهادة صادرةٌ من قبل'; end if;
  if v_status = 'revoked' then raise exception 'الشهادةُ ملغاةٌ ولا تُعاد'; end if;

  v_year := public.hijri_year(current_date);

  insert into public.doc_serials (h_year, lang, scope, kind, last)
  values (v_year, 'AR', 'cert', 'cert', 1)
  on conflict (h_year, lang, scope, kind)
  do update set last = doc_serials.last + 1
  returning last into v_serial;

  v_no := format('HS-%s-%s', v_year, lpad(v_serial::text, 4, '0'));

  update public.certificates
     set status = 'issued', serial_no = v_no, h_year = v_year, serial = v_serial,
         issued_by = auth.uid(), issued_at = now()
   where id = p_cert;

  perform public.log_admin('cert_issue',
    (select member_id from public.certificates where id = p_cert),
    jsonb_build_object('cert', p_cert, 'no', v_no));
  return v_no;
end $$;
grant execute on function public.issue_certificate(uuid) to authenticated;

create or replace function public.revoke_certificate(p_cert uuid, p_why text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.has_perm('cert_revoke')) then
    raise exception 'إلغاءُ الشهادات بيد مدير المشروع' using errcode = '42501';
  end if;
  update public.certificates
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(),
         revoke_why = nullif(btrim(coalesce(p_why, '')), '')
   where id = p_cert and status = 'issued';
  if not found then raise exception 'لا تُلغى إلا شهادةٌ صادرة'; end if;
  perform public.log_admin('cert_revoke', null, jsonb_build_object('cert', p_cert, 'why', p_why));
end $$;
grant execute on function public.revoke_certificate(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) صفحةُ التحقق — عامّةٌ بلا تسجيل دخول (ملاحظة ٢٦٧ ز و ي)
--    والرقمُ وحدَه لا يكفي: معه مفتاحٌ قصيرٌ فلا تُستخرج بالتخمين.
--    ولا يُعرض من بياناته سوى اسمه.
-- ---------------------------------------------------------------------
create or replace function public.verify_certificate(p_no text, p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when c.id is null then jsonb_build_object('found', false)
         else jsonb_build_object(
           'found',   true,
           'no',      c.serial_no,
           'name',    p.full_name,
           'kind',    case when c.kind = 'course' then 'شهادةُ دورةٍ تدريبية' else 'شهادةُ خبرة' end,
           'title',   c.title,
           'hours',   c.hours,
           'start_on', c.start_on,
           'end_on',  c.end_on,
           'issued_at', c.issued_at,
           'state',   case when c.status = 'revoked' then 'ملغاة' else 'صحيحة' end,
           'revoke_why', c.revoke_why)
         end
    from (select 1) z
    left join public.certificates c
           on upper(c.serial_no) = upper(btrim(p_no))
          and c.verify_key = lower(btrim(coalesce(p_key, '')))
          and c.status in ('issued', 'revoked')
    left join public.profiles p on p.id = c.member_id
$$;
grant execute on function public.verify_certificate(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- ٤) القوائم
-- ---------------------------------------------------------------------
create or replace function public.certificates_list(p_status text default null)
returns table (id uuid, kind text, member_id uuid, member_name text, title text,
               hours numeric, start_on date, end_on date, source text,
               status text, serial_no text, verify_key text,
               created_at timestamptz, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.member_id, p.full_name, c.title, c.hours, c.start_on, c.end_on,
         c.source, c.status, c.serial_no, c.verify_key, c.created_at, c.issued_at
    from public.certificates c
    join public.profiles p on p.id = c.member_id
   where (public.is_admin() or public.is_supervisor() or public.is_viewer())
     and (p_status is null or p_status = '' or c.status = p_status)
   order by c.created_at desc
$$;
grant execute on function public.certificates_list(text) to authenticated;

create or replace function public.my_certificates()
returns table (id uuid, kind text, title text, hours numeric, start_on date, end_on date,
               status text, serial_no text, verify_key text, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.title, c.hours, c.start_on, c.end_on,
         c.status, c.serial_no, c.verify_key, c.issued_at
    from public.certificates c
   where c.member_id = auth.uid() and c.status <> 'draft'
   order by c.issued_at desc nulls last
$$;
grant execute on function public.my_certificates() to authenticated;

notify pgrst, 'reload schema';
