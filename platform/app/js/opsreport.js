// التقرير الشهري للتكاليف التشغيلية — يُعرض داخل «بنود العقد والمستخلص»
// (ملاحظتا ١٩٠ و١٩٥)
import { h, toast, confirm, dialog, req } from './ui.js';
import { db } from './sb.js';
import { monthStart, thisMonth } from './pay.js';
import { buildXlsx, downloadBlob } from './xlsx.js';

const VAT = 0.15;          // ضريبة القيمة المضافة كما في الكراسة

// ---------------------------------------------------------------------
// التقرير الشهري للتكاليف التشغيلية — بنودُه من كراسة المنافسة نفسها:
// فريق الإرشاد المكاني والديني بموقعيه ومواسمه، لكل بندٍ عددُه وتكلفتُه
// الشهرية للفرد. والحسم بأمرين كما نصّت الكراسة: غيابٌ يُثبت من سجلّ
// الدوام، ونسبةُ المستخلص من متوسط التقييم الشهري. ولمدير المشروع أن
// يضيف بندًا بسطره وبياناته (ملاحظة ١٩٣).
// ---------------------------------------------------------------------
const OPS_SEASON = { year: 'السنة كلها', ramadan: 'رمضان', hajj: 'موسم الحج' };
const OPS_MOSQUE = { makkah: 'المسجد الحرام', madinah: 'المسجد النبوي' };
const OPS_ROLE = { field: 'الإرشاد المكاني', answers: 'إجابة السائلين' };

