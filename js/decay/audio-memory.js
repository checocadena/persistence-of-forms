// Splices the memory worklet in between the voice engine's master and its
// limiter (so the limiter also catches the loop's echoes). If the worklet
// can't load, the dry routing stays — the piece keeps sounding no matter what.

/* global Tone */

export async function attachAudioMemory(voice, { seconds = 6 } = {}) {
  const stats = { bits: 16, cutoff: 18000, lapSemis: 0, feedback: 0 };
  const ctx = Tone.getContext();
  try {
    await ctx.addAudioWorkletModule(new URL('./memory-worklet.js', import.meta.url).href, 'forms-memory');
    const node = ctx.createAudioWorkletNode('forms-memory', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { seconds },
    });
    node.port.onmessage = (e) => Object.assign(stats, e.data);
    voice.master.disconnect();
    voice.master.connect(node);
    node.connect(voice.limiter);
    return {
      stats,
      setDamage: (damage) => node.port.postMessage({ damage }),
      clear: () => node.port.postMessage({ clear: true }),
    };
  } catch (err) {
    console.error('[decay] audio memory unavailable, playing clean:', err);
    return null;
  }
}
