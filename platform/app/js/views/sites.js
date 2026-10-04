// مواقعُ العمل: قائمةٌ مستقلةٌ تجمع ما تفرّق (ملاحظتا ٢٢٧ و٢٣٣).
//   المواقعُ ونطاقاتُها، وفتراتُ الدوام وأوقاتُها، وأماكنُ عمل الأعضاء
//   وأوقاتُهم، والقادةُ وفِرقُهم، وتوليدُ مناوبات الشهر.
//   مديرُ المشروع يُنشئ ويحرّر ويُسنِد؛ والمنسقون يطّلعون؛ وقائدُ الفريق
//   يرى فريقَه وحدَه.
import { h, toast, busy, dialog, fill, emptyState, fmtDate } from '../ui.js';
import { db } from '../sb.js';
import { CITY, isAdmin, isManager, can, state, loadPeriods, periodName,
  WORK_MODE, WEEK_DAYS, daysLabel, LEAD_KIND, roleLabel, TRACK_LABEL } from '../store.js';
import { miniMap, searchPlace, myPosition } from '../map.js';

export const maySetSites = () => isManager();

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

// ---------------------------------------------------------------------
// ١) بطاقةُ المواقع
// ---------------------------------------------------------------------
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
      + 'والإنشاءُ والتحريرُ لمدير المشروع، وغيرُه يطّلع.'),
    box);
}

