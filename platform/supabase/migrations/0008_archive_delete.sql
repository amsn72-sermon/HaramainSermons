-- =====================================================================
-- 0008 — حذف من أرشيف أعمال الترجمة (ملاحظة ٦٦)
--   الحذف إخفاء قابل للاسترجاع لا محو: العمل لا يضيع بضغطة.
--   بيد مدير المشروع وحده، على ترجمة واحدة أو على المادة بكل لغاتها،
--   ويُسجَّل في سجل الإجراءات باسم فاعله ووقته وسببه.
-- =====================================================================

alter table public.materials add column if not exists deleted_at timestamptz;
alter table public.materials add column if not exists deleted_by uuid references public.profiles (id);
alter table public.tracks    add column if not exists deleted_at timestamptz;
alter table public.tracks    add column if not exists deleted_by uuid references public.profiles (id);

create index if not exists materials_deleted_idx on public.materials (deleted_at);
create index if not exists tracks_deleted_idx    on public.tracks (deleted_at);

-- p_material أو p_track، وليس كليهما. p_deleted=false للاسترجاع.
create or replace function public.set_archive_deleted(
  p_material uuid default null,
  p_track    uuid default null,
  p_deleted  boolean default true,
  p_reason   text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_when   timestamptz := case when p_deleted then now() else null end;
  v_who    uuid        := case when p_deleted then auth.uid() else null end;
  v_note   text        := case when p_deleted then coalesce('حذف من الأرشيف: ' || v_reason, 'حذف من الأرشيف')
                               else 'استرجاع من المحذوفة' end;
  v_action text        := case when p_deleted then 'deleted' else 'restored' end;
  v_track  uuid;
begin
  if not public.is_manager() then
    raise exception 'الحذف من الأرشيف لمدير المشروع وحده' using errcode = '42501';
  end if;
  if (p_material is null) = (p_track is null) then
    raise exception 'حدد مادة أو ترجمة، لا كليهما';
  end if;
  if p_deleted and v_reason is null then
    raise exception 'اكتب سبب الحذف';
  end if;

  if p_material is not null then
    if not exists (select 1 from public.materials where id = p_material) then
      raise exception 'المادة غير موجودة';
    end if;
    update public.materials set deleted_at = v_when, deleted_by = v_who where id = p_material;
    update public.tracks     set deleted_at = v_when, deleted_by = v_who where material_id = p_material;
    for v_track in select id from public.tracks where material_id = p_material loop
      insert into public.track_events (track_id, actor_id, action, note)
      values (v_track, auth.uid(), v_action, v_note);
    end loop;
  else
    if not exists (select 1 from public.tracks where id = p_track) then
      raise exception 'الترجمة غير موجودة';
    end if;
    update public.tracks set deleted_at = v_when, deleted_by = v_who where id = p_track;
    insert into public.track_events (track_id, actor_id, action, note)
    values (p_track, auth.uid(), v_action, v_note);
    -- استرجاع ترجمة من مادة محذوفة يعيد المادة معها
    if not p_deleted then
      update public.materials m set deleted_at = null, deleted_by = null
      where m.id = (select material_id from public.tracks where id = p_track) and m.deleted_at is not null;
    end if;
  end if;
end $$;

grant execute on function public.set_archive_deleted(uuid, uuid, boolean, text) to authenticated;

comment on function public.set_archive_deleted(uuid, uuid, boolean, text)
  is 'إخفاء مادة أو ترجمة من الأرشيف أو استرجاعها — لمدير المشروع وحده، ويُسجَّل في سجل الإجراءات';
