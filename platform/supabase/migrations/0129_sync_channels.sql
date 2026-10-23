-- =====================================================================
-- ٠١٢٩ — قنواتُ مزامنة البثّ (ملاحظة ٤٦٧)
--
--   خطبةُ الجمعة تُبثُّ على ثلاث قنواتٍ لقيود يوتيوب في عدد البثوث
--   المتزامنة (١٠ + ١٠ + ٦ = ستٌّ وعشرون)، ثمَّ تُجمَع قوائمُها في
--   القناة الرئيسية بيد المسؤول. فإذا نُسي الجمعُ لم يُعرَض من اللغات
--   إلا ما كان على الرئيسية. فصارت المزامنةُ تقرأ القنوات الثلاث
--   مباشرةً، وقائمتُها هنا تُدار من المنصة بلا تعديلٍ في الشفرة.
--
--   والترتيبُ (sort) هو ترتيبُ الترجيح عند التعارض: إذا بُثَّت لغةٌ
--   واحدةٌ على قناتين أُخذ مقطعُ الأعلى رتبةً وحُفظ الآخرُ بديلًا.
-- =====================================================================
create table if not exists public.sync_channels (
  channel_id text primary key
    check (channel_id ~ '^UC[A-Za-z0-9_-]{22}$'),
  name       text not null,
  source     text,
  sort       int  not null default 100,
  is_active  boolean not null default true,
  note       text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

comment on table public.sync_channels is
  'قنواتُ يوتيوب التي تُقرأ منها الخطب، بترتيب ترجيحها (ملاحظة ٤٦٧)';

alter table public.sync_channels enable row level security;
drop policy if exists "read sync channels" on public.sync_channels;
create policy "read sync channels" on public.sync_channels for select using (true);
grant select on public.sync_channels to anon, authenticated;

insert into public.sync_channels (channel_id, name, source, sort, note) values
  ('UCB0qibtjzOIemPjQSaoWkGg', 'القناة الرئيسية',
   'https://www.youtube.com/@Al-haramain-Sermons', 10, 'أصلُ البثّ والترجيح'),
  ('UC5rhniBqrWnRj18iD4EO9uQ', 'القناة الثانية',
   'https://www.youtube.com/channel/UC5rhniBqrWnRj18iD4EO9uQ', 20, null),
  ('UCi2WjWXhNrzuDJ53CbpebtA', 'القناة الثالثة',
   'https://www.youtube.com/channel/UCi2WjWXhNrzuDJ53CbpebtA', 30, null)
on conflict (channel_id) do nothing;

-- ـــ القراءةُ: تقرؤها المزامنةُ بلا حساب، فليس فيها إلا أسماءُ قنواتٍ
--   علنيّةٍ أصلًا (ملاحظة ٤٦٧)
create or replace function public.sync_channels()
returns table (channel_id text, name text, source text, sort int)
language sql stable security definer set search_path = public as $$
  select c.channel_id, c.name, c.source, c.sort
    from public.sync_channels c
   where c.is_active
   order by c.sort, c.name
$$;
grant execute on function public.sync_channels() to anon, authenticated;

comment on function public.sync_channels() is
  'قنواتُ المزامنة العاملةُ بترتيب ترجيحها — تُقرأ بلا حساب (ملاحظة ٤٦٧)';

-- ـــ الإدارةُ: لمدير المشروع وحدَه، فالمصدرُ أصلُ ما يُعرَض للناس
create or replace function public.set_sync_channel(
  p_channel text, p_name text, p_source text default null,
  p_sort int default null, p_active boolean default true, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_sort int;
begin
  if not public.is_manager() then
    raise exception 'قنواتُ المزامنة بيد مدير المشروع' using errcode = '42501';
  end if;
  if p_channel !~ '^UC[A-Za-z0-9_-]{22}$' then
    raise exception 'معرّفُ القناة يبدأ بـ UC ويتبعه اثنان وعشرون حرفًا';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'اكتبْ اسمَ القناة';
  end if;
  select coalesce(p_sort, coalesce(max(sort), 0) + 10) into v_sort from public.sync_channels;
  insert into public.sync_channels (channel_id, name, source, sort, is_active, note, updated_by)
  values (p_channel, btrim(p_name),
          nullif(btrim(coalesce(p_source, '')), ''),
          v_sort, coalesce(p_active, true),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  on conflict (channel_id) do update
    set name = excluded.name,
        source = coalesce(excluded.source, public.sync_channels.source),
        sort = coalesce(p_sort, public.sync_channels.sort),
        is_active = coalesce(p_active, public.sync_channels.is_active),
        note = excluded.note, updated_by = auth.uid(), updated_at = now();
end $$;
grant execute on function public.set_sync_channel(text, text, text, int, boolean, text)
  to authenticated;

create or replace function public.delete_sync_channel(p_channel text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then
    raise exception 'قنواتُ المزامنة بيد مدير المشروع' using errcode = '42501';
  end if;
  if (select count(*) from public.sync_channels where is_active) <= 1
     and exists (select 1 from public.sync_channels
                  where channel_id = p_channel and is_active) then
    raise exception 'لا تُحذَف القناةُ الأخيرة، فلا مصدرَ للبثّ بعدها';
  end if;
  delete from public.sync_channels where channel_id = p_channel;
end $$;
grant execute on function public.delete_sync_channel(text) to authenticated;

-- وللإدارة قائمةٌ كاملةٌ فيها المعطَّلُ كذلك
create or replace function public.sync_channels_all()
returns table (channel_id text, name text, source text, sort int, is_active boolean,
               note text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.channel_id, c.name, c.source, c.sort, c.is_active, c.note, c.updated_at
    from public.sync_channels c
   where public.is_admin()
   order by c.sort, c.name
$$;
grant execute on function public.sync_channels_all() to authenticated;
