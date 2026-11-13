-- =====================================================================
-- ٠١٤٩ — إجازةُ المترجم وتأمينُ بديله (ملاحظتا ١١ و١٢ من دفعة ٥٠٢)
--
--   يعتذر المترجمُ لسفرٍ أو عذر، فيُطلَب منه تأمينُ بديل. وكان ذلك
--   يجري بالمراسلة خارجَ المنصة، فلا يُعرَف من أُجيز ومن حلَّ محلَّه
--   ولا متى، ويُحسَب على المجيز تأخيرٌ ليس منه.
--
--   فصار في المنصة بابُه: يطلب المترجمُ إجازةً لمدّةٍ، إمّا بتأمين
--   بديلٍ وإمّا بدونه. وإن أمَّن بديلًا لم يُكلَّفْ ببياناته: يكتب
--   اسمَه ورقمَ جوّاله لا غير. ثمَّ قبولان لا واحد: قبولُ الإجازة،
--   وقبولُ البديل — فقد تُقبَل الإجازةُ ويُرَدُّ البديل.
--
--   فإذا قُبل البديلُ أُنشئ له رمزٌ سرِّيٌّ لا يُخمَّن، يفتح به صفحةً
--   خاصّةً به وحدَه يُكمِل فيها بياناته ويوقِّع الميثاق. والرمزُ
--   محدودُ المدّة، ويبطل بتمام التسجيل، ويُرسَل إلى جوّاله.
-- =====================================================================

-- ـــ ١) الطلب
create table if not exists public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.profiles (id) on delete cascade,
  from_date     date not null,
  to_date       date not null,
  reason        text,
  with_sub      boolean not null default false,
  sub_name      text,
  sub_phone     text,
  -- حالُ الإجازة وحالُ البديل، كلٌّ على حدة
  state         text not null default 'pending'
                check (state in ('pending', 'approved', 'rejected', 'cancelled')),
  sub_state     text not null default 'none'
                check (sub_state in ('none', 'pending', 'approved', 'rejected', 'done')),
  decided_by    uuid references public.profiles (id),
  decided_at    timestamptz,
  admin_note    text,
  -- البديلُ بعد تسجيله يصير عضوًا، فيُربَط به
  sub_member_id uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  check (to_date >= from_date)
);
create index if not exists leave_requests_member
  on public.leave_requests (member_id, from_date desc);
create index if not exists leave_requests_state
  on public.leave_requests (state) where state = 'pending';

alter table public.leave_requests enable row level security;
drop policy if exists "see own leave" on public.leave_requests;
create policy "see own leave" on public.leave_requests for select
  to authenticated using (member_id = auth.uid() or public.is_admin());

comment on table public.leave_requests is
  'طلباتُ إجازة المترجمين وتأمينُ بدلائهم (ملاحظة ٥٠٢)';

