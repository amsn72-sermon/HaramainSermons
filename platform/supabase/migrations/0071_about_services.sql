-- =====================================================================
-- 0071 — خدماتُ المنصة في «عن المنصة» و«عن المبادرة»
--   تسليطُ الضوء على ما تقدّمه المنصة، بلا تفصيلٍ ممل. ولا يُذكر في
--   صفحة المبادرة شيءٌ من الصلاحيات ولا من الماليات، فتلك شأنٌ داخلي.
-- =====================================================================

-- إدراجُ قسمٍ أو استبدالُه بمعرّفه، مع إبقاء ترتيب ما سواه
create or replace function public.page_set_section(p_key text, p_sec jsonb, p_after text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb; v_out jsonb := '[]'::jsonb; v_s jsonb; v_id text := p_sec ->> 0; v_done boolean := false;
begin
  select content -> 'sections' into v from public.page_content where key = p_key;
  if v is null then return; end if;

  for v_s in select * from jsonb_array_elements(v) loop
    if (v_s ->> 0) = v_id then
      v_out := v_out || jsonb_build_array(p_sec); v_done := true;
    else
      v_out := v_out || jsonb_build_array(v_s);
      if p_after is not null and (v_s ->> 0) = p_after and not v_done then
        v_out := v_out || jsonb_build_array(p_sec); v_done := true;
      end if;
    end if;
  end loop;
  if not v_done then v_out := v_out || jsonb_build_array(p_sec); end if;

  update public.page_content
     set content = jsonb_set(content, '{sections}', v_out),
         updated_at = now()
   where key = p_key;
end $$;

-- ---------------------------------------------------------------------
-- عن المنصة: ما تقدّمه، في بطاقاتٍ قصيرة
-- ---------------------------------------------------------------------
select public.page_set_section('about', jsonb_build_array(
  'services', 'ما تقدّمه المنصة', jsonb_build_array(
    jsonb_build_array('p',
      'بيئةُ عملٍ واحدةٌ تجمع ما كان متفرّقًا: المادةُ وترجماتُها ومراجعاتُها ومواعيدُها '
      || 'وسجلُّها، ثم اعتمادُها وترقيمُها وتجهيزُها للنشر.'),
    jsonb_build_array('cards', jsonb_build_array(
      jsonb_build_array('إدارةُ العمل من أوله إلى آخره',
        'تُستلم المادة، وتُسنَد لغاتُها، ويسير كلُّ مسارٍ بمراحله ومواعيده حتى الاعتماد.'),
      jsonb_build_array('أرشيفٌ ومستودع',
        'أرشيفُ ما أُنجز، ومستودعٌ لأعمال السنوات الماضية، يُبحَث فيهما ويُصدَّر منهما كتابًا مجمَّعًا.'),
      jsonb_build_array('توثيقٌ يُتحقَّق منه',
        'لكل عملٍ معتمدٍ رقمُ توثيقٍ يُطبع عليه، ويُتحقَّق منه من صفحةٍ عامة.'),
      jsonb_build_array('الفريقُ وبطاقاتُه',
        'ملفاتُ الأعضاء ووثائقُهم وبطاقاتُ عملهم، وميثاقُ العمل موقَّعًا.'),
      jsonb_build_array('الحضورُ بالموقع',
        'يسجّل العضو حضورَه وانصرافه من متصفح جواله، فتُقاس المسافةُ إلى موقعه المعتمد.'),
      jsonb_build_array('القاعاتُ واللقاءات',
        'جدولةُ الاجتماعات والدورات بدعواتها وحضورها ومحاضرها، ودخولٌ بإذنٍ من ردهةٍ تحفظ الخصوصية.'),
      jsonb_build_array('الكشوفُ والتصدير',
        'كشوفٌ ومستخرجاتٌ تُصدَّر إلى Excel وWord وPDF على كليشة الهيئة.'),
      jsonb_build_array('حمايةُ الحساب',
        'دخولٌ محميٌّ بالتحقق بخطوتين لمن أُلزم به، ورموزُ استردادٍ تحفظ له بابَه.')))
  )), 'brief');

-- ---------------------------------------------------------------------
-- عن المبادرة: إشارةٌ موجزةٌ إلى ما تُتيحه المنصة — بلا صلاحياتٍ ولا ماليات
-- ---------------------------------------------------------------------
select public.page_set_section('initiative', jsonb_build_array(
  'platform', 'المنصةُ التي يقوم عليها العمل', jsonb_build_array(
    jsonb_build_array('p',
      'تقوم المبادرةُ على منصةٍ واحدةٍ يجري فيها العملُ كلُّه: من استلام الأصل العربي، '
      || 'إلى الترجمة ومراجعاتها، إلى الاعتماد والترقيم والنشر. فلا تتفرّق المادةُ على '
      || 'الرسائل والملفات، ولكل عملٍ موضعُه وسجلُّه.'),
    jsonb_build_array('cards', jsonb_build_array(
      jsonb_build_array('لكل لغةٍ مسارُها',
        'تُسنَد لغاتُ العمل، ويسير كلُّ مسارٍ بمراحله: ترجمةٌ ثم مراجعةٌ شرعيةٌ ولغويةٌ ثم اعتماد.'),
      jsonb_build_array('أرشيفٌ يُبحَث فيه',
        'ما أُنجز محفوظٌ مرتَّبًا بأنواعه ولغاته وتواريخه، ومعه مستودعٌ لأعمال السنوات الماضية.'),
      jsonb_build_array('رقمُ توثيقٍ لكل عمل',
        'يُطبع على العمل المعتمد رقمٌ يُتحقَّق منه من صفحةٍ عامة، فيُعرف أصلُه وتاريخُ اعتماده.'),
      jsonb_build_array('بثٌّ وصفحاتٌ للناس',
        'خطبُ الجمعة والعيدين مترجمةً بلغاتها، وصفحةٌ لخطبة عرفة، وأرشيفٌ يتصفّحه الزائر بلغته.')))
  )), 'how');

notify pgrst, 'reload schema';
