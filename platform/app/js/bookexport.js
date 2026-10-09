// تصدير مجمَّع على هيئة كتاب: غلافٌ وفهرسٌ وخطبٌ مرقَّمة على كليشة الهيئة (ملاحظة ١٥٢)
//   يُبنى في نافذة مستقلة كما تُبنى ورقة الطباعة، ثم يُطبع أو يُحفظ PDF.
import { PAGE, LETTERHEAD, cardColumns, heading, docVerifyUrl,
  DOC_STAMP_CSS, docStampNode } from './page.js';
import { sanitize } from './sanitize.js';
import { langDir, langName, MOSQUE_ANY } from './store.js';
import { fmtHijri } from './ui.js';
import { qrPngDataUrl } from './qr.js';

// الفهرس سطرٌ لكل عمل، فتُختصر الألقاب الطويلة ويبقى الاسم (ملاحظة ١٥٩)
const shortName = v => (v ? String(v).replace(/^\s*(فضيلة\s+)?(الشيخ|الدكتور|د\.|أ\.د\.?)\s*/g, '')
  .replace(/^\s*(الشيخ|الدكتور|د\.)\s*/g, '').trim() || String(v) : '—');

const INDEX_ROWS = 26;      // سطور الفهرس في الصفحة الواحدة — الخطّ أصغر فتزيد (ملاحظة ١٥٩)

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
${DOC_STAMP_CSS(P.side)}
/* الغلاف: حديثٌ اقتصاديٌّ في الطباعة — أرضيةٌ بيضاء، ولونان لا غير،
   وشريطٌ رفيعٌ على الحافّة وحدَه ما يحمل لونًا ممتدًّا، وحِليةٌ خطّيّةٌ
   واحدة. والبناءُ بالفراغ لا بالحلية (ملاحظة ٢٧٣) */
