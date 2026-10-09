// التدريبُ والتأهيل: خططٌ ومدرِّبون ومكتبةُ موادَّ وسجلُّ تأهيل (ملاحظة ٢٣٢).
//   يجري التدريبُ في قاعات التدريب، وهذه الشاشةُ لما يقوم عليه: الخططُ
//   والموادُّ والسجل. والمشاركةُ من الإدارة إلى العضو، ولكلِّ مشاركةٍ
//   مفتاحُ تنزيلٍ يقرّره المدير.
import { h, toast, dialog, fmtDate, confirm } from '../ui.js';
import { db, storage } from '../sb.js';
import { state, isAdmin } from '../store.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');

export const LEVEL = { onboarding: 'تأهيلُ الملتحقين', development: 'تطويرٌ مستمر',
  specialized: 'تخصصيٌّ متقدم' };
export const STATUS = { enrolled: 'ملتحق', in_progress: 'قيد التدريب',
  done: 'أتمّه', dropped: 'انقطع' };
export const KIND = { pdf: 'PDF', slides: 'عرض تقديمي', other: 'ملف' };

// مستهدَفو الخطة: فئاتٌ أو أشخاصٌ بأسمائهم (ملاحظة ٣٦٠)
export const TARGET_GROUPS = {
  admins: 'الإداريّون',
  translators: 'المترجمون',
  specialists: 'المتخصِّصون',
  field: 'الميكانيكيّون (الميدان)'
};

export const mayTrain = () => isAdmin() || state.profile?.is_trainer === true;

