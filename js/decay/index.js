// DECAY — wires the damage clock into FORMS's sound, picture and rules.
// FORMS itself only touches three things here:
//   rules                         (audioUtils: which note, which waveform)
//   startDecay({ renderer, audioEffects })   (main.js init)
//   decay.render(scene, camera)   (main.js animate, instead of renderer.render)

import { createClock, MAX_DAMAGE } from './clock.js';
import { createRules, mutationCountFor, totalMutations } from './rules.js';
import { attachAudioMemory } from './audio-memory.js';
import { createVoice } from './voice.js';
import { createScope } from './scope.js';
import { setupKiosk } from './kiosk.js';
import { createHud } from './hud.js';

const search = location.search;
let storage = null;
try { storage = window.localStorage; } catch { /* blocked: clock runs in memory */ }

export const clock = createClock({ search, storage });
if (clock.params.reset) {
  // don't let a later refresh of this URL heal the piece again
  const url = new URL(location.href);
  url.searchParams.delete('reset');
  history.replaceState(null, '', url);
}

export const rules = createRules(undefined, totalMutations(clock.params.days));
const kiosk = setupKiosk({ showControls: new URLSearchParams(search).get('controls') === '1' });

let audio = null;
let voice = null;
let visual = null;
let gl = null;
let lastScene = null;
let damage = 0;
let frames = 0;
let fps = 0;
let fpsAt = performance.now();

function tick() {
  damage = clock.damage();
  rules.advanceTo(mutationCountFor(damage, clock.params.days));
  if (audio) audio.setDamage(damage);
  if (voice) voice.setDamage(damage);
  if (visual) visual.setDamage(damage);
}
tick();
setInterval(tick, 250);

// FORMS's bounces sing through the portfolio's voice engine
export function chime(type, y, x) { if (voice) voice.chime(type, y, x); }

// audioEffects (FORMS's Tone chain) is no longer in the signal path
export async function startDecay({ renderer }) {
  gl = renderer;
  visual = createScope(renderer);
  voice = createVoice(rules);
  audio = await attachAudioMemory(voice);
  tick();
  return {
    render(scene, camera) {
      lastScene = scene;
      visual.render(scene, camera);
      frames++;
      const now = performance.now();
      if (now - fpsAt >= 1000) { fps = (frames * 1000) / (now - fpsAt); frames = 0; fpsAt = now; }
    },
  };
}

function resetAll() {
  clock.reset();
  tick(); // rules replay back to pristine
  if (audio) audio.clear();
  if (visual) visual.clear();
  console.info('[decay] reset: new exhibition clock started');
}

const hud = createHud(() => {
  const s = audio ? audio.stats : null;
  const heap = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(1)} MB` : 'n/a';
  return [
    `damage     ${damage.toFixed(4)} / ${MAX_DAMAGE}${clock.params.pinned !== null ? '  (pinned)' : ''}`,
    `elapsed    ${clock.elapsedDays().toFixed(3)} d of ${clock.params.days}  (x${clock.params.timescale})`,
    `bit depth  ${s ? s.bits.toFixed(2) : '—'}`,
    `recall     lowpass ${s && s.cutoff ? Math.round(s.cutoff) + ' Hz' : '—'}   each lap ${s && s.lapSemis !== undefined ? '−' + s.lapSemis.toFixed(2) + ' st' : '—'}`,
    `live pitch ${voice ? (voice.cents() / 100).toFixed(2) + ' st' : '—'}`,
    `feedback   ${s ? s.feedback.toFixed(3) : '—'}`,
    `picture    grid ${visual ? visual.stats.gridBits.toFixed(1) : '—'} bits  stairs ${visual ? visual.stats.stepPx.toFixed(1) : '—'} px  lag ${visual ? visual.stats.lag : '—'} fr`,
    `mutations  ${rules.applied}  (${rules.last})`,
    `notes      ${rules.slots.length} slots, ${rules.offKey()} off key: ${voice ? rules.notesFor(voice.scale()).map((n) => Math.round(n)).join(' ') : '—'}`,
    `waves      ${rules.waves.join(' / ')}`,
    `voices     ${voice ? voice.voices() : 0}   chord ${voice ? voice.chord() : '—'}`,
    `fps        ${fps.toFixed(1)}   heap ${heap}   started ${kiosk.isStarted()}`,
  ].join('\n');
});

// D: HUD. Hold Shift+R for 3 s: hidden reset.
let resetTimer = 0;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyD' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) hud.toggle();
  if (e.code === 'KeyR' && e.shiftKey && !resetTimer) {
    resetTimer = setTimeout(() => { resetTimer = 0; resetAll(); }, 3000);
  }
});
window.addEventListener('keyup', (e) => {
  if ((e.code === 'KeyR' || e.key === 'Shift') && resetTimer) { clearTimeout(resetTimer); resetTimer = 0; }
});
window.addEventListener('blur', () => { clearTimeout(resetTimer); resetTimer = 0; });

// for the soak test / console poking
window.__formsDecay = { clock, rules, get damage() { return damage; }, get audioStats() { return audio && audio.stats; }, get fps() { return fps; },
  get shapes() {
    const m = lastScene ? lastScene.children.filter((c) => c.isMesh && c.velocity) : [];
    return { total: m.length, dying: m.filter((c) => c.userData.dying).length };
  },
  get gpu() { return gl && { ...gl.info.memory, programs: gl.info.programs.length }; },
};
