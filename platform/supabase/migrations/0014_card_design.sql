-- =====================================================================
-- 0014 — تصميم بطاقة العمل (ملاحظة ٨٦)
--   مواضع العناصر ومقاساتها تُحفظ كما يرسمها المدير: الشعار والصورة
--   والاسم واللغات وحجم الخط ولونه — بلا تعديل في الشيفرة.
-- =====================================================================

alter table public.card_settings add column if not exists layout    jsonb;
alter table public.card_settings add column if not exists logo_path text;
alter table public.card_settings add column if not exists logo_kind text not null default 'haramain';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'card_settings_logo_kind_check') then
    alter table public.card_settings add constraint card_settings_logo_kind_check
      check (logo_kind in ('haramain', 'custom', 'none'));
  end if;
end $$;

comment on column public.card_settings.layout
  is 'تصميم البطاقة: مواضع العناصر بالمليمتر وأحجام الخطوط بالنقطة (ملاحظة ٨٦)';
comment on column public.card_settings.logo_path
  is 'شعار مرفوع يحل محل شعار الحرمين على البطاقة';

-- الدالة القديمة تُستبدل بأخرى تحمل التصميم والشعار
drop function if exists public.save_card_settings(text, text, text, text, date);

create or replace function public.save_card_settings(
  p_title          text,
  p_subtitle       text default null,
  p_official_name  text default null,
  p_official_title text default null,
  p_valid_until    date default null,
  p_layout         jsonb default null,
  p_logo_kind      text default null,
  p_logo_path      text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_kind text;
begin
  if not public.is_admin() then raise exception 'إعداد البطاقة للمنسق ومدير المشروع' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'اكتب عنوان البطاقة'; end if;
  if p_layout is not null and jsonb_typeof(p_layout) <> 'object' then
    raise exception 'تصميم البطاقة غير صالح';
  end if;

  v_kind := nullif(trim(coalesce(p_logo_kind, '')), '');
  if v_kind is not null and v_kind not in ('haramain', 'custom', 'none') then v_kind := null; end if;

  insert into public.card_settings (id) values (true) on conflict (id) do nothing;
  update public.card_settings set
    title          = trim(p_title),
    subtitle       = nullif(trim(coalesce(p_subtitle, '')), ''),
    official_name  = nullif(trim(coalesce(p_official_name, '')), ''),
    official_title = nullif(trim(coalesce(p_official_title, '')), ''),
    valid_until    = p_valid_until,
    layout         = coalesce(p_layout, layout),
    logo_kind      = coalesce(v_kind, logo_kind),
    logo_path      = case when v_kind = 'custom' then coalesce(nullif(trim(coalesce(p_logo_path, '')), ''), logo_path)
                          when v_kind = 'none' then null
                          else logo_path end,
    updated_at     = now(),
    updated_by     = auth.uid()
  where id;
end $$;

grant execute on function public.save_card_settings(text, text, text, text, date, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- حاوية شعارات البطاقة: ترفعها الإدارة، ويقرؤها كل من يطبع بطاقة
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('brand', 'brand', false)
on conflict (id) do nothing;

drop policy if exists "brand read" on storage.objects;
create policy "brand read" on storage.objects for select
  using (bucket_id = 'brand' and auth.uid() is not null);

drop policy if exists "brand write" on storage.objects;
create policy "brand write" on storage.objects for insert
  with check (bucket_id = 'brand' and public.is_admin());