// ---------------------------------------------------------------------
// ١) خطط التدريب
// ---------------------------------------------------------------------
export async function planDialog(row = null) {
  const title = h('input', { value: row?.title || '', 'aria-label': 'عنوان الخطة' });
  const goal = h('textarea', { rows: 2, 'aria-label': 'الهدف' }, row?.goal || '');
  const audience = h('input', { value: row?.audience || '', 'aria-label': 'الجمهور' });
  const level = h('select', { 'aria-label': 'النوع' },
    Object.entries(LEVEL).map(([k, v]) =>
      h('option', { value: k, selected: (row?.level || 'onboarding') === k }, v)));
  const hours = h('input', { type: 'number', min: 0, step: 0.5, value: row?.hours ?? '',
    'aria-label': 'عدد الساعات' });

  const unitsBox = h('div.stack');
  const addUnit = (u = {}) => {
    const t = h('input', { value: u.title || '', placeholder: 'عنوان الوحدة', 'aria-label': 'عنوان الوحدة' });
    const o = h('input', { value: u.outline || '', placeholder: 'ما تتناوله', 'aria-label': 'محتوى الوحدة' });
    const hh = h('input', { type: 'number', min: 0, step: 0.5, value: u.hours ?? '',
      placeholder: 'ساعات', 'aria-label': 'ساعات الوحدة', style: { maxWidth: '90px' } });
    const del = h('button.btn.xs.ghost', { type: 'button' }, '✕');
    const rowEl = h('div.repo-item', t, o, hh, del);
    rowEl._get = () => (t.value.trim()
      ? { title: t.value.trim(), outline: o.value.trim() || null, hours: hh.value || null } : null);
    del.onclick = () => rowEl.remove();
    unitsBox.append(rowEl);
  };
  (row?.units || []).forEach(addUnit);
  if (!(row?.units || []).length) addUnit();

  // المستهدَفون: فئاتٌ بعلامات، وأشخاصٌ يُنتقون بأسمائهم (ملاحظة ٣٦٠)
  const tg = (row?.targets && typeof row.targets === 'object') ? row.targets : {};
  const groups = new Set(Array.isArray(tg.groups) ? tg.groups : []);
  const picked = new Set(Array.isArray(tg.members) ? tg.members : []);
  const groupBoxes = Object.entries(TARGET_GROUPS).map(([k, label]) => {
    const i = h('input', { type: 'checkbox', checked: groups.has(k) ? true : null,
      'aria-label': label });
    i.onchange = () => { i.checked ? groups.add(k) : groups.delete(k); };
    return h('label.check', i, h('span', label));
  });
  let people = [];
  try {
    people = await db.select('profiles', { select: 'id,full_name', status: 'eq.active',
      order: 'full_name.asc' }).catch(() => []);
  } catch { people = []; }
  const q = h('input', { type: 'search', placeholder: 'ابحث باسم العضو',
    'aria-label': 'بحث عن عضو' });
  const chips = h('div.chips');
  const drawChips = () => {
    const term = q.value.trim();
    chips.replaceChildren(...people
      .filter(m => picked.has(m.id) || (term && m.full_name.includes(term)))
      .slice(0, 60)
      .map(m => {
        const b = h('button.btn.xs' + (picked.has(m.id) ? '.primary' : '.ghost'),
          { type: 'button' }, m.full_name);
        b.onclick = () => { picked.has(m.id) ? picked.delete(m.id) : picked.add(m.id); drawChips(); };
        return b;
      }));
  };
  q.oninput = drawChips; drawChips();

  const res = await dialog({
    title: row ? `تحرير «${row.title}»` : 'خطة تدريب جديدة',
    body: h('div.stack',
      h('div.grid-2',
        h('label.field', 'عنوان الخطة', title),
        h('label.field', 'النوع', level),
        h('label.field', 'الجمهور', audience),
        h('label.field', 'عدد الساعات', hours)),
      h('label.field', 'الهدف', goal),
      h('fieldset.stack', h('legend', 'المستهدَفون'),
        h('p.small.muted', 'فئةٌ أو أكثر، أو أشخاصٌ بأسمائهم — ومنهم يُلحَقون بالخطة.'),
        h('div.check-grid', ...groupBoxes),
        h('label.field', 'أشخاصٌ بأسمائهم', q),
        chips),
      h('fieldset.stack', h('legend', 'وحدات الخطة'),
        unitsBox,
        h('button.btn.xs', { type: 'button', onclick: () => addUnit() }, '＋ وحدة'))),
    buttons: [
      { label: 'حفظ', kind: 'primary',
        validate: () => (title.value.trim().length >= 3 ? true : 'اكتب عنوان الخطة'),
        value: () => ({ id: row?.id || null, title: title.value.trim(),
          goal: goal.value.trim() || null, audience: audience.value.trim() || null,
          level: level.value, hours: hours.value || null,
          targets: { groups: [...groups], members: [...picked] },
          units: [...unitsBox.children].map(c => c._get()).filter(Boolean) }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return false;
  try { await db.rpc('save_training_plan', { p: res }); toast('حُفظت الخطة.', 'ok'); return true; }
  catch (e) { toast(e.message, 'bad'); return false; }
}

// الخططُ مربَّعاتٌ تُفتَح صفحةً لها، وفيها مكتبتُها وسجلُّها (ملاحظة ٣٦٠)
async function plansCard() {
  const box = h('div.stack');
  const load = async () => {
    let plans = [];
    try { plans = await db.rpc('training_plan_tiles') || []; }
    catch (e) { box.replaceChildren(h('p.small.warn', e.message)); return; }

    box.replaceChildren(plans.length
      ? h('div.plan-grid', plans.map(p => {
          const tg = (p.targets && typeof p.targets === 'object') ? p.targets : {};
          const gs = (Array.isArray(tg.groups) ? tg.groups : [])
            .map(k => TARGET_GROUPS[k]).filter(Boolean);
          const ms = (Array.isArray(tg.members) ? tg.members : []).length;
          return h('article.plan-tile' + (p.is_active ? '' : '.off'),
            h('a.plan-open', { href: `/app/training/${p.id}` },
              h('b.plan-title', p.title),
              h('span.sub', LEVEL[p.level] || ''),
              p.goal ? h('p.small.plan-goal', p.goal) : null,
              h('div.plan-stats',
                h('span.badge', `${AR(p.units)} وحدة`),
                h('span.badge', { class: Number(p.materials) ? 'ok' : '' },
                  `${AR(p.materials)} مادة`),
                h('span.badge', { class: Number(p.enrolled) ? 'ok' : '' },
                  `${AR(p.enrolled)} ملتحق`),
                Number(p.done) ? h('span.badge.ok', `${AR(p.done)} أتمّها`) : null),
              h('div.small.muted.plan-targets',
                (gs.length || ms)
                  ? `المستهدَفون: ${[...gs, ms ? `${AR(ms)} بأسمائهم` : null]
                      .filter(Boolean).join('، ')}`
                  : 'لم يُحدَّد المستهدَفون'),
              p.room_name
                ? h('div.small.muted.plan-room', `🏛 ${p.room_name}`)
                : null,
              p.is_active ? null : h('span.badge.warn', 'موقوفة')),
            mayTrain()
              ? h('div.plan-acts',
                  h('button.btn.xs', { type: 'button', onclick: async () => {
                    let full = p;
                    try {
                      const r = await db.rpc('training_plan', { p_id: p.id });
                      full = (Array.isArray(r) ? r[0] : r) || p;
                    } catch { /* يُحرَّر بما في البطاقة */ }
                    if (await planDialog({ ...full, units: full.units || [] })) load();
                  } }, 'حرّر'),
                  isAdmin()
                    ? h('button.btn.xs.ghost', { type: 'button', onclick: async () => {
                        if (!await confirm(`حذفُ خطة «${p.title}»؟`)) return;
                        try { await db.rpc('delete_training_plan', { p_id: p.id }); load(); }
                        catch (e) { toast(e.message, 'bad'); }
                      } }, 'احذف')
                    : null)
              : null);
        }))
      : h('p.muted', 'لا خطط بعد.'));
  };
  await load();

  return h('section.card.stack',
    h('div.row.between', h('h3', 'خطط التدريب'),
      mayTrain() ? h('button.btn.sm.primary', { type: 'button',
        onclick: async () => { if (await planDialog(null)) load(); } }, '＋ خطة') : null),
    h('p.small.muted', 'كلُّ خطةٍ مربَّعٌ يُفتَح صفحةً لها: وحداتُها ومكتبةُ موادِّها '
      + 'وسجلُّ تأهيلها ومستهدَفوها وقاعتُها الخاصة.'),
    box);
}

// ---------------------------------------------------------------------
// ٢) موادُّ التدريب: تُرفَع في خطتها، وتُشارَك بمفتاحها
// ---------------------------------------------------------------------
export const kindOf = (name) => {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.ppt') || n.endsWith('.pptx')) return 'slides';
  return 'other';
};

export async function uploadDialog(plans, rooms, preset = {}) {
  const file = h('input', { type: 'file', accept: '.pdf,.ppt,.pptx', 'aria-label': 'الملف' });
  const title = h('input', { 'aria-label': 'عنوان المادة' });
  const planSel = h('select', { 'aria-label': 'الخطة' },
    h('option', { value: '' }, '— بلا خطة —'),
    plans.map(p => h('option', { value: p.id,
      selected: preset.plan_id === p.id }, p.title)));
  const roomSel = h('select', { 'aria-label': 'القاعة' },
    h('option', { value: '' }, '— بلا قاعة —'),
    rooms.map(r => h('option', { value: r.id,
      selected: preset.room_id === r.id }, r.name)));
  const note = h('input', { 'aria-label': 'ملاحظة' });
  file.onchange = () => {
    if (!title.value.trim() && file.files[0]) {
      title.value = file.files[0].name.replace(/\.(pdf|pptx?)$/i, '');
    }
  };

  const res = await dialog({
    title: 'رفع مادة تدريبية',
    body: h('div.stack',
      h('p.small.muted', 'تُقبل ملفاتُ PDF والعروضُ التقديمية. والعرضُ التقديميُّ لا يُعرض '
        + 'في المتصفح، فمشاركتُه تنزيلًا لا مشاهدة.'),
      h('label.field', 'الملف', file),
      h('div.grid-2',
        h('label.field', 'عنوان المادة', title),
        h('label.field', 'الخطة', planSel),
        h('label.field', 'القاعة', roomSel),
        h('label.field', 'ملاحظة', note))),
    buttons: [
      { label: 'ارفع', kind: 'primary',
        validate: () => (file.files[0] ? (title.value.trim() ? true : 'اكتب عنوان المادة')
                                       : 'اختر الملف'),
        value: () => ({ f: file.files[0], title: title.value.trim(),
          plan_id: planSel.value || null, room_id: roomSel.value || null,
          note: note.value.trim() || null }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return false;
  try {
    const safe = res.f.name.replace(/[^\w.\-]+/g, '_');
    const path = `${Date.now()}_${safe}`;
    await storage.upload('training', path, res.f);
    await db.rpc('save_training_material', { p: {
      title: res.title, kind: kindOf(res.f.name), file_path: path,
      size_bytes: res.f.size, plan_id: res.plan_id, room_id: res.room_id, note: res.note } });
    toast('رُفعت المادة.', 'ok');
    return true;
  } catch (e) { toast(e.message, 'bad'); return false; }
}

export async function shareDialog(mat) {
  let members = [], rooms = [];
  try {
    [members, rooms] = await Promise.all([
      db.select('profiles', { select: 'id,full_name,track,status', status: 'eq.active',
        order: 'full_name.asc' }).catch(() => []),
      db.select('rooms', { select: 'id,name,kind', order: 'sort.asc' }).catch(() => [])
    ]);
  } catch { /* يُعرض ما أمكن */ }

  const q = h('input', { type: 'search', placeholder: 'ابحث باسم العضو', 'aria-label': 'بحث' });
  const list = h('div.chips');
  const picked = new Set();
  const draw = () => {
    const term = q.value.trim();
    list.replaceChildren(...members
      .filter(m => !term || m.full_name.includes(term))
      .slice(0, 60)
      .map(m => {
        const b = h('button.btn.xs' + (picked.has(m.id) ? '.primary' : '.ghost'),
          { type: 'button' }, m.full_name);
        b.onclick = () => { picked.has(m.id) ? picked.delete(m.id) : picked.add(m.id); draw(); };
        return b;
      }));
  };
  q.oninput = draw; draw();

  const roomSel = h('select', { 'aria-label': 'قاعة' },
    h('option', { value: '' }, '— بلا قاعة —'),
    rooms.map(r => h('option', { value: r.id }, r.name)));
  const dl = h('input', { type: 'checkbox', 'aria-label': 'يُتاح التنزيل' });

  const res = await dialog({
    title: `مشاركة «${mat.title}»`,
    body: h('div.stack',
      h('label.field', 'ابحث عن الأعضاء', q),
      list,
      h('label.field', 'أو شارِكها مع قاعة', roomSel),
      h('label.check', dl, h('span', 'يُتاح التنزيل')),
      h('p.small.muted', 'إن تُرك المفتاحُ مغلقًا كانت المادةُ للمشاهدة وحدَها: لا زرَّ تنزيل، ويُقصَّر أجلُ الرابط، وتُوسَم الصفحةُ باسم قارئها. وتصويرُ الشاشة لا يمنعه متصفِّح.')),
    buttons: [
      { label: 'شارِك', kind: 'primary',
        validate: () => (picked.size || roomSel.value ? true : 'اختر عضوًا أو قاعة'),
        value: () => ({ material_id: mat.id, members: [...picked],
          room_id: roomSel.value || null, may_download: dl.checked }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return false;
  try {
    const n = await db.rpc('share_training_material', { p: res });
    toast(`شُورِكت مع ${Number(n) || 0}.`, 'ok');
    return true;
  } catch (e) { toast(e.message, 'bad'); return false; }
}

// عرضُ المادة: للمشاهدة فقط بعلامةٍ مائيةٍ باسم قارئها
export async function viewMaterial(mat, mayDownload) {
  try { await db.rpc('log_material_open', { p_material: mat.id, p_download: false }); }
  catch (e) { toast(e.message, 'bad'); return; }

  if (mat.kind !== 'pdf') {
    if (!mayDownload) { toast('العرضُ التقديميُّ لا يُعرض في المتصفح، ولم يُتح تنزيلُه.', 'bad'); return; }
    return downloadMaterial(mat);
  }
  let url = '';
  try { url = await storage.signedUrl('training', mat.file_path, mayDownload ? 3600 : 300); }
  catch (e) { toast(e.message, 'bad'); return; }

  const { markerOf } = await import('../trainmark.js');
  const who = markerOf();
  await dialog({
    title: mat.title,
    body: h('div.stack',
      h('div.doc-view',
        h('iframe', { src: `${url}#toolbar=0&navpanes=0&scrollbar=1`, title: mat.title,
          loading: 'lazy' }),
        mayDownload ? null : h('div.doc-mark', { 'aria-hidden': 'true' },
          Array.from({ length: 6 }, () => h('span', who)))),
      mayDownload ? null : h('p.small.muted', 'هذه المادةُ للمشاهدة فقط، وقد وُسمت باسمك.')),
    buttons: [{ label: 'إغلاق', value: null }]
  });
}

// التنزيلُ لا يخرج إلا موسومًا ببريد مَن نزَّله (ملاحظة ٣٧٢)
export async function downloadMaterial(mat) {
  const { downloadMarked } = await import('../trainmark.js');
  await downloadMarked(mat, {
    log: () => db.rpc('log_material_open', { p_material: mat.id, p_download: true }),
    signedUrl: () => storage.signedUrl('training', mat.file_path, 600)
  });
}


// ـــ ما لا خطةَ له من الموادّ: يبقى بابُه هنا فلا يضيع، وما سواه
//   صار في صفحة خطته (ملاحظة ٣٦٠)
async function orphanCard() {
  let plans = [], rooms = [];
  try {
    [plans, rooms] = await Promise.all([
      db.select('training_plans', { select: 'id,title', order: 'title.asc' }).catch(() => []),
      db.select('rooms', { select: 'id,name', order: 'sort.asc' }).catch(() => [])
    ]);
  } catch { plans = []; rooms = []; }
  const box = h('div.stack');
  const load = async () => {
    let rows = [];
    try {
      rows = await db.select('training_materials', { select: '*', plan_id: 'is.null',
        order: 'created_at.desc' }).catch(() => []);
    } catch { rows = []; }
    box.replaceChildren(rows.length
      ? h('div.table-wrap', h('table.responsive',
          h('thead', h('tr', ['المادة', 'النوع', ''].map(t => h('th', t)))),
          h('tbody', rows.map(m => h('tr',
            h('td', { 'data-label': 'المادة' }, h('b', m.title),
              m.note ? h('span.sub', m.note) : null),
            h('td', { 'data-label': 'النوع' }, KIND[m.kind] || 'ملف'),
            h('td', h('div.row',
              h('button.btn.xs', { type: 'button',
                onclick: () => viewMaterial(m, false) }, 'افتح'),
              h('button.btn.xs.ghost', { type: 'button',
                onclick: () => downloadMaterial(m) }, '⤓ نزِّلْ موسومةً'),
              h('button.btn.xs', { type: 'button', onclick: async () => {
                if (await shareDialog(m)) load();
              } }, 'شارِك'),
              isAdmin() ? h('button.btn.xs.ghost', { type: 'button', onclick: async () => {
                if (!await confirm(`حذفُ «${m.title}»؟`)) return;
                try { await db.rpc('delete_training_material', { p_id: m.id }); load(); }
                catch (e) { toast(e.message, 'bad'); }
              } }, 'احذف') : null)))))))
      : h('p.small.muted', 'لا موادَّ خارجَ الخطط — وكلُّ مادةٍ تُرفَع في خطتها.'));
  };
  await load();
  return h('section.card.stack',
    h('div.row.between', h('h3', 'موادٌّ خارجَ الخطط'),
      h('button.btn.sm.ghost', { type: 'button', onclick: async () => {
        if (await uploadDialog(plans, rooms)) load();
      } }, '＋ ارفعْ مادةً عامّة')),
    h('p.small.muted', 'مكتبةُ الموادِّ وسجلُّ التأهيل صارا داخلَ كلِّ خطة. '
      + 'وما بقي هنا موادٌّ لم تُنسَبْ إلى خطةٍ بعد.'),
    box);
}

// ---------------------------------------------------------------------
// ٣) سجل التأهيل
// ---------------------------------------------------------------------

export async function enrollDialog(row = null, preset = {}) {
  let members = [], plans = [], trainers = [];
  try {
    [members, plans] = await Promise.all([
      db.select('profiles', { select: 'id,full_name,is_trainer', status: 'eq.active',
        order: 'full_name.asc' }).catch(() => []),
      db.select('training_plans', { select: 'id,title', order: 'title.asc' }).catch(() => [])
    ]);
    trainers = members.filter(m => m.is_trainer);
  } catch { /* يُعرض ما أمكن */ }

  const member = h('select', { 'aria-label': 'العضو', disabled: row ? true : null },
    members.map(m => h('option', { value: m.id, selected: row?.member_id === m.id }, m.full_name)));
  const plan = h('select', { 'aria-label': 'الخطة',
      disabled: (row || preset.plan_id) ? true : null },
    plans.map(p => h('option', { value: p.id,
      selected: (row?.plan_id || preset.plan_id) === p.id }, p.title)));
  const trainer = h('select', { 'aria-label': 'المدرِّب' },
    h('option', { value: '' }, '— أنا —'),
    trainers.map(t => h('option', { value: t.id, selected: row?.trainer_id === t.id }, t.full_name)));
  const status = h('select', { 'aria-label': 'الحال' },
    Object.entries(STATUS).map(([k, v]) =>
      h('option', { value: k, selected: (row?.status || 'enrolled') === k }, v)));
  const started = h('input', { type: 'date', value: row?.started_at || '', 'aria-label': 'من' });
  const done = h('input', { type: 'date', value: row?.done_at || '', 'aria-label': 'إلى' });
  const note = h('input', { value: row?.note || '', 'aria-label': 'ملاحظة' });

  const res = await dialog({
    title: row ? `سجلُّ «${row.full_name}»` : 'التحاقٌ بخطة',
    body: h('div.stack', h('div.grid-2',
      h('label.field', 'العضو', member),
      h('label.field', 'الخطة', plan),
      h('label.field', 'المدرِّب', trainer),
      h('label.field', 'الحال', status),
      h('label.field', 'من', started),
      h('label.field', 'إلى', done)),
      h('label.field', 'ملاحظة', note)),
    buttons: [
      { label: 'حفظ', kind: 'primary', value: () => ({
        id: row?.id || null, member_id: member.value, plan_id: plan.value,
        trainer_id: trainer.value || null, status: status.value,
        started_at: started.value || null, done_at: done.value || null,
        note: note.value.trim() || null }) },
      { label: 'إلغاء', value: null }
    ]
  });
  if (!res) return false;
  try { await db.rpc('save_member_training', { p: res }); toast('حُفظ السجل.', 'ok'); return true; }
  catch (e) { toast(e.message, 'bad'); return false; }
}

// ---------------------------------------------------------------------
// ٤) شاشةُ العضو: ما شُورك معه، وتأهيلُه
// ---------------------------------------------------------------------
async function myCard() {
  const box = h('div.stack');
  let mats = [], rec = [];
  try {
    [mats, rec] = await Promise.all([
      db.rpc('my_training_materials').catch(() => []),
      db.rpc('training_record', { p_member: state.profile?.id }).catch(() => [])
    ]);
  } catch { /* يُعرض ما أمكن */ }

  box.replaceChildren(
    h('section.card.stack',
      h('h3', 'موادُّ شُورِكت معي'),
      mats.length ? h('div.table-wrap', h('table.responsive',
        h('thead', h('tr', ['المادة', 'الخطة', 'النوع', ''].map(t => h('th', t)))),
        h('tbody', mats.map(m => h('tr',
          h('td', { 'data-label': 'المادة' }, h('b', m.title)),
          h('td', { 'data-label': 'الخطة' }, m.plan_title || '—'),
          h('td', { 'data-label': 'النوع' }, KIND[m.kind] || 'ملف'),
          h('td', h('div.row',
            h('button.btn.xs', { type: 'button', onclick: () => viewMaterial(m, m.may_download) },
              'افتح'),
            m.may_download
              ? h('button.btn.xs.ghost', { type: 'button', onclick: () => downloadMaterial(m) }, 'نزّل')
              : h('span.badge', 'للمشاهدة فقط'))))))))
        : h('p.muted', 'لم تُشارَك معك مادةٌ بعد.')),
    h('section.card.stack',
      h('h3', 'تأهيلي'),
      rec.length ? h('ul.ab-list', rec.map(r => h('li',
        h('b', r.plan_title), ' — ', STATUS[r.status] || r.status,
        r.trainer_name ? ` (المدرِّب: ${r.trainer_name})` : '',
        r.done_at ? ` — أُتمّ في ${fmtDate(r.done_at)}` : '')))
        : h('p.muted', 'لم تلتحق بخطةٍ بعد.')));
  return box;
}

// ---------------------------------------------------------------------
export async function render() {
  const head = h('div.page-head',
    h('div.grow', h('div.eyebrow', 'التدريب'), h('h1', 'التدريب والتأهيل'),
      h('p.muted', 'خططٌ يضعها مدرِّبون من خبراء الفريق، وموادُّ تُشارَك، وسجلُّ تأهيلٍ '
        + 'لكل عضو. وتجري الدوراتُ في قاعات التدريب.')));

  if (!mayTrain()) return h('div', head, await myCard());

  const cards = h('div.stack');
  cards.append(await plansCard(), await orphanCard());
  return h('div', head, cards);
}
