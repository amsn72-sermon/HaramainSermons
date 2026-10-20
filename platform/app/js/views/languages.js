// اللغات: مرجع واحد تستخدمه المنصة والموقع العام
import { h, toast, busy, dialog } from '../ui.js';
import { db } from '../sb.js';
import { state, loadReference, isManager } from '../store.js';

export async function render(ctx) {
  await loadReference(true);
  const counts = await db.select('member_languages', { select: 'language_code,member_id' });
  const n = code => counts.filter(c => c.language_code === code).length;
  // أسماءُ الأعضاء لعرض مشرف اللغة واختياره (ملاحظة ٤٤٠)
  let people = [];
  try {
    people = await db.select('profiles',
      { select: 'id,full_name', status: 'eq.active', order: 'full_name.asc' }) || [];
  } catch { people = []; }
  const nameOf = id => people.find(p => p.id === id)?.full_name || '—';
  const reload = async () => { await loadReference(true); ctx.navigate('/app/languages', { replace: true }); };

  async function add() {
    const code = h('input', { dir: 'ltr', placeholder: 'مثال: sw', maxlength: 8 });
    const name = h('input', { placeholder: 'مثال: السواحلية' });
    const native = h('input', { dir: 'auto', placeholder: 'مثال: Kiswahili' });
    const dir = h('select', h('option', { value: 'ltr' }, 'من اليسار إلى اليمين'), h('option', { value: 'rtl' }, 'من اليمين إلى اليسار'));
    const err = h('p.err', { hidden: true });
    const v = await dialog({ title: 'إضافة لغة', body: h('div.stack',
      h('label.field', 'الرمز', h('small', 'رمز ISO 639 بأحرف لاتينية صغيرة'), code), h('label.field', 'الاسم بالعربية', name),
      h('label.field', 'الاسم بلغته', native), h('label.field', 'اتجاه الكتابة', dir), err),
      buttons: [{ label: 'إضافة', kind: 'primary', validate: () => {
        const e = !/^[a-z]{2,8}$/.test(code.value.trim()) ? 'الرمز أحرف لاتينية صغيرة (2–8)' : name.value.trim().length < 2 ? 'اكتب الاسم بالعربية' : !native.value.trim() ? 'اكتب الاسم بلغته' : '';
        err.textContent = e; err.hidden = !e; return !e;
      }, value: () => ({ code: code.value.trim(), name_ar: name.value.trim(), native_name: native.value.trim(), dir: dir.value, sort: 100 }) }, { label: 'إلغاء', value: null }] });
    if (!v) return;
    try { await db.insert('languages', v); toast('أُضيفت اللغة. اربط بها مترجمًا من «فريق العمل».', 'ok'); reload(); }
    catch (e) { toast(/duplicate|unique/i.test(e.message) ? 'الرمز أو الاسم مستخدم مسبقًا' : e.message, 'bad'); }
  }

  // شبكة بطاقات مضغوطة بدل جدول طويل: خمس لغات في الصف (ملاحظة ١١٣)
  const q = h('input', { type: 'search', placeholder: 'ابحث عن لغة', 'aria-label': 'بحث' });
  const filter = h('select', { 'aria-label': 'التصفية' },
    h('option', { value: '' }, 'كل اللغات'),
    h('option', { value: 'core' }, 'الرئيسية الثابتة'),
    h('option', { value: 'active' }, 'المفعّلة'),
    h('option', { value: 'off' }, 'المعطّلة'),
    h('option', { value: 'empty' }, 'بلا مترجمين'));
  const box = h('div.stack');
  const counter = h('span.small.muted');

  const toggle = (l, btn) => busy(btn, async () => {
    try { await db.update('languages', { code: `eq.${l.code}` }, { is_active: !l.is_active }); reload(); }
    catch (err) { toast(err.message, 'bad'); }
  });

  // لغةُ المبادرة: يخدمها المتعاقد بلا مقابل، فتُستثنى من المستخلص
  // وتبقى أعمالُها محسوبةً في المنصة (ملاحظة ١٩٤)
  const initDialog = async l => {
    const on = h('input', { type: 'checkbox', checked: l.is_initiative ? true : null,
      'aria-label': 'لغة مبادرة بلا مقابل' });
    const note = h('input', { value: l.initiative_note || '', 'aria-label': 'بيان المبادرة',
      placeholder: 'مبادرةٌ من المتعاقد: بلا مقابل' });
    const res = await dialog({
      title: `${l.name_ar} — المبادرة`,
      body: h('div.stack',
        h('p.small.muted', 'العقد يطلب إحدى عشرة لغةً بالخطبة الأسبوعية. وما زاده المتعاقد '
          + 'من عنده بلا مقابل يُوسَم هنا: تبقى أعمالُه محسوبةً في المنصة ودليل الإنتاج '
          + 'والأرشيف، وتُستثنى من كميات المستخلص، وتُعرض في بنود العقد سطرًا مستقلًّا.'),
        h('label.check', on, h('span', 'لغةُ مبادرة — بلا مقابل')),
        h('label.field', 'بيانُها كما يُعرض', note)),
      buttons: [
        { label: 'حفظ', kind: 'primary',
          value: () => ({ on: on.checked, note: note.value.trim() || null }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('set_language_initiative', { p_code: l.code, p_on: res.on, p_note: res.note });
      toast(res.on ? 'وُسِمت لغةَ مبادرة.' : 'أُخرجت من المبادرة.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  };

  // ـــ مشرفُ اللغة: أولُ من يستلم وآخرُ من يسلّم، ويوزّع على أهل لغته.
  //   تعيينُه بيد مدير المشروع، ولا يكون إلا ممن اعتُمدت له اللغة (ملاحظة ٤٤٠)
  const supDialog = async l => {
    const ids = new Set(counts.filter(c => c.language_code === l.code).map(c => c.member_id));
    const cands = people.filter(p => ids.has(p.id));
    const pick = h('select', { 'aria-label': 'مشرف اللغة' },
      h('option', { value: '' }, 'بلا مشرف — المسؤولية للمنسق'),
      cands.map(p => h('option',
        { value: p.id, selected: l.supervisor_id === p.id }, p.full_name)));
    const res = await dialog({
      title: `${l.name_ar} — مشرفُ اللغة`,
      body: h('div.stack',
        h('p.small.muted', 'مشرفُ اللغة واحدٌ لكلِّ لغة: تُسنَد إليه مراحلُ الترجمة '
          + 'والمراجعة والتحرير ابتداءً، فيوزّعها على أهل لغته ثمَّ تعود إليه '
          + 'يراجعها، ثمَّ تذهب للمنسق. ولا يُنشئ عملًا ولا يُسنِد ابتداءً. '
          + 'واللغةُ التي لا مشرفَ لها مسؤوليتُها للمنسق.'),
        cands.length ? h('label.field', 'المشرف', pick)
          : h('p.err', 'لا عضوَ معتمدًا في هذه اللغة بعد — اربطْ بها مترجمًا '
              + 'من «فريق العمل» أولًا.')),
      buttons: [
        { label: 'حفظ', kind: 'primary', value: () => pick.value || '' },
        { label: 'إلغاء', value: null }
      ]
    });
    if (res === null) return;
    try {
      await db.rpc('set_lang_supervisor', { p_lang: l.code, p_member: res || null });
      toast(res ? 'عُيِّن مشرفُ اللغة.' : 'رُفع مشرفُ اللغة.', 'ok');
      reload();
    } catch (err) { toast(err.message, 'bad'); }
  };

  function card(l) {
    const members = n(l.code);
    const state2 = l.is_source ? 'core' : l.is_initiative ? 'init'
      : (l.is_core ? 'core' : (l.is_active ? 'active' : 'off'));
    const fixed = l.is_core || l.is_initiative || l.is_source;
    const el = h(fixed ? 'div.lang-card' : 'button.lang-card',
      { class: state2, type: fixed ? null : 'button',
        title: l.is_source ? 'لغةُ المصدر: تُنتقى لغةً أمًّا ولا تكون هدفًا للترجمة'
          : l.is_initiative ? (l.initiative_note || 'لغةُ مبادرة بلا مقابل')
          : l.is_core ? 'لغة رئيسية ثابتة' : (l.is_active ? 'اضغط لتعطيلها' : 'اضغط لتفعيلها') },
      h('div.row.between', h('b', l.name_ar), h('span.lang-code', { dir: 'ltr' }, l.code)),
      h('span.lang-native', { dir: l.dir }, l.native_name),
      h('div.row.between',
        l.is_source ? h('span.small.muted', 'لسانُ المصدر')
          : members ? h('span.small.muted', `${members} مترجمًا`) : h('span.badge.warn', 'لا أحد'),
        h('span.row', { style: { gap: '4px' } },
          l.is_initiative ? h('span.badge.gold', { title: 'بلا مقابل' }, 'مبادرة') : null,
          l.is_source ? h('span.badge.gold', 'لغةُ المصدر')
            : l.is_core ? h('span.badge.gold', 'ثابتة')
            : h('span.badge', { class: l.is_active ? 'ok' : '' }, l.is_active ? 'مفعّلة' : 'معطّلة'))),
      l.is_source ? null
        : h('span.small.lang-sup',
            l.supervisor_id ? ['مشرفُ اللغة: ', h('b', nameOf(l.supervisor_id))]
              : h('span.muted', 'لا مشرفَ لها — المسؤولية للمنسق')),
      isManager() && !l.is_source
        ? h('div.row', { style: { gap: '4px', marginTop: '6px' } },
            h('button.btn.xs', { type: 'button',
              onclick: e => { e.stopPropagation(); initDialog(l); } },
              l.is_initiative ? 'إخراجٌ من المبادرة' : 'ضمٌّ إلى المبادرة'),
            h('button.btn.xs', { type: 'button',
              onclick: e => { e.stopPropagation(); supDialog(l); } },
              l.supervisor_id ? 'تغييرُ المشرف' : 'تعيينُ مشرف'))
        : null);
    if (!fixed) el.onclick = () => toggle(l, el);
    return el;
  }

  function draw() {
    const s = q.value.trim();
    const match = l => (!s || l.name_ar.includes(s) || (l.native_name || '').includes(s) || l.code.includes(s.toLowerCase()))
      && (filter.value !== 'core' || l.is_core)
      && (filter.value !== 'active' || (l.is_active && !l.is_core))
      && (filter.value !== 'off' || (!l.is_active && !l.is_source))
      && (filter.value !== 'active' || !l.is_source)
      && (filter.value !== 'empty' || !l.is_source)
      && (filter.value !== 'empty' || !n(l.code));
    const list = state.languages.filter(match);
    const groups = [
      ['لغةُ المصدر', list.filter(l => l.is_source)],
      ['لغاتُ المبادرة — بلا مقابل', list.filter(l => l.is_initiative && !l.is_source)],
      ['اللغات الرئيسية الثابتة', list.filter(l => l.is_core && !l.is_initiative && !l.is_source)],
      ['المفعّلة', list.filter(l => !l.is_core && !l.is_initiative && !l.is_source && l.is_active)],
      ['المعطّلة', list.filter(l => !l.is_active && !l.is_source)]
    ].filter(([, g]) => g.length);
    counter.textContent = `${list.length} من ${state.languages.length} لغة`;
    box.replaceChildren(...(groups.length ? groups.map(([title, g]) =>
      h('section.card.stack',
        h('div.row.between', h('h3', title), h('span.badge', `${g.length}`)),
        h('div.lang-grid', g.map(card))))
      : [h('p.muted', 'لا لغات مطابقة.')]));
  }
  q.addEventListener('input', draw);
  filter.addEventListener('change', draw);
  draw();

  return h('div',
    h('div.page-head', h('div.grow', h('div.eyebrow', 'الإدارة'), h('h1', 'اللغات'),
      h('p.muted', 'اضغط البطاقة لتفعيل اللغة أو تعطيلها. التعطيل يخفيها من التكليفات الجديدة ويحفظ الأعمال السابقة، واللغات الرئيسية ثابتة.')),
      h('button.btn.primary', { onclick: add }, '＋ إضافة لغة')),
    h('div.grid', { style: { marginBottom: '14px' } },
      h('label.field', 'بحث', q), h('label.field', 'التصفية', filter), h('div.field', h('b', 'المعروض'), counter)),
    box);
}
