// GALLERY / KIOSK — fullscreen on the start click, keep the screen awake,
// keep the AudioContext running, and hide FORMS's buttons from visitors
// (?controls=1 brings them back).

/* global Tone */

export function setupKiosk({ showControls = false } = {}) {
  if (!showControls) {
    const style = document.createElement('style');
    style.textContent = '.control-button { display: none !important; } body.forms-running { cursor: none; }';
    document.head.appendChild(style);
  }

  let started = false;
  let wakeLock = null;

  async function lockScreen() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (err) {
      console.warn('[kiosk] wake lock refused:', err && err.message);
    }
  }

  function resumeAudio() {
    if (!started || typeof Tone === 'undefined') return;
    const ctx = Tone.getContext();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  const button = document.getElementById('start-button');
  if (button) {
    button.addEventListener('click', () => {
      started = true;
      document.body.classList.add('forms-running');
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen().catch((err) => console.warn('[kiosk] fullscreen refused:', err && err.message));
      }
      lockScreen();
      try { Tone.getContext().rawContext.addEventListener('statechange', resumeAudio); } catch { /* ignore */ }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { lockScreen(); resumeAudio(); }
  });
  // belt and braces: some browsers suspend without a statechange we can see
  setInterval(() => { resumeAudio(); if (started) lockScreen(); }, 5000);

  return { isStarted: () => started };
}
