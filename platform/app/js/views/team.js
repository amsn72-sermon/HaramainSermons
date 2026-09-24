// فريق العمل: طلبات التسجيل، التفعيل، الأدوار، واللغات
import { h, fill, toast, busy, dialog, emptyState, fmtDate, fmtDateTime, confirm } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, isManager, ROLE_LABEL, STATUS_LABEL, langName, stageName } from '../store.js';
import { POLICY_KEY, POLICY_VERSION } from '../policy.js';

export async function render(ctx) {
  const [members, priv, perf, rateSum, signed] = await Promise.all([
    db.select('profiles', { select: '*,member_languages(language_code)', order: 'created_at.desc' }),
    db.select('profile_private', { select: '*' }),
    db.select('member_performance', { select: '*' }).catch(() => []),
    db.select('member_rating_summary', { select: '*' }).catch(() => []),
    db.select('policy_acceptances', { select: 'member_id,policy_version,signed_name,accepted_at', policy_key: `eq.${POLICY_KEY}` }).catch(() => [])
  ]);
  const privOf = Object.fromEntries(priv.map(p => [p.id, p]));
  const perfOf = Object.fromEntries(perf.map(r => [r.member_id, r]));
  const rateOf = Object.fromEntries(rateSum.map(r => [r.member_id, r]));
  const signOf = {};
  for (const r of signed) if (r.policy_version === POLICY_VERSION) signOf[r.member_id] = r;

  const stars = n => h('span.stars', { title: n ? `${n} من ٥` : 'بلا تقييم' },
    [1, 2, 3, 4, 5].map(i => h('b', { class: i <= Math.round(n || 0) ? '' : 'off' }, '★')));
  const hours = sec => {
    const s = Math.max(0, Number(sec) || 0);
    if (s < 3600) return `${Math.round(s / 60)} دقيقة`;
    return `${(s / 3600).toFixed(1)} ساعة`;
  };
  const onTimePct = r => (r && r.done_stages) ? Math.round((r.on_time_stages / r.done_stages) * 100) : null;
  const langsOf = m => (m.member_languages || []).map(x => x.language_code);
  const reload = () => ctx.navigate('/app/team', { replace: true });

  const filterLang = h('select', { 'aria-label': 'تصفية حسب اللغة' }, h('option', { value: '' }, 'جميع اللغات'),
    state.languages.map(l => h('option', { value: l.code }, l.name_ar)));
  const filterStatus = h('select', { 'aria-label': 'تصفية حسب الحالة' }, h('option', { value: '' }, 'كل الحالات'),
    Object.entries(STATUS_LABEL).map(([k, v]) => h('option', { value: k }, v)));
  const q = h('input', { type: 'search', placeholder: 'الاسم أو البريد', 'aria-label': 'بحث' });
  const table = h('div');

  const canManage = m => isManager() || m.role === 'translator';
  // الصفة التي تقدّم بها العضو عند التسجيل — إفصاح للاسترشاد لا صلاحية (ملاحظة ٦٣)
  const APPLIED_LABEL = { translator: 'مترجم أو مراجع', coordinator: 'منسق أو إداري' };

  async function edit(m) {
    const role = h('select', { disabled: !isManager() || m.id === state.profile.id },
      Object.entries(ROLE_LABEL).map(([k, v]) => h('option', { value: k, selected: m.role === k }, v)));

    // اللغات من قائمة منسدلة مع رقائق تُحذف بضغطة (ملاحظة ٥٢)
    const chosen = new Set(langsOf(m));
    const langSelect = h('select', { 'aria-label': 'أضف لغة' });
    const langChips = h('div.lang-pills.chosen');
    function drawLangs() {
      const rest = state.languages.filter(l => l.is_active && !chosen.has(l.code));
      fill(langSelect, h('option', { value: '' }, rest.length ? '— أضف لغة —' : '— أُضيفت كل اللغات —'),
        rest.map(l => h('option', { value: l.code }, l.name_ar)));
      langChips.replaceChildren(...[...chosen].map(code => h('button', { type: 'button', 'aria-pressed': 'true',
        'aria-label': `إزالة ${langName(code)}`, title: 'إزالة اللغة',
        onclick: () => { chosen.delete(code); drawLangs(); } },
        h('span.tick', { 'aria-hidden': 'true' }, '✓'), langName(code), h('span.x', { 'aria-hidden': 'true' }, '×'))));
      if (!chosen.size) langChips.append(h('span.small.muted', 'لا لغات'));
    }
    langSelect.addEventListener('change', () => { if (langSelect.value) { chosen.add(langSelect.value); drawLangs(); } });
    drawLangs();

    // بيانات التواصل قابلة للتعديل من المنسق ومدير المشروع (ملاحظة ٥٢)
    const p = privOf[m.id] || {};
    const fld = {
      full_name: h('input', { value: m.full_name || '' }),
      whatsapp: h('input', { dir: 'ltr', value: p.whatsapp || '', placeholder: '+9665XXXXXXXX' }),
      nationality: h('input', { value: p.nationality || '' }),
      national_id: h('input', { dir: 'ltr', inputmode: 'numeric', maxlength: 10, value: p.national_id || '', placeholder: '1XXXXXXXXX' }),
      residence: h('input', { value: p.residence || '' })
    };

    const iqama = h('div.stack', { style: { gap: '8px' } });
    const drawIqama = () => {
      const view = h('div');
      if (p.iqama_path) storage.signedUrl('private-docs', p.iqama_path, 600)
        .then(url => view.replaceChildren(h('a.btn.sm', { href: url, target: '_blank', rel: 'noopener' }, 'عرض صورة الهوية (رابط مؤقت ١٠ دقائق)')))
        .catch(() => view.replaceChildren(h('span.small.muted', 'تعذّر فتح الصورة')));
      else view.replaceChildren(h('span.small.muted', 'لم تُرفع صورة الهوية بعد'));
      const up = h('input', { type: 'file', accept: 'image/*,application/pdf', 'aria-label': 'رفع صورة الهوية' });
      up.onchange = () => busy(up, async () => {
        const file = up.files[0]; if (!file) return;
        try {
          const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
          const path = `${m.id}/iqama-${Date.now()}.${ext}`;
          await storage.upload('private-docs', path, file);
          await db.rpc('admin_set_iqama', { p_member: m.id, p_path: path });
          p.iqama_path = path; drawIqama(); toast('رُفعت صورة الهوية.', 'ok');
        } catch (err) { toast(err.message, 'bad'); }
      });
      iqama.replaceChildren(view, h('label.field', 'رفع صورة الهوية أو الإقامة', up));
    };
    drawIqama();

    const result = await dialog({
      title: `${m.full_name} — ${ROLE_LABEL[m.role]}`,
      body: h('div.stack',
        h('div.grid-2',
          h('div', h('div.small.muted', 'البريد'), h('div', { dir: 'ltr' }, m.email)),
          h('div', h('div.small.muted', 'تاريخ التسجيل'), h('div', fmtDate(m.created_at))),
          h('div', h('div.small.muted', 'تقدّم بصفة'), h('div', APPLIED_LABEL[p.applied_as] || 'غير محددة'))),
        h('div.grid-2',
          h('label.field', 'الاسم الكامل', fld.full_name),
          h('label.field', 'رقم واتس آب', fld.whatsapp),
          h('label.field', 'الجنسية', fld.nationality),
          h('label.field', 'رقم الهوية أو الإقامة', fld.national_id),
          h('label.field', 'مكان الإقامة', fld.residence)),
        iqama,
        h('label.field', 'الدور', role, !isManager() && h('small', 'تغيير الأدوار الإدارية بيد مدير المشروع')),
        h('fieldset', h('legend', 'اللغات المؤهل فيها'), h('div.stack', { style: { gap: '10px' } }, langSelect, langChips))),
      buttons: [
        { label: 'حفظ', kind: 'primary', validate: () => {
          const nid = fld.national_id.value.trim();
          if (nid && !/^[12][0-9]{9}$/.test(nid)) { toast('رقم الهوية أو الإقامة: ١٠ أرقام تبدأ بـ١ أو ٢.', 'bad'); return false; }
          if (fld.full_name.value.trim().length < 3) { toast('اكتب الاسم الكامل.', 'bad'); return false; }
          return true;
        }, value: () => ({ role: role.value, languages: [...chosen],
          contact: { full_name: fld.full_name.value.trim(), whatsapp: fld.whatsapp.value.trim(),
            nationality: fld.nationality.value.trim(), national_id: fld.national_id.value.trim(), residence: fld.residence.value.trim() } }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!result) return;
    try {
      await db.rpc('admin_update_member', { p_member: m.id, p_status: null, p_role: result.role === m.role ? null : result.role, p_languages: result.languages });
      await db.rpc('admin_update_contact', { p_member: m.id, p_full_name: result.contact.full_name || null,
        p_whatsapp: result.contact.whatsapp || null, p_nationality: result.contact.nationality || null,
        p_national_id: result.contact.national_id || null, p_residence: result.contact.residence || null });
      toast('حُفظت بيانات العضو.', 'ok'); reload();
    } catch (err) { toast(err.message, 'bad'); }
  }

  // ملف الأداء والتقييم — للمنسقين ومدير المشروع فقط (ملاحظة ٥٧)
  async function performance(m) {
    const r = perfOf[m.id] || {};
    const sum = rateOf[m.id] || {};
    const list = h('div.stack', h('p.muted.small', 'جارٍ التحميل…'));

    const drawList = async () => {
      try {
        const rows = await db.select('member_ratings', {
          select: '*,rater:profiles!member_ratings_rater_id_fkey(full_name)',
          member_id: `eq.${m.id}`, order: 'created_at.desc', limit: 50
        });
        list.replaceChildren(rows.length ? h('div.stack', rows.map(x => h('div.row', { style: { borderBottom: '1px solid var(--border)', paddingBottom: '8px' } },
          h('div', { style: { flex: 1, minWidth: '180px' } },
            stars(x.score),
            x.note ? h('div.small', x.note) : h('div.small.muted', 'بلا ملاحظة'),
            h('div.small.muted', `${x.rater?.full_name || '—'} — ${fmtDateTime(x.created_at)}${x.stage_key ? ' — ' + stageName(x.stage_key) : ''}`)),
          (isManager() || x.rater_id === state.profile.id) && h('button.btn.sm.danger', { type: 'button', onclick: async e => {
            if (!await confirm('حذف التقييم', 'يُحذف هذا التقييم نهائيًا. متابعة؟', 'حذف')) return;
            await busy(e.currentTarget, async () => {
              try { await db.rpc('delete_rating', { p_id: x.id }); toast('حُذف التقييم.', 'ok'); drawList(); }
              catch (err) { toast(err.message, 'bad'); }
            });
          } }, 'حذف'))))
          : h('p.muted.small', 'لا تقييمات بعد.'));
      } catch (err) { list.replaceChildren(h('p.small.bad', err.message)); }
    };
    drawList();

    const score = h('select', { 'aria-label': 'الدرجة' },
      [5, 4, 3, 2, 1].map(v => h('option', { value: String(v) }, `${v} — ${['', 'ضعيف', 'مقبول', 'جيد', 'جيد جدًا', 'ممتاز'][v]}`)));
    const note = h('textarea', { rows: 2, placeholder: 'ملاحظة موجزة على الأداء (اختياري)' });
    const add = h('button.btn.sm.primary', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
      try {
        await db.rpc('rate_member', { p_member: m.id, p_score: Number(score.value), p_note: note.value.trim() || null });
        note.value = ''; toast('سُجّل التقييم.', 'ok'); drawList();
      } catch (err) { toast(err.message, 'bad'); }
    }) }, 'إضافة التقييم');

    const pct = onTimePct(r);
    const sg = signOf[m.id];
    await dialog({
      title: `أداء ${m.full_name}`,
      body: h('div.stack',
        h('div.perf-grid',
          h('div', h('div.small.muted', 'مراحل منجزة'), h('div.v', String(r.done_stages ?? 0))),
          h('div', h('div.small.muted', 'الالتزام بالمواعيد'), h('div.v', pct === null ? '—' : pct + '٪')),
          h('div', h('div.small.muted', 'مجموع التأخير'), h('div.v', hours(r.late_seconds))),
          h('div', h('div.small.muted', 'مرات الإعادة'), h('div.v', String(r.redo_rounds ?? 0))),
          h('div', h('div.small.muted', 'مهام مفتوحة'), h('div.v', String(r.open_stages ?? 0))),
          h('div', h('div.small.muted', 'معدل التقييم'), h('div.v', sum.avg_score ? `${sum.avg_score} / 5` : '—'),
            h('div.small.muted', sum.ratings_count ? `${sum.ratings_count} تقييم` : ''))),
        h('p.small.muted', sg
          ? `وقّع سياسة السرية (نسخة ${sg.policy_version}) باسم «${sg.signed_name}» في ${fmtDateTime(sg.accepted_at)}.`
          : 'لم يوقّع على سياسة السرية بنسختها الحالية بعد.'),
        h('fieldset', h('legend', 'تقييم جديد'),
          h('div.stack', { style: { gap: '8px' } }, h('label.field', 'الدرجة', score), h('label.field', 'ملاحظة', note), h('div.row', add))),
        h('fieldset', h('legend', 'سجل التقييمات'), list)),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  }

  async function setStatus(btn, m, status) {
    await busy(btn, async () => {
      try {
        await db.rpc('admin_update_member', { p_member: m.id, p_status: status, p_role: null, p_languages: null });
        toast(status === 'active' ? `فُعّل حساب ${m.full_name}.` : `عُطّل حساب ${m.full_name}.`, 'ok'); reload();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  function draw() {
    const list = members.filter(m => m.status !== 'pending')
      .filter(m => !filterLang.value || langsOf(m).includes(filterLang.value))
      .filter(m => !filterStatus.value || m.status === filterStatus.value)
      .filter(m => !q.value.trim() || m.full_name.includes(q.value.trim()) || m.email.includes(q.value.trim()));
    table.replaceChildren(list.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['الاسم', 'الدور', 'اللغات', 'التقييم', 'السرية', 'الحالة', ''].map(t => h('th', t)))),
      h('tbody', list.map(m => h('tr',
        h('td', { 'data-label': 'الاسم' }, h('b', m.full_name), h('span.sub', { dir: 'ltr' }, m.email)),
        h('td', { 'data-label': 'الدور' }, ROLE_LABEL[m.role]),
        h('td', { 'data-label': 'اللغات' }, langsOf(m).map(langName).join('، ') || '—'),
        h('td', { 'data-label': 'التقييم' },
          rateOf[m.id]?.avg_score ? h('span', stars(rateOf[m.id].avg_score), h('span.sub', `${rateOf[m.id].avg_score} / 5`)) : h('span.muted', '—'),
          onTimePct(perfOf[m.id]) === null ? null : h('span.sub', `الالتزام ${onTimePct(perfOf[m.id])}٪ · ${perfOf[m.id].done_stages} مرحلة`)),
        h('td', { 'data-label': 'السرية' }, signOf[m.id]
          ? h('span.badge.ok', { title: fmtDateTime(signOf[m.id].accepted_at) }, 'موقّعة')
          : h('span.badge.warn', 'لم توقّع')),
        h('td', { 'data-label': 'الحالة' }, h('span.badge', { class: m.status === 'active' ? 'ok' : 'bad' }, STATUS_LABEL[m.status])),
        h('td', canManage(m) && m.id !== state.profile.id && h('div.row',
          h('button.btn.sm', { type: 'button', onclick: () => performance(m) }, 'الأداء والتقييم'),
          h('button.btn.sm', { type: 'button', onclick: () => edit(m) }, 'الملف والتعديل'),
          m.status === 'active'
            ? h('button.btn.sm.danger', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'disabled') }, 'تعطيل')
            : h('button.btn.sm', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'active') }, 'تفعيل'))))))))
      : emptyState('لا أعضاء مطابقون', 'غيّر عوامل التصفية.'));
  }
  [filterLang, filterStatus, q].forEach(el => el.addEventListener('input', draw));
  draw();

  const pending = members.filter(m => m.status === 'pending');
  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'فريق العمل'),
      h('p.muted', 'ينضم الأعضاء عبر صفحة التسجيل، ثم يفعّلهم المنسق. التعطيل يحفظ سجل العضو بدل حذفه، ولا يُعطَّل من لديه مهمة قائمة.'))),
    h('div.card', h('h3', `طلبات التسجيل (${pending.length})`),
      pending.length ? h('div.stack', pending.map(m => h('div.row', { style: { borderBottom: '1px solid var(--border)', paddingBottom: '10px' } },
        h('div', { style: { flex: 1, minWidth: '200px' } }, h('b', m.full_name), h('div.small.muted', { dir: 'ltr' }, m.email),
          h('div.small', 'تقدّم بصفة: ', h('b', APPLIED_LABEL[privOf[m.id]?.applied_as] || 'غير محددة')),
          h('div.small', 'اللغات: ', langsOf(m).map(langName).join('، ') || '—')),
        h('button.btn.sm', { type: 'button', onclick: () => edit(m) }, 'مراجعة الملف'),
        h('button.btn.sm.primary', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'active') }, 'تفعيل'),
        h('button.btn.sm.danger', { type: 'button', onclick: e => setStatus(e.currentTarget, m, 'disabled') }, 'رفض'))))
        : h('p.muted', 'لا توجد طلبات جديدة.'),
      h('p.small.muted', 'رابط التسجيل لمشاركته مع المترجمين: ', h('span', { dir: 'ltr' }, location.origin + '/register'))),
    h('div.grid', { style: { margin: '16px 0' } }, h('label.field', 'بحث', q), h('label.field', 'اللغة', filterLang), h('label.field', 'الحالة', filterStatus)),
    table);
}
