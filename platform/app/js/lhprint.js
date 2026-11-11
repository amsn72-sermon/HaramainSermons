// طباعةُ مستندٍ طويلٍ على كليشة الهيئة: يُقسَّم على صفحاتٍ A4 بالحساب
// نفسِه الذي يقسِّم به تصديرُ الخطب، فلا يشذُّ مُخرَجٌ عن مُخرَج
// (ملاحظات ٤١٤ و٤٢٣ و٤٢٩)
//
//   المحتوى يُكتَب تدفُّقًا واحدًا، ثم يُقاس فيُقطَع عند آخر سطرٍ يكتمل
//   في الصفحة، ولكلِّ صفحةٍ كليشتُها ورقمُها. ولا يُخزَّن منه ملف.
import { state } from './store.js';
import { PAGE, BOX, LETTERHEAD, FONT_FACE_CSS, NASKH_STACK,
         flowStarts, fontsSettled, settledHeight } from './page.js';

const BOX_W = PAGE.w - PAGE.side * 2;
const WIN_H = PAGE.h - PAGE.top - PAGE.bottom - BOX.numH - BOX.safeH;

// شكلُ المستندات المطبوعة على الكليشة: عناوينُها وجداولُها واحدة
export const DOC_CSS = `
  .doc h1 { font-size: 15pt; text-align: center; margin: 0 0 2mm; }
  .doc .sub { text-align: center; font-size: 9pt; color: #6b6257; margin: 0 0 6mm; }
  .doc h2 { font-size: 11.5pt; color: #8a6835; margin: 5mm 0 1.5mm;
            border-bottom: .3mm solid rgb(188 150 97 / 45%); padding-bottom: 1mm; }
  .doc p { margin: 0 0 2mm; }
  .doc ul { margin: 0 0 2mm; padding-inline-start: 6mm; }
  .doc li { margin: 0 0 1.2mm; }
  .doc table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .doc th, .doc td { border: .25mm solid #bc9661; padding: 1.4mm 2mm;
                     vertical-align: top; text-align: start; }
  .doc thead th { background: rgb(188 150 97 / 16%); color: #8a6835; font-weight: 700; }
  .doc td.ltr, .doc th.ltr { direction: ltr; text-align: left;
    font-family: ui-monospace, "Courier New", monospace; font-size: 8.5pt;
    word-break: break-all; }
  .doc .rec th { width: 42mm; background: rgb(188 150 97 / 14%); color: #8a6835;
                 font-weight: 700; white-space: nowrap; }
  .doc .clause { margin: 4mm 0 0; border-inline-start: 1mm solid #bc9661;
                 padding: 0 3mm; line-height: 1.9; }
  .doc .clause b { display: block; color: #8a6835; font-size: 9.5pt; margin-bottom: 1mm; }
  .doc .note { margin: 4mm 0 0; font-size: 9pt; color: #6b6257; line-height: 1.8; }
  .doc .seal { margin: 6mm 0 0; display: flex; align-items: flex-end;
               justify-content: space-between; gap: 6mm; }
  .doc .seal .code { font-size: 9pt; color: #3b3630; }
  .doc .seal .code .no { font-size: 13pt; font-weight: 700; direction: ltr; letter-spacing: 1px; }
  .doc .seal .qr { text-align: center; font-size: 8pt; color: #6b6257; }
  .doc .seal .qr img { width: 24mm; height: 24mm; display: block; margin: 0 auto 1mm; }
  .doc .keep { break-inside: avoid; }
  /* عمودُ الباركود في الكشف: رمزٌ صغيرٌ تحته رقمُه (ملاحظة ٤٣٢) */
  .doc td.qr-cell { text-align: center; padding: 1mm; }
  .doc td.qr-cell img { width: 13mm; height: 13mm; display: block; margin: 0 auto .6mm; }
  .doc td.qr-cell span { font-size: 6.5pt; color: #6b6257; direction: ltr;
                         display: block; letter-spacing: .2px; }
  /* عنوانُ بابٍ في الكشف: فريقٌ ومدينةٌ وعددُهما (ملاحظة ٤٨٠) */
  .doc h3 { font-size: 10.5pt; color: #3b3630; margin: 4mm 0 1.2mm; font-weight: 700; }
  .doc h3 .cnt { font-size: 8.5pt; color: #6b6257; font-weight: 400; }
  .doc table.roster { font-size: 9pt; }
  .doc table.roster td, .doc table.roster th { padding: 1mm 1.4mm; }
  /* جداولُ الكشف تتلاحق بلا فراغٍ بينها، ورأسُها يتكرّر (ملاحظة ٤٦٢) */
  .doc table.roster + table.roster { margin-top: 0; }
  .doc tr, .doc td, .doc th { break-inside: avoid; page-break-inside: avoid; }
  /* الجدولُ يُغلَق بخطٍّ أسفلَ آخر صفٍّ في الصفحة فلا يبقى مفتوحًا
     (ملاحظة ٤٩٦) */
  .doc table.roster { border-bottom: .25mm solid #bc9661; }
  /* ورأسُ الكشف المكرَّرُ في أعلى الصفحات التالية */
  .doc .repeat-head-fixed table { border-collapse: collapse; }
  .doc .repeat-foot-fixed { position: absolute; inset-inline: 0; bottom: 0;
    height: 0; border-top: .25mm solid #bc9661; }
  .doc .repeat-head-fixed th { border: .25mm solid #bc9661;
    background: rgb(188 150 97 / 16%); color: #8a6835; font-weight: 700;
    padding: 1mm 1.4mm; font-size: 9pt; }`;

