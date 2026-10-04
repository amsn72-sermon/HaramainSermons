-- =====================================================================
-- 0075 — المستودعُ بأنواعه ورفعُه الجماعي (ملاحظة ٢٢٦)
--
--   يُفتح المستودعُ على أيقوناتٍ لكل نوع: الخطبُ والدروسُ والتوجيهاتُ
--   والكتبُ… وأخيرًا «الجميع». وفي كل نوعٍ رفعٌ جماعيٌّ لملفات PDF وWord:
--   تُرفع الملفاتُ أولًا إلى حاويةٍ خاصة، ثم تُقرأ أسماؤها فيُستنبط منها
--   النوعُ واللغةُ والتاريخُ والمسجدُ والعنوان، ثم يُعرض ذلك كلُّه جدولَ
--   مراجعةٍ يُصحَّح فيه ما أخطأ الاستنباطُ، ولا يُكتب في المستودع شيءٌ
--   حتى يُعتمد. ويبقى الرفعُ الفرديُّ بملفٍ وبيانات.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) حاويةُ ملفات المستودع
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('repo', 'repo', false)
on conflict (id) do nothing;

drop policy if exists "staff read repo files" on storage.objects;
create policy "staff read repo files" on storage.objects for select
  using (bucket_id = 'repo' and public.my_role() is not null);

drop policy if exists "admin uploads repo files" on storage.objects;
create policy "admin uploads repo files" on storage.objects for insert
  with check (bucket_id = 'repo' and public.is_admin());

-- ---------------------------------------------------------------------
-- ٢) صفُّ الانتظار: ما رُفع ولم يُعتمد بعد
-- ---------------------------------------------------------------------
create table if not exists public.repo_uploads (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid references public.repo_batches (id) on delete cascade,
  file_name     text not null,
  file_path     text not null,
  size_bytes    bigint,
  material_type text,
  sermon_type   text,
  mosque        text check (mosque is null or mosque in ('makkah', 'madinah')),
  work_date     date,
  language_code text,
  is_source     boolean not null default false,
  title         text,
  work_key      text,            -- ما اتّفق مفتاحُه اجتمع في عملٍ واحد
  status        text not null default 'pending'
                check (status in ('pending', 'committed', 'skipped')),
  work_id       uuid references public.repo_works (id) on delete set null,
  note          text,
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);
create index if not exists repo_uploads_batch_idx  on public.repo_uploads (batch_id);
create index if not exists repo_uploads_status_idx on public.repo_uploads (status);

alter table public.repo_uploads enable row level security;
drop policy if exists "admin reads repo uploads" on public.repo_uploads;
create policy "admin reads repo uploads" on public.repo_uploads
  for select using (public.is_admin());
grant select on public.repo_uploads to authenticated;

comment on table public.repo_uploads is
  'ملفاتٌ رُفعت إلى المستودع تنتظر المراجعةَ والاعتماد (ملاحظة ٢٢٦)';

-- ---------------------------------------------------------------------
-- ٣) استنباطُ البيانات من اسم الملف
--    اجتهادٌ يُعين، لا حكمٌ يُعتمد: يُصحَّح في جدول المراجعة
-- ---------------------------------------------------------------------
create or replace function public.repo_guess(p_name text)
returns jsonb language plpgsql stable set search_path = public as $$
declare n text := coalesce(p_name, '');
        base text;
        v_lang text; v_mat text; v_ser text; v_mos text;
        v_date date; v_title text; m text[];
