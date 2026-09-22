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
  ctx.globalAlpha = 0.18;
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

// url: رابط موقّع مؤقت — لا يُعرض للمستخدم. lines: نص العلامة المائية
export function pdfViewer({ url, lines }) {
  const canvas = h('canvas.pdf-canvas', { 'aria-label': 'صفحة من الأصل العربي' });
  const status = h('span.pdf-count', '…');
  const prev = h('button.btn.sm', { type: 'button', disabled: true, 'aria-label': 'الصفحة السابقة' }, '→ السابقة');
  const next = h('button.btn.sm', { type: 'button', disabled: true, 'aria-label': 'الصفحة التالية' }, 'التالية ←');
  const frame = h('div.a4.pdf-page', canvas);
  const el = h('div.pdf-viewer', { oncontextmenu: e => e.preventDefault(), ondragstart: e => e.preventDefault() },
    frame, h('div.pdf-nav', prev, status, next));

  let doc = null, page = 1, rendering = null;
  async function render() {
    if (!doc) return;
    const p = await doc.getPage(page);
    const width = Math.max(frame.clientWidth, 300);
    const base = p.getViewport({ scale: 1 });
    const scale = (width / base.width) * Math.min(window.devicePixelRatio || 1, 2);
    const vp = p.getViewport({ scale });
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d');
    if (rendering) { try { rendering.cancel(); } catch { /* */ } }
    rendering = p.render({ canvasContext: ctx, viewport: vp });
    try { await rendering.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
    watermark(ctx, canvas.width, canvas.height, lines);
    status.textContent = `صفحة ${page} من ${doc.numPages}`;
    prev.disabled = page <= 1; next.disabled = page >= doc.numPages;
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
      doc = await getDocument({ data, isEvalSupported: false,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/' }).promise;
      ro.observe(frame);
      await render();
    } catch (e) {
      frame.replaceChildren(h('p.muted', { style: { padding: '16px' } }, e.message || 'تعذّر عرض الملف'));
      status.textContent = '';
    }
  })();
  return el;
}
