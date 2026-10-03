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

// ---------------------------------------------------------------------
// رفعُ صورة التوقيع: لمن كان توقيعُه مصوَّرًا أو ممسوحًا، فلا يُلزَم
// بالرسم باليد. والرسمُ باقٍ كما هو، والخياران معًا (ملاحظة ٢١٥)
// ---------------------------------------------------------------------
const SIG_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const SIG_MAX = 2 * 1024 * 1024;        // ميغابايتان تكفي صورةَ توقيع

export function signatureUpload({ memberId, onSaved, label = 'أو ارفع صورة توقيعك' }) {
  const input = h('input', { type: 'file', accept: SIG_TYPES.join(','), 'aria-label': 'صورة التوقيع' });
  const note = h('p.small.muted', 'صورةٌ بخلفيةٍ بيضاء أو شفافة، بصيغة PNG أو JPG، لا تتجاوز ميغابايتين.');
  const err = h('p.small.warn', { hidden: true });

  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    err.hidden = true;
    if (!SIG_TYPES.includes(f.type)) {
      err.textContent = 'الصيغة غير مقبولة: PNG أو JPG أو WebP.'; err.hidden = false; input.value = ''; return;
    }
    if (f.size > SIG_MAX) {
      err.textContent = 'الصورة أكبر من ميغابايتين — اضغطها ثم أعد الرفع.'; err.hidden = false; input.value = ''; return;
    }
    try {
      const { db, storage } = await import('./sb.js');
      const { toast } = await import('./ui.js');
      const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${memberId}/sig-${Date.now()}.${ext}`;
      await storage.upload('signatures', path, f);
      await db.rpc('set_my_signature', { p_path: path });
      toast('حُفظت صورة توقيعك.', 'ok');
      onSaved && onSaved(path);
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
    } finally { input.value = ''; }
  };

  return h('div.stack.sig-upload', { style: { gap: '6px' } },
    h('label.field', label, input), note, err);
}