// ما لا يُقطَع بين صفحتين: الكتلةُ الموسومةُ بـ«keep»، وكلُّ صفٍّ في
//   جدول. فإن وقع القطعُ في وسط واحدٍ منها نزل كلُّه إلى الصفحة التالية.
//
//   وكان هذا يُحسَب بعد تقسيم الصفحات فيُزحزَح مبدأُ صفحةٍ وحدَها،
//   وبقيَ مبدأُ التي بعدها على ما كان، فيصير بينهما أطولَ من الصفحة،
//   فيُقصّ الزائدُ من نافذتها ولا يظهر في التي بعدها — فتسقط صفوفٌ
//   كاملةٌ من الكشف ولا يدري أحد (ملاحظة ٤٩٦). فصار الحسابُ في
//   التقسيم نفسِه، متتابعًا: كلُّ صفحةٍ تبدأ حيث انتهت التي قبلها.
function keepBlocks(flow, boxPx) {
  const top0 = flow.getBoundingClientRect().top;
  const box = el => {
    const r = el.getBoundingClientRect();
    return { top: r.top - top0, bottom: r.bottom - top0 };
  };
  return [...flow.querySelectorAll('.keep, tr')]
    .map(box)
    .filter(k => k.bottom - k.top > 1 && k.bottom - k.top < boxPx - 2)
    .sort((a, b) => a.top - b.top);
}

// html: متنُ المستند. title: عنوانُ النافذة واسمُ الملف عند الحفظ PDF.
export function printOnLetterhead(html, { title = 'مستند', autoPrint = true,
                                          repeatHead = '.repeat-head' } = {}) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title></title><style>
