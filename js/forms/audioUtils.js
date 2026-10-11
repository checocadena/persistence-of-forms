import { rules, chime } from '../decay/index.js';

let audioEffects = null;

export const setupAudio = async () => {
  try {
    // Only start Tone.js if we haven't already
    if (Tone.context.state !== 'running') {
      console.log('Waiting for user interaction to start audio...');
      return null;
    }
    
    console.log('Setting up audio effects...');
    audioEffects = {
      mainFilter: new Tone.Filter(1300, 'lowpass').toDestination(),
      compressor: new Tone.Compressor(-24, 3),
      reverb: new Tone.Reverb({ decay: 20, wet: 0.3 }),
      chorus: new Tone.Chorus(4, 2.5, 0.5),
      delay: new Tone.FeedbackDelay("8n", 0.5)
    };

    // Connect the audio effects chain
    audioEffects.compressor.connect(audioEffects.mainFilter);
    audioEffects.reverb.connect(audioEffects.compressor);
    audioEffects.chorus.connect(audioEffects.compressor);
    audioEffects.delay.connect(audioEffects.compressor);

    console.log('Audio effects initialized successfully');
    return audioEffects;
  } catch (error) {
    console.error('Error setting up audio effects:', error);
    throw error;
  }
};

export const majorPentatonicScale = [261.63, 293.66, 329.63, 349.23, 392.00, 523.25, 587.33, 659.26, 698.46, 783.99];

export const initAudioContext = async () => {
  try {
    if (Tone.context.state !== 'running') {
      console.log('Waiting for user interaction to start audio...');
      return;
    }
    console.log('Audio context initialized');
  } catch (error) {
    console.error('Error initializing audio context:', error);
    throw error;
  }
};

// Voiced by the portfolio's engine (decay/voice.js): 5 ms attack, 1.6 s decay,
// note from the height of the hit, panned to the side it struck.
const HALF_BOX = 5; // main.js boundarySize / 2
export const playShapeNote = (shape, activeOscillators, audioEffects, MAX_POLYPHONY = 6) => {
  chime(rules.waveFor(shape.geometry.type), shape.position.y / HALF_BOX, shape.position.x / HALF_BOX);
};
