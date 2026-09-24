// مشغّل الخطب: إطار يوتيوب بلا أي تحكم من داخله، وأزرارنا أسفله (ملاحظة ٣٢)
// لا يستطيع المشاهد النقر على الفيديو فينتقل إلى يوتيوب أو إلى مقاطع مقترحة.
import { h } from './ui.js';

const ORIGIN = 'https://www.youtube-nocookie.com';
const fmt = s => {
  s = Math.max(0, Math.round(s || 0));
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};
// تسمية بالعربية والإنجليزية (الموقع عالمي — ملاحظة ٣٤)
const two = (ar, en) => h('span.bi', h('span', ar), h('span.en', en));

export function videoPlayer({ videoId, title, subtitle }) {
  const poster = h('div.vp-poster', { role: 'button', tabindex: '0', 'aria-label': `تشغيل — Play: ${title}` },
    h('img', { src: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`, alt: '', loading: 'lazy' }),
    h('div.vp-poster-in',
      h('div.vp-poster-title', title),
      subtitle && h('div.vp-poster-sub', subtitle),
      h('div.vp-poster-play', { 'aria-hidden': 'true' }, '▶')));
  const shield = h('div.vp-shield', { 'aria-hidden': 'true', hidden: true });
  const frame = h('div.vp-frame', poster, shield);

  const bigBtn = (label, ar, en, fn) => h('button.vp-btn', { type: 'button', 'aria-label': `${ar} — ${en}`, title: `${ar} — ${en}`, onclick: fn },
    h('span.vp-ico', { 'aria-hidden': 'true' }, label), two(ar, en));

  let iframe = null, playing = false, duration = 0, current = 0, seeking = false, volume = 80;

  const send = (func, args = []) => {
    try { iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), ORIGIN); } catch { /* الإطار لم يجهز */ }
  };
  const listen = () => {
    try { iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), ORIGIN); } catch { /* */ }
  };

  function mount(autoplay) {
    if (iframe) return;
    const src = `${ORIGIN}/embed/${encodeURIComponent(videoId)}?enablejsapi=1&widgetid=1&controls=0&disablekb=1&modestbranding=1`
      + `&rel=0&iv_load_policy=3&playsinline=1&fs=0&autoplay=${autoplay ? 1 : 0}&origin=${encodeURIComponent(location.origin)}`;
    iframe = h('iframe', { src, title, allow: 'autoplay; encrypted-media; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin' });
    frame.prepend(iframe);
    poster.hidden = true; shield.hidden = false;
    iframe.addEventListener('load', () => { listen(); send('setVolume', [volume]); });
  }

  const playPause = () => {
    if (!iframe) return mount(true);
    playing ? send('pauseVideo') : send('playVideo');
  };
  const jump = d => { if (iframe) send('seekTo', [Math.max(0, current + d), true]); };

  const playBtn = bigBtn('▶', 'تشغيل', 'Play', playPause);
  const bar = h('div.vp-bar',
    playBtn,
    bigBtn('⏪', 'رجوع ١٥ ث', '−15s', () => jump(-15)),
    bigBtn('⏩', 'تقديم ١٥ ث', '+15s', () => jump(15)),
    bigBtn('⟲', 'من البداية', 'Restart', () => { if (!iframe) return mount(true); send('seekTo', [0, true]); }),
    bigBtn('⛶', 'ملء الشاشة', 'Fullscreen', () => {
      const el = wrap;
      if (document.fullscreenElement) document.exitFullscreen?.();
      else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    }));

  const seek = h('input.vp-range', { type: 'range', min: '0', max: '100', value: '0', step: '1', 'aria-label': 'موضع التشغيل — Seek' });
  const timeLabel = h('span.vp-time', '0:00 / 0:00');
  const vol = h('input.vp-range.vp-vol', { type: 'range', min: '0', max: '100', value: String(volume), step: '1', 'aria-label': 'الصوت — Volume' });
  const volLabel = h('span.vp-time', `${volume}%`);

  seek.addEventListener('input', () => { seeking = true; timeLabel.textContent = `${fmt(Number(seek.value))} / ${fmt(duration)}`; });
  seek.addEventListener('change', () => { seeking = false; if (iframe) send('seekTo', [Number(seek.value), true]); });
  vol.addEventListener('input', () => { volume = Number(vol.value); volLabel.textContent = `${volume}%`; send('setVolume', [volume]); });

  // النقر على الفيديو يشغّل ويوقف فقط — ولا ينقل إلى أي مكان
  shield.addEventListener('click', playPause);
  poster.addEventListener('click', () => mount(true));
  poster.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mount(true); } });

  const rows = h('div.vp-rows',
    h('div.vp-row', two('موضع التشغيل', 'Progress'), seek, timeLabel),
    h('div.vp-row', two('الصوت', 'Volume'), vol, volLabel));
  const wrap = h('div.player', frame, bar, rows);

  function setState(s) {
    playing = s === 1;
    playBtn.replaceChildren(h('span.vp-ico', { 'aria-hidden': 'true' }, playing ? '❚❚' : '▶'),
      playing ? two('إيقاف', 'Pause') : two('تشغيل', 'Play'));
    if (s === 0) { send('seekTo', [0, true]); send('pauseVideo'); }   // عند الانتهاء: لا مقاطع مقترحة
  }

  function onMessage(e) {
    if (e.origin !== ORIGIN || !iframe || e.source !== iframe.contentWindow) return;
    let d; try { d = JSON.parse(e.data); } catch { return; }
    const info = d?.info;
    if (!info) return;
    if (typeof info.duration === 'number' && info.duration > 0) { duration = info.duration; seek.max = String(Math.floor(duration)); }
    if (typeof info.currentTime === 'number') {
      current = info.currentTime;
      if (!seeking) { seek.value = String(Math.floor(current)); timeLabel.textContent = `${fmt(current)} / ${fmt(duration)}`; }
    }
    if (typeof info.playerState === 'number') setState(info.playerState);
    if (typeof info.volume === 'number' && !vol.matches(':active')) { /* نُبقي اختيار المستخدم */ }
  }
  window.addEventListener('message', onMessage);
  const tick = setInterval(() => { if (!wrap.isConnected) { clearInterval(tick); window.removeEventListener('message', onMessage); return; } listen(); }, 1000);

  setState(2);
  return wrap;
}
