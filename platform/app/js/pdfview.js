// عارض PDF آمن: صفحة واحدة في كل مرة على لوحة رسم، مع علامة مائية ببريد المستخدم.
// لا رابط للملف ولا تنزيل ولا فتح في نافذة: يُجلب الملف بمحتواه ويُرسم صورةً فقط.
import { h } from './ui.js';

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = await import('/vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  }
  return lib;
}

function watermark(ctx, w, hgt, lines) {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#b3261e';
  const size = Math.round(w / 34);
  ctx.font = `600 ${size}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.translate(w / 2, hgt / 2);
  ctx.rotate(-Math.PI / 6);
  const stepX = size * 18, stepY = size * 6;
  for (let y = -hgt; y <= hgt; y += stepY) {
    for (let x = -w; x <= w; x += stepX) {
      const off = (Math.round(y / stepY) % 2) * stepX / 2;
      lines.forEach((t, i) => ctx.fillText(t, x + off, y + i * size * 1.3));
    }
  }
  ctx.restore();
}

// أنواع التعديل على أصل الخطبة (ملاحظة ٢٨)
export const MARK_KINDS = { delete: 'حذف', add: 'إضافة', rephrase: 'إعادة صياغة', fix: 'تصحيح', other: 'أخرى' };

// url: رابط موقّع مؤقت — لا يُعرض للمستخدم. lines: نص العلامة المائية
// marks: مواضع التعديل المطلوبة على الأصل. onDraw: تفعيل التحديد بالسحب (للمنسق)
export function pdfViewer({ url, lines, marks = [], onDraw = null, onPage = null }) {
  const canvas = h('canvas.pdf-canvas', { 'aria-label': 'صفحة من الأصل العربي' });
  const layer = h('div.pdf-marks', { 'aria-hidden': 'true' });
  const status = h('span.pdf-count', '…');
  const prev = h('button.btn.sm', { type: 'button', disabled: true, 'aria-label': 'الصفحة السابقة' }, '→ السابقة');
  const next = h('button.btn.sm', { type: 'button', disabled: true, 'aria-label': 'الصفحة التالية' }, 'التالية ←');
  const stage = h('div.pdf-stage', canvas, layer);
  const frame = h('div.a4.pdf-page', stage);
  const el = h('div.pdf-viewer', { oncontextmenu: e => e.preventDefault(), ondragstart: e => e.preventDefault() },
    frame, h('div.pdf-nav', prev, status, next));
  let list = marks.slice();

  let doc = null, page = 1, rendering = null;
  async function render() {
    if (!doc) return;
    const p = await doc.getPage(page);
    const width = Math.max(frame.clientWidth, 300);
    const base = p.getViewport({ scale: 1 });
    // دقة أعلى من دقة الشاشة ليظهر النص واضحًا عند التكبير
    const scale = (width / base.width) * Math.max(2, Math.min(window.devicePixelRatio || 1, 3));
    const vp = p.getViewport({ scale });
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    canvas.style.width = '100%';
    const ctx = canvas.getContext('2d');
    if (rendering) { try { rendering.cancel(); } catch { /* */ } }
    rendering = p.render({ canvasContext: ctx, viewport: vp });
    try { await rendering.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
    watermark(ctx, canvas.width, canvas.height, lines);
    status.textContent = `صفحة ${page} من ${doc.numPages}`;
    prev.disabled = page <= 1; next.disabled = page >= doc.numPages;
    drawMarks();
    onPage && onPage(page, doc.numPages);
  }

  // ----- طبقة التحديدات فوق الصفحة -----
  function drawMarks() {
    const here = list.filter(m => Number(m.page) === page);
    layer.replaceChildren(...here.map((m, i) => h('div.mark', {
      'data-kind': m.kind,
      title: `${MARK_KINDS[m.kind] || m.kind}${m.note ? ' — ' + m.note : ''}`,
      style: { right: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }
    }, h('span.mark-tag', `${i + 1}. ${MARK_KINDS[m.kind] || m.kind}`))));
  }
  const go = d => { const n = page + d; if (doc && n >= 1 && n <= doc.numPages) { page = n; render(); } };
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);
  el.tabIndex = 0;
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowRight' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
  });
  let rt; const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(render, 150); });

  (async () => {
    try {
      const { getDocument } = await pdfjs();
      const res = await fetch(url);
      if (!res.ok) throw new Error('تعذّر تحميل الأصل');
      const data = new Uint8Array(await res.arrayBuffer());
      // disableFontFace: ترسم الحروف مساراتٍ من الخط المضمّن في الملف نفسه،
      // فتظهر الخطوط العربية موصولة كما في الأصل على كل المتصفحات (ملاحظة ٣٠)
      doc = await getDocument({ data, isEvalSupported: false, disableFontFace: true,
        useSystemFonts: false, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
      ro.observe(frame);
      await render();
    } catch (e) {
      frame.replaceChildren(h('p.muted', { style: { padding: '16px' } }, e.message || 'تعذّر عرض الملف'));
      status.textContent = '';
    }
  })();
  // ----- التحديد بالسحب: يعطي إحداثيات نسبية للصفحة الحالية -----
  if (onDraw) {
    el.classList.add('drawing');
    let start = null; const box = h('div.mark.draft');
    const rel = e => { const r = stage.getBoundingClientRect();
      return { x: (r.right - e.clientX) / r.width, y: (e.clientY - r.top) / r.height }; };
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      start = rel(e); stage.setPointerCapture(e.pointerId); layer.append(box); e.preventDefault();
    });
    stage.addEventListener('pointermove', e => {
      if (!start) return;
      const p = rel(e);
      Object.assign(box.style, { right: `${Math.min(start.x, p.x) * 100}%`, top: `${Math.min(start.y, p.y) * 100}%`,
        width: `${Math.abs(p.x - start.x) * 100}%`, height: `${Math.abs(p.y - start.y) * 100}%` });
    });
    stage.addEventListener('pointerup', e => {
      if (!start) return;
      const p = rel(e); const s0 = start; start = null; box.remove();
      const rect = { page, x: Math.min(s0.x, p.x), y: Math.min(s0.y, p.y),
        w: Math.abs(p.x - s0.x), h: Math.abs(p.y - s0.y) };
      if (rect.w < 0.01 || rect.h < 0.008) return;   // نقرة عابرة
      onDraw(rect);
    });
  }

  el.setMarks = next => { list = next.slice(); drawMarks(); };
  el.goToPage = n => { if (doc && n >= 1 && n <= doc.numPages) { page = n; render(); } };
  return el;
}
