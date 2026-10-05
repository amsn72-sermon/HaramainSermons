-- =====================================================================
-- 0092 — طلبُ ترجمةِ مصطلحات، وتنقيحُ المقابل
--        (ملاحظتا ٢٦٠ و٢٦١)
--
--   ٢٦٠) يُرفع ملفٌّ فيه كلماتٌ عربيةٌ وحدَها، وتُختار اللغاتُ، فتُنشأ
--        مهمّةُ ترجمةٍ لكلِّ لغة. والإسنادُ على ثلاث درجات: دفعةً
--        واحدة، أو كلماتٍ مختارة، أو كلمةً واحدة. وما كتبه المترجمُ
--        يدخل الدليلَ معتمدًا بلا مراجعة — فالفريقُ أهلُ صدقٍ ومعروفون.
--
--   ٢٦١) من أُسنِد إليه ترجم، ثم لكلِّ مترجمٍ في اللغة نفسِها أن
--        يُنقّح ما شاء بلا استئذان. ويُحفظ المقابلُ السابقُ في سجلّ،
--        فتاريخُ المصطلح جزءٌ من المصطلح. ولا قيودَ، بل توجيهٌ مكتوب.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ١) المهمّةُ وبنودُها
-- ---------------------------------------------------------------------
create table if not exists public.glossary_tasks (
  id            uuid primary key default gen_random_uuid(),
  language_code text not null references public.languages (code) on update cascade,
  assignee_id   uuid references public.profiles (id) on delete set null,
  title         text,
  note          text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  due_on        date,
  closed_at     timestamptz
);

create table if not exists public.glossary_task_terms (
  task_id  uuid not null references public.glossary_tasks (id) on delete cascade,
  term_id  uuid not null references public.glossary_terms (id) on delete cascade,
  done_at  timestamptz,
  done_by  uuid references public.profiles (id) on delete set null,
  primary key (task_id, term_id)
);

create index if not exists glossary_tasks_assignee on public.glossary_tasks (assignee_id, closed_at);

alter table public.glossary_tasks enable row level security;
alter table public.glossary_task_terms enable row level security;

drop policy if exists "read gl tasks" on public.glossary_tasks;
create policy "read gl tasks" on public.glossary_tasks for select
  using (public.is_admin() or public.is_supervisor() or public.is_viewer()
         or assignee_id = auth.uid());

drop policy if exists "read gl task terms" on public.glossary_task_terms;
create policy "read gl task terms" on public.glossary_task_terms for select
  using (exists (select 1 from public.glossary_tasks t
                  where t.id = task_id
                    and (public.is_admin() or public.is_supervisor()
                         or public.is_viewer() or t.assignee_id = auth.uid())));

comment on table public.glossary_tasks is
  'مهمّةُ ترجمةِ مصطلحاتٍ في لغةٍ واحدة (ملاحظة ٢٦٠)';

-- التوجيهُ المكتوبُ في رأس الجدول (ملاحظة ٢٦١)
alter table public.platform_settings
  add column if not exists glossary_guidance text;

update public.platform_settings
   set glossary_guidance = coalesce(glossary_guidance,
     'نأمل الدقّةَ وتجويدَ الترجمة. وما ظهر لك فيه معنًى أدقُّ فنقّحه، '
     || 'فالدليلُ يُجوَّد بتعاونكم، وما يُنقَّح محفوظُ الأثر.');

-- ---------------------------------------------------------------------
-- ٢) سجلُّ التنقيح (ملاحظة ٢٦١)
-- ---------------------------------------------------------------------
create table if not exists public.glossary_tr_history (
  id            bigserial primary key,
  term_id       uuid not null references public.glossary_terms (id) on delete cascade,
  language_code text not null references public.languages (code) on update cascade,
  was           text,
  became        text not null,
  why           text,
  by_id         uuid references public.profiles (id) on delete set null,
  at            timestamptz not null default now()
);

