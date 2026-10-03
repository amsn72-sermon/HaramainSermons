// مواقعُ العمل: نقطةٌ ونصفُ قطرٍ يُقاس عليهما الحضور (ملاحظة ٢١٩).
//   تُضبط بالبحث عن المنطقة ثم بالدبّوس باليد، أو بالوقوف في الموضع
//   وأخذِه من الجهاز. ويملكها من له صلاحيةُ الحضور وقائدُ الفريق الميداني.
import { h, toast, busy, dialog, confirm } from '../ui.js';
import { db } from '../sb.js';
import { CITY, isAdmin, isManager, can } from '../store.js';
import { miniMap, searchPlace, myPosition } from '../map.js';

export const maySetSites = () =>
  (isAdmin() && can('shifts')) || isManager();

// نافذةُ ضبط موقع: خريطةٌ وبحثٌ ونصفُ قطر
export async function siteDialog(row = null) {
  const name = h('input', { value: row?.name || '', 'aria-label': 'اسم الموقع' });
  const citySel = h('select', { 'aria-label': 'المدينة' },
    h('option', { value: '' }, '— لا يخصّ حرمًا —'),
    Object.entries(CITY).map(([k, v]) => h('option', { value: k, selected: row?.city === k }, v)));
  const radius = h('input', { type: 'number', min: 20, max: 5000, step: 10,
    value: row?.radius_m ?? 300, 'aria-label': 'نصف القطر بالمتر' });
  const note = h('input', { value: row?.note || '', 'aria-label': 'ملاحظة' });
  const coords = h('p.small.muted', { dir: 'ltr' });

  const map = miniMap({
    lat: Number(row?.lat ?? 21.422487), lng: Number(row?.lng ?? 39.826206),
    radius: Number(row?.radius_m ?? 300), height: 300,
    onChange: p => { coords.textContent = `${p.lat}, ${p.lng}`; }
  });
  coords.textContent = `${Number(row?.lat ?? 21.422487)}, ${Number(row?.lng ?? 39.826206)}`;
  radius.oninput = () => map.setRadius(Number(radius.value) || 300);

  // البحثُ وسيلةُ وصولٍ إلى المنطقة، ثم يُضبط الموضعُ باليد
  const q = h('input', { type: 'search', placeholder: 'ابحث: المسجد الحرام، مكتبة الحرم…',
    'aria-label': 'بحث عن مكان' });
  const results = h('div.stack', { style: { gap: '4px' } });
  const goBtn = h('button.btn.sm', { type: 'button' }, 'ابحث');
  goBtn.onclick = () => busy(goBtn, async () => {
    results.replaceChildren(h('p.small.muted', 'جارٍ البحث…'));
    try {
      const list = await searchPlace(q.value);
      results.replaceChildren(...(list.length
        ? list.map(r => {
            const b = h('button.btn.xs.ghost', { type: 'button' }, r.name);
            b.onclick = () => { map.setCenter(r.lat, r.lng, 17); results.replaceChildren(); };
            return b;
          })
        : [h('p.small.muted', 'لا نتائج — اضبط الموضع باليد على الخريطة.')]));
    } catch (e) { results.replaceChildren(h('p.small.warn', e.message)); }
  });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goBtn.click(); } });

  const hereBtn = h('button.btn.sm', { type: 'button' }, '📍 خذ موضعي الآن');
  hereBtn.onclick = () => busy(hereBtn, async () => {
    try {
      const p = await myPosition();
      map.setCenter(p.lat, p.lng, 18);
      toast(`أُخذ موضعك بدقّة ± ${Math.round(p.acc)} مترًا.`, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  });

  const res = await dialog({
    title: row ? `ضبط موقع «${row.name}»` : 'موقع عمل جديد',
    body: h('div.stack',
      h('p.small.muted', 'ابحث للوصول إلى المنطقة، ثم اسحب الخريطة حتى يقع الدبّوسُ على الموضع '
        + 'بالضبط. أو قف في الموضع واضغط «خذ موضعي الآن» — وهي أدقُّها.'),
      h('div.row', q, goBtn, hereBtn),
      results,
      map.el,
      coords,
      h('div.grid-2',
        h('label.field', 'اسم الموقع', name),
        h('label.field', 'المدينة', citySel),
        h('label.field', 'نصف القطر (متر)', radius),
        h('label.field', 'ملاحظة', note))),
    buttons: [
      { label: 'حفظ الموقع', kind: 'primary',
        validate: () => (name.value.trim().length >= 2 ? true : 'اكتب اسم الموقع'),
        value: () => {
          const p = map.get();
          return { id: row?.id || null, name: name.value.trim(), city: citySel.value || null,
            lat: p.lat, lng: p.lng, radius_m: Number(radius.value) || 300,
            note: note.value.trim() || null };
        } },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return false;
  try {
    await db.rpc('save_work_site', { p: res });
    toast('حُفظ الموقع.', 'ok');
    return true;
  } catch (err) { toast(err.message, 'bad'); return false; }
}

// بطاقةُ المواقع — تُدرَج في شاشة الحضور والانصراف فلا تطول القائمة
export async function sitesCard() {
  const box = h('div.stack');
  const may = maySetSites();

  const load = async () => {
    let rows = [];
    try { rows = await db.select('work_sites', { select: '*', order: 'city.asc,name.asc' }); }
    catch (e) { box.replaceChildren(h('p.small.warn', e.message)); return; }
    box.replaceChildren(rows.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['الموقع', 'المدينة', 'النطاق', 'الإحداثيّان', ''].map(t => h('th', t)))),
      h('tbody', rows.map(r => h('tr',
        h('td', { 'data-label': 'الموقع' }, h('b', r.name),
          r.is_default ? h('span.sub', 'افتراضيٌّ لمدينته') : null,
          r.note ? h('span.sub', r.note) : null),
        h('td', { 'data-label': 'المدينة' }, CITY[r.city] || '—'),
        h('td', { 'data-label': 'النطاق' }, `${r.radius_m} م`),
        h('td', { 'data-label': 'الإحداثيّان', dir: 'ltr' },
          h('span.small.muted', `${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}`)),
        h('td', may ? h('button.btn.sm', { type: 'button',
          onclick: async () => { if (await siteDialog(r)) load(); } }, 'اضبط') : null))))))
      : h('p.muted', 'لا مواقع بعد.'));
  };
  await load();

  const addBtn = h('button.btn.sm.primary', { type: 'button',
    onclick: async () => { if (await siteDialog(null)) load(); } }, '＋ موقع جديد');

  return h('section.card.stack',
    h('div.row.between', h('h3', 'مواقع الحضور'), may ? addBtn : null),
    h('p.small.muted', 'يُقاس حضورُ العضو على موقعه المسنَد؛ فإن لم يُسنَد له موقعٌ '
      + 'قِيس على نطاق مدينته: الحرمُ المكي لأهل مكة، والنبويُّ لأهل المدينة. '
      + 'والضبطُ الدقيق متاحٌ متى شئت.'),
    box);
}
