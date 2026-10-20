-- =====================================================================
-- 0126 — مشرفُ اللغة، وصلاحياتٌ يمنحها مديرُ المشروع، ورقمُ التوثيق
--        عند الرفع، ورقمُ الهوية في وثيقة الإثبات
--        (ملاحظات ٤٣١ و٤٣٩ و٤٤٠ و٤٤١ و٤٤٤ و٤٤٥)
--
--   المنسقون لا يعرفون اللغات، فلا يَزِنون تنسيقَ ترجمةٍ ولا جودتَها.
--   فيُجعَل لكلِّ لغةٍ مشرفٌ من المترجمين: يستلمها أولًا، ويوزّعها على
--   أهل لغته، وتعود إليه آخرًا فيراجعها ثم يسلّمها للمنسق. ولا يُنشئ
--   عملًا من نفسه: لا يملك إلا ما أُسنِد إلى لغته.
--
--   وثلاثةُ أبوابٍ كانت مفتوحةً لكلِّ إداريٍّ بحكم دوره — الأرشيفُ،
--   والقاعاتُ واللقاءات، ولوحةُ المتابعة — تصير صلاحياتٍ يمنحها مديرُ
--   المشروع لمن يختار. والأرشيفُ يُغلَق في القاعدة لا في الشاشة وحدَها:
--   فالواجهةُ تُخدَع والقاعدةُ لا تُخدَع.
--
--   ورقمُ التوثيق كان يُسحَب بمجرَّد إنشاء سجلِّ الخطبة ولو كانت خاوية،
--   فيُهدَر رقمٌ لعملٍ لم يوجد — والمسحوبُ لا يُعاد. فصار يُمنَح متى
--   صار في الخطبة نصّ.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) رقمُ الهوية في وثيقة إثبات التوقيع (ملاحظة ٤٣١)
--
--   الهويةُ في `profile_private`، ولا تُقرأ إلا لصاحبها وللإدارة —
--   وهو شرطُ `policy_proof` نفسِه. ولا تدخل صفحةَ التحقُّق العامّة.
-- ---------------------------------------------------------------------
drop function if exists public.policy_proof(uuid, text, text);
create or replace function public.policy_proof(
  p_member uuid, p_version text default null, p_key text default 'confidentiality')
returns table (member_id uuid, full_name text, email text, member_no int,
               national_id text, policy_key text, policy_version text,
               signed_name text, accepted_at timestamptz, sign_ip text,
               sign_agent text, doc_hash text, proof_code text)
language sql stable security definer set search_path = public as $$
  select a.member_id, p.full_name, p.email, p.member_no, v.national_id,
         a.policy_key, a.policy_version, a.signed_name, a.accepted_at,
         host(a.sign_ip), a.sign_agent, a.doc_hash, a.proof_code
    from public.policy_acceptances a
    join public.profiles p on p.id = a.member_id
    left join public.profile_private v on v.id = a.member_id
   where a.member_id = p_member
     and a.policy_key = coalesce(nullif(btrim(p_key), ''), 'confidentiality')
     and (p_version is null or a.policy_version = btrim(p_version))
     and (public.is_manager() or public.is_admin() or a.member_id = auth.uid())
   order by a.accepted_at desc
$$;
grant execute on function public.policy_proof(uuid, text, text) to authenticated;

comment on function public.policy_proof(uuid, text, text) is
  'سجلُّ توقيعِ عضوٍ على الميثاق ومعه هويتُه، تُبنى منه وثيقةُ الإثبات (ملاحظتا ٤٢٥ و٤٣١)';

-- وكشفُ الموقِّعين: الاسمُ والهويةُ والنسخةُ ووقتُ التوقيع ورمزُ وثيقته،
--   بلا عنوانِ شبكةٍ ولا جهازٍ ولا بصمة (ملاحظات ٤٣٢ و٤٣٣ و٤٣٥)
create or replace function public.policy_roster(p_key text default 'confidentiality')
returns table (member_id uuid, full_name text, member_no int, national_id text,
               policy_version text, accepted_at timestamptz, proof_code text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.member_no, v.national_id,
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
     and (public.is_manager() or public.is_admin())
   order by p.full_name
$$;
grant execute on function public.policy_roster(text) to authenticated;

comment on function public.policy_roster(text) is
  'كشفُ الموقِّعين على الميثاق بهوياتهم وتواريخهم ورموز وثائقهم (ملاحظات ٤٣٢ و٤٣٣)';

-- ---------------------------------------------------------------------
-- ٢) ثلاثُ صلاحياتٍ يمنحها مديرُ المشروع (ملاحظات ٤٣٩ و٤٤١ و٤٤٤)
--
--   مغلقةٌ بأصلها، ثم تُفتَح عند هذا الترحيل لمن هو إداريٌّ اليوم، فلا
--   ينقطع عملٌ قائم — ويسحبها مديرُ المشروع ممن شاء بعدُ.
-- ---------------------------------------------------------------------
insert into public.perm_keys (key, label, sort, parent, grp, default_open, sensitive, viewable) values
  ('arch_read',  'الاطّلاعُ على أرشيف الخطب',      180, 'archive_year', 'الأرشيف السنوي',    false, false, true),
  ('rooms_edit', 'القاعاتُ واللقاءاتُ وإدارتُها',  165, 'rooms',        'القاعات واللقاءات', false, false, false),
  ('board_view', 'لوحةُ المتابعة',                  190, 'reports',      'التقارير والتصدير', false, false, true)
