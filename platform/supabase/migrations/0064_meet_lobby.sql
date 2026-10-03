-- =====================================================================
-- 0064 — ردهةُ القاعة: لا يدخل أحدٌ إلا بإذن (ملاحظة ٢٠٣)
--   كانت القاعةُ تفتح لمن عرف رابطَها، فدخلها من لم يُدعَ. والعلّةُ أن
--   خدمةَ اللقاء العامة لا تعرف أدوارَنا: تجعل المضيفَ أولَ الداخلين
--   كائنًا من كان. فجُعل الحَجْزُ عندنا لا عندها، على ثلاثة أركان:
--
--     ١) اسمُ الغرفة لا يُعرف: يُلحَق بالرابط الذي كتبه المنسق جزءٌ
--        عشوائيٌّ لا يُخمَّن، ولا يُسلَّم إلا لمن أُذن له. ويُبدَّل متى
--        خُشي انكشافُه فتُغلق الغرفةُ القديمة على من فيها.
--     ٢) الإداريّون — مدير المشروع والمنسقون ومعهم مدير العمليات
--        التشغيلية ومساعدُه، فصفتاهما على دور المنسق — يدخلون بلا إذن.
--     ٣) من سواهم ينتظر في الردهة، فيرى الإداريُّ اسمَه فيأذن أو يردّ.
--
--   فمن سبق الجميعَ من المترجمين لم يصر مضيفًا، لأنه لا يملك اسمَ الغرفة.
-- =====================================================================

alter table public.rooms    add column if not exists gate_token text;
alter table public.meetings add column if not exists gate_token text;

comment on column public.rooms.gate_token is
  'الجزء العشوائي من اسم الغرفة — لا يُسلَّم إلا لمن أُذن له (ملاحظة ٢٠٣)';

-- ---------------------------------------------------------------------
-- الرابط الفعلي: يُلحق الجزءُ العشوائي بآخر مقطعٍ من المسار
-- ---------------------------------------------------------------------
create or replace function public.meet_url_with(p_base text, p_token text)
returns text language sql immutable as $$
  select case
    when coalesce(p_base, '') = '' then null
    when coalesce(p_token, '') = '' then p_base
    else regexp_replace(split_part(split_part(p_base, '#', 1), '?', 1), '/+$', '')
         || '-' || p_token
  end
$$;

-- ---------------------------------------------------------------------
-- الردهة
-- ---------------------------------------------------------------------
create table if not exists public.meet_lobby (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('m', 'r')),
  ref_id       uuid not null,
  member_id    uuid not null references public.profiles (id) on delete cascade,
  state        text not null default 'waiting' check (state in ('waiting', 'admitted', 'denied')),
  requested_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references public.profiles (id),
  unique (scope, ref_id, member_id)
);
create index if not exists meet_lobby_ref_idx on public.meet_lobby (scope, ref_id, state);
alter table public.meet_lobby enable row level security;
revoke all on public.meet_lobby from anon, authenticated;

comment on table public.meet_lobby is
  'ردهةُ انتظار القاعة: من طلب الدخول وما حُكم به (ملاحظة ٢٠٣)';

-- ---------------------------------------------------------------------
-- الرابطُ الأصلُ للقاعة أو اللقاء، مع توليد الجزء العشوائي عند أول حاجة
-- ---------------------------------------------------------------------
create or replace function public.meet_base(p_kind text, p_id uuid)
returns table (base text, token text)
language plpgsql security definer set search_path = public, extensions as $$
declare v_base text; v_tok text;
begin
  if p_kind = 'r' then
    select join_url, gate_token into v_base, v_tok from public.rooms where id = p_id;
    if v_base is null then return; end if;
    if coalesce(v_tok, '') = '' then
      v_tok := encode(gen_random_bytes(5), 'hex');
      update public.rooms set gate_token = v_tok where id = p_id;
    end if;
  else
    select coalesce(m.join_url, r.join_url), m.gate_token
      into v_base, v_tok
      from public.meetings m left join public.rooms r on r.id = m.room_id
     where m.id = p_id;
    if v_base is null then return; end if;
    if coalesce(v_tok, '') = '' then
      v_tok := encode(gen_random_bytes(5), 'hex');
      update public.meetings set gate_token = v_tok where id = p_id;
    end if;
  end if;
  base := v_base; token := v_tok;
  return next;
end $$;

