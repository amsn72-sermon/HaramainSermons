// عارض الأصل المكتوب نصًّا: يُعرض على كليشة الهيئة صفحةً صفحة كملف PDF،
// بعلامة مائية تحمل هوية المستطلِع، وبلا نسخ ولا تنزيل (ملاحظة ١٠٢).
// التقسيم يقع بين السطور لا داخلها: تُقاس صناديق الأسطر ثم تُختار مواضع القطع.
import { h } from './ui.js';
import { setSafeHtml } from './sanitize.js';

// العلامة المائية: طبقة نصية مائلة فوق الصفحة، لا تُحدَّد ولا تُطبع منفصلة
function watermarkLayer(lines) {
  const layer = h('div.tv-wm', { 'aria-hidden': 'true' });
  const text = (lines || []).filter(Boolean).join(' — ');
  if (!text) return layer;
  for (let i = 0; i < 18; i++) layer.append(h('span', text));
  return layer;
}

export function textViewer({ html, lines = [], dir = 'rtl', lang = 'ar', top = null }) {
  const flow = h('div.tv-flow', { dir, lang });
  if (top) flow.append(top);
  const content = h('div.src');
  setSafeHtml(content, html || '');
  flow.append(content);

  const body = h('div.lh-body.tv-body', flow);
  const frame = h('div.a4.lh-page.tv-page', body, watermarkLayer(lines));
  const status = h('span.pdf-count', '…');
  const prev = h('button.btn.sm', { type: 'button', disabled: true, 'aria-label': 'الصفحة السابقة' }, '→ السابقة');
  const next = h('button.btn.sm', { type: 'button', disabled: true, 'aria-label': 'الصفحة التالية' }, 'التالية ←');
  const el = h('div.pdf-viewer.text-viewer', {
    oncontextmenu: e => e.preventDefault(),
    ondragstart: e => e.preventDefault(),
    oncopy: e => e.preventDefault()
  }, frame, h('div.pdf-nav', prev, status, next));

  let breaks = [0];
  let page = 1;

  // مواضع القطع: أعلى كل سطر لا يتّسع في الصفحة الحالية يبدأ صفحة جديدة
  function lineTops() {
    const base = flow.getBoundingClientRect().top;
    const tops = [];
    const walk = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (!n.nodeValue.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const rect of r.getClientRects()) {
          if (rect.height) tops.push({ top: rect.top - base, bottom: rect.bottom - base });
        }
      } else if (/^(IMG|TABLE|HR|FIGURE)$/.test(n.tagName)) {
        const rect = n.getBoundingClientRect();
        if (rect.height) tops.push({ top: rect.top - base, bottom: rect.bottom - base });
      }
    }
    tops.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
    return tops;
  }

  function paginate() {
    const H = body.clientHeight;
    const total = flow.scrollHeight;
    if (!H || !total) { breaks = [0]; return; }
    const rects = lineTops();
    const out = [0];
    let start = 0;
    let guard = 0;
    while (start + H < total - 1 && guard++ < 400) {
      const limit = start + H;
      // آخر سطر يكتمل داخل الصفحة، فالقطع عند بداية الذي يليه
      let cut = 0;
      for (const r of rects) {
        if (r.top < start + 0.5) continue;
        if (r.bottom <= limit + 0.5) cut = r.bottom;
        else { cut = Math.max(cut, r.top > start + 0.5 ? r.top : 0); break; }
      }
      // سطر أطول من الصفحة كلها (صورة أو جدول): تُقطع الصفحة عند حدّها
      let nextStart = 0;
      for (const r of rects) if (r.top > start + 0.5 && r.top <= limit + 0.5) nextStart = Math.max(nextStart, r.top);
      const step = nextStart > start + 1 ? nextStart : (cut > start + 1 ? cut : limit);
      start = Math.min(step, start + H);
      out.push(start);
    }
    breaks = out;
  }

  function show() {
    page = Math.min(Math.max(1, page), breaks.length);
    flow.style.transform = `translateY(${-Math.round(breaks[page - 1])}px)`;
    status.textContent = `صفحة ${page} من ${breaks.length}`;
    prev.disabled = page <= 1;
    next.disabled = page >= breaks.length;
  }

  const relayout = () => { const keep = page; paginate(); page = Math.min(keep, breaks.length); show(); };
  const go = d => { page += d; show(); };
  prev.onclick = () => go(-1);
  next.onclick = () => go(1);
  el.tabIndex = 0;
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowRight' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
  });

  let t;
  const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(relayout, 150); });
  // يُقاس بعد أن تُحسب أبعاد الصفحة ويُحمَّل الخط
  const first = () => { relayout(); ro.observe(frame); };
  if (document.fonts?.ready) document.fonts.ready.then(first).catch(first);
  else setTimeout(first, 60);
  requestAnimationFrame(() => requestAnimationFrame(relayout));

  return el;
}
