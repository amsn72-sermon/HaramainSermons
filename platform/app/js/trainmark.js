// العلامةُ المائيةُ على ما يُنزَّل من موادِّ التدريب (ملاحظة ٣٧٢)
//
//   موادُّ التدريب تخرج من المنصة إلى أجهزة الأعضاء، فإن سُرِّبت لم
//   يُعرَف من سرَّبها. فصار كلُّ ما يُنزَّل من خطط التدريب يحمل بريدَ
//   مَن نزَّله ووقتَ تنزيله: مائلًا باهتًا خلفَ النصِّ لا يحجب القراءة،
//   متكرِّرًا في كلِّ صفحة.
//
//   والصادقُ أن يُقال: ملفُّ PDF يُعاد بناؤه هنا صفحةً صفحةً فتُغرَز
//   فيه العلامة، فما خرج موسومٌ لا يُنزَع وسمُه. وأمّا العرضُ التقديميُّ
//   فلا يُعاد بناؤه في المتصفح، فيُنزَّل كما هو ويُقيَّد تنزيلُه في
//   السجل — ويُقال لصاحبه ذلك صراحةً.
//
//   ولا تُمَسُّ بهذه العلامةِ مخرجاتُ الأرشيف ولا الخطبُ ولا الشهادات:
//   موادُّ التدريب وحدَها كما نُصَّ.
import { toast } from './ui.js';
import { state } from './store.js';

export const markerOf = () =>
  (state.profile?.email || state.profile?.full_name || 'غيرُ معروف');

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const stampLine = () => {
  const now = new Date();
  const d = now.toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn',
    { year: 'numeric', month: 'long', day: 'numeric' });
  const t = now.toLocaleTimeString('ar-SA-u-nu-latn',
    { hour: '2-digit', minute: '2-digit' });
  return `${d} — ${t}`;
};

// نسخةٌ موسومةٌ من ملفِّ PDF: صفحاتُه صورًا وعليها بريدُ المنزِّل
export async function openWatermarkedPdf(url, { title = 'مادة تدريبية' } = {}) {
  const { pdfPageImages } = await import('./pdfview.js');
  const { pages, total } = await pdfPageImages(url, { dpi: 150 });
  if (!pages.length) throw new Error('تعذّرت قراءةُ الملف');

  const who = markerOf();
  const when = stampLine();
  const w = window.open('', '_blank');
  if (!w) return false;

  // العلامةُ شبكةٌ مائلةٌ من البريد، تُرسَم طبقةً فوق صورة الصفحة
  const tile = `${who} · ${when}`;
  const sheets = pages.map((p, i) => `
    <div class="sheet" style="width:${p.mmW}mm;height:${p.mmH}mm">
      <img class="pg" src="${p.url}" alt="">
      <div class="wm" aria-hidden="true">${Array.from({ length: 28 },
        () => `<span>${esc(tile)}</span>`).join('')}</div>
      <div class="foot" dir="ltr">${esc(who)} · ${esc(when)}
        · ${i + 1} / ${pages.length}</div>
    </div>`).join('');

  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${esc(title)}</title><style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #d9d9d9; }
  .sheet { position: relative; overflow: hidden; background: #fff; margin: 10px auto;
    box-shadow: 0 2px 12px #0003; }
  .sheet + .sheet { break-before: page; page-break-before: always; }
  .sheet img.pg { position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: contain; }
  .wm { position: absolute; inset: -20%; display: flex; flex-wrap: wrap;
    align-content: center; justify-content: center; gap: 8mm 14mm;
    transform: rotate(-28deg); pointer-events: none; }
  .wm span { font: 700 9pt/1.2 system-ui, sans-serif; color: rgba(90, 90, 90, .17);
    white-space: nowrap; letter-spacing: .4px; }
  .foot { position: absolute; bottom: 2mm; inset-inline: 6mm; text-align: center;
    font: 7pt system-ui, sans-serif; color: rgba(60, 60, 60, .55); }
  .bar { position: sticky; top: 0; z-index: 9; display: flex; gap: 8px;
    align-items: center; justify-content: center; padding: 8px;
    background: #1d2b3a; color: #fff; font: 13px system-ui, sans-serif; }
  .bar button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 0;
    background: #b9975b; color: #1d2b3a; font-weight: 700; cursor: pointer; }
  @media print { .bar { display: none; } html, body { background: #fff; }
    .sheet { margin: 0; box-shadow: none; } }
</style></head><body>
<div class="bar"><span>نسخةٌ موسومةٌ باسمك: ${esc(who)}</span>
  <button type="button" onclick="window.print()">احفظْها PDF أو اطبعْها</button></div>
${sheets}
${total > pages.length ? `<div class="bar">عُرضت ${pages.length} من ${total} صفحة</div>` : ''}
</body></html>`);
  w.document.close();
  return true;
}

// تنزيلُ مادةٍ موسومةً: ما كان PDF أُعيد بناؤه، وما سواه نُزِّل كما هو
export async function downloadMarked(mat, { signedUrl, log } = {}) {
  if (log) { try { await log(); } catch (e) { toast(e.message, 'bad'); return; } }
  let url = '';
  try { url = await signedUrl(); } catch (e) { toast(e.message, 'bad'); return; }
  if (mat?.kind === 'pdf') {
    try {
      if (!await openWatermarkedPdf(url, { title: mat.title })) {
        toast('اسمح بالنوافذ المنبثقة لتخرج النسخةُ الموسومة.', 'bad');
      }
      return;
    } catch (e) {
      toast(`تعذّر وسمُ الملف: ${e.message}`, 'bad');
      return;
    }
  }
  toast('هذا الملفُّ لا يُوسَم في المتصفح — نُزِّل كما هو، وقُيِّد تنزيلُه باسمك.', 'warn');
  window.open(url, '_blank', 'noopener');
}
