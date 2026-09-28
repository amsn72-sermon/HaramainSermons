// فحص الملف الصوتي قبل رفعه: الصيغة إلزامية كما في العقد (WAV أو MP3)،
// وبقية المواصفات تُقاس وتُعرض للمنسق فيقبل أو يُعيد (ملاحظة ١٤٣).

export const AUDIO_EXTS = ['wav', 'mp3'];
// حدود العقد: جودة ٣٢٠ kbps فأعلى، ومعدل عينة ٤٤٫١ kHz فأعلى، وصمتُ طرفٍ لا يتجاوز ثانيتين
export const SPEC = { kbps: 320, sampleRate: 44100, edgeSilence: 2 };

export const extOf = file => (String(file.name).split('.').pop() || '').toLowerCase();
export const isAllowedAudio = file => AUDIO_EXTS.includes(extOf(file));

const readHead = (file, bytes = 65536) => file.slice(0, bytes).arrayBuffer();

// صوت أم فيديو؟ الفيديو يُرفض حفظًا لمساحة الخادم
export function hasVideoTrack(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const done = ok => { URL.revokeObjectURL(url); resolve(ok); };
    v.onloadedmetadata = () => done(v.videoWidth > 0 && v.videoHeight > 0);
    v.onerror = () => done(false);
    v.src = url;
    setTimeout(() => done(false), 8000);
  });
}

export function mediaDuration(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = sec => { URL.revokeObjectURL(url); resolve(Number.isFinite(sec) && sec > 0 ? sec : null); };
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(null);
    a.src = url;
    setTimeout(() => done(null), 10000);
  });
}

// ترويسة WAV: معدل العينة والقنوات وعمق العينة
function parseWav(buf) {
  const dv = new DataView(buf);
  if (dv.byteLength < 44) return null;
  const tag = o => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let pos = 12;
  while (pos + 8 <= dv.byteLength) {
    const id = tag(pos), size = dv.getUint32(pos + 4, true);
    if (id === 'fmt ') {
      return {
        channels: dv.getUint16(pos + 10, true),
        sampleRate: dv.getUint32(pos + 12, true),
        kbps: Math.round(dv.getUint32(pos + 16, true) * 8 / 1000),   // byteRate → kbps
        bits: dv.getUint16(pos + 22, true)
      };
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

// أول إطار MP3: معدل العينة والقنوات والتدفق المعلن
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const MP3_BITS_V1L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
function parseMp3(buf) {
  const b = new Uint8Array(buf);
  for (let i = 0; i + 4 < b.length && i < 200000; i++) {
    if (b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) continue;
    const verBits = (b[i + 1] >> 3) & 0x03;          // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b[i + 1] >> 1) & 0x03;            // 1 = Layer III
    const rateIdx = (b[i + 2] >> 2) & 0x03;
    const bitIdx = (b[i + 2] >> 4) & 0x0F;
    const rates = MP3_RATES[verBits];
    if (layer !== 1 || !rates || rateIdx === 3 || bitIdx === 0 || bitIdx === 15) continue;
    const mode = (b[i + 3] >> 6) & 0x03;             // 3 = mono
    return {
      sampleRate: rates[rateIdx],
      channels: mode === 3 ? 1 : 2,
      kbps: verBits === 3 ? MP3_BITS_V1L3[bitIdx] : null
    };
  }
  return null;
}

// صمت الطرفين: يُقاس بفكّ الترميز، ويُتجاوَز بهدوء إن كان الملف كبيرًا أو المتصفح لا يقدر
async function edgeSilence(file, { maxBytes = 60 * 1024 * 1024, threshold = 0.01 } = {}) {
  if (file.size > maxBytes || typeof AudioContext === 'undefined') return null;
  let ctx = null;
  try {
    ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const data = buf.getChannelData(0), n = data.length, rate = buf.sampleRate;
    let head = 0, tail = 0;
    while (head < n && Math.abs(data[head]) < threshold) head++;
    while (tail < n - head && Math.abs(data[n - 1 - tail]) < threshold) tail++;
    return { head: +(head / rate).toFixed(1), tail: +(tail / rate).toFixed(1) };
  } catch { return null; }
}

// وصفٌ كامل للملف: يُستعمل في الرفع وفي عرض المواصفات للمنسق
export async function audioInfo(file) {
  const ext = extOf(file);
  const info = { ext, size: file.size, name: file.name, sampleRate: null, channels: null, kbps: null, bits: null,
    duration: null, silence: null, video: false, issues: [] };
  info.video = await hasVideoTrack(file);
  if (info.video) { info.issues.push('الملف مقطع فيديو'); return info; }

  const head = await readHead(file).catch(() => null);
  const parsed = head ? (ext === 'wav' ? parseWav(head) : ext === 'mp3' ? parseMp3(head) : null) : null;
  if (parsed) Object.assign(info, parsed);
  info.duration = await mediaDuration(file);
  // التدفق الفعلي من الحجم والمدة أدقّ في ملفات المعدل المتغير
  if (info.duration) info.kbps = Math.round(file.size * 8 / info.duration / 1000);
  info.silence = await edgeSilence(file);

  if (!AUDIO_EXTS.includes(ext)) info.issues.push('الصيغة غير معتمدة');
  if (info.sampleRate && info.sampleRate < SPEC.sampleRate) info.issues.push(`معدل العينة ${(info.sampleRate / 1000).toFixed(1)} kHz دون ${SPEC.sampleRate / 1000} kHz`);
  if (info.kbps && info.kbps < SPEC.kbps) info.issues.push(`الجودة ${info.kbps} kbps دون ${SPEC.kbps} kbps`);
  if (info.silence && info.silence.head > SPEC.edgeSilence) info.issues.push(`صمتٌ في أول التسجيل ${info.silence.head} ثانية`);
  if (info.silence && info.silence.tail > SPEC.edgeSilence) info.issues.push(`صمتٌ في آخر التسجيل ${info.silence.tail} ثانية`);
  return info;
}

// سطرٌ مختصر يُعرض تحت التسجيل: الصيغة · المعدل · التدفق · القنوات · المدة
export function specLine(info) {
  const mm = info.duration ? `${Math.floor(info.duration / 60)}:${String(Math.round(info.duration % 60)).padStart(2, '0')}` : null;
  return [
    info.ext ? info.ext.toUpperCase() : null,
    info.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : null,
    info.kbps ? `${info.kbps} kbps` : null,
    info.channels ? (info.channels === 1 ? 'أحادي' : 'ستيريو') : null,
    mm
  ].filter(Boolean).join(' · ');
}
