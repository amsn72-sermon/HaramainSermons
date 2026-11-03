-- =====================================================================
-- ٠١٣٠ — سدُّ ثغراتٍ كشفها فحصٌ أمنيٌّ للمنصة كلِّها
--
--   طلب صاحبُ المشروع فحصَ الموقع لاكتشاف الثغرات، وقال: «حمايةُ
--   معلومات المترجمين ووثائقهم خطٌّ أحمر». فهذه الهجرةُ تسدُّ ما وُجد،
--   وكلُّ بندٍ منها مكتوبٌ بسببه ليُعرَف لمَ كان.
-- =====================================================================

-- ـــ ١) نسخُ المستندات: دالَّةٌ بلا حارسٍ تُسرِّب الآيبانَ ورقمَ الهوية
--
--   `snapshot_doc(p_member, p_kind)` كانت ممنوحةً لكلِّ مسجَّل، وهي
--   `security definer` بلا تحقُّقٍ من دورٍ ولا ملكية: تقرأ من
--   `bank_accounts` الآيبانَ ورقمَ الحساب ومسارَ خطاب البنك، أو من
--   `profile_private` رقمَ الهوية والجنسيةَ ومسارَ صورة الإقامة، ثم
--   تُدرجها في `doc_history`. وسياسةُ قراءة `doc_history` كانت تشمل
--   `is_supervisor()` و`is_viewer()` وهما ليسا من `is_admin()`،
--   فكان المشرفُ أو المتابعُ — وهما دورا «يرى ولا يملك» — يستدعيها
--   على أيِّ عضوٍ ثم يقرأ الصفَّ فيأخذ آيبانَه ورقمَ هويته، ويكرِّرها
--   على الفريق كلِّه. وزيادةً: كان كلُّ مسجَّلٍ يُدرج صفوفًا في سجلٍّ
--   تدقيقيٍّ وُصف بأنه حجّة.
--
--   وهي أداةٌ داخليةٌ لا يناديها العميلُ أصلًا، فنُزع عنه تنفيذُها.
--   والدوالُّ الداخليةُ تناديها وهي `security definer` فتعمل بمالكها.
revoke execute on function public.snapshot_doc(uuid, text) from public, anon, authenticated;

comment on function public.snapshot_doc(uuid, text) is
  'أداةٌ داخليةٌ لحفظ نسخة المستند قبل تبديله — لا تُنادى من العميل (ملاحظة أمنية ٠١٣٠)';

-- والقراءةُ تعود إلى صاحبها وإلى الإدارة، كما في `profile_private`
--   و`bank_accounts` أصلًا، فلا يُفتَح من الباب ما أُغلق من النافذة
drop policy if exists "see doc history" on public.doc_history;
create policy "see doc history" on public.doc_history for select
  using (member_id = auth.uid() or public.is_admin());

drop policy if exists "see own renewals" on public.doc_renewals;
create policy "see own renewals" on public.doc_renewals for select
  using (member_id = auth.uid() or public.is_admin());

-- ـــ ٢) العضوُ كان يعتمد هويتَه بنفسه
--
--   سياسةُ «edit own private» تأذن له بتعديل صفِّه كلِّه في
--   `profile_private`، ولم يكن عليها قيدُ أعمدةٍ كالذي على `profiles`
--   (revoke update ثم grant update (full_name)). وأُضيفت بعدَها أعمدةُ
--   المراجعة: iqama_status و iqama_by و iqama_at و photo_status و
--   data_status. فكان المترجمُ يرسل تعديلًا مباشرًا يجعل هويته
--   «معتمَدة» باسم منسقٍ لم يرَها، ويغيّر رقمَ هويته بعد الاعتماد،
--   ويحوّل مسارَ صورتها إلى ملفٍّ آخر.
--
--   وكتاباتُ العضو كلُّها لها دوالُّ محروسةٌ أصلًا: set_my_iqama (وفيها
--   التحقّقُ من أنَّ المسار في مجلَّده هو)، و set_my_id_expiry، و
--   update_my_contact، و set_member_photo، و save_bank_account.
--   فنُزع التعديلُ المباشر.
revoke update on public.profile_private from authenticated;
drop policy if exists "edit own private" on public.profile_private;

