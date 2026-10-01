// نطاق العقد: شاشةٌ مرجعية لمدير المشروع وحده — نطاقُ العمل ومواصفاتُه
// وفريقُه ومواعيدُه وجزاءاتُه كما نصّ عليها العقد (ملاحظة ١٩٥).
import { h, toast, busy, fmtDate } from '../ui.js';
import { isManager } from '../store.js';
import { SCOPE_SECTIONS, SCOPE_TITLE, SCOPE_INTRO, SCOPE_NOTE, SCOPE_VERSION }
  from '../contractscope.js';

// عنصرُ القسم: نصٌّ عادي، أو عنوانٌ فرعي، أو جدول
function item(x) {
  if (Array.isArray(x) && x[0] === 'h4') return h('h4.scope-h4', x[1]);
  if (Array.isArray(x) && x[0] === 'table') {
    const [, head, rows] = x;
    return h('div.table-wrap', h('table.responsive.scope-table',
      h('thead', h('tr', head.map(t => h('th', t)))),
      h('tbody', rows.map(r => h('tr',
        r.map((v, i) => h('td', { 'data-label': head[i] }, v)))))));
  }
  return h('li', x);
}

// النصوص المتجاورة تُجمع في قائمةٍ واحدة، والعناوينُ والجداول تفصل بينها
function body(items) {
  const out = [];
  let bucket = null;
  for (const x of items) {
    const el = item(x);
    if (el.tagName === 'LI') {
      if (!bucket) { bucket = h('ul.scope-list'); out.push(bucket); }
      bucket.append(el);
    } else { bucket = null; out.push(el); }
  }
  return out;
}

export function scopeSection() {
  if (!isManager()) {
    return h('div.card.stack',
      h('h3', SCOPE_TITLE),
      h('p.muted', 'نطاق العقد لمدير المشروع وحده.'));
  }

  const printBtn = h('button.btn.sm', { type: 'button' }, '⎙ طباعة');
  printBtn.onclick = () => busy(printBtn, async () => {
    const w = window.open('', '_blank');
    if (!w) return toast('اسمح بالنوافذ المنبثقة للطباعة.', 'bad');
    const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const part = x => {
      if (Array.isArray(x) && x[0] === 'h4') return `<h4>${esc(x[1])}</h4>`;
      if (Array.isArray(x) && x[0] === 'table') {
        const [, head, rows] = x;
        return `<table><thead><tr>${head.map(t => `<th>${esc(t)}</th>`).join('')}</tr></thead>`
          + `<tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      }
      return `<li>${esc(x)}</li>`;
    };
    const secHtml = SCOPE_SECTIONS.map(([title, items]) => {
      let html = `<h2>${esc(title)}</h2>`, open = false;
      for (const x of items) {
        const p = part(x);
        if (p.startsWith('<li>')) { if (!open) { html += '<ul>'; open = true; } html += p; }
        else { if (open) { html += '</ul>'; open = false; } html += p; }
      }
      return html + (open ? '</ul>' : '');
    }).join('');
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(SCOPE_TITLE)}</title><style>
  @page { size: A4; margin: 18mm; }
  body { font-family: 'IBM Plex Sans Arabic', Tahoma, sans-serif; color: #1f2a37; line-height: 1.75; }
  h1 { font-size: 17pt; text-align: center; margin: 0 0 2px; }
  .sub { text-align: center; color: #666; font-size: 9.5pt; margin-bottom: 16px; }
  h2 { font-size: 12pt; margin: 16px 0 5px; border-bottom: 2px solid #bc9661; padding-bottom: 3px; }
  h4 { font-size: 10.5pt; margin: 10px 0 3px; color: #7b5d31; }
  ul { margin: 0 0 6px; padding-inline-start: 18px; font-size: 10pt; }
  li { margin-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 6px 0 10px; }
  th { background: #f6f4ef; border: 1px solid #ccc; padding: 5px 6px; text-align: start; }
  td { border: 1px solid #ccc; padding: 5px 6px; vertical-align: top; }
  .note { margin-top: 18px; font-size: 9.5pt; color: #555; border-top: 1px solid #ddd; padding-top: 8px; }
</style></head><body>
<h1>${esc(SCOPE_TITLE)}</h1>
<div class="sub">مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين — النسخة ${esc(SCOPE_VERSION)} — ${esc(fmtDate(new Date()))}</div>
<p>${esc(SCOPE_INTRO)}</p>
${secHtml}
<p class="note">${esc(SCOPE_NOTE)}</p>
</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  });

  // فهرسُ الأقسام: ضغطةٌ تنقل إلى موضعه
  const jump = h('div.row.wrap.scope-jump',
    SCOPE_SECTIONS.map(([title], i) =>
      h('button.btn.xs', { type: 'button',
        onclick: () => document.getElementById(`scope-${i}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, title)));

  return h('div.stack',
    h('section.card.stack',
      h('div.row.between',
        h('div', h('h3', SCOPE_TITLE),
          h('p.small.muted', { style: { margin: 0 } }, SCOPE_INTRO)),
        h('div.row', h('span.badge.gold', `النسخة ${SCOPE_VERSION}`), printBtn)),
      h('b.small', 'أقسام النطاق'),
      jump),

    ...SCOPE_SECTIONS.map(([title, items], i) =>
      h('section.card.stack.scope-sec', { id: `scope-${i}` },
        h('h3', `${i + 1}. ${title}`),
        ...body(items))),

    h('p.small.muted', { style: { marginTop: '14px' } }, SCOPE_NOTE));
}
