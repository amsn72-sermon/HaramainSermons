-- =====================================================================
-- 0096 — العربيةُ لغةٌ مسجَّلة، لغةَ مصدرٍ لا لغةَ هدف (ملاحظة ٢٧٦)
--
--   المنسّقون وأكثرُ الإداريين لسانُهم العربية، ولم تكن العربيةُ في
--   جدول اللغات أصلًا، فلم يستطع أحدُهم أن يُثبت لغته الأمّ.
--
--   فتُسجَّل العربيةُ ويُوسَم أنّها لغةُ المصدر: تُنتقى لغةً أمًّا،
--   ويُعرَض اسمُها في المخرجات، ولا تُنتقى هدفًا للترجمة ولا عمودًا في
--   الدليل — فالمصطلحُ عربيٌّ أصلًا.
-- =====================================================================

alter table public.languages
  add column if not exists is_source boolean not null default false;

comment on column public.languages.is_source is
  'لغةُ المصدر: تُنتقى لغةً أمًّا ولا تُنتقى هدفًا للترجمة (ملاحظة ٢٧٦)';

-- is_active = false فلا تدخل في التكليفات ولا مسارات الترجمة: وحراسةُ
-- الهدف قائمةٌ على is_active في كلِّ موضعٍ منذ ٠٠٠١، فلا يُمسُّ شيء.
insert into public.languages (code, name_ar, native_name, dir, is_core, is_active, is_source, sort)
values ('ar', 'العربية', 'العربية', 'rtl', false, false, true, 0)
on conflict (code) do update
   set is_source = true, is_active = false, is_core = false, sort = 0;

-- لغةُ المصدر لا تُفعَّل ولا تُعطَّل ولا تُضَمُّ إلى المبادرة
create or replace function public.guard_source_language()
returns trigger language plpgsql as $$
begin
  if new.is_source then
    new.is_active    := false;
    new.is_core      := false;
    new.is_initiative := false;
  end if;
  return new;
end $$;

drop trigger if exists languages_source_guard on public.languages;
create trigger languages_source_guard before insert or update on public.languages
  for each row execute function public.guard_source_language();

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- والدليلُ لا بطاقةَ فيه للعربية: المصطلحُ عربيٌّ أصلًا، وإنما تُعرَض
-- لغاتُ المقابل (ملاحظة ٢٧٦)
-- ---------------------------------------------------------------------
create or replace function public.my_glossary_langs()
returns table (code text, name_ar text, native_name text, dir text,
               is_core boolean, mine boolean, native boolean)
language sql stable security definer set search_path = public as $$
  select l.code, l.name_ar, l.native_name, l.dir, l.is_core,
         (ml.member_id is not null),
         (p.native_lang = l.code)
    from public.languages l
    left join public.profiles p on p.id = auth.uid()
    left join public.member_languages ml
           on ml.language_code = l.code and ml.member_id = auth.uid()
   where public.my_role() is not null
     and not l.is_source
     -- الإدارةُ ترى اللغاتِ كلَّها، والمترجمُ ما سجّله من إتقانه
     and (public.is_admin() or public.is_supervisor() or public.is_viewer()
          or ml.member_id is not null)
   order by (p.native_lang = l.code) desc, l.is_core desc, l.sort
$$;
grant execute on function public.my_glossary_langs() to authenticated;

-- ولا تُطلَب ترجمةُ مصطلحٍ إلى لغة المصدر
do $do$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dispatch_glossary';
  if v_src is null then return; end if;
  v_new := replace(v_src,
    'if not exists (select 1 from public.languages where code = l) then',
    'if not exists (select 1 from public.languages where code = l and not is_source) then');
  if v_new <> v_src then execute v_new; end if;
end $do$;

notify pgrst, 'reload schema';