begin
  -- يُنزع الامتدادُ وتُسوّى الفواصل
  base := regexp_replace(n, '\.(pdf|docx?|rtf|txt)$', '', 'i');
  base := replace(replace(replace(base, '_', ' '), '-', ' '), '.', ' ');
  base := btrim(regexp_replace(base, '\s+', ' ', 'g'));

  -- اللغة
  v_lang := case
    when n ~* '(english|_en_|[ -]en[ -]|الإنجليزي|الانجليزي|الإنجليزية)' then 'en'
    when n ~* '(urdu|الأردية|الاردية|اردو)'                              then 'ur'
    when n ~* '(fran[cç]ais|french|الفرنسي)'                            then 'fr'
    when n ~* '(persian|farsi|الفارسي|فارسی)'                           then 'fa'
    when n ~* '(melayu|malay|الملايو)'                                  then 'ms'
    when n ~* '(indonesia|الإندونيسي|الاندونيسي)'                       then 'id'
    when n ~* '(russian|русск|الروسي)'                                  then 'ru'
    when n ~* '(turk|türk|التركي)'                                      then 'tr'
    when n ~* '(chinese|中文|الصيني)'                                   then 'zh'
    when n ~* '(bangla|bengali|البنغالي)'                               then 'bn'
    when n ~* '(hausa|الهوسا)'                                          then 'ha'
    when n ~* '(spanish|espa[nñ]ol|الإسباني|الاسباني)'                  then 'es'
    when n ~* '(portug|البرتغالي)'                                      then 'pt'
    when base ~ '[ء-ي]'                                                 then 'ar'
    else null end;

  -- نوعُ المادة
  v_mat := case
    when n ~ '(خطبة|خطب|jumu|khutb)'        then 'خطب'
    when n ~ '(درس|دروس|lesson|lecture)'    then 'دروس علمية'
    when n ~ '(توجيه|توجيهات|guidance)'     then 'توجيهات'
    when n ~ '(كتاب|كتب|book)'              then 'كتب'
    when n ~ '(مطوية|مطويات)'               then 'مطويات'
    when n ~ '(إعلان|اعلان|إعلانات)'        then 'إعلانات'
    when n ~ '(منشور|منشورات)'              then 'منشورات'
    else null end;

  -- نوعُ الخطبة
  v_ser := case
    when v_mat is distinct from 'خطب'                then null
    when n ~ '(عرفة|arafa)'                          then 'خطبة عرفة'
    when n ~ '(الأضحى|الاضحى|adha)'                  then 'خطبة عيد الأضحى'
    when n ~ '(الفطر|fitr)'                          then 'خطبة عيد الفطر'
    when n ~ '(استسقاء|istisqa)'                     then 'خطبة استسقاء'
    when n ~ '(كسوف|kusuf)'                          then 'خطبة كسوف'
    when n ~ '(خسوف|khusuf)'                         then 'خطبة خسوف'
    when n ~ '(جمعة|jumu)'                           then 'خطبة جمعة'
    else 'خطبة جمعة' end;

  -- المسجد
  v_mos := case
    when n ~* '(النبوي|المدينة|madin|nabaw)'     then 'madinah'
    when n ~* '(المكي|مكة|makk|mecca|haram)'     then 'makkah'
    else null end;

  -- التاريخ: ميلاديٌّ بأربعة أرقامٍ للسنة، بأيِّ فاصل
  m := regexp_match(n, '(19|20)([0-9]{2})[^0-9]?([0-1][0-9])[^0-9]?([0-3][0-9])');
  if m is not null then
    begin v_date := make_date((m[1] || m[2])::int, m[3]::int, m[4]::int); exception when others then v_date := null; end;
  end if;
  if v_date is null then
    m := regexp_match(n, '([0-3][0-9])[^0-9]?([0-1][0-9])[^0-9]?(19|20)([0-9]{2})');
    if m is not null then
      begin v_date := make_date((m[3] || m[4])::int, m[2]::int, m[1]::int); exception when others then v_date := null; end;
    end if;
  end if;

  -- العنوان: ما بقي بعد نزع ما عُرف
  v_title := base;
  v_title := regexp_replace(v_title, '(19|20)[0-9]{2}[^0-9]?[0-1][0-9][^0-9]?[0-3][0-9]', '', 'g');
  v_title := regexp_replace(v_title, '[0-3][0-9][^0-9]?[0-1][0-9][^0-9]?(19|20)[0-9]{2}', '', 'g');
  v_title := btrim(regexp_replace(v_title, '\s+', ' ', 'g'));
  if v_title = '' then v_title := base; end if;

  return jsonb_build_object(
    'language_code', v_lang,
    'is_source',     coalesce(v_lang, '') = 'ar',
    'material_type', v_mat,
    'sermon_type',   v_ser,
    'mosque',        v_mos,
    'work_date',     v_date,
    'title',         v_title,
    'work_key',      lower(btrim(coalesce(v_title, '') || '|' || coalesce(v_date::text, ''))));