comment on table public.profile_private is
  'البياناتُ الخاصة: القراءةُ لصاحبها وللإدارة، والكتابةُ عبر الدوالِّ المحروسة وحدَها (ملاحظة أمنية ٠١٣٠)';

-- ـــ ٣) سرُّ بطاقة العمل كان مكشوفًا للزملاء
--
--   `profiles` يقرؤه كلُّ عضوٍ مفعَّل، وكان فيه `card_key` وهو السرُّ
--   المطبوعُ في باركود البطاقة، مع `member_no`. وهما بعينهما ما تطلبه
--   `verify_card(p_no, p_key)`، فكان أيُّ مترجمٍ يُثبت بطاقةَ أيِّ
--   زميل. ومنعُ عمودٍ بعينه لا يُجدي هنا، لأنَّ المنعَ لا يعرف الأدوار
--   وشاشاتُ الإدارة تحتاج المفتاحَ لطباعة البطاقات. فنُقل إلى جدولٍ
--   مستقلٍّ سياستُه: صاحبُه أو الإدارة.
create table if not exists public.member_card_keys (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  card_key  text not null unique,
  at        timestamptz not null default now()
);

comment on table public.member_card_keys is
  'مفاتيحُ التحقّق من بطاقات العمل — لصاحبها وللإدارة (ملاحظة أمنية ٠١٣٠)';

alter table public.member_card_keys enable row level security;
drop policy if exists "read card keys" on public.member_card_keys;
create policy "read card keys" on public.member_card_keys for select
  using (member_id = auth.uid() or public.is_admin());
grant select on public.member_card_keys to authenticated;

-- تُنقَل المفاتيحُ القائمةُ ثم يُزال العمودُ القديم
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles'
                and column_name = 'card_key') then
    insert into public.member_card_keys (member_id, card_key)
      select id, card_key from public.profiles where card_key is not null
      on conflict (member_id) do nothing;
    execute 'drop index if exists public.profiles_card_key';
    execute 'alter table public.profiles drop column card_key';
  end if;
end $$;

