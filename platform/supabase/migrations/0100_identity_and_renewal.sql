-- =====================================================================
-- 0100 — الهويةُ الشخصيةُ تُدقَّق، والمستندُ يُجدَّد (ملاحظتا ٣٠٧ و٣٠٨)
--
--   «تدقيقُ المستندات» يبتُّ في الصورة: أواضحةٌ مقبولة؟ ولا يُري رقمَ
--   الهوية ولا تاريخَ انتهائها، فلا يستطيع المدقّقُ أن يطابق المكتوبَ
--   بالمصوَّر. فيُفرَد للهوية تبويبٌ كتبويب الحسابات المصرفية: الرقمُ
--   والنوعُ والتاريخُ والجنسيةُ والصورةُ مجتمعةً، ثم قبولٌ أو إعادة.
--
--   وبعد الاعتماد تُجدَّد الهويةُ وتُبدَّل الحسابات، فلا بدَّ من بابٍ
--   للتجديد يفتحه العضوُ من عنده أو تطلبه الإدارة. والقديمُ معمولٌ به
--   حتى يُعتمد الجديد، فلا تتعطّل أعمالُه ولا مستحقاتُه.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) تاريخُ انتهاء الهوية: حقلٌ جديدٌ يدخل في اكتمال البيانات
-- ---------------------------------------------------------------------
alter table public.profile_private
  add column if not exists id_expiry date;

comment on column public.profile_private.id_expiry is
  'تاريخُ انتهاء الهوية أو الإقامة أو الجواز (ملاحظة ٣٠٧)';

-- ---------------------------------------------------------------------
-- ٢) طلباتُ التجديد: سجلٌّ واحدٌ لكلِّ مستندٍ في كلِّ مرّة
-- ---------------------------------------------------------------------
create table if not exists public.doc_renewals (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('iqama', 'photo', 'bank')),
  state       text not null default 'open' check (state in ('open', 'done', 'cancelled')),
  asked_by    uuid references public.profiles (id),   -- فارغٌ إن بدأه العضو
  reason      text,
  at          timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   uuid references public.profiles (id)
);

create unique index if not exists doc_renewals_one_open
  on public.doc_renewals (member_id, kind) where state = 'open';
create index if not exists doc_renewals_member on public.doc_renewals (member_id, kind, at desc);

comment on table public.doc_renewals is
  'طلباتُ تجديد المستندات: من العضو أو من الإدارة، واحدٌ مفتوحٌ لكلِّ مستند (ملاحظة ٣٠٨)';

-- وسجلُّ النسخ: ما بُدِّل ومتى، فلا يضيع حسابٌ صُرف عليه
create table if not exists public.doc_history (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('iqama', 'photo', 'bank')),
  snapshot    jsonb not null,
  at          timestamptz not null default now(),
  by_member   uuid references public.profiles (id)
);
create index if not exists doc_history_member on public.doc_history (member_id, kind, at desc);

comment on table public.doc_history is
  'النسخُ السابقةُ للمستندات: ما كان قبل التجديد (ملاحظة ٣٠٨)';

alter table public.doc_renewals enable row level security;
alter table public.doc_history  enable row level security;

drop policy if exists "see own renewals" on public.doc_renewals;
create policy "see own renewals" on public.doc_renewals for select
  using (member_id = auth.uid() or public.is_admin() or public.is_supervisor() or public.is_viewer());

drop policy if exists "see doc history" on public.doc_history;
create policy "see doc history" on public.doc_history for select
  using (member_id = auth.uid() or public.is_admin() or public.is_supervisor() or public.is_viewer());

-- ---------------------------------------------------------------------
-- ٣) كشفُ الهويات: صفٌّ لكلِّ عضوٍ بما يُطابَق به
--    ولا يُعرَض إلا لمن مُنح مفتاحَ الاطّلاع على الصورة (ملاحظة ٣٠٧)
-- ---------------------------------------------------------------------
create or replace function public.identity_sheet(p_group text default 'all')
returns table (
  member_id uuid, full_name text, email text, role public.app_role, track text,
  member_no int, status public.member_status,
  id_type text, national_id text, nationality text, id_expiry date,
  iqama_path text, iqama_status public.doc_status, iqama_note text, iqama_at timestamptz,
  days_left int, renewal_open boolean, renewal_reason text
) language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.role, p.track, p.member_no, p.status,
         pp.id_type, pp.national_id, pp.nationality, pp.id_expiry,
         pp.iqama_path, pp.iqama_status, pp.iqama_note, pp.iqama_at,
         case when pp.id_expiry is null then null
              else (pp.id_expiry - current_date)::int end,
         exists (select 1 from public.doc_renewals r
                  where r.member_id = p.id and r.kind = 'iqama' and r.state = 'open'),
         (select r.reason from public.doc_renewals r
           where r.member_id = p.id and r.kind = 'iqama' and r.state = 'open' limit 1)
    from public.profiles p
    join public.profile_private pp on pp.id = p.id
   where public.is_admin_for('docs_id_view')
     and (p_group is null or p_group = 'all'
          or (p_group = 'admins'      and p.role in ('manager', 'coordinator', 'supervisor', 'viewer'))
          or (p_group = 'translators' and p.role = 'translator' and coalesce(p.track, '') <> 'field')
          or (p_group = 'field'       and coalesce(p.track, '') = 'field'))
   order by (pp.iqama_status = 'pending') desc,
            coalesce(pp.id_expiry, date '9999-12-31'), p.full_name
