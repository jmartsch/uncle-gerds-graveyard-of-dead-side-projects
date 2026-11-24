// Original instrument samples for the SNES arrangement. Each sample is stored as
// 16-bit-quantized PCM with a short stereo room reflection baked into the buffer.
const SAMPLE_RATE = 32000;
const ROOT = 220;
const TAU = 2 * Math.PI;
const banks = new WeakMap();

const instruments = {
  bass: [0.85, (t, p) => (0.72 * Math.sin(p) + 0.22 * Math.sin(2 * p) + 0.06 * Math.sin(3 * p)) * Math.exp(-3 * t)],
  mallet: [1.1, (t, p) => 0.72 * Math.sin(p) * Math.exp(-6 * t) + 0.24 * Math.sin(2.75 * p) * Math.exp(-24 * t)],
  flute: [1.9, (t, p) => {
    const vibrato = 0.3 * Math.sin(TAU * 4.8 * t) * Math.min(1, t * 3);
    return Math.min(1, t * 22) * Math.exp(-t * 0.7) * (0.76 * Math.sin(p + vibrato) + 0.12 * Math.sin(2 * p + vibrato));
  }],
  strings: [3.1, (t, p) => Math.min(1, t * 9) * (
    0.36 * Math.sin(p) + 0.29 * Math.sin(1.006 * p) + 0.16 * Math.sin(2 * p) + 0.08 * Math.sin(3.02 * p)
  )],
  chime: [1.6, (t, p) => 0.55 * Math.sin(p) * Math.exp(-3 * t) + 0.28 * Math.sin(p * 2.01) * Math.exp(-7 * t) + 0.13 * Math.sin(p * 3.87) * Math.exp(-13 * t)],
  kick: [0.28, (t) => Math.sin(TAU * (42 * t + 1.5 * (1 - Math.exp(-40 * t)))) * Math.exp(-16 * t)],
  rim: [0.22, (t, p, noise) => 0.65 * noise * Math.exp(-34 * t) + 0.28 * Math.sin(p * 1.73) * Math.exp(-28 * t)],
  brush: [0.13, (t, _p, noise) => noise * Math.exp(-72 * t)],
  wood: [0.55, (t, p, noise) => (0.47 * Math.sin(p) + 0.27 * Math.sin(1.62 * p) + 0.12 * noise) * Math.exp(-8 * t)],
};

function getSample(ctx, name) {
  if (!banks.has(ctx)) banks.set(ctx, new Map());
  const bank = banks.get(ctx);
  if (bank.has(name)) return bank.get(name);
  const [seconds, wave] = instruments[name];
  const length = Math.round(SAMPLE_RATE * seconds);
  const dry = new Float32Array(length);
  let seed = 781;
  let previous = 0;
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 2 ** 31 - 1;
    const noise = (white - previous) * 0.5;
    previous = white;
    const envelope = Math.min(1, i / 40, (length - i) / (SAMPLE_RATE * 0.045));
    dry[i] = wave(t, TAU * ROOT * t, noise) * envelope;
  }

  const sample = ctx.createBuffer(2, length, SAMPLE_RATE);
  [0.039, 0.067].forEach((delay, channel) => {
    const pcm = sample.getChannelData(channel);
    const offset = Math.round(delay * SAMPLE_RATE);
    for (let i = 0; i < length; i++) {
      const tail = Math.min(1, (length - i) / (SAMPLE_RATE * 0.025));
      const value = tail * (dry[i] + 0.16 * (dry[i - offset] ?? 0));
      pcm[i] = Math.round(Math.max(-1, Math.min(1, value)) * 32767) / 32767;
    }
  });
  bank.set(name, sample);
  return sample;
}

export function playSample(ctx, output, name, freq, time, duration, { volume, pan = 0, slideTo } = {}) {
  const source = ctx.createBufferSource();
  source.buffer = getSample(ctx, name);
  source.playbackRate.setValueAtTime(freq / ROOT, time);
  if (slideTo) source.playbackRate.exponentialRampToValueAtTime(slideTo / ROOT, time + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, time);
  gain.gain.setValueAtTime(volume, time + duration * 0.82);
  gain.gain.linearRampToValueAtTime(0, time + duration);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  source.connect(gain).connect(panner).connect(output);
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    panner.disconnect();
  };
  source.start(time);
  source.stop(time + duration);
}
