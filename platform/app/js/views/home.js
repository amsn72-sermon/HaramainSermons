// لوحة المتابعة (المنسق والمدير)، والمترجم يُحوَّل إلى مهامه
import { h, fill, emptyState, fmtSermonDate, toast, busy, dialog, confirm } from '../ui.js';
import { db } from '../sb.js';
import { state, isAdmin, isManager, MATERIAL_SELECT, MOSQUE, MOSQUE_ANY, CITY, PRIORITY, sortStages, currentStage, trackProgress,
  isLateNow, hadLateness, langName, stageName } from '../store.js';
import { statusBadge, trackTimer, progressBar, stageStrip, timelineTable, lateSummary, deleteDialog } from './parts.js';

export async function render(ctx) {
  if (!isAdmin()) { const m = await import('./tasks.js'); return m.list(ctx); }

  const all = await db.select('materials', { select: MATERIAL_SELECT, order: 'created_at.desc', limit: 300 });
  // المحذوف لا يظهر في قائمة العمل (ملاحظة ٦٦)
  const materials = all.filter(m => !m.deleted_at);
  materials.forEach(m => { m.tracks = (m.tracks || []).filter(t => !t.deleted_at); m.tracks.forEach(sortStages); });

  const filters = {
    q: h('input', { type: 'search', placeholder: 'عنوان المادة أو اسم المسؤول', 'aria-label': 'البحث' }),
    mosque: h('select', { 'aria-label': 'الموقع' }, h('option', { value: '' }, 'كل المواقع'), Object.entries(MOSQUE).map(([k, v]) => h('option', { value: k }, v))),
    lang: h('select', { 'aria-label': 'اللغة' }, h('option', { value: '' }, 'كل اللغات'), state.languages.map(l => h('option', { value: l.code }, l.name_ar))),
    status: h('select', { 'aria-label': 'الحالة' },
      h('option', { value: '' }, 'كل الحالات'),
      h('option', { value: 'awaiting_receipt' }, 'بانتظار الاستلام'),
      state.stages.map(s => h('option', { value: 'stage:' + s.key }, s.name_ar)),
      h('option', { value: 'completed' }, 'مكتملة'),
      h('option', { value: 'late_now' }, 'متأخرة الآن'),
      h('option', { value: 'had_late' }, 'سُجّل فيها تأخير'))
  };
  const out = h('div');
  Object.values(filters).forEach(el => el.addEventListener('input', draw));

  function rows() {
    const q = filters.q.value.trim();
    const list = [];
    for (const m of materials) {
      if (filters.mosque.value && m.mosque !== filters.mosque.value) continue;
      for (const t of m.tracks) {
        if (filters.lang.value && t.language_code !== filters.lang.value) continue;
        const cur = currentStage(t);
        const st = filters.status.value;
        if (st === 'awaiting_receipt' && t.status !== 'awaiting_receipt') continue;
        if (st === 'completed' && t.status !== 'completed') continue;
        if (st.startsWith('stage:') && cur?.stage_key !== st.slice(6)) continue;
        if (st === 'late_now' && !isLateNow(t)) continue;
        if (st === 'had_late' && !hadLateness(t)) continue;
        if (q && !(m.title.includes(q) || t.stages.some(s => s.assignee?.full_name?.includes(q)))) continue;
        list.push({ m, t, cur });
      }
    }
    return list;
  }

  function draw() {
    const list = rows();
    const mats = new Set(list.map(r => r.m.id));
    const totalStages = list.reduce((a, r) => a + r.t.stages.length, 0);
    const doneStages = list.reduce((a, r) => a + trackProgress(r.t).done, 0);
    const kpi = (label, value, note, kind = '') => h('div.kpi', { class: kind }, h('span', label), h('b', value), h('small', note));
    const mine = list.filter(r => r.cur?.assignee_id === state.profile.id);

    fill(out,
      h('div.kpis',
        kpi('المواد', mats.size, 'ضمن التصفية الحالية'),
        kpi('مسارات اللغات', list.length, 'مسار مستقل لكل لغة'),
        kpi('بانتظار الاستلام', list.filter(r => r.t.status === 'awaiting_receipt').length, 'لم يقبلها المترجم بعد', 'warn'),
        kpi('بانتظار المنسق', list.filter(r => r.cur?.stage_key === 'coordinator_receipt').length, 'للقبول'),
        kpi('متأخرة الآن', list.filter(r => isLateNow(r.t)).length, 'تجاوزت موعد مرحلتها الحالية', 'bad'),
        kpi('سُجّل فيها تأخير', list.filter(r => hadLateness(r.t)).length, 'ولو اكتملت لاحقًا', 'warn'),
        kpi('الإنجاز الكلي', (totalStages ? Math.round(doneStages / totalStages * 100) : 0) + '٪', `${doneStages} من ${totalStages} مرحلة`, 'ok')),

      mine.length ? h('div.card', h('h3', `بانتظار إجرائك (${mine.length})`),
        h('div.row', mine.map(r => h('a.btn', { href: `/app/tasks/${r.t.id}` }, `${r.m.title} — ${langName(r.t.language_code)} · ${stageName(r.cur.stage_key)}`)))) : null,

      h('div.grid-2', { style: { margin: '16px 0' } },
        h('div.card', h('h3', 'توزيع الأعمال حسب المرحلة'),
          h('div.stack', { style: { gap: '8px' } },
            [['بانتظار الاستلام', list.filter(r => r.t.status === 'awaiting_receipt').length],
             ...state.stages.map(s => [s.name_ar, list.filter(r => r.cur?.stage_key === s.key).length]),
             ['مكتملة', list.filter(r => r.t.status === 'completed').length]]
              .map(([label, n]) => h('div', h('div.row', h('span', { style: { flex: 1 } }, label), h('b', n)),
                h('div.progress', h('i', { style: { width: (list.length ? n / list.length * 100 : 0) + '%' } }))))) ),
        h('div.card', h('h3', 'إنجاز المواقع'),
          h('div.stack', Object.keys(MOSQUE).map(k => {
            const rs = list.filter(r => r.m.mosque === k);
            const tot = rs.reduce((a, r) => a + r.t.stages.length, 0), dn = rs.reduce((a, r) => a + trackProgress(r.t).done, 0);
            const pct = tot ? Math.round(dn / tot * 100) : 0;
            return h('div', h('div.row', h('b', { style: { flex: 1 } }, CITY[k]), h('span', pct + '٪')),
              h('span.small.muted', `${new Set(rs.map(r => r.m.id)).size} مادة · ${rs.length} مسار لغة · اكتمل ${rs.filter(r => r.t.status === 'completed').length}`),
              h('div.progress', h('i', { style: { width: pct + '%' } })));
          })))),

      h('h3', `قائمة العمل (${list.length})`),
      list.length ? h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['المادة واللغة', 'المرحلة / المسؤول', 'الإنجاز', 'الوقت', ''].map(t => h('th', t)))),
        h('tbody', list.map(({ m, t, cur }) => h('tr',
          h('td', { 'data-label': 'المادة' }, h('b', m.title), h('span.sub', `${langName(t.language_code)} · ${MOSQUE_ANY[m.mosque] || '—'}${m.priority !== 'normal' ? ' · ' + PRIORITY[m.priority] : ''}`), lateSummary(t)),
          h('td', { 'data-label': 'المرحلة' }, statusBadge(t), h('span.sub', cur?.assignee?.full_name || (t.status === 'awaiting_receipt' ? t.stages[0]?.assignee?.full_name : '') || '')),
          h('td', { 'data-label': 'الإنجاز' }, progressBar(t)),
          h('td', { 'data-label': 'الوقت' }, trackTimer(t)),
          h('td', h('div.row',
            h('a.btn.sm', { href: `/app/tasks/${t.id}` }, 'فتح'),
            h('button.btn.sm', { type: 'button', onclick: () => showDetails(m) }, 'تفاصيل'),
            isManager() && h('button.btn.sm.danger', { type: 'button', onclick: e => busy(e.currentTarget, async () => {
              try { if (await deleteDialog({ material: m, track: t, langLabel: langName(t.language_code) })) { toast('حُذفت من الأرشيف، ويمكن استرجاعها.', 'ok'); reload(); } }
              catch (err) { toast(err.message, 'bad'); }
            }) }, 'حذف'))))))))
        : emptyState(materials.length ? 'لا نتائج مطابقة' : 'جاهز لأول مادة', materials.length ? 'غيّر عوامل التصفية.' : 'أضف الخطبة وحدد لغاتها وفريقها لتظهر متابعتها هنا.',
          !materials.length && h('a.btn.primary', { href: '/app/new' }, '＋ إضافة مادة')),
      details);
  }

  const details = h('div', { style: { marginTop: '16px' } });
  let members = null;
  const loadMembers = async () => members || (members = await db.select('profiles', {
    select: 'id,full_name,role,member_languages(language_code)', status: 'eq.active', order: 'full_name.asc' }));
  const reload = () => ctx.navigate(location.pathname + location.search, { replace: true });

  // تغيير مسؤول مرحلة لم تكتمل (ومنها المترجم قبل الاستلام أو أثناءه)
  async function reassign(t, s) {
    const def = state.stages.find(x => x.key === s.stage_key);
    const all = await loadMembers();
    const ok = all.filter(p => p.id !== s.assignee_id && (
      def.assignee_role === 'translator' ? (p.member_languages || []).some(l => l.language_code === t.language_code)
        : def.assignee_role === 'coordinator' ? ['coordinator', 'manager'].includes(p.role) : p.role === 'manager'));
    if (!ok.length) return toast('لا يوجد عضو مفعّل آخر مؤهل لهذه المرحلة في هذه اللغة.', 'bad');
    const pick = h('select', ok.map(p => h('option', { value: p.id }, p.full_name)));
    const chosen = await dialog({
      title: `تغيير المسؤول — ${stageName(s.stage_key)} (${langName(t.language_code)})`,
      body: h('div.stack', h('p.small', 'المسؤول الحالي: ', h('b', s.assignee?.full_name || '—')), h('label.field', 'المسؤول الجديد', pick),
        s.status === 'active' || t.status === 'awaiting_receipt' ? h('p.small.muted', 'تنتقل المهمة فورًا إلى المسؤول الجديد وتُغلق عن السابق، ويُحفظ ما كُتب من الترجمة.') : null),
      buttons: [{ label: 'تغيير المسؤول', kind: 'primary', value: () => pick.value }, { label: 'إلغاء', value: null }]
    });
    if (!chosen) return;
    try { await db.rpc('reassign_stage', { p_track: t.id, p_stage: s.stage_key, p_assignee: chosen }); toast('تم تغيير المسؤول.', 'ok'); reload(); }
    catch (err) { toast(err.message, 'bad'); }
  }
  async function cancelTrack(m, t) {
    const last = m.tracks.length === 1;
    const ok = await confirm('إلغاء إسناد اللغة',
      `سيُلغى مسار «${langName(t.language_code)}» لهذه المادة بكل مراحله وما كُتب فيه${last ? '، ولأنه المسار الوحيد ستُحذف المادة كلها' : ''}. لا يمكن التراجع.`,
      'إلغاء الإسناد', 'danger');
    if (!ok) return;
    try { await db.rpc('cancel_track', { p_track: t.id }); toast('أُلغي الإسناد.', 'ok'); reload(); }
    catch (err) { toast(err.message, 'bad'); }
  }

  function showDetails(m) {
    details.replaceChildren(h('div.card',
      h('div.row', h('h3', { style: { flex: 1 } }, `تفاصيل: ${m.title}`), h('button.btn.sm', { onclick: () => details.replaceChildren() }, 'إغلاق')),
      h('p.muted.small', [MOSQUE_ANY[m.mosque], m.khateeb?.name, m.sermon_date && fmtSermonDate(m.sermon_date), PRIORITY[m.priority]].filter(Boolean).join(' · ')),
      h('div.stack', m.tracks.map(t => h('div.stack', { style: { gap: '8px' } },
        h('div.row', h('b', langName(t.language_code)), statusBadge(t), lateSummary(t), h('span', { style: { flex: 1 } }),
          t.status !== 'completed' && h('button.btn.sm.danger', { type: 'button', onclick: e => busy(e.currentTarget, () => cancelTrack(m, t)) }, 'إلغاء إسناد اللغة')),
        stageStrip(t),
        t.status !== 'completed' && h('div.row', { style: { gap: '6px' } }, h('span.small.muted', 'تغيير المسؤول:'),
          t.stages.filter(s => s.status !== 'done').map(s => h('button.btn.sm', { type: 'button', onclick: e => busy(e.currentTarget, () => reassign(t, s)) },
            `${stageName(s.stage_key)} — ${s.assignee?.full_name || '—'}`))),
        timelineTable(t))))));
    details.scrollIntoView({ behavior: 'smooth' });
  }

  draw();
  // عدّاد الإنتاج في صدر الشاشة — يفتح دليل الإنتاج (ملاحظة ٩٠)
  const chipBox = h('div');
  import('./stats.js').then(m => m.counterChip()).then(el => el && chipBox.replaceChildren(el)).catch(() => {});

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'متابعة التنفيذ'), h('h1', 'لوحة أعمال الترجمة'),
      h('p.muted', 'من الإسناد إلى قبول المنسق، ثم اعتماد المدير والنشر.')),
      chipBox,
      h('a.btn.primary', { href: '/app/new' }, '＋ إضافة مادة')),
    h('div.grid', { style: { marginBottom: '16px' } }, h('label.field', 'البحث', filters.q), h('label.field', 'الموقع', filters.mosque),
      h('label.field', 'اللغة', filters.lang), h('label.field', 'الحالة', filters.status)),
    out);
}
