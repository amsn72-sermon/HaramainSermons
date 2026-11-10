-- =====================================================================
-- ٠١٤٠ — إثباتُ التوقيع على التعاميم كإثباته على الميثاق (ملاحظة ٤٩٣)
--
--   التوقيعُ على التعميم كان يحفظ أمرين: الاسمَ المكتوبَ وصورةَ التوقيع
--   المرسوم. وأمّا ميثاقُ العمل فيحفظ معهما بصمةَ النصِّ الموقَّع وعنوانَ
--   الشبكة ووصفَ الجهاز (الملاحظتان ٤٢٥ و١٦٤). فالتعميمُ الملزمُ أولى
--   أن يكون إثباتُه مثلَه، إذ يُحتجُّ به كما يُحتجُّ بالميثاق.
--
--   فصار لكلِّ توقيعٍ على تعميمٍ سجلُّ إثباتٍ مستقلّ: بصمةُ النصِّ الذي
--   عُرِض على العضو حرفًا بحرف، وعنوانُه، وجهازُه، ووصفُ متصفِّحه. ويبقى
--   في جدولٍ لا يراه إلا الإدارة، كما في ميثاق العمل.
--
--   والتوقيعُ نفسُه بوجهيه كما كان: الاسمُ يُكتَب — وهو التوقيعُ
--   الإلكترونيُّ — والرسمُ باليد معه، ولا يُقبَل أحدُهما دون الآخر.
--   وإنما أُغلق بابُ رفع الصورة وحدَه (ملاحظة ٤٩٠).
-- =====================================================================

create table if not exists public.circular_sign_meta (
  circular_id uuid not null references public.circulars (id) on delete cascade,
  member_id   uuid not null references public.profiles (id) on delete cascade,
  sign_ip     inet,
  sign_agent  text,
  device      text,
  doc_hash    text,
  at          timestamptz not null default now(),
  primary key (circular_id, member_id)
);

comment on table public.circular_sign_meta is
  'إثباتُ التوقيع على التعميم: بصمةُ نصِّه وعنوانُ الموقِّع وجهازُه (ملاحظة ٤٩٣)';
comment on column public.circular_sign_meta.doc_hash is
  'بصمةُ sha256 لنصِّ التعميم كما عُرِض على العضو وقتَ توقيعه';

alter table public.circular_sign_meta enable row level security;
drop policy if exists "admin reads circular sign meta" on public.circular_sign_meta;
create policy "admin reads circular sign meta" on public.circular_sign_meta for select
  using (public.is_admin());
grant select on public.circular_sign_meta to authenticated;

