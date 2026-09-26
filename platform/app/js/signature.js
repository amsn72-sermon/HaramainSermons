// التوقيع اليدوي: يرسمه العضو مرة بإصبعه أو بالفأرة فيُحفظ في ملفه،
// ثم يُدرَج مع التوقيع الإلكتروني عند كل توقيع بالعلم (ملاحظة ١١٠).
import { h } from './ui.js';

// لوح الرسم: يعيد { el, isEmpty(), toBlob(), clear() }
export function signaturePad({ width = 560, height = 180 } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const canvas = h('canvas.sig-canvas', { width: Math.round(width * dpr), height: Math.round(height * dpr),
    'aria-label': 'لوح التوقيع — ارسم توقيعك هنا' });
  canvas.style.width = '100%';
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  let drawing = false, empty = true, last = null;

  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (width / r.width), y: (e.clientY - r.top) * (height / r.height) };
  };
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    drawing = true; empty = false; last = pos(e);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; e.preventDefault();
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointerleave', stop);
  canvas.addEventListener('pointercancel', stop);

  const clear = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; };

  return {
    el: h('div.sig-pad', canvas, h('div.sig-line', { 'aria-hidden': 'true' })),
    canvas,
    isEmpty: () => empty,
    clear,
    toBlob: () => new Promise(res => canvas.toBlob(res, 'image/png'))
  };
}

// صورة التوقيع المحفوظ
export const signatureImg = (url, alt = 'التوقيع') => h('img.sig-img', { src: url, alt });
