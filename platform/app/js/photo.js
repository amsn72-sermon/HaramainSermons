// الصورة الشخصية ٤×٦ بشروط الصور الرسمية (ملاحظة ٨٥)
// تُقصّ في المتصفح إلى نسبة ٢:٣ وتُصغَّر، فلا يُرفع إلا ملف صغير مضبوط.

export const PHOTO = {
  ratio: 4 / 6,            // عرض ÷ ارتفاع
  outW: 600, outH: 900,    // ٤×٦ سم عند ٣٠٠ نقطة/بوصة تقريبًا
  minW: 300, minH: 450,    // أقل من ذلك يخرج باهتًا في الطباعة
  maxBytes: 8 * 1024 * 1024
};

export const PHOTO_RULES = [
  'صورة حديثة ملوّنة، الوجه واضح ومواجه للكاميرا.',
  'خلفية بيضاء أو فاتحة سادة بلا ظلال ولا زخرفة.',
  'الرأس والكتفان في الصورة، والوجه يملأ نحو ثلثي الطول.',
  'بلا نظارة شمسية، ولا غطاء يحجب الوجه، والنظارة الطبية بلا انعكاس.',
  'لا تُقبل صورة من هوية مصوّرة ولا لقطة شاشة ولا صورة جماعية.'
];

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذّر قراءة الصورة')); };
    img.src = url;
  });
}

// يقصّ من الوسط إلى نسبة ٤:٦ — والوجه في الصور الشخصية وسط الإطار
export function cropToCard(img) {
  const srcRatio = img.naturalWidth / img.naturalHeight;
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  if (srcRatio > PHOTO.ratio) {           // أعرض من اللازم: نقصّ الجانبين
    sw = Math.round(img.naturalHeight * PHOTO.ratio);
    sx = Math.round((img.naturalWidth - sw) / 2);
  } else {                                 // أطول من اللازم: نقصّ من الأسفل أكثر
    sh = Math.round(img.naturalWidth / PHOTO.ratio);
    sy = Math.round((img.naturalHeight - sh) * 0.35);
  }
  const c = document.createElement('canvas');
  c.width = PHOTO.outW; c.height = PHOTO.outH;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

export function canvasToBlob(canvas, quality = 0.88) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('تعذّر تجهيز الصورة')), 'image/jpeg', quality));
}

// يفحص الملف ويعيد { blob, dataUrl } جاهزًا للرفع، أو يرمي رسالة عربية
export async function preparePhoto(file) {
  if (!file) throw new Error('اختر صورة');
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('الصورة بصيغة JPG أو PNG أو WEBP');
  if (file.size > PHOTO.maxBytes) throw new Error('حجم الصورة أكبر من ٨ ميغابايت');
  const img = await loadImage(file);
  if (img.naturalWidth < PHOTO.minW || img.naturalHeight < PHOTO.minH) {
    throw new Error(`الصورة صغيرة (${img.naturalWidth}×${img.naturalHeight}) — الحد الأدنى ${PHOTO.minW}×${PHOTO.minH}`);
  }
  const canvas = cropToCard(img);
  const blob = await canvasToBlob(canvas);
  return { blob, dataUrl: canvas.toDataURL('image/jpeg', 0.88) };
}

// تحويل رابط إلى data: للطباعة — الصور الموقّعة لا تُطبع من رابط مؤقت بثقة
export async function urlToDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('تعذّر جلب الصورة');
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('تعذّر قراءة الصورة'));
    fr.readAsDataURL(blob);
  });
}

// صورة التسجيل تُحفظ في المتصفح حتى أول دخول، فلا رفع قبل وجود حساب
const STASH = 'hs-photo-pending';
export const stashPhoto = (email, dataUrl) => {
  try { localStorage.setItem(STASH, JSON.stringify({ email: String(email || '').toLowerCase(), dataUrl })); }
  catch { /* وضع التصفح الخاص: تُطلب الصورة من «بياناتي» */ }
};
export const readStashed = email => {
  try {
    const v = JSON.parse(localStorage.getItem(STASH) || 'null');
    return v && v.email === String(email || '').toLowerCase() ? v.dataUrl : null;
  } catch { return null; }
};
export const clearStashed = () => { try { localStorage.removeItem(STASH); } catch { /* لا شيء */ } };

export function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const type = (head.match(/:(.*?);/) || [, 'image/jpeg'])[1];
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
}

// ---------------------------------------------------------------------
// شعارٌ أو توقيعٌ يُرفَع ويُدرَج في المستند (ملاحظتا ٢٨٢ و٢٨٣)
//   الشفافيةُ تُحفظ، فتُحوَّل PNG لا JPG، ويُصغَّر فلا يثقل السجلّ،
//   ولا يُرفع إلى مخزنٍ أصلًا: يُحفظ في بيانات التصميم نصًّا.
// ---------------------------------------------------------------------
export const MARK = { maxPx: 600, maxBytes: 4 * 1024 * 1024, maxOut: 220 * 1024 };

export async function prepareMark(file, maxPx = MARK.maxPx) {
  if (!file) throw new Error('اختر صورة');
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
    throw new Error('الصورة بصيغة PNG أو JPG أو WEBP أو SVG');
  }
  if (file.size > MARK.maxBytes) throw new Error('حجم الصورة أكبر من ٤ ميغابايت');
  const img = await loadImage(file);
  const w = img.naturalWidth || 1, hgt = img.naturalHeight || 1;
  const k = Math.min(1, maxPx / Math.max(w, hgt));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(hgt * k));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/png');
  if (url.length > MARK.maxOut * 1.37) {
    throw new Error('الصورة كبيرةٌ على الحفظ — اختر صورةً أصغر أو أوضح خلفيتَها');
  }
  return url;
}