$$;
grant execute on function public.identity_sheet(text) to authenticated;

comment on function public.identity_sheet(text) is
  'كشفُ الهويات للتدقيق: الرقمُ والنوعُ والتاريخُ والصورة (ملاحظة ٣٠٧)';

-- ---------------------------------------------------------------------
-- ٤) حفظُ بيانات الهوية من الإدارة بعد المطابقة
-- ---------------------------------------------------------------------
create or replace function public.set_identity(
  p_member uuid, p_id_type text default null, p_national_id text default null,
  p_nationality text default null, p_expiry date default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_admin_for('tm_edit')) then
    raise exception 'تعديلُ بيانات الهوية بإذن مدير المشروع' using errcode = '42501';
  end if;
  if p_id_type is not null and p_id_type not in ('national', 'passport') then
    raise exception 'نوعُ الهوية: هويةٌ وطنيةٌ أو إقامة، أو جوازُ سفر';
  end if;

  update public.profile_private pp
     set id_type     = coalesce(p_id_type, pp.id_type),
         national_id = coalesce(nullif(btrim(p_national_id), ''), pp.national_id),
         nationality = coalesce(nullif(btrim(p_nationality), ''), pp.nationality),
         id_expiry   = coalesce(p_expiry, pp.id_expiry)
   where pp.id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
end $$;
grant execute on function public.set_identity(uuid, text, text, text, date) to authenticated;

