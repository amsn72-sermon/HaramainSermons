// لوحة المتابعة (المنسق والمدير)، والمترجم يُحوَّل إلى مهامه
import { h, fill, emptyState, fmtSermonDate, fmtDate, fmtDateTime, toast, busy, dialog, confirm } from '../ui.js';
import { db } from '../sb.js';
import { state, isAdmin, isManager, MATERIAL_SELECT, MOSQUE, MOSQUE_ANY, CITY, PRIORITY, sortStages, currentStage, trackProgress,
  isLateNow, hadLateness, langName, stageName } from '../store.js';
import { statusBadge, trackTimer, progressBar, stageStrip, timelineTable, lateSummary, deleteDialog } from './parts.js';

// أيقونات سطر العمل (ملاحظة ١٧٨)
const WORK_ICONS = {
  open: '<path d="M14 4h6v6"/><path d="M20 4L10 14"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>'
};
function wIcon(name) {
  const sp = document.createElement('span');
  sp.className = 'ico';
  sp.setAttribute('aria-hidden', 'true');
  sp.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${WORK_ICONS[name]}</svg>`;
  return sp;
}
// نوع العمل: الخطبة بنوعها، وغيرها بنوع مادته
const workKind = m => m.sermon_type || m.material_type || 'مادة';
// صاحب العمل: الخطيب أو المؤلف أو من نُسب إليه
const workAuthor = m => m.khateeb?.name || m.author || '—';

// موعد ما هو قائم الآن: الاستلام قبل القبول، ثم موعد المرحلة الجارية
const dueOf = t => (t.status === 'awaiting_receipt' ? t.receipt_due_at : currentStage(t)?.due_at) || null;
const hoursLeft = t => { const d = dueOf(t); return d ? (new Date(d) - Date.now()) / 36e5 : null; };
// درجة الاستعجال: ٠ متأخر، ١ يستحق خلال يوم، ٢ مطمئن، ٣ مكتمل
function urgency(t) {
  if (t.status === 'completed') return 3;
  if (isLateNow(t)) return 0;
  const h2 = hoursLeft(t);
  return (h2 !== null && h2 <= 24) ? 1 : 2;
}
const URGENCY_CLASS = ['u-late', 'u-soon', '', 'u-done'];

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
      h('option', { value: 'due_soon' }, 'تستحق خلال ٢٤ ساعة'),
      h('option', { value: 'had_late' }, 'سُجّل فيها تأخير'))
  };
  const out = h('div');
  // المنجز مطويٌّ أسفل القائمة حتى يُطلب (ملاحظة ١٩١)
  let showDone = false;
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
        if (st === 'due_soon' && urgency(t) !== 1) continue;
        if (st === 'had_late' && !hadLateness(t)) continue;
        if (q && !(m.title.includes(q) || t.stages.some(s => s.assignee?.full_name?.includes(q)))) continue;
        list.push({ m, t, cur });
      }
    }
    // الأولوية: المتأخر أولًا، ثم الأقرب موعدًا، ثم المكتمل آخرًا (ملاحظة ١٠٧)
    list.sort((a, b) => {
      const ua = urgency(a.t), ub = urgency(b.t);
      if (ua !== ub) return ua - ub;
      const da = dueOf(a.t), db2 = dueOf(b.t);
      if (da && db2) return new Date(da) - new Date(db2);
      return da ? -1 : db2 ? 1 : 0;
    });
    return list;
  }

  // الضغط على أي مؤشر يفتح تفصيله في قائمة العمل أسفله (ملاحظة ١٠٧)
  function focusOn(value) {
    filters.status.value = value;
    draw();
    setTimeout(() => workHead.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  }

  function draw() {
    const list = rows();
    const mats = new Set(list.map(r => r.m.id));
    const totalStages = list.reduce((a, r) => a + r.t.stages.length, 0);
    const doneStages = list.reduce((a, r) => a + trackProgress(r.t).done, 0);
    const mine = list.filter(r => r.cur?.assignee_id === state.profile.id);
    // بطاقة مؤشر: تُضغط فتُصفّي القائمة، وتُبرز إن كانت هي التصفية الجارية
    const kpi = (icon, label, value, note, kind = '', focus = null) => {
      const on = focus !== null && filters.status.value === focus;
      const el = h(focus === null ? 'div.kpi' : 'button.kpi', { class: `${kind}${on ? ' on' : ''}`,
        type: focus === null ? null : 'button', 'aria-pressed': focus === null ? null : String(on) },
        h('i.kpi-icon', { 'aria-hidden': 'true' }, icon),
        h('span', label), h('b', value), h('small', note));
      if (focus !== null) el.onclick = () => focusOn(on ? '' : focus);
      return el;
    };
    const soon = list.filter(r => urgency(r.t) === 1);

    // غير المنجز أولًا، والمنجز في سطوره المختصرة أسفل — إلا أن تُطلب
    // «مكتملة» صراحةً فيُعرض في الجدول نفسه (ملاحظة ١٩١)
    const wantDone = filters.status.value === 'completed';
    const open = wantDone ? list : list.filter(r => r.t.status !== 'completed');
    const done = wantDone ? [] : list.filter(r => r.t.status === 'completed');
    drawDone(done);

    const clearBtn = h('button.btn.sm', { type: 'button' }, 'إزالة التصفية');
    clearBtn.onclick = () => { filters.status.value = ''; filters.q.value = ''; draw(); };
    workHead.replaceChildren(
      h('div.row.between',
        h('h3', `قائمة العمل القائم (${open.length})`),
        (filters.status.value || filters.q.value.trim())
          ? h('div.row', { style: { gap: '8px' } },
              h('span.badge.gold', filters.status.value ? focusLabel(filters.status.value) : `بحث: ${filters.q.value.trim()}`),
              clearBtn)
          : null));

    fill(out,
      h('div.kpis',
        kpi('▤', 'المواد', mats.size, 'ضمن التصفية الحالية'),
        kpi('◈', 'مسارات اللغات', list.length, 'مسار مستقل لكل لغة'),
        kpi('⏳', 'بانتظار الاستلام', list.filter(r => r.t.status === 'awaiting_receipt').length, 'لم يقبلها المترجم بعد', 'warn', 'awaiting_receipt'),
        kpi('✓', 'بانتظار المنسق', list.filter(r => r.cur?.stage_key === 'coordinator_receipt').length, 'للقبول', '', 'stage:coordinator_receipt'),
        kpi('⏱', 'متأخرة الآن', list.filter(r => isLateNow(r.t)).length, 'تجاوزت موعد مرحلتها الحالية', 'bad', 'late_now'),
        kpi('◔', 'تستحق خلال ٢٤ ساعة', soon.length, 'اقترب موعد تسليمها', 'warn', 'due_soon'),
        kpi('⟲', 'سُجّل فيها تأخير', list.filter(r => hadLateness(r.t)).length, 'ولو اكتملت لاحقًا', 'warn', 'had_late'),
        kpi('◉', 'الإنجاز الكلي', (totalStages ? Math.round(doneStages / totalStages * 100) : 0) + '٪', `${doneStages} من ${totalStages} مرحلة`, 'ok')),

      prodBox,

      mine.length ? h('div.card', h('h3', `بانتظار إجرائك (${mine.length})`),
        h('div.row', mine.map(r => h('a.btn', { href: `/app/tasks/${r.t.id}` }, `${r.m.title} — ${langName(r.t.language_code)} · ${stageName(r.cur.stage_key)}`)))) : null,

      h('div.grid-2', { style: { margin: '16px 0' } },
        h('div.card.stack', h('h3', 'توزيع الأعمال حسب المرحلة'),
          h('p.small.muted', 'اضغط المرحلة لترى من عنده العمل الآن، وكم بقي له، ومن تأخّر منهم.'),
          h('div.kpis.stage-tiles',
            [['⏳', 'بانتظار الاستلام', list.filter(r => r.t.status === 'awaiting_receipt'), 'awaiting_receipt'],
             ...state.stages.map(st => ['◈', st.name_ar, list.filter(r => r.cur?.stage_key === st.key), 'stage:' + st.key]),
             ['✔', 'مكتملة', list.filter(r => r.t.status === 'completed'), 'completed']]
              .map(([icon, label, items, focus]) => {
                const late = items.filter(r => isLateNow(r.t)).length;
                const soon = items.filter(r => urgency(r.t) === 1).length;
                const on = filters.status.value === focus;
                const tile = h('button.kpi.stage-tile', { type: 'button',
                  class: [on ? 'on' : '', late ? 'bad' : (soon ? 'warn' : '')].join(' ').trim(),
                  title: 'اضغط لعرض تفصيلها' },
                  h('i.kpi-icon', { 'aria-hidden': 'true' }, icon),
                  h('span', label),
                  h('b', String(items.length)),
                  h('small', late ? `${late} متأخر` : (soon ? `${soon} يستحق اليوم` : (items.length ? 'في الموعد' : '—'))));
                tile.onclick = () => stageDialog(label, items, focus);
                return tile;
              }))),
        h('div.card', h('h3', 'إنجاز المواقع'),
          h('div.stack', Object.keys(MOSQUE).map(k => {
            const rs = list.filter(r => r.m.mosque === k);
            const tot = rs.reduce((a, r) => a + r.t.stages.length, 0), dn = rs.reduce((a, r) => a + trackProgress(r.t).done, 0);
            const pct = tot ? Math.round(dn / tot * 100) : 0;
            return h('div', h('div.row', h('b', { style: { flex: 1 } }, CITY[k]), h('span', pct + '٪')),
              h('span.small.muted', `${new Set(rs.map(r => r.m.id)).size} مادة · ${rs.length} مسار لغة · اكتمل ${rs.filter(r => r.t.status === 'completed').length}`),
              h('div.progress', h('i', { style: { width: pct + '%' } })));
          })))),

      (() => {
        // عند من العمل الآن: كل مسؤول وما بيده، والمتأخر منه (ملاحظة ١٠٧)
        const by = new Map();
        for (const r of list) {
          if (r.t.status === 'completed') continue;
          const who = r.cur?.assignee || (r.t.status === 'awaiting_receipt' ? r.t.stages[0]?.assignee : null);
          if (!who) continue;
          const e = by.get(who.id) || { name: who.full_name, n: 0, late: 0, soon: 0, stages: new Set() };
          e.n++; if (isLateNow(r.t)) e.late++; else if (urgency(r.t) === 1) e.soon++;
          if (r.cur?.stage_key) e.stages.add(stageName(r.cur.stage_key));
          by.set(who.id, e);
        }
        const people = [...by.values()].sort((a, b) => b.late - a.late || b.n - a.n);
        if (!people.length) return null;
        return h('div.card.stack', { style: { margin: '16px 0' } },
          h('div.row.between', h('h3', 'عند مَن العمل الآن'), h('span.badge', `${people.length} مسؤولًا`)),
          h('div.who-grid', people.map(p => {
            const card = h('button.who-card', { type: 'button', title: 'عرض أعماله' },
              h('div.row.between', h('b', p.name), h('span.who-n', p.n)),
              h('div.small.muted', [...p.stages].join(' · ') || 'بانتظار الاستلام'),
              h('div.row', { style: { gap: '6px', marginTop: '6px' } },
                p.late ? h('span.badge.bad', `${p.late} متأخر`) : null,
                p.soon ? h('span.badge.warn', `${p.soon} يستحق اليوم`) : null,
                (!p.late && !p.soon) ? h('span.badge.ok', 'في الموعد') : null));
            card.onclick = () => { filters.q.value = p.name; draw(); setTimeout(() => workHead.scrollIntoView({ behavior: 'smooth' }), 30); };
            return card;
          })));
      })(),

      dueBox,
      workHead,
      doneBox,
      // كل عمل في سطرٍ واحد: نوعه واسمه وصاحبه ولغته، ثم مرحلته وإنجازه ووقته،
      // ثم أيقونات الفتح والتفصيل والحذف (ملاحظة ١٧٨)
      open.length ? h('div.table-wrap', h('table.responsive.work-table',
        h('thead', h('tr', ['النوع', 'العمل', 'الخطيب أو المؤلف', 'اللغة',
          'المرحلة / المسؤول', 'الإنجاز', 'الوقت', ''].map(t => h('th', t)))),
        h('tbody', open.map(({ m, t, cur }) => h('tr', { class: URGENCY_CLASS[urgency(t)] },
          h('td', { 'data-label': 'النوع' }, h('span.small', workKind(m)),
            m.priority !== 'normal' ? h('span.badge.warn', PRIORITY[m.priority]) : null),
          h('td', { 'data-label': 'العمل' }, h('b.w-title', { title: m.title }, m.title), lateSummary(t)),
          h('td', { 'data-label': 'الخطيب أو المؤلف' }, h('span.small', workAuthor(m)),
            h('span.sub', MOSQUE_ANY[m.mosque] || '')),
          h('td', { 'data-label': 'اللغة' }, h('span.small', langName(t.language_code))),
          h('td', { 'data-label': 'المرحلة' }, statusBadge(t), h('span.sub', cur?.assignee?.full_name || (t.status === 'awaiting_receipt' ? t.stages[0]?.assignee?.full_name : '') || '')),
          h('td', { 'data-label': 'الإنجاز' }, progressBar(t)),
          h('td', { 'data-label': 'الوقت' }, trackTimer(t)),
          h('td', h('div.row.w-acts',
            h('a.icon-btn', { href: `/app/tasks/${t.id}`, title: 'فتح العمل', 'aria-label': 'فتح العمل' }, wIcon('open')),
            h('button.icon-btn', { type: 'button', title: 'تفاصيل', 'aria-label': 'تفاصيل',
              onclick: () => showDetails(m) }, wIcon('info')),
            isManager() && h('button.icon-btn.danger', { type: 'button', title: 'حذف', 'aria-label': 'حذف',
              onclick: e => busy(e.currentTarget, async () => {
                try { if (await deleteDialog({ material: m, track: t, langLabel: langName(t.language_code) })) { toast('حُذفت من الأرشيف، ويمكن استرجاعها.', 'ok'); reload(); } }
                catch (err) { toast(err.message, 'bad'); }
              }) }, wIcon('trash')))))))))
        : emptyState(materials.length ? (done.length ? 'لا عملٌ قائم' : 'لا نتائج مطابقة') : 'جاهز لأول مادة',
          materials.length
            ? (done.length ? 'ما في التصفية الحالية أُنجز كلُّه — انظر المنجز أسفله.' : 'غيّر عوامل التصفية.')
            : 'أضف الخطبة وحدد لغاتها وفريقها لتظهر متابعتها هنا.',
          !materials.length && h('a.btn.primary', { href: '/app/new' }, '＋ إضافة مادة')),
      details);
  }

  // المنجز: سطرٌ مختصر لكل عمل، أخضر إن سُلّم في وقته وأحمر إن تأخّر
  // — بتنسيق أرشيف الترجمة (ملاحظة ١٩١)
  // ---------- مواعيدُ النصوص بعدد الصفحات ونوع المهمة (ملاحظة ١٩٧) ----------
  // العقد يجعل مدّة تسليم النصوص بعدد الصفحات ونوع المهمة، فتُعرف من المادة
  // نفسها: ما قارب موعدَه وما تجاوزه — قبل أن يُسأل عنه.
  const dueBox = h('div.stack');
  const ar = n => Number(n || 0).toLocaleString('en-US');
  const URG = { normal: 'اعتيادية', urgent: 'عاجلة', emergency: 'طارئة' };
  (async () => {
    let rows = [];
    try { rows = await db.rpc('texts_due'); } catch { return; }
    rows = Array.isArray(rows) ? rows : [];
    // ما مضى موعدُه، وما بقي له أقلُّ من ربع مهلته
    const hot = rows.filter(r => r.overdue
      || Number(r.minutes_left) <= Number(r.hours) * 60 / 4);
    if (!hot.length) return;
    const late = hot.filter(r => r.overdue).length;
    dueBox.replaceChildren(h('div.card.stack', { style: { margin: '16px 0' } },
      h('div.row.between',
        h('h3', 'مواعيدُ النصوص'),
        h('span.badge', { class: late ? 'bad' : 'warn' },
          late ? `${ar(late)} تجاوز موعدَه` : `${ar(hot.length)} قارب موعدَه`)),
      h('p.small.muted', { style: { margin: 0 } },
        'مدّةُ التسليم في العقد بعدد الصفحات ونوع المهمة، وتُحسب من وقت الاستلام.'),
      h('div.stack', hot.slice(0, 8).map(r => h('div.row.between.meet-row.due-row',
        { class: r.overdue ? 'overdue' : 'soon' },
        h('div',
          h('b', r.title),
          h('span.sub', [r.material_type, URG[r.urgency] || r.urgency,
            r.pages ? `${ar(r.pages)} صفحة` : null, r.label,
            r.needs_review ? 'سطرٌ يحتاج استيضاحًا من الهيئة' : null]
            .filter(Boolean).join(' · '))),
        h('div.row',
          h('span.small', { class: r.overdue ? 'bad' : 'warn' },
            r.overdue
              ? `تجاوز بـ${ar(Math.round(-Number(r.minutes_left) / 60))} ساعة`
              : `بقي ${ar(Math.max(0, Math.round(Number(r.minutes_left) / 60)))} ساعة`),
          h('span.badge', `${ar(r.open_tracks)} لغة مفتوحة`))))),
      hot.length > 8
        ? h('p.small.muted', `وغيرُها ${ar(hot.length - 8)}.`) : null));
  })();

  const doneBox = h('div.stack.done-box');
  function drawDone(done) {
    if (!done.length) { doneBox.replaceChildren(); return; }
    const late = done.filter(r => hadLateness(r.t)).length;
    const toggle = h('button.btn.sm', { type: 'button', 'aria-expanded': String(showDone) },
      showDone ? 'إخفاء المنجز' : `عرض المنجز (${done.length})`);
    toggle.onclick = () => { showDone = !showDone; draw(); };

    const head = h('div.row.between.done-head',
      h('div.row', { style: { gap: '8px' } },
        h('h3', 'المنجز'),
        h('span.badge.ok', `${done.length - late} في وقته`),
        late ? h('span.badge.bad', `${late} متأخر`) : null),
      toggle);

    doneBox.replaceChildren(head, showDone
      ? h('ul.meet-list.done-list', done
          .slice()
          .sort((a, b) => new Date(b.t.completed_at || 0) - new Date(a.t.completed_at || 0))
          .slice(0, 120)
          .map(({ m, t }) => {
            const wasLate = hadLateness(t);
            return h('li.meet-row', { class: wasLate ? 'late' : 'ontime' },
              h('span.done-mark', { class: wasLate ? 'bad' : 'ok',
                title: wasLate ? 'سُلّم متأخرًا' : 'سُلّم في وقته', 'aria-hidden': 'true' },
                wasLate ? '!' : '✓'),
              h('span.mr-title', h('b', { title: m.title }, m.title),
                h('span.small.muted', ` · ${langName(t.language_code)}`)),
              h('span.small.muted.mr-meta',
                `${workKind(m)} · ${workAuthor(m)}`,
                t.completed_at ? h('span.sep', ' · ') : null,
                t.completed_at ? h('span', fmtDate(t.completed_at)) : null,
                wasLate ? h('span.bad', ' · سُجّل فيه تأخير') : null),
              h('span.row.mr-acts',
                h('a.icon-btn', { href: `/app/tasks/${t.id}`, title: 'فتح العمل',
                  'aria-label': 'فتح العمل' }, wIcon('open')),
                h('button.icon-btn', { type: 'button', title: 'تفاصيل', 'aria-label': 'تفاصيل',
                  onclick: () => showDetails(m) }, wIcon('info'))));
          }))
      : h('p.small.muted', 'أُنجزت وأُغلقت — تُفتح عند الحاجة، وتفصيلها في أرشيف الترجمة.'));
  }

  // تفصيل المرحلة: من عنده العمل الآن وكم بقي له (ملاحظة ١٢٨)
  async function stageDialog(label, items, focus) {
    if (!items.length) {
      await dialog({ title: label, body: h('p.muted', 'لا أعمال في هذه المرحلة الآن.'),
        buttons: [{ label: 'إغلاق', value: null }] });
      return;
    }
    const rows = items.slice().sort((a, b) => urgency(a.t) - urgency(b.t)).map(({ m, t, cur }) => {
      const who = cur?.assignee?.full_name
        || (t.status === 'awaiting_receipt' ? t.stages[0]?.assignee?.full_name : '') || '—';
      const late = isLateNow(t);
      return h('tr', { class: URGENCY_CLASS[urgency(t)] },
        h('td', { 'data-label': 'المسؤول' }, h('b', who),
          late ? h('div.small.bad', 'متأخر') : (urgency(t) === 1 ? h('div.small.warn', 'يستحق اليوم') : null)),
        h('td', { 'data-label': 'المادة' }, m.title,
          h('div.small.muted', `${MOSQUE_ANY[m.mosque] || '—'}${m.priority !== 'normal' ? ' · ' + PRIORITY[m.priority] : ''}`)),
        h('td', { 'data-label': 'اللغة' }, langName(t.language_code)),
        h('td', { 'data-label': 'الوقت' }, trackTimer(t)),
        h('td', h('a.btn.sm', { href: `/app/tasks/${t.id}` }, 'فتح')));
    });
    const lateN = items.filter(r => isLateNow(r.t)).length;
    const v = await dialog({
      title: `${label} (${items.length})`,
      body: h('div.stack',
        lateN ? h('p.small.bad', `${lateN} منها تجاوز موعده — يحسن الاتصال بأصحابها واستعجالهم.`) : null,
        h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['المسؤول', 'المادة', 'اللغة', 'الوقت', ''].map(t2 => h('th', t2)))),
          h('tbody', rows)))),
      buttons: [{ label: 'عرضها في قائمة العمل', kind: 'primary', value: 'focus' }, { label: 'إغلاق', value: null }]
    });
    if (v === 'focus') { focusOn(focus); setTimeout(() => workHead.scrollIntoView({ behavior: 'smooth' }), 30); }
  }

  // أيقونتان من دليل الإنتاج: ما تُرجم كلماتٍ ودقائقَ (ملاحظة ١٢٩)
  const prodBox = h('div.kpis.prod-kpis');
  db.rpc('production_totals').then(t => {
    const row = Array.isArray(t) ? t[0] : t;
    if (!row) return;
    const n = v => Number(v || 0).toLocaleString('en-US');
    const tile = (icon, label, value, note) => {
      const el = h('a.kpi.prod-kpi', { href: '/app/stats', title: 'دليل الإنتاج' },
        h('i.kpi-icon', { 'aria-hidden': 'true' }, icon),
        h('span', label), h('b', value), h('small', note));
      return el;
    };
    prodBox.replaceChildren(
      tile('✍', 'الكلمات المحتسَبة', n(row.counted_words),
        'كلمات الأصل العربي للنصوص — والخطبُ بالمقطوعية'),
      tile('🎙', 'دقائق التسجيل', n(Math.round(Number(row.audio_seconds || 0) / 60)), 'الصوت المسلَّم مع الترجمات'));
  }).catch(() => {});

  const workHead = h('div.work-head');
  const FOCUS_LABEL = {
    awaiting_receipt: 'بانتظار الاستلام', completed: 'مكتملة', late_now: 'متأخرة الآن',
    due_soon: 'تستحق خلال ٢٤ ساعة', had_late: 'سُجّل فيها تأخير'
  };
  const focusLabel = v => (v.startsWith('stage:') ? stageName(v.slice(6)) : FOCUS_LABEL[v] || '');

  const details = h('div', { style: { marginTop: '16px' } });
  let members = null;
  // فريق الإرشاد المكاني لا تُسنَد إليه مراحل ترجمة، إلا المتميّز فبلغته (ملاحظتا ٩٩ و١٧٣)
  const loadMembers = async () => members || (members = (await db.select('profiles', {
    select: 'id,full_name,role,track,may_translate,member_languages(language_code)',
    status: 'eq.active', order: 'full_name.asc' }))
    .filter(m => m.may_translate));
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

  // بطاقةُ النسخ الاحتياطية: يراها المديرُ كلَّ يومٍ بعينه (ملاحظة ٢٤٧ د)
  const backupCard = h('div');
  if (isManager()) {
    (async () => {
      try {
        const out = await db.rpc('backup_state');
        const b = (Array.isArray(out) ? out[0] : out) || {};
        if (!b.last_run && !b.last_ok) return;
        const mb = n => (n ? `${(Number(n) / 1048576).toFixed(1)} م.ب` : '—');
        const hrs = b.hours == null ? null : Number(b.hours);
        const stale = hrs == null || hrs > 36;
        backupCard.replaceChildren(h('section.card.stack.backup-card',
          { class: stale || b.fails ? 'warn' : 'ok' },
          h('div.row.between.wrap',
            h('b', '🛡 النسخة الاحتياطية'),
            h('span.badge' + (stale || b.fails ? '.warn' : '.ok'),
              hrs == null ? 'لا نسخةَ ناجحةٍ بعد'
                : hrs < 1 ? 'منذ أقلَّ من ساعة' : `منذ ${hrs} ساعة`)),
          h('p.small.muted',
            b.last_ok ? `آخرُ نسخةٍ ناجحة: ${fmtDateTime(b.last_ok)} — `
              + `قاعدةُ البيانات ${mb(b.db_bytes)} والملفات ${mb(b.files_bytes)}.`
              : 'لم تُسجَّل نسخةٌ ناجحةٌ بعد.'),
          b.fails ? h('p.small.warn', `وفشلت ${b.fails} محاولةً منذ آخر نجاح — راجع سجلَّ الخادم.`) : null,
          stale ? h('p.small.warn', 'مضى على آخر نسخةٍ أكثرُ من يومٍ ونصف. '
            + 'والنسخةُ التي تتوقّف صامتةً أسوأُ من عدمها.') : null));
      } catch { /* لا تمنع الشاشة */ }
    })();
  }

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'متابعة التنفيذ'), h('h1', 'لوحة أعمال الترجمة'),
      h('p.muted', 'من الإسناد إلى قبول المنسق، ثم اعتماد المدير والنشر.')),
      chipBox,
      h('a.btn.primary', { href: '/app/new' }, '＋ إضافة مادة')),
    h('div.grid', { style: { marginBottom: '16px' } }, h('label.field', 'البحث', filters.q), h('label.field', 'الموقع', filters.mosque),
      h('label.field', 'اللغة', filters.lang), h('label.field', 'الحالة', filters.status)),
    backupCard,
    out);
}
