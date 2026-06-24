/**
 * Built-in effects — a useful subset of Mixxx's 24, built as NATIVE Web Audio
 * nodes (06-ui-controllers-effects.md §3 mapping table). The DSP runs in the
 * browser's optimized C++ (BiquadFilter/Delay/Convolver/WaveShaper), NOT in JS,
 * so these satisfy the "zero heavy lifting in JS" rule (10 §0) for free.
 *
 * Each factory returns an EffectInstance: an input→[nodes]→output subgraph + a
 * setParam(key, value). The unit handles wet/dry mixing.
 */

import type { EffectInstance, RegisteredEffect, EffectManifest } from './effect-types.js';

// --- Filter (combined LPF + HPF — the QuickEffect default) ------------------

const FILTER_MANIFEST: EffectManifest = {
  id: 'filter',
  name: 'Filter',
  params: [
    {
      key: 'lpf',
      label: 'LPF',
      min: 20,
      max: 22000,
      default: 22000,
      defaultLink: 'linkedLeft',
      scale: 'log',
      neutral: 1,
    },
    {
      key: 'hpf',
      label: 'HPF',
      min: 20,
      max: 22000,
      default: 20,
      defaultLink: 'linkedRight',
      scale: 'log',
      neutral: 0,
    },
    { key: 'q', label: 'Resonance', min: 0.1, max: 10, default: 0.7, defaultLink: 'none' },
  ],
};

function createFilter(ctx: BaseAudioContext): EffectInstance {
  const hpf = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 20, Q: 0.7 });
  const lpf = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 22000, Q: 0.7 });
  hpf.connect(lpf);
  return {
    manifest: FILTER_MANIFEST,
    input: hpf,
    output: lpf,
    setParam(key, value) {
      if (key === 'lpf') lpf.frequency.value = value;
      else if (key === 'hpf') hpf.frequency.value = value;
      else if (key === 'q') {
        lpf.Q.value = value;
        hpf.Q.value = value;
      }
    },
    dispose() {
      hpf.disconnect();
      lpf.disconnect();
    },
  };
}

// --- Echo (feedback delay) --------------------------------------------------

const ECHO_MANIFEST: EffectManifest = {
  id: 'echo',
  name: 'Echo',
  params: [
    { key: 'time', label: 'Time', min: 0.01, max: 2, default: 0.3, defaultLink: 'linked' },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, default: 0.5, defaultLink: 'none' },
  ],
};

function createEcho(ctx: BaseAudioContext): EffectInstance {
  const input = new GainNode(ctx, { gain: 1 });
  const delay = new DelayNode(ctx, { delayTime: 0.3, maxDelayTime: 2 });
  const feedback = new GainNode(ctx, { gain: 0.5 });
  const output = new GainNode(ctx, { gain: 1 });
  // input → delay → output; delay → feedback → delay (loop)
  input.connect(delay);
  delay.connect(output);
  delay.connect(feedback);
  feedback.connect(delay);
  return {
    manifest: ECHO_MANIFEST,
    input,
    output,
    setParam(key, value) {
      if (key === 'time') delay.delayTime.value = value;
      else if (key === 'feedback') feedback.gain.value = value;
    },
    dispose() {
      input.disconnect();
      delay.disconnect();
      feedback.disconnect();
      output.disconnect();
    },
  };
}

// --- Reverb (convolution with a synthesized impulse) ------------------------

const REVERB_MANIFEST: EffectManifest = {
  id: 'reverb',
  name: 'Reverb',
  params: [{ key: 'decay', label: 'Decay', min: 0.1, max: 8, default: 2, defaultLink: 'linked' }],
};

/** Build a synthetic exponential-decay noise impulse response. */
function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(seconds * rate));
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      // white noise × exponential decay (pseudo-random; deterministic seed-free)
      const noise = ((i * 9301 + 49297) % 233280) / 233280 - 0.5;
      data[i] = noise * 2 * Math.pow(1 - i / len, 2.5);
    }
  }
  return buf;
}

function createReverb(ctx: BaseAudioContext): EffectInstance {
  const input = new GainNode(ctx, { gain: 1 });
  const convolver = new ConvolverNode(ctx, { buffer: makeImpulse(ctx, 2) });
  input.connect(convolver);
  return {
    manifest: REVERB_MANIFEST,
    input,
    output: convolver,
    setParam(key, value) {
      if (key === 'decay') {
        convolver.buffer = makeImpulse(ctx, value);
      }
    },
    dispose() {
      input.disconnect();
      convolver.disconnect();
    },
  };
}

// --- Distortion (waveshaper) ------------------------------------------------

const DISTORTION_MANIFEST: EffectManifest = {
  id: 'distortion',
  name: 'Distortion',
  params: [{ key: 'drive', label: 'Drive', min: 0, max: 100, default: 20, defaultLink: 'linked' }],
};

function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function createDistortion(ctx: BaseAudioContext): EffectInstance {
  const shaper = new WaveShaperNode(ctx, {
    curve: makeDistortionCurve(20),
    oversample: '2x',
  });
  return {
    manifest: DISTORTION_MANIFEST,
    input: shaper,
    output: shaper,
    setParam(key, value) {
      if (key === 'drive') {
        shaper.curve = makeDistortionCurve(value);
      }
    },
    dispose() {
      shaper.disconnect();
    },
  };
}

// --- Bitcrusher (waveshaper quantize approximation, native) -----------------

const BITCRUSHER_MANIFEST: EffectManifest = {
  id: 'bitcrusher',
  name: 'Bitcrusher',
  params: [{ key: 'bits', label: 'Bits', min: 1, max: 16, default: 8, defaultLink: 'linked' }],
};

function makeBitcrushCurve(bits: number): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const levels = Math.pow(2, Math.max(1, bits));
  const step = 2 / levels;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x / step) * step; // quantize amplitude
  }
  return curve;
}

function createBitcrusher(ctx: BaseAudioContext): EffectInstance {
  // Amplitude quantization via a waveshaper (native). Note: true sample-rate
  // reduction needs a worklet; bit-depth crush is well-approximated natively.
  const shaper = new WaveShaperNode(ctx, { curve: makeBitcrushCurve(8) });
  return {
    manifest: BITCRUSHER_MANIFEST,
    input: shaper,
    output: shaper,
    setParam(key, value) {
      if (key === 'bits') {
        shaper.curve = makeBitcrushCurve(Math.round(value));
      }
    },
    dispose() {
      shaper.disconnect();
    },
  };
}

/** The built-in effect registry. */
export const BUILTIN_EFFECTS: RegisteredEffect[] = [
  { manifest: FILTER_MANIFEST, create: createFilter },
  { manifest: ECHO_MANIFEST, create: createEcho },
  { manifest: REVERB_MANIFEST, create: createReverb },
  { manifest: DISTORTION_MANIFEST, create: createDistortion },
  { manifest: BITCRUSHER_MANIFEST, create: createBitcrusher },
];

export function getEffect(id: string): RegisteredEffect | undefined {
  return BUILTIN_EFFECTS.find((e) => e.manifest.id === id);
}
