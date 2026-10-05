-- =====================================================================
-- 0088 — حسابُ المتابعة بمسمّاه الوظيفي (ملاحظة ٢٧١)
--
--   في الهيئة من يَحسُن اطّلاعُه على المنصة ولا شأنَ له بالعمل فيها:
--   مديرُ إدارة اللغات، ووكيلُ الرئيس، ومن في معناهم. فلهم حسابٌ يرى
--   ما يراه المنسق ولا يملك فعلًا، ولا يظهر في صفحة التسجيل أصلًا:
--   يُنشئه مديرُ المشروع، ويكتب له مسمّاه الوظيفي، فيُعرَض به إكرامًا
--   لمقامه لا بكلمة «متابع».
--
--   ولا يُكتب في شيءٍ من الشاشة «اطّلاعٌ فقط»، بل «للمتابعة».
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) المسمّى الوظيفيُّ الحر، والأجل
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists job_title  text,
  add column if not exists expires_at timestamptz;

comment on column public.profiles.job_title is
  'المسمّى الوظيفيُّ الحرُّ لحساب المتابعة — يظهر مكان الدور (ملاحظة ٢٧١ ح)';
comment on column public.profiles.expires_at is
  'أجلُ الحساب: ينتهي بنفسه فلا يُنسى مفتوحًا (ملاحظة ٢٧١ هـ)';

create or replace function public.is_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'viewer', false)
$$;
grant execute on function public.is_viewer() to anon, authenticated;

-- الحسابُ المنتهي أجلُه ليس عاملًا: my_role تُسقطه فتسقط صلاحياتُه كلُّها
create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles
   where id = auth.uid() and status = 'active'
     and (expires_at is null or expires_at > now())
$$;

-- ---------------------------------------------------------------------
-- ٢) المتابعُ يرى ولا يفعل
--
--    is_admin() يفتح أبوابَ الإدارة، والمتابعُ لا يدخل منها. وإنما
--    يُلحَق بما يُلحَق به مديرُ المشروع من الهيئة: اطّلاعٌ بلا كتابة.
--    ومفاتيحُ الاطّلاع وحدَها هي التي تُفتح له (perm_keys.viewable).
-- ---------------------------------------------------------------------
create or replace function public.perm_allowed(p_member uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select k.key, k.parent, k.default_open, k.viewable
      from public.perm_keys k where k.key = p_key
    union all
    select k.key, k.parent, k.default_open, k.viewable
      from public.perm_keys k join chain c on k.key = c.parent
  )
  select case
    -- حسابُ المتابعة: مفاتيحُ الاطّلاع وحدَها، وله أن يُضيَّق عليه فيها
    when (select role from public.profiles where id = p_member) = 'viewer'
      then coalesce((select bool_and(c.viewable) from chain c), false)
       and coalesce((select bool_and(coalesce(
             (select mp.allowed from public.member_perms mp
               where mp.member_id = p_member and mp.perm_key = c.key
                 and (mp.expires_at is null or mp.expires_at > now())), true))
             from chain c), true)
    else coalesce((select bool_and(coalesce(
           (select mp.allowed from public.member_perms mp
             where mp.member_id = p_member and mp.perm_key = c.key
               and (mp.expires_at is null or mp.expires_at > now())),
           c.default_open)) from chain c), true)
  end
$$;

-- المتابعُ يُلحَق بمدير المشروع من الهيئة حيثما ذُكر: يُمنع حيث مُنع
-- من الكتابة، ويُؤذن له حيث أُذن له بالاطّلاع. وتُعاد كتابةُ الدوال
-- مرةً واحدةً كما فعل 0047، فلا تُلاحَق واحدةً واحدة.
do $do$
declare r record; v_src text; v_new text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname not in ('is_supervisor', 'is_viewer', 'can_view_reports',
                             'my_role', 'is_admin', 'is_manager', 'perm_allowed')
       and pg_get_functiondef(p.oid) like '%public.is_supervisor()%'
  loop
    v_src := pg_get_functiondef(r.oid);
    continue when position('public.is_viewer()' in v_src) > 0;
    v_new := replace(v_src, 'public.is_supervisor()',
                            '(public.is_supervisor() or public.is_viewer())');
    begin
      execute v_new;
    exception when others then
      raise notice 'تعذّر إلحاقُ المتابع بـ %: %', r.proname, sqlerrm;
    end;
  end loop;