on conflict (key) do update
  set label = excluded.label, sort = excluded.sort,
      parent = excluded.parent, grp = excluded.grp;

-- لوحةُ المتابعة والقاعاتُ عملٌ إداريٌّ قائم، فتُفتَح لكلِّ إداريٍّ —
--   اليومَ ومن يُستحدَث بعدُ — ويسحبها مديرُ المشروع ممن شاء. وأمّا
--   أرشيفُ الخطب فلا يُفتَح إلا لمن يختاره مديرُ المشروع بعينه،
--   كما طُلب في ملاحظة ٤٣٩.
insert into public.member_perms (member_id, perm_key, allowed, reason)
select p.id, k.key, true, 'فُتحت عند استحداث الصلاحية لمن هو إداريّ'
  from public.profiles p
  cross join (values ('rooms_edit'), ('board_view')) as k(key)
 where p.role in ('manager', 'coordinator')
on conflict (member_id, perm_key) do nothing;

-- ومن صار إداريًّا بعد اليوم تُفتَح له كما فُتحت لمن قبله، ومن عاد
--   مترجمًا رُفعت عنه ما لم يكن منحًا بعينه من المدير
create or replace function public.admin_default_perms()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_auto text := 'فُتحت عند استحداث الصلاحية لمن هو إداريّ';
begin
  -- وحسابُ المتابعة وحسابُ الهيئة يَريان ولا يكتبان، فلا قاعاتٍ لهما
  if new.role in ('manager', 'coordinator') then
    insert into public.member_perms (member_id, perm_key, allowed, reason)
    select new.id, k.key, true, v_auto
      from (values ('rooms_edit'), ('board_view')) as k(key)
    on conflict (member_id, perm_key) do nothing;
  else
    delete from public.member_perms
     where member_id = new.id and perm_key in ('rooms_edit', 'board_view')
       and reason = v_auto;
  end if;
  return new;
end $$;

drop trigger if exists admin_default_perms on public.profiles;
create trigger admin_default_perms
  after insert or update of role on public.profiles
  for each row execute function public.admin_default_perms();

-- وقائمةُ الصلاحيات كانت لا تُفتَح إلا للمنسقين ومن في حكمهم، فلا يستطيع
--   مديرُ المشروع أن يفتح الأرشيفَ لمترجمٍ بعينه — وهو عينُ ما أراد
--   (ملاحظة ٤٣٩). والأصلُ باقٍ — لا صلاحياتٍ إداريةً للمترجمين — وإنما
--   استُثنيت مفاتيحُ الاطّلاع الثلاثة، فتُمنَح لأيِّ عضوٍ بعينه.
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_member_perm'
     and p.pronargs = 5;
  if v_src is null then raise exception 'set_member_perm غيرُ موجودة'; end if;
  v_new := replace(v_src,
    'if v_role not in (''coordinator'', ''supervisor'', ''field_lead'', ''viewer'') then',
    'if v_role not in (''coordinator'', ''supervisor'', ''field_lead'', ''viewer'')'
    || ' and p_key not in (''arch_read'', ''board_view'', ''rooms_edit'') then');
  if v_new = v_src then raise exception 'لم يُعثَر على شرط الأدوار في set_member_perm'; end if;
  execute v_new;
end $do$;

-- وقراءةُ الأرشيف تُشترَط في القاعدة: شرطُ `my_role()` كان يفتحها لكلِّ
--   عضوٍ ولو لم تظهر له الشاشة (ملاحظة ٤٣٩)
--   و`is_admin_for` تشترط كونَه إداريًّا، وهذه تُمنَح لأيِّ عضو، فتُبنى
--   على `has_perm` وحدَها
create or replace function public.may_read_arch()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() is not null
     and (public.is_manager() or public.has_perm('arch_read'))
