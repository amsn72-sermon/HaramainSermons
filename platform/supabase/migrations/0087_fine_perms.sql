-- =====================================================================
-- 0087 — الصلاحياتُ مفصَّلةً (ملاحظات ٢٦٣ و٢٦٦ و٢٦٩)
--
--   كانت خمسةَ عشرَ مفتاحًا خشنًا: «الحسابات المصرفية» مفتاحٌ واحدٌ
--   يجمع الاطلاعَ والتدقيقَ والتحققَ والتفعيل. فمن فُتح له بابٌ فُتح له
--   البابُ كلُّه.
--
--   فصارت سبعًا وأربعين صلاحيةً في عشر وحدات، لكلٍّ أصلُها: مفتوحةٌ
--   للمنسق ابتداءً، أو مغلقةٌ لا تُنال إلا بمنحٍ من مدير المشروع.
--   والمفاتيحُ القديمةُ تبقى رؤوسًا للوحدات، فلا ينكسر شيءٌ مما بُني
--   عليها: من مُنع رأسًا مُنع ما تحته.
--
--   وثلاثُ قواعدَ تحكمها:
--     ١) لا أحدَ يمنح ما لا يملك، ولوحةُ الصلاحيات لا تُمنح أصلًا.
--     ٢) الصلاحياتُ تنزل ولا تعرُض: تُمارَس على من دون صاحبها في
--        الرتبة، لا على نظيرٍ ولا على أعلى.
--     ٣) كلُّ منحٍ ومنعٍ يُسجَّل، وله أجلٌ اختياريٌّ يسقط عنده.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) جدولُ المفاتيح يتفرّع
-- ---------------------------------------------------------------------
alter table public.perm_keys
  add column if not exists parent       text,
  add column if not exists grp          text,
  add column if not exists default_open boolean not null default true,
  add column if not exists sensitive    boolean not null default false,
  add column if not exists viewable     boolean not null default false;

comment on column public.perm_keys.parent
  is 'المفتاحُ الأعلى: من مُنع منه مُنع من فروعه (ملاحظة ٢٦٦)';
comment on column public.perm_keys.default_open
  is 'أصلُ المفتاح: مفتوحٌ للمنسق ابتداءً، أو مغلقٌ لا يُنال إلا بمنح';
comment on column public.perm_keys.sensitive
  is 'يُعلَّم في اللوحة بتنبيهٍ — ولا يُمنع، فالمديرُ يقدّر';
comment on column public.perm_keys.viewable
  is 'مفتاحُ اطّلاعٍ محضٍ، يناله حسابُ المتابعة (ملاحظة ٢٧١)';

-- رؤوسُ الوحدات: الخمسةَ عشرَ القديمة، وتُزاد وحدتان
insert into public.perm_keys (key, label, sort, grp, default_open, viewable) values
  ('contract', 'بنود العقد والمستخلص', 15, 'العقد',     false, false),
  ('certs',    'الشهادات',             16, 'الشهادات',  true,  false)
on conflict (key) do update set label = excluded.label, sort = excluded.sort;

update public.perm_keys set grp = case key
    when 'materials'      then 'المواد والإسناد'
    when 'approve'        then 'الاعتماد'
    when 'team'           then 'الأعضاء'
    when 'cards'          then 'الأعضاء'
    when 'payroll'        then 'المالية'
    when 'banks'          then 'المالية'
    when 'circulars'      then 'المراسلات'
    when 'shifts'         then 'الميدان'
    when 'evaluation'     then 'الميدان'
    when 'rooms'          then 'الميدان'
    when 'interpretation' then 'سير العمل'
    when 'glossary'       then 'الدليل المصطلحي'
    when 'reports'        then 'التقارير والتصدير'
    when 'settings'       then 'الإعدادات والنظام'
    when 'delete_member'  then 'الأعضاء'
    else grp end
 where grp is null;

-- ما سُحب من المنسق ابتداءً: المالُ والعقدُ وما لا يُستدرك
update public.perm_keys set default_open = false
 where key in ('payroll', 'banks', 'delete_member', 'contract');
update public.perm_keys set sensitive = true
 where key in ('payroll', 'banks', 'contract', 'delete_member');
update public.perm_keys set viewable = true
 where key in ('materials', 'approve', 'team', 'cards', 'circulars', 'shifts',
               'evaluation', 'interpretation', 'glossary', 'rooms', 'reports', 'certs');

