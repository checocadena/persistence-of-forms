// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { damageAt, createClock, parseParams, DAY, HOUR, MAX_DAMAGE } from '../js/decay/clock.js';
import { createRules, mutationCountFor, totalMutations, scaleForChord, PRISTINE_WAVES, SLOTS } from '../js/decay/rules.js';

const CMAJ9 = scaleForChord([48, 55, 59, 62, 64]);
const AM9 = scaleForChord([45, 52, 55, 59, 60]);
const midi = (f) => Math.round(69 + 12 * Math.log2(f / 440));

const D10 = 10 * DAY;

test('damage curve: clean start, ease-in, floor at the end', () => {
  assert.equal(damageAt(0, D10), 0);
  assert.ok(damageAt(1 * DAY, D10) < 0.01, 'day 1 nearly clean');
  assert.ok(damageAt(2 * DAY, D10) < 0.025, 'day 2 still nearly clean');
  const mid = damageAt(5 * DAY, D10);
  assert.ok(mid > 0.1 && mid < 0.25, `day 5 moderate (${mid})`);
  assert.ok(damageAt(9 * DAY, D10) > 0.65, 'day 9 heavy');
  assert.equal(damageAt(10 * DAY, D10), MAX_DAMAGE);
  assert.equal(damageAt(30 * DAY, D10), MAX_DAMAGE, 'clamped after the run');
  assert.equal(damageAt(-5, D10), 0);
});

test('damage is monotonic and smooth (no jumps between seconds)', () => {
  let prev = 0;
  for (let t = 0; t <= D10; t += 600 * 1000) {
    const d = damageAt(t, D10);
    assert.ok(d >= prev, `monotonic at ${t}`);
    assert.ok(d - prev < 0.005, `no jump at ${t}`);
    prev = d;
  }
});

test('timescale compresses the run; refresh does not heal', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  let t = 1_000_000;
  const now = () => t;
  const a = createClock({ search: '?timescale=10000', storage, now });
  t += 86.4 * 1000; // 86.4 s real = 10 days scaled
  assert.equal(a.damage(), MAX_DAMAGE);
  t -= 43.2 * 1000;
  const b = createClock({ search: '?timescale=10000', storage, now }); // "refresh"
  assert.ok(Math.abs(b.elapsedDays() - 5) < 1e-9);
  // test runs never touch the live exhibition key
  const live = createClock({ search: '', storage, now });
  assert.equal(live.damage(), 0);
  // reset clears both
  createClock({ search: '?reset=1', storage, now });
  const c = createClock({ search: '?timescale=10000', storage, now });
  assert.equal(c.elapsed(), 0);
});

test('storage that throws still yields a working clock', () => {
  const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  const c = createClock({ search: '?reset=1', storage: bad, now: () => 5 });
  assert.equal(c.damage(), 0);
});

test('params: pin, clamp, defaults', () => {
  assert.equal(parseParams('?damage=0.5').pinned, 0.5);
  assert.equal(parseParams('?damage=1').pinned, MAX_DAMAGE);
  assert.equal(parseParams('?timescale=-3').timescale, 1);
  assert.equal(parseParams('').days, 10);
});

test('mutations: ~one per hour over the run, none on day 1', () => {
  assert.equal(totalMutations(10), 240);
  assert.equal(mutationCountFor(MAX_DAMAGE, 10), 240);
  assert.ok(mutationCountFor(damageAt(1 * DAY, D10), 10) <= 1);
  assert.equal(mutationCountFor(0, 10), 0);
});

test('seeded mutations reproduce identically', () => {
  const a = createRules(); a.advanceTo(240);
  const b = createRules(); b.advanceTo(240);
  assert.deepEqual(a.snapshot(), b.snapshot());

  // incremental (a live run) === replay from scratch (a reload)
  const inc = createRules();
  for (let n = 0; n <= 137; n += 7) inc.advanceTo(n);
  inc.advanceTo(137);
  const direct = createRules(); direct.advanceTo(137);
  assert.deepEqual(inc.snapshot(), direct.snapshot());

  // going back replays from pristine
  inc.advanceTo(0);
  assert.deepEqual(inc.notesFor(CMAJ9), CMAJ9);
  assert.deepEqual(inc.waves, PRISTINE_WAVES);

  // a different seed gives a different history
  const other = createRules(123); other.advanceTo(240);
  assert.notDeepEqual(other.snapshot(), a.snapshot());
});

test('rules never stop the system sounding', () => {
  for (let seed = 1; seed < 200; seed++) {
    const r = createRules(seed);
    for (let n = 0; n <= 240; n += 10) {
      r.advanceTo(n);
      assert.ok(r.slots.length >= 3);
      for (const scale of [CMAJ9, AM9]) {
        for (const f of r.notesFor(scale)) assert.ok(Number.isFinite(f) && f >= 65 && f <= 2100, `seed ${seed} note ${f}`);
      }
      for (const w of r.waves) assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(w));
    }
  }
});

test('chime scales are the drone chord tones, rising, from C4', () => {
  assert.equal(CMAJ9.length, SLOTS);
  assert.deepEqual(CMAJ9.map(midi), [60, 62, 64, 67, 71, 72, 74, 76, 79, 83]);
  assert.deepEqual(AM9.map(midi), [60, 64, 67, 69, 71, 72, 76, 79, 81, 83]);
  for (let i = 1; i < AM9.length; i++) assert.ok(AM9[i] > AM9[i - 1]);
});

test('in key early, jumbled late (averaged over seeds)', () => {
  const inKey = (r) => {
    const classes = new Set([0, 2, 4, 7, 11]); // Cmaj9
    const notes = r.notesFor(CMAJ9);
    return notes.filter((f) => classes.has(((midi(f) % 12) + 12) % 12)).length / notes.length;
  };
  let early = 0, late = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const r = createRules(seed);
    r.advanceTo(mutationCountFor(damageAt(2 * DAY, D10)));
    early += inKey(r);
    r.advanceTo(240);
    late += inKey(r);
  }
  assert.ok(early / 100 > 0.95, `day 2 in key ${early}`);
  assert.ok(late / 100 < 0.6, `day 10 in key ${late}`);
});

test('mutation cadence follows the ease-in (sparse early, dense late)', () => {
  const at = (h) => mutationCountFor(damageAt(h * HOUR, D10), 10);
  const lastDay = at(240) - at(216);
  assert.ok(lastDay > 24 && lastDay < 80, `last day mutations ${lastDay}`);
  assert.ok(at(48) < 6, `first two days ${at(48)}`);
});
