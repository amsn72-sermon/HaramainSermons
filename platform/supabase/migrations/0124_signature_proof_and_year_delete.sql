-- =====================================================================
-- 0124 — إثباتُ التوقيع على الميثاق، وحذفُ العام الفارغ، وتوقيعُ
--        الشهادة متغيّرًا (ملاحظات ٤١٦ و٤٢١ و٤٢٥ و٤٢٦ و٤٢٧)
--
--   كان التوقيعُ على الميثاق يُحفَظ اسمًا ونسخةً ووقتًا، لا أكثر. فإذا
--   خالف عضوٌ السريةَ وأنكر توقيعَه لم يكن في اليد إلا سطرٌ في جدول.
--   فصار يُقيَّد مع التوقيع: عنوانُ الشبكة، ووصفُ الجهاز، وبصمةُ
--   النصِّ الموقَّع نفسِه، ورمزُ تحقُّقٍ تُطبَع به وثيقةُ إثباتٍ على
--   كليشة الهيئة. فالبصمةُ تُثبِت أيَّ نصٍّ وقَّع عليه لا نسختَه فقط.
--
--   والعامُ الأرشيفيُّ كان يُضاف ولا يُحذَف، فيبقى الخطأُ مكتوبًا.
--   فصار يُحذَف ما خلا من خطبة، ويُرفَض ما فيه عمل.
--
--   وتوقيعُ الشهادة كان ثابتًا في القالب، فصار يُكتَب عند المنح.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) إثباتُ التوقيع: ما يُقيَّد معه (ملاحظة ٤٢٥)
--
--   العنوانُ والجهازُ يُقرآن من ترويسة الطلب لا من المتصفح، فلا يُدَسّان.
--   والبصمةُ sha256 على النصِّ الذي عُرِض عليه حرفًا بحرف.
-- ---------------------------------------------------------------------
alter table public.policy_acceptances add column if not exists sign_ip     inet;
alter table public.policy_acceptances add column if not exists sign_agent  text;
alter table public.policy_acceptances add column if not exists doc_hash    text;
alter table public.policy_acceptances add column if not exists proof_code  text;

create unique index if not exists policy_acceptances_proof_code_uk
  on public.policy_acceptances (proof_code) where proof_code is not null;

comment on column public.policy_acceptances.sign_ip    is 'عنوانُ الشبكة وقتَ التوقيع، من ترويسة الطلب (ملاحظة ٤٢٥)';
comment on column public.policy_acceptances.sign_agent is 'وصفُ الجهاز والمتصفح وقتَ التوقيع (ملاحظة ٤٢٥)';
comment on column public.policy_acceptances.doc_hash   is 'بصمةُ sha256 للنصِّ الموقَّع عليه حرفًا بحرف (ملاحظة ٤٢٥)';
comment on column public.policy_acceptances.proof_code is 'رمزُ التحقُّق المطبوعُ في وثيقة إثبات التوقيع (ملاحظة ٤٢٥)';

-- عنوانُ الشبكة من الترويسة: cf-connecting-ip (فالموقعُ خلف Cloudflare)
--   ثمَّ أوّلُ عنوانٍ في x-forwarded-for ثمَّ x-real-ip
create or replace function public.request_ip()
returns inet language plpgsql stable set search_path = public as $$
declare v_h json; v_s text;
begin
  begin v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then return null; end;
  if v_h is null then return null; end if;
  v_s := coalesce(nullif(btrim(coalesce(v_h ->> 'cf-connecting-ip', '')), ''),
                  nullif(btrim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)), ''),
                  nullif(btrim(coalesce(v_h ->> 'x-real-ip', '')), ''));
  if v_s is null then return null; end if;
  begin return v_s::inet; exception when others then return null; end;
end $$;
grant execute on function public.request_ip() to authenticated;

comment on function public.request_ip() is
  'عنوانُ شبكةِ الطلب من ترويسته — لا يُؤخَذ من المتصفح (ملاحظة ٤٢٥)';

