// التقرير الشهري للتكاليف التشغيلية — يُعرض داخل «بنود العقد والمستخلص»
// (ملاحظات ١٩٠ و١٩٥ و١٩٦)
import { h, toast, confirm, dialog, req, fmtDate } from './ui.js';
import { db } from './sb.js';
import { monthStart, thisMonth } from './pay.js';
import { buildXlsx, downloadBlob } from './xlsx.js';
import { pickColumns, narrowSheet } from './columns.js';

const VAT = 0.15;          // ضريبة القيمة المضافة كما في الكراسة

// ---------------------------------------------------------------------
// التقرير الشهري للتكاليف التشغيلية — بنودُه من كراسة المنافسة نفسها:
// فريق الإرشاد المكاني والديني بموقعيه ومواسمه، لكل بندٍ عددُه وتكلفتُه
// الشهرية للفرد. والحسم بثلاثةٍ كما نصّ العقد: غيابُ الفرد الذي لم يُغطَّ
// ببديلٍ معتمد، والغيابُ الجماعي إذا تجاوز ٤٥٪ من المطلوب تواجدُهم،
// ونسبةُ المستخلص من متوسط التقييم الشهري. والتكلفةُ اليومية قيمةُ الشهر
// على عدد الأيام التشغيلية وعدد أفراد الفريق (ملاحظتا ١٩٣ و١٩٦).
// ---------------------------------------------------------------------
const OPS_SEASON = { year: 'السنة كلها', ramadan: 'رمضان', hajj: 'موسم الحج' };
const OPS_MOSQUE = { makkah: 'المسجد الحرام', madinah: 'المسجد النبوي' };
const OPS_ROLE = { field: 'الإرشاد المكاني', answers: 'إجابة السائلين' };
const OPS_PERIOD = { day: 'اليوم كلُّه', morning: 'الفترة الصباحية',
  evening: 'الفترة المسائية', night: 'الفترة الليلية' };