create index if not exists gl_tr_hist on public.glossary_tr_history (term_id, language_code, id desc);

alter table public.glossary_tr_history enable row level security;
drop policy if exists "read gl history" on public.glossary_tr_history;
create policy "read gl history" on public.glossary_tr_history for select
  using (public.my_role() is not null);

comment on table public.glossary_tr_history is
  'ما كان المقابلُ قبل تنقيحه، ومن نقّحه ومتى ولماذا (ملاحظة ٢٦١)';

-- ---------------------------------------------------------------------
-- ٣) رفعُ كلماتٍ عربيةٍ وحدَها: تدخل الدليلَ من حينها (ملاحظة ٢٦٠ ح)
-- ---------------------------------------------------------------------
create or replace function public.import_arabic_terms(p_words text[], p_category text default 'عام')
returns table (added int, existed int)
language plpgsql security definer set search_path = public as $$
declare w text; v_term text; v_cat text := coalesce(nullif(btrim(p_category), ''), 'عام');
begin
  if not (public.is_manager() or public.has_perm('gl_request')) then
    raise exception 'رفعُ قوائم المصطلحات بإذن مدير المشروع' using errcode = '42501';
  end if;
  if v_cat not in ('عقدي','فقهي','دعوي','توجيهات','مناسك','أعلام','قرآني','عام') then
    v_cat := 'عام';
  end if;
  added := 0; existed := 0;

  foreach w in array coalesce(p_words, array[]::text[]) loop
    v_term := nullif(btrim(w), '');
    continue when v_term is null;
    if exists (select 1 from public.glossary_terms where term_ar = v_term) then
      existed := existed + 1;
    else
      insert into public.glossary_terms (term_ar, category, status, created_by, approved_by, approved_at)
      values (v_term, v_cat, 'معتمد', auth.uid(), auth.uid(), now());
      added := added + 1;
    end if;
  end loop;
  return next;
end $$;
grant execute on function public.import_arabic_terms(text[], text) to authenticated;

-- ---------------------------------------------------------------------
-- ٤) الإسناد: دفعةً واحدة، أو كلماتٍ مختارة، أو كلمةً واحدة
--    ولكلِّ لغةٍ مهمّتُها، وتُسنَد إلى صاحب الدور الافتراضي فيها
-- ---------------------------------------------------------------------
create or replace function public.dispatch_glossary(
  p_terms uuid[], p_langs text[], p_assignees jsonb default '{}'::jsonb,
  p_note text default null, p_due date default null
) returns table (language_code text, task_id uuid, assignee uuid, terms int)
language plpgsql security definer set search_path = public as $$
declare l text; v_task uuid; v_as uuid; v_n int;
begin
  if not (public.is_manager() or public.has_perm('gl_request')) then
    raise exception 'طلبُ ترجمةِ المصطلحات بإذن مدير المشروع' using errcode = '42501';
  end if;
  if coalesce(array_length(p_terms, 1), 0) = 0 then raise exception 'لم تُحدَّد مصطلحات'; end if;
  if coalesce(array_length(p_langs, 1), 0) = 0 then raise exception 'لم تُحدَّد لغات'; end if;

  foreach l in array p_langs loop
    if not exists (select 1 from public.languages where code = l) then
      raise exception 'لغةٌ غير معروفة: %', l;
    end if;

    v_as := nullif(p_assignees ->> l, '')::uuid;
    if v_as is null then
      -- صاحبُ الدور الافتراضيِّ في اللغة، وإلا أوّلُ من يُسنَد إليه فيها
      select member_id into v_as from public.member_languages ml
       join public.profiles p on p.id = ml.member_id
       where ml.language_code = l and coalesce(ml.assignable, true)
         and p.status = 'active'
       order by coalesce(ml.default_stage = 'translation', false) desc,
                coalesce(ml.priority, 100), p.full_name
       limit 1;
    end if;

    insert into public.glossary_tasks (language_code, assignee_id, title, note, created_by, due_on)
    values (l, v_as,
            format('ترجمةُ %s مصطلحًا', array_length(p_terms, 1)),
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), p_due)
    returning id into v_task;

    insert into public.glossary_task_terms (task_id, term_id)
    select v_task, t.id from public.glossary_terms t
     where t.id = any (p_terms)
    on conflict do nothing;

    select count(*)::int into v_n from public.glossary_task_terms x where x.task_id = v_task;

    if v_as is not null then
      insert into public.notifications (member_id, kind, subject, body)
      values (v_as, 'assigned',
              format('%s مصطلحًا تنتظر ترجمتك', v_n),
              format('أُسنِدت إليك ترجمةُ %s مصطلحًا في لغة %s. تجدها في «مهامي».',
                     v_n, (select name_ar from public.languages where code = l)));
    end if;

    language_code := l; task_id := v_task; assignee := v_as; terms := v_n;
    return next;
  end loop;
