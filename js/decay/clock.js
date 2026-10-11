// DAMAGE CLOCK — the single source of truth for how worn the system is.
//
// damage = MAX_DAMAGE * t^CURVE, t = scaled elapsed time / duration.
// The ease-in keeps the first day or two nearly clean and piles the wear onto
// the last days. MAX_DAMAGE is a floor on fidelity: it never goes silent/blank.
//
// Pure module (no DOM): the browser passes in location.search and localStorage.

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const DEFAULT_DAYS = 10;
export const MAX_DAMAGE = 0.92;
export const CURVE = 2.5;

const KEY_LIVE = 'forms-decay:start';
// Test runs (?timescale != 1) keep their own start time so a compressed
// rehearsal can never age the real exhibition clock.
const KEY_TEST = 'forms-decay:start:test';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function damageAt(elapsedMs, durationMs = DEFAULT_DAYS * DAY) {
  const t = clamp(elapsedMs / durationMs, 0, 1);
  return MAX_DAMAGE * Math.pow(t, CURVE);
}

function safeGet(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}
function safeSet(storage, key, value) {
  try { if (storage) storage.setItem(key, value); } catch { /* private mode, quota… keep running */ }
}
function safeRemove(storage, key) {
  try { if (storage) storage.removeItem(key); } catch { /* ignore */ }
}

export function parseParams(search = '') {
  const p = new URLSearchParams(search);
  const num = (k) => (p.has(k) ? parseFloat(p.get(k)) : NaN);
  const ts = num('timescale');
  const days = num('days');
  const pin = num('damage');
  return {
    timescale: Number.isFinite(ts) && ts > 0 ? ts : 1,
    days: Number.isFinite(days) && days > 0 ? days : DEFAULT_DAYS,
    pinned: Number.isFinite(pin) ? clamp(pin, 0, MAX_DAMAGE) : null,
    reset: p.get('reset') === '1',
  };
}

export function createClock({ search = '', storage = null, now = () => Date.now() } = {}) {
  const params = parseParams(search);
  const durationMs = params.days * DAY;
  const key = params.timescale === 1 ? KEY_LIVE : KEY_TEST;

  if (params.reset) {
    safeRemove(storage, KEY_LIVE);
    safeRemove(storage, KEY_TEST);
  }

  let start = parseInt(safeGet(storage, key), 10);
  // missing, corrupt, or in the future (machine clock was wrong) → start now
  if (!Number.isFinite(start) || start > now()) {
    start = now();
    safeSet(storage, key, String(start));
  }

  const elapsed = () => Math.max(0, now() - start) * params.timescale;

  return {
    params,
    durationMs,
    elapsed,
    elapsedDays: () => elapsed() / DAY,
    damage: () => (params.pinned !== null ? params.pinned : damageAt(elapsed(), durationMs)),
    // the hidden Shift+R reset: a brand-new exhibition, starting now
    reset() {
      start = now();
      safeSet(storage, key, String(start));
    },
  };
}
