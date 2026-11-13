// بابُ البريد: رسالةٌ تُكتَب وتُعايَن ثم تُرسَل إلى من يُختار (ملاحظة ٥٠١)
//
//   التعاميمُ الرسميّةُ بابُها «المراسلات» في المنصة: تُقرأ ويُوقَّع
//   عليها بالعلم ويُحفَظ إثباتُه. وهذا بابٌ آخرُ لِما يُرسَل إلى بريد
//   العضو نفسِه: تذكيرٌ باستكمال بيانٍ، أو إخبارٌ عامّ. يُكتَب نصًّا
//   مجرَّدًا، فيُلبِسه الخادمُ هويّةَ المشروع، ويذهب بنسختين: منسَّقةٍ
//   لمن يقبلها، ومجرَّدةٍ لمن لا يقبلها.
import { h, fill, toast, busy, dialog, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { can } from '../store.js';
import { mailBody, mailFrame } from '../mailtpl.js';

const AR = n => Number(n || 0).toLocaleString('ar-SA-u-nu-latn');
const CITY = { makkah: 'مكة المكرمة', madinah: 'المدينة المنورة' };
// المحورُ الأول: الفئة. والمدينةُ محورٌ ثانٍ يُضيِّقها ولا يُبدِّلها
//   (ملاحظة ٥ من دفعة ٥٠٢)
const AUDIENCE = [
  ['all', 'الفريقُ كلُّه'],
  ['translators', 'المترجمون المتخصصون'],
  ['field', 'المرشدون المكانيون'],
  ['answers', 'المجيبون عن الأسئلة'],
  ['admins', 'الحساباتُ الإدارية'],
  ['nodata', 'من نقصت بياناتُه'],
  ['unsigned', 'من لم يوقِّع الميثاق']
];
const CITIES = [
  ['', 'المدنُ كلُّها'],
  ['makkah', 'مكة المكرمة'],
  ['madinah', 'المدينة المنورة'],
  ['none', 'بلا مدينةٍ مسجَّلة']
];

export async function render() {
  if (!can('circulars')) {
    return h('div.card', h('p.bad', 'هذا البابُ لمن يملك مفتاحَ المراسلات.'));
  }

  const subject = h('input', { maxlength: 200, placeholder: 'موضوعُ الرسالة',
    'aria-label': 'موضوع الرسالة' });
  const body = h('textarea', { rows: 10, placeholder: 'نصُّ الرسالة…',
    'aria-label': 'نص الرسالة' });
  const audience = h('select', { 'aria-label': 'الفئة' },
    AUDIENCE.map(([v, t]) => h('option', { value: v }, t)));
  const city = h('select', { 'aria-label': 'المدينة' },
    CITIES.map(([v, t]) => h('option', { value: v }, t)));
  const cityBox = h('label.field.tight', 'المدينة', city);
  const who = h('div.stack');
  const logBox = h('div.stack');
  let people = [];
  // ـــ انتقاءُ أفرادٍ بأعيانهم فوق المحورين: إن لم يُنتقَ أحدٌ ذهبت
  //   الرسالةُ إلى المعروضين كلِّهم، وإن انتُقي واحدٌ فأكثرُ خُصَّ بها
  const chosen = new Set();
  const q = h('input', { type: 'search', placeholder: 'ابحثْ باسمٍ أو بريد',
    'aria-label': 'البحث عن عضو' });

  // المعروضون بعد المحورين والبحث
  const shown = () => {
    const k = q.value.trim().toLowerCase();
    return !k ? people : people.filter(p =>
      String(p.full_name || '').toLowerCase().includes(k)
      || String(p.email || '').toLowerCase().includes(k));
  };

  const paintWho = () => {
    const list = shown();
    const picked = people.filter(p => chosen.has(p.id));
    const target = picked.length || list.length;
    fill(who,
      h('p.small',
        h('b', `${AR(target)} مخاطَبًا`),
        picked.length ? ' — منتقَون بأعيانهم'
          : people.length ? '' : ' — لا أحدَ بهذا الاختيار'),
      people.length ? h('div.row.wrap', { style: { gap: '6px', margin: '6px 0' } },
        h('button.btn.xs', { type: 'button',
          onclick: () => { shown().forEach(p => chosen.add(p.id)); paintWho(); } },
          'انتقِ المعروض'),
        h('button.btn.xs.ghost', { type: 'button',
          onclick: () => { chosen.clear(); paintWho(); } },
          'ألغِ الانتقاء — والرسالةُ للجميع')) : null,
      people.length ? h('div.pick-list', list.slice(0, 400).map(p => {
        const on = h('input', { type: 'checkbox', checked: chosen.has(p.id),
          'aria-label': p.full_name });
        on.onchange = () => { on.checked ? chosen.add(p.id) : chosen.delete(p.id); paintWho(); };
        return h('label.check.pick-row', on,
          h('span', p.full_name,
            h('span.small.muted', ` · ${p.email}`
              + (p.city ? ` · ${CITY[p.city] || p.city}` : ''))));
      })) : null);
  };

  const loadWho = async () => {
    fill(who, h('p.small.muted', 'يُحصَى المخاطَبون…'));
    try {
      const r = await db.rpc('mail_audience', {
        p_audience: audience.value, p_city: city.value || null
      });
      people = Array.isArray(r) ? r : [];
      // وتبديلُ المحورين يُفرِّغ الانتقاءَ، فلا تذهب رسالةٌ إلى من خرج منه
      chosen.clear();
      paintWho();
    } catch (e) { fill(who, h('p.bad', e.message)); }
  };
  audience.onchange = loadWho;
  city.onchange = loadWho;
  q.oninput = paintWho;

  // ـــ المعاينة: الرسالةُ كما تصل، في إطارٍ معزول
  const preview = () => {
    if (!body.value.trim()) { toast('اكتبْ نصَّ الرسالة أولًا.', 'warn'); return; }
    const name = people[0]?.full_name || 'عضوُ الفريق';
    const frame = h('iframe', { title: 'معاينةُ الرسالة',
      style: { width: '100%', height: '60vh', border: '1px solid var(--border)',
        borderRadius: '10px', background: '#fff' },
      srcdoc: mailFrame(name, subject.value.trim() || 'رسالةٌ من المنصة',
        mailBody(body.value)) });
    dialog({
      title: 'معاينةُ الرسالة',
      body: h('div.stack',
        h('p.small.muted', 'هكذا تصل إلى من يقبل التنسيق. ومن لا يقبله '
          + 'يصله النصُّ المجرَّدُ نفسُه.'),
        frame),
      buttons: [{ label: 'إغلاق', value: null }]
    });
  };

  const send = async btn => {
    const sub = subject.value.trim();
    const txt = body.value.trim();
    if (!sub || !txt) { toast('الموضوعُ والنصُّ لا يُتركان.', 'warn'); return; }
    if (!people.length) { toast('لا مخاطَبين بهذا الاختيار.', 'warn'); return; }
    const picked = people.filter(p => chosen.has(p.id));
    const n0 = picked.length || people.length;
    const ok = await dialog({
      title: 'تأكيدُ الإرسال',
      body: h('div.stack',
        h('p', `تُرسَل «${sub}» إلى ${AR(n0)} مخاطَبًا`
          + (picked.length
            ? (picked.length === 1 ? `: ${picked[0].full_name}.` : ' منتقَين بأعيانهم.')
            : '.')),
        h('p.small.muted', 'ويخرج البريدُ من الخادم في دقيقته، '
          + 'ويُسجَّل ما وصل وما تعثَّر.')),
      buttons: [{ label: 'أرسِلْ', kind: 'primary', value: true },
        { label: 'إلغاء', value: null }]
    });
    if (!ok) return;
    await busy(btn, async () => {
      try {
        const n = await db.rpc('send_mail', {
          p_subject: sub, p_body: txt, p_html: mailBody(txt),
          p_audience: audience.value, p_city: city.value || null,
          p_members: picked.length ? picked.map(p => p.id) : null
        });
        toast(`أُضيفت الرسالةُ إلى الطابور لـ${AR(n)} مخاطَبًا.`, 'ok');
        subject.value = ''; body.value = '';
        loadLog();
      } catch (e) { toast(e.message, 'bad'); }
    });
  };

  const loadLog = async () => {
    try {
      const r = await db.rpc('mail_log', { p_limit: 30 });
      const rows = Array.isArray(r) ? r : [];
      fill(logBox, rows.length
        ? h('div.table-wrap', h('table.responsive',
            h('thead', h('tr', ['الموضوع', 'العدد', 'وصلت', 'تعثَّرت', 'الوقت']
              .map(t => h('th', t)))),
            h('tbody', rows.map(x => h('tr',
              h('td', { 'data-label': 'الموضوع' }, x.subject),
              h('td', { 'data-label': 'العدد' }, AR(x.n)),
              h('td', { 'data-label': 'وصلت' }, AR(x.sent)),
              h('td', { 'data-label': 'تعثَّرت' }, Number(x.failed)
                ? h('span.badge.bad', AR(x.failed)) : AR(0)),
              h('td', { 'data-label': 'الوقت' }, fmtDateTime(x.at)))))))
        : h('p.small.muted', 'لم يُرسَل شيءٌ بعد.'));
    } catch (e) { fill(logBox, h('p.bad', e.message)); }
  };

  const previewBtn = h('button.btn.sm', { type: 'button', onclick: preview },
    '👁 معاينةُ الرسالة');
  const sendBtn = h('button.btn.primary', { type: 'button' }, '✉ أرسِلْ');
  sendBtn.onclick = e => send(e.currentTarget);

  loadWho();
  loadLog();

  return h('div',
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'المراسلات'),
      h('h1', 'بريدُ المشروع'),
      h('p.muted', 'رسالةٌ تُكتَب نصًّا، تخرج بهويّة المشروع إلى بريد من تختاره. '
        + 'وما يُوقَّع عليه بالعلم فبابُه «التعاميم».'))),
    h('div.card.stack',
      h('div.row.wrap',
        h('label.field.tight', 'الفئة', audience), cityBox,
        h('label.field.tight', 'بحثٌ بالاسم', q)),
      h('p.small.muted', 'الفئةُ والمدينةُ معًا، ثمَّ انتقِ أفرادًا بأعيانهم إن شئت '
        + '— وإن لم تنتقِ أحدًا ذهبت الرسالةُ إلى المعروضين كلِّهم.'),
      who,
      h('label.field', 'الموضوع', subject),
      h('label.field', 'النص', body),
      h('p.small.muted', 'يُكتَب النصُّ مجرَّدًا؛ والسطرُ الفارغُ يفصل فقرةً عن فقرة. '
        + 'ويُلبِسه الخادمُ ترويسةَ الهيئة وذيلَها عند الإرسال.'),
      h('div.row.wrap', previewBtn, sendBtn)),
    h('div.card.stack', h('h3', 'آخرُ ما أُرسل'), logBox));
}
