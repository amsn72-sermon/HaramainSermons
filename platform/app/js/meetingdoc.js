// محاور الاجتماع ومحضره: نافذتان على الصيغة النموذجية، ويُصدَّر المحضر
// على كليشة الهيئة (ملاحظة ١٨٢).
import { h, dialog, toast, fmtDateTime, fmtHijri } from './ui.js';
import { db } from './sb.js';
import { state, isAdmin } from './store.js';

const ar = n => Number(n || 0).toLocaleString('en-US');
const blank = () => ({ title: '', presenter: '', minutes: 10 });

// ---------------------------------------------------------------------
// محاور الاجتماع: بنودٌ مرقَّمة، لكل بندٍ عنوانه ومُقدِّمه وزمنه
// ---------------------------------------------------------------------
export async function agendaDialog(m, { readOnly = false } = {}) {
  const items = Array.isArray(m.agenda) && m.agenda.length
    ? m.agenda.map(x => ({ ...blank(), ...x })) : [blank()];
  const box = h('div.stack.agenda-box');

  const paint = () => {
    box.replaceChildren(...items.map((it, i) => {
      const t = h('input', { value: it.title, 'aria-label': `عنوان المحور ${i + 1}`,
        disabled: readOnly || null, placeholder: 'عنوان المحور' });
      const p = h('input', { value: it.presenter, 'aria-label': `مُقدِّم المحور ${i + 1}`,
        disabled: readOnly || null, placeholder: 'مَن يعرضه (اختياري)' });
      const mn = h('input', { type: 'number', min: 1, max: 240, value: it.minutes,
        'aria-label': `زمن المحور ${i + 1}`, disabled: readOnly || null });
      t.oninput = () => { it.title = t.value; };
      p.oninput = () => { it.presenter = p.value; };
      mn.oninput = () => { it.minutes = Number(mn.value) || 0; };
      const del = h('button.btn.xs.danger', { type: 'button', title: 'حذف المحور',
        onclick: () => { items.splice(i, 1); if (!items.length) items.push(blank()); paint(); } }, '×');
      return h('div.row.agenda-row',
        h('span.ag-no', String(i + 1)),
        h('div.grow', t), p, mn,
        readOnly ? null : del);
    }), readOnly ? null : h('div.row',
      h('button.btn.xs', { type: 'button',
        onclick: () => { items.push(blank()); paint(); } }, '＋ محور'),
      h('span.small.muted', `المجموع: ${ar(items.reduce((s, x) => s + (Number(x.minutes) || 0), 0))} دقيقة`)));
  };
  paint();

  const res = await dialog({
    title: `محاور ${m.title}`,
    body: h('div.stack',
      h('p.small.muted', readOnly
        ? 'محاور هذا الاجتماع كما وضعها المنسق.'
        : 'رتّب ما يُبحث في الاجتماع بندًا بندًا — تظهر للمدعوّين مع الدعوة، '
          + 'ويُبنى عليها المحضر بعد الانعقاد.'),
      h('div.row.small.muted.agenda-head',
        h('span.ag-no', 'م'), h('div.grow', 'المحور'), h('span', 'مَن يعرضه'), h('span', 'دقائق')),
      box),
    buttons: readOnly
      ? [{ label: 'إغلاق', value: null }]
      : [{ label: 'حفظ المحاور', kind: 'primary',
           validate: () => (items.some(x => x.title.trim()) ? true : 'اكتب محورًا واحدًا على الأقل'),
           value: () => items.filter(x => x.title.trim())
             .map((x, i) => ({ n: i + 1, title: x.title.trim(),
               presenter: x.presenter.trim(), minutes: Number(x.minutes) || 0 })) },
          { label: 'إلغاء', value: null }]
  });
  if (!res) return false;
  try {
    await db.rpc('save_agenda', { p_id: m.id, p_agenda: res });
    toast('حُفظت المحاور.', 'ok');
    return true;
  } catch (err) { toast(err.message, 'bad'); return false; }
}

