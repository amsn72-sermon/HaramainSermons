// صفحةُ البديل: يفتحها برابطه السرِّيِّ من جوّاله (ملاحظة ١١ من دفعة ٥٠٢)
//
//   لا تُفتَح إلّا بالرمز، ومدّتُها أسبوعان، وتبطل بتمام التسجيل. ولا
//   يُطلَب منه في الرابط شيءٌ من بياناته: يُنشئ حسابَه كما يُنشئه غيرُه،
//   ثمَّ يعود إلى الرابط نفسِه فيُربَط بالدعوة، ثمَّ يُكمِل بياناته في
//   شاشته ويوقِّع الميثاق.
import { h, fill, toast, busy, fmtDate, fmtDateTime } from '../ui.js';
import { db, auth } from '../sb.js';
import { brand, footer } from './shell.js';

const TRACK = { translation: 'مترجمٌ متخصص', field: 'مرشدٌ مكاني', answers: 'مجيبٌ عن الأسئلة' };
const CITY = { makkah: 'مكة المكرمة', madinah: 'المدينة المنورة' };

const WHY = {
  notfound: 'لا دعوةَ بهذا الرابط. تأكَّدْ من نسخه كاملًا كما وصلك.',
  used: 'هذه الدعوةُ استُعملت وتمَّ التسجيلُ بها، فلا تُفتَح مرّةً أخرى.',
  expired: 'انتهت مدّةُ هذه الدعوة. راجعْ من أرسلها إليك ليُجدِّدها.',
  taken: 'ارتبط بهذه الدعوة حسابٌ آخر.'
};

export async function render(ctx) {
  const q = ctx?.query || new URLSearchParams(location.search);
  const token = (q.get('t') || '').trim();
  const out = h('div.stack');

  const paint = async () => {
    if (!token) {
      fill(out, h('p.bad', 'لا رمزَ في الرابط. افتحْه كما وصلك في رسالتك.'));
      return;
    }
    fill(out, h('p.muted', 'تُفتَح الدعوة…'));
    let v = null;
    try {
      const r = await db.rpc('sub_invite_open', { p_token: token });
      v = Array.isArray(r) ? r[0] : r;
    } catch (e) { fill(out, h('p.bad', e.message)); return; }

    if (!v || !v.ok) {
      fill(out, h('div.card.stack', h('p.bad', WHY[v?.why] || WHY.notfound)));
      return;
    }

    const facts = h('div.card.stack',
      h('h2', `أهلًا ${v.name || ''}`),
      h('p', 'أنت بديلٌ عن ', h('b', v.of_whom || '—'),
        ' في مشروع خادم الحرمين الشريفين لترجمة خطب الحرمين.'),
      h('dl.verify-grid',
        h('dt', 'المدّة'), h('dd', `${fmtDate(v.from)} — ${fmtDate(v.to)}`),
        h('dt', 'العمل'), h('dd', TRACK[v.track] || v.track || '—'),
        v.city ? h('dt', 'المدينة') : null, v.city ? h('dd', CITY[v.city] || v.city) : null,
        h('dt', 'مدّةُ الرابط'), h('dd', `حتى ${fmtDateTime(v.expires_at)}`)),
      h('p.small.muted', 'هذا الرابطُ خاصٌّ بك وحدَك، لا تُرسِلْه إلى غيرك.'));

    // إن كان داخلًا رُبط فورًا، وإلّا دُلَّ على إنشاء حسابه ثمَّ العودة
    if (auth.session) {
      const go = h('button.btn.primary', { type: 'button' }, 'اربطْ حسابي بهذه الدعوة');
      go.onclick = () => busy(go, async () => {
        try {
          const r = await db.rpc('sub_invite_claim', { p_token: token });
          const o = Array.isArray(r) ? r[0] : r;
          if (!o || !o.ok) { toast(WHY[o?.why] || 'تعذَّر الربط.', 'bad'); return; }
          fill(out, facts, h('div.card.stack',
            h('h3', 'تمَّ الربط'),
            h('p', 'بقي شيئان: إكمالُ بياناتك، وتوقيعُ ميثاق العمل.'),
            h('div.row.wrap',
              h('a.btn.primary', { href: '/app/me' }, 'أكمِلْ بياناتي'),
              h('a.btn', { href: '/app/charter' }, 'ميثاقُ العمل'))));
        } catch (e) { toast(e.message, 'bad'); }
      });
      fill(out, facts, h('div.card.stack',
        h('p', 'أنت داخلٌ إلى المنصة. اضغطْ ليُربَط حسابُك بهذه الدعوة.'), go));
      return;
    }

    fill(out, facts, h('div.card.stack',
      h('h3', 'الخطوةُ الأولى: أنشئْ حسابك'),
      h('p.small.muted', 'أنشئ حسابَك في المنصة بالبريد وكلمة المرور، ثمَّ افتحْ '
        + 'هذا الرابطَ نفسَه مرّةً أخرى من رسالتك فيُربَط حسابُك بالدعوة تلقائيًّا.'),
      h('div.row.wrap',
        h('a.btn.primary', { href: '/register' }, 'إنشاءُ حساب'),
        h('a.btn', { href: '/login' }, 'لي حسابٌ — دخول'))));
  };

  paint();

  return h('div.public',
    brand(),
    h('div.page-head', h('div.grow',
      h('div.eyebrow', 'دعوةُ بديل'),
      h('h1', 'إكمالُ بيانات البديل'))),
    out,
    footer());
}