$$;
grant execute on function public.may_read_arch() to authenticated;

comment on function public.may_read_arch() is
  'منِ اطَّلع على أرشيف الخطب: مديرُ المشروع ومن فُتحت له صلاحيتُه (ملاحظة ٤٣٩)';

-- والقاعاتُ واللقاءاتُ: الإنشاءُ والتعديلُ والإلغاءُ بالصلاحية، والحذفُ
--   يبقى لمدير المشروع وحدَه كما كان (ملاحظة ٤٤١)
do $do$
declare r record; v_src text; v_new text; v_n int := 0;
begin
  for r in select p.oid, p.proname from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('save_room', 'save_meeting', 'cancel_meeting') loop
    v_src := pg_get_functiondef(r.oid);
    v_new := replace(v_src, 'if not public.is_admin_for(''rooms'') then',
                     'if not (public.is_manager() or public.has_perm(''rooms_edit'')) then');
    v_new := replace(v_new, 'if not public.is_admin() then',
                     'if not (public.is_manager() or public.has_perm(''rooms_edit'')) then');
    if v_new = v_src then continue; end if;
    execute v_new;
    v_n := v_n + 1;
  end loop;
  raise notice 'القاعاتُ واللقاءاتُ بصلاحيتها في % دالّة', v_n;
end $do$;

-- ---------------------------------------------------------------------
-- ٣) رقمُ الخطبة يُمنَح متى صار فيها نصّ (ملاحظة ٤٤٥)
-- ---------------------------------------------------------------------
create or replace function public.stamp_arch_sermon_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- لا يُسحَب رقمٌ لخطبةٍ خاوية: يُمنَح عند رفع أولِ نسخةٍ لها
  return new;
end $$;

create or replace function public.stamp_arch_version_no() returns trigger
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if nullif(btrim(coalesce(new.body_html, '')), '') is null
     and new.file_path is null then
    return new;                       -- نسخةٌ خاويةٌ لا تُرقَّم
  end if;
  select h_year, mosque, sermon_type, doc_no into v
    from public.arch_sermons where id = new.sermon_id;
  if v.h_year is null then return new; end if;

  -- الخطبةُ تأخذ رقمَها مع أولِ نسخةٍ فيها نصّ (ملاحظة ٤٤٥)
  if v.doc_no is null then
    update public.arch_sermons
       set doc_no = public.arch_doc_no(v.h_year, 'ar', v.mosque,
                      coalesce(v.sermon_type, 'خطبة جمعة')),
           doc_no_at = now()
     where id = new.sermon_id and doc_no is null;
  end if;

  if new.doc_no is null then
    new.doc_no := public.arch_doc_no(v.h_year, new.language_code, v.mosque,
                    coalesce(v.sermon_type, 'خطبة جمعة'));
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- ٤) مشرفُ اللغة (ملاحظة ٤٤٠)
-- ---------------------------------------------------------------------
alter table public.languages add column if not exists supervisor_id uuid
  references public.profiles (id) on delete set null;

comment on column public.languages.supervisor_id is
  'مشرفُ اللغة: أولُ من يستلم وآخرُ من يسلّم، ويوزّع على أهل لغته (ملاحظة ٤٤٠)';

-- مرحلةُ مراجعته: بين التحرير واستلام المنسق
--   وهي بوابةُ إشرافٍ كاعتماد المدير: خارجَ وقت التنفيذ، فلا تقتطع
--   من مدّة الترجمة المقسومة بين المراحل
insert into public.workflow_stages (key, name_ar, sort, is_required, outside_sla, assignee_role, weight)
values ('lang_supervision', 'مراجعةُ مشرف اللغة', 45, false, true, 'translator', 0)
on conflict (key) do update set name_ar = excluded.name_ar, sort = excluded.sort,
  outside_sla = excluded.outside_sla, weight = excluded.weight;

