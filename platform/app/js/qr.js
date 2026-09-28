// رمز QR يُولَّد داخل المنصة بلا خدمة خارجية ولا مكتبة: نمط بايت، تصحيح خطأ M،
// ويُرسم SVG قابلًا للطباعة على الكليشة (ملاحظة ١٣٤).

// لكل نسخة: [عدد بايتات التصحيح في الكتلة، عدد الكتل] عند مستوى التصحيح M
const ECC_M = {
  1: [10, 1], 2: [16, 1], 3: [26, 1], 4: [18, 2], 5: [24, 2], 6: [16, 4],
  7: [18, 4], 8: [22, 4], 9: [22, 5], 10: [26, 5], 11: [30, 5], 12: [22, 8]
};
// مجموع بايتات الترميز في كل نسخة
const TOTAL = {
  1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172,
  7: 196, 8: 242, 9: 292, 10: 346, 11: 404, 12: 466
};
// مواضع مربّعات الضبط
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58]
};
const MAX_VERSION = 12;
const dataCapacity = v => TOTAL[v] - ECC_M[v][0] * ECC_M[v][1];

// ---------------------------------------------------------------------
// حساب في حقل غالوا GF(256) لتصحيح الخطأ (ريد–سولومون)
// ---------------------------------------------------------------------
function gfMul(a, b) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((b >>> i) & 1) * a;
  }
  return z & 0xFF;
}
function rsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

// ---------------------------------------------------------------------
// الترميز: نمط البايت (UTF-8)
// ---------------------------------------------------------------------
function encodeBits(bytes, version) {
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4);                                  // نمط البايت
  push(bytes.length, version <= 9 ? 8 : 16);        // عدد المحارف
  for (const b of bytes) push(b, 8);
  const capacityBits = dataCapacity(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // خاتمة
  while (bits.length % 8 !== 0) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  for (let pad = 0xEC; out.length < dataCapacity(version); pad ^= 0xEC ^ 0x11) out.push(pad);
  return out;
}

function addEccAndInterleave(data, version) {
  const [eccLen, numBlocks] = ECC_M[version];
  const raw = TOTAL[version];
  const shortLen = Math.floor(raw / numBlocks);
  const numShort = numBlocks - (raw % numBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen - eccLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len); k += len;
    const ecc = [...rsRemainder(dat, div)];
    if (i < numShort) dat.push(0);        // موضع فارغ يُتجاوَز عند التشابك
    blocks.push(dat.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i]);
    });
  }
  return result;
}

// ---------------------------------------------------------------------
// بناء المصفوفة
// ---------------------------------------------------------------------
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    if (bytes.length * 8 + headerBits <= dataCapacity(v) * 8) { version = v; break; }
  }
  if (!version) throw new Error('النص أطول مما يحمله رمز QR');

  const size = version * 4 + 17;
  const mods = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { mods[y][x] = dark; fn[y][x] = true; } };

  // خطّا التوقيت أولًا، ثم مربّعات التوجيه فتغطّي ما دخل في محيطها
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }

  // مربّعات التوجيه الثلاثة ومحيطها
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      setFn(cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

  // مربّعات الضبط
  const al = ALIGN[version];
  for (const y of al) for (const x of al) {
    if ((x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // حجز مواضع معلومات النسق (تُكتب بعد اختيار القناع)
  const reserveFormat = () => {
    for (let i = 0; i <= 5; i++) setFn(8, i, false);
    setFn(8, 7, false); setFn(8, 8, false); setFn(7, 8, false);
    for (let i = 9; i <= 14; i++) setFn(14 - i, 8, false);
    for (let i = 0; i <= 7; i++) setFn(size - 1 - i, 8, false);
    for (let i = 8; i <= 14; i++) setFn(8, size - 15 + i, false);
    setFn(8, size - 8, true);
  };
  reserveFormat();

  // معلومات النسخة (من النسخة ٧)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFn(a, b, bit); setFn(b, a, bit);
    }
  }

  // البيانات في مسار متعرّج
  const codewords = addEccAndInterleave(encodeBits(bytes, version), version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < codewords.length * 8) {
          mods[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }

  // القناع: يُختار أقلُّها عقوبةً كما في المعيار
  const maskFn = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  ];
  const applyMask = m => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (!fn[y][x] && maskFn[m](x, y)) mods[y][x] = !mods[y][x];
    }
  };
  const drawFormat = m => {
    const data = (0 << 3) | m;            // مستوى التصحيح M = 00
    let rem = data;
    for (let k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = k => ((bits >>> k) & 1) === 1;
    for (let k = 0; k <= 5; k++) setFn(8, k, bit(k));
    setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
    for (let k = 9; k <= 14; k++) setFn(14 - k, 8, bit(k));
    for (let k = 0; k <= 7; k++) setFn(size - 1 - k, 8, bit(k));
    for (let k = 8; k <= 14; k++) setFn(8, size - 15 + k, bit(k));
    setFn(8, size - 8, true);
  };

  let best = 0, bestPenalty = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const p = penalty(mods, size);
    if (p < bestPenalty) { bestPenalty = p; best = m; }
    applyMask(m);                          // يُرجَع الوضع كما كان
  }
  applyMask(best); drawFormat(best);
  return mods;
}

