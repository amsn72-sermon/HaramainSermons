// «حضوري»: يسجّل العضو حضورَه وانصرافه من متصفح جواله، والحسابُ في
// قاعدة البيانات لا في الجهاز — تُقاس المسافةُ إلى موقعه المسنَد فتُقبل
// أو تُردّ، وتُسجَّل معها دقّةُ الإشارة (ملاحظة ٢١٩).
import { h, toast, busy, fmtDateTime } from '../ui.js';
import { db } from '../sb.js';
import { myPosition, miniMap } from '../map.js';

export async function render() {
  const box = h('div.stack');
  const inBtn = h('button.btn.primary.enter-btn', { type: 'button' }, '📍 سجّل حضوري');
  const outBtn = h('button.btn', { type: 'button' }, 'سجّل انصرافي');
  const status = h('p.small.muted');

  let today = {};
  let pres = {};
  const load = async () => {
    try {
      const [a, b2] = await Promise.all([
        db.rpc('my_attendance_today'),
        db.rpc('my_shift_presence').catch(() => null)
      ]);
      today = (Array.isArray(a) ? a[0] : a) || {};
      pres = (Array.isArray(b2) ? b2[0] : b2) || {};
    } catch { today = {}; pres = {}; }
    draw();
    syncPing();
  };

  // ـــ نبضُ الموقع ما دامت الصفحةُ مفتوحة (ملاحظة ٣٧٥)
  //
  //   صفحةُ الوِب لا تقرأ الموقعَ والمتصفِّحُ مغلق — لا حيلةَ في ذلك.
  //   فالقاعدةُ مقلوبة: لا يُحتسَب إلا الوقتُ الموصولُ بنبض، والفجوةُ
  //   تُطرَح وتُبيَّن. فإن غادر وأغلق المتصفِّحَ انقطع النبضُ، فلم
  //   يُحتسَب له ما بعده ولو ضغط الانصرافَ بعد ساعات.
  let timer = null;
  let pinging = false;
  const pingLine = h('p.small.muted');
  const askBtn = h('button.btn.sm.primary', { type: 'button', hidden: true },
    '✋ أكِّدْ وجودك');

  const sendPing = async () => {
    if (pinging || document.hidden) return;
    pinging = true;
    try {
      const pos = await myPosition({ timeout: 12000 });
      const r = await db.rpc('geo_ping',
        { p_lat: pos.lat, p_lng: pos.lng, p_acc: Math.round(pos.acc || 0) });
      const d = (Array.isArray(r) ? r[0] : r) || {};
      if (d.ok === false) { stopPing(); return; }
      pres = { ...pres, verified_minutes: d.verified_minutes, gap_minutes: d.gap_minutes };
      askBtn.hidden = !d.challenge;
      pingLine.textContent = d.inside
        ? `مُتحقَّقٌ منه: ${hrs(d.verified_minutes)}`
          + (Number(d.gap_minutes) ? ` · غيرُ مُتحقَّقٍ منه: ${hrs(d.gap_minutes)}` : '')
        : `أنت خارج النطاق الآن (${d.distance_m} مترًا) — هذا الوقتُ لا يُحتسَب.`;
    } catch (e) {
      pingLine.textContent = `انقطع نبضُ الموقع: ${e.message}`;
    } finally { pinging = false; }
  };

  const stopPing = () => { if (timer) { clearInterval(timer); timer = null; } };

  function syncPing() {
    const open = today.check_in_at && !today.check_out_at;
    if (!open) { stopPing(); askBtn.hidden = true; return; }
    if (timer) return;
    const every = Math.max(2, Number(pres.every_min || 5)) * 60 * 1000;
    sendPing();
    timer = setInterval(sendPing, every);
  }
  askBtn.onclick = () => busy(askBtn, async () => {
    try {
      await db.rpc('answer_challenge');
      askBtn.hidden = true;
      toast('شُكرًا — سُجِّل ردُّك.', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  });
  // الصفحةُ إذا غادرت شجرةَ المستند انقطع النبضُ، فلا يبقى مؤقِّتٌ معلَّق
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sendPing();
  });

  const mark = (out) => busy(out ? outBtn : inBtn, async () => {
    status.textContent = 'جارٍ أخذ موضعك من المتصفح…';
    try {
      const pos = await myPosition();
      const r = await db.rpc('geo_check_in',
        { p_lat: pos.lat, p_lng: pos.lng, p_acc: Math.round(pos.acc || 0), p_out: !!out });
      const d = (Array.isArray(r) ? r[0] : r) || {};
      toast(out
        ? (d.out_unverified ? 'سُجّل انصرافك — موسومًا لانقطاع نبض الموقع.' : 'سُجّل انصرافك.')
        : 'سُجّل حضورك.', d.out_unverified || d.out_outside ? 'warn' : 'ok');
      status.textContent = `${d.site || ''} — على بُعد ${d.distance_m} مترًا من ${d.radius_m} مترًا.`
        + (d.out_outside ? ' (خارج النطاق — مُوسَم)' : '');
      await load();
    } catch (err) {
      status.textContent = '';
      toast(err.message, 'bad');
    }
  });
  inBtn.onclick = () => mark(false);
  outBtn.onclick = () => mark(true);

  // ساعاتٌ ودقائقُ بعبارةٍ عربيةٍ مختصرة
  const hrs = min => {
    const m = Math.max(0, Math.round(Number(min) || 0));
    const H = Math.floor(m / 60), M = m % 60;
    if (!H) return `${M} دقيقة`;
    return M ? `${H} ساعة و${M} دقيقة` : `${H} ساعة`;
  };

  function draw() {
    const site = today.site || null;
    const inAt = today.check_in_at, outAt = today.check_out_at;
    const map = site && today.lat != null
      ? miniMap({ lat: Number(today.lat), lng: Number(today.lng),
                  radius: Number(today.radius_m || 300), height: 220 })
      : null;

    box.replaceChildren(
      h('section.card.stack',
        h('h3', 'موقعك اليوم'),
        site
          ? h('p', 'يُقاس حضورُك على ', h('b', site), ' في نطاق ',
              h('b', String(today.radius_m)), ' مترًا.')
          : h('p.small.warn', 'لم يُحدَّد لك موقعٌ بعد — راجع قائد فريقك أو الإدارة.'),
        map ? map.el : null,
        h('p.small.muted', 'اخرج إلى مكانٍ مكشوفٍ قليلًا إن ضعفت الإشارة داخل المبنى، '
          + 'فالسقفُ يحجب الأقمار فتقلّ الدقّة.')),

      // الوردةُ المقرَّرة هي المرجع: تُعرض كما هي، ويُعلَن التأخيرُ،
      // والمتبقّي إلى نهايتها لا ثماني ساعاتٍ من البصمة (ملاحظة ٢٦٤)
      h('section.card.stack',
        h('h3', 'ورديتك اليوم'),
        today.scheduled === false
          ? h('p.small.warn', 'لم تُحدَّد لك وردةٌ اليوم، وما سجّلتَه بصمةٌ خارج الجدول.')
          : today.shift_start
            ? h('div.stack',
                h('p', 'من ', h('b', String(today.shift_start).slice(0, 5)),
                  ' إلى ', h('b', String(today.shift_end).slice(0, 5)),
                  today.flex ? h('span.badge', { style: { marginInlineStart: '8px' } }, 'دوامٌ مرن') : null),
                Number(today.late_minutes) > 0
                  ? h('p.small.warn', `حضرتَ متأخّرًا ${hrs(today.late_minutes)}.`) : null,
                inAt && !outAt && today.left_minutes != null
                  ? h('p.small.muted', Number(today.left_minutes) > 0
                      ? `بقي من وردتك ${hrs(today.left_minutes)}.`
                      : 'انتهى وقتُ وردتك.') : null,
                Number(today.early_minutes) > 0
                  ? h('p.small.warn', `انصرفتَ قبل نهاية الوردة بـ ${hrs(today.early_minutes)}.`) : null,
                today.worked_minutes != null
                  ? h('p.small.muted', `ما احتُسب لك من عمل: ${hrs(today.worked_minutes)}.`) : null,
                // ما تُحقِّق منه بالنبض، وما لم يُتحقَّق (ملاحظة ٣٧٥)
                pres.verified_minutes != null
                  ? h('p.small.muted', `مُتحقَّقٌ منه بالموقع: ${hrs(pres.verified_minutes)}.`)
                  : null,
                Number(pres.gap_minutes) > 0
                  ? h('p.small.warn', `غيرُ مُتحقَّقٍ منه: ${hrs(pres.gap_minutes)} — `
                      + 'وقتٌ لم يصل فيه نبضُ موقعك، فلا يُحتسَب.')
                  : null,
                pres.out_unverified
                  ? h('p.small.bad', 'انصرافٌ غيرُ مُتحقَّق: لم يصل نبضُ موقعك قبله بوقتٍ '
                      + 'قريب، فقد رُفع للمشرف.')
                  : null,
                pres.out_outside
                  ? h('p.small.bad', 'انصرافٌ من خارج الموقع — مُوسَمٌ للمراجعة.')
                  : null,
                today.status === 'absent' || pres.status === 'absent'
                  ? h('p.small.bad', 'انقضت فترةُ وردتك ولم يُسجَّل فيها حضور، فكُتبت غيابًا.')
                  : null)
            : h('p.muted', 'لا وردةَ مجدولةٌ لك اليوم.')),

      h('section.card.stack',
        h('h3', 'التسجيل'),
        inAt
          ? h('div.policy-state.signed', h('span.tick', { 'aria-hidden': 'true' }, '✓'),
              `سجّلتَ حضورك في ${fmtDateTime(inAt)}`
              + (today.in_dist_m != null ? ` — على بُعد ${today.in_dist_m} مترًا` : ''))
          : h('p.muted', 'لم تسجّل حضورك اليوم.'),
        outAt ? h('p.small.muted', `وانصرافك في ${fmtDateTime(outAt)}`) : null,
        h('div.row', inAt ? null : inBtn, inAt && !outAt ? outBtn : null, askBtn),
        status,
        inAt && !outAt ? pingLine : null,
        inAt && !outAt
          ? h('p.small.muted', `يُقرأ موقعُك كلَّ ${pres.every_min || 5} دقائق ما دامت هذه `
              + 'الصفحةُ مفتوحة، فيُبنى منه المُتحقَّقُ منه. وإن أُغلقت انقطع النبضُ ولم '
              + 'يُحتسَب ما بعده.')
          : null,
        h('p.small.muted', 'والانصرافُ يحتاج قراءةَ موقعٍ جديدةً لا مخزَّنة: إن رُفض الإذنُ '
          + 'أو تعذَّرت القراءةُ لم يُسجَّل.'),
        h('p.small.muted', 'يُطلب منك إذنُ الموقع مرةً واحدة. وإن رفضتَه فافتحه من إعدادات '
          + 'المتصفح لهذا الموقع ثم أعد المحاولة.')));
  }

  // الوردةُ التي انقضت فترتُها بلا حضورٍ تُكتب غيابًا (ملاحظة ٣٧٤)
  try { await db.rpc('sweep_absent_shifts', { p_date: null }); } catch { /* حسابيٌّ لا يُعيق */ }
  await load();

  return h('div',
    h('div.page-head',
      h('div.grow', h('div.eyebrow', 'الحضور'), h('h1', 'حضوري'),
        h('p.muted', 'تسجيلُ الحضور والانصراف بموقعك من المتصفح، بلا تطبيقٍ ولا متجر.'))),
    box);
}
