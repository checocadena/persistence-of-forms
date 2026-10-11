# FORMS / decay

FORMS (from checocadena.com, `public/Forms.html` + `public/js/forms/`) running as a
gallery piece whose **memory** wears out over a 10-day exhibition. The shapes and
bounces stay the same; the sound, the picture and the rules erode.

```
npm start            # http://localhost:8090  (no dependencies; three + Tone are vendored)
npm test             # damage curve + seeded mutation tests
npm run soak -- 20   # 20-minute headless memory soak (server must be running)
```

## URL params

| param | effect |
|---|---|
| `?timescale=N` | multiplies elapsed time. `10000` = the whole 10 days in ~86 s. Test runs use their own stored start time, so they never age the real exhibition clock. |
| `?damage=0..1` | pins damage (clamped to the 0.92 floor). Mutations follow it. |
| `?reset=1` | clears the stored start time(s), then strips itself from the URL so a refresh can't heal the piece again. |
| `?days=N` | exhibition length (default 10). |
| `?controls=1` | shows FORMS's original buttons and cursor (hidden for visitors by default). |

Keys: **D** toggles the debug HUD. Holding **Shift+R** for 3 s starts a fresh exhibition clock in place (audio and visual memory cleared, rules back to pristine) without a reload.

## How it's built

FORMS is unchanged apart from a handful of lines (see `js/forms/*.js`); everything new is in `js/decay/`:

- `clock.js`: the single source of truth. `damage = 0.92 · t^2.5`, start time in localStorage.
- `voice.js`: the sound engine from checocadena.com (`src/signal/audio.js`). Each bounce plays a chime with a 5 ms attack and a 1.6 s decay; the height of the hit picks the note and the side of the box sets the pan. Up to 6 voices, with a soft steal and at least 45 ms between notes. Underneath is the site's detuned pad, moving through its chords every 60 s, with a convolution reverb, a 0.36 s delay, and a limiter at the very end. Late in the run the whole engine sags: pitch falls with k³ (barely at all for most of the show, −1.5 octaves at the floor), with a slow tape-like wobble, and each note droops as it rings. The tempo is the portfolio's slowed to about 0.6×: up to 7 shapes, a new one every 0.6–2.7 s, plus slower travel, speed swing, camera orbit and spin.
- `memory-worklet.js` / `audio-memory.js`: a 6 s stereo loop between the engine's master and its limiter. `out = live + feedback·recall(memory)`, and `memory = degrade(out)`. As damage rises the memory doesn't crackle, it sinks. Recall reads through a two-grain pitch shifter, so each lap comes back lower (up to −2.5 semitones per lap, spiralling down), and a lowpass closes from 18 kHz to 500 Hz. Requantising is gentle (16 → 8 bits, dithered), and occasionally a moment fades out of memory. Live input is never processed by the loop.
- `rules.js`: the chimes play from a scale built on the drone's current chord: its chord tones, rising from C4. When the pad changes chord, the shapes change key with it, so a clean system is always in key. The rules are 10 slots into that scale plus the shape→waveform map. There are 240 mutations (one per exhibition hour on average, front-loaded to the late days), and mutation *k* comes from `mulberry32(SEED ^ k)`. Early errors mostly swap slots (still chord tones, but height stops meaning pitch); slots going off key by semitones mostly happen late. Collapses and drops are occasional. Over seeds, notes are about 99% in key on day 2, 88% on day 5, 65% on day 7 and 42% at the end. SEED 986666 was picked because its history is typical.
- `scope.js`: draws FORMS's scene the way the checocadena.com cube view does (`SignalScope` + `bouncers` + `CubeFocus`). That means a 2D-canvas phosphor beam (glow pass plus core, persistence trails), the portfolio's tilted camera and layout, a faint thin box, and shapes of varied size (the portfolio's r 0.07–0.13 of the box ×1.4; tetra ×1.6, cube ×1.3). Shapes fade in, flash a strong colour on each bounce that fades over about 1.5 s to a tint that stays until the next bounce, and once out of bounces keep flying while they fade away; FORMS removes them when they're faded. Behind it: black, CRT scanlines, and top/bottom shade (no dot matrix, no rolling refresh band). FORMS's starfield turns with the cube; the spin is half FORMS's original orbit rate (0.0005 rad/frame). Three.js still runs the physics but no longer paints. Everything is at 0.6× the portfolio's tempo, and the phosphor holds a little longer so trails stay as long. The decay acts on the forms themselves, in the same chain as the audio:
  - bit depth snaps vertices to a coarsening grid (12 → 8 bits; each shape's stairs are capped by its own size, so small shapes stay legible)
  - sample rate turns edges into sample-and-hold staircases
  - bit flips occasionally throw one of a shape's vertices off as a spike (never the cube's); every edge and vertex is always drawn
  - memory draws each shape up to 36 frames behind where it really is, so the picture drifts out of sync with its own bounce sounds
  - the phosphor holds longer and the guns drift out of convergence (a red ghost)
- `kiosk.js`: fullscreen on the start click, a screen wake lock (re-acquired), AudioContext auto-resume, and hidden buttons/cursor.
- `hud.js` and `index.js`: the HUD and the glue.

Edits to the FORMS copy (rendering is replaced by `scope.js`, which reads FORMS's scene; nothing in FORMS's simulation changed): the importmap and Tone now point at `vendor/`, `main.js` calls `startDecay()` and `decay.render()`, `audioUtils.js`'s `playShapeNote` hands each bounce to `voice.js` (waveform from `rules`), and `main.js`/`shapeUtils.js` use the portfolio's tempo (spawn interval, max shapes, speed, wall clamp). Two leak fixes for a multi-day run: removed shapes now dispose their geometry and material, and FORMS's Tone oscillators are no longer created per note.
