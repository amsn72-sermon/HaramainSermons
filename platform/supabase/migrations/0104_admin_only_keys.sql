-- =====================================================================
-- 0104 — المفاتيحُ الإداريةُ لا تُفتح بالأصل لغير الإدارة (ملاحظة ٣١٤)
--
--   في ٠٠٩٩ فُتحت بالأصلِ مفاتيحُ أعمالٍ منصوصةٍ للمنسّق كي لا تُنزَع
--   منه بالربط: تدقيقُ المستندات، وإرسالُ المراسلات، واستيرادُ الدليل،
--   واللغاتُ والخطباء. لكنّ الأصلَ في perm_allowed لا ينظر إلى الدور،
--   فانفتحت هذه المفاتيحُ للمترجم أيضًا — وظهر له زرُّ «استيراد من
--   Excel» وهو ليس من عمله.
--
--   فتُوسَم هذه المفاتيحُ «إدارية»: أصلُها الفتحُ لمن كان على الإدارة،
--   والمنعُ لمن دونها إلا أن يُمنَح صريحًا. وهذا هو معنى «ما كان
--   للمنسّق يبقى له» دون أن يفيض على غيره.
-- =====================================================================

alter table public.perm_keys
  add column if not exists admin_only boolean not null default false;

comment on column public.perm_keys.admin_only is
  'مفتاحٌ عملُه إداريٌّ: لا يُفتح بالأصل لمن دون الإدارة (ملاحظة ٣١٤)';

update public.perm_keys set admin_only = true
 where key in ('docs_check', 'docs_verify', 'circ_send', 'gl_import',
               'st_languages', 'st_khateebs');

-- ---------------------------------------------------------------------
-- الحارسُ يُرقَّع في موضعه، فلا يُفقَد ما أُضيف إليه في ٠٠٨٨ و٠٠٩٩
-- ---------------------------------------------------------------------
do $do$
declare v_src text; v_new text; v_anchor text; v_add text;
begin
  v_src := pg_get_functiondef('public.perm_allowed(uuid,text)'::regprocedure);

  v_anchor := 'when not exists (select 1 from public.perm_keys where key = p_key) then false';
  if position(v_anchor in v_src) = 0 then
    raise exception 'perm_allowed: لم يُوجد موضعُ الترقيع';
  end if;

  if position('admin_only' in v_src) > 0 then
    return;                       -- رُقِّع قبلًا
  end if;

  v_add := v_anchor || '
    -- المفتاحُ الإداريُّ لمن كان على الإدارة: ومن دونها يُمنَح صريحًا
    when exists (select 1 from public.perm_keys k
                  where k.key = p_key and k.admin_only)
     and coalesce((select p.role from public.profiles p where p.id = p_member), ''translator'')
         not in (''manager'', ''coordinator'', ''supervisor'', ''viewer'')
      then coalesce((select mp.allowed from public.member_perms mp
                      where mp.member_id = p_member and mp.perm_key = p_key
                        and (mp.expires_at is null or mp.expires_at > now())), false)';

  v_new := replace(v_src, v_anchor, v_add);
  execute v_new;
end $do$;