end $$;
grant execute on function public.dispatch_glossary(uuid[], text[], jsonb, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- ٥) شاشةُ المترجم: جدولٌ بعمودين يُحفظ كلَّما كتب
-- ---------------------------------------------------------------------
create or replace function public.my_glossary_tasks()
returns table (id uuid, language_code text, language_name text, title text, note text,
               due_on date, total int, done int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.language_code, l.name_ar, t.title, t.note, t.due_on,
         (select count(*)::int from public.glossary_task_terms x where x.task_id = t.id),
         (select count(*)::int from public.glossary_task_terms x
           where x.task_id = t.id and x.done_at is not null),
         t.created_at
    from public.glossary_tasks t
    join public.languages l on l.code = t.language_code
   where t.assignee_id = auth.uid() and t.closed_at is null
   order by t.due_on nulls last, t.created_at
$$;
grant execute on function public.my_glossary_tasks() to authenticated;

create or replace function public.glossary_task_rows(p_task uuid)
returns table (term_id uuid, term_ar text, explanation text, term_tr text, done_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.term_ar, t.explanation,
         public.term_tr_of(t.id, k.language_code), x.done_at
    from public.glossary_task_terms x
    join public.glossary_tasks k on k.id = x.task_id
    join public.glossary_terms t on t.id = x.term_id
   where x.task_id = p_task
     and (k.assignee_id = auth.uid() or public.is_admin() or public.is_supervisor())
   order by public.ar_norm(t.term_ar)
$$;
grant execute on function public.glossary_task_rows(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ٦) ما كتبه المترجمُ يدخل الدليلَ معتمدًا بلا مراجعة (ملاحظة ٢٦٠ ج)
--    والتنقيحُ بعدَه لكلِّ مترجمٍ في اللغة نفسِها (ملاحظة ٢٦١)
-- ---------------------------------------------------------------------
create or replace function public.set_translation(
  p_term uuid, p_lang text, p_text text, p_why text default null, p_task uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_was text; v_prev uuid; v_new text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if public.my_role() is null or public.is_supervisor() or public.is_viewer() then
    raise exception 'الدليل المصطلحي للفريق' using errcode = '42501';
  end if;
  -- لا يكتب في لغةٍ لم يسجّلها ضمن إتقانه، إلا الإدارة
  if not (public.is_admin() or exists (
        select 1 from public.member_languages
         where member_id = auth.uid() and language_code = p_lang)) then
    raise exception 'لا تُكتب الترجمةُ إلا في لغةٍ سجّلتها ضمن إتقانك' using errcode = '42501';
  end if;
  if not public.has_perm('gl_refine') then
    raise exception 'تنقيحُ المقابلات مغلقٌ على حسابك' using errcode = '42501';
  end if;
  if not exists (select 1 from public.glossary_terms where id = p_term) then
    raise exception 'المصطلح غير موجود';
  end if;

  select term_tr into v_was from public.glossary_translations
   where term_id = p_term and language_code = p_lang;

  if v_new is null then
    delete from public.glossary_translations where term_id = p_term and language_code = p_lang;
  else
    insert into public.glossary_translations (term_id, language_code, term_tr)
    values (p_term, p_lang, v_new)
    on conflict (term_id, language_code) do update set term_tr = excluded.term_tr;
  end if;

  if v_was is distinct from v_new then
    insert into public.glossary_tr_history (term_id, language_code, was, became, why, by_id)
    values (p_term, p_lang, v_was, coalesce(v_new, ''), nullif(btrim(coalesce(p_why, '')), ''), auth.uid());

    -- إشعارُ من وضع المقابلَ الأول، علمًا لا اعتراضًا
    if v_was is not null then
      select by_id into v_prev from public.glossary_tr_history
       where term_id = p_term and language_code = p_lang and became = v_was
       order by id desc limit 1;
      if v_prev is not null and v_prev <> auth.uid() then
        insert into public.notifications (member_id, kind, subject, body)
        values (v_prev, 'reminder', 'نُقّح مقابلٌ وضعتَه',
                format('المصطلحُ «%s»: كان «%s» فصار «%s».',
                       (select term_ar from public.glossary_terms where id = p_term), v_was, v_new));
      end if;
    end if;
  end if;

  if p_task is not null then
    update public.glossary_task_terms
       set done_at = case when v_new is null then null else now() end,
           done_by = case when v_new is null then null else auth.uid() end
     where task_id = p_task and term_id = p_term;
  end if;
end $$;
grant execute on function public.set_translation(uuid, text, text, text, uuid) to authenticated;

create or replace function public.translation_history(p_term uuid, p_lang text)
returns table (was text, became text, why text, by_name text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select h.was, h.became, h.why, coalesce(p.full_name, '—'), h.at
    from public.glossary_tr_history h
    left join public.profiles p on p.id = h.by_id
   where h.term_id = p_term and h.language_code = p_lang
     and public.my_role() is not null
   order by h.id desc
$$;
grant execute on function public.translation_history(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- ٧) لوحةُ المتابعة للمدير (ملاحظة ٢٦٠ د)
-- ---------------------------------------------------------------------
create or replace function public.glossary_task_board()
returns table (id uuid, language_code text, language_name text, assignee text,
               total int, done int, created_at timestamptz, due_on date, closed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.language_code, l.name_ar, coalesce(p.full_name, 'بلا مُسنَدٍ إليه'),
         (select count(*)::int from public.glossary_task_terms x where x.task_id = t.id),
         (select count(*)::int from public.glossary_task_terms x
           where x.task_id = t.id and x.done_at is not null),
         t.created_at, t.due_on, t.closed_at
    from public.glossary_tasks t
    join public.languages l on l.code = t.language_code
    left join public.profiles p on p.id = t.assignee_id
   where public.is_admin() or public.is_supervisor() or public.is_viewer()
   order by t.closed_at nulls first, t.created_at desc
$$;
grant execute on function public.glossary_task_board() to authenticated;

create or replace function public.close_glossary_task(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_manager() or public.has_perm('gl_request')) then
    raise exception 'إغلاقُ المهمّة بإذن مدير المشروع' using errcode = '42501';
  end if;
  update public.glossary_tasks set closed_at = now() where id = p_task;
  if not found then raise exception 'المهمّة غير موجودة'; end if;
end $$;
grant execute on function public.close_glossary_task(uuid) to authenticated;

notify pgrst, 'reload schema';

-- التوجيهُ المكتوب يُقرأ في الشاشة
create or replace function public.platform_guidance()
returns text language sql stable security definer set search_path = public as $$
  select glossary_guidance from public.platform_settings limit 1
$$;
grant execute on function public.platform_guidance() to authenticated;
