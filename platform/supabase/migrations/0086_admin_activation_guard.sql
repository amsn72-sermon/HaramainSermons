-- =====================================================================
-- 0086 — تفعيلُ التسجيلات الإدارية لمدير المشروع (ملاحظة ٢٧٠)
--
--   وُجد في حساب منسقٍ أنه يستطيع البتَّ في تسجيلٍ تقدّم صاحبُه بصفة
--   منسق. والبابُ إذا انفتح من هذه الجهة انفتح كلُّه: من يُدخل نظيرًا
--   له يستطيع أن يُدخل من يشاء.
--
--   فالقاعدةُ هنا: لا يُفعِّل أحدٌ ولا يرفع أحدًا إلى رتبةٍ مثلِ رتبته
--   أو فوقَها. والحكمُ في الخادم لا في إخفاء الزِّرّ، فالواجهةُ تُجمَّل
--   والخادمُ يَحكم.
--
--   ومعه سجلُّ الأحداث الإدارية: فما مسَّ حسابًا أو صلاحيةً لا يُترك
--   بلا أثر.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) سجلُّ الأحداث الإدارية — يُكتب بالدوال لا بيد المستخدم
-- ---------------------------------------------------------------------
create table if not exists public.admin_audit (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,          -- activate | disable | role | perm | convert | rename …
  target_id  uuid references public.profiles (id) on delete set null,
  detail     jsonb not null default '{}'::jsonb
);

create index if not exists admin_audit_at     on public.admin_audit (at desc);
create index if not exists admin_audit_target on public.admin_audit (target_id, id desc);

alter table public.admin_audit enable row level security;
drop policy if exists "read admin audit" on public.admin_audit;
create policy "read admin audit" on public.admin_audit
  for select using (public.is_manager());

comment on table public.admin_audit is 'أثرُ الأحداث الإدارية: من فعل، ومتى، وبماذا (ملاحظة ٢٧٠)';

create or replace function public.log_admin(
  p_action text, p_target uuid default null, p_detail jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit (actor_id, action, target_id, detail)
  values (auth.uid(), p_action, p_target, coalesce(p_detail, '{}'::jsonb))
$$;
revoke execute on function public.log_admin(text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- ٢) حارسُ التفعيل والترقية — يُدسُّ في نصِّ الدالة القائمة
--
--    ولا تُعاد كتابةُ الدالة كاملةً: فيها حارسُ 0047 وتعديلُ 0083،
--    وإعادةُ كتابتها تُسقطهما. فيُقرأ نصُّها الحيُّ ويُزاد فيه.
-- ---------------------------------------------------------------------
do $do$
declare v_src text; v_new text;
        v_anchor text := 'if not found then raise exception ''العضو غير موجود''; end if;';
        v_guard  text;
        v_after  text := 'where id = p_member;';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_update_member';
  if v_src is null then raise exception 'admin_update_member غير موجودة'; end if;

  if position('ملاحظة ٢٧٠' in v_src) > 0 then
    raise notice 'حارسُ ٢٧٠ مزروعٌ من قبل';
    return;
  end if;
  if position(v_anchor in v_src) = 0 then
    raise exception 'لم يُعثر على موضع الحارس في admin_update_member';
  end if;

  v_guard := v_anchor || '
  -- ملاحظة ٢٧٠: لا يُفعّل غيرُ مدير المشروع تسجيلًا تقدّم بصفةٍ إدارية
  if not public.is_manager() and p_status = ''active'' and v_target.status = ''pending''
     and exists (select 1 from public.profile_private pp
                  where pp.id = p_member and pp.applied_as = ''coordinator'') then
    raise exception ''تفعيلُ التسجيلات الإدارية لمدير المشروع'' using errcode = ''42501'';
  end if;
  -- ولا يرفع أحدٌ أحدًا إلى رتبةٍ مثلِ رتبته أو فوقَها
  if p_role is not null and not public.is_manager()
     and p_role in (''manager'', ''coordinator'', ''supervisor'', ''viewer'') then
    raise exception ''الرفعُ إلى الأدوار الإدارية لمدير المشروع'' using errcode = ''42501'';
  end if;';

  v_new := replace(v_src, v_anchor, v_guard);

  -- وأثرُ ما وقع يُكتب بعد التعديل نفسِه
  v_new := replace(v_new, v_after, v_after || '

  if p_status is not null or p_role is not null then
    perform public.log_admin(
      case when p_status = ''active''   then ''activate''
           when p_status = ''disabled'' then ''disable''
           else ''role'' end,
      p_member,
      jsonb_build_object(''status'', p_status, ''role'', p_role,
                         ''was_role'', v_target.role, ''was_status'', v_target.status));
  end if;');

  execute v_new;
end $do$;

-- ---------------------------------------------------------------------
-- ٣) مراجعةُ ما مضى (ملاحظة ٢٧٠ و)
--    حساباتٌ إداريةٌ فُعِّلت بيد غير مدير المشروع تُعرض عليه ليُقرّها،
--    ولا يُعطَّل منها شيءٌ من نفسه فينقطع عملُ أحدٍ فجأة.
-- ---------------------------------------------------------------------
create or replace function public.admin_activations_to_review()
returns table (member_id uuid, full_name text, role public.app_role,
               applied_as text, actor text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, pp.applied_as,
         coalesce(a.full_name, '—'), e.at
    from public.admin_audit e
    join public.profiles p  on p.id = e.target_id
    left join public.profiles a on a.id = e.actor_id
    left join public.profile_private pp on pp.id = p.id
   where public.is_manager()
     and e.action = 'activate'
     and coalesce(a.role, 'translator') <> 'manager'
     and (p.role in ('manager', 'coordinator', 'supervisor', 'viewer')
          or pp.applied_as = 'coordinator')
   order by e.at desc
$$;

grant execute on function public.admin_activations_to_review() to authenticated;

notify pgrst, 'reload schema';
