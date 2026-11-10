-- =====================================================================
-- ٠١٣٦ — عرضُ البطاقة: على العضو وعلى الفريق كلِّه (ملاحظة ٤٨٦)
--
--   كان الإخفاءُ لعضوٍ واحدٍ وحدَه (ملاحظة ٤٠٢)، فإذا أُريد وقفُ العرض
--   عن الفريق جميعًا لم يكن إلا أن يُخفى واحدًا واحدًا. فصار له مفتاحٌ
--   واحد.
--
--   ومعه تُسدُّ ثلمةٌ: البطاقةُ المخفيّةُ كانت تُخفى عن صاحبها في
--   المنصة، وباركودُها يُفتَح في صفحة التحقّق العامّة فيُقرأ اسمُه
--   وصفتُه ولغاتُه كأنها سارية. فالإخفاءُ كان في الشاشة لا في الحقيقة.
--   وصارت المخفيّةُ تُقرأ «موقوفة» كالمنتهية.
-- =====================================================================

-- ـــ ١) مفتاحُ الفريق كلِّه
create or replace function public.hide_all_member_cards(p_hidden boolean)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_on boolean := coalesce(p_hidden, false);
begin
  if not (public.is_manager() or public.is_admin_for('cards')) then
    raise exception 'إظهارُ البطاقات وإخفاؤها بإذن' using errcode = '42501';
  end if;
  update public.member_cards
     set hidden = v_on,
         hidden_at = case when v_on then now() end,
         hidden_by = case when v_on then auth.uid() end
   where hidden is distinct from v_on;
  get diagnostics v_n = row_count;
  perform public.log_admin('cards_hide_all', null,
    jsonb_build_object('hidden', v_on, 'n', v_n));
  return v_n;
end $$;
grant execute on function public.hide_all_member_cards(boolean) to authenticated;

comment on function public.hide_all_member_cards(boolean) is
  'إيقافُ عرض البطاقات عن الفريق كلِّه أو إعادتُه (ملاحظة ٤٨٦)';

-- ـــ ٢) والمخفيّةُ لا يُفتَح باركودُها: «موقوفة» كالمنتهية
create or replace function public.verify_card(p_no text, p_key text)
returns table (full_name text, member_no int, role_text text, track text,
               langs text, valid_until date, state text)
language sql stable security definer set search_path = public as $$
  -- والبطاقةُ التي ليست ساريةً لا تُفشي صاحبَها: يُقال حالُها ولا
  --   يُقرأ اسمُه ولا صفتُه ولا لغاتُه. فالإيقافُ في الحقيقة لا في
  --   الشارة وحدَها، وإلّا كان الباركودُ بابًا مفتوحًا على بياناته
  --   بعد إيقافه (ملاحظة ٤٨٦)
  select case when v.ok then p.full_name end,
         case when v.ok then p.member_no end,
         case when v.ok then
           case p.role when 'manager' then 'مدير المشروع'
                       when 'coordinator' then 'منسق'
                       when 'supervisor' then 'مشرف'
                       when 'viewer' then 'متابع'
                       else 'مترجم' end end,
         case when v.ok then
           case coalesce(p.track, 'translation')
                when 'field' then 'الإرشاد المكاني'
                when 'answers' then 'نقل الأسئلة والأجوبة'
                else 'الترجمة التخصصية' end end,
         case when v.ok then
           (select string_agg(l.name_ar, '، ' order by l.sort)
              from public.member_languages ml
              join public.languages l on l.code = ml.language_code
             where ml.member_id = p.id) end,
         case when v.ok then c.valid_until end,
         v.state
    from public.profiles p
    join public.member_card_keys k on k.member_id = p.id
    left join public.member_cards c on c.member_id = p.id
    cross join lateral (
      select st, st = 'سارية' as ok from (
        select case when p.status <> 'active'            then 'موقوفة'
                    when c.issued_at is null             then 'غير معتمدة'
                    when coalesce(c.hidden, false)       then 'موقوفة'
                    when c.valid_until is not null
                     and c.valid_until < current_date    then 'منتهية'
                    else 'سارية' end as st) y) v (state, ok)
   where k.card_key = nullif(btrim(coalesce(p_key, '')), '')
     and p.member_no::text = nullif(btrim(coalesce(p_no, '')), '')
$$;
grant execute on function public.verify_card(text, text) to anon, authenticated;

comment on function public.verify_card(text, text) is
  'التحقّقُ من بطاقة العمل: ما في وجهها لا غير، والمخفيّةُ موقوفة (ملاحظتا ٣١٣ و٤٨٦)';

-- ـــ ٣) وكشفُ الظهور يضمُّ المدينةَ ليُبوَّب بها كما في شاشة البطاقات
drop function if exists public.card_visibility();
create or replace function public.card_visibility()
returns table (member_id uuid, full_name text, track text, role text, city text,
               issued_at timestamptz, valid_until date, hidden boolean,
               expired boolean, shows boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, coalesce(p.track, 'translation')::text, p.role::text, p.city,
         c.issued_at, c.valid_until, c.hidden,
         (c.valid_until is not null and c.valid_until < current_date),
         (not c.hidden
          and (c.valid_until is null or c.valid_until >= current_date))
    from public.member_cards c
    join public.profiles p on p.id = c.member_id
   where public.is_manager() or public.is_admin_for('cards')
   order by p.full_name
$$;
grant execute on function public.card_visibility() to authenticated;

comment on function public.card_visibility() is
  'من تظهر له البطاقةُ ومن لا تظهر، ومدينتُه (ملاحظتا ٤٠٢ و٤٨٦)';

notify pgrst, 'reload schema';