export async function opsSection() {
  let month = thisMonth();
  let lastSheet = null;
  const box = h('div.stack');

  const monthInput = h('input', { type: 'month', value: month, 'aria-label': 'شهر التقرير' });
  monthInput.onchange = () => { month = monthInput.value || thisMonth(); draw(); };

  // التقريرُ موحَّدٌ لا يُفصَل، والاختيارُ عند التصدير وحده (ملاحظة ٢١٦)
  const citySel = h('select', { 'aria-label': 'نطاق التصدير' },
    h('option', { value: '' }, 'الحرمان معًا'),
    h('option', { value: 'makkah' }, 'المسجد الحرام'),
    h('option', { value: 'madinah' }, 'المسجد النبوي'));
  const fmtSel = h('select', { 'aria-label': 'صيغة التصدير' },
    h('option', { value: 'xlsx' }, 'Excel — جدول بيانات'),
    h('option', { value: 'docx' }, 'Word على كليشة الهيئة'),
    h('option', { value: 'pdf' }, 'PDF على كليشة الهيئة'));
  const expBtn = h('button.btn.sm.primary', { type: 'button' }, '⤓ تصدير التقرير');
  const exportBar = h('div.export-bar',
    h('label.field', 'الشهر', monthInput),
    h('label.field', 'النطاق', citySel),
    h('label.field', 'الصيغة', fmtSel),
    h('div.field', h('span.field-head', '\u200b'), expBtn));

  const n2 = v => Number(v || 0).toLocaleString('en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const n0 = v => String(Number(v || 0));

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

  // ---------- وقائعُ الغياب الجماعي: يومًا يومًا كما احتُسبت ----------
  const collectiveDialog = async r => {
    let rows = [];
    try { rows = await db.rpc('ops_collective', { p_month: monthStart(month), p_code: r.code }); }
    catch (e) { return toast(e.message, 'bad'); }
    rows = Array.isArray(rows) ? rows : [];
    await dialog({
      title: `الغياب الجماعي — ${r.name}`,
      body: h('div.stack',
        h('p.small.muted', 'نصُّ العقد: إذا تجاوز الغيابُ الجماعي في يومٍ واحد أو فترةٍ '
          + 'تشغيلية نسبةَ ٤٥٪ من إجمالي العناصر المطلوب تواجدها، حُسم كاملُ القيمة '
          + 'اليومية لتكلفة التشغيل لذلك اليوم، وزيدت غرامةٌ يومية ٦٠٪ من القيمة اليومية '
          + 'للفرد الواحد على عدد المتغيبين ضمن النسبة المتجاوزة.'),
        h('p.small.muted', 'والمطلوبُ تواجدُهم من الورديات المجدولة نفسها، '
          + 'ومن غُطّي ببديلٍ معتمد لا يُعدّ متغيبًا. وإذا تجاوز اليومُ كلُّه '
          + 'أُخذ مرةً واحدة فلا تُحتسب فتراتُه معه.'),
        rows.length
          ? h('div.table-wrap', h('table.responsive',
              h('thead', h('tr', ['التاريخ', 'الفترة', 'المطلوب', 'المتغيّب', 'النسبة',
                'المسموح', 'الزائد', 'القيمة اليومية', 'غرامة ٦٠٪', 'المجموع']
                .map(t => h('th', t)))),
              h('tbody', rows.map(c => h('tr',
                h('td', { 'data-label': 'التاريخ' }, fmtDate(c.on_date)),
                h('td', { 'data-label': 'الفترة' }, OPS_PERIOD[c.period] || c.period),
                h('td', { 'data-label': 'المطلوب', dir: 'ltr' }, n0(c.required)),
                h('td', { 'data-label': 'المتغيّب', dir: 'ltr' },
                  h('span.bad', n0(c.absent))),
                h('td', { 'data-label': 'النسبة', dir: 'ltr' }, `${c.pct}٪`),
                h('td', { 'data-label': 'المسموح', dir: 'ltr' }, n0(c.allowed)),
                h('td', { 'data-label': 'الزائد', dir: 'ltr' }, h('b', n0(c.excess))),
                h('td', { 'data-label': 'القيمة اليومية', dir: 'ltr' }, n2(c.day_cost)),
                h('td', { 'data-label': 'غرامة ٦٠٪', dir: 'ltr' }, n2(c.surcharge)),
                h('td', { 'data-label': 'المجموع', dir: 'ltr' },
                  h('b.bad', n2(c.total)))))),
              h('tfoot', h('tr.total-row',
                h('td', { colspan: '9' }, 'مجموع حسم الغياب الجماعي'),
                h('td', { dir: 'ltr' },
                  n2(rows.reduce((a, c) => a + Number(c.total || 0), 0)))))))
          : h('p.ok', 'لا واقعةَ غيابٍ جماعي في هذا الشهر — ولله الحمد.')),
      buttons: [{ label: 'إغلاق', value: true }]
    });
  };

  // ---------- درجاتُ الأفراد: مجموعُ أسابيعه بحدِّ مئة ----------
  const membersDialog = async r => {
    let rows = [];
    try { rows = await db.rpc('ops_eval_members', { p_month: monthStart(month), p_code: r.code }); }
    catch (e) { return toast(e.message, 'bad'); }
    rows = Array.isArray(rows) ? rows : [];
    await dialog({
      title: `درجات الأفراد — ${r.name}`,
      body: h('div.stack',
        h('p.small.muted', 'يُجمع تقييم المشرف الأسبوعي لكل فردٍ خلال أربعة أسابيع '
          + 'بحدٍّ أقصى مئة نقطة، ثم يُؤخذ متوسطُ الأفراد فتُعرف نسبةُ المستخلص. '
          + 'وهذا ما يصل من مشرفي الهيئة، والمنصة تسجّله وتحتسب المتوسط ولا تُقيّم.'),
        h('p.small.warn', 'وقاعدةُ الفرد غيرُ قاعدة الفريق: من نزلت درجتُه عن السبعين '
          + 'وُجّه إليه إنذارٌ خطي وحُسم ١٠٪ من إجمالي مستحقاته الشهرية، '
          + 'ولا يُحمَّل ذلك على بند الفريق.'),
        rows.length
          ? h('div.table-wrap', h('table.responsive',
              h('thead', h('tr', ['العضو', 'الأسابيع المسجَّلة', 'الدرجة من ١٠٠', 'ما يلزم']
                .map(t => h('th', t)))),
              h('tbody', rows.map(m => h('tr',
                h('td', { 'data-label': 'العضو' }, m.name || '—'),
                h('td', { 'data-label': 'الأسابيع المسجَّلة', dir: 'ltr' },
                  Number(m.weeks) < 4
                    ? h('span.warn', { title: 'أقلُّ من أربعة أسابيع: تُراجع '
                        + 'قبل الاحتساب فالمجموع ينقص بنقصانها' }, n0(m.weeks))
                    : n0(m.weeks)),
                h('td', { 'data-label': 'الدرجة من ١٠٠', dir: 'ltr' },
                  h('b', { class: Number(m.score) < 70 ? 'bad' : 'ok' }, n0(m.score))),
                h('td', { 'data-label': 'ما يلزم' },
                  m.warn
                    ? h('span.badge.bad', `إنذارٌ خطي وحسمُ ${m.cut_pct}٪ من مستحقاته`)
                    : h('span.muted', '—')))))))
          : h('p.muted', 'لا تقييماتَ مسجَّلة لهذا الفريق في هذا الشهر.')),
      buttons: [{ label: 'إغلاق', value: true }]
    });
  };

  // ---------- تصحيح شهرٍ بعينه ----------
  const editMonth = async r => {
    const f = {
      staff: h('input', { type: 'number', min: 0, max: 9999, value: r.staff_count,
        'aria-label': 'عدد الأفراد في الشهر' }),
      opdays: h('input', { type: 'number', min: 1, max: 31,
        value: r.is_manual ? Number(r.op_days) : '',
        placeholder: String(r.op_days), 'aria-label': 'الأيام التشغيلية' }),
      days: h('input', { type: 'number', min: 0, max: 999, step: 0.5,
        value: r.is_manual && Number(r.short_days) ? Number(r.short_days) : '',
        placeholder: 'يُحتسب من سجلّ الدوام', 'aria-label': 'التقصير بالأيام' }),
      ded: h('input', { type: 'number', min: 0, step: 0.01,
        value: r.is_manual && r.deduction != null ? Number(r.deduction) : '',
        placeholder: 'يُحتسب من الأيام', 'aria-label': 'الحسميات للغياب' }),
      coll: h('input', { type: 'number', min: 0, step: 0.01,
        value: '', placeholder: n2(r.coll_deduction),
        'aria-label': 'حسم الغياب الجماعي' }),
      note: h('input', { value: r.note || '', 'aria-label': 'سبب الحسم' })
    };
    const res = await dialog({
      title: `${r.name} — ${month}`,
      body: h('div.stack',
        h('p.small.muted', 'العدد والتكلفة من الكراسة، والتقصير يُحتسب من سجلّ الدوام. '
          + 'وما تكتبه هنا يعلو على المحتسَب، وما تتركه فارغًا يبقى محتسَبًا آليًّا — '
          + 'ويُمحى الإثباتُ كلُّه فيعود البندُ إلى المحتسَب.'),
        h('div.grid-2',
          h('label.field', 'عدد الأفراد في هذا الشهر', f.staff),
          h('label.field', 'الأيام التشغيلية',
            h('small', `المحتسَب ${r.op_days} يومًا — `
              + (r.season === 'year' ? 'أيامُ الشهر الميلادي'
                 : 'أيامُ الموسم في شهره الهجري')),
            f.opdays),
          h('label.field', 'التقصير بالأيام', f.days),
          h('label.field', 'الحسميات للغياب',
            h('small', `اتركه فارغًا ليُحتسب: قيمةُ الفرد اليومية ${n2(r.person_day)} `
              + 'في عدد أيام التقصير'),
            f.ded),
          h('label.field', 'حسم الغياب الجماعي',
            h('small', `المحتسَب ${n2(r.coll_deduction)} من ${r.coll_days} واقعة`),
            f.coll),
          h('label.field', 'سبب الحسم', f.note)),
        h('p.small.muted', `التكلفة الشهرية للفرد ${n2(r.unit_cost)}`
          + ` · القيمة اليومية للتشغيل ${n2(r.day_cost)}`
          + ` · قيمة الفرد اليومية ${n2(r.person_day)}`
          + (r.eval_avg != null ? ` · متوسط التقييم ${r.eval_avg} فنسبة المستخلص ${r.eval_pct}٪` : '')),
        Number(r.covered_days)
          ? h('p.small.muted', `ومن الغياب ${n0(r.covered_days)} يومًا غُطّي ببديلٍ معتمد `
              + `فلم يُحسم، و${n0(r.short_days)} لم يُغطَّ.`)
          : null,
        r.eval_warn
          ? h('p.small.bad', 'متوسط التقييم أقلُّ من ٧٠: نسبةُ المستخلص ٧٠٪ '
              + 'مع توجيه إنذارٍ خطي، كما نصّ العقد.') : null),
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
          operating_days: f.opdays.value === '' ? null : Number(f.opdays.value),
          short_days: f.days.value === '' ? null : Number(f.days.value),
          deduction: f.ded.value === '' ? null : Number(f.ded.value),
          collective_deduction: f.coll.value === '' ? null : Number(f.coll.value),
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
    const coll = sum('coll_deduction');
    const evalCut = sum('eval_cut');
    const afterDed = total - absent - coll - evalCut;
    const vat = afterDed * VAT;
    const shortWeeks = sum('eval_weeks_short');

    const table = h('div.table-wrap', h('table.responsive.ops-table',
      h('thead', h('tr', ['م', 'البند', 'عدد الأفراد', 'الأيام التشغيلية',
        'التكلفة الشهرية الفردية', 'التكلفة الإجمالية', 'التقصير بالأيام',
        'الحسميات للغياب', 'الغياب الجماعي', 'نسبة المستخلص', 'حسم التقييم',
        'الصافي', '']
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
        h('td', { 'data-label': 'الأيام التشغيلية', dir: 'ltr',
          title: `القيمة اليومية ${n2(r.day_cost)} · قيمة الفرد اليومية ${n2(r.person_day)}` },
          n0(r.op_days)),
        h('td', { 'data-label': 'التكلفة الشهرية الفردية', dir: 'ltr' }, n2(r.unit_cost)),
        h('td', { 'data-label': 'التكلفة الإجمالية', dir: 'ltr' }, n2(r.total_cost)),
        h('td', { 'data-label': 'التقصير بالأيام', dir: 'ltr',
          title: Number(r.covered_days)
            ? `${n0(r.absent_days)} غيابًا، غُطّي منها ${n0(r.covered_days)} ببديلٍ معتمد`
            : null },
          Number(r.short_days) ? h('span.bad', n0(r.short_days)) : '0',
          Number(r.covered_days)
            ? h('span.sub', `غُطّي ${n0(r.covered_days)} ببديل`) : null),
        h('td', { 'data-label': 'الحسميات للغياب', dir: 'ltr' },
          Number(r.deduction) ? h('span.bad', n2(r.deduction)) : n2(0)),
        h('td', { 'data-label': 'الغياب الجماعي', dir: 'ltr' },
          h('button.btn.xs', { type: 'button',
            class: Number(r.coll_deduction) ? 'danger' : '',
            'aria-label': 'وقائع الغياب الجماعي',
            title: Number(r.coll_days)
              ? `${r.coll_days} واقعة · ${r.coll_absent} متغيبًا في الزائد`
              : 'لا واقعةَ غيابٍ جماعي — اضغط للتفصيل',
            onclick: () => collectiveDialog(r) }, n2(r.coll_deduction))),
        h('td', { 'data-label': 'نسبة المستخلص', dir: 'ltr' },
          r.eval_avg == null
            ? h('span.muted', '—')
            : h('button.btn.xs', { type: 'button',
                class: r.eval_pct < 100 ? 'bad' : '',
                'aria-label': 'درجات الأفراد',
                title: `متوسط التقييم ${r.eval_avg} من ١٠٠ · ${r.eval_n} أفراد`
                  + ' — اضغط لدرجات الأفراد',
                onclick: () => membersDialog(r) }, `${r.eval_pct}٪`),
          r.eval_warn ? h('span.badge.bad', { title: 'إنذارٌ خطي كما نصّ العقد' }, 'إنذار') : null,
          Number(r.eval_below)
            ? h('span.sub', `${n0(r.eval_below)} دون السبعين`) : null,
          Number(r.eval_weeks_short)
            ? h('span.badge.warn', { title: 'أفرادٌ أقلُّ من أربعة أسابيع مسجَّلة: '
                + 'تُراجع قبل الاحتساب' }, `${n0(r.eval_weeks_short)} ناقص الأسابيع`) : null),
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
          + 'والحسم بثلاثةٍ كما نصّ العقد: غيابُ الفرد الذي لم يُغطَّ ببديلٍ معتمد، '
          + 'والغيابُ الجماعي إذا تجاوز ٤٥٪، ونسبةُ المستخلص من متوسط التقييم.'),
        addBtn),
      table,
      shortWeeks
        ? h('p.small.warn', `وفي التقييم ${n0(shortWeeks)} فردًا دون أربعة أسابيعَ مسجَّلة: `
            + 'والدرجةُ مجموعُ الأسابيع، فتنقص بنقصانها. تُراجع مع مشرفي الهيئة '
            + 'قبل اعتماد المستخلص.')
        : null,
      h('section.card.stack.ops-sum',
        line('الإجمالي', total),
        line('الحسميات للغياب', absent, 'bad'),
        line('حسم الغياب الجماعي', coll, 'bad'),
        line('حسم التقييم', evalCut, 'bad'),
        line('الإجمالي بعد الحسميات', afterDed),
        line('ضريبة القيمة المضافة ١٥٪', vat),
        line('الإجمالي شامل الضريبة', afterDed + vat, 'grand'),
        h('p.small.muted', 'ونسبة المستخلص من جدول العقد: من ٩٠ إلى ١٠٠ ← ١٠٠٪، '
          + 'ومن ٨٠ إلى ٨٩ ← ٩٠٪، ومن ٧٠ إلى ٧٩ ← ٨٠٪، وأقلُّ من ٧٠ ← ٧٠٪ مع توجيه إنذار. '
          + 'والتكلفة اليومية قيمةُ الشهر على عدد الأيام التشغيلية وعدد أفراد الفريق.')),
      );
    lastSheet = () => exportOps(rows, total, absent, coll, evalCut, vat);
  }

  const exportOps = async (rows, total, absent, coll, evalCut, vat) => {
    // النطاقُ المختار: الحرمان، أو حرمٌ بعينه ومعه ما لا موقعَ له (ملاحظة ٢١٦)
    if (citySel.value) rows = rows.filter(r => !r.mosque || r.mosque === citySel.value);
    const head = ['م', 'البند', 'الموقع', 'الموسم', 'عدد الأفراد', 'الأيام التشغيلية',
      'التكلفة الشهرية الفردية', 'القيمة اليومية للتشغيل', 'قيمة الفرد اليومية',
      'التكلفة الإجمالية', 'الغياب المسجَّل', 'المغطَّى ببديل', 'التقصير المحسوم',
      'الحسميات للغياب', 'وقائع الغياب الجماعي', 'حسم الغياب الجماعي',
      'متوسط التقييم', 'نسبة المستخلص', 'حسم التقييم', 'الصافي', 'ملاحظة'];
    const out = [head];
    const f2 = v => Number(v || 0).toFixed(2);
    for (const r of rows) {
      out.push([String(r.code), r.name, r.mosque ? OPS_MOSQUE[r.mosque] : '',
        OPS_SEASON[r.season] || '', String(r.staff_count), n0(r.op_days),
        f2(r.unit_cost), f2(r.day_cost), f2(r.person_day), f2(r.total_cost),
        n0(r.absent_days), n0(r.covered_days), n0(r.short_days), f2(r.deduction),
        n0(r.coll_days), f2(r.coll_deduction),
        r.eval_avg == null ? '' : String(r.eval_avg), `${r.eval_pct}%`,
        f2(r.eval_cut), f2(r.net), r.note || '']);
    }
    const afterDed = total - absent - coll - evalCut;
    const pad = (label, ...tail) => {
      const row = new Array(head.length).fill('');
      row[1] = label;
      tail.forEach(([i, v]) => { row[i] = v; });
      return row;
    };
    out.push(pad('الإجمالي', [9, f2(total)], [13, f2(absent)], [15, f2(coll)],
      [18, f2(evalCut)], [19, f2(afterDed)]));
    out.push(pad('ضريبة القيمة المضافة ١٥٪', [19, f2(vat)]));
    out.push(pad('الإجمالي شامل الضريبة', [19, f2(afterDed + vat)]));
    const scope = citySel.value ? OPS_MOSQUE[citySel.value] : 'الحرمان معًا';
    const label = `التكاليف التشغيلية — ${month} — ${scope}`;
    const note = `${label} · حُرِّر في ${fmtDate(new Date())}`;

    // أعمدةُ هذا الكشف واحدٌ وعشرون، ولا يُقدَّم كلُّها في كل مرة (ملاحظة ٢٤٠)
    const cols = head.map((label2, i) => ({ key: `c${i}`, label: label2 }));
    const keys = await pickColumns({ key: 'ops', title: 'أعمدة التقرير التشغيلي',
      columns: cols, required: ['c1'],
      note: 'كشفٌ طويلُ الأعمدة — اختر ما تُقدّمه إلى الهيئة.' });
    if (!keys) return;
    const sheet = narrowSheet(out, cols, keys);

    try {
      if (fmtSel.value === 'xlsx') {
        downloadBlob(buildXlsx(sheet, { sheetName: 'التكاليف التشغيلية', allText: true }), `${label}.xlsx`);
      } else {
        const { exportWord, exportPdf } = await import('./teamexport.js');
        if (fmtSel.value === 'docx') await exportWord(sheet, label, { note });
        else if (!exportPdf(sheet, label, { note })) return toast('اسمح بالنوافذ المنبثقة.', 'bad');
      }
      toast('جرى التصدير.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  };

  expBtn.onclick = () => { if (lastSheet) lastSheet(); };

  await draw();
  return h('div.stack',
    h('div', h('h3', 'التقرير الشهري للتكاليف التشغيلية'),
      h('p.small.muted', 'على كراسة المنافسة: بندًا بندًا بعدده وتكلفته وأيامه التشغيلية، '
        + 'وما حُسم للغياب وللغياب الجماعي وللتقييم، ثم الضريبة والصافي.')),
    exportBar,
    box);
}
