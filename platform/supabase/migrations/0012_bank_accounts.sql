-- =====================================================================
-- 0012 — الحساب البنكي للعضو (ملاحظة ٨٤)
--   داخل المملكة: اسم البنك والآيبان.
--   خارجها: الآيبان أو رقم الحساب، وسويفت، واسم البنك وعنوانه، والدولة،
--   والعملة، ورمز التوجيه حيث يلزم، وبنك وسيط إن طلبه المحوِّل.
--   البيانات مالية حساسة: يراها صاحبها والمنسق ومدير المشروع فقط.
-- =====================================================================

create table if not exists public.bank_accounts (
  member_id        uuid primary key references public.profiles (id) on delete cascade,
  scope            text not null default 'local' check (scope in ('local', 'international')),
  account_holder   text not null check (length(trim(account_holder)) > 2),
  bank_name        text not null check (length(trim(bank_name)) > 1),
  iban             text,
  account_number   text,
  swift            text,
  routing_code     text,          -- ABA للولايات المتحدة، Sort code لبريطانيا، وما شابه
  bank_address     text,
  country          text,
  currency         text,
  intermediary     text,          -- بنك وسيط: الاسم وسويفت، إن طلبه المحوِّل
  doc_path         text,          -- شهادة الآيبان أو خطاب البنك (PDF)
  notes            text,
  verified_at      timestamptz,
  verified_by      uuid references public.profiles (id),
  updated_at       timestamptz not null default now(),

  -- الآيبان: حرفا دولة ثم رقمان ثم حتى ثلاثين خانة
  constraint bank_iban_shape check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  -- سويفت: ثمانية أو أحد عشر محرفًا
  constraint bank_swift_shape check (swift is null or swift ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  -- داخل المملكة يلزم آيبان سعودي؛ خارجها يلزم آيبان أو رقم حساب مع سويفت
  constraint bank_required check (
    case scope
      when 'local' then iban is not null and iban ~ '^SA[0-9]{22}$'
      else (iban is not null or nullif(trim(coalesce(account_number, '')), '') is not null)
           and swift is not null and nullif(trim(coalesce(country, '')), '') is not null
    end
  )
);

alter table public.bank_accounts enable row level security;

drop policy if exists "see own bank" on public.bank_accounts;
create policy "see own bank" on public.bank_accounts for select
  using (member_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- حفظ الحساب: صاحبه، أو المنسق والمدير نيابةً عنه
-- ---------------------------------------------------------------------
create or replace function public.save_bank_account(
  p_scope          text,
  p_account_holder text,
  p_bank_name      text,
  p_iban           text default null,
  p_account_number text default null,
  p_swift          text default null,
  p_routing_code   text default null,
  p_bank_address   text default null,
  p_country        text default null,
  p_currency       text default null,
  p_intermediary   text default null,
  p_notes          text default null,
  p_member         uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := coalesce(p_member, auth.uid());
  v_iban   text := nullif(upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g')), '');
  v_swift  text := nullif(upper(regexp_replace(coalesce(p_swift, ''), '\s', '', 'g')), '');
  v_scope  text := case when p_scope = 'international' then 'international' else 'local' end;
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if v_member <> auth.uid() and not public.is_admin() then
    raise exception 'لا تُعدّل حساب غيرك' using errcode = '42501';
  end if;

  if v_scope = 'local' then
    if v_iban is null or v_iban !~ '^SA[0-9]{22}$' then
      raise exception 'الآيبان السعودي يبدأ بـ SA ويتكوّن من ٢٤ خانة';
    end if;
    v_swift := null;
  else
    if v_iban is null and nullif(trim(coalesce(p_account_number, '')), '') is null then
      raise exception 'اكتب الآيبان أو رقم الحساب';
    end if;
    if v_swift is null then raise exception 'رمز سويفت لازم للحساب خارج المملكة'; end if;
    if nullif(trim(coalesce(p_country, '')), '') is null then raise exception 'حدد دولة البنك'; end if;
  end if;

  insert into public.bank_accounts as b (member_id, scope, account_holder, bank_name, iban, account_number,
    swift, routing_code, bank_address, country, currency, intermediary, notes, updated_at)
  values (v_member, v_scope, trim(p_account_holder), trim(p_bank_name), v_iban,
    nullif(trim(coalesce(p_account_number, '')), ''), v_swift,
    nullif(trim(coalesce(p_routing_code, '')), ''), nullif(trim(coalesce(p_bank_address, '')), ''),
    nullif(trim(coalesce(p_country, '')), ''), nullif(trim(coalesce(p_currency, '')), ''),
    nullif(trim(coalesce(p_intermediary, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), now())
  on conflict (member_id) do update set
    scope = excluded.scope, account_holder = excluded.account_holder, bank_name = excluded.bank_name,
    iban = excluded.iban, account_number = excluded.account_number, swift = excluded.swift,
    routing_code = excluded.routing_code, bank_address = excluded.bank_address,
    country = excluded.country, currency = excluded.currency, intermediary = excluded.intermediary,
    notes = excluded.notes, updated_at = now(),
    -- أي تعديل يُلغي التوثيق السابق
    verified_at = case when b.iban is distinct from excluded.iban
                         or b.account_number is distinct from excluded.account_number
                         or b.swift is distinct from excluded.swift
                       then null else b.verified_at end,
    verified_by = case when b.iban is distinct from excluded.iban
                         or b.account_number is distinct from excluded.account_number
                         or b.swift is distinct from excluded.swift
                       then null else b.verified_by end;
end $$;

grant execute on function public.save_bank_account(text, text, text, text, text, text, text, text, text, text, text, text, uuid) to authenticated;

-- مسار خطاب البنك
create or replace function public.set_bank_doc(p_path text, p_member uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_member uuid := coalesce(p_member, auth.uid());
begin
  if v_member <> auth.uid() and not public.is_admin() then
    raise exception 'لا تُعدّل حساب غيرك' using errcode = '42501';
  end if;
  update public.bank_accounts set doc_path = p_path, updated_at = now() where member_id = v_member;
  if not found then raise exception 'احفظ بيانات الحساب أولًا'; end if;
end $$;

grant execute on function public.set_bank_doc(text, uuid) to authenticated;

-- توثيق الحساب بعد مطابقته بخطاب البنك — لمدير المشروع
create or replace function public.verify_bank_account(p_member uuid, p_verified boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'التوثيق لمدير المشروع وحده' using errcode = '42501'; end if;
  update public.bank_accounts
     set verified_at = case when p_verified then now() else null end,
         verified_by = case when p_verified then auth.uid() else null end
   where member_id = p_member;
  if not found then raise exception 'لا حساب بنكي لهذا العضو'; end if;
end $$;

grant execute on function public.verify_bank_account(uuid, boolean) to authenticated;

-- حاوية خطابات البنوك (خاصة)
insert into storage.buckets (id, name, public) values ('bank-docs', 'bank-docs', false)
on conflict (id) do nothing;

drop policy if exists "own bank doc read" on storage.objects;
create policy "own bank doc read" on storage.objects for select using (
  bucket_id = 'bank-docs' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
);

drop policy if exists "own bank doc write" on storage.objects;
create policy "own bank doc write" on storage.objects for insert with check (
  bucket_id = 'bank-docs' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
);

comment on table public.bank_accounts
  is 'الحساب البنكي للعضو: بيانات مالية يراها صاحبها والإدارة فقط (ملاحظة ٨٤)';
