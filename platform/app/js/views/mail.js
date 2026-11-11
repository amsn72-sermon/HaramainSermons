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
const AUDIENCE = [
  ['all', 'الفريقُ كلُّه'],
  ['translators', 'المترجمون المتخصصون'],
  ['field', 'المرشدون المكانيون'],
  ['answers', 'المجيبون عن الأسئلة'],
  ['admins', 'الحساباتُ الإدارية'],
  ['city', 'مدينةٌ بعينها'],
  ['nodata', 'من نقصت بياناتُه'],
  ['unsigned', 'من لم يوقِّع الميثاق']
];

export async function render() {
  if (!can('circulars')) {
    return h('div.card', h('p.bad', 'هذا البابُ لمن يملك مفتاحَ المراسلات.'));
  }

  const subject = h('input', { maxlength: 200, placeholder: 'موضوعُ الرسالة',
    'aria-label': 'موضوع الرسالة' });
  const body = h('textarea', { rows: 10, placeholder: 'نصُّ الرسالة…',
    'aria-label': 'نص الرسالة' });
  const audience = h('select', { 'aria-label': 'المخاطَبون' },
    AUDIENCE.map(([v, t]) => h('option', { value: v }, t)));
  const city = h('select', { 'aria-label': 'المدينة' },
    h('option', { value: 'makkah' }, 'مكة المكرمة'),
    h('option', { value: 'madinah' }, 'المدينة المنورة'));
  const cityBox = h('label.field.tight', { hidden: true }, 'المدينة', city);
  const who = h('div.stack');
  const logBox = h('div.stack');
  let people = [];

  const loadWho = async () => {
    fill(who, h('p.small.muted', 'يُحصَى المخاطَبون…'));
    try {
      const r = await db.rpc('mail_audience', {
        p_audience: audience.value,
        p_city: audience.value === 'city' ? city.value : null
      });
      people = Array.isArray(r) ? r : [];
      fill(who,
        h('p.small', h('b', `${AR(people.length)} مخاطَبًا`),
          people.length ? '' : ' — لا أحدَ بهذا الاختيار'),
        people.length
          ? h('details.cd-more', h('summary', 'أسماءُ المخاطَبين'),
              h('ul.small.muted', people.slice(0, 400).map(p =>
                h('li', `${p.full_name} — ${p.email}`))))
          : null);
    } catch (e) { fill(who, h('p.bad', e.message)); }
  };
  audience.onchange = () => {
    cityBox.hidden = audience.value !== 'city';
    loadWho();
  };
  city.onchange = loadWho;

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
    const ok = await dialog({
      title: 'تأكيدُ الإرسال',
      body: h('div.stack',
        h('p', `تُرسَل «${sub}» إلى ${AR(people.length)} مخاطَبًا.`),
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
          p_audience: audience.value,
          p_city: audience.value === 'city' ? city.value : null,
          p_members: null
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
        h('label.field.tight', 'المخاطَبون', audience), cityBox),
      who,
      h('label.field', 'الموضوع', subject),
      h('label.field', 'النص', body),
      h('p.small.muted', 'يُكتَب النصُّ مجرَّدًا؛ والسطرُ الفارغُ يفصل فقرةً عن فقرة. '
        + 'ويُلبِسه الخادمُ ترويسةَ الهيئة وذيلَها عند الإرسال.'),
      h('div.row.wrap', previewBtn, sendBtn)),
    h('div.card.stack', h('h3', 'آخرُ ما أُرسل'), logBox));
}