-- ---------------------------------------------------------------------
-- ٢) المفاتيحُ المفردة
-- ---------------------------------------------------------------------
insert into public.perm_keys (key, label, sort, parent, grp, default_open, sensitive, viewable) values
  -- المواد والإسناد
  ('mat_add',        'إضافةُ مادة',                       101, 'materials', 'المواد والإسناد', true,  false, false),
  ('mat_edit',       'تعديلُ بيانات المادة',              102, 'materials', 'المواد والإسناد', true,  false, false),
  ('mat_assign',     'إسنادُ المادة إلى مترجم',           103, 'materials', 'المواد والإسناد', true,  false, false),
  ('mat_return',     'إعادةُ المادة للتعديل',             104, 'materials', 'المواد والإسناد', true,  false, false),
  ('mat_delete',     'حذفُ مادة',                         105, 'materials', 'المواد والإسناد', false, true,  false),
  ('mat_assign_coord','إسنادُ المادة إلى منسّقٍ آخر',      106, 'materials', 'المواد والإسناد', false, false, false),
  ('mat_transfer',   'نقلُ المادة من منسّقٍ إلى منسّق',    107, 'materials', 'المواد والإسناد', false, false, false),
  -- الاعتماد
  ('apr_translation','اعتمادُ ترجمة',                     111, 'approve',   'الاعتماد',        true,  false, false),
  ('apr_close',      'إغلاقُ مراجعة',                     112, 'approve',   'الاعتماد',        true,  false, false),
  ('apr_reopen',     'فتحُ ما أُغلق',                     113, 'approve',   'الاعتماد',        true,  false, false),
  ('apr_final',      'اعتمادٌ نهائيٌّ يمنع إعادة الفتح',  114, 'approve',   'الاعتماد',        false, true,  false),
  -- الأعضاء
  ('tm_view',        'الاطّلاعُ على بيانات الأعضاء',      121, 'team',      'الأعضاء',         true,  false, true),
  ('tm_edit',        'تعديلُ بيانات الأعضاء',             122, 'team',      'الأعضاء',         true,  false, false),
  ('tm_add',         'إضافةُ عضوٍ جديد',                  123, 'team',      'الأعضاء',         true,  false, false),
  ('tm_activate',    'تفعيلُ تسجيلٍ غيرِ إداريّ',         124, 'team',      'الأعضاء',         true,  false, false),
  ('tm_activate_admin','تفعيلُ تسجيلٍ إداريّ',            125, 'team',      'الأعضاء',         false, true,  false),
  ('tm_role',        'تغييرُ دورِ عضو',                   126, 'team',      'الأعضاء',         false, true,  false),
  ('tm_disable',     'تعطيلُ حساب',                       127, 'team',      'الأعضاء',         false, true,  false),
  ('docs_check',     'تدقيقُ المستندات',                  128, 'team',      'الأعضاء',         false, false, false),
  ('docs_verify',    'التحقّقُ من صحّة المستندات',        129, 'team',      'الأعضاء',         false, false, false),
  ('docs_approve',   'اعتمادُ المستندات',                 130, 'team',      'الأعضاء',         false, true,  false),
  -- المالية
  ('pay_view',       'الاطّلاعُ على الرواتب',             141, 'payroll',   'المالية',         false, true,  false),
  ('pay_run',        'احتسابُ الرواتب وإصدارُها',         142, 'payroll',   'المالية',         false, true,  false),
  ('pay_approve',    'اعتمادُ مسيّر الرواتب',             143, 'payroll',   'المالية',         false, true,  false),
  ('penalties',      'الجزاءاتُ والحسومات',               144, 'payroll',   'المالية',         false, true,  false),
  ('bank_view',      'الاطّلاعُ على الحسابات المصرفية',   145, 'banks',     'المالية',         false, true,  false),
  ('bank_check',     'تدقيقُ الحساب المصرفي',             146, 'banks',     'المالية',         false, true,  false),
  ('bank_verify',    'التحقّقُ من صحّة الحساب المصرفي',   147, 'banks',     'المالية',         false, true,  false),
  ('bank_activate',  'تفعيلُ الحساب المصرفي للصرف',       148, 'banks',     'المالية',         false, true,  false),
  -- العقد والمستخلص
  ('ctr_view',       'الاطّلاعُ على بنود العقد',          151, 'contract',  'العقد',           false, true,  false),
  ('ctr_qty',        'تسجيلُ الكميّات',                   152, 'contract',  'العقد',           false, true,  false),
  ('ctr_claim',      'إصدارُ المستخلص',                   153, 'contract',  'العقد',           false, true,  false),
  ('ctr_initiative', 'مبادرةُ المتعاقد',                  154, 'contract',  'العقد',           false, true,  false),
  -- الميدان
  ('sh_schedule',    'جدولُ الورديات',                    161, 'shifts',    'الميدان',         true,  false, false),
  ('sh_view',        'الاطّلاعُ على الحضور',              162, 'shifts',    'الميدان',         true,  false, true),
  ('sh_edit_punch',  'تعديلُ بصمةِ حضورٍ يدويًّا',        163, 'shifts',    'الميدان',         false, true,  false),
  ('sh_flex',        'تفعيلُ الدوام المرن لعضو',          164, 'shifts',    'الميدان',         false, true,  false),
  ('sh_sites',       'مواقعُ العمل',                      165, 'shifts',    'الميدان',         true,  false, false),
  -- الدليل المصطلحي
  ('gl_add',         'إضافةُ مصطلح',                      171, 'glossary',  'الدليل المصطلحي', true,  false, false),
  ('gl_refine',      'تنقيحُ مقابلٍ في لغته',             172, 'glossary',  'الدليل المصطلحي', true,  false, false),
  ('gl_import',      'استيرادُ المصطلحات من ملف',         173, 'glossary',  'الدليل المصطلحي', false, false, false),
  ('gl_delete',      'حذفُ مصطلح',                        174, 'glossary',  'الدليل المصطلحي', false, true,  false),
  ('gl_request',     'إنشاءُ طلبِ ترجمةٍ وتوزيعُه',       175, 'glossary',  'الدليل المصطلحي', false, false, false),
  -- الشهادات
  ('cert_draft',     'إنشاءُ مسوّدةِ شهادة',              181, 'certs',     'الشهادات',        true,  false, false),
  ('cert_issue',     'اعتمادُ الشهادة وإصدارُها',         182, 'certs',     'الشهادات',        false, true,  false),
  ('cert_revoke',    'إلغاءُ شهادةٍ صادرة',               183, 'certs',     'الشهادات',        false, true,  false),
  ('cert_design',    'تعديلُ قالبِ تصميم الشهادة',        184, 'certs',     'الشهادات',        false, false, false),
  -- التقارير والتصدير
  ('rp_stats',       'دليلُ الإنتاج',                     191, 'reports',   'التقارير والتصدير', true,  false, true),
  ('rp_archive',     'الأرشيف',                           192, 'reports',   'التقارير والتصدير', true,  false, true),
  ('rp_export',      'التصدير',                           193, 'reports',   'التقارير والتصدير', true,  false, false),
  ('rp_export_personal','تصديرٌ يتضمّن بياناتٍ شخصية',    194, 'reports',   'التقارير والتصدير', false, true,  false),
  -- المراسلات
  ('circ_read',      'قراءةُ المراسلات',                  201, 'circulars', 'المراسلات',       true,  false, true),
  ('circ_send',      'إرسالُ مراسلةٍ داخلية',             202, 'circulars', 'المراسلات',       false, false, false),
  -- الإعدادات والنظام
  ('st_languages',   'اللغات',                            211, 'settings',  'الإعدادات والنظام', false, false, false),
  ('st_khateebs',    'الخطباء',                           212, 'settings',  'الإعدادات والنظام', false, false, false),
  ('st_workflow',    'إعدادُ سير العمل',                  213, 'settings',  'الإعدادات والنظام', false, true,  false),
  ('st_audit',       'الاطّلاعُ على سجلّ الأحداث',        214, 'settings',  'الإعدادات والنظام', false, true,  false)
