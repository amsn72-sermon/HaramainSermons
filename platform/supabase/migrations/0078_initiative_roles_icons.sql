-- =====================================================================
-- 0078 — تسلسلُ الفريق، وأيقوناتٌ أكثرُ وسردٌ أقلّ (ملاحظتا ٢٣٠ و٢٣١)
--
--   ٢٣٠) يُضاف إلى «فريق العمل وأدواره» مديرُ العمليات التشغيلية ومساعدُه،
--        ومعهما مشرفُ فريق الترجمة، على التسلسل المذكور. وهو عرضٌ لا غير:
--        لا يتغيّر به شيءٌ من الصلاحيات، فالألقابُ التشغيلية على حساب
--        المنسق وصلاحياتُها صلاحياتُه.
--
--   ٢٣١) ولكل بطاقةٍ أيقونتُها، وصُدِّرت أطولُ الأقسام ببطاقاتٍ موجزةٍ
--        يُقرأ منها المقصودُ بلمحة، ويبقى التفصيلُ تحتها لمن أراده.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) الأدوار بتسلسلها، ولكلِّ دورٍ أيقونتُه
-- ---------------------------------------------------------------------
update public.page_content
   set content = jsonb_set(content, '{roles}', jsonb_build_array(
     jsonb_build_array('مدير المشروع', jsonb_build_array(
       'الإشرافُ العامُّ على المنصة، واعتمادُ مسارات العمل والصلاحيات، وإدارةُ '
       || 'الأدوار الإدارية، واعتمادُ المخرجات النهائية، والإشرافُ على الأرشفة '
       || 'والاسترجاع وفق الصلاحيات المحددة.'), 'shield'),

     jsonb_build_array('مدير العمليات التشغيلية', jsonb_build_array(
       'يتولّى تسييرَ العمل اليومي ومتابعةَ الإنجاز والمواعيد، وتنظيمَ الإسناد بين '
       || 'الفرق. ولقبُه تشغيليٌّ على حساب التنسيق، وصلاحياتُه صلاحياتُ المنسق '
       || 'نفسُها لا يزيد عليها.'), 'bolt'),

     jsonb_build_array('مساعد مدير العمليات التشغيلية', jsonb_build_array(
       'يعين مديرَ العمليات في المتابعة اليومية ويقوم مقامَه عند غيابه. وهو كذلك '
       || 'لقبٌ تشغيليٌّ على حساب التنسيق بصلاحياته نفسِها.'), 'bolt'),

     jsonb_build_array('المنسق', jsonb_build_array(
       'إدخالُ المواد، وتحديدُ اللغات، وإسنادُ المهام، وضبطُ المواعيد، ومتابعةُ '
       || 'الإنجاز، واستلامُ الأعمال وإعادتُها عند الحاجة بملاحظاتٍ واضحة.',
       'ومراجعةُ طلبات الانضمام وإجراءاتِ التفعيل ضمن صلاحياته، وإرسالُ المراسلات '
       || 'ومتابعةُ الإقرار بالاطّلاع، وجدولةُ ورديات الإرشاد المكاني.'), 'clipboard'),

     jsonb_build_array('مشرف فريق الترجمة', jsonb_build_array(
       'يُعيَّن من المترجمين الخبراء أنفسِهم، ويبقى مترجمًا على حاله. يُشرف على من '
       || 'يُسمَّون له بأعيانهم فيتابع أعمالَهم ويعينهم، ولكلِّ عضوٍ مشرفٌ واحدٌ لا غير.',
       'ولا صلاحياتٍ إداريةً له ولا ماليةً إلا ما يمنحه مديرُ المشروع.'), 'star'),

     jsonb_build_array('المترجم والمراجع والمحرر', jsonb_build_array(
       'ينفّذ كلُّ عضوٍ ما أُسنِد إليه وفق اختصاصه ولغاته المعتمدة، ويعمل داخل المنصة '
       || 'على المواد المتاحة لحسابه، ويوثّق ملاحظاتِه ويرفع المخرجاتِ في مواعيدها.',
       'ويتيح له حسابُه إدارةَ بياناته، والاطّلاعَ على تكليفاته ومراسلاته وبطاقةِ '
       || 'عمله بعد اعتمادها.'), 'pen'),

     jsonb_build_array('المرشد المكاني', jsonb_build_array(
       'يُرشد قاصدي الحرمين الشريفين ميدانيًّا وفق ورديّاته المجدولة، ويسجّل حضورَه '
       || 'وانصرافه من حسابه في المنصة بموقعه وبالتوقيت المحلي.'), 'map'),

     jsonb_build_array('قائد الفريق الميداني', jsonb_build_array(
       'يقود في نطاقه فريقَي الإرشاد المكاني وإجابةِ السائلين معًا، ويُسنَد إليه '
       || 'أعضاؤه بأسمائهم. ويتعدّد القادةُ بتعدّد الفترات والمواقع، ولكلِّ عضوٍ '
       || 'قائدٌ واحد.'), 'users')
   )), updated_at = now()
 where key = 'initiative';

