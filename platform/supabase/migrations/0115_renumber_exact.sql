-- =====================================================================
-- 0115 — ترقيمُ العام دقيقٌ لا يحتمل اللبس (ملاحظة ٣٤٦)
--
--   «بعد رفع جميع الخطب واكتمالها أحتاج ضغط هذا الزر ليرقّمها ترقيمًا
--   دقيقًا» — فرُوجع، فوُجد فيه ثلاثةُ مواضع:
--
--   ١) الترتيبُ عند تساوي التاريخ كان بزمن الرفع، فخطبتا الجمعة
--      الواحدة تأخذان رقمَيهما بحسب أيُّهما رُفعت أوّلًا لا بحسب حرمِها.
--      فصار: التاريخُ، ثم الحرامُ قبل النبويِّ، ثم ما لا مسجدَ له،
--      ثم زمنُ الإنشاء. فالترقيمُ ثابتٌ لا يتبدّل بإعادة الضغط.
--
--   ٢) ولم تكن الجمعةُ ورقمُ الأسبوع يُحسبان في إعادة الترقيم، وقد
--      تتبدّل تواريخُ الخطب بالتصحيح بعد الرفع الجماعي، فتبقى الخطبةُ
--      في صفِّ جمعةٍ ليست جمعتَها. فصارا يُحسبان من تاريخها.
--
--   ٣) وما تكرّر من أرقامٍ في عامٍ يُجبَر. ولا يُوضَع قيدُ تفرّدٍ في
--      القاعدة: الترقيمُ المستقلُّ لكلِّ حرمٍ سلسلتان، فالرقمُ فيه
--      يتكرّر بين الحرمين عن قصد — والتفرّدُ يُحفَظ داخلَ كلِّ نسق.
-- =====================================================================

create or replace function public.renumber_arch_year(
  p_year int, p_per_mosque boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not (public.is_manager() or public.is_admin_for('arch_edit')) then
    raise exception 'ترقيمُ الخطب بإذن مدير المشروع' using errcode = '42501';
  end if;

  -- الجمعةُ ورقمُ الأسبوع يُحسبان من تاريخ الخطبة، فلا تبقى في صفٍّ
  --   ليس صفَّها بعد تصحيح تاريخها (ملاحظة ٣٤٦)
  update public.arch_sermons
     set friday_on = public.friday_of(sermon_date),
         week_no   = public.arch_week_no(p_year, sermon_date)
   where h_year = p_year;

  -- تُرفَع الأرقامُ عاليًا أولًا كي لا تصطدم بقيدِ التفرّد في أثناء النقل
  update public.arch_sermons set seq = seq + 100000
   where h_year = p_year and seq is not null;

  with ord as (
    select id, row_number() over (
             partition by case when p_per_mosque then mosque else null end
             order by coalesce(sermon_date, date '9999-12-31'),
                      case mosque when 'makkah' then 0 when 'madinah' then 1 else 2 end,
                      created_at, id)::int as n
      from public.arch_sermons where h_year = p_year)
  update public.arch_sermons s set seq = o.n from ord o where o.id = s.id;

  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.renumber_arch_year(int, boolean) to authenticated;

comment on function public.renumber_arch_year(int, boolean) is
  'إعادةُ ترقيم خطب العام بتاريخها ثم حرمِها، وضبطُ جمعتها وأسبوعها '
  '(ملاحظتا ٣٢٧ و٣٤٦)';

-- ---------------------------------------------------------------------
-- ما تكرّر من أرقامٍ يُجبَر، ثم يُمنع تكرُّره
-- ---------------------------------------------------------------------
do $do$
declare y int;
begin
  for y in select distinct h_year from public.arch_sermons s
            where exists (select 1 from public.arch_sermons x
                           where x.h_year = s.h_year and x.seq = s.seq
                             and x.seq is not null and x.id <> s.id)
  loop
    update public.arch_sermons set seq = seq + 100000 where h_year = y and seq is not null;
    with ord as (
      select id, row_number() over (
               order by coalesce(sermon_date, date '9999-12-31'),
                        case mosque when 'makkah' then 0 when 'madinah' then 1 else 2 end,
                        created_at, id)::int as n
        from public.arch_sermons where h_year = y)
    update public.arch_sermons s set seq = o.n from ord o where o.id = s.id;
    raise notice 'أُعيد ترقيمُ عام % لتكرُّر أرقامه', y;
  end loop;
end $do$;

notify pgrst, 'reload schema';