on conflict (key) do update set
  label = excluded.label, sort = excluded.sort, parent = excluded.parent,
  grp = excluded.grp, default_open = excluded.default_open,
  sensitive = excluded.sensitive, viewable = excluded.viewable;

alter table public.perm_keys drop constraint if exists perm_keys_parent_fkey;
alter table public.perm_keys
  add constraint perm_keys_parent_fkey foreign key (parent)
  references public.perm_keys (key) on update cascade on delete set null;

-- ---------------------------------------------------------------------
-- ٣) المنوحُ والممنوعُ لكلِّ حساب — بأجلٍ وسببٍ وأثر
-- ---------------------------------------------------------------------
create table if not exists public.member_perms (
  member_id  uuid not null references public.profiles (id) on delete cascade,
  perm_key   text not null references public.perm_keys (key) on update cascade on delete cascade,
  allowed    boolean not null,
  expires_at timestamptz,
  reason     text,
  granted_by uuid references public.profiles (id) on delete set null,
  at         timestamptz not null default now(),
  primary key (member_id, perm_key)
);

alter table public.member_perms enable row level security;
drop policy if exists "read member perms" on public.member_perms;
create policy "read member perms" on public.member_perms
  for select using (public.is_manager() or member_id = auth.uid());

comment on table public.member_perms is 'ما مُنح حسابًا أو مُنع منه زيادةً على أصل المفتاح (ملاحظة ٢٦٦)';