-- ـــ ٢) دعوةُ البديل: رمزٌ سرِّيٌّ محدودُ المدّة
create table if not exists public.sub_invites (
  token      text primary key,
  leave_id   uuid not null references public.leave_requests (id) on delete cascade,
  name       text not null,
  phone      text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sub_invites_leave on public.sub_invites (leave_id);
alter table public.sub_invites enable row level security;
-- ولا يُقرأ من العملاء: البابُ دالّةٌ تأخذ الرمزَ وتردُّ ما يلزم
drop policy if exists "no read invites" on public.sub_invites;

comment on table public.sub_invites is
  'روابطُ البدلاء السرِّيّة: رمزٌ لصاحبه وحدَه، محدودُ المدّة (ملاحظة ٥٠٢)';

-- ـــ ٣) المترجمُ يطلب
create or replace function public.request_leave(
  p_from date, p_to date, p_reason text,
  p_with_sub boolean default false,
  p_sub_name text default null, p_sub_phone text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := nullif(btrim(coalesce(p_sub_name, '')), '');
        v_ph text := nullif(regexp_replace(coalesce(p_sub_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles
                  where id = auth.uid() and status = 'active') then
    raise exception 'الطلبُ للأعضاء القائمين' using errcode = '42501';
  end if;
  if p_from is null or p_to is null then raise exception 'حدِّدْ مدّةَ الإجازة'; end if;
  if p_to < p_from then raise exception 'تاريخُ النهاية قبل البداية'; end if;
  if p_to - p_from > 180 then raise exception 'المدّةُ ستّةُ أشهرٍ على الأكثر'; end if;
  if p_with_sub and (v_name is null or v_ph is null) then
    raise exception 'اكتبْ اسمَ البديل ورقمَ جوّاله';
  end if;
  if v_ph is not null and length(v_ph) < 9 then
    raise exception 'رقمُ الجوّال غيرُ مكتمل';
  end if;
  -- ولا يُترَك طلبٌ معلَّقٌ ثمَّ يُطلَب غيرُه، فتلتبس الحال
  if exists (select 1 from public.leave_requests
              where member_id = auth.uid() and state = 'pending') then
    raise exception 'لك طلبُ إجازةٍ معلَّقٌ لم يُبَتَّ فيه بعد';
  end if;

  insert into public.leave_requests
    (member_id, from_date, to_date, reason, with_sub, sub_name, sub_phone, sub_state)
  values (auth.uid(), p_from, p_to, nullif(btrim(coalesce(p_reason, '')), ''),
          coalesce(p_with_sub, false), v_name, v_ph,
          case when coalesce(p_with_sub, false) then 'pending' else 'none' end)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.request_leave(date, date, text, boolean, text, text)
  to authenticated;

comment on function public.request_leave(date, date, text, boolean, text, text) is
  'طلبُ إجازةٍ ببديلٍ أو بدونه؛ ولا يُطلَب من البديل إلّا اسمُه ورقمُه (ملاحظة ٥٠٢)';

-- وللعضو أن يسحب طلبَه ما دام معلَّقًا
create or replace function public.cancel_leave(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.leave_requests
     set state = 'cancelled',
         sub_state = case when sub_state = 'pending' then 'rejected' else sub_state end
   where id = p_id and member_id = auth.uid() and state = 'pending';
  if not found then raise exception 'لا طلبَ معلَّقٌ لك بهذا الرقم'; end if;
end $$;
grant execute on function public.cancel_leave(uuid) to authenticated;

-- ـــ ٤) الإدارةُ تقرأ الطلبات
create or replace function public.leave_sheet(p_state text default null)
returns table (id uuid, member_id uuid, full_name text, member_no int, track text,
               city text, from_date date, to_date date, reason text,
               with_sub boolean, sub_name text, sub_phone text,
               state text, sub_state text, admin_note text,
               sub_member_id uuid, sub_member text,
               invite_sent boolean, invite_expires timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.member_id, p.full_name, p.member_no,
         coalesce(p.track, 'translation'), p.city,
         l.from_date, l.to_date, l.reason,
         l.with_sub, l.sub_name, l.sub_phone, l.state, l.sub_state, l.admin_note,
         l.sub_member_id, sp.full_name,
         exists (select 1 from public.sub_invites i where i.leave_id = l.id),
         (select max(i.expires_at) from public.sub_invites i where i.leave_id = l.id),
         l.created_at
    from public.leave_requests l
    join public.profiles p on p.id = l.member_id
    left join public.profiles sp on sp.id = l.sub_member_id
   where public.is_admin_for('tm_view')
     and (nullif(btrim(coalesce(p_state, '')), '') is null or l.state = btrim(p_state))
   order by (l.state = 'pending') desc, l.from_date desc
$$;
grant execute on function public.leave_sheet(text) to authenticated;

-- وللعضو طلباتُه هو
create or replace function public.my_leaves()
returns table (id uuid, from_date date, to_date date, reason text,
               with_sub boolean, sub_name text, state text, sub_state text,
               admin_note text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.from_date, l.to_date, l.reason, l.with_sub, l.sub_name,
         l.state, l.sub_state, l.admin_note, l.created_at
    from public.leave_requests l
   where l.member_id = auth.uid()
   order by l.created_at desc
$$;
grant execute on function public.my_leaves() to authenticated;

-- ـــ ٥) القرار: الإجازةُ والبديلُ كلٌّ على حدة
create or replace function public.decide_leave(
  p_id uuid, p_leave text, p_sub text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leave_requests; v_token text; v_days int := 14;
begin
  if not public.is_admin_for('tm_edit') then
    raise exception 'البتُّ في الإجازات لمن يملك تعديلَ الفريق' using errcode = '42501';
  end if;
  select * into l from public.leave_requests where id = p_id;
  if l.id is null then raise exception 'لا طلبَ بهذا الرقم'; end if;
  if p_leave not in ('approved', 'rejected') then
    raise exception 'القرارُ قبولٌ أو ردّ';
  end if;

  update public.leave_requests
     set state = p_leave,
         admin_note = nullif(btrim(coalesce(p_note, '')), ''),
         decided_by = auth.uid(), decided_at = now(),
         sub_state = case
           when not l.with_sub then 'none'
           when p_leave = 'rejected' then 'rejected'
           when p_sub in ('approved', 'rejected') then p_sub
           else l.sub_state end
   where id = p_id
  returning * into l;

  perform public.enqueue_notification(l.member_id, 'data_reminder',
    case when p_leave = 'approved' then 'قُبل طلبُ إجازتك' else 'لم يُقبَل طلبُ إجازتك' end,
    'طلبُك للمدّة من ' || l.from_date || ' إلى ' || l.to_date || ': '
    || case when p_leave = 'approved' then 'مقبول.' else 'غيرُ مقبول.' end
    || coalesce(' ' || l.admin_note, ''), null);

  -- فإذا قُبل البديلُ أُنشئ رمزُه السرِّيّ
  if l.with_sub and l.sub_state = 'approved' then
    select token into v_token from public.sub_invites
     where leave_id = p_id and used_at is null and expires_at > now()
     limit 1;
    if v_token is null then
      v_token := encode(sha256(convert_to(
        p_id::text || l.sub_phone || clock_timestamp()::text || random()::text, 'UTF8')), 'hex');
      insert into public.sub_invites (token, leave_id, name, phone, expires_at)
      values (v_token, p_id, l.sub_name, l.sub_phone, now() + (v_days || ' days')::interval);
    end if;
  end if;

  perform public.log_admin('leave_decide', l.member_id,
    jsonb_build_object('leave', p_leave, 'sub', l.sub_state, 'id', p_id));

  return jsonb_build_object('state', l.state, 'sub_state', l.sub_state,
                            'token', v_token, 'phone', l.sub_phone, 'name', l.sub_name);
end $$;
grant execute on function public.decide_leave(uuid, text, text, text) to authenticated;

comment on function public.decide_leave(uuid, text, text, text) is
  'قبولُ الإجازة وقبولُ البديل، ويُنشَأ رمزُ البديل عند قبوله (ملاحظة ٥٠٢)';

-- وإعادةُ إنشاء الرمز إن انتهت مدّتُه ولم يُسجِّل البديل
create or replace function public.resend_sub_invite(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.leave_requests; v_token text;
begin
  if not public.is_admin_for('tm_edit') then
    raise exception 'الدعوةُ لمن يملك تعديلَ الفريق' using errcode = '42501';
  end if;
  select * into l from public.leave_requests where id = p_id;
  if l.id is null or l.sub_state <> 'approved' then
    raise exception 'لا بديلَ مقبولًا في هذا الطلب';
  end if;
  update public.sub_invites set expires_at = now()
   where leave_id = p_id and used_at is null;
  v_token := encode(sha256(convert_to(
    p_id::text || l.sub_phone || clock_timestamp()::text || random()::text, 'UTF8')), 'hex');
  insert into public.sub_invites (token, leave_id, name, phone, expires_at)
  values (v_token, p_id, l.sub_name, l.sub_phone, now() + interval '14 days');
  return jsonb_build_object('token', v_token, 'phone', l.sub_phone, 'name', l.sub_name);
end $$;
grant execute on function public.resend_sub_invite(uuid) to authenticated;

-- ـــ ٦) صفحةُ البديل: يفتحها برمزه، فتُعرَف دعوتُه قبل أن يكتب شيئًا
create or replace function public.sub_invite_open(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare i public.sub_invites; l public.leave_requests; p public.profiles;
begin
  select * into i from public.sub_invites
   where token = btrim(coalesce(p_token, '')) and length(btrim(coalesce(p_token, ''))) >= 32;
  if i.token is null then return jsonb_build_object('ok', false, 'why', 'notfound'); end if;
  if i.used_at is not null then return jsonb_build_object('ok', false, 'why', 'used'); end if;
  if i.expires_at <= now() then return jsonb_build_object('ok', false, 'why', 'expired'); end if;

  select * into l from public.leave_requests where id = i.leave_id;
  select * into p from public.profiles where id = l.member_id;
  return jsonb_build_object(
    'ok', true, 'name', i.name, 'phone', i.phone,
    'from', l.from_date, 'to', l.to_date,
    'of_whom', p.full_name, 'track', coalesce(p.track, 'translation'),
    'city', p.city, 'expires_at', i.expires_at);
end $$;
grant execute on function public.sub_invite_open(text) to anon, authenticated;

comment on function public.sub_invite_open(text) is
  'فتحُ دعوة البديل برمزها: لمن معه الرمزُ وحدَه، ومحدودةُ المدّة (ملاحظة ٥٠٢)';

notify pgrst, 'reload schema';

-- ـــ ٧) البديلُ يربط نفسَه بالدعوة بعد أن يُنشئ حسابَه
--
--   الرمزُ وحدَه لا يُنشئ حسابًا: يُسجِّل البديلُ في المنصة كما يسجِّل
--   غيرُه، ثمَّ يفتح رابطَه وهو داخلٌ فيُربَط بالدعوة. فيأخذ فريقَ
--   من أنابه ومدينتَه، ويُعلَم أنَّه بديلٌ له في تلك المدّة، ويبطل
--   الرمزُ فلا يُستعمل مرّتين.
create or replace function public.sub_invite_claim(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.sub_invites; l public.leave_requests; p public.profiles;
begin
  if auth.uid() is null then
    raise exception 'أنشئْ حسابَك ثمَّ افتحِ الرابطَ من جديد' using errcode = '42501';
  end if;
  select * into i from public.sub_invites
   where token = btrim(coalesce(p_token, '')) and length(btrim(coalesce(p_token, ''))) >= 32;
  if i.token is null then return jsonb_build_object('ok', false, 'why', 'notfound'); end if;
  if i.used_at is not null then return jsonb_build_object('ok', false, 'why', 'used'); end if;
  if i.expires_at <= now() then return jsonb_build_object('ok', false, 'why', 'expired'); end if;

  select * into l from public.leave_requests where id = i.leave_id;
  if l.sub_member_id is not null and l.sub_member_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'why', 'taken');
  end if;
  select * into p from public.profiles where id = l.member_id;

  -- البديلُ يأخذ فريقَ من أنابه ومدينتَه، ولا يُمَسُّ دورُه إن كان عضوًا من قبل
  update public.profiles
     set track = coalesce(track, p.track),
         city  = coalesce(city, p.city)
   where id = auth.uid();

  update public.leave_requests
     set sub_member_id = auth.uid(), sub_state = 'done'
   where id = l.id;
  update public.sub_invites set used_at = now() where token = i.token;

  -- وتُخبَر الإدارةُ ومن أنابه
  perform public.enqueue_notification(l.member_id, 'data_reminder',
    'سجَّل بديلُك في المنصة',
    'البديلُ الذي أمَّنتَه (' || i.name || ') أنشأ حسابَه وارتبط بإجازتك من '
    || l.from_date || ' إلى ' || l.to_date || '. وعليه إكمالُ بياناته وتوقيعُ الميثاق.',
    null);

  return jsonb_build_object('ok', true, 'of_whom', p.full_name,
                            'from', l.from_date, 'to', l.to_date);
end $$;
grant execute on function public.sub_invite_claim(text) to authenticated;

comment on function public.sub_invite_claim(text) is
  'ربطُ البديل بدعوته بعد إنشاء حسابه، ويبطل الرمزُ بعدها (ملاحظة ٥٠٢)';

notify pgrst, 'reload schema';