create or replace function public.ensure_card_key(p_member uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  select card_key into v_key from public.member_card_keys where member_id = p_member;
  if v_key is not null then return v_key; end if;
  v_key := substr(md5(gen_random_uuid()::text || p_member::text), 1, 10);
  insert into public.member_card_keys (member_id, card_key) values (p_member, v_key)
    on conflict (member_id) do update set card_key = excluded.card_key
    returning card_key into v_key;
  return v_key;
end $$;
revoke execute on function public.ensure_card_key(uuid) from public, anon, authenticated;

-- ومفتاحُ البطاقة لم يكن يُولَّد أصلًا: ترقيعُ ٠١٠١ وضع استدعاءه بعد
--   `return` في issue_member_cards فلم يُنفَّذ قطّ، فكان الباركودُ يُطبَع
--   بمفتاحٍ فارغٍ ولا يُثبِت شيئًا. فأُعيد إلى موضعه قبل الإرجاع.
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'issue_member_cards';
  if v_src is null then return; end if;
  if position(E'  perform public.ensure_card_key(m) from unnest(p_members) m;\n  return v_n;' in v_src) > 0
  then return; end if;
  v_new := replace(v_src,
    E'  return v_n;\n  perform public.ensure_card_key(m) from unnest(p_members) m;',
    E'  perform public.ensure_card_key(m) from unnest(p_members) m;\n  return v_n;');
  if v_new = v_src then
    raise warning 'issue_member_cards: لم يُعثَر على موضع توليد مفتاح البطاقة';
  else execute v_new; end if;
end $do$;

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
    join public.member_card_keys k on k.member_id = p.id
    left join public.member_cards c on c.member_id = p.id
   where k.card_key = nullif(btrim(coalesce(p_key, '')), '')
     and p.member_no::text = nullif(btrim(coalesce(p_no, '')), '')
$$;
grant execute on function public.verify_card(text, text) to anon, authenticated;

comment on function public.verify_card(text, text) is
  'التحقّقُ من بطاقة العمل: ما في وجهها لا غير، ولا بياناتٍ خاصّة (ملاحظة ٣١٣)';

-- ـــ ٤) عنوانُ الإنترنت وجهازُ التوقيع كان يراهما المشرف
--
--   سياسةٌ أُنشئت حلقيًّا في ٠٠٤٣ فتحت `policy_acceptances` للمشرف،
--   ثم أُضيف إلى الجدول `sign_ip` و`sign_agent` في ٠١٢٤. ونصُّ تعليقنا
--   في ٠١٢٥ أنَّهما «للإدارة داخل المنصة وحدَها»، و`policy_roster()`
--   تعمَّدت إسقاطَهما.
--
--   ورؤيةُ مدير الهيئة من وقّع الميثاقَ مقصودةٌ من ملاحظة ١٦٤ فلا
--   تُسحَب، وإنما يُنقَل العنوانُ والجهازُ إلى جدولٍ إداريٍّ مستقلّ،
--   فيبقى له ما له ويُمنَع ما لم يكن له.
create table if not exists public.policy_sign_meta (
  acceptance_id uuid primary key
    references public.policy_acceptances (id) on delete cascade,
  sign_ip    inet,
  sign_agent text
);

comment on table public.policy_sign_meta is
  'عنوانُ الشبكة وجهازُ التوقيع — للإدارة وحدَها، تُقرأ عبر policy_proof (ملاحظة أمنية ٠١٣٠)';

alter table public.policy_sign_meta enable row level security;
drop policy if exists "admin reads sign meta" on public.policy_sign_meta;
create policy "admin reads sign meta" on public.policy_sign_meta for select
  using (public.is_admin());

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'policy_acceptances'
                and column_name = 'sign_ip') then
    insert into public.policy_sign_meta (acceptance_id, sign_ip, sign_agent)
      select id, sign_ip, sign_agent from public.policy_acceptances
       where sign_ip is not null or sign_agent is not null
      on conflict (acceptance_id) do nothing;
  end if;
end $$;