end $$;
grant execute on function public.repo_guess(text) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) تسجيلُ ملفٍ مرفوعٍ في صفِّ الانتظار
-- ---------------------------------------------------------------------
create or replace function public.stage_repo_upload(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_g jsonb;
        v_name text := nullif(trim(coalesce(p ->> 'file_name', '')), '');
        v_path text := nullif(trim(coalesce(p ->> 'file_path', '')), '');
begin
  if not public.is_admin() then
    raise exception 'رفعُ المستودع للإدارة' using errcode = '42501';
  end if;
  if v_name is null or v_path is null then raise exception 'الملف ناقصُ البيانات'; end if;

  v_g := public.repo_guess(v_name);

  insert into public.repo_uploads (batch_id, file_name, file_path, size_bytes,
         material_type, sermon_type, mosque, work_date, language_code, is_source,
         title, work_key, created_by)
  values (nullif(p ->> 'batch_id', '')::uuid, v_name, v_path,
          nullif(p ->> 'size_bytes', '')::bigint,
          coalesce(nullif(trim(coalesce(p ->> 'material_type', '')), ''), v_g ->> 'material_type'),
          coalesce(nullif(trim(coalesce(p ->> 'sermon_type', '')), ''),   v_g ->> 'sermon_type'),
          coalesce(nullif(trim(coalesce(p ->> 'mosque', '')), ''),        v_g ->> 'mosque'),
          coalesce(nullif(p ->> 'work_date', '')::date,       nullif(v_g ->> 'work_date', '')::date),
          coalesce(nullif(trim(coalesce(p ->> 'language_code', '')), ''), v_g ->> 'language_code'),
          coalesce((p ->> 'is_source')::boolean, (v_g ->> 'is_source')::boolean, false),
          coalesce(nullif(trim(coalesce(p ->> 'title', '')), ''),         v_g ->> 'title'),
          v_g ->> 'work_key', auth.uid())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.stage_repo_upload(jsonb) to authenticated;

-- تصحيحُ صفٍّ في جدول المراجعة
create or replace function public.save_repo_upload(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if not public.is_admin() then
    raise exception 'مراجعةُ المستودع للإدارة' using errcode = '42501';
  end if;
  if v_id is null then raise exception 'حدّد الصف'; end if;

  update public.repo_uploads
     set material_type = case when p ? 'material_type' then nullif(trim(coalesce(p ->> 'material_type', '')), '') else material_type end,
         sermon_type   = case when p ? 'sermon_type'   then nullif(trim(coalesce(p ->> 'sermon_type', '')), '')   else sermon_type end,
         mosque        = case when p ? 'mosque'        then nullif(trim(coalesce(p ->> 'mosque', '')), '')        else mosque end,
         work_date     = case when p ? 'work_date'     then nullif(p ->> 'work_date', '')::date                   else work_date end,
         language_code = case when p ? 'language_code' then nullif(trim(coalesce(p ->> 'language_code', '')), '') else language_code end,
         is_source     = case when p ? 'is_source'     then coalesce((p ->> 'is_source')::boolean, false)         else is_source end,
         title         = case when p ? 'title'         then nullif(trim(coalesce(p ->> 'title', '')), '')         else title end,
         work_key      = case when p ? 'work_key'      then nullif(trim(coalesce(p ->> 'work_key', '')), '')      else work_key end,
         status        = case when p ? 'status'        then coalesce(nullif(trim(coalesce(p ->> 'status', '')), ''), status) else status end
   where id = v_id and status = 'pending';
  if not found then raise exception 'الصفُّ غير موجود أو اعتُمد من قبل'; end if;
end $$;
grant execute on function public.save_repo_upload(jsonb) to authenticated;

create or replace function public.delete_repo_upload(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'حذفُ المرفوع للإدارة' using errcode = '42501';
  end if;
  delete from public.repo_uploads where id = p_id and status = 'pending';
end $$;
grant execute on function public.delete_repo_upload(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٥) الاعتماد: ما اتّفق مفتاحُه يجتمع في عملٍ واحدٍ بلغاته
-- ---------------------------------------------------------------------
create or replace function public.commit_repo_uploads(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_work uuid; v_item uuid; v_works int := 0; v_items int := 0; v_skip int := 0;
begin
  if not public.is_admin() then
    raise exception 'اعتمادُ المستودع للإدارة' using errcode = '42501';
  end if;

  for r in
    select u.*, coalesce(nullif(u.work_key, ''), u.id::text) as k
      from public.repo_uploads u
     where u.status = 'pending'
       and (p_batch is null or u.batch_id = p_batch)
     order by u.is_source desc, u.file_name
  loop
    if r.title is null or r.material_type is null or r.language_code is null then
      update public.repo_uploads
         set status = 'skipped', note = 'ينقصه العنوانُ أو النوعُ أو اللغة'
       where id = r.id;
      v_skip := v_skip + 1;
      continue;
    end if;

    -- عملٌ قائمٌ بالمفتاح نفسِه في هذه الدفعة، وإلا أُنشئ
    select w.id into v_work
      from public.repo_works w
      join public.repo_uploads u2 on u2.work_id = w.id
     where coalesce(nullif(u2.work_key, ''), u2.id::text) = r.k
       and u2.status = 'committed'
       and (p_batch is null or u2.batch_id is not distinct from r.batch_id)
     limit 1;

    if v_work is null then
      insert into public.repo_works (material_type, sermon_type, mosque, work_date,
                                     title, batch_id, created_by)
      values (r.material_type, r.sermon_type, r.mosque, r.work_date,
              r.title, r.batch_id, auth.uid())
      returning id into v_work;
      v_works := v_works + 1;
    end if;

    insert into public.repo_items (work_id, language_code, is_source, file_path)
    values (v_work, r.language_code, r.is_source, r.file_path)
    on conflict (work_id, language_code) do update set file_path = excluded.file_path
    returning id into v_item;

    begin perform public.assign_repo_doc_no(v_item); exception when others then null; end;

    update public.repo_uploads set status = 'committed', work_id = v_work, note = null
     where id = r.id;
    v_items := v_items + 1;
    v_work := null;
  end loop;

  return jsonb_build_object('works', v_works, 'items', v_items, 'skipped', v_skip);
end $$;
grant execute on function public.commit_repo_uploads(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) عددُ الأعمال في كل نوع — لأيقونات شاشة المستودع
-- ---------------------------------------------------------------------
create or replace function public.repo_type_counts()
returns table (material_type text, works int, items int)
language sql stable security definer set search_path = public as $$
  select w.material_type,
         count(distinct w.id)::int,
         count(i.id)::int
    from public.repo_works w
    left join public.repo_items i on i.work_id = w.id
   where public.my_role() is not null
   group by w.material_type
   order by 2 desc
$$;
grant execute on function public.repo_type_counts() to authenticated;

notify pgrst, 'reload schema';
