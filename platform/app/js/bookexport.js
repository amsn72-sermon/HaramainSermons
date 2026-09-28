// تصدير مجمَّع على هيئة كتاب: غلافٌ وفهرسٌ وخطبٌ مرقَّمة على كليشة الهيئة (ملاحظة ١٥٢)
//   يُبنى في نافذة مستقلة كما تُبنى ورقة الطباعة، ثم يُطبع أو يُحفظ PDF.
import { PAGE, LETTERHEAD, cardColumns, heading, docVerifyUrl } from './page.js';
import { sanitize } from './sanitize.js';
import { langDir, langName } from './store.js';
import { fmtHijri, fmtSermonDate } from './ui.js';
import { qrPngDataUrl } from './qr.js';

const INDEX_ROWS = 22;      // سطور الفهرس في الصفحة الواحدة

// ترتيب الخطب في الكتاب: بالتاريخ ثم بالعنوان
export const sortBook = items => [...items].sort((a, b) => {
  const da = a.material.sermon_date || '', dbb = b.material.sermon_date || '';
  return da === dbb ? String(a.material.title).localeCompare(String(b.material.title), 'ar') : da.localeCompare(dbb);
});

/**
 * @param items [{ material, track, khateeb }] مرتَّبة
 * @param meta  { title, period, language, edition, issuedAt }
 */
