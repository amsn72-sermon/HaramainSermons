-- =====================================================================
-- 0079 — الردهةُ لا تُفرج قبل دخول المضيف (ملاحظة ٢٣٦ أ)
--
--   كان قبولُ المنتظر يفتح له رابطَ الجلسة من فوره، فإن لم يكن المضيفُ
--   داخلَ الغرفة بعدُ استقبلته خدمةُ اللقاءات العامة برسالة «في انتظار
--   المضيف — أنا المضيف»، وهي رسالةٌ من عندها لا من عندنا ولا نملك
--   إسقاطَها. فجُعل الإفراجُ معلَّقًا بأمرين: القبولِ، وحضورِ مضيفٍ
--   في الغرفة فعلًا. فإن قُبل ولم يدخل مضيفٌ بعدُ قيل له: «المضيفُ لم
--   يدخل بعد» ولم يُفتح له الرابط، فلا يرى تلك الرسالة أصلًا.
-- =====================================================================

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

  -- المضيفون الحاضرون الآن: من قُبل منهم وكان آخرُ عهدِه بالردهة قريبًا
  select count(*) into v_hosts
    from public.meet_lobby l join public.profiles p on p.id = l.member_id
   where l.scope = p_kind and l.ref_id = p_id and l.state = 'admitted'
     and p.role in ('manager', 'coordinator')
     and l.last_seen_at > now() - interval '3 minutes';

  select count(*) into v_wait
    from public.meet_lobby
   where scope = p_kind and ref_id = p_id and state = 'waiting'
     and last_seen_at > now() - interval '3 minutes';

  -- المضيفُ يدخل بلا إذن، فهو مُنشئُ الغرفة. وغيرُه لا يُفتح له الرابطُ
  -- حتى يكون في الغرفة مضيف (ملاحظة ٢٣٦ أ)
  if v_state = 'admitted' and not v_host and v_hosts = 0 then
    v_state := 'nohost';
  end if;

  if v_state = 'admitted' then
    select base, token into v_base, v_tok from public.meet_base(p_kind, p_id);
  end if;

  return jsonb_build_object(
    'host',    v_host,
    'state',   v_state,
    'url',     public.meet_url_with(v_base, v_tok),
    'hosts',   v_hosts,
    'waiting', v_wait);
end $$;
grant execute on function public.meet_gate(text, uuid) to authenticated;

comment on function public.meet_gate(text, uuid) is
  'بوابةُ الردهة: لا يُفتح الرابطُ لغير المضيف حتى يدخل مضيفٌ الغرفةَ (ملاحظة ٢٣٦ أ)';

notify pgrst, 'reload schema';
