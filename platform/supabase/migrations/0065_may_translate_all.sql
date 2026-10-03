-- =====================================================================
-- 0065 — «يترجم» خيارٌ أمام كل عضو (ملاحظة ٢٠٦)
--   كانت الإتاحةُ خاصّةً بالمرشد المكاني المتميّز (ملاحظة ١٧٣)، ثم لحق
--   بها فريقُ إجابة السائلين في الحاجز دون زرّه، فبقي الزرُّ لا يُفتح
--   إلا لفريق الإرشاد. والمرادُ الآن أن يكون أمام كل عضوٍ من الفريق —
--   المترجمُ المتخصص، وإجابةُ السائلين، والمرشدُ المكاني — خيارٌ واحد:
--   «يترجم». فمن حُدِّد له ظهر في قائمة الإسناد للغته التي يتحدث بها،
--   ومن لم يُحدَّد له لم يظهر ولم يُسنَد إليه شيء.
--
--   والمترجمون المتخصصون اليوم يترجمون بحكم دورهم، فتُكتب لهم الإتاحةُ
--   ابتداءً حتى لا ينقطع عملٌ قائم، ومن نُقل إلى الترجمة كُتبت له كذلك.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) ما كان قائمًا يبقى قائمًا: المترجمون المتخصصون يترجمون
-- ---------------------------------------------------------------------
update public.profiles set may_translate = true
 where track = 'translation' and not may_translate;

comment on column public.profiles.may_translate
  is 'يترجم: يظهر في قائمة الإسناد للغته المسجَّلة — لكل الفريق (ملاحظة ٢٠٦)';

-- ومن سُجّل في الترجمة أو نُقل إليها كُتبت له الإتاحةُ من نفسها
create or replace function public.default_may_translate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.may_translate := (new.track = 'translation');
  elsif old.track is distinct from new.track then
    -- من نُقل إلى الترجمة يترجم بحكم دوره، ومن خرج منها عاد الأصلُ فيه
    -- المنعَ حتى يُحدَّد له «يترجم» قصدًا
    new.may_translate := (new.track = 'translation');
  end if;
  return new;
end $$;

drop trigger if exists on_track_sets_may on public.profiles;
create trigger on_track_sets_may
  before insert or update of track on public.profiles
  for each row execute function public.default_may_translate();

-- ---------------------------------------------------------------------
-- ٢) الزرّ: لكل الفريق لا لفريق الإرشاد وحده
-- ---------------------------------------------------------------------
create or replace function public.set_member_may_translate(p_member uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_track text; v_langs int;
begin
  if not public.is_admin_for('team') then
    raise exception 'تحديد «يترجم» لمن يملك صلاحية الفريق' using errcode = '42501';
  end if;
  select track into v_track from public.profiles where id = p_member;
  if v_track is null then raise exception 'العضو غير موجود'; end if;

  if coalesce(p_on, false) then
    select count(*) into v_langs from public.member_languages where member_id = p_member;
    if v_langs = 0 then
      raise exception 'سجّل لغاته أولًا، فالإسناد يكون بحسب لغته';
    end if;
  end if;
  update public.profiles set may_translate = coalesce(p_on, false) where id = p_member;
end $$;
grant execute on function public.set_member_may_translate(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- ٣) الحاجز: لا يُسنَد إلا إلى من حُدِّد له «يترجم»
--    ويبقى قيدُ اللغة على فريقَي الإرشاد وإجابة السائلين كما كان
-- ---------------------------------------------------------------------
create or replace function public.block_field_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_may boolean; v_track text; v_lang text;
begin
  select p.may_translate, p.track into v_may, v_track
    from public.profiles p where p.id = new.assignee_id;
  if not found then return new; end if;

  if not coalesce(v_may, false) then
    raise exception 'لم يُحدَّد لهذا العضو «يترجم» — حدِّده له أولًا';
  end if;

  if v_track in ('field', 'answers') then
    select t.language_code into v_lang from public.tracks t where t.id = new.track_id;
    if v_lang is null or not exists (
         select 1 from public.member_languages ml
          where ml.member_id = new.assignee_id and ml.language_code = v_lang) then
      raise exception 'تُسنَد إليه الترجمة بلغته المسجَّلة وحدها';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- ٤) ولا تُرفع الإتاحة وفي يده عملٌ لم يُنجز — لكل الفريق
-- ---------------------------------------------------------------------
create or replace function public.guard_may_translate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.may_translate and not new.may_translate and exists (
       select 1 from public.track_stages s
        where s.assignee_id = new.id and s.status <> 'done'::stage_status) then
    raise exception 'له أعمالٌ لم تُنجز — أنهِها أو انقلها أولًا';
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
