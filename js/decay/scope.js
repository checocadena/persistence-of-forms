// SCOPE — draws FORMS the way the checocadena.com cube does (SignalScope +
// bouncers + the cube view's backdrop): a phosphor beam on a 2D canvas (wide
// faint glow + thin bright core, persistence instead of a clear), the
// portfolio's tilted camera, a faint thin box, shapes of varied size that fade
// in, flash a colour on each bounce and relax to white, and — out of bounces —
// keep flying while they fade away (FORMS removes them once faded).
//
// FORMS's Three.js simulation still runs the physics; we read its scene and
// draw it ourselves, so decay happens to the form itself — the picture goes
// through the same chain as the sound:
//   bit depth    → vertices snap to a coarsening grid
//   sample rate  → edges become sample-and-hold staircases
//   bit flips    → now and then a shape's vertex is flung away for a frame
//   memory       → shapes are drawn where they *were* (lag grows), so the
//                  picture drifts out of sync with its own bounces
// Every edge and vertex is always drawn. Everything is reused per frame;
// per-shape state lives in a WeakMap and goes when FORMS drops the mesh.

import { MAX_DAMAGE } from './clock.js';

// ── wireframes (same builders as the portfolio's shapes.js) ─────────────────
const TAU = Math.PI * 2;
function line(pts) {
  const s = [];
  for (let i = 1; i < pts.length; i++) s.push([...pts[i - 1], ...pts[i]]);
  return s;
}
function circleY(r, y, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; pts.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
  return line(pts);
}
function box(s) {
  const x = s / 2;
  const v = [[-x, -x, -x], [x, -x, -x], [x, x, -x], [-x, x, -x], [-x, -x, x], [x, -x, x], [x, x, x], [-x, x, x]];
  return [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].map(([a, b]) => [...v[a], ...v[b]]);
}
function sphere(r, rings, segs) {
  const s = [];
  for (let i = 1; i < rings; i++) { const p = (i / rings) * Math.PI; s.push(...circleY(Math.sin(p) * r, Math.cos(p) * r, segs)); }
  for (let j = 0; j < segs / 2; j++) {
    const a = (j / (segs / 2)) * Math.PI, pts = [];
    for (let i = 0; i <= 16; i++) { const p = (i / 16) * TAU; pts.push([Math.sin(p) * Math.cos(a) * r, Math.cos(p) * r, Math.sin(p) * Math.sin(a) * r]); }
    s.push(...line(pts));
  }
  return s;
}
function tetra(r) {
  const v = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].map((p) => p.map((c) => c * r * 0.577));
  return [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].map(([a, b]) => [...v[a], ...v[b]]);
}
// the portfolio's builders and proportions (bouncers.js): sphere r, tetra
// r×1.6, cube r×1.3, with r per shape
const WIRES = {
  SphereGeometry: (r) => sphere(r, 4, 8),
  TetrahedronGeometry: (r) => tetra(r * 1.6),
  BoxGeometry: (r) => box(r * 1.3),
};
const MAX_SEGS = 96;

// the portfolio's camera (SignalScope 'focus' layout): centred at 47% height,
// 0.23 of the short side per model unit, tilted to show the top face, soft
// perspective, slow yaw (FORMS's original orbit rate). FORMS units → model
// units so its box is the portfolio's BOUND 1.12.
const BOUND = 1.12;
const LAYOUT = { x: 0.5, y: 0.47, s: 0.23 };
const TILT = -0.25;
const YAW = 0.0005; // half FORMS's original orbit speed

const LAG_MAX = 48;
const hash = (a) => {
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
};