export async function opsSection() {
  let month = thisMonth();
  const box = h('div.stack');

  const monthInput = h('input', { type: 'month', value: month, 'aria-label': 'شهر التقرير' });
  monthInput.onchange = () => { month = monthInput.value || thisMonth(); draw(); };

  const n2 = v => Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------- بندٌ يُضاف أو يُعدَّل ----------
  const itemDialog = async (row = null) => {
    const own = !row || row.is_custom;
    const f = {
      name: h('input', { value: row?.name || '', 'aria-label': 'اسم البند',
        disabled: own ? null : true }),
      staff: h('input', { type: 'number', min: 1, max: 9999, value: row?.staff_count ?? 1,
        'aria-label': 'عدد الأفراد' }),
      cost: h('input', { type: 'number', min: 0, step: 0.01, value: row?.unit_cost ?? '',
        'aria-label': 'التكلفة الشهرية للفرد', disabled: own ? null : true }),
      mosque: h('select', { 'aria-label': 'الموقع', disabled: own ? null : true },
        h('option', { value: '' }, '— لا موقع بعينه —'),
        Object.entries(OPS_MOSQUE).map(([k, v]) =>
          h('option', { value: k, selected: row?.mosque === k }, v))),
      role: h('select', { 'aria-label': 'الفريق', disabled: own ? null : true },
        h('option', { value: '' }, '— بلا ربطٍ بفريق —'),
        Object.entries(OPS_ROLE).map(([k, v]) =>
          h('option', { value: k, selected: row?.role_key === k }, v))),
      season: h('select', { 'aria-label': 'الموسم', disabled: own ? null : true },
        Object.entries(OPS_SEASON).map(([k, v]) =>
          h('option', { value: k, selected: (row?.season || 'year') === k }, v))),
      note: h('input', { value: row?.note || '', 'aria-label': 'ملاحظة البند' })
    };
    const res = await dialog({
      title: row ? row.name : 'بندٌ جديد في التقرير',
      body: h('div.stack',
        own
          ? h('p.small.muted', 'بندٌ من عندك: ما لم تُسعّره الكراسة شهريًّا يُكتب هنا بيده. '
              + 'والربط بفريقٍ وموقع يجعل غيابه يُحتسب من سجلّ الدوام وتقييمه من نموذج الهيئة.')
          : h('p.small.warn', 'هذا بندٌ من كراسة المنافسة: اسمُه وسعرُه كما وردا فيها، '
              + 'ويبقى لك تعديل عدده وملاحظته.'),
        h('label.field', req('اسم البند'), f.name),
        h('div.grid-2',
          h('label.field', req('عدد الأفراد'), f.staff),
          h('label.field', req('التكلفة الشهرية للفرد'), f.cost),
          h('label.field', 'الموقع', f.mosque),
          h('label.field', 'الفريق', f.role),
          h('label.field', 'الموسم', f.season,
            h('small', 'سطر الموسم لا يظهر إلا في شهره الهجري'))),
        h('label.field', 'ملاحظة', f.note)),
      buttons: [
        { label: row ? 'حفظ' : 'إضافة البند', kind: 'primary',
          validate: () => {
            if (!f.name.value.trim()) return 'اكتب اسم البند';
            if (!(Number(f.cost.value) >= 0) || f.cost.value === '') return 'اكتب التكلفة الشهرية للفرد';
            if (!(Number(f.staff.value) >= 1)) return 'عدد الأفراد واحدٌ فأكثر';
            return true;
          },
          value: () => ({
            code: row?.code ?? null, name: f.name.value.trim(),
            staff_count: Number(f.staff.value), unit_cost: Number(f.cost.value),
            mosque: f.mosque.value || null, role_key: f.role.value || null,
            season: f.season.value, note: f.note.value.trim() || null
          }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      await db.rpc('save_ops_item', { p: res });
      toast(row ? 'حُفظ البند.' : 'أُضيف البند.', 'ok');
      draw();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const removeItem = async r => {
    if (!await confirm('حذف البند', `يُحذف «${r.name}» من التقرير بكل شهوره؟`, 'حذف', 'bad')) return;
    try { await db.rpc('delete_ops_item', { p_code: r.code }); toast('حُذف البند.', 'ok'); draw(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  // ---------- تصحيح شهرٍ بعينه ----------
  const editMonth = async r => {
    const f = {
      staff: h('input', { type: 'number', min: 0, max: 9999, value: r.staff_count,
        'aria-label': 'عدد الأفراد في الشهر' }),
      days: h('input', { type: 'number', min: 0, max: 31, step: 0.5,
        value: Number(r.short_days) || 0, 'aria-label': 'التقصير بالأيام' }),
      ded: h('input', { type: 'number', min: 0, step: 0.01,
        value: r.is_manual && r.deduction != null ? Number(r.deduction) : '',
        placeholder: 'يُحتسب من الأيام', 'aria-label': 'الحسميات للغياب' }),
      note: h('input', { value: r.note || '', 'aria-label': 'سبب الحسم' })
    };
    const res = await dialog({
      title: `${r.name} — ${month}`,
      body: h('div.stack',
        h('p.small.muted', 'العدد والتكلفة من الكراسة، والتقصير يُحتسب من سجلّ الدوام. '
          + 'وما تكتبه هنا يعلو على المحتسَب، ويُمحى فيعود إليه.'),
        h('div.grid-2',
          h('label.field', 'عدد الأفراد في هذا الشهر', f.staff),
          h('label.field', 'التقصير بالأيام', f.days),
          h('label.field', 'الحسميات للغياب',
            h('small', `اتركه فارغًا ليُحتسب من الأيام على ${r.season === 'year' ? 'ثلاثين' : String(r.days || 30)}`),
            f.ded),
          h('label.field', 'سبب الحسم', f.note)),
        h('p.small.muted', `التكلفة الشهرية للفرد ${n2(r.unit_cost)}`
          + (r.eval_avg != null ? ` · متوسط التقييم ${r.eval_avg} فنسبة المستخلص ${r.eval_pct}٪` : '')),
        r.eval_warn
          ? h('p.small.bad', 'متوسط التقييم أقلُّ من ٧٠: توجيهُ إنذارٍ خطي وحسمُ ١٠٪ '
              + 'كما نصّت الكراسة.') : null),
      buttons: [
        { label: 'حفظ', kind: 'primary', value: () => ({ save: true }) },
        { label: 'إعادته إلى المحتسَب', kind: 'danger', value: () => ({ clear: true }) },
        { label: 'إلغاء', value: null }
      ]
    });
    if (!res) return;
    try {
      if (res.clear) {
        await db.rpc('clear_ops_month', { p_month: monthStart(month), p_code: r.code });
        toast('أُعيد البند إلى المحتسَب.', 'ok');
      } else {
        await db.rpc('set_ops_month', { p: {
          month: monthStart(month), code: r.code,
          staff_count: f.staff.value === '' ? null : Number(f.staff.value),
          short_days: Number(f.days.value) || 0,
          deduction: f.ded.value === '' ? null : Number(f.ded.value),
          note: f.note.value.trim() || null
        } });
        toast('حُفظ البند.', 'ok');
      }
      draw();
    } catch (e) { toast(e.message, 'bad'); }
  };

  // ---------- الرسم ----------
  async function draw() {
    box.replaceChildren(h('p.small.muted', 'جارٍ الاحتساب…'));
    let rows = [];
    try { rows = await db.rpc('ops_report', { p_month: monthStart(month) }); }
    catch (e) { box.replaceChildren(h('p.small.bad', e.message)); return; }
    rows = Array.isArray(rows) ? rows : [];

    const addBtn = h('button.btn.sm.primary', { type: 'button',
      onclick: () => itemDialog(null) }, '＋ بند');

    if (!rows.length) {
      box.replaceChildren(
        h('p.muted', 'لا بنود في هذا الشهر — وبنود المواسم لا تظهر إلا في شهورها.'),
        h('div.row', addBtn));
      return;
    }

    const sum = k => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
    const total = sum('total_cost');
    const absent = sum('deduction');
    const evalCut = sum('eval_cut');
    const afterDed = total - absent - evalCut;
    const vat = afterDed * VAT;

    const table = h('div.table-wrap', h('table.responsive.ops-table',
      h('thead', h('tr', ['م', 'البند', 'عدد الأفراد', 'التكلفة الشهرية الفردية',
        'التكلفة الإجمالية', 'التقصير بالأيام', 'الحسميات للغياب',
        'نسبة المستخلص', 'حسم التقييم', 'الصافي', '']
        .map(t => h('th', t)))),
      h('tbody', rows.map(r => h('tr',
        h('td', { 'data-label': 'م', dir: 'ltr' }, String(r.code)),
        h('td', { 'data-label': 'البند' }, h('b', r.name),
          h('span.sub',
            [r.mosque ? OPS_MOSQUE[r.mosque] : null,
             r.season && r.season !== 'year' ? OPS_SEASON[r.season] : null,
             r.note || null].filter(Boolean).join(' · ')),
          r.is_custom ? h('span.badge', { title: 'بندٌ أضفتَه بيدك' }, 'مضاف') : null,
          r.is_manual ? h('span.badge.gold', { title: 'قيمةٌ مكتوبة تعلو على المحتسَب' }, 'مُصحَّح') : null),
        h('td', { 'data-label': 'عدد الأفراد', dir: 'ltr' }, String(r.staff_count)),
        h('td', { 'data-label': 'التكلفة الشهرية الفردية', dir: 'ltr' }, n2(r.unit_cost)),
        h('td', { 'data-label': 'التكلفة الإجمالية', dir: 'ltr' }, n2(r.total_cost)),
        h('td', { 'data-label': 'التقصير بالأيام', dir: 'ltr' },
          Number(r.short_days) ? h('span.bad', String(Number(r.short_days))) : '0'),
        h('td', { 'data-label': 'الحسميات للغياب', dir: 'ltr' },
          Number(r.deduction) ? h('span.bad', n2(r.deduction)) : n2(0)),
        h('td', { 'data-label': 'نسبة المستخلص', dir: 'ltr' },
          r.eval_avg == null
            ? h('span.muted', '—')
            : h('span', { class: r.eval_pct < 100 ? 'bad' : 'ok',
                title: `متوسط التقييم ${r.eval_avg} من ١٠٠` }, `${r.eval_pct}٪`),
          r.eval_warn ? h('span.badge.bad', { title: 'إنذارٌ خطي كما نصّت الكراسة' }, 'إنذار') : null),
        h('td', { 'data-label': 'حسم التقييم', dir: 'ltr' },
          Number(r.eval_cut) ? h('span.bad', n2(r.eval_cut)) : n2(0)),
        h('td', { 'data-label': 'الصافي', dir: 'ltr' }, h('b', n2(r.net))),
        h('td', h('div.row',
          h('button.btn.sm', { type: 'button', onclick: () => editMonth(r) }, 'تصحيح الشهر'),
          h('button.btn.xs', { type: 'button', title: 'بيانات البند',
            onclick: () => itemDialog(r) }, 'البند'),
          r.is_custom
            ? h('button.btn.xs.danger', { type: 'button', title: 'حذف البند',
                onclick: () => removeItem(r) }, '×') : null)))))));

    const line = (label, value, cls = '') => h('div.row.between.ops-line', { class: cls },
      h('span', label), h('b', { dir: 'ltr' }, n2(value)));

    box.replaceChildren(
      h('div.row.between',
        h('p.small.muted', { style: { margin: 0 } },
          'بنود هذا التقرير من كراسة المنافسة: فريق الإرشاد المكاني والديني بموقعيه ومواسمه. '
          + 'والحسم بأمرين كما نصّت: غيابٌ يُثبت من سجلّ الدوام، '
          + 'ونسبةُ المستخلص من متوسط التقييم الشهري.'),
        addBtn),
      table,
      h('section.card.stack.ops-sum',
        line('الإجمالي', total),
        line('الحسميات للغياب', absent, 'bad'),
        line('حسم التقييم', evalCut, 'bad'),
        line('الإجمالي بعد الحسميات', afterDed),
        line('ضريبة القيمة المضافة ١٥٪', vat),
        line('الإجمالي شامل الضريبة', afterDed + vat, 'grand'),
        h('p.small.muted', 'ونسبة المستخلص من جدول الكراسة: من ٩٠ إلى ١٠٠ ← ١٠٠٪، '
          + 'ومن ٨٠ إلى ٨٩ ← ٩٠٪، ومن ٧٠ إلى ٧٩ ← ٨٠٪، وأقلُّ من ٧٠ ← إنذارٌ خطي وحسمُ ١٠٪.')),
      h('div.row',
        h('button.btn.sm', { type: 'button',
          onclick: () => exportOps(rows, total, absent, evalCut, vat) }, '⤓ تصدير إلى Excel')));
  }

  const exportOps = (rows, total, absent, evalCut, vat) => {
    const out = [['م', 'البند', 'الموقع', 'الموسم', 'عدد الأفراد',
      'التكلفة الشهرية الفردية', 'التكلفة الإجمالية', 'التقصير بالأيام',
      'الحسميات للغياب', 'متوسط التقييم', 'نسبة المستخلص', 'حسم التقييم',
      'الصافي', 'ملاحظة']];
    const f2 = v => Number(v || 0).toFixed(2);
    for (const r of rows) {
      out.push([String(r.code), r.name, r.mosque ? OPS_MOSQUE[r.mosque] : '',
        OPS_SEASON[r.season] || '', String(r.staff_count), f2(r.unit_cost),
        f2(r.total_cost), String(Number(r.short_days) || 0), f2(r.deduction),
        r.eval_avg == null ? '' : String(r.eval_avg), `${r.eval_pct}%`,
        f2(r.eval_cut), f2(r.net), r.note || '']);
    }
    const afterDed = total - absent - evalCut;
    const pad = (label, ...tail) => {
      const row = new Array(14).fill('');
      row[1] = label;
      tail.forEach(([i, v]) => { row[i] = v; });
      return row;
    };
    out.push(pad('الإجمالي', [6, f2(total)], [8, f2(absent)], [11, f2(evalCut)], [12, f2(afterDed)]));
    out.push(pad('ضريبة القيمة المضافة ١٥٪', [12, f2(vat)]));
    out.push(pad('الإجمالي شامل الضريبة', [12, f2(afterDed + vat)]));
    try {
      downloadBlob(buildXlsx(out, { sheetName: 'التكاليف التشغيلية', allText: true }),
        `التكاليف-التشغيلية-${month}.xlsx`);
    } catch (e) { toast(e.message, 'bad'); }
  };

  await draw();
  return h('div.stack',
    h('div.row.between',
      h('div', h('h3', 'التقرير الشهري للتكاليف التشغيلية'),
        h('p.small.muted', 'على كراسة المنافسة: بندًا بندًا بعدده وتكلفته، '
          + 'وما حُسم للغياب والتقييم، ثم الضريبة والصافي.')),
      h('label.field', 'الشهر', monthInput)),
    box);
}

