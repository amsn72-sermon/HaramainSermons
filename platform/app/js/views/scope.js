// نطاق العقد: شاشةٌ مرجعية لمدير المشروع وحده — نطاقُ العمل ومواصفاتُه
// وفريقُه ومواعيدُه وجزاءاتُه كما نصّ عليها العقد (ملاحظة ١٩٥).
import { openSheetWindow, measureBlocks, flowBlocks, mm2px, sheetCss, winHeight } from '../sheetflow.js';
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
    const esc = x => String(x ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const part = x => {
      if (Array.isArray(x) && x[0] === 'h4') return `<h4>${esc(x[1])}</h4>`;
      if (Array.isArray(x) && x[0] === 'table') {
        const [, head, rows] = x;
        return `<table><thead><tr>${head.map(t => `<th>${esc(t)}</th>`).join('')}</tr></thead>`
          + `<tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      }
      return `<li>${esc(x)}</li>`;
    };

    // نطاقُ العمل على كليشة الهيئة، يُقاس ويُوزَّع (ملاحظة ٢٨٠ ز)
    const ctx = openSheetWindow(sheetCss(`
  h1 { font-size: 17pt; }
  h2 { font-size: 12pt; margin: 5mm 0 2mm; border-bottom: .5mm solid #bc9661; padding-bottom: 1mm; }
  h4 { font-size: 10.5pt; margin: 3mm 0 1mm; color: #7b5d31; }
  ul { margin: 0 0 2mm; padding-inline-start: 6mm; font-size: 10pt; line-height: 1.8; }
  li { margin-bottom: 1mm; }
  p { font-size: 10pt; line-height: 1.8; margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 2mm 0 3mm; }
  th { background: #f6f4ef; border: 1px solid #c8b591; padding: 1.6mm 2mm; text-align: start; }
  td { border: 1px solid #c8b591; padding: 1.6mm 2mm; vertical-align: top; }
  .note { margin-top: 6mm; font-size: 9.5pt; color: #555; border-top: 1px solid #ddd; padding-top: 3mm; }`));
    if (!ctx) return toast('اسمح بالنوافذ المنبثقة للطباعة.', 'bad');
    const { el, pages, measure, w } = ctx;

    ctx.ready(() => {
      const blocks = [
        { html: `<h1>${esc(SCOPE_TITLE)}</h1>` },
        { html: `<div class="sub">مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين الشريفين`
            + ` — النسخة ${esc(SCOPE_VERSION)} — ${esc(fmtDate(new Date()))}</div>` },
        { html: `<p>${esc(SCOPE_INTRO)}</p>` }
      ];
      for (const [title, items] of SCOPE_SECTIONS) {
        blocks.push({ keep: 40, html: `<h2>${esc(title)}</h2>` });
        let open = false, buf = '';
        for (const x of items) {
          const pt = part(x);
          if (pt.startsWith('<li>')) {
            if (!open) { open = true; buf = '<ul>'; }
            buf += pt;
          } else {
            if (open) { blocks.push({ html: buf + '</ul>' }); open = false; buf = ''; }
            blocks.push({ html: pt });
          }
        }
        if (open) blocks.push({ html: buf + '</ul>' });
      }
      blocks.push({ html: `<p class="note">${esc(SCOPE_NOTE)}</p>` });
      measureBlocks(w, measure, blocks);

      const sheets = [];
      const nextBox = () => { const { sheet, win } = ctx.sheet(); sheets.push(sheet); return win; };
      flowBlocks(blocks, mm2px(winHeight()), nextBox);
      sheets.forEach((sh, i) => sh.append(el('div', 'pageno', `${i + 1} / ${sheets.length}`)));
      pages.replaceChildren(...sheets);
      measure.remove();
    });
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