-- ---------------------------------------------------------------------
-- البوّابة: تُسجّل الطلب، وتُعيد حالَ صاحبِه ورابطَه إن أُذن له
-- ---------------------------------------------------------------------
create or replace function public.meet_gate(p_kind text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_host  boolean := public.is_admin();
  v_state text;
  v_base  text; v_tok text;
  v_hosts int; v_wait int;
begin
  if v_uid is null then raise exception 'لا جلسة' using errcode = '42501'; end if;
  if p_kind not in ('m', 'r') then raise exception 'نوع غير معروف'; end if;

  insert into public.meet_lobby (scope, ref_id, member_id, state, decided_at, decided_by)
    values (p_kind, p_id, v_uid,
            case when v_host then 'admitted' else 'waiting' end,
            case when v_host then now() else null end,
            case when v_host then v_uid else null end)
  on conflict (scope, ref_id, member_id) do update
     set last_seen_at = now(),
         state = case when v_host then 'admitted' else meet_lobby.state end
  returning meet_lobby.state into v_state;

  select count(*) into v_hosts
    from public.meet_lobby l join public.profiles p on p.id = l.member_id
   where l.scope = p_kind and l.ref_id = p_id and l.state = 'admitted'
     and p.role in ('manager', 'coordinator')
     and l.last_seen_at > now() - interval '3 minutes';

  select count(*) into v_wait
    from public.meet_lobby
   where scope = p_kind and ref_id = p_id and state = 'waiting'
     and last_seen_at > now() - interval '3 minutes';

  if v_state = 'admitted' then
    select base, token into v_base, v_tok from public.meet_base(p_kind, p_id);
  end if;

  return jsonb_build_object(
    'host',  v_host,
    'state', v_state,
    'url',   public.meet_url_with(v_base, v_tok),
    'hosts', v_hosts,
    'waiting', v_wait);
end $$;
grant execute on function public.meet_gate(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- من في الردهة الآن — للإداريّين
-- ---------------------------------------------------------------------
create or replace function public.meet_waiting(p_kind text, p_id uuid)
returns table (id uuid, member_id uuid, full_name text, role text,
               requested_at timestamptz, waiting_sec int)
language sql security definer set search_path = public as $$
  select l.id, l.member_id, p.full_name, p.role::text, l.requested_at,
         greatest(0, extract(epoch from now() - l.requested_at))::int
    from public.meet_lobby l join public.profiles p on p.id = l.member_id
   where public.is_admin()
     and l.scope = p_kind and l.ref_id = p_id and l.state = 'waiting'
     and l.last_seen_at > now() - interval '3 minutes'
   order by l.requested_at
$$;
grant execute on function public.meet_waiting(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- الإذنُ أو الردّ
-- ---------------------------------------------------------------------
create or replace function public.meet_decide(p_row uuid, p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'الإذنُ بالدخول للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  update public.meet_lobby
     set state = case when p_ok then 'admitted' else 'denied' end,
         decided_at = now(), decided_by = auth.uid()
   where id = p_row;
  if not found then raise exception 'الطلب غير موجود'; end if;
end $$;
grant execute on function public.meet_decide(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- تبديلُ اسم الغرفة: تُغلق القديمةُ على من فيها، ويعود الجميع إلى الردهة
-- ---------------------------------------------------------------------
create or replace function public.meet_rotate(p_kind text, p_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_tok text := encode(gen_random_bytes(5), 'hex'); v_base text;
begin
  if not public.is_admin() then
    raise exception 'تبديلُ اسم الغرفة للمنسق ومدير المشروع' using errcode = '42501';
  end if;
  if p_kind = 'r' then
    update public.rooms set gate_token = v_tok where id = p_id;
    select join_url into v_base from public.rooms where id = p_id;
  else
    update public.meetings set gate_token = v_tok where id = p_id;
    select coalesce(m.join_url, r.join_url) into v_base
      from public.meetings m left join public.rooms r on r.id = m.room_id where m.id = p_id;
  end if;
  if not found then raise exception 'القاعة غير موجودة'; end if;

  -- من ليس إداريًّا يعود إلى الردهة فيُستأذن من جديد
  update public.meet_lobby l
     set state = 'waiting', decided_at = null, decided_by = null
    from public.profiles p
   where p.id = l.member_id and l.scope = p_kind and l.ref_id = p_id
     and p.role not in ('manager', 'coordinator');

  return public.meet_url_with(v_base, v_tok);
end $$;
grant execute on function public.meet_rotate(text, uuid) to authenticated;

notify pgrst, 'reload schema';
