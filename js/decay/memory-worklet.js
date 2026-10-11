// AUDIO MEMORY — runs on the audio thread.
//
// A looping stereo buffer the whole mix is fed through. Each sample:
//   out   = live input + feedback * recall(memory[pos])   (fresh notes always clean)
//   memory[pos] = degrade(out)                            (the system re-hears itself)
// As damage rises, memory doesn't crackle — it sinks:
//   recall()  reads the loop through a pitch shifter, so every lap comes back
//             lower than the last (memories spiral downward), then through a
//             lowpass that closes, so they also come back duller
//   degrade() requantises gently (16 → 8 bits, dithered — hiss, not grit) and
//             lets the odd moment fade out of memory entirely
// All of it scales with damage (posted from the main thread).

const MAX_DAMAGE = 0.92;
const TAU = Math.PI * 2;

class FormsMemory extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const seconds = (options.processorOptions && options.processorOptions.seconds) || 6;
    this.len = Math.max(8192, Math.round(seconds * sampleRate));
    this.buf = [new Float32Array(this.len), new Float32Array(this.len)];
    this.pos = 0;
    this.target = 0;
    this.d = 0;
    this.lp = [0, 0];
    this.win = Math.round(0.12 * sampleRate); // pitch-shifter grain
    this.phase = 0;
    this.drop = 0;
    this.dg = 1;
    this.dropCoef = 1 - Math.exp(-1 / (0.03 * sampleRate)); // slow, soft fades
    this.blocks = 0;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (typeof m.damage === 'number') this.target = m.damage;
      if (m.clear) { this.buf[0].fill(0); this.buf[1].fill(0); this.d = this.target; }
    };
  }

  // linear-interpolated read `ahead` samples in front of the write head
  // (i.e. slightly less than a full loop old)
  tap(mem, p, ahead) {
    let x = p + ahead;
    if (x >= this.len) x -= this.len;
    const i = x | 0, f = x - i, j = i + 1 === this.len ? 0 : i + 1;
    return mem[i] + (mem[j] - mem[i]) * f;
  }

  process(inputs, outputs) {
    const input = inputs[0] || [];
    const out = outputs[0];
    const n = out[0].length;

    this.d += (this.target - this.d) * 0.02; // glide, no zipper steps
    const k = Math.min(1, Math.max(0, this.d / MAX_DAMAGE));

    const bits = 16 - 8 * k;                                   // 16 → 8
    const steps = Math.pow(2, bits - 1);
    const lapSemis = 2.5 * k * k;                              // each lap this much lower
    const ratio = Math.pow(2, -lapSemis / 12);
    const shift = Math.min(1, lapSemis * 4);                   // blend the shifter in
    const cutoff = 18000 * Math.pow(500 / 18000, Math.pow(k, 1.3)); // 18 kHz → 500 Hz
    const a = 1 - Math.exp((-TAU * Math.min(cutoff, 0.45 * sampleRate)) / sampleRate);
    const feedback = 0.72 - 0.17 * k;                          // old laps fade a little faster
    const W = this.win;
    const dphi = (1 - ratio) / W;

    if (this.drop <= 0 && Math.random() < 0.0015 * Math.pow(k, 1.5)) {
      this.drop = Math.floor((0.15 + 0.4 * Math.random()) * sampleRate);
    }

    const inL = input[0], inR = input[1] || input[0];
    const outL = out[0], outR = out[1] || out[0];
    const memL = this.buf[0], memR = this.buf[1];

    for (let i = 0; i < n; i++) {
      const p = this.pos;
      let rL = memL[p], rR = memR[p];
      if (shift > 0) {
        // two grains reading ever-older material (delay grows → pitch drops),
        // half a grain apart, sine-windowed so their crossfade is smooth
        this.phase += dphi;
        if (this.phase >= 1) this.phase -= 1;
        const p1 = this.phase, p2 = p1 < 0.5 ? p1 + 0.5 : p1 - 0.5;
        const g1 = Math.sin(Math.PI * p1), g2 = Math.sin(Math.PI * p2);
        const a1 = W * (1 - p1), a2 = W * (1 - p2);
        const sL = (this.tap(memL, p, a1) * g1 + this.tap(memL, p, a2) * g2) * 0.75;
        const sR = (this.tap(memR, p, a1) * g1 + this.tap(memR, p, a2) * g2) * 0.75;
        rL += (sL - rL) * shift;
        rR += (sR - rR) * shift;
      }
      this.lp[0] += a * (rL - this.lp[0]);
      this.lp[1] += a * (rR - this.lp[1]);

      const xL = inL ? inL[i] : 0;
      const xR = inR ? inR[i] : 0;
      const yL = xL + feedback * this.lp[0];
      const yR = xR + feedback * this.lp[1];
      outL[i] = yL;
      if (outR !== outL) outR[i] = yR;

      if (this.drop > 0) this.drop--;
      this.dg += ((this.drop > 0 ? 0 : 1) - this.dg) * this.dropCoef;

      const wL = Math.round(Math.tanh(yL) * steps + (Math.random() - Math.random())) / steps;
      const wR = Math.round(Math.tanh(yR) * steps + (Math.random() - Math.random())) / steps;
      memL[p] = (k > 0.002 ? wL : Math.tanh(yL)) * this.dg;
      memR[p] = (k > 0.002 ? wR : Math.tanh(yR)) * this.dg;
      this.pos = p + 1 === this.len ? 0 : p + 1;
    }

    if (++this.blocks % 200 === 0) {
      this.port.postMessage({ bits, cutoff, lapSemis, feedback, damage: this.d });
    }
    return true;
  }
}

registerProcessor('forms-memory', FormsMemory);
