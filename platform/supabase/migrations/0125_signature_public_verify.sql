-- =====================================================================
-- 0125 — صفحةُ تحقُّقٍ عامّةٌ يفتحها باركودُ وثيقة الإثبات، ورمزٌ
--        للتواقيع السابقة (ملاحظة ٤٢٨)
--
--   كان باركودُ الوثيقة يحمل الرمزَ نصًّا، فمن مسحه بجواله لم يُفتَحْ له
--   شيءٌ — بل بحث جهازُه عن النصِّ في محرك بحث. فيُجعَل الباركودُ رابطًا
--   يفتح صفحةً عامّةً قد تحقَّقت، فلا يُكتَب فيها رقمٌ ولا يُطلَب حساب.
--
--   والرمزُ عشرةُ محارفَ من بصمةٍ عشوائية، فهو مفتاحُ الوثيقة: لا تُفتَح
--   الصفحةُ إلا لمن بيده الورقةُ المطبوعة، ولا يُخمَّن.
--
--   والتواقيعُ التي وقعت قبل استحداث الرمز خلت منه، فبقيت وثائقُها بلا
--   باركود. فتُولَّد لها رموزُها الآن — والرمزُ معرِّفُ الوثيقة لا
--   معرِّفُ التوقيع، فتوليدُه اليوم لا يُلبِس التوقيعَ القديمَ شيئًا لم
--   يكن: عنوانُ الشبكة والبصمةُ يبقيان فارغَين كما هما، وتُصرِّح الوثيقةُ
--   بذلك.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) رموزُ الوثائق للتواقيع السابقة
-- ---------------------------------------------------------------------
do $$
declare r record; v_code text; v_try int;
begin
  for r in select id from public.policy_acceptances where proof_code is null loop
    v_try := 0;
    loop
      v_code := 'SG-' || upper(substr(encode(sha256(convert_to(
                  r.id::text || ':' || v_try::text, 'UTF8')), 'hex'), 1, 10));
      exit when not exists (
        select 1 from public.policy_acceptances where proof_code = v_code);
      v_try := v_try + 1;
      if v_try > 50 then raise exception 'تعذَّر توليدُ رمزٍ فريد'; end if;
    end loop;
    update public.policy_acceptances set proof_code = v_code where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- ٢) التحقُّقُ العامُّ برمز الوثيقة (ملاحظة ٤٢٨)
--
--   تُعرَض البيّنةُ التي تُقيم الحجّة: الاسمُ ورقمُ العضوية، ونسخةُ
--   الميثاق، ووقتُ التوقيع، والاسمُ الذي وقَّع به، وبصمةُ النصِّ.
--   ولا يُعرَض عنوانُ الشبكة ولا وصفُ الجهاز: هذان للإدارة في المنصة
--   وحدَها، فليسا مما يُقام به دليلٌ أمام غيرها.
-- ---------------------------------------------------------------------
create or replace function public.verify_signature(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when a.id is null then jsonb_build_object('found', false)
         else jsonb_build_object(
           'found',       true,
           'code',        a.proof_code,
           'name',        p.full_name,
           'member_no',   p.member_no,
           'signed_name', a.signed_name,
           'policy_key',  a.policy_key,
           'version',     a.policy_version,
           'accepted_at', a.accepted_at,
           'doc_hash',    a.doc_hash,
           'state',       case when p.status = 'active' then 'عضوٌ قائم'
                               else 'انتهى تعاونُه، والالتزامُ باقٍ' end)
         end
    from (select 1) z
    left join public.policy_acceptances a
           on a.proof_code = upper(btrim(coalesce(p_code, '')))
          and length(btrim(coalesce(p_code, ''))) >= 8
    left join public.profiles p on p.id = a.member_id
$$;
grant execute on function public.verify_signature(text) to anon, authenticated;

comment on function public.verify_signature(text) is
  'التحقُّقُ العامُّ من وثيقة إثبات التوقيع برمزها المطبوع، بلا حساب (ملاحظة ٤٢٨)';

notify pgrst, 'reload schema';