-- وتاريخُ الانتهاء يضعه العضوُ لنفسه كسائر بياناته
create or replace function public.set_my_id_expiry(p_expiry date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'لا جلسة' using errcode = '42501'; end if;
  update public.profile_private set id_expiry = p_expiry where id = auth.uid();
end $$;
grant execute on function public.set_my_id_expiry(date) to authenticated;

-- ---------------------------------------------------------------------
-- ٥) التجديد: يبتدئه العضوُ، أو تطلبه الإدارة (ملاحظة ٣٠٨)
-- ---------------------------------------------------------------------
create or replace function public.ask_renewal(
  p_member uuid, p_kind text, p_reason text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_self boolean := (p_member = auth.uid());
begin
  if p_kind not in ('iqama', 'photo', 'bank') then
    raise exception 'مستندٌ غيرُ معروف';
  end if;
  -- العضوُ يبتدئ لنفسه بلا إذنٍ سابق، والإدارةُ تطلب من غيره
  if not v_self and not (public.is_manager() or public.is_admin_for('docs_check')) then
    raise exception 'طلبُ التجديد بإذن مدير المشروع' using errcode = '42501';
  end if;
  if v_self and public.my_role() is null then
    raise exception 'لا جلسة' using errcode = '42501';
  end if;

  -- لا طلبَ ثانٍ ما دام الأولُ لم يُبَتَّ فيه، فلا تتراكم النسخُ على المدقّق
  select id into v_id from public.doc_renewals
   where member_id = p_member and kind = p_kind and state = 'open';
  if v_id is not null then
    update public.doc_renewals
       set reason = coalesce(nullif(btrim(p_reason), ''), reason), at = now()
     where id = v_id;
    return v_id;
  end if;

  insert into public.doc_renewals (member_id, kind, asked_by, reason)
  values (p_member, p_kind, case when v_self then null else auth.uid() end,
          nullif(btrim(p_reason), ''))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.ask_renewal(uuid, text, text) to authenticated;

comment on function public.ask_renewal(uuid, text, text) is
  'طلبُ تجديد مستند: من العضو لنفسه، أو من الإدارة له (ملاحظة ٣٠٨)';

-- إلغاءُ الطلب: صاحبُه أو الإدارة
create or replace function public.cancel_renewal(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_member uuid;
begin
  select member_id into v_member from public.doc_renewals where id = p_id and state = 'open';
  if v_member is null then raise exception 'لا طلبَ مفتوحًا'; end if;
  if v_member <> auth.uid() and not (public.is_manager() or public.is_admin_for('docs_check')) then
    raise exception 'إلغاءُ الطلب لصاحبه أو للإدارة' using errcode = '42501';
  end if;
  update public.doc_renewals
     set state = 'cancelled', closed_at = now(), closed_by = auth.uid()
   where id = p_id;
end $$;
grant execute on function public.cancel_renewal(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) وحين يُعتمد الجديدُ يُغلَق طلبُه، وتُحفظ نسختُه السابقة
-- ---------------------------------------------------------------------
create or replace function public.snapshot_doc(p_member uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare v_snap jsonb;
begin
  if p_kind = 'iqama' then
    select to_jsonb(x) into v_snap from (
      select pp.iqama_path, pp.iqama_status, pp.national_id, pp.id_type,
             pp.nationality, pp.id_expiry
        from public.profile_private pp where pp.id = p_member) x;
  elsif p_kind = 'photo' then
    select to_jsonb(x) into v_snap from (
      select pp.photo_status from public.profile_private pp where pp.id = p_member) x;
  else
    select to_jsonb(x) into v_snap from (
      select b.iban, b.account_number, b.account_holder, b.bank_name, b.scope,
             b.doc_path, b.verified_at
        from public.bank_accounts b where b.member_id = p_member) x;
  end if;
  if v_snap is null then return; end if;
  insert into public.doc_history (member_id, kind, snapshot, by_member)
  values (p_member, p_kind, v_snap, auth.uid());
end $$;
grant execute on function public.snapshot_doc(uuid, text) to authenticated;

-- يُغلَق الطلبُ المفتوحُ عند اعتماد المستند
create or replace function public.close_renewal(p_member uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.doc_renewals
     set state = 'done', closed_at = now(), closed_by = auth.uid()
   where member_id = p_member and kind = p_kind and state = 'open';
end $$;
grant execute on function public.close_renewal(uuid, text) to authenticated;

-- وتُربَط بالاعتماد: review_member_doc يُغلق طلبَ التجديد إن كان مفتوحًا
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'review_member_doc';
  if v_src is null or position('close_renewal' in v_src) > 0 then return; end if;
  -- يُدرَج قبل آخر end; في جسم الدالة
  v_new := regexp_replace(v_src,
    '(\s+)end\s*\$function\$\s*$',
    E'\\1  if p_decision = ''approved'' then\n'
    || E'    perform public.close_renewal(p_member, p_kind);\n'
    || E'  end if;\\1end $function$');
  if v_new <> v_src then execute v_new; end if;
end $do$;

-- وكذلك توثيقُ الحساب المصرفي يُغلق طلبَه
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verify_bank_account';
  if v_src is null or position('close_renewal' in v_src) > 0 then return; end if;
  v_new := regexp_replace(v_src,
    '(\s+)end\s*\$function\$\s*$',
    E'\\1  if coalesce(p_verified, true) then\n'
    || E'    perform public.close_renewal(p_member, ''bank'');\n'
    || E'  end if;\\1end $function$');
  if v_new <> v_src then execute v_new; end if;
end $do$;

-- ---------------------------------------------------------------------
-- ٧) ما يراه العضوُ عن مستنداته وطلباتها (ملاحظة ٣٠٨)
-- ---------------------------------------------------------------------
create or replace function public.my_docs_state()
returns table (kind text, status text, note text, at timestamptz,
               renewal_open boolean, renewal_reason text, asked_by_admin boolean,
               id_expiry date, days_left int)
language sql stable security definer set search_path = public as $$
  with me as (select * from public.profile_private where id = auth.uid()),
       r as (select kind, reason, asked_by from public.doc_renewals
              where member_id = auth.uid() and state = 'open')
  select 'iqama', (select iqama_status::text from me), (select iqama_note from me),
         (select iqama_at from me),
         exists (select 1 from r where r.kind = 'iqama'),
         (select reason from r where r.kind = 'iqama'),
         (select asked_by is not null from r where r.kind = 'iqama'),
         (select id_expiry from me),
         (select case when id_expiry is null then null
                      else (id_expiry - current_date)::int end from me)
  union all
  select 'photo', (select photo_status::text from me), (select photo_note from me),
         (select photo_at from me),
         exists (select 1 from r where r.kind = 'photo'),
         (select reason from r where r.kind = 'photo'),
         (select asked_by is not null from r where r.kind = 'photo'),
         null, null
  union all
  select 'bank',
         (select case when b.verified_at is not null then 'approved' else 'pending' end
            from public.bank_accounts b where b.member_id = auth.uid()),
         null,
         (select b.updated_at from public.bank_accounts b where b.member_id = auth.uid()),
         exists (select 1 from r where r.kind = 'bank'),
         (select reason from r where r.kind = 'bank'),
         (select asked_by is not null from r where r.kind = 'bank'),
         null, null
$$;
grant execute on function public.my_docs_state() to authenticated;

-- ---------------------------------------------------------------------
-- ٨) ومن انتهت هويتُه أو قاربت يُعرَض للإدارة (ملاحظة ٣٠٨)
-- ---------------------------------------------------------------------
create or replace function public.expiring_ids(p_days int default 90)
returns table (member_id uuid, full_name text, id_expiry date, days_left int,
               renewal_open boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, pp.id_expiry, (pp.id_expiry - current_date)::int,
         exists (select 1 from public.doc_renewals r
                  where r.member_id = p.id and r.kind = 'iqama' and r.state = 'open')
    from public.profiles p join public.profile_private pp on pp.id = p.id
   where (public.is_manager() or public.is_admin_for('docs_check'))
     and p.status = 'active'
     and pp.id_expiry is not null
     and pp.id_expiry - current_date <= greatest(0, p_days)
   order by pp.id_expiry
$$;
grant execute on function public.expiring_ids(int) to authenticated;

notify pgrst, 'reload schema';
