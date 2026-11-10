-- =====================================================================
-- ٠١٣٧ — رقمُ الهوية في وثيقة التحقّق، وحدٌّ للتخمين (ملاحظة ٤٨٩)
--
--   رمزُ الوثيقة سرٌّ لا يُنشر، وكشفُ التواقيع المطبوعُ يحمل أرقامَ
--   الهويات أصلًا، فمن مسح باركودَ صفٍّ فيه فقد رأى الرقمَ في الورقة
--   نفسِها. فأن يراه في صفحة التحقّق لا يزيده شيئًا، ويُتمُّ له المطابقةَ
--   بين الورقة والمنصة.
--
--   وإنما يُخشى أن يُجرَّب الرمزُ تخمينًا حتى يُصاب — وهو عشرةُ محارفَ
--   ستَّ عشريّة، فالتخمينُ بعيد، ولكن لا يُترك البابُ مفتوحًا بلا عدّ.
--   فتُحصى المحاولاتُ الخائبةُ من العنوان الواحد، فإذا جاوزت الحدَّ
--   في النافذة رُدَّ ولو أصاب.
-- =====================================================================

-- ـــ وأوّلًا: العنوانُ يُؤخَذ ممّا أضافه وسيطُنا لا ممّا أرسله العميل
--
--   كانت `request_ip` تأخذ `cf-connecting-ip` ثمَّ أوّلَ قيمةٍ في
--   `x-forwarded-for`، وكلاهما يكتبه العميلُ في طلبه. ونطاقُ الواجهة
--   البرمجية لا يمرُّ بـCloudflare (DNS only في دليل التنصيب)، وCaddy
--   يُلحِق عنوانَ العميل في آخر السلسلة لا أوّلها. فكان من بعث ترويسةً
--   موضوعةً يتجاوز كلَّ حدٍّ مبنيٍّ على العنوان، بل يُمسِك البابَ عن
--   عنوان غيره. فصار المأخوذُ آخرَ السلسلة، ثمَّ `x-real-ip`، ولا
--   يُلتفَت إلى ترويسة Cloudflare إلّا إن لم يكن غيرُها.
create or replace function public.request_ip()
returns inet language plpgsql stable set search_path = public as $$
declare v_h json; v_xff text; v_s text;
begin
  begin v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then return null; end;
  if v_h is null then return null; end if;
  v_xff := coalesce(v_h ->> 'x-forwarded-for', '');
  v_s := coalesce(
    -- آخرُ قيمةٍ في السلسلة: هي التي أضافها وسيطُنا بنفسه
    nullif(btrim((string_to_array(v_xff, ','))[array_length(string_to_array(v_xff, ','), 1)]), ''),
    nullif(btrim(coalesce(v_h ->> 'x-real-ip', '')), ''),
    nullif(btrim(coalesce(v_h ->> 'cf-connecting-ip', '')), ''));
  if v_s is null then return null; end if;
  begin return v_s::inet; exception when others then return null; end;
end $$;
grant execute on function public.request_ip() to authenticated;

comment on function public.request_ip() is
  'عنوانُ الطلب كما أضافه وسيطُنا لا كما أرسله العميل (ملاحظتا ٤٢٥ و٤٨٩)';

create table if not exists public.verify_hits (
  ip   inet not null,   -- ولا يُسجَّل من لا عنوانَ له
  at   timestamptz not null default now(),
  ok   boolean not null
);
create index if not exists verify_hits_ip_at on public.verify_hits (ip, at desc);

alter table public.verify_hits enable row level security;
-- ولا يقرؤه أحدٌ من العملاء: سجلٌّ داخليٌّ للعدِّ لا للعرض
drop policy if exists "no read hits" on public.verify_hits;

comment on table public.verify_hits is
  'محاولاتُ التحقّق برمز الوثيقة، تُعَدُّ لمنع التخمين (ملاحظة ٤٨٩)';

-- ـــ العدُّ والردّ: ثلاثون محاولةً خائبةً في الساعة من العنوان الواحد
create or replace function public.verify_throttled()
returns boolean language sql volatile security definer set search_path = public as $$
  select public.request_ip() is not null and coalesce((
    select count(*) >= 30 from public.verify_hits
     where ip = public.request_ip() and not ok and at > now() - interval '1 hour'
  ), false)
$$;

-- وسجلُّ المحاولات لا يُترك ينمو: يُقلَّم ما مضى عليه يومٌ عند كلِّ عدٍّ
create or replace function public.verify_hits_sweep()
returns void language sql volatile security definer set search_path = public as $$
  delete from public.verify_hits where at < now() - interval '1 day'
$$;
revoke execute on function public.verify_hits_sweep() from public, anon, authenticated;

create or replace function public.verify_signature(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_row public.policy_acceptances; v_p public.profiles; v_id text; v_out jsonb;
begin
  if public.verify_throttled() then
    return jsonb_build_object('found', false, 'throttled', true);
  end if;

  select * into v_row from public.policy_acceptances
   where proof_code = upper(btrim(coalesce(p_code, '')))
     and length(btrim(coalesce(p_code, ''))) >= 8;

  -- وتُحصى المحاولةُ قبل الردّ، صائبةً كانت أو خائبة. ومن لا عنوانَ
  --   له — كالنداء من داخل الخادم — لا يُحصى، فالعدُّ على العناوين
  insert into public.verify_hits (ip, ok)
  select public.request_ip(), v_row.id is not null
   where public.request_ip() is not null;
  -- ويُقلَّم السجلُّ بين الحين والحين، فلا ينمو بلا حدّ
  if random() < 0.02 then perform public.verify_hits_sweep(); end if;

  if v_row.id is null then return jsonb_build_object('found', false); end if;

  select * into v_p from public.profiles where id = v_row.member_id;
  select national_id into v_id from public.profile_private where id = v_row.member_id;

  return jsonb_build_object(
    'found',       true,
    'code',        v_row.proof_code,
    'name',        v_p.full_name,
    'member_no',   v_p.member_no,
    'national_id', v_id,
    'signed_name', v_row.signed_name,
    'policy_key',  v_row.policy_key,
    'version',     v_row.policy_version,
    'accepted_at', v_row.accepted_at,
    'doc_hash',    v_row.doc_hash,
    'state',       case when v_p.status = 'active' then 'عضوٌ قائم'
                        else 'انتهى تعاونُه، والالتزامُ باقٍ' end);
end $$;
grant execute on function public.verify_signature(text) to anon, authenticated;

comment on function public.verify_signature(text) is
  'التحقّقُ العامُّ من وثيقة إثبات التوقيع برمزها المطبوع، ومعه رقمُ الهوية (ملاحظتا ٤٢٨ و٤٨٩)';

notify pgrst, 'reload schema';