-- ---------------------------------------------------------------------
-- ٢) قسمُ التدريب (ملاحظة ٢٣٢) — موجزًا بالبطاقات
-- ---------------------------------------------------------------------
select public.page_set_section('initiative', jsonb_build_array(
  'training', 'التدريبُ على الترجمة وتأهيلُ الفريق', jsonb_build_array(
    jsonb_build_array('p',
      'لا يُترك إتقانُ الترجمة للممارسة وحدها: للمبادرة تدريبٌ منظَّمٌ يقوم عليه '
      || 'مدرِّبون من خبراء المترجمين في الفريق، يُعدّون خططَه ويتابعون أثرَه، '
      || 'ويجري في قاعات التدريب داخل المنصة.'),
    jsonb_build_array('cards', jsonb_build_array(
      jsonb_build_array('خططٌ مكتوبة',
        'لكل خطةٍ هدفُها وجمهورُها ومدّتُها ووحداتُها، لا ارتجالَ فيها.', 'clipboard'),
      jsonb_build_array('مدرِّبون من الفريق',
        'خبراءُ الترجمة من الأعضاء أنفسِهم يدرّبون من استُجدَّ ويطوّرون من عمل.', 'star'),
      jsonb_build_array('مسارُ الالتحاق',
        'تأهيلُ العضو الجديد قبل مباشرته، ثم تطويرٌ مستمرٌّ للفريق كلِّه.', 'steps'),
      jsonb_build_array('موادُّ تُشارَك',
        'عروضٌ وملفاتٌ تُرفع وتُشارَك مع المتدرِّبين، وللإدارة أن تُتيح تنزيلَها '
        || 'أو تقصرَها على المشاهدة.', 'book'),
      jsonb_build_array('في قاعات التدريب',
        'تُجدوَل الدوراتُ في القاعات بدعواتها، ويُقيَّد الحضورُ تلقائيًّا.', 'video'),
      jsonb_build_array('سجلُّ تأهيل',
        'لكل عضوٍ سجلٌّ بما التحق به وما أتمّه ومن درّبه ومتى.', 'badge')))
  )), 'rooms');