// ---------------------------------------------------------------------
// محضر الاجتماع: الصيغة النموذجية — بياناته، ثم لكل محورٍ ما دار وقراره
// ---------------------------------------------------------------------
export async function minutesDialog(m, members, { readOnly = false } = {}) {
  const inv = await db.select('meeting_invitees', {
    select: 'member_id,joined_at,profiles(full_name)', meeting_id: `eq.${m.id}` }).catch(() => []);
  const nameOf = id => (members.find(x => x.id === id)?.full_name)
    || (inv.find(x => x.member_id === id)?.profiles?.full_name) || '—';
  const present = inv.filter(x => x.joined_at).map(x => x.profiles?.full_name || nameOf(x.member_id));
  const absent = inv.filter(x => !x.joined_at).map(x => x.profiles?.full_name || nameOf(x.member_id));

  const doc = m.minutes_doc || {};
  const axes = (Array.isArray(m.agenda) && m.agenda.length ? m.agenda : [{ n: 1, title: 'ما دار في الاجتماع' }])
    .map((a, i) => ({
      n: a.n || i + 1, title: a.title || '',
      discussion: doc.axes?.[i]?.discussion || '',
      decision: doc.axes?.[i]?.decision || '',
      owner: doc.axes?.[i]?.owner || '',
      due: doc.axes?.[i]?.due || ''
    }));

  const openers = h('textarea', { rows: 2, disabled: readOnly || null,
    'aria-label': 'تمهيد المحضر' }, doc.opening || '');
  const closing = h('textarea', { rows: 2, disabled: readOnly || null,
    'aria-label': 'خاتمة المحضر' }, doc.closing || '');
  const chair = h('select', { 'aria-label': 'رئيس الاجتماع', disabled: readOnly || null },
    h('option', { value: '' }, '— اختر —'),
    inv.map(x => h('option', { value: x.member_id, selected: (doc.chair_id || m.chair_id) === x.member_id },
      x.profiles?.full_name || nameOf(x.member_id))));
  const next = h('input', { type: 'datetime-local', disabled: readOnly || null,
    'aria-label': 'موعد الاجتماع القادم',
    value: m.next_meeting_at
      ? new Date(new Date(m.next_meeting_at) - new Date().getTimezoneOffset() * 60000)
          .toISOString().slice(0, 16) : '' });

  const axisBox = h('div.stack');
  axisBox.replaceChildren(...axes.map(a => {
    const disc = h('textarea', { rows: 2, disabled: readOnly || null,
      'aria-label': `ما دار في المحور ${a.n}`, placeholder: 'ما دار من مناقشة' }, a.discussion);
    const dec = h('textarea', { rows: 2, disabled: readOnly || null,
      'aria-label': `قرار المحور ${a.n}`, placeholder: 'القرار أو التوصية' }, a.decision);
    const own = h('select', { 'aria-label': `مسؤول المحور ${a.n}`, disabled: readOnly || null },
      h('option', { value: '' }, '— بلا مسؤول —'),
      inv.map(x => h('option', { value: x.member_id, selected: a.owner === x.member_id },
        x.profiles?.full_name || nameOf(x.member_id))));
    const due = h('input', { type: 'date', value: a.due, disabled: readOnly || null,
      'aria-label': `استحقاق المحور ${a.n}` });
    disc.oninput = () => { a.discussion = disc.value; };
    dec.oninput = () => { a.decision = dec.value; };
    own.onchange = () => { a.owner = own.value; };
    due.oninput = () => { a.due = due.value; };
    return h('section.card.stack.axis-card',
      h('b', `${a.n}. ${a.title}`),
      h('label.field', 'ما دار', disc),
      h('label.field', 'القرار أو التوصية', dec),
      h('div.grid-2', h('label.field', 'المسؤول', own), h('label.field', 'تاريخ الاستحقاق', due)));
  }));

  const collect = state_ => ({
    id: m.id, state: state_,
    chair_id: chair.value || null,
    next_meeting_at: next.value ? new Date(next.value).toISOString() : null,
    doc: {
      opening: openers.value.trim(), closing: closing.value.trim(),
      chair_id: chair.value || null,
      present, absent,
      axes: axes.map(a => ({ n: a.n, title: a.title, discussion: a.discussion.trim(),
        decision: a.decision.trim(), owner: a.owner || null, due: a.due || null })),
      written_by: state.profile?.full_name || '',
      written_at: new Date().toISOString()
    }
  });

  const buttons = readOnly
    ? [{ label: 'طباعة المحضر', kind: 'primary', value: 'print' }, { label: 'إغلاق', value: null }]
    : [{ label: 'اعتماد المحضر', kind: 'primary', value: () => collect('final') },
       { label: 'حفظ مسودة', value: () => collect('draft') },
       { label: 'إلغاء', value: null }];
  if (!readOnly && !isAdmin()) buttons.shift();   // الاعتماد للمنسق ومدير المشروع

  const res = await dialog({
    title: `محضر ${m.title}`,
    body: h('div.stack',
      h('div.card.stack',
        h('b', 'بيانات الاجتماع'),
        h('div.grid-2',
          h('div', h('div.small.muted', 'الموعد'), h('div', fmtDateTime(m.starts_at))),
          h('div', h('div.small.muted', 'التاريخ الهجري'), h('div', fmtHijri((m.starts_at || '').slice(0, 10)))),
          h('div', h('div.small.muted', 'القاعة'), h('div', m.room_name || '—')),
          h('div', h('div.small.muted', 'المدة'), h('div', `${m.minutes} دقيقة`)),
          h('div', h('div.small.muted', 'أمين السرّ'), h('div', m.secretary_name || '—')),
          h('label.field', 'رئيس الاجتماع', chair)),
        h('div.grid-2',
          h('div', h('div.small.muted', `الحاضرون (${present.length})`),
            h('div.small', present.join(' · ') || '—')),
          h('div', h('div.small.muted', `الغائبون (${absent.length})`),
            h('div.small', absent.join(' · ') || '—')))),
      h('label.field', 'تمهيد', openers),
      h('h3', 'المحاور وقراراتها'),
      axisBox,
      h('label.field', 'خاتمة وتوصيات عامة', closing),
      h('label.field', 'موعد الاجتماع القادم', next)),
    buttons
  });
  if (!res) return false;
  if (res === 'print') { printMinutes(m, doc, nameOf); return false; }
  try {
    await db.rpc('save_minutes', { p: res });
    toast(res.state === 'final' ? 'اعتُمد المحضر.' : 'حُفظت المسودة.', 'ok');
    return true;
  } catch (err) { toast(err.message, 'bad'); return false; }
}

