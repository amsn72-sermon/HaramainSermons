// بطاقات خدمات المبادرة: قالبٌ واحد بهوية الهيئة، ولكل خدمة رسمُها الدالّ على
// محتواها ورمزُها (QR) — تُعرض في الصفحة، وتُنزَّل صورةً، وتُطبع صفحةً واحدة (ملاحظة ١٤٠).
import { h } from './ui.js';
import { qrMatrix, qrDataUri } from './qr.js';

import { openSheetWindow, measureBlocks, flowBlocks, mm2px, sheetCss, winHeight } from './sheetflow.js';

const GOLD = '#bc9661';
const INK = '#1a232d';
const MUTED = '#c8cfd6';

// رسمٌ خطّي لكل خدمة (viewBox 24×24، خطوط فقط ليُرسم على اللوح كما يُعرض في الصفحة)
export const SERVICE_ART = {
  broadcast: {
    label: 'البث المباشر',
    paths: ['M5 21V12.5a7 7 0 0 1 14 0V21', 'M12 5.5V3.2', 'M2.5 21h19',
      'M10.2 21v-4.2a1.8 1.8 0 0 1 3.6 0V21',
      'M2.6 10.2A7.6 7.6 0 0 1 5 5.6', 'M21.4 10.2A7.6 7.6 0 0 0 19 5.6'],
    circles: []
  },
  archive: {
    label: 'الأرشيف',
    paths: ['M3.5 8h17v12.5h-17z', 'M3.5 8 5.6 4.2h12.8L20.5 8', 'M9.5 11.8h5'],
    circles: []
  },
  arafah: {
    label: 'خطبة عرفة',
    paths: ['M2.5 20.5h19', 'M4.5 20.5 10 11.5l2.8 4.2 2-2.8 4.7 7.6'],
    circles: [[17.5, 6.2, 2.2]]
  },
  verify: {
    label: 'التحقق',
    paths: ['M12 3.2 19 6v6.1c0 4.1-2.9 7.2-7 8.4-4.1-1.2-7-4.3-7-8.4V6z',
      'M9 12.1l2.2 2.2 4-4.2'],
    circles: []
  },
  platform: {
    label: 'منصة العمل',
    paths: ['M3.2 5h17.6v11.2H3.2z', 'M8.5 20.5h7', 'M12 16.2v4.3', 'M7 10.6h10'],
    circles: [[7, 10.6, 1.5], [12, 10.6, 1.5], [17, 10.6, 1.5]]
  }
};

// الخدمة تُعرف من رابطها، فلا يحتاج المحتوى المحفوظ إلى تغيير
export function serviceKey(url) {
  const u = String(url || '');
  if (/platform\./.test(u)) return 'platform';
  if (/\/verify/.test(u)) return 'verify';
  if (/\/arafah/.test(u)) return 'arafah';
  if (/tab=archive/.test(u)) return 'archive';
  return 'broadcast';
}

export function serviceIcon(key, { size = 46, color = GOLD } = {}) {
  const art = SERVICE_ART[key] || SERVICE_ART.broadcast;
  const el = h('span.svc-ico', { 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}"
    stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">`
    + art.paths.map(d => `<path d="${d}"/>`).join('')
    + art.circles.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join('')
    + '</svg>';
  return el;
}

// ---------------------------------------------------------------------
// صورة البطاقة: لوحٌ واحد يُنزَّل ويُرسل كما هو
// ---------------------------------------------------------------------
const loadImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('تعذّر تحميل الشعار'));
  img.src = src;
});

function drawArt(ctx, key, x, y, size, color = GOLD) {
  const art = SERVICE_ART[key] || SERVICE_ART.broadcast;
  const s = size / 24;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const d of art.paths) ctx.stroke(new Path2D(d));
  for (const [cx, cy, r] of art.circles) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = []; let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// بطاقة عمودية 1000×1400: الشعار، الرسم، العنوان، الرمز، الرابط