-- التوقيعُ: يُقيَّد معه العنوانُ والجهازُ وبصمةُ النصِّ ورمزُ التحقُّق.
--   والنصُّ يأتي كما عُرِض، فتُحسَب بصمتُه في الخادم لا في المتصفح.
drop function if exists public.accept_policy(text, text, text);
create or replace function public.accept_policy(
  p_version text,
  p_name    text,
  p_key     text default 'confidentiality',
  p_text    text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_key text; v_hash text; v_code text; v_agent text; v_h json;
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'اكتب اسمك الكامل توقيعًا'; end if;
  if length(btrim(coalesce(p_version, ''))) = 0 then raise exception 'نسخة السياسة غير محددة'; end if;
  v_key := coalesce(nullif(btrim(p_key), ''), 'confidentiality');

  if nullif(btrim(coalesce(p_text, '')), '') is not null then
    v_hash := encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
  end if;

  begin v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then v_h := null; end;
  if v_h is not null then v_agent := left(nullif(btrim(coalesce(v_h ->> 'user-agent', '')), ''), 400); end if;

  v_code := 'SG-' || upper(substr(encode(sha256(convert_to(
              auth.uid()::text || v_key || btrim(p_version) || clock_timestamp()::text, 'UTF8')), 'hex'), 1, 10));

  insert into public.policy_acceptances
    (member_id, policy_key, policy_version, signed_name,
     sign_ip, sign_agent, doc_hash, proof_code)
  values (auth.uid(), v_key, btrim(p_version), btrim(p_name),
          public.request_ip(), v_agent, v_hash, v_code)
  on conflict (member_id, policy_key, policy_version) do nothing;

  -- الموقِّعُ مرّتين لا يُعاد توقيعُه: يُرَدُّ رمزُ توقيعه الأول
  select proof_code into v_code from public.policy_acceptances
   where member_id = auth.uid() and policy_key = v_key and policy_version = btrim(p_version);
  return v_code;
end $$;
grant execute on function public.accept_policy(text, text, text, text) to authenticated;

comment on function public.accept_policy(text, text, text, text) is
  'توقيعُ العضو على الميثاق، ومعه عنوانُه وجهازُه وبصمةُ النصِّ ورمزُ تحقُّقه (ملاحظة ٤٢٥)';

-- وثيقةُ الإثبات: سجلُّ التوقيع كاملًا — لصاحبه، ولمدير المشروع
create or replace function public.policy_proof(
  p_member uuid, p_version text default null, p_key text default 'confidentiality')
returns table (member_id uuid, full_name text, email text, member_no int,
               policy_key text, policy_version text, signed_name text,
               accepted_at timestamptz, sign_ip text, sign_agent text,
               doc_hash text, proof_code text)
language sql stable security definer set search_path = public as $$
  select a.member_id, p.full_name, p.email, p.member_no,
         a.policy_key, a.policy_version, a.signed_name, a.accepted_at,
         host(a.sign_ip), a.sign_agent, a.doc_hash, a.proof_code
    from public.policy_acceptances a
    join public.profiles p on p.id = a.member_id
   where a.member_id = p_member
     and a.policy_key = coalesce(nullif(btrim(p_key), ''), 'confidentiality')
     and (p_version is null or a.policy_version = btrim(p_version))
     and (public.is_manager() or public.is_admin() or a.member_id = auth.uid())
   order by a.accepted_at desc
$$;
grant execute on function public.policy_proof(uuid, text, text) to authenticated;

comment on function public.policy_proof(uuid, text, text) is
  'سجلُّ توقيعِ عضوٍ على الميثاق بنسخه كلِّها، تُبنى منه وثيقةُ الإثبات (ملاحظتا ٤٢٥ و٤٢٧)';

-- التحقُّقُ برمزِ الوثيقة: لمدير المشروع ومن له الاطّلاعُ على الفريق
create or replace function public.policy_proof_by_code(p_code text)
returns table (full_name text, member_no int, policy_key text, policy_version text,
               signed_name text, accepted_at timestamptz, doc_hash text)
language sql stable security definer set search_path = public as $$
  select p.full_name, p.member_no, a.policy_key, a.policy_version,
         a.signed_name, a.accepted_at, a.doc_hash
    from public.policy_acceptances a
    join public.profiles p on p.id = a.member_id
   where a.proof_code = upper(btrim(p_code))
     and (public.is_manager() or public.is_admin())
$$;
grant execute on function public.policy_proof_by_code(text) to authenticated;

comment on function public.policy_proof_by_code(text) is
  'التحقُّقُ من وثيقة إثبات التوقيع برمزها المطبوع (ملاحظة ٤٢٥)';

-- ---------------------------------------------------------------------
-- ٢) حذفُ العام الأرشيفيِّ الفارغ (ملاحظة ٤٢١)
--
--   ما فيه خطبةٌ لا يُحذَف، ويُبيَّن عددُها في الرفض. وما خلا من خطبةٍ
--   تُحذَف أقسامُه معه، فهي تابعةٌ له.
-- ---------------------------------------------------------------------
create or replace function public.delete_arch_year(p_year int)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_v int;
begin
  if not public.is_manager() then
    raise exception 'حذفُ الأعوام لمدير المشروع' using errcode = '42501';
  end if;
  if not exists (select 1 from public.arch_years where h_year = p_year) then
    raise exception 'لا عامَ بهذا الرقم';
  end if;
  select count(*)::int into v_n from public.arch_sermons where h_year = p_year;
  if v_n > 0 then
    select count(*)::int into v_v
      from public.arch_versions x join public.arch_sermons m on m.id = x.sermon_id
     where m.h_year = p_year;
    raise exception 'في العام % خطبة و% نسخة، فلا يُحذَف — انقلْها أو احذفْها أولًا', v_n, v_v;
  end if;
  delete from public.arch_sections where h_year = p_year;
  delete from public.arch_years    where h_year = p_year;
  return p_year;
