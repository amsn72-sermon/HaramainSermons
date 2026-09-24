// مشغّل الخطب: إطار يوتيوب بلا أي تحكم من داخله، وأزرارنا أسفله (ملاحظة ٣٢)
// لا يستطيع المشاهد النقر على الفيديو فينتقل إلى يوتيوب أو إلى مقاطع مقترحة.
import { h } from './ui.js';

const ORIGIN = 'https://www.youtube-nocookie.com';

// مشغّل واحد يعمل في الصفحة: تشغيل مقطع يوقف ما سواه فلا تختلط الأصوات (ملاحظة ٤٠)
const running = new Set();
function stopOthers(me) {
  for (const p of [...running]) {
    if (!p.isConnected) { running.delete(p); continue; }
    if (p !== me) p.pauseNow?.();
  }
}
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

  // أيقونات صغيرة متجاورة بلا كتابة، والاسم في التلميح وقارئ الشاشة (ملاحظة ٤١)
  const ICONS = {
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
    back15: '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/><text x="12" y="16.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none">15</text>',
    fwd15: '<path d="M12 5V2l5 4-5 4V7a5 5 0 1 0 5 5h2a7 7 0 1 1-7-7z"/><text x="12" y="16.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none">15</text>',
    restart: '<path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    vol: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a4 4 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  };
  const svg = name => {
    const sp = h('span.vp-ico', { 'aria-hidden': 'true' });
    sp.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">${ICONS[name]}</svg>`;
    return sp;
  };
  const iconBtn = (name, ar, en, fn, cls = '') => h('button.vp-btn', { class: cls, type: 'button',
    'aria-label': `${ar} — ${en}`, title: `${ar} — ${en}`, onclick: fn }, svg(name));

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
    if (!iframe) { stopOthers(wrap); return mount(true); }
    if (playing) send('pauseVideo');
    else { stopOthers(wrap); send('playVideo'); }
  };
  const jump = d => { if (iframe) send('seekTo', [Math.max(0, current + d), true]); };

  const playBtn = iconBtn('play', 'تشغيل', 'Play', playPause, 'main');
  const bar = h('div.vp-bar',
    iconBtn('restart', 'من البداية', 'Restart', () => { stopOthers(wrap); if (!iframe) return mount(true); send('seekTo', [0, true]); }),
    iconBtn('back15', 'رجوع ١٥ ثانية', '−15s', () => jump(-15)),
    playBtn,
    iconBtn('fwd15', 'تقديم ١٥ ثانية', '+15s', () => jump(15)),
    iconBtn('full', 'ملء الشاشة', 'Fullscreen', () => {
      const el = wrap;
      if (document.fullscreenElement) document.exitFullscreen?.();
      else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    }));

  const seek = h('input.vp-range', { type: 'range', min: '0', max: '100', value: '0', step: '1', 'aria-label': 'موضع التشغيل — Seek' });
  const timeLabel = h('span.vp-time', '0:00 / 0:00');
  const vol = h('input.vp-range.vp-vol', { type: 'range', min: '0', max: '100', value: String(volume), step: '1', 'aria-label': 'الصوت — Volume' });

  seek.addEventListener('input', () => { seeking = true; timeLabel.textContent = `${fmt(Number(seek.value))} / ${fmt(duration)}`; });
  seek.addEventListener('change', () => { seeking = false; if (iframe) send('seekTo', [Number(seek.value), true]); });
  vol.addEventListener('input', () => { volume = Number(vol.value); send('setVolume', [volume]); });

  // النقر على الفيديو يشغّل ويوقف فقط — ولا ينقل إلى أي مكان
  shield.addEventListener('click', playPause);
  poster.addEventListener('click', () => { stopOthers(wrap); mount(true); });
  poster.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stopOthers(wrap); mount(true); } });

  // شريطان تحت بعضهما بلا كتابات: موضع التشغيل ثم الصوت (ملاحظة ٤٢)
  const muteBtn = iconBtn('vol', 'كتم الصوت', 'Mute', () => {
    const on = Number(vol.value) > 0;
    volume = on ? 0 : 80; vol.value = String(volume);
    send(on ? 'mute' : 'unMute'); send('setVolume', [volume]);
    muteBtn.replaceChildren(svg(on ? 'mute' : 'vol'));
  });
  const rows = h('div.vp-rows',
    h('div.vp-row', seek, timeLabel),
    h('div.vp-row.vp-volrow', muteBtn, vol));
  const wrap = h('div.player', frame, bar, rows);

  function setState(s) {
    const was = playing;
    playing = s === 1;
    if (playing && !was) stopOthers(wrap);
    playBtn.replaceChildren(svg(playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', playing ? 'إيقاف — Pause' : 'تشغيل — Play');
    playBtn.title = playBtn.getAttribute('aria-label');
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
  const tick = setInterval(() => { if (!wrap.isConnected) { clearInterval(tick); running.delete(wrap); window.removeEventListener('message', onMessage); return; } listen(); }, 1000);

  wrap.pauseNow = () => { if (iframe && playing) send('pauseVideo'); };
  running.add(wrap);
  setState(2);
  return wrap;
}
