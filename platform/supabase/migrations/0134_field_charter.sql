-- =====================================================================
-- ٠١٣٤ — ميثاقُ العمل الميداني، وكشفُ الموقِّعين بفريقه ومدينته
--   (الملاحظتان ٤٨١ و٤٨٠)
--
--   ميثاقُ العمل الذي وقَّعه المترجمون المتخصصون لا يتناول أكثرَ ما يلزم
--   من يعمل في الساحات وعند الأبواب: الموقعَ والوقت، والزيَّ والبطاقة،
--   وحرمةَ المكان والطوارئ، وحدَّ القول. فصار للميدان — الإرشادِ
--   المكانيِّ وإجابةِ السائلين — ميثاقُه هو، ويبقى ميثاقُ المترجمين على
--   من وقَّعه لا يُطالَبون بغيره ولا يُعاد توقيعُه.
--
--   ولا يحتاج الخادمُ إلى جديدٍ في التوقيع نفسِه: `accept_policy`
--   و`policy_proof` و`policy_acceptances` كلُّها تأخذ مفتاحَ الميثاق
--   منذ أصلها، والنصُّ يُرسَل من الواجهة فتُحسَب منه البصمة. وإنما
--   يحتاج كشفُ الموقِّعين أمرين: أن يقتصر على أهل الميثاق المسؤول عنه،
--   وأن يحمل فريقَ العضو ومدينتَه ودورَه ليُطبَع الكشفُ مبوَّبًا بهما،
--   وليُعرَف أهلُ كلِّ ميثاقٍ — فالحساباتُ الإداريةُ على ميثاق المترجمين
--   ولو كان فريقُها الميدان (الملاحظتان ٤٨٠ و٤٨١).
--
--   ومعها تُسدُّ ثلمةٌ في الكشف سابقةٌ لهذا الترحيل: كان يُخرِج رقمَ
--   الهوية لكلِّ إداريٍّ ولو أُغلق عنه مفتاحُ «الاطّلاع على صورة
--   الهوية»، فيصل متصفِّحَه ما لا يملكه — وهو عينُ ما سُدَّ في شاشة
--   الفريق بالترحيل ٠١٣٣. فصار الكشفُ مثلَها: الهويةُ لمن يملك مفتاحَها.
-- =====================================================================

drop function if exists public.policy_roster(text);
create or replace function public.policy_roster(
  p_key text default 'confidentiality', p_tracks text[] default null)
returns table (member_id uuid, full_name text, member_no int, national_id text,
               role text, track text, city text,
               policy_version text, accepted_at timestamptz, proof_code text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.member_no,
         case when public.is_admin_for('docs_id_view') then v.national_id end,
         p.role, p.track, p.city,
         a.policy_version, a.accepted_at, a.proof_code
    from public.profiles p
    left join public.profile_private v on v.id = p.id
    left join lateral (
      select x.policy_version, x.accepted_at, x.proof_code
        from public.policy_acceptances x
       where x.member_id = p.id
         and x.policy_key = coalesce(nullif(btrim(p_key), ''), 'confidentiality')
       order by x.accepted_at desc limit 1) a on true
   where p.status = 'active'
     and (p_tracks is null or p.track = any (p_tracks))
     and (public.is_manager() or public.is_admin())
   order by p.full_name
$$;
grant execute on function public.policy_roster(text, text[]) to authenticated;

comment on function public.policy_roster(text, text[]) is
  'كشفُ الموقِّعين على ميثاقٍ بعينه — مقصورًا على فرقه، ومعه فريقُ العضو ومدينتُه، والهويةُ لمن يملك مفتاحَها (ملاحظات ٤٣٢ و٤٣٣ و٤٨٠ و٤٨١)';

-- وتبديلُ بصمة الدالّة يلزمه تحديثُ ذاكرةِ المخطَّط في PostgREST،
--   وإلّا رُدَّ النداءُ بـ PGRST202 وظهر الكشفُ فارغًا
notify pgrst, 'reload schema';