${FONT_FACE_CSS()}
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #fff; color: #1d2b3a;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  font-family: ${NASKH_STACK}; }
.sheet { position: relative; width: ${PAGE.w}mm; height: ${PAGE.h}mm;
  overflow: hidden; background: #fff; }
.sheet + .sheet { break-before: page; page-break-before: always; }
.sheet img.lh { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.win { position: absolute; top: ${PAGE.top}mm; inset-inline-start: ${PAGE.side}mm;
  width: ${BOX_W}mm; height: ${WIN_H}mm; overflow: hidden; }
.pageno { position: absolute; top: ${PAGE.top + WIN_H}mm; inset-inline-start: ${PAGE.side}mm;
  width: ${BOX_W}mm; height: ${BOX.numH}mm; display: flex; align-items: center;
  justify-content: center; font-size: 9pt; color: #6b6257; letter-spacing: .5px; direction: ltr; }
.flow { position: absolute; top: 0; inset-inline-start: 0; width: ${BOX_W}mm;
  font-size: 10.5pt; line-height: 1.85; }
#measure { position: absolute; visibility: hidden; top: -10000mm; inset-inline-start: 0;
  width: ${BOX_W}mm; }
${DOC_CSS}
@media screen { body { background: #d9d9d9; }
  .sheet { margin: 16px auto; box-shadow: 0 2px 12px #0003; } }
@media print { .sheet { margin: 0; box-shadow: none; height: ${PAGE.h - 0.5}mm; } }
</style></head><body><div id="pages"></div>
<div id="measure"><div class="flow doc"></div></div></body></html>`);
  w.document.close();
  const d = w.document;
  d.title = title;

  const build = async () => {
    const flow = d.querySelector('#measure .flow');
    flow.innerHTML = html;
    // النصُّ أوّلًا ثمَّ انتظارُ خطِّه، فالقياسُ بعدهما (ملاحظة ٤٣٠)
    await fontsSettled(d);
    // انتظارُ الصور (الباركود صورةٌ مضمَّنة) قبل القياس
    await Promise.all([...flow.querySelectorAll('img')].map(img => img.complete
      ? Promise.resolve()
      : new Promise(r => { img.onload = img.onerror = r; })));

    const probe = d.createElement('div');
    probe.style.cssText = `height:${WIN_H}mm;width:1px;position:absolute;visibility:hidden`;
    d.body.append(probe);
    const boxPx = probe.getBoundingClientRect().height;
    probe.remove();

    // ـــ رأسُ الجدول يُكرَّر في أعلى الصفحة إذا انقسم جدولُه عليها، لا
    //   في كلِّ صفحة: فالصفحةُ التي لا جدولَ فيها لا رأسَ لها
    //   (ملاحظة ٤٩٦)
    const top0 = flow.getBoundingClientRect().top;
    const span = el => {
      const r = el.getBoundingClientRect();
      return { top: r.top - top0, bottom: r.bottom - top0 };
    };
    const headEls = repeatHead ? [...flow.querySelectorAll(repeatHead)] : [];
    const tables = headEls.map(hd => {
      const tb = hd.parentElement?.querySelector('tbody');
      if (!tb) return null;
      const s2 = span(tb);
      return { head: hd, headH: Math.ceil(hd.getBoundingClientRect().height), ...s2 };
    }).filter(Boolean);
    const headH = tables.reduce((m, t) => Math.max(m, t.headH), 0);
    const usable = Math.max(40, boxPx - headH);
    // الجدولُ الذي يبدأ داخلَه مبدأُ هذه الصفحة
    const tableAt = y => tables.find(t => y > t.top + 1 && y < t.bottom - 1) || null;

    const total0 = await settledHeight(flow);
    const paged = flowStarts(flow, { doc: d, boxPx: usable, total: total0,
      keeps: keepBlocks(flow, usable) });
    const total = paged.total;
    const starts = paged.starts;

    // الكليشةُ العاملةُ: إصدارُ الهيئة المعتمَد إن بُدِّل (ملاحظة ٤٥٨)
    const lhUrl = (state.brand && state.brand.letterhead && state.brand.letterhead.url)
      || new URL(LETTERHEAD, location.origin).href;
    const pages = d.getElementById('pages');
    pages.append(...starts.map((start, i) => {
      const img = d.createElement('img');
      img.className = 'lh'; img.alt = ''; img.src = lhUrl;
      const clone = flow.cloneNode(true);
      const tbl = i > 0 ? tableAt(start) : null;
      const lift = tbl ? tbl.headH : 0;
      clone.style.top = `${-start + lift}px`;
      const win = d.createElement('div'); win.className = 'win'; win.append(clone);
      // ورأسُ الجدول فوقه، منسوخًا كما هو
      if (lift) {
        const hd = tbl.head.cloneNode(true);
        const wrap = d.createElement('div');
        wrap.className = 'doc repeat-head-fixed';
        wrap.style.cssText = `position:absolute;top:0;inset-inline-start:0;width:100%;`
          + `height:${lift}px;overflow:hidden;background:#fff`;
        const t2 = d.createElement('table');
        t2.className = tbl.head.closest('table')?.className || '';
        t2.style.width = '100%';
        t2.append(hd);
        wrap.append(t2);
        win.prepend(wrap);
      }
      const end = i + 1 < starts.length ? starts[i + 1] : Math.min(total, start + usable);
      // ولا تُقصُّ النافذةُ دون ما بين الصفحتين، فما يُقصُّ يسقط
      win.style.height = `${Math.max(0, Math.min(end - start, usable) + lift)}px`;
      // وإن انتهت الصفحةُ وسطَ جدولٍ أُغلق بخطٍّ في أسفلها، فلا يبقى
      //   الجدولُ مفتوحًا على بياض الورقة (ملاحظة ٤٩٦)
      if (i + 1 < starts.length && tableAt(end)) {
        const foot = d.createElement('div');
        foot.className = 'doc repeat-foot-fixed';
        foot.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:0;'
          + 'border-top:.25mm solid #bc9661';
        win.append(foot);
      }
      const num = d.createElement('div'); num.className = 'pageno';
      num.textContent = `${i + 1} / ${starts.length}`;
      const sheet = d.createElement('div'); sheet.className = 'sheet';
      sheet.append(img, win, num);
      return sheet;
    }));
    // ـــ حارسُ العدّ: صفوفُ المصدر تُقابَل بالمدى الذي غطَّته الصفحات،
    //   فإن سقط صفٌّ لم يُطبَع الكشفُ وقيل سببُه (ملاحظة ٤٩٦)
    const rows = [...flow.querySelectorAll('tbody tr')];
    if (rows.length) {
      const covered = starts.map((st, i) => ({
        a: st, b: i + 1 < starts.length ? starts[i + 1] : Math.min(total, st + usable)
      }));
      const lost = rows.filter(tr => {
        const r = tr.getBoundingClientRect();
        const a = r.top - top0, b = r.bottom - top0;
        return !covered.some(c => a >= c.a - 2 && b <= c.b + 2);
      });
      if (lost.length) {
        d.body.innerHTML = '<div style="font:14pt/1.9 sans-serif;direction:rtl;'
          + 'padding:28mm 22mm;color:#8a1c1c">'
          + '<h2>لم يكتمل تقسيمُ الصفحات</h2>'
          + `<p>سقط ${lost.length} صفًّا من ${rows.length} عند التقسيم، `
          + 'فلم يُفتَح الكشفُ لئلّا تُطبَع ورقةٌ ناقصةٌ وتُحسَب تامّة.</p>'
          + '<p>أعِدِ المحاولة، فإن تكرّر فأبلغْ إدارةَ المشروع.</p></div>';
        return;
      }
    }

    d.getElementById('measure')?.remove();
    if (autoPrint) setTimeout(() => { try { w.print(); } catch { /* يطبع بنفسه */ } }, 400);
  };
  if (d.readyState === 'complete') build(); else w.addEventListener('load', build);
  return true;
}
