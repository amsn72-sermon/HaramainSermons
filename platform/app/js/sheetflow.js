// قطعُ الصفحات بأيدينا لا بالمتصفّح (ملاحظة ٢٧٤)
//
//   المتصفّحُ لا يُعتمَد عليه في احترام حدود الصفحة: يُعطيه المرءُ
//   كليشةً وصندوقَ كتابةٍ فيمدُّ المحتوى عليهما ويخرج الملفُّ صفحةً
//   واحدةً ممتدّة. فالطريقُ أن تُقاس الكتلُ على عرض موضعها، ثم تُوزَّع
//   على صناديقَ معلومةِ الارتفاع، فيخرج الملفُّ صفحاتٍ حقيقيةً لكلٍّ
//   كليشتُها ورأسُها ورقمُها.
//
//   وهي الطريقةُ نفسُها التي يُبنى بها الكتابُ المجمَّع منذ ملاحظة ١٥٢.

import { PAGE, BOX, LETTERHEAD, boxWidth, boxHeight, winHeight } from './page.js';

export const mm2px = mm => (mm * 96) / 25.4;
export { PAGE, BOX, LETTERHEAD, boxWidth, boxHeight, winHeight };

// الهيكلُ الواحدُ لكلِّ مُخرَجٍ على الكليشة (ملاحظتا ٢٧٤ و٢٨٠):
//   صفحةٌ A4 · كليشةٌ في كلِّ صفحة · صندوقُ كتابةٍ محدودُ الارتفاع ·
//   شريطُ رقمِ الصفحة تحته · فسحةُ أمانٍ لا يُكتب فيها.
export function sheetCss(extra = '') {
  const W = boxWidth(), WIN = winHeight();
  return `
  @page { size: ${PAGE.w}mm ${PAGE.h}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #12202c;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
    font-family: "Haramain Arabic", "Segoe UI", Tahoma, sans-serif; }
  .sheet { position: relative; width: ${PAGE.w}mm; height: ${PAGE.h}mm;
    overflow: hidden; background: #fff; }
  .sheet + .sheet { break-before: page; page-break-before: always; }
  .sheet img.lh { position: absolute; inset: 0; width: ${PAGE.w}mm; height: ${PAGE.h}mm;
    object-fit: cover; }
  .win { position: absolute; top: ${PAGE.top}mm; inset-inline-start: ${PAGE.side}mm;
    width: ${W}mm; height: ${WIN}mm; overflow: hidden; }
  .pageno { position: absolute; top: ${PAGE.top + WIN}mm; inset-inline-start: ${PAGE.side}mm;
    width: ${W}mm; height: ${BOX.numH}mm; display: flex; align-items: center;
    justify-content: center; font-size: 9pt; color: #6b6257; direction: ltr; }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 2mm; }
  .sub { text-align: center; font-size: 9pt; color: #5a6a78; margin: 0 0 5mm; }
  #measure { position: absolute; visibility: hidden; top: -10000mm; inset-inline-start: 0;
    width: ${W}mm; }
  @media screen { body { background: #d9d9d9; }
    .sheet { margin: 16px auto; box-shadow: 0 2px 12px #0003; } }
  @media print { .sheet { margin: 0; box-shadow: none; height: ${PAGE.h - 0.5}mm; } }
${extra}`;
}

// يفتح نافذةَ طباعةٍ فيها #pages و #measure، ويعيد أدواتِها
export function openSheetWindow(css, { lang = 'ar', dir = 'rtl' } = {}) {
  const w = window.open('', '_blank');
  if (!w) return null;
  w.document.write(`<!doctype html><html lang="${lang}" dir="${dir}" data-theme="light">`
    + `<head><meta charset="utf-8"><title></title><style>${css}</style></head>`
    + '<body><div id="pages"></div><div id="measure"></div></body></html>');
  w.document.close();
  const d = w.document;
  return {
    w, d,
    pages: d.getElementById('pages'),
    measure: d.getElementById('measure'),
    el(tag, cls, html) {
      const x = d.createElement(tag);
      if (cls) x.className = cls;
      if (html != null) x.innerHTML = html;
      return x;
    },
    img(src, cls = 'lh') {
      const x = d.createElement('img');
      x.className = cls; x.alt = '';
      x.src = new URL(src, location.origin).href;
      return x;
    },
    // صفحةٌ جاهزةٌ بكليشتها وصندوقِ كتابتها — تُعاد ومعها صندوقُها
    sheet() {
      const s = this.el('div', 'sheet');
      s.append(this.img(LETTERHEAD));
      const win = this.el('div', 'win');
      s.append(win);
      return { sheet: s, win };
    },
    // تُنتظر الخطوطُ قبل القياس، وإلا قِيست على خطٍّ غير الذي يُطبع به
    ready(build, { autoPrint = true } = {}) {
      const run = async () => {
        try { await d.fonts?.ready; } catch { /* المتصفح لا يدعم fonts.ready */ }
        await new Promise(r => setTimeout(r, 200));
        build();
        if (autoPrint) setTimeout(() => { try { w.print(); } catch { /* يطبع بنفسه */ } }, 600);
      };
      if (d.readyState === 'complete') run(); else w.addEventListener('load', run);
    }
  };
}

// قياسُ ارتفاع كلِّ كتلةٍ على عرض #measure — ويُضاف إليها هامشُها
export function measureBlocks(win, measure, blocks) {
  for (const b of blocks) {
    measure.innerHTML = b.html;
    const node = measure.firstElementChild;
    let h = node ? node.getBoundingClientRect().height : 0;
    if (node) {
      const st = win.getComputedStyle(node);
      h += (parseFloat(st.marginTop) || 0) + (parseFloat(st.marginBottom) || 0);
    }
    b.h = h;
  }
  measure.innerHTML = '';
  return blocks;
}

// التوزيع: nextBox() يُعطي الصندوقَ التالي حين يضيق الذي قبله.
//   keep: ارتفاعٌ إضافيٌّ يُشترط بقاؤه بعد الكتلة، فلا يبقى عنوانٌ
//         وحدَه في ذيل العمود.
export function flowBlocks(blocks, boxPx, nextBox) {
  let box = nextBox();
  let used = 0;
  for (const b of blocks) {
    const need = b.h + (b.keep || 0);
    if (used + need > boxPx && used > 0) { box = nextBox(); used = 0; }
    box.insertAdjacentHTML('beforeend', b.html);
    used += b.h;
    if (b.onPlace) b.onPlace(box);
  }
}
