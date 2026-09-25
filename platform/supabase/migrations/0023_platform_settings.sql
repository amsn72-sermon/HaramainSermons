-- =====================================================================
-- 0023 — إعدادات المنصة: إلزام التحقق بخطوتين على حسابات الإدارة (ملاحظة ١٠٣)
--   مدير المشروع والمنسقون لا يدخلون بكلمة المرور وحدها، بل برمز من
--   تطبيق المصادقة على أجهزتهم. والإلزام مفتاح بيد مدير المشروع.
-- =====================================================================

create table if not exists public.platform_settings (
  id          boolean primary key default true check (id),
  mfa_required_admins boolean not null default true,
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now()
);

insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

comment on table public.platform_settings
  is 'إعدادات عامة للمنصة — صفّ واحد لا غير (ملاحظة ١٠٣)';

alter table public.platform_settings enable row level security;

drop policy if exists "settings read" on public.platform_settings;
create policy "settings read" on public.platform_settings
  for select using (auth.uid() is not null);

create or replace function public.set_mfa_required(p_required boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'تغيير إعدادات الحماية لمدير المشروع وحده' using errcode = '42501';
  end if;
  update public.platform_settings
     set mfa_required_admins = coalesce(p_required, true),
         updated_by = auth.uid(), updated_at = now()
   where id;
end $$;

grant execute on function public.set_mfa_required(boolean) to authenticated;