-- ---------------------------------------------------------------------
-- ٣) بطاقاتٌ موجزةٌ تتصدّر أطولَ الأقسام — والتفصيلُ باقٍ تحتها
-- ---------------------------------------------------------------------
create or replace function public.page_prepend_block(p_key text, p_sec text, p_block jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb; v_out jsonb := '[]'::jsonb; v_s jsonb;
begin
  select content -> 'sections' into v from public.page_content where key = p_key;
  if v is null then return; end if;

  for v_s in select * from jsonb_array_elements(v) loop
    if (v_s ->> 0) = p_sec then
      -- لا يُكرَّر إن سبق إدراجُه
      if (v_s -> 2 -> 0 ->> 0) = (p_block ->> 0) then
        v_out := v_out || jsonb_build_array(v_s);
      else
        v_out := v_out || jsonb_build_array(jsonb_build_array(
          v_s -> 0, v_s -> 1, jsonb_build_array(p_block) || (v_s -> 2)));
      end if;
    else
      v_out := v_out || jsonb_build_array(v_s);
    end if;
  end loop;

  update public.page_content
     set content = jsonb_set(content, '{sections}', v_out), updated_at = now()
   where key = p_key;
end $$;

select public.page_prepend_block('initiative', 'rooms', jsonb_build_array('cards',
  jsonb_build_array(
    jsonb_build_array('بابان', 'قاعةُ الاجتماعات وقاعةُ التدريب، ولكلِّ فريقٍ قاعاتُه.', 'video'),
    jsonb_build_array('جدولةٌ ودعوة', 'لقاءٌ بموعده ومدّته ومحاوره، والدعوةُ في بريد المدعوّ.', 'calendar'),
    jsonb_build_array('بابٌ ثابت', 'رابطُ القاعة لا يُتداول — الدخولُ من المنصة وحدها.', 'lock'),
    jsonb_build_array('ردهةُ انتظار', 'لا يدخل إلا بإذن، والمضيفون يأذنون لمن انتظر.', 'door'),
    jsonb_build_array('حضورٌ يُقيَّد', 'من دخل ومتى وكم بقي — سجلًّا للتدريب وللشهادات.', 'check'),
    jsonb_build_array('محضرٌ وأمينُ سر', 'بنودُ الاجتماع وقراراتُه تُكتب وتُحفظ.', 'pen'))));

select public.page_prepend_block('initiative', 'quality', jsonb_build_array('cards',
  jsonb_build_array(
    jsonb_build_array('مواعيدُ تُعرف', 'لكل تكليفٍ موعدٌ ظاهرٌ ومدّةٌ متبقيةٌ تُعدّ.', 'clock'),
    jsonb_build_array('مراجعتان', 'شرعيةٌ ولغويةٌ قبل الاعتماد، لكلٍّ مهلتُها.', 'check'),
    jsonb_build_array('تحديثُ الأصل', 'يُوثَّق ويُعاد المتأثِّرُ من اللغات إلى مرحلته.', 'refresh'),
    jsonb_build_array('بياناتٌ تامّة', 'لا تُسنَد مادةٌ حتى تكتمل بياناتُها الرئيسة.', 'clipboard'),
    jsonb_build_array('صوتٌ بمواصفاته', 'الصيغُ المعتمدةُ وحدها، ودليلٌ للتسجيل يُطبع.', 'mic'),
    jsonb_build_array('تقييمٌ شهري', 'يُجمع تقييمُ مشرفي الهيئة في متوسطٍ له مراتبُه.', 'chart'))));

select public.page_prepend_block('initiative', 'outputs', jsonb_build_array('cards',
  jsonb_build_array(
    jsonb_build_array('نصوصٌ معتمدة', 'ترجماتٌ مراجَعةٌ على كليشة الهيئة برقم توثيقها.', 'doc'),
    jsonb_build_array('تسجيلاتٌ صوتية', 'بصيغها المعتمدة ومواصفاتها، مرتبطةً بنصوصها.', 'mic'),
    jsonb_build_array('أرشيفٌ يُبحَث فيه', 'مرتَّبٌ بأنواعه ولغاته وتواريخه، ومعه المستودع.', 'archive'),
    jsonb_build_array('كشوفٌ ومستخلصات', 'تُصدَّر إلى Excel وWord وPDF على الكليشة.', 'chart'),
    jsonb_build_array('صفحاتٌ للناس', 'خطبُ الجمعة والعيدين وعرفة بلغاتها للزائر.', 'globe'),
    jsonb_build_array('بطاقاتٌ ووثائق', 'بطاقاتُ العمل والشهاداتُ والميثاقُ موقَّعًا.', 'badge'))));

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ٤) ما سبق من بطاقاتٍ بلا أيقونة: تُعطى أيقوناتِها بالترتيب
-- ---------------------------------------------------------------------
create or replace function public.page_set_card_icons(p_key text, p_sec text, p_icons jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb; v_out jsonb := '[]'::jsonb; v_s jsonb; v_b jsonb; v_c jsonb;
        v_blocks jsonb; v_cards jsonb; v_i int := 0;
begin
  select content -> 'sections' into v from public.page_content where key = p_key;
  if v is null then return; end if;

  for v_s in select * from jsonb_array_elements(v) loop
    if (v_s ->> 0) <> p_sec then
      v_out := v_out || jsonb_build_array(v_s);
      continue;
    end if;
    v_blocks := '[]'::jsonb;
    for v_b in select * from jsonb_array_elements(v_s -> 2) loop
      if (v_b ->> 0) <> 'cards' then
        v_blocks := v_blocks || jsonb_build_array(v_b);
        continue;
      end if;
      v_cards := '[]'::jsonb;
      for v_c in select * from jsonb_array_elements(v_b -> 1) loop
        if nullif(v_c ->> 2, '') is null then
          v_cards := v_cards || jsonb_build_array(
            jsonb_build_array(v_c -> 0, v_c -> 1,
              coalesce(p_icons -> v_i, to_jsonb('doc'::text))));
          v_i := v_i + 1;
        else
          v_cards := v_cards || jsonb_build_array(v_c);
        end if;
      end loop;
      v_blocks := v_blocks || jsonb_build_array(jsonb_build_array(v_b -> 0, v_cards));
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_array(v_s -> 0, v_s -> 1, v_blocks));
  end loop;

  update public.page_content
     set content = jsonb_set(content, '{sections}', v_out), updated_at = now()
   where key = p_key;
end $$;

select public.page_set_card_icons('initiative', 'outputs',
  '["doc","archive","chart","clipboard","badge","clock"]'::jsonb);
select public.page_set_card_icons('initiative', 'platform',
  '["layers","archive","qr","globe"]'::jsonb);
select public.page_set_card_icons('initiative', 'services',
  '["globe","mic","book","users","map","video","chart","shield"]'::jsonb);
select public.page_set_card_icons('about', 'services',
  '["clipboard","archive","qr","users","map","video","chart","lock"]'::jsonb);

notify pgrst, 'reload schema';
