// اللغات: مرجع واحد تستخدمه المنصة والموقع العام
import { h, toast, busy, dialog } from '../ui.js';
import { db } from '../sb.js';
import { state, loadReference } from '../store.js';

export async function render(ctx) {
  await loadReference(true);
  const counts = await db.select('member_languages', { select: 'language_code' });
  const n = code => counts.filter(c => c.language_code === code).length;
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
        const e = !/^[a-z]{2,8}$/.test(code.value.trim()) ? 'الرمز أحرف لاتينية صغيرة (٢–٨)' : name.value.trim().length < 2 ? 'اكتب الاسم بالعربية' : !native.value.trim() ? 'اكتب الاسم بلغته' : '';
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

  function card(l) {
    const members = n(l.code);
    const state2 = l.is_core ? 'core' : (l.is_active ? 'active' : 'off');
    const el = h(l.is_core ? 'div.lang-card' : 'button.lang-card',
      { class: state2, type: l.is_core ? null : 'button',
        title: l.is_core ? 'لغة رئيسية ثابتة' : (l.is_active ? 'اضغط لتعطيلها' : 'اضغط لتفعيلها') },
      h('div.row.between', h('b', l.name_ar), h('span.lang-code', { dir: 'ltr' }, l.code)),
      h('span.lang-native', { dir: l.dir }, l.native_name),
      h('div.row.between',
        members ? h('span.small.muted', `${members} مترجمًا`) : h('span.badge.warn', 'لا أحد'),
        l.is_core ? h('span.badge.gold', 'ثابتة') : h('span.badge', { class: l.is_active ? 'ok' : '' }, l.is_active ? 'مفعّلة' : 'معطّلة')));
    if (!l.is_core) el.onclick = () => toggle(l, el);
    return el;
  }

  function draw() {
    const s = q.value.trim();
    const match = l => (!s || l.name_ar.includes(s) || (l.native_name || '').includes(s) || l.code.includes(s.toLowerCase()))
      && (filter.value !== 'core' || l.is_core)
      && (filter.value !== 'active' || (l.is_active && !l.is_core))
      && (filter.value !== 'off' || !l.is_active)
      && (filter.value !== 'empty' || !n(l.code));
    const list = state.languages.filter(match);
    const groups = [
      ['اللغات الرئيسية الثابتة', list.filter(l => l.is_core)],
      ['المفعّلة', list.filter(l => !l.is_core && l.is_active)],
      ['المعطّلة', list.filter(l => !l.is_active)]
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
