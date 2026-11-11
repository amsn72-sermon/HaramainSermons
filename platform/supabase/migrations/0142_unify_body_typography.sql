-- =====================================================================
-- ٠١٤٢ — توحيدُ خطِّ متن الخطبة في القديم والجديد (ملاحظة ٤٩٩)
--
--   تُركت الحريةُ للمترجمين في مقاس الخطِّ فجاء بعضُهم بعشرين وبعضُهم
--   بأربعةَ عشرَ، وجاء بعضُهم بخطِّ مصدره لأنه ألصق النصَّ من وورد
--   فحمل معه مقاساتِه. فاختلفت الورقةُ عن الورقة في مشروعٍ واحد،
--   وذهب التوحيدُ الذي من أجله وُضعت الكليشة.
--
--   فصار المقاسُ من الكليشة لا من النصّ: أربعَ عشرةَ نقطةً بتباعد ١٫٩
--   للمتن، وخمسَ عشرةَ بتباعد ١٫٤ للعناوين، وخمسَ عشرةَ بتباعد ٢
--   للآيات. وهذه في ورقة الأنماط، وما في النصِّ من مقاساتٍ يُنزَع.
--
--   والنزعُ لا يُتلِف شيئًا: تُحفَظ نسخةُ النصِّ الأولى كما هي في عمودٍ
--   مستقلٍّ قبل أن يُمسَّ، فإن ظهر خللٌ رُدَّ النصُّ إلى أصله.
-- =====================================================================

-- ـــ ١) النسخةُ الأصليةُ تُحفَظ قبل المسّ
alter table public.tracks
  add column if not exists translation_html_raw text,
  add column if not exists typography_fixed_at timestamptz;

comment on column public.tracks.translation_html_raw is
  'نصُّ الترجمة كما كان قبل توحيد الخطِّ، يُرَدُّ إليه عند الحاجة (ملاحظة ٤٩٩)';
comment on column public.tracks.typography_fixed_at is
  'وقتُ نزع مقاسات الخطِّ من النصّ (ملاحظة ٤٩٩)';

-- ـــ ٢) النازعُ: مقاسُ الخطِّ وتباعدُه ووجهُه، وسماتُ وسم FONT
create or replace function public.strip_inline_type(p_html text)
returns text language sql immutable set search_path = public as $$
  select case when p_html is null then null else
    -- ثمَّ تُنظَّف سماتُ style التي صارت فارغة
    regexp_replace(
      regexp_replace(
        -- وسماتُ وسم FONT: مقاسُه ووجهُه، ويبقى لونُه
        regexp_replace(
          -- خصائصُ المقاس والتباعد والوجه داخل style
          regexp_replace(p_html,
            '(?i)(font-size|line-height|font-family|mso-[a-z-]+)\s*:[^;"'']*;?', '', 'g'),
          '(?i)\s(size|face)\s*=\s*"[^"]*"', '', 'g'),
        '(?i)\s*style\s*=\s*"\s*(;\s*)*"', '', 'g'),
      '(?i)\s*style\s*=\s*''\s*(;\s*)*''', '', 'g')
  end
$$;
grant execute on function public.strip_inline_type(text) to authenticated;

comment on function public.strip_inline_type(text) is
  'نزعُ مقاسات الخطِّ وتباعده ووجهه من نصِّ الترجمة (ملاحظة ٤٩٩)';

-- ـــ ٣) تسويةُ ما مضى: نسخةٌ محفوظةٌ ثم نزع
--
--   ولا يُمَسُّ نصٌّ مرَّتين: من حُفظ أصلُه ووُسم بوقت التسوية يُترَك،
--   فإعادةُ تشغيل الهجرة لا تُتلف نسخةً أُصلحت بعدها بيد مترجم
update public.tracks t
   set translation_html_raw = coalesce(t.translation_html_raw, t.translation_html),
       translation_html = public.strip_inline_type(t.translation_html),
       typography_fixed_at = now()
 where t.translation_html is not null
   and t.typography_fixed_at is null
   and t.translation_html <> public.strip_inline_type(t.translation_html);

-- ـــ ٤) وما يُحفَظ بعد اليوم يُنزَع عنه المقاسُ في الخادم أيضًا،
--   فلا يعتمد التوحيدُ على المتصفِّح وحدَه
create or replace function public.tracks_strip_type()
returns trigger language plpgsql set search_path = public as $$
begin
  -- وردُّ النصِّ إلى أصله يرفع هذا المُشغِّلَ في جلسته وحدَها، فلا
  --   يُعطَّل على سائر العاملين لحظةَ الردّ (مراجعةُ ملاحظة ٤٩٩)
  if coalesce(current_setting('app.restore_raw', true), '') = 'on' then
    return new;
  end if;
  if new.translation_html is not null then
    new.translation_html := public.strip_inline_type(new.translation_html);
  end if;
  return new;
end $$;

drop trigger if exists tracks_strip_type on public.tracks;
create trigger tracks_strip_type
  before insert or update of translation_html on public.tracks
  for each row execute function public.tracks_strip_type();

comment on function public.tracks_strip_type() is
  'توحيدُ خطِّ المتن عند كلِّ حفظ، فلا يُترَك للمتصفِّح وحدَه (ملاحظة ٤٩٩)';

-- ـــ ٥) وردُّ نصٍّ إلى أصله قبل التسوية، إن ظهر فيه خلل
create or replace function public.restore_raw_html(p_track uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_raw text;
begin
  if not public.is_admin_for('rp_archive') then
    raise exception 'ردُّ النصِّ إلى أصله لمن يملك مفتاحَ الأرشيف' using errcode = '42501';
  end if;
  select translation_html_raw into v_raw from public.tracks where id = p_track;
  if v_raw is null then return false; end if;
  -- والردُّ يتجاوز المنقِّيَ عمدًا: المقصودُ الأصلُ كما كان، ورفعُه
  --   في هذه الجلسة وحدَها لا في القاعدة كلِّها
  perform set_config('app.restore_raw', 'on', true);
  update public.tracks
     set translation_html = v_raw, typography_fixed_at = null
   where id = p_track;
  perform set_config('app.restore_raw', 'off', true);
  perform public.log_admin('typography_restore', null, jsonb_build_object('track', p_track));
  return true;
end $$;
grant execute on function public.restore_raw_html(uuid) to authenticated;

comment on function public.restore_raw_html(uuid) is
  'ردُّ نصِّ ترجمةٍ إلى صورته قبل توحيد الخطّ (ملاحظة ٤٩٩)';

notify pgrst, 'reload schema';
