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
  const load = async () => {
    try {
      const r = await db.rpc('my_attendance_today');
      today = (Array.isArray(r) ? r[0] : r) || {};
    } catch { today = {}; }
    draw();
  };

  const mark = (out) => busy(out ? outBtn : inBtn, async () => {
    status.textContent = 'جارٍ أخذ موضعك من المتصفح…';
    try {
      const pos = await myPosition();
      const r = await db.rpc('geo_check_in',
        { p_lat: pos.lat, p_lng: pos.lng, p_acc: Math.round(pos.acc || 0), p_out: !!out });
      const d = (Array.isArray(r) ? r[0] : r) || {};
      toast(out ? 'سُجّل انصرافك.' : 'سُجّل حضورك.', 'ok');
      status.textContent = `${d.site || ''} — على بُعد ${d.distance_m} مترًا من ${d.radius_m} مترًا.`;
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
                  ? h('p.small.muted', `ما احتُسب لك من عمل: ${hrs(today.worked_minutes)}.`) : null)
            : h('p.muted', 'لا وردةَ مجدولةٌ لك اليوم.')),

      h('section.card.stack',
        h('h3', 'التسجيل'),
        inAt
          ? h('div.policy-state.signed', h('span.tick', { 'aria-hidden': 'true' }, '✓'),
              `سجّلتَ حضورك في ${fmtDateTime(inAt)}`
              + (today.in_dist_m != null ? ` — على بُعد ${today.in_dist_m} مترًا` : ''))
          : h('p.muted', 'لم تسجّل حضورك اليوم.'),
        outAt ? h('p.small.muted', `وانصرافك في ${fmtDateTime(outAt)}`) : null,
        h('div.row', inAt ? null : inBtn, inAt && !outAt ? outBtn : null),
        status,
        h('p.small.muted', 'يُطلب منك إذنُ الموقع مرةً واحدة. وإن رفضتَه فافتحه من إعدادات '
          + 'المتصفح لهذا الموقع ثم أعد المحاولة.')));
  }

  await load();

  return h('div',
    h('div.page-head',
      h('div.grow', h('div.eyebrow', 'الحضور'), h('h1', 'حضوري'),
        h('p.muted', 'تسجيلُ الحضور والانصراف بموقعك من المتصفح، بلا تطبيقٍ ولا متجر.'))),
    box);
}