-- نقلُ ما كان مغلقًا في profiles.perms إلى الجدول، فلا يضيع ضبطٌ سابق
insert into public.member_perms (member_id, perm_key, allowed, reason)
select p.id, k.key, false, 'منقولٌ من الضبط السابق'
  from public.profiles p
  cross join lateral jsonb_object_keys(p.perms) as k(key)
 where exists (select 1 from public.perm_keys pk where pk.key = k.key)
   and (p.perms ->> k.key) = 'false'
on conflict (member_id, perm_key) do nothing;

-- ---------------------------------------------------------------------
-- ٤) الفصلُ في الصلاحية: الفرعُ وأصولُه جميعًا
-- ---------------------------------------------------------------------
create or replace function public.perm_allowed(p_member uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select k.key, k.parent, k.default_open from public.perm_keys k where k.key = p_key
    union all
    select k.key, k.parent, k.default_open
      from public.perm_keys k join chain c on k.key = c.parent
  )
  select coalesce(bool_and(coalesce(
           (select mp.allowed from public.member_perms mp
             where mp.member_id = p_member and mp.perm_key = c.key
               and (mp.expires_at is null or mp.expires_at > now())),
           c.default_open)), true)
    from chain c
$$;
grant execute on function public.perm_allowed(uuid, text) to authenticated;

-- has_perm تُعاد كتابتُها على الجدول الجديد. ومدير المشروع يملكها كلها.
create or replace function public.has_perm(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select case when public.is_manager() then true
              else public.perm_allowed(auth.uid(), p_key) end
$$;

-- ---------------------------------------------------------------------
-- ٥) الصلاحياتُ تنزل ولا تعرُض (ملاحظة ٢٦٦ ح)
-- ---------------------------------------------------------------------
create or replace function public.role_rank(p_role public.app_role)
returns int language sql immutable set search_path = public as $$
  select case p_role
           when 'manager'     then 4
           when 'coordinator' then 3
           when 'supervisor'  then 3
           when 'viewer'      then 3
           when 'field_lead'  then 2
           else 1 end
$$;
grant execute on function public.role_rank(public.app_role) to authenticated;

