-- =====================================================================
-- 0120 — الحساباتُ المصرفية: طلبُ المستند، وتصحيحُ الرقم، والإعادة
--        (ملاحظة ٣٧٣)
--
--   في الجدول حساباتٌ سجَّل أصحابُها أرقامَها ولم يُرفِقوا المستندَ
--   الرسميّ، وحساباتٌ خالفَ مستندُها الرقمَ المكتوب. ولم يكن في اللوحة
--   إلا «توثيق» و«إلغاء التوثيق»: إمّا قبولٌ أو تركٌ بلا بيان.
--
--   فصارت ثلاثةُ أبوابٍ على صفِّ العضو: يُطلَب منه المستندُ فيبقى صفُّه
--   موسومًا بانتظاره؛ ويُصحَّح الرقمُ من اللوحة ويُقيَّد مَن صحَّحه ومتى
--   ويبقى الأصلُ في السجل؛ ويُعاد الطلبُ إلى صاحبه بسببٍ مكتوبٍ فيخرج
--   من «تحت المراجعة» إلى «يُنتظَر تصحيحُه».
-- =====================================================================

-- وأنواعُ الإشعارات تُوسَّع لِما استُجدَّ، فالقيدُ لا يقبل غيرَ المعروف
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('assigned', 'track_completed', 'returned', 'reminder',
                  'data_reminder', 'bank_doc', 'bank_fix'));

alter table public.bank_accounts
  add column if not exists doc_requested_at timestamptz,
  add column if not exists doc_requested_by uuid references public.profiles (id),
  add column if not exists needs_fix        text,
  add column if not exists needs_fix_at     timestamptz,
  add column if not exists needs_fix_by     uuid references public.profiles (id),
  add column if not exists iban_was         text,
  add column if not exists iban_fixed_at    timestamptz,
  add column if not exists iban_fixed_by    uuid references public.profiles (id);

comment on column public.bank_accounts.doc_requested_at is
  'متى طُلب من صاحبه إرفاقُ المستند الرسمي (ملاحظة ٣٧٣)';
comment on column public.bank_accounts.needs_fix is
  'سببُ إعادة الطلب إلى صاحبه ليصحِّح بنفسه (ملاحظة ٣٧٣)';
comment on column public.bank_accounts.iban_was is
  'الرقمُ قبل التصحيح — يبقى في السجل فلا يضيع الأصل (ملاحظة ٣٧٣)';

