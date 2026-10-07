-- =====================================================================
-- 0101 — قالبُ الشهادة يُصمَّم ويُحفَظ، والبطاقةُ يُتحقَّق منها
--        (ملاحظتا ٣١٢ و٣١٣)
--
--   تصميمُ الشهادة كان يُضبَط في نافذة إنشائها، فيُعاد في كلِّ مرة.
--   فيُفرَد له قالبٌ محفوظٌ كقالب بطاقات العمل: يُصمَّم مرةً ويسري على
--   ما يُصدَر بعده، ولكلِّ شهادةٍ أن تخرج عنه.
--
--   وبطاقةُ العمل بلا باركود: تُعرَض على من يسأل ولا يُتحقَّق منها.
--   فيُضاف لها تحقّقٌ عامٌّ كتحقّق الخطب والشهادات، لا يُفشي من بياناتِ
--   صاحبها إلا ما في وجه البطاقة.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) قالبُ تصميم الشهادة: واحدٌ للفريق كلِّه
-- ---------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists cert_design jsonb;

comment on column public.platform_settings.cert_design is
  'قالبُ تصميم الشهادات: الألوانُ والشعاراتُ والعلامةُ والمواضع (ملاحظة ٣١٢)';

create or replace function public.cert_design()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select cert_design from public.platform_settings limit 1), '{}'::jsonb)
$$;
grant execute on function public.cert_design() to authenticated;

create or replace function public.save_cert_design(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.is_admin_for('cert_design')) then
    raise exception 'تصميمُ قالب الشهادة بإذن مدير المشروع' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'قالبٌ غيرُ مقروء';
  end if;
  update public.platform_settings set cert_design = p;
  if not found then
    insert into public.platform_settings (cert_design) values (p);
  end if;
end $$;
grant execute on function public.save_cert_design(jsonb) to authenticated;

comment on function public.save_cert_design(jsonb) is
  'حفظُ قالب تصميم الشهادات — يسري على ما يُصدَر بعده (ملاحظة ٣١٢)';

-- ---------------------------------------------------------------------
-- ٢) بطاقةُ العمل: مفتاحُ تحقّقٍ لكلِّ بطاقةٍ تُعتمَد (ملاحظة ٣١٣)
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists card_key text;

comment on column public.profiles.card_key is
  'مفتاحُ التحقّق من بطاقة العمل، يُطبَع في باركودها (ملاحظة ٣١٣)';

create unique index if not exists profiles_card_key on public.profiles (card_key)
  where card_key is not null;

-- يُولَّد عند اعتماد البطاقة، ولا يُبدَّل بعدها
create or replace function public.ensure_card_key(p_member uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  select card_key into v_key from public.profiles where id = p_member;
  if v_key is not null then return v_key; end if;
  v_key := substr(md5(gen_random_uuid()::text || p_member::text), 1, 10);
  update public.profiles set card_key = v_key where id = p_member;
  return v_key;
end $$;
grant execute on function public.ensure_card_key(uuid) to authenticated;

-- ويُولَّد لكلِّ من اعتُمدت بطاقتُه
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'issue_member_cards';
  if v_src is null or position('ensure_card_key' in v_src) > 0 then return; end if;
  v_new := regexp_replace(v_src,
    '(\s+)end\s*\$function\$\s*$',
    E'\\1  perform public.ensure_card_key(m) from unnest(p_members) m;\\1end $function$');
  if v_new <> v_src then execute v_new; end if;
end $do$;

-- ---------------------------------------------------------------------
-- ٣) صفحةُ التحقق العامة: تُثبت البطاقةَ ولا تُفشي صاحبَها
--    لا هويةَ ولا بريدَ ولا جوّالَ ولا حساب — وجهُ البطاقة لا غير
-- ---------------------------------------------------------------------
create or replace function public.verify_card(p_no text, p_key text)
returns table (full_name text, member_no int, role_text text, track text,
               langs text, valid_until date, state text)
language sql stable security definer set search_path = public as $$
  select p.full_name, p.member_no,
         case p.role when 'manager' then 'مدير المشروع'
                     when 'coordinator' then 'منسق'
                     when 'supervisor' then 'مشرف'
                     when 'viewer' then 'متابع'
                     else 'مترجم' end,
         case coalesce(p.track, 'translation')
              when 'field' then 'الإرشاد المكاني'
              when 'answers' then 'نقل الأسئلة والأجوبة'
              else 'الترجمة التخصصية' end,
         (select string_agg(l.name_ar, '، ' order by l.sort)
            from public.member_languages ml
            join public.languages l on l.code = ml.language_code
           where ml.member_id = p.id),
         c.valid_until,
         case when p.status <> 'active'            then 'موقوفة'
              when c.issued_at is null             then 'غير معتمدة'
              when c.valid_until is not null
               and c.valid_until < current_date    then 'منتهية'
              else 'سارية' end
    from public.profiles p
    left join public.member_cards c on c.member_id = p.id
   where p.card_key is not null
     and p.card_key = nullif(btrim(coalesce(p_key, '')), '')
     and p.member_no::text = nullif(btrim(coalesce(p_no, '')), '')
$$;
grant execute on function public.verify_card(text, text) to anon, authenticated;

comment on function public.verify_card(text, text) is
  'التحقّقُ من بطاقة العمل: ما في وجهها لا غير، ولا بياناتٍ خاصّة (ملاحظة ٣١٣)';

notify pgrst, 'reload schema';