export function createScope(renderer) {
  // FORMS's WebGL canvas stays in place (invisible) so clicks still reach it in
  // interactive mode; we never render to it.
  const glc = renderer.domElement;
  Object.assign(glc.style, { position: 'fixed', inset: '0', zIndex: '2', opacity: '0' });

  const backdrop = createBackdrop();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:1;pointer-events:none';
  document.body.prepend(canvas);
  document.body.prepend(backdrop);
  document.body.style.background = '#000';
  const g = canvas.getContext('2d');

  // u = one 'design pixel': sizes are fractions of the screen's short side, so
  // the piece looks (and decays) the same on a laptop or a projector
  let w = 0, h = 0, dpr = 1, u = 1, damage = 0;
  const fit = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = Math.round(window.innerWidth * dpr), nh = Math.round(window.innerHeight * dpr);
    if (nw !== w || nh !== h) { w = canvas.width = nw; h = canvas.height = nh; }
    u = Math.max(0.5, Math.min(w, h) / 800);
  };

  const hsl = { h: 0, s: 0, l: 0 };
  const pts = new Float32Array(MAX_SEGS * 4); // projected segment endpoints
  const state = new WeakMap();
  const stats = { gridBits: 12, stepPx: 0, lag: 0 };
  let boxWire = null, unit = 1, starPos = null;

  // camera, per frame
  let rotY = 0, cyA = 1, syA = 0, cxA = 1, sxA = 0, ox = 0, oy = 0, scale = 1;
  function project(x, y, z, o) {
    x *= unit; y *= unit; z *= unit;
    const x1 = x * cyA + z * syA, z1 = -x * syA + z * cyA;
    const y1 = y * cxA - z1 * sxA, z2 = y * sxA + z1 * cxA;
    const p = 3.2 / (3.2 + z2);
    pts[o] = ox + x1 * p * scale;
    pts[o + 1] = oy - y1 * p * scale;
  }

  // per-frame decay parameters
  let grid = 0, step = 0, pFlip = 0, lag = 0, cxs = 0, cys = 0;
  const qx = (x) => cxs + Math.round((x - cxs) / grid) * grid;
  const qy = (y) => cys + Math.round((y - cys) / grid) * grid;

  // one edge of the beam, after the signal chain
  function emit(ax, ay, bx, by, dx, dy) {
    ax += dx; ay += dy; bx += dx; by += dy;
    if (grid) { ax = qx(ax); ay = qy(ay); bx = qx(bx); by = qy(by); }
    g.moveTo(ax, ay);
    if (step) {
      const n = Math.min(48, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      let py = ay;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        let x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        if (grid) { x = qx(x); y = qy(y); }
        g.lineTo(x, py);
        g.lineTo(x, y);
        py = y;
      }
    } else {
      g.lineTo(bx, by);
    }
  }

  function emitAll(n, dx, dy) {
    for (let e = 0; e < n; e++) {
      const o = e * 4;
      emit(pts[o], pts[o + 1], pts[o + 2], pts[o + 3], dx, dy);
    }
  }

  // project a wireframe into pts[], with an optional bit-flip spike
  function prepare(segs, px, py, pz, rx, ry, flips) {
    const c0 = Math.cos(rx), s0 = Math.sin(rx), c1 = Math.cos(ry), s1 = Math.sin(ry);
    for (let e = 0; e < segs.length; e++) {
      const s = segs[e];
      for (let k = 0; k < 2; k++) {
        const x = s[k * 3], y = s[k * 3 + 1], z = s[k * 3 + 2];
        const xa = x * c0 + z * s0, za = -x * s0 + z * c0;
        const ya = y * c1 - za * s1, zb = y * s1 + za * c1;
        project(xa + px, ya + py, zb + pz, e * 4 + k * 2);
      }
    }
    if (flips && pFlip && Math.random() < pFlip) {
      const o = Math.floor(Math.random() * segs.length) * 4 + (Math.random() < 0.5 ? 0 : 2) + (Math.random() < 0.5 ? 0 : 1);
      pts[o] += (Math.random() < 0.5 ? -1 : 1) * Math.min(w, h) * Math.pow(2, -2 - Math.floor(Math.random() * 3));
    }
  }

  function render(scene) {
    fit();
    const k = Math.min(1, damage / MAX_DAMAGE);
    const now = performance.now();
    const md = Math.min(w, h);

    rotY += YAW;
    cyA = Math.cos(rotY); syA = Math.sin(rotY);
    cxA = Math.cos(TILT); sxA = Math.sin(TILT);
    ox = w * LAYOUT.x; oy = h * LAYOUT.y; scale = md * LAYOUT.s;

    const gridBits = 12 - 4 * Math.pow(k, 1.1); // floor 8 bits: small shapes stay legible
    grid = md / Math.pow(2, gridBits);
    if (grid < 0.75) grid = 0;
    step = 14 * u * Math.pow(k, 1.6);
    if (step < 1.5 * u) step = 0;
    pFlip = 0.012 * k * k;
    lag = Math.round(36 * Math.pow(k, 1.5));
    cxs = w / 2; cys = h / 2;
    Object.assign(stats, { gridBits, stepPx: step / u, lag });

    // phosphor persistence: fade toward transparent (the backdrop shows through).
    // The portfolio fades 0.24 a frame; shapes here move at 0.6× its speed, so
    // the phosphor holds longer to keep the same trail length. Worn phosphor
    // holds on longer still and smears.
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0,0,0,${0.15 - 0.04 * k})`;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // the beam's brightness wavers as it wears
    const bright = 1 - 0.35 * k * (0.5 + 0.5 * Math.sin(now * 0.0131) * Math.sin(now * 0.0077));
    const hueLevels = Math.max(3, Math.round(36 - 33 * k));

    for (const child of scene.children) {
      if (child.isPoints) {
        if (!starPos) starPos = child.geometry.attributes.position.array;
        drawStars(k, bright);
      } else if (child.isLineSegments) {
        if (!boxWire) {
          child.geometry.computeBoundingBox();
          const half = child.geometry.boundingBox.max.x;
          unit = BOUND / half;
          boxWire = box(half * 2);
        }
        // the FORMS box, as on the portfolio: faint, thin, no glow
        prepare(boxWire, 0, 0, 0, 0, 0, false);
        g.lineWidth = 1 * u;
        g.strokeStyle = `rgba(255,255,255,${0.12 * bright})`;
        g.beginPath();
        emitAll(boxWire.length, 0, 0);
        g.stroke();
      } else if (child.isMesh && child.velocity) {
        drawShape(child, k, bright, hueLevels);
      }
    }
  }

  function drawShape(mesh, k, bright, hueLevels) {
    const build = WIRES[mesh.geometry.type];
    if (!build) return;
    let st = state.get(mesh);
    if (!st) {
      st = {
        segs: build(mesh.userData.r || 0.5),
        hex: mesh.material.color.getHex(), hue: 0, flash: 1, life: 0,
        spin: [(Math.random() - 0.5) * 0.024, (Math.random() - 0.5) * 0.024], rot: [0, 0],
        hist: new Float32Array(LAG_MAX * 3), head: 0, filled: 0,
      };
      mesh.material.color.getHSL(hsl);
      st.hue = hsl.h;
      state.set(mesh, st);
    }
    // FORMS recolours a shape on every bounce → flash, then relax to phosphor white
    const hex = mesh.material.color.getHex();
    if (hex !== st.hex) { st.hex = hex; mesh.material.color.getHSL(hsl); st.hue = hsl.h; st.flash = 1; }
    // the bounce colour holds for about a second and a half (portfolio: ~0.3 s)
    st.flash *= 0.986;
    st.rot[0] += st.spin[0];
    st.rot[1] += st.spin[1];
    // fade in; once out of bounces, fade away and let FORMS drop it
    const dying = !!mesh.userData.dying;
    // the portfolio's rates (0.08 out, 0.05 in) at this piece's 0.6× tempo
    st.life += ((dying ? 0 : 1) - st.life) * (dying ? 0.048 : 0.03);
    if (dying && st.life < 0.02) { mesh.userData.faded = true; return; }

    // memory: remember where it's been, draw where it was
    const p = mesh.position;
    st.head = (st.head + 1) % LAG_MAX;
    st.hist[st.head * 3] = p.x; st.hist[st.head * 3 + 1] = p.y; st.hist[st.head * 3 + 2] = p.z;
    st.filled = Math.min(LAG_MAX, st.filled + 1);
    const back = Math.min(lag, st.filled - 1);
    const i = ((st.head - back + LAG_MAX) % LAG_MAX) * 3;

    const a = bright * Math.min(1, st.life * 1.2);
    if (a < 0.01) return;
    prepare(st.segs, st.hist[i], st.hist[i + 1], st.hist[i + 2], st.rot[0], st.rot[1], true);

    // stairs scale with the shape, so a small sphere wears into a coarse sphere, not a blob
    const globalStep = step;
    const radiusPx = (mesh.userData.r || 0.5) * unit * scale;
    if (step) step = Math.max(1.5 * u, Math.min(step, radiusPx * 0.22));

    const hue = Math.round((Math.round(st.hue * hueLevels) / hueLevels) * 360);
    // full colour on the hit, and a tint of it stays until the next bounce
    const sat = Math.round(45 + 55 * st.flash);
    const light = Math.round(80 - 22 * st.flash);
    for (let pass = 0; pass < 2; pass++) {
      g.lineWidth = (pass ? 1.3 : 5) * u;
      g.strokeStyle = `hsla(${hue},${sat}%,${light}%,${(pass ? 0.9 : 0.14 + 0.22 * st.flash) * a})`;
      g.beginPath();
      emitAll(st.segs.length, 0, 0);
      g.stroke();
    }
    // the electron guns drift out of convergence: a misregistered red ghost
    const conv = 7 * u * k * k;
    if (conv > 0.6) {
      g.lineWidth = 1.3 * u;
      g.strokeStyle = `rgba(255,70,110,${0.45 * a * k})`;
      g.beginPath();
      emitAll(st.segs.length, conv, conv * 0.35);
      g.stroke();
    }
    step = globalStep;
  }

  // FORMS's starfield, turning with the cube. Stars near or behind the
  // camera are skipped. As the system wears they snap to the grid and thin out.
  function drawStars(k, bright) {
    g.fillStyle = `rgba(200,255,220,${0.55 * bright * (1 - 0.45 * k)})`;
    const size = u * (1.1 + 0.4 * k);
    const tick = Math.floor(performance.now() / 70);
    const gone = 0.5 * k * k, flicker = 0.15 * Math.pow(k, 1.5);
    for (let i = 0; i < starPos.length; i += 3) {
      if (gone && hash(i ^ 0x2545f491) < gone) continue;
      if (flicker && hash(i + tick * 7919) < flicker) continue;
      const x = starPos[i] * unit, y = starPos[i + 1] * unit, z = starPos[i + 2] * unit;
      const x1 = x * cyA + z * syA, z1 = -x * syA + z * cyA;
      const y1 = y * cxA - z1 * sxA, z2 = y * sxA + z1 * cxA;
      const d = 3.2 + z2;
      if (d < 1.2) continue;
      const p = 3.2 / d;
      let sx = ox + x1 * p * scale, sy = oy - y1 * p * scale;
      if (sx < 0 || sy < 0 || sx > w || sy > h) continue;
      if (grid) { sx = qx(sx); sy = qy(sy); }
      g.fillRect(sx, sy, size, size);
    }
  }

  return {
    render,
    stats,
    clear: () => g.clearRect(0, 0, w, h),
    setDamage: (d) => { damage = d; },
  };
}

// The backdrop: black, CRT scanlines, and shade top and bottom (from the
// portfolio's cube view; no dot matrix, no rolling refresh band).
function createBackdrop() {
  const root = document.createElement('div');
  root.className = 'forms-bg';
  const style = document.createElement('style');
  style.textContent = `
    .forms-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; background: #000; }
    .forms-bg .shade { position: absolute; inset: 0; z-index: 1;
      background: linear-gradient(0deg, rgb(0 0 0 / 0.75), transparent 38%), linear-gradient(180deg, rgb(0 0 0 / 0.5), transparent 20%); }
    .forms-bg::before { content: ''; position: absolute; inset: 0; z-index: 2;
      background: repeating-linear-gradient(0deg, rgb(0 0 0 / 0.28) 0 1px, transparent 1px 3px); }
  `;
  document.head.appendChild(style);
  const shade = document.createElement('div');
  shade.className = 'shade';
  root.append(shade);
  return root;
}
