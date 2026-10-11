// RULE DECAY — the "makes less sense" layer.
//
// The chimes play from a scale built on whatever chord the drone is holding,
// so a pristine system is always in key. The rules are 10 *slots* into that
// scale (bottom to top: higher hits sing higher) plus the shape→waveform map.
// Mutations wear the slots, not the frequencies, so they carry across chord
// changes:
//   nudge     a slot drifts a semitone off key
//   swap      two slots trade places (height no longer means pitch)
//   collapse  a slot falls onto its neighbour's note (fewer distinct pitches)
//   drop      a slot is lost (rarer as the table thins; never below 3)
//   wave      a shape changes waveform
// The damage clock decides how many mutations have happened so far (about one
// per hour of exhibition, front-loaded onto the late days by the same ease-in
// curve). Mutation k is drawn from a PRNG seeded by (SEED, k) and applied in
// order from pristine — the same elapsed time always yields the same rules.
//
// Pure module (no DOM/Tone), testable in Node.

import { MAX_DAMAGE, DEFAULT_DAYS } from './clock.js';

// chosen because its history is typical: in key and in order for the first days,
// scrambled but on chord tones mid-run, off key and wide-ranging at the end
export const SEED = 986666;
export const SLOTS = 10;
export const SHAPES = ['SphereGeometry', 'TetrahedronGeometry', 'BoxGeometry'];
export const PRISTINE_WAVES = ['sine', 'triangle', 'square'];
const WAVE_POOL = ['sine', 'triangle', 'square', 'sawtooth'];

const MIN_SLOTS = 3;
const MAX_DEV = 6; // semitones a slot can wander off key
const LOW_HZ = 65;
const HIGH_HZ = 2100;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const totalMutations = (days = DEFAULT_DAYS) => Math.round(days * 24);

export function mutationCountFor(damage, days = DEFAULT_DAYS) {
  const k = Math.min(1, Math.max(0, damage / MAX_DAMAGE));
  return Math.floor(totalMutations(days) * k + 1e-9);
}

// A chime scale from a chord's tones: every note from C4 up whose pitch class
// is in the chord, the first SLOTS of them. Always consonant with the drone.
export function scaleForChord(midiNotes) {
  const classes = new Set(midiNotes.map((m) => ((m % 12) + 12) % 12));
  const out = [];
  for (let m = 60; out.length < SLOTS && m < 120; m++) {
    if (classes.has(m % 12)) out.push(440 * Math.pow(2, (m - 69) / 12));
  }
  return out;
}

const fit = (f) => {
  while (f < LOW_HZ) f *= 2;
  while (f > HIGH_HZ) f /= 2;
  return f;
};

export function createRules(seed = SEED, total = totalMutations()) {
  const slots = []; // { deg: index into the scale, dev: semitones off key }
  const waves = [];
  let applied = 0;
  let last = 'pristine';

  function restore() {
    slots.length = 0;
    for (let i = 0; i < SLOTS; i++) slots.push({ deg: i, dev: 0 });
    waves.length = 0; waves.push(...PRISTINE_WAVES);
    applied = 0;
    last = 'pristine';
  }

  function mutate(index) {
    const rng = mulberry32((seed ^ Math.imul(index + 1, 0x9E3779B1)) >>> 0);
    const pick = (n) => Math.floor(rng() * n);
    const roll = rng();
    const i = pick(slots.length);
    // how far through the run this mutation falls: early errors jumble the
    // order (still chord tones); going off key mostly happens late
    const p = Math.min(1, index / total);
    const tNudge = 0.04 + 0.5 * p * p;
    const tWave = tNudge + 0.15;
    const tCollapse = tWave + 0.12;
    const tDrop = tCollapse + 0.03;
    if (roll < tNudge) {
      const dir = rng() < 0.5 ? -1 : 1;
      slots[i].dev = Math.max(-MAX_DEV, Math.min(MAX_DEV, slots[i].dev + dir));
      last = `slot ${i} ${dir > 0 ? '+' : '-'}1 st off key`;
    } else if (roll < tWave) {
      const s = pick(SHAPES.length);
      const from = waves[s];
      const options = WAVE_POOL.filter((w) => w !== from);
      waves[s] = options[pick(options.length)];
      last = `${SHAPES[s].replace('Geometry', '')} ${from} → ${waves[s]}`;
    } else if (roll < tCollapse) {
      const j = i === 0 ? 1 : i === slots.length - 1 ? i - 1 : i + (rng() < 0.5 ? -1 : 1);
      slots[i] = { deg: slots[j].deg, dev: slots[i].dev };
      last = `slot ${i} collapses onto ${j}`;
    } else if (roll < tDrop && rng() < (slots.length - MIN_SLOTS) / (SLOTS - MIN_SLOTS)) {
      slots.splice(i, 1);
      last = `drop slot ${i}`;
    } else {
      const j = pick(slots.length);
      const t = slots[i]; slots[i] = slots[j]; slots[j] = t;
      last = `swap slots ${i} ↔ ${j}`;
    }
  }

  // Bring the rules to exactly `count` mutations. Moving forward applies only
  // the new ones; moving back (reset, pinned damage) replays from pristine.
  function advanceTo(count) {
    if (count < applied) restore();
    while (applied < count) mutate(applied++);
  }

  restore();
  return {
    slots,
    waves,
    advanceTo,
    get applied() { return applied; },
    get last() { return last; },
    // the notes the chimes play, bottom slot to top, over the current chord's scale
    notesFor: (scale) => slots.map((s) => fit(scale[Math.min(s.deg, scale.length - 1)] * Math.pow(2, s.dev / 12))),
    offKey: () => slots.filter((s) => s.dev !== 0).length,
    waveFor: (geometryType) => waves[SHAPES.indexOf(geometryType)] || 'sine',
    snapshot: () => ({ slots: slots.map((s) => ({ ...s })), waves: [...waves], applied }),
  };
}