-- تعيينُ المشرف: بيد مدير المشروع، ولا يكون إلا ممن يُتقن اللغة
create or replace function public.set_lang_supervisor(p_lang text, p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_a public.profiles;
begin
  if not public.is_manager() then
    raise exception 'تعيينُ مشرف اللغة لمدير المشروع' using errcode = '42501';
  end if;
  if not exists (select 1 from public.languages where code = p_lang) then
    raise exception 'لغةٌ غيرُ موجودة';
  end if;
  if p_member is null then
    update public.languages set supervisor_id = null where code = p_lang;
    return;
  end if;
  select * into v_a from public.profiles where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  if v_a.status <> 'active' then raise exception '«%» غير مفعّل', v_a.full_name; end if;
  if not exists (select 1 from public.member_languages
                  where member_id = p_member and language_code = p_lang) then
    raise exception '«%» غير مؤهل في هذه اللغة', v_a.full_name;
  end if;
  update public.languages set supervisor_id = p_member where code = p_lang;
end $$;
grant execute on function public.set_lang_supervisor(text, uuid) to authenticated;

comment on function public.set_lang_supervisor(text, uuid) is
  'تعيينُ مشرفٍ للغة أو رفعُه — لمدير المشروع (ملاحظة ٤٤٠)';

-- أمشرفٌ هو على لغة هذا المسار؟
create or replace function public.is_lang_supervisor(p_track uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tracks t
      join public.languages l on l.code = t.language_code
     where t.id = p_track and l.supervisor_id = auth.uid())
$$;
grant execute on function public.is_lang_supervisor(uuid) to authenticated;

-- وأعمالُ لغتِه تبقى بين يديه وإن وزّعها: يراها ليراجعها عند عودتها
--   (ملاحظة ٤٤٠). والدالّةُ تُرقَّع في موضعها فلا يُهدَر ما فيها
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'can_see_track' limit 1;
  if v_src is null then raise exception 'can_see_track غيرُ موجودة'; end if;
  if position('is_lang_supervisor' in v_src) > 0 then return; end if;
  v_new := replace(v_src, 'select public.is_admin()',
    'select public.is_admin() or public.is_lang_supervisor(p_track)');
  if v_new = v_src then
    raise exception 'can_see_track: لم يُعثر على موضع التبديل';
  end if;
  execute v_new;
  raise notice 'مشرفُ اللغة يرى أعمالَ لغته';
end $do$;

-- لغاتُ من هو مشرفٌ عليها — تُعرَض له في شاشاته
create or replace function public.my_supervised_langs()
returns table (code text, name_ar text)
language sql stable security definer set search_path = public as $$
  select l.code, l.name_ar from public.languages l
   where l.supervisor_id = auth.uid() and l.is_active
   order by l.sort, l.name_ar
$$;
grant execute on function public.my_supervised_langs() to authenticated;

-- ـــ تغييرُ المسؤول: للإدارة، ولمشرف اللغة في لغته (ملاحظة ٤٤٠)
--
--   والمشرفُ لا يُنشئ عملًا ولا يُسنِد ابتداءً: إنما يُبدِّل مسؤولَ مرحلةٍ
--   في مسارٍ أُسنِد إلى لغته، ولا يتجاوز من لا يُتقن لغتَه — وذلك محفوظٌ
--   في `check_assignee` نفسِها.
create or replace function public.reassign_stage(p_track uuid, p_stage text, p_assignee uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.tracks; v_s public.track_stages; v_ws public.workflow_stages;
        v_a public.profiles; v_first int;
begin
  if not (public.is_admin() or public.is_lang_supervisor(p_track)) then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  select * into v_t from public.tracks where id = p_track for update;
  if not found then raise exception 'المسار غير موجود'; end if;
  if v_t.status = 'completed' then raise exception 'المسار مكتمل'; end if;
  select * into v_s from public.track_stages where track_id = p_track and stage_key = p_stage;
  if not found then raise exception 'المرحلة غير موجودة في هذا المسار'; end if;
  if v_s.status = 'done' then raise exception 'المرحلة أُنجزت ولا يمكن تغيير مسؤولها'; end if;
  if v_s.assignee_id = p_assignee then return; end if;
  select * into v_ws from public.workflow_stages where key = p_stage;
  -- ومرحلةُ المشرف لا يُخرِجها عن نفسه، فهي مراجعتُه هو
  if p_stage = 'lang_supervision' and not public.is_admin() then
    raise exception 'مراجعةُ مشرف اللغة لا تُسنَد إلى غيره';
  end if;
  select * into v_a from public.profiles where id = p_assignee;
  if not found then raise exception 'العضو غير موجود'; end if;
  perform public.check_assignee(v_ws, v_a, v_t.language_code);

  update public.track_stages set assignee_id = p_assignee where id = v_s.id;
  select min(sort) into v_first from public.track_stages where track_id = p_track;
  if v_t.status = 'awaiting_receipt' and v_s.sort = v_first then
    update public.tracks set receipt_due_at = now() + make_interval(mins => (
      select receipt_minutes from public.materials where id = v_t.material_id)) where id = p_track;
  end if;
  perform public.log_event(p_track, 'reassigned', p_stage, null, v_a.full_name);
end $$;

-- ـــ المسؤولون المقترَحون لمرحلةٍ في لغة: المشرفُ أولًا ثم أهلُ اللغة
--   (ملاحظة ٤٤٠) — ومن يسأل وهو مشرفٌ لا يرى إلا أهلَ لغته
create or replace function public.stage_candidates(p_lang text)
returns table (id uuid, full_name text, is_supervisor boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, (l.supervisor_id = p.id) as is_supervisor
    from public.profiles p
    join public.member_languages ml on ml.member_id = p.id and ml.language_code = p_lang
    join public.languages l on l.code = p_lang
   where p.status = 'active'
     and (public.is_admin() or l.supervisor_id = auth.uid())
   order by (l.supervisor_id = p.id) desc, p.full_name
$$;
grant execute on function public.stage_candidates(text) to authenticated;

comment on function public.stage_candidates(text) is
  'من يصلح لمرحلةٍ في لغةٍ بعينها: المشرفُ أولًا ثمَّ أهلُ اللغة (ملاحظة ٤٤٠)';

-- وتُبدَّل في دوالِّ القراءة كلِّها دفعةً واحدة: كانت `my_role() is not null`
--   تفتحها لكلِّ عضوٍ له دورٌ في المنصة (ملاحظة ٤٣٩)
do $do$
declare r record; v_src text; v_new text; v_n int := 0;
begin
  for r in select p.oid, p.proname from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'arch\_%' loop
    v_src := pg_get_functiondef(r.oid);
    if position('public.my_role() is not null' in v_src) = 0 then continue; end if;
    v_new := replace(v_src, 'public.my_role() is not null', 'public.may_read_arch()');
    execute v_new;
    v_n := v_n + 1;
  end loop;
  raise notice 'أُغلقت قراءةُ الأرشيف في % دالّة', v_n;
end $do$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- ٥) إعادةُ رفع الهوية بعد ردِّها (ملاحظة ٤٤٧)
--
--   كان بابُ الرفع في بطاقة «أكمل بياناتك»، فإذا قُبلت البيانات
--   اختفت البطاقةُ ومعها البابُ، فمن رُدَّت هويتُه بعد القبول لم
--   يجد سبيلًا إلى رفع الصحيحة. ثم كان الرفعُ يبدّل المسارَ ولا
--   يبدّل الحال، فتبقى «أُعيدت» بسببها القديم ولا تعود إلى
--   التدقيق. فصار للعضو دالّتُه: ترفع وتعيد الحالَ إلى المراجعة
--   وتمسح سببَ الردّ، وكذلك رفعُ الإدارة عنه.
-- ---------------------------------------------------------------------
create or replace function public.set_my_iqama(p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if auth.uid() is null then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;
  if v_path is null then raise exception 'لا مسارَ للصورة'; end if;
  -- ولا يرفع إلا في مجلَّده هو
  if split_part(v_path, '/', 1) <> auth.uid()::text then
    raise exception 'لا تُرفَع صورةُ غيرك' using errcode = '42501';
  end if;
  insert into public.profile_private (id) values (auth.uid()) on conflict (id) do nothing;
  update public.profile_private
     set iqama_path = v_path, iqama_status = 'pending', iqama_note = null,
         iqama_by = null, iqama_at = null
   where id = auth.uid();
end $$;
grant execute on function public.set_my_iqama(text) to authenticated;

comment on function public.set_my_iqama(text) is
  'رفعُ العضو صورةَ هويته أو إعادتُها بعد ردِّها، فتعود إلى التدقيق (ملاحظة ٤٤٧)';

-- ورفعُ الإدارة عنه يعيدها إلى التدقيق كذلك، ولا تبقى موسومةً بالردّ
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_set_iqama'
   limit 1;
  if v_src is null then return; end if;
  v_new := replace(v_src,
    'update public.profile_private set iqama_path = p_path where id = p_member;',
    'update public.profile_private set iqama_path = p_path, iqama_status = ''pending'','
    || ' iqama_note = null, iqama_by = null, iqama_at = null where id = p_member;');
  if v_new = v_src then
    raise notice 'admin_set_iqama: لم يُعثر على موضع التبديل';
    return;
  end if;
  execute v_new;
  raise notice 'admin_set_iqama: رفعُ الإدارة يعيد الهويةَ إلى التدقيق';
end $do$;