-- ـــ التوقيع: الاسمُ والرسمُ، ومعهما الإثبات
drop function if exists public.ack_circular(uuid, text, text);
create or replace function public.ack_circular(
  p_circular uuid, p_name text, p_signature text default null,
  p_text text default null, p_device text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_sig text := nullif(btrim(coalesce(p_signature, '')), '');
        v_hash text; v_agent text; v_h json;
begin
  if length(btrim(coalesce(p_name, ''))) < 3 then
    raise exception 'اكتب اسمك الكامل توقيعًا بالعلم';
  end if;
  -- التوقيع المرسوم يُؤخذ من ملف العضو إن لم يُمرَّر
  if v_sig is null then
    select signature_path into v_sig from public.profile_private where id = auth.uid();
  end if;

  update public.circular_recipients
     set read_at = coalesce(read_at, now()), acked_at = coalesce(acked_at, now()),
         signed_name = btrim(p_name), signature_path = coalesce(signature_path, v_sig)
   where circular_id = p_circular and member_id = auth.uid();
  if not found then raise exception 'هذه الرسالة ليست موجّهة إليك'; end if;

  -- بصمةُ النصِّ الذي عُرِض عليه، وعنوانُه، ووصفُ متصفِّحه وجهازه
  if nullif(btrim(coalesce(p_text, '')), '') is not null then
    v_hash := encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
  end if;
  begin v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then v_h := null; end;
  if v_h is not null then
    v_agent := left(nullif(btrim(coalesce(v_h ->> 'user-agent', '')), ''), 400);
  end if;

  insert into public.circular_sign_meta
    (circular_id, member_id, sign_ip, sign_agent, device, doc_hash)
  values (p_circular, auth.uid(), public.request_ip(), v_agent,
          left(nullif(btrim(coalesce(p_device, '')), ''), 120), v_hash)
  on conflict (circular_id, member_id) do nothing;
end $$;
grant execute on function public.ack_circular(uuid, text, text, text, text) to authenticated;

comment on function public.ack_circular(uuid, text, text, text, text) is
  'التوقيعُ بالعلم: الاسمُ المكتوبُ والرسمُ، ومعهما بصمةُ النصِّ وعنوانُ الموقِّع وجهازُه (ملاحظتا ١١٠ و٤٩٣)';

-- ـــ وإثباتُ توقيعِ عضوٍ على تعميمٍ: للإدارة، كإثبات الميثاق
create or replace function public.circular_proof(p_circular uuid, p_member uuid)
returns table (member_id uuid, full_name text, member_no int, national_id text,
               title text, sent_at timestamptz, signed_name text, acked_at timestamptz,
               signature_path text, sign_ip text, sign_agent text, device text,
               doc_hash text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.member_no,
         case when public.is_admin_for('docs_id_view') then v.national_id end,
         c.title, c.sent_at, r.signed_name, r.acked_at, r.signature_path,
         host(sm.sign_ip), sm.sign_agent, sm.device, sm.doc_hash
    from public.circular_recipients r
    join public.circulars c on c.id = r.circular_id
    join public.profiles p on p.id = r.member_id
    left join public.profile_private v on v.id = r.member_id
    left join public.circular_sign_meta sm
           on sm.circular_id = r.circular_id and sm.member_id = r.member_id
   where r.circular_id = p_circular and r.member_id = p_member
     and (public.is_admin() or r.member_id = auth.uid())
$$;
grant execute on function public.circular_proof(uuid, uuid) to authenticated;

comment on function public.circular_proof(uuid, uuid) is
  'سجلُّ توقيعِ عضوٍ على تعميم: اسمُه ورسمُه وبصمةُ النصِّ وعنوانُه وجهازُه (ملاحظة ٤٩٣)';

notify pgrst, 'reload schema';

-- =====================================================================
-- والتوقيعُ اليدويُّ خيارٌ في التعميم لا أصلٌ فيه (ملاحظة ٤٩٤)
--
--   قُضي بأن يكون المعتمَدُ هو التوقيعَ الإلكترونيَّ بشكله الأخير في
--   المنصة: يكتب العضو اسمَه الكامل، ويُحفَظ معه إثباتُه. وبعضُ
--   التعاميم قد يُراد فيها رسمُ اليد، فجُعل ذلك خيارًا يُطلَب في
--   التعميم بعينه، ولا يُطالَب به في سائرها.
-- =====================================================================
alter table public.circulars
  add column if not exists require_sign boolean not null default false;

comment on column public.circulars.require_sign is
  'يُطلَب مع التوقيع الإلكترونيِّ رسمُ اليد في هذا التعميم بعينه (ملاحظة ٤٩٤)';

-- والقديمةُ ذاتُ الثمانية تُحذَف، فلا يلتبس النداءُ بتوقيعين
drop function if exists public.send_circular(text, text, text, text, text, uuid[], boolean, boolean);
create or replace function public.send_circular(
  p_title    text,
  p_kind     text default 'notice',
  p_body     text default null,
  p_pdf_path text default null,
  p_audience text default 'all',
  p_members  uuid[] default null,
  p_require_ack boolean default true,
  p_blocking boolean default false,
  p_require_sign boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_aud text := coalesce(nullif(trim(p_audience), ''), 'all'); v_n int;
begin
  if not public.is_admin() then raise exception 'إرسال المراسلات للمنسقين ومدير المشروع' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'اكتب عنوان الرسالة'; end if;
  if nullif(trim(coalesce(p_body, '')), '') is null and p_pdf_path is null then
    raise exception 'اكتب نص الرسالة أو أرفق ملف PDF';
  end if;
  if p_blocking and not p_require_ack then
    raise exception 'التعميم الملزم يشترط التوقيع بالعلم';
  end if;
  if coalesce(p_require_sign, false) and not coalesce(p_require_ack, true) then
    raise exception 'طلبُ رسم اليد يشترط التوقيع بالعلم';
  end if;
  if v_aud not in ('all', 'translators', 'field', 'coordinators', 'selected') then
    raise exception 'فئة المرسَل إليهم غير معروفة';
  end if;

  insert into public.circulars (kind, title, body, pdf_path, audience, require_ack,
                                blocking, require_sign, sent_by)
  values (coalesce(nullif(trim(p_kind), ''), 'notice'), trim(p_title),
          nullif(trim(coalesce(p_body, '')), ''), p_pdf_path, v_aud,
          coalesce(p_require_ack, true), coalesce(p_blocking, false),
          coalesce(p_require_sign, false), auth.uid())
  returning id into v_id;

  insert into public.circular_recipients (circular_id, member_id)
  select v_id, p.id from public.profiles p
   where p.status = 'active'
     and (v_aud = 'all'
       or (v_aud = 'translators'  and p.role = 'translator' and coalesce(p.track, 'translation') <> 'field')
       or (v_aud = 'field'        and coalesce(p.track, 'translation') = 'field')
       or (v_aud = 'coordinators' and p.role in ('coordinator', 'manager'))
       or (v_aud = 'selected'     and p.id = any (coalesce(p_members, '{}'::uuid[]))))
  on conflict do nothing;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    delete from public.circulars where id = v_id;
    raise exception 'لا أعضاء مفعّلين في الفئة المختارة، فاختر فئة أخرى أو حدّد الأعضاء';
  end if;
  return v_id;
end $$;
grant execute on function public.send_circular(text, text, text, text, text, uuid[], boolean, boolean, boolean) to authenticated;

-- ومن طُلب منه رسمُ اليد لا يُقبَل توقيعُه بالاسم وحدَه
create or replace function public.ack_circular(
  p_circular uuid, p_name text, p_signature text default null,
  p_text text default null, p_device text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_sig text := nullif(btrim(coalesce(p_signature, '')), '');
        v_need boolean; v_hash text; v_agent text; v_h json;
begin
  if length(btrim(coalesce(p_name, ''))) < 3 then
    raise exception 'اكتب اسمك الكامل توقيعًا بالعلم';
  end if;
  select require_sign into v_need from public.circulars where id = p_circular;
  if v_need is null then raise exception 'الرسالة غير موجودة'; end if;
  -- رسمُ اليد يُؤخذ من ملف العضو إن لم يُمرَّر، فمن رسمه قبلُ لا يُعيده
  if v_sig is null then
    select signature_path into v_sig from public.profile_private where id = auth.uid();
  end if;
  if v_need and v_sig is null then
    raise exception 'هذا التعميمُ يطلب رسمَ توقيعك بيدك';
  end if;

  update public.circular_recipients
     set read_at = coalesce(read_at, now()), acked_at = coalesce(acked_at, now()),
         signed_name = btrim(p_name), signature_path = coalesce(signature_path, v_sig)
   where circular_id = p_circular and member_id = auth.uid();
  if not found then raise exception 'هذه الرسالة ليست موجّهة إليك'; end if;

  if nullif(btrim(coalesce(p_text, '')), '') is not null then
    v_hash := encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
  end if;
  begin v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then v_h := null; end;
  if v_h is not null then
    v_agent := left(nullif(btrim(coalesce(v_h ->> 'user-agent', '')), ''), 400);
  end if;

  insert into public.circular_sign_meta
    (circular_id, member_id, sign_ip, sign_agent, device, doc_hash)
  values (p_circular, auth.uid(), public.request_ip(), v_agent,
          left(nullif(btrim(coalesce(p_device, '')), ''), 120), v_hash)
  on conflict (circular_id, member_id) do update
    set sign_ip = excluded.sign_ip, sign_agent = excluded.sign_agent,
        device = excluded.device, doc_hash = coalesce(excluded.doc_hash,
          public.circular_sign_meta.doc_hash);
end $$;
grant execute on function public.ack_circular(uuid, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
