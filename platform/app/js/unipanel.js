// لوحةُ إعداداتٍ واحدةٌ ثابتةُ الأبعاد لكلِّ المصمِّمات (ملاحظات ٤٠٠ و٤٠١ و٤١٠)
//
//   ثلاثةُ أقسامٍ بعرضٍ واحد: اللوحةُ كبيرةً أعلى، فشريطُ القوائم موزَّعًا
//   بعرضها، فإطارُ الإعدادات. والإطارُ لا يتمدَّد ولا ينكمش باختلاف
//   القائمة: ارتفاعُه ثابتٌ ومحتواه يُمرَّر داخلَه، فلا تهتزُّ الواجهة.
import { h, fill } from './ui.js';

// tabs: [{ key, icon, label, hint, make() }]
// stage: عنصرُ اللوحة (الشهادةُ أو البطاقةُ أو الصفحة)
// height: ارتفاعُ الإطار بالبكسل على الحاسب
export function unifiedPanel({ stage, tabs, height = 420, onTab = null, measure = null }) {
  const bar = h('div.uni-bar', { role: 'tablist' });
  const head = h('div.uni-head');
  const body = h('div.uni-body');
  const foot = h('div.uni-foot');
  const panel = h('div.uni-panel', head, body, foot);
  // المتغيّرُ المخصَّصُ يُضبَط بعد البناء، فهو لا يمرُّ عبر style العادي
  panel.style.setProperty('--uni-h', `${height}px`);
  // بلا لوحةٍ: الإطارُ وحدَه في عمودٍ قائم (ملاحظة ٤١٠)
  const stageBox = stage ? h('div.uni-stage', stage) : null;
  const wrap = h('div.uni-wrap' + (stage ? '' : '.bare'),
    ...(stageBox ? [stageBox] : []), bar, panel);

  let active = null;
  const btns = new Map();

  function show(key, { focus = false } = {}) {
    const t = tabs.find(x => x.key === key) || tabs[0];
    if (!t) return;
    active = t.key;
    for (const [k, b] of btns) {
      const on = k === t.key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    fill(head, h('b', t.label), t.hint ? h('span.small.muted', t.hint) : null);
    const made = t.make();
    fill(body, made || null);
    // التمريرُ الداخليُّ يعود إلى أوّل القائمة الجديدة، وموضعُ الصفحة
    //   لا يتحرَّك (ملاحظة ٤٠٠)
    body.scrollTop = 0;
    if (focus) {
      const first = body.querySelector('input, select, textarea, button');
      if (first) first.focus({ preventScroll: true });
    }
    if (onTab) onTab(t.key);
  }

  fill(bar, ...tabs.map(t => {
    const b = h('button.uni-tool', { type: 'button', role: 'tab',
      'aria-selected': 'false', 'aria-label': t.label, title: t.hint || t.label },
      h('i.uni-tool-icon', { 'aria-hidden': 'true' }, t.icon || '▦'),
      h('b', t.label));
    b.onclick = () => show(t.key, { focus: true });
    btns.set(t.key, b);
    return b;
  }));

  // عرضُ الشريط والإطار كعرض اللوحة بالضبط (ملاحظة ٤٠٠)
  const sync = () => {
    const el = measure || stage;
    if (!el) return;
    const w = Math.round(el.getBoundingClientRect().width);
    if (w > 40) wrap.style.setProperty('--uni-w', `${w}px`);
  };
  if (typeof ResizeObserver === 'function') {
    if (measure || stage) {
      try { new ResizeObserver(sync).observe(measure || stage); } catch { /* يُهمَل */ }
    }
    try { new ResizeObserver(sync).observe(wrap); } catch { /* يُهمَل */ }
  }
  setTimeout(sync, 0);

  if (tabs.length) show(tabs[0].key);

  return {
    el: wrap, bar, panel, head, body, foot, stageBox,
    show,
    get active() { return active; },
    // يُعاد رسمُ القائمة المفتوحة وحدَها بعد تغييرٍ في النموذج
    refresh() { if (active) show(active); },
    sync
  };
}