export function printBook(items, meta, { autoPrint = true } = {}) {
  if (!items.length) return false;
  const w = window.open('', '_blank');
  if (!w) return false;

  const one = items.length === 1 ? items[0] : null;
  const dir = meta.language ? langDir(meta.language) : 'rtl';
  const P = PAGE;
  const BOX_H = P.h - P.top - P.bottom;
  const BOX_W = P.w - P.side * 2;
  const NUM_H = 8;
  const SAFE_H = 9;
  const WIN_H = BOX_H - NUM_H - SAFE_H;

  w.document.write(`<!doctype html><html lang="ar" dir="rtl" data-theme="light"><head><meta charset="utf-8"><title></title>
<link rel="stylesheet" href="${location.origin}/css/app.css"><style>
@page { size: A4; margin: 0; }
html, body { margin: 0; background: #fff !important; color: #111 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { position: relative; width: ${P.w}mm; height: ${P.h}mm; overflow: hidden; background: #fff; }
.sheet + .sheet { break-before: page; page-break-before: always; }
.sheet img.lh { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.win { position: absolute; top: ${P.top}mm; inset-inline-start: ${P.side}mm; width: ${BOX_W}mm; height: ${WIN_H}mm; overflow: hidden; }
.pageno { position: absolute; top: ${P.top + WIN_H}mm; inset-inline-start: ${P.side}mm; width: ${BOX_W}mm; height: ${NUM_H}mm;
  display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #6b6257; letter-spacing: .5px; direction: ltr; }
.flow { position: absolute; top: 0; inset-inline-start: 0; width: ${BOX_W}mm; }
.print-body { --pt: 1pt; font-size: 12pt; line-height: 1.8; }
.print-body .data-card { font-size: 11pt; }
#measure { position: absolute; visibility: hidden; top: -10000mm; inset-inline-start: 0; width: ${BOX_W}mm; }
.doc-stamp { position: absolute; top: 9mm; left: ${P.side}mm; display: flex; align-items: center;
  gap: 3mm; font-size: 8pt; color: #3b3630; text-align: start; }
.doc-stamp img.qr { width: 17mm; height: 17mm; }
.doc-stamp .lbl { font-size: 7.5pt; color: #6b6257; }
.doc-stamp .no { font-size: 11pt; font-weight: 700; letter-spacing: .6px; direction: ltr; margin: .4mm 0; }
.doc-stamp .dt { font-size: 7.5pt; color: #3b3630; }
/* الغلاف: العنوان في وسط صندوق الكتابة، وبياناته تحته */
.cover { position: absolute; top: ${P.top}mm; inset-inline-start: ${P.side}mm; width: ${BOX_W}mm; height: ${BOX_H - 6}mm;
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 6mm; }
.cover .ct { font-size: 26pt; font-weight: 700; color: #1d1a16; line-height: 1.5; }
.cover .cs { font-size: 15pt; color: #6b6257; }
.cover .rule { width: 46mm; height: 0.8mm; background: #b9975b; border-radius: 1mm; }
.cover .meta { font-size: 11pt; color: #3b3630; line-height: 2; }
.cover .edition { font-size: 9pt; color: #6b6257; direction: ltr; }
.idx h2 { font-size: 15pt; margin: 0 0 4mm; color: #1d1a16; }
.idx table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
.idx th, .idx td { border-bottom: 1px solid #e7e1d8; padding: 1.6mm 2mm; text-align: start; }
.idx th { color: #6b6257; font-weight: 600; font-size: 9.5pt; }
.idx td.no, .idx td.pg { direction: ltr; text-align: center; white-space: nowrap; }
.sec-title { font-size: 14pt; font-weight: 700; margin: 0 0 3mm; color: #1d1a16; }
@media screen { body { background: #d9d9d9 !important; } .sheet { margin: 16px auto; box-shadow: 0 2px 12px #0003; } }
@media print { .sheet { margin: 0; box-shadow: none; height: ${P.h - 0.5}mm; } }
</style></head><body><div id="pages"></div><div id="measure"></div></body></html>`);
  w.document.close();
  const d = w.document;
  d.title = meta.title;

  const el = (tag, cls, text) => { const x = d.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  const lhUrl = new URL(LETTERHEAD, location.origin).href;
  const sheet = () => { const s = el('div', 'sheet'); const img = el('img', 'lh'); img.alt = ''; img.src = lhUrl; s.append(img); return s; };

  // بطاقة بيانات العمل داخل الكتاب
  function cardFor({ material, track, khateeb }) {
    const card = d.createElement('table');
    card.className = 'data-card'; card.dir = 'rtl'; card.lang = 'ar';
    const thead = d.createElement('thead'), htr = d.createElement('tr');
    const tb = d.createElement('tbody'), vtr = d.createElement('tr');
    for (const [k, v] of cardColumns(material, track.language_code, khateeb)) {
      const th = d.createElement('th'), td = d.createElement('td');
      th.textContent = k; td.textContent = v;
      htr.append(th); vtr.append(td);
    }
    thead.append(htr); tb.append(vtr); card.append(thead, tb);
    return card;
  }

  function stampFor(track) {
    if (!track.doc_no) return null;
    const stamp = el('div', 'doc-stamp'); stamp.dir = 'rtl'; stamp.lang = 'ar';
    let src = '';
    try { src = qrPngDataUrl(docVerifyUrl(track.doc_no), { scale: 6 }); } catch { src = ''; }
    if (src) { const img = el('img', 'qr'); img.alt = `رمز التحقق من ${track.doc_no}`; img.src = src; stamp.append(img); }
    const box = el('div');
    box.append(el('div', 'lbl', 'رقم التوثيق'));
    const no = el('div', 'no', track.doc_no); no.dir = 'ltr'; box.append(no);
    box.append(el('div', 'dt', `تاريخ الترجمة: ${fmtHijri(track.doc_no_at || track.completed_at)}`));
    stamp.append(box);
    return stamp;
  }

  // مواضع نهايات الأسطر داخل تدفّق واحد
  function lineBottoms(flow) {
    const top = flow.getBoundingClientRect().top;
    const out = [];
    const walk = d.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const r = d.createRange(); r.selectNodeContents(n);
      for (const rect of r.getClientRects()) if (rect.height) out.push(rect.bottom - top);
    }
    for (const x of flow.querySelectorAll('img, hr, tr, td, th, li, p, div')) {
      const rect = x.getBoundingClientRect();
      if (rect.height) out.push(rect.bottom - top);
    }
    return [...new Set(out.map(v => Math.round(v)))].sort((a, b) => a - b);
  }

  function startsOf(flow, boxPx) {
    const bottoms = lineBottoms(flow);
    const total = Math.max(flow.getBoundingClientRect().height, bottoms.at(-1) || 0);
    const starts = [0];
    let guard = 0;
    while (starts.at(-1) + boxPx < total - 1 && guard++ < 400) {
      const start = starts.at(-1);
      const limit = start + boxPx;
      const fit = bottoms.filter(b => b > start + 1 && b <= limit + 0.5);
      starts.push(fit.length ? fit.at(-1) : limit);
    }
    return { starts, total };
  }

  function build() {
    const measure = d.getElementById('measure');
    const probe = el('div');
    probe.style.cssText = `height:${WIN_H}mm;width:1px;position:absolute;visibility:hidden`;
    d.body.append(probe);
    const boxPx = probe.getBoundingClientRect().height;
    probe.remove();

    // ١) تدفّق لكل عمل، وحساب صفحاته
    const works = items.map(it => {
      const flow = el('div', 'print-body flow');
      flow.dir = langDir(it.track.language_code);
      flow.lang = it.track.language_code;
      const title = el('h2', 'sec-title', `${heading(it.material)} — ${it.material.title}`);
      title.dir = 'rtl'; title.lang = 'ar';
      flow.append(title, cardFor(it));
      const body = el('div'); body.innerHTML = sanitize(it.track.translation_html);
      flow.append(body);
      measure.append(flow);
      return { it, flow };
    });
    for (const wk of works) Object.assign(wk, startsOf(wk.flow, boxPx));

    // ٢) الفهرس: عدد صفحاته يُعرف من عدد الأعمال، فتُحسب أرقام الصفحات قبل رسمه
    const idxPages = Math.max(1, Math.ceil(items.length / INDEX_ROWS));
    let page = idxPages;                       // الغلاف بلا رقم، والفهرس أوله
    for (const wk of works) { wk.page = page + 1; page += wk.starts.length; }
    const totalPages = page;

    const pages = d.getElementById('pages');
    const out = [];

    // ٣) الغلاف
    const cover = sheet();
    const c = el('div', 'cover');
    c.append(el('div', 'ct', meta.title));
    if (meta.period) c.append(el('div', 'cs', meta.period));
    c.append(el('div', 'rule'));
    const m = el('div', 'meta');
    if (meta.language) m.append(el('div', null, `اللغة: ${langName(meta.language)}`));
    m.append(el('div', null, `عدد الأعمال: ${items.length}`));
    c.append(m);
    c.append(el('div', 'edition', meta.edition || ''));
    cover.append(c);
    out.push(cover);

    // ٤) الفهرس
    const entries = works.map((wk, i) => [String(i + 1), wk.it.material.title,
      wk.it.material.sermon_date ? fmtSermonDate(wk.it.material.sermon_date) : '—',
      wk.it.track.doc_no || '—', String(wk.page)]);
    for (let p = 0; p < idxPages; p++) {
      const sh = sheet();
      const win = el('div', 'win');
      const box = el('div', 'print-body idx');
      box.append(el('h2', null, p === 0 ? 'الفهرس' : 'الفهرس (تتمة)'));
      const tbl = d.createElement('table');
      const th = d.createElement('thead'), htr = d.createElement('tr');
      for (const t of ['م', 'العنوان', 'التاريخ', 'رقم التوثيق', 'الصفحة']) {
        const c2 = d.createElement('th'); c2.textContent = t; htr.append(c2);
      }
      th.append(htr); tbl.append(th);
      const tb = d.createElement('tbody');
      for (const row of entries.slice(p * INDEX_ROWS, (p + 1) * INDEX_ROWS)) {
        const tr = d.createElement('tr');
        row.forEach((v, i) => {
          const td = d.createElement('td');
          if (i === 0) td.className = 'no';
          if (i === 3 || i === 4) { td.className = 'pg'; td.dir = 'ltr'; }
          td.textContent = v; tr.append(td);
        });
        tb.append(tr);
      }
      tbl.append(tb); box.append(tbl); win.append(box); sh.append(win);
      const num = el('div', 'pageno', `${p + 1} / ${totalPages}`);
      sh.append(num);
      out.push(sh);
    }

    // ٥) الأعمال: كل عمل يبدأ صفحةً جديدة، وختمه على أولاها
    for (const wk of works) {
      wk.starts.forEach((start, i) => {
        const sh = sheet();
        const clone = wk.flow.cloneNode(true);
        clone.style.top = `${-start}px`;
        const win = el('div', 'win'); win.append(clone);
        const end = i + 1 < wk.starts.length ? wk.starts[i + 1] : Math.min(wk.total, start + boxPx);
        win.style.height = `${Math.max(0, Math.min(end - start, boxPx))}px`;
        sh.append(win);
        sh.append(el('div', 'pageno', `${wk.page + i} / ${totalPages}`));
        if (i === 0) { const st = stampFor(wk.it.track); if (st) sh.append(st); }
        out.push(sh);
      });
    }

    pages.replaceChildren(...out);
    measure.remove();
  }

  const ready = async () => {
    try { await d.fonts?.ready; } catch { /* المتصفح لا يدعم fonts.ready */ }
    await new Promise(r => setTimeout(r, 150));
    build();
    if (autoPrint) setTimeout(() => w.print(), 500);
  };
  if (d.readyState === 'complete') ready(); else w.addEventListener('load', ready);
  return true;
}