end $do$;

create or replace function public.can_view_reports()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_supervisor() or public.is_viewer()
$$;

-- ---------------------------------------------------------------------
-- ٣) إنشاءُ حساب متابعة، وتحويلُ تسجيلٍ قائمٍ إليه (ملاحظة ٢٧١ م)
-- ---------------------------------------------------------------------
create or replace function public.set_job_title(p_member uuid, p_title text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.is_manager() then
    raise exception 'المسمّى الوظيفيُّ بيد مدير المشروع' using errcode = '42501';
  end if;
  select job_title into v_old from public.profiles where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  update public.profiles
     set job_title = nullif(btrim(coalesce(p_title, '')), '')
   where id = p_member;
  perform public.log_admin('job_title', p_member,
    jsonb_build_object('from', v_old, 'to', p_title));
end $$;
grant execute on function public.set_job_title(uuid, text) to authenticated;

create or replace function public.set_member_expiry(p_member uuid, p_until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'أجلُ الحساب بيد مدير المشروع' using errcode = '42501';
  end if;
  if p_member = auth.uid() then raise exception 'لا تضع أجلًا لحسابك'; end if;
  update public.profiles set expires_at = p_until where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  perform public.log_admin('expiry', p_member, jsonb_build_object('until', p_until));
end $$;
grant execute on function public.set_member_expiry(uuid, timestamptz) to authenticated;

-- تحويلُ تسجيلٍ منتظِرٍ إلى حساب متابعة: يسقط عنه ما سجّل به، ويبقى
-- بريدُه ودخولُه كما هما، فلا يُكلَّف تسجيلًا جديدًا ولا يُشعَر بردّ
create or replace function public.convert_to_viewer(
  p_member uuid, p_title text, p_full_name text default null,
  p_until timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_was public.app_role; v_status public.member_status;
begin
  if not public.is_manager() then
    raise exception 'حساباتُ المتابعة بيد مدير المشروع' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'اكتب المسمّى الوظيفي';
  end if;
  select role, status into v_was, v_status from public.profiles where id = p_member;
  if not found then raise exception 'العضو غير موجود'; end if;
  if p_member = auth.uid() then raise exception 'لا تحوّل حسابك'; end if;

  update public.profiles set
    role       = 'viewer',
    status     = 'active',
    job_title  = btrim(p_title),
    expires_at = p_until,
    full_name  = coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), full_name)
  where id = p_member;

  -- ما سجّل به يسقط: لا لغاتِ إسنادٍ ولا صفةَ تقدُّم
  delete from public.member_languages where member_id = p_member;
  update public.profile_private set applied_as = null where id = p_member;

  perform public.log_admin('convert', p_member,
    jsonb_build_object('was_role', v_was, 'was_status', v_status, 'title', p_title));
end $$;
grant execute on function public.convert_to_viewer(uuid, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) أثرُ الاطّلاع (ملاحظة ٢٧١ و)
--    المتابعُ يرى البيانات، ويَحسُن أن يُعلم من رآها.
-- ---------------------------------------------------------------------
create or replace function public.log_view(p_page text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_viewer() or public.is_supervisor()) then return; end if;
  -- سطرٌ واحدٌ لكلِّ صفحةٍ في الساعة، فلا ينتفخ السجلُّ بلا فائدة
  if exists (select 1 from public.admin_audit
              where actor_id = auth.uid() and action = 'view'
                and detail ->> 'page' = p_page and at > now() - interval '1 hour') then
    return;
  end if;
  perform public.log_admin('view', null, jsonb_build_object('page', p_page));
end $$;
grant execute on function public.log_view(text) to authenticated;

-- ---------------------------------------------------------------------
-- ٥) حساباتُ المتابعة في قائمةٍ لمدير المشروع (ملاحظة ٢٧١ ك)
-- ---------------------------------------------------------------------
create or replace function public.viewer_accounts()
returns table (id uuid, full_name text, email text, job_title text,
               status public.member_status, expires_at timestamptz,
               last_seen timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.job_title, p.status, p.expires_at,
         (select max(a.at) from public.admin_audit a where a.actor_id = p.id)
    from public.profiles p
   where public.is_manager() and p.role = 'viewer'
   order by p.full_name
$$;
grant execute on function public.viewer_accounts() to authenticated;

notify pgrst, 'reload schema';