create or replace function public.may_act_on(p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.is_manager() then true
    when p_target = auth.uid() then true
    else coalesce(
      public.role_rank((select role from public.profiles where id = p_target))
        < public.role_rank(public.my_role()), false)
  end
$$;
grant execute on function public.may_act_on(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) المنحُ والمنع — لمدير المشروع وحدَه
--    واللوحةُ نفسُها (st_perms) لا تُمنح، فلا يصير الممنوحُ مانحًا.
-- ---------------------------------------------------------------------
create or replace function public.set_member_perm(
  p_member uuid, p_key text, p_allowed boolean,
  p_until timestamptz default null, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_role public.app_role;
begin
  if not public.is_manager() then
    raise exception 'منحُ الصلاحيات ومنعُها بيد مدير المشروع' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_member;
  if v_role is null then raise exception 'العضو غير موجود'; end if;
  if v_role not in ('coordinator', 'supervisor', 'field_lead', 'viewer') then
    raise exception 'قائمة الصلاحيات للمنسقين ومديري المشروع من الهيئة';
  end if;
  if not exists (select 1 from public.perm_keys where key = p_key) then
    raise exception 'صلاحية غير معروفة: %', p_key;
  end if;
  if p_member = auth.uid() then
    raise exception 'لا تُغيّر صلاحيات حسابك';
  end if;

  if p_allowed is null then
    delete from public.member_perms where member_id = p_member and perm_key = p_key;
  else
    insert into public.member_perms (member_id, perm_key, allowed, expires_at, reason, granted_by)
    values (p_member, p_key, p_allowed, p_until, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
    on conflict (member_id, perm_key) do update
      set allowed = excluded.allowed, expires_at = excluded.expires_at,
          reason = excluded.reason, granted_by = excluded.granted_by, at = now();
  end if;

  -- المنحُ يفتح ما فوقَه من رؤوس، وإلا بقي الفرعُ ممنوعًا بأصله ولم
  -- يُدرِ المانحُ لمَ لم ينفذ منحُه
  if p_allowed then
    insert into public.member_perms (member_id, perm_key, allowed, expires_at, reason, granted_by)
    select p_member, c.key, true, p_until, 'فُتح لأجل ' || p_key, auth.uid()
      from (with recursive up as (
              select k.key, k.parent from public.perm_keys k where k.key = p_key
              union all
              select k.key, k.parent from public.perm_keys k join up u on k.key = u.parent)
            select key from up where key <> p_key) c
    on conflict (member_id, perm_key) do update
      set allowed = true, expires_at = excluded.expires_at, granted_by = excluded.granted_by, at = now();
  end if;

  perform public.log_admin('perm', p_member,
    jsonb_build_object('key', p_key, 'allowed', p_allowed,
                       'until', p_until, 'reason', p_reason));
end $$;
grant execute on function public.set_member_perm(uuid, text, boolean, timestamptz, text) to authenticated;

-- الدالةُ القديمةُ تبقى عاملةً، وتكتب في الجدول الجديد
create or replace function public.set_member_perms(p_member uuid, p_perms jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_role public.app_role; v_k text;
begin
  if not public.is_manager() then
    raise exception 'ضبط الصلاحيات لمدير المشروع' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_member;
  if v_role is null then raise exception 'العضو غير موجود'; end if;

  -- ضبطٌ شاملٌ كما كانت: ما لم يُذكر يعود إلى أصله
  for v_k in select jsonb_object_keys(coalesce(p_perms, '{}'::jsonb)) loop
    if not exists (select 1 from public.perm_keys k where k.key = v_k) then
      raise exception 'صلاحية غير معروفة: %', v_k;
    end if;
  end loop;
  delete from public.member_perms
   where member_id = p_member
     and perm_key not in (select jsonb_object_keys(coalesce(p_perms, '{}'::jsonb)));
  for v_k in select jsonb_object_keys(coalesce(p_perms, '{}'::jsonb)) loop
    perform public.set_member_perm(p_member, v_k, (p_perms ->> v_k)::boolean, null, null);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- ٧) ما يعرضه الحسابُ لنفسه، وما تعرضه اللوحة للمدير
-- ---------------------------------------------------------------------
create or replace function public.my_perms()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(k.key,
           case when public.is_manager() then true
                else public.perm_allowed(auth.uid(), k.key) end), '{}'::jsonb)
    from public.perm_keys k
$$;
grant execute on function public.my_perms() to authenticated;

create or replace function public.member_perm_sheet(p_member uuid)
returns table (key text, label text, grp text, parent text, sort int,
               default_open boolean, sensitive boolean,
               setting boolean, expires_at timestamptz, reason text,
               effective boolean)
language sql stable security definer set search_path = public as $$
  select k.key, k.label, k.grp, k.parent, k.sort, k.default_open, k.sensitive,
         mp.allowed, mp.expires_at, mp.reason,
         public.perm_allowed(p_member, k.key)
    from public.perm_keys k
    left join public.member_perms mp
           on mp.member_id = p_member and mp.perm_key = k.key
           and (mp.expires_at is null or mp.expires_at > now())
   where public.is_manager()
   order by k.sort, k.key
$$;
grant execute on function public.member_perm_sheet(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٨) إسنادُ المادة ونقلُها (ملاحظة ٢٦٩)
--    من أنشأ تَبِع: المنسقُ المسؤولُ عن المادة هو مُنشئُها، ولا يختار
--    غيرَه إلا مديرُ المشروع أو من مُنح مفتاحَ الإسناد.
-- ---------------------------------------------------------------------
alter table public.materials
  add column if not exists coordinator_id uuid references public.profiles (id) on delete set null;

comment on column public.materials.coordinator_id
  is 'المنسقُ المسؤولُ عن المادة — مُنشئُها ما لم ينقلها المدير (ملاحظة ٢٦٩)';

update public.materials set coordinator_id = created_by where coordinator_id is null;

create or replace function public.set_material_coordinator(
  p_material uuid, p_coordinator uuid, p_why text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_old uuid; v_role public.app_role;
begin
  select coordinator_id into v_old from public.materials where id = p_material;
  if not found then raise exception 'المادة غير موجودة'; end if;

  if not (public.is_manager() or public.has_perm('mat_transfer')) then
    raise exception 'نقلُ المواد بين المنسقين لمدير المشروع' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_coordinator;
  if v_role is null or v_role not in ('manager', 'coordinator') then
    raise exception 'المسؤولُ عن المادة منسّقٌ أو مديرُ المشروع';
  end if;

  update public.materials set coordinator_id = p_coordinator where id = p_material;
  perform public.log_admin('material_transfer', p_coordinator,
    jsonb_build_object('material', p_material, 'from', v_old, 'why', p_why));
end $$;
grant execute on function public.set_material_coordinator(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