// ---------------------------------------------------------------------
// طباعة المحضر على كليشة الهيئة
// ---------------------------------------------------------------------
export function printMinutes(m, doc, nameOf = (x => x)) {
  const d = doc || m.minutes_doc || {};
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const rows = (d.axes || []).map(a => `
    <tr><td class="n">${a.n}</td>
      <td><b>${esc(a.title)}</b>${a.discussion ? `<div class="disc">${esc(a.discussion)}</div>` : ''}</td>
      <td>${esc(a.decision) || '—'}</td>
      <td>${esc(nameOf(a.owner)) || '—'}</td>
      <td>${esc(a.due) || '—'}</td></tr>`).join('');
  const decisions = (d.axes || []).filter(a => a.decision).map((a, i) =>
    `<li>${esc(a.decision)}${a.owner ? ` — <b>${esc(nameOf(a.owner))}</b>` : ''}${a.due ? ` (${esc(a.due)})` : ''}</li>`).join('');

  const w = window.open('', '_blank');
  if (!w) { toast('اسمح بالنوافذ المنبثقة لطباعة المحضر.', 'bad'); return false; }
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>محضر ${esc(m.title)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: 'IBM Plex Sans Arabic', Tahoma, sans-serif; color: #1f2a37; line-height: 1.7; }
  h1 { font-size: 18pt; text-align: center; margin: 0 0 4px; }
  .sub { text-align: center; color: #666; font-size: 10pt; margin-bottom: 18px; }
  .meta { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 10.5pt; }
  .meta td { border: 1px solid #ccc; padding: 6px 8px; }
  .meta td.k { background: #f6f4ef; width: 22%; font-weight: 600; }
  table.ax { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  table.ax th { background: #f6f4ef; border: 1px solid #ccc; padding: 6px; }
  table.ax td { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; }
  td.n { text-align: center; width: 28px; }
  .disc { color: #444; font-size: 9.8pt; margin-top: 3px; }
  h2 { font-size: 12pt; margin: 18px 0 6px; border-bottom: 2px solid #bc9661; padding-bottom: 3px; }
  .sign { margin-top: 34px; display: flex; justify-content: space-between; font-size: 10.5pt; }
  .sign div { text-align: center; width: 45%; }
  .line { margin-top: 36px; border-top: 1px solid #333; }
</style></head><body>
<h1>محضر اجتماع</h1>
<div class="sub">${esc(m.title)}</div>
<table class="meta">
  <tr><td class="k">التاريخ</td><td>${esc(fmtHijri((m.starts_at || '').slice(0, 10)))}</td>
      <td class="k">القاعة</td><td>${esc(m.room_name || '—')}</td></tr>
  <tr><td class="k">رئيس الاجتماع</td><td>${esc(nameOf(d.chair_id) || m.chair_name || '—')}</td>
      <td class="k">أمين السرّ</td><td>${esc(m.secretary_name || '—')}</td></tr>
  <tr><td class="k">الحاضرون</td><td colspan="3">${esc((d.present || []).join(' · ')) || '—'}</td></tr>
  <tr><td class="k">الغائبون</td><td colspan="3">${esc((d.absent || []).join(' · ')) || '—'}</td></tr>
</table>
${d.opening ? `<h2>تمهيد</h2><p>${esc(d.opening)}</p>` : ''}
<h2>المحاور وما دار فيها</h2>
<table class="ax"><thead><tr><th>م</th><th>المحور وما دار فيه</th><th>القرار</th><th>المسؤول</th><th>الاستحقاق</th></tr></thead>
<tbody>${rows || '<tr><td colspan="5">—</td></tr>'}</tbody></table>
${decisions ? `<h2>القرارات</h2><ol>${decisions}</ol>` : ''}
${d.closing ? `<h2>الخاتمة</h2><p>${esc(d.closing)}</p>` : ''}
${m.next_meeting_at ? `<p><b>موعد الاجتماع القادم:</b> ${esc(fmtDateTime(m.next_meeting_at))}</p>` : ''}
<div class="sign">
  <div>أمين السرّ<div class="line">${esc(m.secretary_name || '')}</div></div>
  <div>رئيس الاجتماع<div class="line">${esc(nameOf(d.chair_id) || m.chair_name || '')}</div></div>
</div>
</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
  return true;
}