export async function cardCanvas({ title, note, url, key }, { scale = 1 } = {}) {
  const W = 1000, H = 1500;
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  const font = "'Haramain Arabic', system-ui, sans-serif";

  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
  // شريط ذهبي علوي
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, GOLD); grad.addColorStop(0.5, '#7b5d31'); grad.addColorStop(1, GOLD);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, 10);
  // إطار داخلي
  ctx.strokeStyle = 'rgba(188,150,97,.35)'; ctx.lineWidth = 2;
  ctx.strokeRect(40, 40, W - 80, H - 80);

  ctx.textAlign = 'center'; ctx.direction = 'rtl';

  try {
    const logo = await loadImage('/assets/alharamain-logo.png');
    const lw = 320, lh = lw * (logo.height / logo.width);
    ctx.drawImage(logo, (W - lw) / 2, 95, lw, lh);
  } catch { /* البطاقة تبقى بلا شعار إن تعذّر تحميله */ }

  drawArt(ctx, key, (W - 120) / 2, 300, 120);

  ctx.fillStyle = '#ffffff';
  ctx.font = `700 54px ${font}`;
  const lines = wrapText(ctx, title, W - 200);
  let y = 500;
  for (const ln of lines) { ctx.fillText(ln, W / 2, y); y += 70; }

  if (note) {
    ctx.fillStyle = MUTED; ctx.font = `400 30px ${font}`;
    for (const ln of wrapText(ctx, note, W - 240)) { ctx.fillText(ln, W / 2, y + 10); y += 44; }
  }

  // الرمز في إطار أبيض — موضعه محسوب من أسفل البطاقة فلا يزاحم النص ولا التذييل
  const qr = qrMatrix(url);
  const n = qr.length;
  let box = 440;
  const qx0 = () => (W - box) / 2;
  let qy = H - 210 - box;
  if (qy < y + 50) { box = Math.max(320, box - (y + 50 - qy)); qy = H - 210 - box; }
  const pad = 26, qx = qx0();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(qx - pad, qy - pad, box + pad * 2, box + pad * 2);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 3;
  ctx.strokeRect(qx - pad, qy - pad, box + pad * 2, box + pad * 2);
  const cell = box / n;
  ctx.fillStyle = '#111111';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
    if (qr[r][col]) ctx.fillRect(qx + col * cell, qy + r * cell, Math.ceil(cell), Math.ceil(cell));
  }

  ctx.direction = 'ltr';
  ctx.fillStyle = GOLD; ctx.font = `600 30px ${font}`;
  ctx.fillText(String(url).replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, qy + box + 80);

  ctx.direction = 'rtl';
  ctx.fillStyle = MUTED; ctx.font = `400 26px ${font}`;
  ctx.fillText('الهيئة العامة للعناية بشؤون المسجد الحرام والمسجد النبوي', W / 2, H - 60);
  return c;
}

export async function downloadCard(service) {
  const c = await cardCanvas(service, { scale: 1 });
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  const a = h('a', { href: URL.createObjectURL(blob), download: `${service.title}.png` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------------------------------------------------------------------
// صفحة واحدة تجمع البطاقات، تُطبع على كليشة الهيئة
// ---------------------------------------------------------------------
export function printSheet(services, { title = 'خدمات المبادرة' } = {}) {
  const cards = services.map(s => {
    const art = SERVICE_ART[s.key] || SERVICE_ART.broadcast;
    const svg = `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="${GOLD}"
      stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">`
      + art.paths.map(d => `<path d="${d}"/>`).join('')
      + art.circles.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join('')
      + '</svg>';
    return `<div class="qcard">
      <div class="qhead">${svg}<b>${s.title}</b></div>
      <img class="q" src="${qrDataUri(s.url)}" alt="">
      <div class="qurl" dir="ltr">${String(s.url).replace(/^https?:\/\//, '').replace(/\/$/, '')}</div>
      ${s.note ? `<div class="qnote">${s.note}</div>` : ''}
    </div>`;
  });

  // البطاقاتُ تُقاس وتُوزَّع على صفحاتٍ، فلا تفيض إن كثُرت (ملاحظة ٢٨٠ ح)
  const ctx = openSheetWindow(sheetCss(`
  h1 { color: #1a232d; }
  .lead { font-size: 9.5pt; text-align: center; color: #5b5349; margin: 0 0 4mm; }
  .qrow { display: grid; grid-template-columns: repeat(2, 1fr); gap: 5mm; margin-bottom: 5mm; }
  .qcard { border: .4mm solid #bc9661; border-radius: 3mm; padding: 3mm; text-align: center; }
  .qhead { display: flex; align-items: center; justify-content: center; gap: 2mm; margin-bottom: 1.5mm; }
  .qhead b { font-size: 11pt; color: #1a232d; }
  .qcard img.q { width: 28mm; height: 28mm; display: block; margin: 0 auto 1.5mm; }
  .qurl { font-size: 8.5pt; color: #8a6835; direction: ltr; }
  .qnote { font-size: 8pt; color: #6b6257; margin-top: 1mm; }`));
  if (!ctx) return false;
  const { el, pages, measure, w } = ctx;

  ctx.ready(() => {
    // صفَّان في كلِّ سطر، والسطرُ كتلةٌ تُقاس ولا تُقسَم
    const blocks = [
      { html: `<h1>${title}</h1>` },
      { html: '<p class="lead">امسح الرمز بكاميرا الجوال للوصول إلى الخدمة مباشرة</p>' }
    ];
    for (let i = 0; i < cards.length; i += 2) {
      blocks.push({ html: `<div class="qrow">${cards.slice(i, i + 2).join('')}</div>` });
    }
    measureBlocks(w, measure, blocks);

    const sheets = [];
    const nextBox = () => {
      const { sheet, win } = ctx.sheet();
      sheets.push(sheet);
      return win;
    };
    flowBlocks(blocks, mm2px(winHeight()), nextBox);
    sheets.forEach((sh, i) => sh.append(el('div', 'pageno',
      sheets.length > 1 ? `${i + 1} / ${sheets.length}` : '')));
    pages.replaceChildren(...sheets);
    measure.remove();
  });
  return true;
}
