// خريطةٌ صغيرةٌ بلا مكتبةٍ خارجية: مربّعاتُ OpenStreetMap صورًا، وسحبٌ
// بالإصبع أو الفأرة، وتقريبٌ وتبعيد، ودبّوسٌ في الوسط ودائرةُ النطاق.
// تُستعمل في ضبط مواقع العمل وتحديد نطاق الحضور (ملاحظة ٢١٩).
//
//   والنقطةُ هي مركزُ الخريطة دائمًا: فمن سحب الخريطةَ حرّك النقطة.
//   وهذا أيسرُ على الإصبع من سحب دبّوسٍ صغير.
import { h } from './ui.js';

const TILE = 256;
const SUBS = ['a', 'b', 'c'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// تحويلات ويب-مركاتور
const lngToX = (lng, z) => ((lng + 180) / 360) * Math.pow(2, z);
const latToY = (lat, z) => {
  const r = lat * Math.PI / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z);
};
const xToLng = (x, z) => (x / Math.pow(2, z)) * 360 - 180;
const yToLat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
// أمتارُ البكسل الواحد عند خط عرضٍ وتقريبٍ معلومين
export const metersPerPixel = (lat, z) =>
  156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);

export function miniMap({ lat = 21.422487, lng = 39.826206, radius = 300,
  zoom = 16, height = 280, onChange = null } = {}) {
  let z = clamp(Math.round(zoom), 3, 19);
  let cLat = lat, cLng = lng, rad = radius;

  const tiles = h('div.map-tiles');
  const pin = h('div.map-pin', { 'aria-hidden': 'true' });
  const ring = h('div.map-ring', { 'aria-hidden': 'true' });
  const credit = h('div.map-credit', '© OpenStreetMap');
  const zIn = h('button.btn.xs', { type: 'button', 'aria-label': 'تقريب' }, '＋');
  const zOut = h('button.btn.xs', { type: 'button', 'aria-label': 'تبعيد' }, '－');
  const tools = h('div.map-tools', zIn, zOut);
  const el = h('div.map-wrap', { style: { height: `${height}px` }, tabindex: '0' },
    tiles, ring, pin, tools, credit);

  function drawTiles() {
    const w = el.clientWidth || 320, hgt = el.clientHeight || height;
    const cx = lngToX(cLng, z), cy = latToY(cLat, z);
    const half = Math.pow(2, z);
    const x0 = Math.floor(cx - (w / 2) / TILE), x1 = Math.floor(cx + (w / 2) / TILE);
    const y0 = Math.floor(cy - (hgt / 2) / TILE), y1 = Math.floor(cy + (hgt / 2) / TILE);
    const kids = [];
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= half) continue;
      for (let tx = x0; tx <= x1; tx++) {
        const wrapped = ((tx % half) + half) % half;
        const left = Math.round((tx - cx) * TILE + w / 2);
        const top = Math.round((ty - cy) * TILE + hgt / 2);
        kids.push(h('img.map-tile', {
          src: `https://${SUBS[(wrapped + ty) % 3]}.tile.openstreetmap.org/${z}/${wrapped}/${ty}.png`,
          alt: '', loading: 'lazy', draggable: 'false',
          style: { left: `${left}px`, top: `${top}px` }
        }));
      }
    }
    tiles.replaceChildren(...kids);
    drawRing();
  }

  function drawRing() {
    const px = rad / metersPerPixel(cLat, z);
    const d = Math.max(8, Math.round(px * 2));
    ring.style.width = `${d}px`;
    ring.style.height = `${d}px`;
  }

  // السحب: الإصبعُ أو الفأرة
  let drag = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('.map-tools')) return;
    drag = { x: e.clientX, y: e.clientY, lat: cLat, lng: cLng };
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const cx = lngToX(drag.lng, z) - dx / TILE;
    const cy = latToY(drag.lat, z) - dy / TILE;
    cLng = xToLng(cx, z);
    cLat = clamp(yToLat(cy, z), -85, 85);
    drawTiles();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null; el.classList.remove('dragging');
    onChange && onChange(get());
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('pointerleave', endDrag);

  const setZoom = nz => { z = clamp(nz, 3, 19); drawTiles(); onChange && onChange(get()); };
  zIn.onclick = () => setZoom(z + 1);
  zOut.onclick = () => setZoom(z - 1);

  const get = () => ({ lat: Number(cLat.toFixed(6)), lng: Number(cLng.toFixed(6)), zoom: z, radius: rad });
  const setCenter = (la, ln, nz) => {
    cLat = la; cLng = ln; if (nz) z = clamp(nz, 3, 19);
    drawTiles(); onChange && onChange(get());
  };
  const setRadius = r => { rad = Math.max(20, Math.round(r || 0)); drawRing(); };

  // يُرسم بعد دخوله الصفحة فتُعرف أبعادُه
  const ro = new ResizeObserver(() => drawTiles());
  queueMicrotask(() => { drawTiles(); ro.observe(el); });

  return { el, get, setCenter, setRadius, setZoom };
}

// ---------------------------------------------------------------------
// البحثُ عن مكانٍ بالاسم — خدمةُ Nominatim المجّانية. وهو وسيلةُ وصولٍ
// إلى المنطقة، والضبطُ الدقيق بالسحب أو بـ«خذ موضعي الآن» (ملاحظة ٢١٩)
// ---------------------------------------------------------------------
export async function searchPlace(q) {
  const term = String(q || '').trim();
  if (term.length < 3) return [];
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=ar&q='
    + encodeURIComponent(term);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('تعذّر البحث عن المكان الآن');
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).map(r => ({
    name: r.display_name, lat: Number(r.lat), lng: Number(r.lon)
  })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

// موضعُ الجهاز الآن
export function myPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('متصفحك لا يعطي الموقع'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      e => reject(new Error(
        e.code === 1 ? 'لم تأذن للمتصفح بموقعك — افتح الإذن من إعدادات الموقع ثم أعد المحاولة'
        : e.code === 3 ? 'تأخّرت إشارةُ الموقع — اخرج إلى مكانٍ مكشوفٍ وأعد المحاولة'
        : 'تعذّر تحديد موقعك الآن')),
      { enableHighAccuracy: true, timeout, maximumAge: 0 });
  });
}
