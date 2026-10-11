// VOICE — the sound engine from checocadena.com (src/signal/audio.js), ported:
//   chimes — every bounce rings a note: 5 ms attack, 1.6 s exponential decay,
//            higher hits sing higher, panned to the side of the box it struck.
//            Voice stealing fades the oldest out; notes are spaced ≥45 ms.
//   pad    — a soft detuned chord under a slowly breathing lowpass, moving
//            through the site's chords (all diatonic to C, so any chime fits).
//   verb, delay, and a limiter at the very end so nothing clips or crackles.
// The note table and waveforms come from the (decaying) rules.
//
// Chain: chimes + pad + verb → master → [memory worklet] → limiter → speakers

/* global Tone */

import { scaleForChord } from './rules.js';

const TAU = Math.PI * 2;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const n = (...notes) => notes.map(hz);

// the site's channel chords, in page order (MIDI)
const CHORD_MIDI = [
  [48, 55, 59, 62, 64], // Cmaj9 (hero)
  [45, 52, 55, 59, 60], // Am9
  [41, 48, 52, 55, 57], // Fmaj9
  [43, 50, 52, 57, 59], // G6/9
  [40, 47, 50, 55, 59], // Em7
  [43, 50, 55, 57, 60], // Gsus
  [38, 45, 48, 52, 53], // Dm9
  [45, 52, 55, 60, 62], // Am11
];
const CHORDS = CHORD_MIDI.map((c) => c.map(hz));
// the chimes sing the drone's own chord tones, so a clean system is always in key
const SCALES = CHORD_MIDI.map(scaleForChord);
const CHORD_SECONDS = 60;
const MAX_DAMAGE = 0.92;
const MAX_VOICES = 6;

export function createVoice(rules) {
  const ctx = Tone.getContext().rawContext;

  function impulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += (Math.random() * 2 - 1 - lp) * 0.25; // darker tail
        d[i] = lp * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  // Late in the run everything sags: pitch falls (k³, so it barely moves for
  // most of the show, then up to −1.5 octaves at the floor) and wobbles like
  // a stretched tape. Returned in cents.
  let k = 0;
  function sag(t) {
    const wow = 70 * k * k * (Math.sin(TAU * 0.31 * t) + 0.5 * Math.sin(TAU * 0.83 * t + 1)) / 1.5;
    return -1800 * k * k * k + wow;
  }

  const master = ctx.createGain();
  master.gain.value = 0;
  master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.8);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter);
  limiter.connect(ctx.destination);

  const verb = ctx.createConvolver();
  verb.buffer = impulse(6, 2.4);
  const verbGain = ctx.createGain();
  verbGain.gain.value = 0.55;
  verb.connect(verbGain);
  verbGain.connect(master);

  // ── pad ──
  const padBus = ctx.createGain();
  padBus.gain.value = 0.5;
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 900;
  padFilter.Q.value = 0.4;
  const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
  lfo.frequency.value = 0.045;
  lfoGain.gain.value = 420;
  lfo.connect(lfoGain);
  lfoGain.connect(padFilter.frequency);
  lfo.start();
  padBus.connect(padFilter);
  padFilter.connect(master);
  padFilter.connect(verb);

  let voicesNow = [];
  function setChord(freqs, fade = 3.5) {
    const t = ctx.currentTime;
    voicesNow.forEach((v) => {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, fade / 3);
      v.oscs.forEach((o) => o.stop(t + fade * 2));
      setTimeout(() => v.gain.disconnect(), (fade * 2 + 0.5) * 1000);
    });
    voicesNow = freqs.map((f, i) => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime((i === 0 ? 0.11 : 0.07) / Math.sqrt(freqs.length / 4), t, fade / 3);
      const oscs = [['sine', -4], ['triangle', 5]].map(([type, cents]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.base = cents;
        o.detune.value = cents + sag(t);
        o.connect(gain);
        o.start(t);
        return o;
      });
      const trem = ctx.createOscillator(), tremGain = ctx.createGain();
      trem.frequency.value = 0.07 + i * 0.023;
      tremGain.gain.value = 0.02;
      trem.connect(tremGain);
      tremGain.connect(gain.gain);
      trem.start(t);
      oscs.push(trem);
      gain.connect(padBus);
      return { gain, oscs };
    });
  }
  let chord = 0;
  setChord(CHORDS[0]);
  setInterval(() => { chord = (chord + 1) % CHORDS.length; setChord(CHORDS[chord]); }, CHORD_SECONDS * 1000);

  // ── chimes ──
  const chimeBus = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  const delay = ctx.createDelay(1), fb = ctx.createGain(), send = ctx.createGain();
  delay.delayTime.value = 0.36;
  fb.gain.value = 0.22;
  send.gain.value = 0.25;
  chimeBus.connect(lp);
  lp.connect(master);
  lp.connect(send);
  send.connect(verb);
  lp.connect(delay);
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(send);

  const ringing = [];
  let lastChime = 0;

  // y, x: where the shape hit, normalised to −1…1 across the box
  function chime(type, y = 0, x = 0) {
    if (ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (t - lastChime < 0.045) return;
    lastChime = t;
    if (ringing.length >= MAX_VOICES) {
      const old = ringing.shift();
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setTargetAtTime(0, t, 0.04);
      old.osc.stop(t + 0.2);
    }
    const notes = rules.notesFor(SCALES[chord]);
    const idx = Math.max(0, Math.min(notes.length - 1, Math.round(((y + 1) / 2) * (notes.length - 1))));
    const osc = ctx.createOscillator(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
    osc.type = type;
    osc.frequency.value = notes[idx];
    // each note droops a little as it rings, more as the system wears
    osc.detune.setValueAtTime(sag(t), t);
    osc.detune.linearRampToValueAtTime(sag(t) - 150 * k * k, t + 1.6);
    pan.pan.value = Math.max(-0.85, Math.min(0.85, x));
    const peak = type === 'square' ? 0.022 : type === 'triangle' ? 0.05 : type === 'sawtooth' ? 0.025 : 0.065;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    osc.connect(gain);
    gain.connect(pan);
    pan.connect(chimeBus);
    osc.start(t);
    osc.stop(t + 1.65);
    const voice = { osc, gain };
    ringing.push(voice);
    osc.onended = () => {
      const i = ringing.indexOf(voice);
      if (i >= 0) ringing.splice(i, 1);
      pan.disconnect();
    };
  }

  const NAMES = ['Cmaj9', 'Am9', 'Fmaj9', 'G6/9', 'Em7', 'Gsus', 'Dm9', 'Am11'];
  function setDamage(d) {
    k = Math.min(1, Math.max(0, d / MAX_DAMAGE));
    const t = ctx.currentTime;
    voicesNow.forEach((v) => v.oscs.forEach((o) => {
      if (o.base !== undefined) o.detune.setTargetAtTime(o.base + sag(t), t, 0.3);
    }));
  }

  return {
    ctx, master, limiter, chime, setDamage,
    voices: () => ringing.length,
    chord: () => NAMES[chord],
    scale: () => SCALES[chord],
    cents: () => sag(ctx.currentTime),
  };
}