// عقوبة القناع بقواعد المعيار الأربع (تقديرٌ كافٍ لاختيار أنظف قناع)
function penalty(mods, size) {
  let result = 0;
  const line = (a, byRow) => Array.from({ length: size }, (_, b) => (byRow ? mods[a][b] : mods[b][a]));
  const FINDER = [true, false, true, true, true, false, true, false, false, false, false];
  const eq = (arr, at, pat) => pat.every((v, i) => arr[at + i] === v);

  for (const byRow of [true, false]) {
    for (let a = 0; a < size; a++) {
      const row = line(a, byRow);
      // القاعدة ١: خمسة متتابعة بلون واحد أو أكثر
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && row[b] === row[b - 1]) { run++; continue; }
        if (run >= 5) result += 3 + (run - 5);
        run = 1;
      }
      // القاعدة ٣: نمطٌ يشبه مربّع التوجيه مع أربع فواتح
      for (let b = 0; b + 11 <= size; b++) {
        if (eq(row, b, FINDER) || eq(row, b, [...FINDER].reverse())) result += 40;
      }
    }
  }
  // القاعدة ٢: مربّعات ٢×٢ بلون واحد
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = mods[y][x];
    if (c === mods[y][x + 1] && c === mods[y + 1][x] && c === mods[y + 1][x + 1]) result += 3;
  }
  // القاعدة ٤: ميل نسبة القاتم عن النصف
  let dark = 0;
  for (const row of mods) for (const c of row) if (c) dark++;
  const total = size * size;
  result += Math.floor(Math.abs(dark * 100 / total - 50) / 5) * 10;
  return result;
}

// ---------------------------------------------------------------------
// الرسم: SVG للطباعة، وdata URI للإدراج في Word وملفات الطباعة
// ---------------------------------------------------------------------
export function qrSvgText(text, { margin = 2, dark = '#111', light = '#fff' } = {}) {
  const m = qrMatrix(text);
  const n = m.length, side = n + margin * 2;
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) path += `M${x + margin} ${y + margin}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">`
    + `<rect width="${side}" height="${side}" fill="${light}"/>`
    + `<path d="${path}" fill="${dark}"/></svg>`;
}
export const qrDataUri = (text, opts) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrSvgText(text, opts));

// صورة PNG: للطباعة وملفات Word (الرسم المتجه لا تقبله كل أدوات الطباعة)
export function qrPngDataUrl(text, { scale = 8, margin = 2, dark = '#111111', light = '#ffffff' } = {}) {
  const m = qrMatrix(text);
  const n = m.length, side = (n + margin * 2) * scale;
  const c = document.createElement('canvas');
  c.width = side; c.height = side;
  const ctx = c.getContext('2d');
  ctx.fillStyle = light; ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = dark;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (m[y][x]) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
  }
  return c.toDataURL('image/png');
}
// بايتات الصورة لملف Word — تُفكّ من النصّ نفسه، فسياسة الأمان تمنع جلب data:
export function qrPngBytes(text, opts) {
  const b64 = qrPngDataUrl(text, opts).split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// عنصر جاهز للصفحة، بوصف يُقرأ صوتيًّا
export function qrImg(text, { size = 110, alt = 'رمز QR', title = null } = {}) {
  const img = document.createElement('img');
  img.className = 'qr';
  img.src = qrDataUri(text);
  img.width = size; img.height = size;
  img.alt = alt;
  if (title) img.title = title;
  img.loading = 'lazy';
  return img;
}