-- التوقيعُ يكتب في الجدولين، والنصُّ واحدٌ لا يتبدَّل
create or replace function public.accept_policy(
  p_version text,
  p_name    text,
  p_key     text default 'confidentiality',
  p_text    text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_key text; v_hash text; v_code text; v_agent text; v_h json; v_id uuid;
begin
  if auth.uid() is null then raise exception 'غير مصرح' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'اكتب اسمك الكامل توقيعًا'; end if;
  if length(btrim(coalesce(p_version, ''))) = 0 then raise exception 'نسخة السياسة غير محددة'; end if;
  v_key := coalesce(nullif(btrim(p_key), ''), 'confidentiality');

  if nullif(btrim(coalesce(p_text, '')), '') is not null then
    v_hash := encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
  end if;

  begin v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then v_h := null; end;
  if v_h is not null then v_agent := left(nullif(btrim(coalesce(v_h ->> 'user-agent', '')), ''), 400); end if;

  v_code := 'SG-' || upper(substr(encode(sha256(convert_to(
              auth.uid()::text || v_key || btrim(p_version) || clock_timestamp()::text, 'UTF8')), 'hex'), 1, 10));

  insert into public.policy_acceptances
    (member_id, policy_key, policy_version, signed_name, doc_hash, proof_code)
  values (auth.uid(), v_key, btrim(p_version), btrim(p_name), v_hash, v_code)
  on conflict (member_id, policy_key, policy_version) do nothing;

  select id, proof_code into v_id, v_code from public.policy_acceptances
   where member_id = auth.uid() and policy_key = v_key and policy_version = btrim(p_version);

  insert into public.policy_sign_meta (acceptance_id, sign_ip, sign_agent)
  values (v_id, public.request_ip(), v_agent)
  on conflict (acceptance_id) do nothing;

  return v_code;
end $$;
grant execute on function public.accept_policy(text, text, text, text) to authenticated;

comment on function public.accept_policy(text, text, text, text) is
  'توقيعُ العضو على الميثاق، ومعه عنوانُه وجهازُه وبصمةُ النصِّ ورمزُ تحقُّقه (ملاحظة ٤٢٥)';

-- ووثيقةُ الإثبات تقرأ العنوانَ والجهازَ من موضعهما الجديد
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'policy_proof';
  if v_src is null then raise exception 'policy_proof غير موجودة'; end if;
  -- وإعادةُ تشغيل الهجرة لا تُضيف الوصلةَ مرّتين فتُفسد الدالّة
  if position('policy_sign_meta' in v_src) > 0 then return; end if;
  if position('host(a.sign_ip)' in v_src) = 0 then
    raise exception 'لم يُعثَر على موضع العنوان في policy_proof';
  end if;
  v_new := replace(v_src, 'host(a.sign_ip), a.sign_agent', 'host(g.sign_ip), g.sign_agent');
  v_new := replace(v_new, 'from public.policy_acceptances a',
    E'from public.policy_acceptances a\n    left join public.policy_sign_meta g on g.acceptance_id = a.id');
  if v_new <> v_src then execute v_new; end if;
end $do$;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'policy_acceptances'
                and column_name = 'sign_ip') then
    execute 'alter table public.policy_acceptances drop column sign_ip';
    execute 'alter table public.policy_acceptances drop column sign_agent';
  end if;
end $$;

-- ـــ ٥) صورةُ التوقيع الرسميّ كان يقرؤها كلُّ مترجم
--
--   حاويةُ `design` قراءتُها لكلِّ من له دور، و`design_assets.kind`
--   يشمل 'signature' — وهو التوقيعُ الذي تُختَم به الشهاداتُ
--   والترجماتُ المعتمدة، فكان يُنزَّل ويُختَم به خارجَ المنصة. وحاويةُ
--   `signatures` محروسةٌ بـ«صاحبُها أو الإدارة»، فجُعلت هذه مثلَها في
--   التواقيع، وبقي الشعارُ والخلفيةُ للفريق فهما يُطبَعان في البطاقات.
drop policy if exists "staff read design assets" on storage.objects;
create policy "staff read design assets" on storage.objects for select
  using (
    bucket_id = 'design'
    and (
      public.is_admin()
      or (public.my_role() is not null
          and not exists (select 1 from public.design_assets d
                           where d.file_path = storage.objects.name
                             and d.kind = 'signature'))
    )
  );

-- ـــ ٦) «مسجَّلٌ» ليست «له دور»
--
--   أربعةُ مواضعَ شرطُها `auth.uid() is not null`، وهو صادقٌ لكلِّ من
--   سجَّل في بوابة التسجيل المفتوحة ولم يُراجَع طلبُه بعد، وللموقوف،
--   وللمتابع الذي انقضى أجلُه. فصارت `my_role() is not null` كبقيّة
--   المنصة: من له دورٌ وحسابُه مفعَّل.
drop policy if exists "brand read" on storage.objects;
create policy "brand read" on storage.objects for select
  using (bucket_id = 'brand' and public.my_role() is not null);

drop policy if exists "rates read" on public.pay_rates;
create policy "rates read" on public.pay_rates for select
  using (public.is_admin());

drop policy if exists "settings read" on public.platform_settings;
create policy "settings read" on public.platform_settings for select
  using (public.my_role() is not null);

drop policy if exists "read card settings" on public.card_settings;
create policy "read card settings" on public.card_settings for select
  using (public.my_role() is not null);