.cover-sheet { background: #fff; }
.cover-sheet img.lh { display: none; }
.cover { position: absolute; inset: 0; padding: 26mm 26mm 20mm; display: flex;
  flex-direction: column; align-items: center; text-align: center; }
.cover .spine { position: absolute; inset-inline-end: 0; top: 0; bottom: 0; width: 15mm;
  background: #b9975b; opacity: .13; }
.cover .spine::after { content: ''; position: absolute; inset-inline-start: 0; top: 0; bottom: 0;
  width: 1.1mm; background: #b9975b; }
/* شعارُ الهيئة وحدَه، والاسمُ مكتوبٌ فيه فلا يُعاد تحته (ملاحظة ٢٧٣) */
.cover .logos { display: flex; align-items: center; justify-content: center; }
.cover .logos img { height: 26mm; }
.cover .gap { flex: 0 0 26mm; }
.cover .ct { font-size: 32pt; font-weight: 700; color: #1d2b3a; line-height: 1.35;
  max-width: 140mm; text-align: center; }
.cover .orn { display: block; width: 52mm; height: 10mm; margin: 7mm auto 0; }
.cover .cs { margin-top: 5mm; font-size: 14pt; font-weight: 400; color: #4a5560; }
.cover .meta { margin-top: 3mm; font-size: 11pt; color: #6b6257; line-height: 2; }
.cover .foot { margin-top: auto; font-size: 8.5pt; color: #6b6257; letter-spacing: .06em; }
.cover .edition { direction: ltr; }
/* ظهرُ الغلاف: صفحةُ الحقوق */
.colophon { position: absolute; inset: 0; padding: 40mm 30mm; display: flex; flex-direction: column;
  gap: 6mm; color: #3b3630; font-size: 10.5pt; line-height: 2; background: #fff; }
.colophon h3 { margin: 0; font-size: 12pt; color: #1d2b3a; }
.colophon .qr { width: 24mm; height: 24mm; }
.idx h2 { font-size: 15pt; margin: 0 0 4mm; color: #1d1a16; }
.idx table { width: 100%; border-collapse: collapse; font-size: 8.5pt; table-layout: fixed; }
.idx th, .idx td { border-bottom: 1px solid #e7e1d8; padding: 1.1mm 1.4mm; text-align: start;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.idx th { color: #6b6257; font-weight: 600; font-size: 8pt; }
.idx td.no, .idx td.pg { direction: ltr; text-align: center; }
.idx col.c-no { width: 7mm; } .idx col.c-title { width: 40mm; } .idx col.c-kh { width: 40mm; }
.idx col.c-mosque { width: 20mm; } .idx col.c-date { width: 28mm; } .idx col.c-doc { width: 25mm; }
.idx col.c-lang { width: 22mm; }
.idx col.c-pg { width: 9mm; }
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

  // الختمُ واحدٌ في كلِّ المخرجات (ملاحظة ٤١٤)
  function stampFor(track) {
    return docStampNode(d, track, url => qrPngDataUrl(url, { scale: 6 }));
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
      const src = !!it.track.is_source;
      const flow = el('div', 'print-body flow');
      flow.dir = src ? 'rtl' : langDir(it.track.language_code);
      flow.lang = src ? 'ar' : it.track.language_code;
      const title = el('h2', 'sec-title',
        `${heading(it.material)} — ${it.material.title}`
        + (src ? ' — الأصل العربي' : ''));
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

    // ٣) الغلاف (ملاحظة ٢٧٣)
    const cover = sheet();
    cover.className = 'sheet cover-sheet';
    const c = el('div', 'cover');
    c.append(el('div', 'spine'));

    // شعارُ الهيئة وحدَه متوسّطًا، واسمُها مكتوبٌ فيه (ملاحظة ٢٧٣)
    const logos = el('div', 'logos');
    const im = d.createElement('img');
    im.src = new URL('/assets/alharamain-logo-dark.png', location.origin).href;
    im.alt = 'الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي';
    logos.append(im);
    c.append(logos);

    c.append(el('div', 'gap'));
    c.append(el('div', 'ct', meta.title));

    // حِليةٌ هندسيةٌ خطّيّةٌ واحدة: نجمةٌ ثمانيةٌ مجرَّدة
    const orn = d.createElementNS('http://www.w3.org/2000/svg', 'svg');
    orn.setAttribute('class', 'orn');
    orn.setAttribute('viewBox', '0 0 140 26');
    orn.innerHTML = '<line x1="0" y1="13" x2="52" y2="13" stroke="#b9975b" stroke-width="1"/>'
      + '<line x1="88" y1="13" x2="140" y2="13" stroke="#b9975b" stroke-width="1"/>'
      + '<g fill="none" stroke="#b9975b" stroke-width="1.1">'
      + '<rect x="62" y="5" width="16" height="16"/>'
      + '<rect x="62" y="5" width="16" height="16" transform="rotate(45 70 13)"/></g>';
    c.append(orn);

    if (meta.period) c.append(el('div', 'cs', meta.period));
    const m = el('div', 'meta');
    if (meta.language) m.append(el('div', null, `اللغة: ${langName(meta.language)}`));
    m.append(el('div', null, `عدد الأعمال: ${items.length}`));
    c.append(m);

    const foot = el('div', 'foot');
    foot.append(el('div', null, 'مشروعُ خادم الحرمين الشريفين لترجمة خطب الحرمين'));
    foot.append(el('div', 'edition', [meta.edition, fmtHijri(new Date()), String(new Date().getFullYear())]
      .filter(Boolean).join(' · ')));
    c.append(foot);
    cover.append(c);
    out.push(cover);

    // ظهرُ الغلاف: نبذةٌ وحفظُ الحقوق ورقمُ الإصدار
    const back = sheet();
    back.className = 'sheet cover-sheet';
    const bk = el('div', 'colophon');
    bk.append(el('h3', null, meta.title));
    bk.append(el('p', null, 'إصدارٌ من مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين، '
      + 'التابع للهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي. '
      + 'يجمع هذا الكتابُ أعمالًا مترجمةً معتمدةً، وُلّد من المنصة عند طلبه.'));
    bk.append(el('p', null, 'جميعُ الحقوق محفوظة. ولا يُنسب إلى المشروع ما لم يصدر عنه.'));
    bk.append(el('p', null, `رقمُ الإصدار: ${meta.edition || '—'} — وُلّد في ${
      new Date().toISOString().slice(0, 10)}`));
    back.append(bk);
    out.push(back);

    // ٤) الفهرس
    const mixed = !meta.language;
    const entries = works.map((wk, i) => [String(i + 1), wk.it.material.title,
      shortName(wk.it.khateeb || wk.it.material.khateeb?.name || wk.it.material.author),
      MOSQUE_ANY[wk.it.material.mosque] || '—',
      wk.it.material.sermon_date ? fmtHijri(wk.it.material.sermon_date) : '—',
      ...(mixed ? [wk.it.track.is_source ? 'العربية (الأصل)'
                                          : langName(wk.it.track.language_code)] : []),
      wk.it.track.doc_no || '—', String(wk.page)]);
    const COLS = ['c-no', 'c-title', 'c-kh', 'c-mosque', 'c-date',
      ...(mixed ? ['c-lang'] : []), 'c-doc', 'c-pg'];
    const HEAD = ['م', 'عنوان العمل', 'الخطيب', 'المسجد', 'التاريخ',
      ...(mixed ? ['اللغة'] : []), 'رقم التوثيق', 'الصفحة'];
    for (let p = 0; p < idxPages; p++) {
      const sh = sheet();
      const win = el('div', 'win');
      const box = el('div', 'print-body idx');
      box.append(el('h2', null, p === 0 ? 'الفهرس' : 'الفهرس (تتمة)'));
      const tbl = d.createElement('table');
      const cg = d.createElement('colgroup');
      for (const c of COLS) { const col = d.createElement('col'); col.className = c; cg.append(col); }
      tbl.append(cg);
      const th = d.createElement('thead'), htr = d.createElement('tr');
      for (const t of HEAD) { const c2 = d.createElement('th'); c2.textContent = t; htr.append(c2); }
      th.append(htr); tbl.append(th);
      const tb = d.createElement('tbody');
      for (const row of entries.slice(p * INDEX_ROWS, (p + 1) * INDEX_ROWS)) {
        const tr = d.createElement('tr');
        row.forEach((v, i) => {
          const td = d.createElement('td');
          if (i === 0) td.className = 'no';
          if (i === 5 || i === 6) { td.className = 'pg'; td.dir = 'ltr'; }
          td.title = v; td.textContent = v; tr.append(td);
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