end $$;
grant execute on function public.delete_arch_year(int) to authenticated;

comment on function public.delete_arch_year(int) is
  'حذفُ عامٍ أرشيفيٍّ خلا من الخطب، ويُرفَض ما فيه عمل (ملاحظة ٤٢١)';

-- ---------------------------------------------------------------------
-- ٣) توقيعُ الشهادة يُكتَب عند المنح لا في القالب (ملاحظة ٤١٦)
--
--   كان الاسمُ والمنصبُ والتوقيعُ يُثبَّتون في القالب، فتخرج الشهاداتُ
--   كلُّها بتوقيعٍ واحدٍ لا يتغيَّر. فصارت تُسأل عند المنح، ويُرفَع
--   توقيعُ المسؤولِ صورةً تُدرَج في تلك الدفعة وحدَها.
-- ---------------------------------------------------------------------
drop function if exists public.grant_certificates(uuid, uuid[], boolean);
create or replace function public.grant_certificates(
  p_template uuid, p_members uuid[], p_issue boolean default false,
  p_signer text default null, p_signer_role text default null,
  p_signature text default null, p_signature_src text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.cert_templates%rowtype;
        v_m uuid; v_id uuid; v_made int := 0; v_skip int := 0; v_ids uuid[] := '{}';
        v_sign text; v_design jsonb;
begin
  if not (public.is_manager() or public.is_admin_for('cert_draft')) then
    raise exception 'منحُ الشهادات بإذن مدير المشروع' using errcode = '42501';
  end if;
  select * into t from public.cert_templates where id = p_template;
  if t.id is null then raise exception 'قالبٌ غيرُ موجود'; end if;
  if not t.is_active then raise exception 'القالبُ معطَّل'; end if;

  v_sign := coalesce(nullif(btrim(coalesce(p_signature, '')), ''), 'blank');
  if v_sign not in ('image', 'blank', 'none') then v_sign := 'blank'; end if;
  if v_sign = 'image' and nullif(btrim(coalesce(p_signature_src, '')), '') is null then
    raise exception 'اخترتَ توقيعًا بصورةٍ ولم تُرفَع صورتُه';
  end if;

  -- صورةُ التوقيع تُحفَظ في تصميم الشهادة نفسِها، فلا تُغيَّر بتغيُّر القالب
  v_design := coalesce(t.tpl, '{}'::jsonb);
  if nullif(btrim(coalesce(p_signature_src, '')), '') is not null then
    v_design := v_design || jsonb_build_object('signature_src', btrim(p_signature_src));
  end if;

  foreach v_m in array coalesce(p_members, '{}') loop
    if not exists (select 1 from public.profiles where id = v_m) then
      v_skip := v_skip + 1; continue;
    end if;
    insert into public.certificates
      (kind, member_id, title, subject, hours, start_on, end_on, place, provider,
       source, role_text, body, design, signer_name, signer_role, signature,
       template_id, created_by)
    values (t.kind, v_m,
            coalesce(nullif(btrim(t.fixed ->> 'title'), ''), t.name),
            nullif(btrim(t.fixed ->> 'subject'), ''),
            nullif(t.fixed ->> 'hours', '')::numeric,
            nullif(t.fixed ->> 'start_on', '')::date,
            nullif(t.fixed ->> 'end_on', '')::date,
            nullif(btrim(t.fixed ->> 'place'), ''),
            nullif(btrim(t.fixed ->> 'provider'), ''),
            coalesce(nullif(t.fixed ->> 'source', ''), 'platform'),
            nullif(btrim(t.fixed ->> 'role_text'), ''),
            nullif(btrim(t.fixed ->> 'body'), ''),
            v_design,
            coalesce(nullif(btrim(coalesce(p_signer, '')), ''),
                     nullif(btrim(t.fixed ->> 'signer_name'), '')),
            coalesce(nullif(btrim(coalesce(p_signer_role, '')), ''),
                     nullif(btrim(t.fixed ->> 'signer_role'), '')),
            v_sign,
            t.id, auth.uid())
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_made := v_made + 1;
  end loop;

  if coalesce(p_issue, false) then
    foreach v_m in array v_ids loop
      perform public.issue_certificate(v_m);
    end loop;
  end if;

  return jsonb_build_object('created', v_made, 'skipped', v_skip,
                            'issued', case when p_issue then v_made else 0 end,
                            'ids', to_jsonb(v_ids));
end $$;
grant execute on function
  public.grant_certificates(uuid, uuid[], boolean, text, text, text, text) to authenticated;

comment on function public.grant_certificates(uuid, uuid[], boolean, text, text, text, text) is
  'منحُ شهادةٍ بالقالب، واسمُ الموقِّع ومنصبُه وتوقيعُه يُكتَبان عند المنح (ملاحظة ٤١٦)';

notify pgrst, 'reload schema';
