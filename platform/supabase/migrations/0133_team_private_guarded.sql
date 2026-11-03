-- =====================================================================
-- ٠١٣٣ — بياناتُ الفريق الخاصّة تُقدَّم بقدر الصلاحية
--
--   كانت شاشةُ الفريق تقرأ `profile_private` مباشرةً بـ `select *`،
--   وسياستُها «صاحبُها أو الإدارة»: فكلُّ منسقٍ يُبلِغ الشاشةَ يصله
--   رقمُ الهوية ومسارُ صورتها لكلِّ الفريق ولو أُغلق عنه مفتاحُ
--   «الاطّلاع على صورة الهوية»، ثم لا تعرضهما الواجهةُ له. فالحمايةُ
--   كانت في العرض لا في المصدر، والبياناتُ تصل المتصفِّح.
--
--   فصار المصدرُ دالّةً تُسقِط ما لا يملكه السائل. وسياسةُ الجدول
--   باقيةٌ كما هي: صاحبُه يقرأ صفَّه، والإدارةُ تُستثنى من القراءة
--   المباشرة فتمرُّ من هنا.
-- =====================================================================
create or replace function public.team_private()
returns table (
  id uuid, whatsapp text, residence text, applied_as text,
  photo_path text, photo_status text, photo_note text, photo_at timestamptz,
  iqama_status text, iqama_note text, iqama_at timestamptz,
  data_status text, data_note text, data_at timestamptz,
  signature_path text, signature_at timestamptz,
  reminded_at timestamptz, remind_count int,
  -- ما لا يُعرَض إلا لمن يملك مفتاحَ الاطّلاع على الهوية
  national_id text, nationality text, iqama_path text,
  id_type text, id_expiry date
) language sql stable security definer set search_path = public as $$
  select pp.id, pp.whatsapp, pp.residence, pp.applied_as,
         pp.photo_path, pp.photo_status, pp.photo_note, pp.photo_at,
         pp.iqama_status, pp.iqama_note, pp.iqama_at,
         pp.data_status, pp.data_note, pp.data_at,
         pp.signature_path, pp.signature_at,
         pp.reminded_at, pp.remind_count,
         case when public.is_admin_for('docs_id_view') then pp.national_id end,
         case when public.is_admin_for('docs_id_view') then pp.nationality end,
         case when public.is_admin_for('docs_id_view') then pp.iqama_path end,
         case when public.is_admin_for('docs_id_view') then pp.id_type end,
         case when public.is_admin_for('docs_id_view') then pp.id_expiry end
    from public.profile_private pp
   where public.is_admin() or pp.id = auth.uid()
$$;
grant execute on function public.team_private() to authenticated;

comment on function public.team_private() is
  'بياناتُ الفريق الخاصّة بقدر صلاحية السائل: الهويةُ لمن يملك مفتاحَها (فحصٌ أمنيّ ٠١٣٣)';

-- وسياسةُ الجدول تبقى «صاحبُه أو الإدارة» كما كانت: إغلاقُها على
--   الإدارة يقطع عنها ما تحتاجه دوالُّ المراجعة والتدقيق القائمة.
--   فالمكسبُ هنا أنَّ شاشاتِ المنصة لم تعد تجلب الهويةَ لمن لا يملك
--   مفتاحَها، فلا تصل متصفِّحَه أصلًا. ويبقى على الإدارة — وهي مؤتمَنةٌ
--   موقِّعةٌ على ميثاق السرية — أن تقرأ الجدولَ بطلبٍ تصنعه بيدها.