// ---------------------------------------------------------------------
// ٢) فتراتُ الدوام (ملاحظة ٢٢٨)
// ---------------------------------------------------------------------
async function periodDialog(row = null) {
  const name = h('input', { value: row?.name || '', 'aria-label': 'اسم الفترة' });
  const start = h('input', { type: 'time', value: String(row?.start_at || '07:00').slice(0, 5),
    'aria-label': 'بداية الفترة' });
  const end = h('input', { type: 'time', value: String(row?.end_at || '15:00').slice(0, 5),
    'aria-label': 'نهاية الفترة' });
  const sort = h('input', { type: 'number', min: 1, max: 99, value: row?.sort ?? 9,
    'aria-label': 'الترتيب' });
  const active = h('input', { type: 'checkbox', checked: row ? (row.is_active ? true : null) : true,
    'aria-label': 'مفعّلة' });

  const res = await dialog({
    title: row ? `تحرير «${row.name}»` : 'فترة دوام جديدة',
    body: h('div.stack',
      h('p.small.muted', 'الفترةُ التي تتجاوز منتصف الليل تُكتب كما هي: ٢٣:٠٠ إلى ٠٧:٠٠.'),
      h('div.grid-2',
        h('label.field', 'اسم الفترة', name),
        h('label.field', 'الترتيب', sort),
        h('label.field', 'من', start),
        h('label.field', 'إلى', end)),
      h('label.check', active, h('span', 'فترةٌ مفعَّلة'))),
    buttons: [
      { label: 'حفظ', kind: 'primary',
        validate: () => (name.value.trim().length >= 2 ? true : 'اكتب اسم الفترة'),
        value: () => ({ id: row?.id || null, code: row?.code || null, name: name.value.trim(),
          start_at: start.value, end_at: end.value,
          sort: Number(sort.value) || 9, is_active: active.checked }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return false;
  try {
    await db.rpc('save_duty_period', { p: res });
    await loadPeriods(true);
    toast('حُفظت الفترة.', 'ok');
    return true;
  } catch (e) { toast(e.message, 'bad'); return false; }
}

async function periodsCard() {
  const box = h('div.stack');
  const may = can('shifts') && isAdmin();

  const load = async () => {
    const rows = await loadPeriods(true);
    box.replaceChildren(rows.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['الفترة', 'من', 'إلى', 'المدّة', 'الحال', ''].map(t => h('th', t)))),
      h('tbody', rows.map(r => {
        const s = String(r.start_at).slice(0, 5), e = String(r.end_at).slice(0, 5);
        const hrs = (() => {
          const [sh, sm] = s.split(':').map(Number), [eh, em] = e.split(':').map(Number);
          let mins = (eh * 60 + em) - (sh * 60 + sm);
          if (mins <= 0) mins += 24 * 60;
          return (mins / 60).toFixed(mins % 60 ? 1 : 0);
        })();
        return h('tr',
          h('td', { 'data-label': 'الفترة' }, h('b', r.name)),
          h('td', { 'data-label': 'من', dir: 'ltr' }, s),
          h('td', { 'data-label': 'إلى', dir: 'ltr' }, e),
          h('td', { 'data-label': 'المدّة' }, `${hrs} ساعات`),
          h('td', { 'data-label': 'الحال' }, r.is_active
            ? h('span.badge.ok', 'مفعَّلة') : h('span.badge.warn', 'معطَّلة')),
          h('td', may ? h('div.row',
            h('button.btn.xs', { type: 'button',
              onclick: async () => { if (await periodDialog(r)) load(); } }, 'حرّر'),
            h('button.btn.xs.ghost', { type: 'button', onclick: async () => {
              try { await db.rpc('delete_duty_period', { p_id: r.id }); await load(); toast('حُذفت أو عُطّلت.', 'ok'); }
              catch (err) { toast(err.message, 'bad'); }
            } }, 'احذف')) : null));
      }))))
      : h('p.muted', 'لا فترات.'));
  };
  await load();

  return h('section.card.stack',
    h('div.row.between', h('h3', 'فترات الدوام'),
      may ? h('button.btn.sm.primary', { type: 'button',
        onclick: async () => { if (await periodDialog(null)) load(); } }, '＋ فترة') : null),
    h('p.small.muted', 'ثلاثُ فتراتٍ كلٌّ ثمانِ ساعاتٍ من السابعة صباحًا، تُحرَّر أوقاتُها '
      + 'ويُزاد عليها. والفترةُ التي عُلّقت بها مناوباتٌ تُعطَّل ولا تُحذف، فتبقى سجلّاتُها مقروءة.'),
    box);
}

// ---------------------------------------------------------------------
// ٣) أماكنُ عمل الأعضاء وأوقاتُهم
// ---------------------------------------------------------------------
async function planDialog(row, sites) {
  const mode = h('select', { 'aria-label': 'نمط العمل' },
    Object.entries(WORK_MODE).map(([k, v]) =>
      h('option', { value: k, selected: (row.work_mode || 'remote') === k }, v)));
  const site = h('select', { 'aria-label': 'موقع العمل' },
    h('option', { value: '' }, '— نطاقُ مدينته —'),
    sites.map(s => h('option', { value: s.id, selected: row.site_id === s.id },
      `${s.name}${s.city ? ` — ${CITY[s.city]}` : ''}`)));
  const period = h('select', { 'aria-label': 'الفترة' },
    h('option', { value: '' }, '— بلا فترة —'),
    state.periods.filter(p => p.is_active).map(p =>
      h('option', { value: p.code, selected: row.duty_period === p.code },
        `${p.name} (${String(p.start_at).slice(0, 5)} – ${String(p.end_at).slice(0, 5)})`)));

  const have = new Set((row.work_days || []).map(Number));
  const dayBoxes = WEEK_DAYS.map((d, i) =>
    h('input', { type: 'checkbox', checked: have.has(i) ? true : null, 'aria-label': d }));
  const daysRow = h('div.day-picker', WEEK_DAYS.map((d, i) =>
    h('label.check', dayBoxes[i], h('span', d))));

  const onsiteOnly = h('div.stack',
    h('div.grid-2',
      h('label.field', 'موقع العمل', site),
      h('label.field', 'الفترة', period)),
    h('div', h('div.small.muted', 'أيام العمل'), daysRow));
  const sync = () => { onsiteOnly.style.display = mode.value === 'onsite' ? '' : 'none'; };
  sync(); mode.addEventListener('change', sync);

  const res = await dialog({
    title: `مكانُ عمل «${row.full_name}» ووقتُه`,
    body: h('div.stack',
      h('p.small.muted', 'من كان «عن بُعد» فلا موقعَ له ولا مناوبات. ومن كان «حضوريًّا» '
        + 'أُسنِد له موقعٌ وفترةٌ وأيامُ عمل، فتُولَّد مناوباتُه من هذه الثلاثة.'),
      h('label.field', 'نمط العمل', mode),
      onsiteOnly),
    buttons: [
      { label: 'حفظ', kind: 'primary', value: () => ({
        member_id: row.id, work_mode: mode.value,
        site_id: mode.value === 'onsite' ? (site.value || null) : null,
        duty_period: mode.value === 'onsite' ? (period.value || null) : null,
        work_days: dayBoxes.map((b, i) => (b.checked ? i : null)).filter(i => i !== null)
      }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return false;
  try {
    await db.rpc('set_member_schedule', { p: res });
    toast('حُفظ.', 'ok');
    return true;
  } catch (e) { toast(e.message, 'bad'); return false; }
}

async function planCard() {
  const box = h('div.stack');
  const may = isManager();
  let sites = [];
  try { sites = await db.select('work_sites', { select: '*', is_active: 'eq.true', order: 'name.asc' }); }
  catch { sites = []; }

  const modeTab = h('select', { 'aria-label': 'تصفية' },
    h('option', { value: '' }, 'الجميع'),
    h('option', { value: 'onsite' }, 'الحضوريون'),
    h('option', { value: 'remote' }, 'عن بُعد'));

  const load = async () => {
    let rows = [];
    try { rows = await db.rpc('work_plan'); } catch (e) { box.replaceChildren(h('p.small.warn', e.message)); return; }
    const list = rows.filter(r => !modeTab.value || r.work_mode === modeTab.value);
    box.replaceChildren(list.length ? h('div.table-wrap', h('table.responsive',
      h('thead', h('tr', ['العضو', 'النمط', 'الموقع', 'الفترة', 'الأيام', 'القائد', ''].map(t => h('th', t)))),
      h('tbody', list.map(r => h('tr',
        h('td', { 'data-label': 'العضو' }, h('b', r.full_name),
          h('span.sub', `${roleLabel(r)} — ${TRACK_LABEL[r.track] || 'الترجمة التخصصية'}`)),
        h('td', { 'data-label': 'النمط' }, r.work_mode === 'onsite'
          ? h('span.badge.ok', 'حضوري') : h('span.badge', 'عن بُعد')),
        h('td', { 'data-label': 'الموقع' }, r.site_name || h('span.muted', '—')),
        h('td', { 'data-label': 'الفترة' }, r.period_name
          ? `${r.period_name} (${String(r.start_at).slice(0, 5)}–${String(r.end_at).slice(0, 5)})`
          : h('span.muted', '—')),
        h('td', { 'data-label': 'الأيام' }, r.work_mode === 'onsite'
          ? h('span.small', daysLabel(r.work_days)) : h('span.muted', '—')),
        h('td', { 'data-label': 'القائد' }, r.lead_name || h('span.muted', '—')),
        h('td', may ? h('button.btn.xs', { type: 'button',
          onclick: async () => { if (await planDialog(r, sites)) load(); } }, 'اضبط') : null))))))
      : h('p.muted', 'لا أعضاء في هذه القائمة.'));
  };
  modeTab.onchange = load;
  await load();

  return h('section.card.stack',
    h('div.row.between', h('h3', 'أماكن العمل وأوقاته'), modeTab),
    h('p.small.muted', 'لكلِّ عضوٍ نمطُ عمله: عن بُعدٍ أو حضوري. والحضوريُّ له موقعٌ وفترةٌ '
      + 'وأيامُ عمل، تُضبط مرةً فتُولَّد منها مناوباتُه. والضبطُ لمدير المشروع.'),
    box);
}

// ---------------------------------------------------------------------
// ٤) القادةُ وفِرقُهم، ومن لا قائدَ له (ملاحظة ٢٢٨)
// ---------------------------------------------------------------------
async function teamsCard() {
  const box = h('div.stack');
  const load = async () => {
    let leads = [], orphans = [];
    try {
      [leads, orphans] = await Promise.all([
        db.rpc('lead_teams').catch(() => []),
        isAdmin() ? db.rpc('members_without_lead').catch(() => []) : Promise.resolve([])
      ]);
    } catch { /* يُعرض ما أمكن */ }

    box.replaceChildren(
      leads.length ? h('div.lead-grid', leads.map(l => h('article.lead-card',
        h('div.row.between', h('b', l.lead_name),
          h('span.badge', LEAD_KIND[l.lead_kind] || 'قائد')),
        h('p.small.muted', [CITY[l.city], `${l.members} عضوًا`].filter(Boolean).join(' — ')),
        h('button.btn.xs.ghost', { type: 'button', onclick: () => showTeam(l) }, 'من في فريقه؟'))))
        : h('p.muted', 'لا قادةَ معيَّنون بعد.'),
      orphans.length ? h('div.stack',
        h('h4', 'من لا قائدَ له'),
        h('p.small.muted', 'أعضاءٌ لم يُسنَدوا إلى قائد. يُسنَد الواحدُ منهم من ملفّه في شاشة الفريق.'),
        h('div.chips', orphans.map(o => h('span.chip',
          `${o.full_name} — ${TRACK_LABEL[o.track] || ''}${o.city ? ` — ${CITY[o.city]}` : ''}`))))
        : null);
  };

  const showTeam = async (l) => {
    let rows = [];
    try { rows = (await db.rpc('work_plan')).filter(r => r.lead_id === l.lead_id); }
    catch { rows = []; }
    await dialog({
      title: `فريق «${l.lead_name}»`,
      body: rows.length ? h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['العضو', 'الفريق', 'الفترة', 'الموقع'].map(t => h('th', t)))),
        h('tbody', rows.map(r => h('tr',
          h('td', { 'data-label': 'العضو' }, r.full_name),
          h('td', { 'data-label': 'الفريق' }, TRACK_LABEL[r.track] || '—'),
          h('td', { 'data-label': 'الفترة' }, r.period_name || '—'),
          h('td', { 'data-label': 'الموقع' }, r.site_name || '—'))))))
        : h('p.muted', 'لا أعضاء في فريقه بعد.'),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  };

  await load();
  return h('section.card.stack',
    h('h3', 'القادة وفِرقُهم'),
    h('p.small.muted', 'يتعدّد القادةُ بتعدّد الفترات والمواقع، ويُسنَد إلى كلِّ قائدٍ أعضاؤه '
      + 'بأسمائهم من ملفّ العضو. ولكلِّ عضوٍ قائدٌ واحد: ونقلُه إلى قائدٍ يُخرجه من فريق الأول.'),
    box);
}

// ---------------------------------------------------------------------
// ٥) توليدُ مناوبات الشهر (ملاحظة ٢٣٣)
// ---------------------------------------------------------------------
async function generateCard() {
  const month = h('input', { type: 'month', 'aria-label': 'الشهر',
    value: new Date().toISOString().slice(0, 7) });
  const out = h('div.stack');
  const goBtn = h('button.btn.sm', { type: 'button' }, 'اعرض ما سيُولَّد');

  const firstOf = () => `${month.value || new Date().toISOString().slice(0, 7)}-01`;

  const preview = () => busy(goBtn, async () => {
    out.replaceChildren(h('p.small.muted', 'جارٍ الحساب…'));
    try {
      const rows = await db.rpc('generate_shifts',
        { p_month: firstOf(), p_member: null, p_commit: false });
      const fresh = rows.filter(r => !r.already);
      const byMember = new Map();
      fresh.forEach(r => byMember.set(r.full_name, (byMember.get(r.full_name) || 0) + 1));

      const commit = h('button.btn.sm.primary', { type: 'button', disabled: !fresh.length || null },
        `اعتمد ${fresh.length} مناوبة`);
      commit.onclick = () => busy(commit, async () => {
        try {
          await db.rpc('generate_shifts', { p_month: firstOf(), p_member: null, p_commit: true });
          toast('اعتُمدت المناوبات.', 'ok');
          preview();
        } catch (e) { toast(e.message, 'bad'); }
      });

      out.replaceChildren(
        h('p', fresh.length
          ? `ستُنشأ ${fresh.length} مناوبةً لـ${byMember.size} عضوًا، ويُتخطّى ${rows.length - fresh.length} يومًا مسجَّلًا من قبل.`
          : 'لا جديد: إمّا أن الجميع مسجَّلون، وإمّا أنه لا أحدَ حضوريٌّ بفترةٍ وأيامِ عمل.'),
        byMember.size ? h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['العضو', 'عدد الأيام'].map(t => h('th', t)))),
          h('tbody', [...byMember].map(([n, c]) => h('tr',
            h('td', { 'data-label': 'العضو' }, n),
            h('td', { 'data-label': 'عدد الأيام' }, String(c))))))) : null,
        fresh.length ? h('div.row', commit) : null);
    } catch (e) { out.replaceChildren(h('p.small.warn', e.message)); }
  });
  goBtn.onclick = preview;

  return h('section.card.stack',
    h('h3', 'توليد مناوبات الشهر'),
    h('p.small.muted', 'لا تُكتب المناوباتُ يومًا بيوم: تُولَّد من فترة العضو وأيام عمله، '
      + 'وتُعرض قبل الاعتماد، ولا تُمسُّ مناوبةٌ مسجَّلةٌ من قبل. والاستثناءُ اليوميُّ — '
      + 'إجازةٌ أو بديلٌ أو تبديلُ فترة — يبقى من شاشة الحضور والانصراف.'),
    h('div.row', h('label.field', 'الشهر', month), goBtn),
    out);
}

// ---------------------------------------------------------------------
export async function render() {
  const may = isAdmin() || isManager();
  await loadPeriods(true);

  const cards = [];
  cards.push(await sitesCard());
  cards.push(await periodsCard());
  if (may || true) cards.push(await planCard());
  cards.push(await teamsCard());
  if (can('shifts') && isAdmin()) cards.push(await generateCard());

  return h('div',
    h('div.page-head',
      h('div.grow', h('div.eyebrow', 'الحضور'), h('h1', 'مواقع العمل'),
        h('p.muted', 'المواقعُ ونطاقاتُها، وفتراتُ الدوام، وأماكنُ عمل الأعضاء وأوقاتُهم، '
          + 'والقادةُ وفِرقُهم.'))),
    h('div.stack', cards));
}