-- ---------------------------------------------------------------------
-- ١) إعادةُ طلب المستند الرسمي
-- ---------------------------------------------------------------------
create or replace function public.request_bank_doc(p_member uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not (public.is_manager() or public.is_admin_for('bank_check')
          or public.is_admin_for('bank_verify')) then
    raise exception 'طلبُ المستند بإذن مدير المشروع' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = p_member;
  if v_name is null then raise exception 'لا عضوَ بهذا المعرِّف'; end if;

  update public.bank_accounts
     set doc_requested_at = now(), doc_requested_by = auth.uid(),
         verified_at = null, verified_by = null,
         updated_at = now()
   where member_id = p_member;
  if not found then raise exception 'لا حساب مصرفيٌّ لهذا العضو'; end if;

  begin
    perform public.ask_renewal(p_member, 'bank',
      coalesce(nullif(btrim(p_note), ''), 'أرفِقْ خطابَ البنك الرسميَّ الذي يحمل الآيبان'));
  exception when others then
    raise warning 'تعذّر تسجيلُ طلب التجديد: %', sqlerrm;
  end;
  begin
    perform public.enqueue_notification(p_member, 'bank_doc',
      'مطلوبٌ إرفاقُ خطاب البنك',
      coalesce(nullif(btrim(p_note), ''),
        'سُجِّل حسابُك المصرفيُّ بلا مستندٍ رسميّ. أرفِقْ خطابَ البنك في صفحة حسابك.'),
      null);
  exception when others then
    raise warning 'تعذّر إرسالُ الإشعار: %', sqlerrm;
  end;
  perform public.log_admin('bank_doc_request', p_member,
    jsonb_build_object('note', nullif(btrim(p_note), '')));
end $$;
grant execute on function public.request_bank_doc(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٢) إعادةُ الطلب إلى صاحبه ليصحِّح بنفسه، بسببٍ مكتوب
-- ---------------------------------------------------------------------
create or replace function public.return_bank_account(p_member uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_admin_for('bank_check')
          or public.is_admin_for('bank_verify')) then
    raise exception 'إعادةُ الطلب بإذن مدير المشروع' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'اكتبِ السببَ ليعرفَ صاحبُه ما يُصحِّح';
  end if;

  update public.bank_accounts
     set needs_fix = btrim(p_reason), needs_fix_at = now(), needs_fix_by = auth.uid(),
         verified_at = null, verified_by = null, updated_at = now()
   where member_id = p_member;
  if not found then raise exception 'لا حساب مصرفيٌّ لهذا العضو'; end if;

  begin
    perform public.enqueue_notification(p_member, 'bank_fix',
      'حسابُك المصرفيُّ يحتاج تصحيحًا', btrim(p_reason), null);
  exception when others then
    raise warning 'تعذّر إرسالُ الإشعار: %', sqlerrm;
  end;
  perform public.log_admin('bank_return', p_member,
    jsonb_build_object('reason', btrim(p_reason)));
end $$;
grant execute on function public.return_bank_account(uuid, text) to authenticated;

-- وما صحَّحه صاحبُه يُرفَع عنه الوسمُ من تلقاء نفسه
create or replace function public.clear_bank_fix()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.member_id = auth.uid()
     and (new.iban is distinct from old.iban
          or new.account_number is distinct from old.account_number
          or new.doc_path is distinct from old.doc_path) then
    new.needs_fix := null; new.needs_fix_at := null; new.needs_fix_by := null;
    if new.doc_path is not null and new.doc_path is distinct from old.doc_path then
      new.doc_requested_at := null; new.doc_requested_by := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists bank_clear_fix on public.bank_accounts;
create trigger bank_clear_fix before update on public.bank_accounts
  for each row execute function public.clear_bank_fix();

-- ---------------------------------------------------------------------
-- ٣) تصحيحُ الرقم من اللوحة — ويبقى الأصلُ في السجل
-- ---------------------------------------------------------------------
create or replace function public.fix_bank_iban(
  p_member uuid, p_iban text default null, p_account_number text default null,
  p_swift text default null, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_old text; v_scope text;
        v_iban text := nullif(upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g')), '');
        v_swift text := nullif(upper(regexp_replace(coalesce(p_swift, ''), '\s', '', 'g')), '');
        v_acc text := nullif(btrim(coalesce(p_account_number, '')), '');
begin
  if not (public.is_manager() or public.is_admin_for('bank_check')) then
    raise exception 'تصحيحُ الرقم بإذن مدير المشروع' using errcode = '42501';
  end if;
  select iban, scope into v_old, v_scope from public.bank_accounts where member_id = p_member;
  if v_scope is null then raise exception 'لا حساب مصرفيٌّ لهذا العضو'; end if;

  if v_scope = 'local' then
    if v_iban is null or v_iban !~ '^SA[0-9]{22}$' then
      raise exception 'الآيبان السعودي يبدأ بـ SA ويتكوّن من ٢٤ خانة';
    end if;
  elsif v_iban is null and v_acc is null then
    raise exception 'اكتبِ الآيبان أو رقمَ الحساب';
  end if;

  update public.bank_accounts
     set iban = coalesce(v_iban, iban),
         account_number = case when v_acc is not null then v_acc else account_number end,
         swift = case when v_swift is not null then v_swift else swift end,
         iban_was = case when v_iban is not null and v_iban is distinct from v_old
                         then v_old else iban_was end,
         iban_fixed_at = now(), iban_fixed_by = auth.uid(),
         -- التصحيحُ يُلغي التوثيقَ السابق: يُراجَع الرقمُ الجديد
         verified_at = null, verified_by = null,
         needs_fix = null, needs_fix_at = null, needs_fix_by = null,
         notes = case when nullif(btrim(p_note), '') is null then notes
                      else coalesce(notes || ' · ', '') || btrim(p_note) end,
         updated_at = now()
   where member_id = p_member;

  perform public.log_admin('bank_iban_fix', p_member,
    jsonb_build_object('was', left(coalesce(v_old, ''), 6) || '…',
                       'note', nullif(btrim(p_note), '')));
end $$;
grant execute on function public.fix_bank_iban(uuid, text, text, text, text) to authenticated;

comment on function public.fix_bank_iban(uuid, text, text, text, text) is
  'تصحيحُ رقم الحساب من اللوحة: يُقيَّد مَن صحَّحه ومتى، ويبقى الأصل (ملاحظة ٣٧٣)';

-- ---------------------------------------------------------------------
-- ٤) كشفُ الحسابات للوحة: الحالُ ظاهرةٌ بلا تجميعٍ في الواجهة
-- ---------------------------------------------------------------------
create or replace function public.bank_admin_list()
returns table (member_id uuid, full_name text, email text, role text, track text,
               scope text, bank_name text, iban text, account_number text, swift text,
               country text, doc_path text, notes text,
               verified_at timestamptz, doc_requested_at timestamptz,
               needs_fix text, needs_fix_at timestamptz,
               iban_was text, iban_fixed_at timestamptz, state text)
language sql stable security definer set search_path = public as $$
  select b.member_id, p.full_name, p.email, p.role::text, p.track::text,
         b.scope, b.bank_name, b.iban, b.account_number, b.swift, b.country,
         b.doc_path, b.notes, b.verified_at, b.doc_requested_at,
         b.needs_fix, b.needs_fix_at, b.iban_was, b.iban_fixed_at,
         case when b.verified_at is not null         then 'verified'
              when b.needs_fix is not null           then 'needs_fix'
              when b.doc_requested_at is not null    then 'doc_wanted'
              when b.doc_path is null                then 'no_doc'
              else 'review' end
    from public.bank_accounts b
    join public.profiles p on p.id = b.member_id
   where public.is_manager() or public.is_admin_for('bank_view')
      or public.is_admin_for('bank_check') or public.is_admin_for('bank_verify')
      or public.is_admin_for('bank_activate')
   order by case when b.verified_at is null then 0 else 1 end, p.full_name
$$;
grant execute on function public.bank_admin_list() to authenticated;

comment on function public.bank_admin_list() is
  'حساباتُ الفريق المصرفية بحالِ كلٍّ منها: معتمَدٌ أو ينتظر مستندًا أو '
  'يُنتظَر تصحيحُه (ملاحظة ٣٧٣)';

notify pgrst, 'reload schema';
