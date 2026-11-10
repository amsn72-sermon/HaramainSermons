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
  // طولُ ما رُسم بالبكسل: نقرةٌ واحدةٌ لا تُعَدُّ توقيعًا (ملاحظة ٤٩٠)
  let inked = 0;
  const MIN_INK = 60;

  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (width / r.width), y: (e.clientY - r.top) * (height / r.height) };
  };
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    drawing = true; last = pos(e);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    inked += Math.hypot(p.x - last.x, p.y - last.y);
    if (inked >= MIN_INK) empty = false;
    last = p; e.preventDefault();
  });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointerleave', stop);
  canvas.addEventListener('pointercancel', stop);

  const clear = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    empty = true; inked = 0;
  };

  return {
    el: h('div.sig-pad', canvas, h('div.sig-line', { 'aria-hidden': 'true' })),
    canvas,
    isEmpty: () => empty,
    inked: () => inked,
    clear,
    toBlob: () => new Promise(res => canvas.toBlob(res, 'image/png'))
  };
}

// صورة التوقيع المحفوظ
export const signatureImg = (url, alt = 'التوقيع') => h('img.sig-img', { src: url, alt });

// ---------------------------------------------------------------------
// رفعُ صورة التوقيع — أُغلق هذا الباب (ملاحظة ٤٩٠)
//
//   كان مُتاحًا لمن توقيعُه ممسوحٌ (ملاحظة ٢١٥)، فجاء الكشفُ وفيه من
//   رفع صورتَه الشخصية مكانَ توقيعه، ومن رفع صورةً بيضاءَ لا أثرَ
//   فيها. والتوقيعُ إنما يُراد لأنه فعلُ صاحبه بيده. فبقيت الدالّةُ
//   هنا ولا تُستعمَل في شاشات التوقيع، وإنما تُستدعى بوجهٍ موسومٍ
//   «مرفوع» إن احتيج إليها يومًا بإذنٍ خاصّ.
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
      await db.rpc('set_my_signature', { p_path: path, p_kind: 'uploaded' });
      toast('حُفظت صورة توقيعك.', 'ok');
      onSaved && onSaved(path);
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
    } finally { input.value = ''; }
  };

  return h('div.stack.sig-upload', { style: { gap: '6px' } },
    h('label.field', label, input), note, err);
}


// ---------------------------------------------------------------------
// فحصُ صورة التوقيع (ملاحظة ٤٩٠)
//
//   التوقيعُ خطوطٌ سودٌ قليلةٌ على بياض: حبرُه يسيرٌ ولونُه واحد. فإذا
//   كانت الصورةُ بلا حبرٍ تقريبًا فهي فارغة، وإذا كثر فيها اللونُ أو
//   امتلأت بالحبر فهي صورةٌ لا توقيع — وأكثرُ ما وقع صورةٌ شخصية.
//   والحكمُ هنا كاشفٌ للمراجِع لا قاضٍ: يُعرَض عليه ما اشتُبه فيه.
// ---------------------------------------------------------------------
export const SIG_VERDICT = {
  ok:      ['مقبول', 'ok'],
  blank:   ['فارغٌ أو شبهُ فارغ', 'bad'],
  photo:   ['صورةٌ لا توقيع', 'bad'],
  colored: ['صورةٌ ملوّنة', 'warn'],
  heavy:   ['حبرٌ كثيفٌ — يُراجَع', 'warn'],
  unread:  ['تعذَّر فحصُها', 'warn']
};

export function signatureQuality(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve({ verdict: 'unread' });
    img.onload = () => {
      try {
        const W = 160, H = Math.max(1, Math.round(W * (img.height || 1) / (img.width || 1)));
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d', { willReadFrequently: true });
        // على بياضٍ، فالـPNG الشفّافُ يُقرأ كما يُطبَع
        x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
        x.drawImage(img, 0, 0, W, H);
        const d = x.getImageData(0, 0, W, H).data;
        let ink = 0, colored = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          n++;
          if (mx < 225) ink++;                       // ليس بياضًا
          if (mx - mn > 42 && mx > 60) colored++;     // فيه لونٌ لا رمادٌ
        }
        const inkR = ink / n, colR = colored / n;
        const verdict = inkR < 0.004 ? 'blank'
          : colR > 0.16 ? 'photo'
          : colR > 0.05 ? 'colored'
          : inkR > 0.40 ? 'heavy'
          : 'ok';
        resolve({ verdict, ink: inkR, color: colR });
      } catch { resolve({ verdict: 'unread' }); }
    };
    img.src = url;
  });
}
