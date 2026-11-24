// "Crypt Crawl": an original, dark 8-bit soundtrack (NES-style channels: two pulse waves, a triangle
// and noise), composed for this museum. D minor with a phrygian Eb, slow and low, with a tolling bell.
// Synthesized live with the Web Audio API. Off until the visitor turns it on.

const STORAGE_KEY = 'ugm-sound';
const BPM = 88;
const STEP = 60 / BPM / 4; // one 16th note in seconds
const BARS = 4;
const LOOP = 16 * BARS;

const NOTE = (name) => {
  const m = name.match(/^([A-G])([#b]?)(\d)$/);
  const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * 2 ** ((semis - 9) / 12 + (Number(m[3]) - 4));
};
const bars = (...rows) => rows.map((row) => row.trim().split(/\s+/));

// Triangle bass: a slow, heavy walk with the phrygian half step (D–Eb) that makes it sound like a crypt.
const BASS = bars(
  'D2 .  .  .  D2 .  .  .  Eb2 . .  .  D2 .  C2 .',
  'D2 .  .  .  D2 .  .  .  F2 .  .  .  Eb2 . .  .',
  'Bb1 . .  .  Bb1 . .  .  C2 .  .  .  Bb1 . A1 .',
  'A1 .  .  .  A1 .  .  .  A1 .  Bb1 . C#2 . .  .',
);

// Thin 12.5% pulse: a sparse lament, enters on the second round.
const MELODY = bars(
  'A4 .  .  .  .  .  .  .  Bb4 . .  .  A4 .  .  .',
  'F4 .  .  .  .  .  .  .  E4 .  .  .  D4 .  .  .',
  'D4 .  .  .  .  .  .  .  F4 .  .  .  E4 .  .  .',
  'C#4 . .  .  .  .  .  .  .  .  .  .  .  .  .  .',
);

// 25% pulse arpeggio: quiet broken chords on every eighth, from the second round on.
const ARPS = [
  ['D3', 'F3', 'A3', 'F3'],
  ['D3', 'F3', 'A3', 'Eb3'],
  ['Bb2', 'D3', 'F3', 'D3'],
  ['A2', 'C#3', 'E3', 'G3'],
];

let ctx = null;
let master = null;
let noise = null;
const pulses = {};
let enabled = false;
let timer = null;
let nextTime = 0;
let step = 0;
const listeners = new Set();

function readPref() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

function writePref(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {}
}

function ensureContext() {
  if (ctx) return ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  ctx = new AudioCtx();
  return buildGraph();
}

// Renders the soundtrack offline (used to export a preview WAV, never during normal visits).
export async function renderOffline(seconds = 20, sampleRate = 44100) {
  const saved = [ctx, master, noise, { ...pulses }];
  ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
  buildGraph();
  for (let i = 0, t = 0.05; t < seconds; i++, t += STEP) scheduleStep(i, t);
  const buffer = await ctx.startRendering();
  [ctx, master, noise] = saved;
  Object.assign(pulses, saved[3]);
  return buffer;
}

// A pulse wave with a given duty cycle, like the NES square channels (12.5%, 25%, 50%).
function pulseWave(duty) {
  const n = 64;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(real, imag);
}

function buildGraph() {
  master = ctx.createGain();
  master.gain.value = 0.55;
  // A gentle lowpass takes the harsh edge off without losing the chiptune bite.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 5200;
  master.connect(tone).connect(ctx.destination);
  pulses[0.125] = pulseWave(0.125);
  pulses[0.25] = pulseWave(0.25);
  pulses[0.5] = pulseWave(0.5);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  // Short-period noise like the NES noise channel: hold each random value for a few samples.
  let v = 0;
  for (let i = 0; i < d.length; i++) {
    if (i % 4 === 0) v = Math.random() * 2 - 1;
    d[i] = v;
  }
  return ctx;
}

function voice(freq, t, len, { wave = 'triangle', duty = 0.5, volume = 0.3, decay = null, slideTo = null }) {
  const osc = ctx.createOscillator();
  if (wave === 'pulse') osc.setPeriodicWave(pulses[duty]);
  else osc.type = wave;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, t);
  if (decay) g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  else {
    g.gain.setValueAtTime(volume, t + len * 0.85);
    g.gain.linearRampToValueAtTime(0, t + len);
  }
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + Math.max(len, decay || 0) + 0.02);
}

function thump(t) {
  // Low kick: a triangle dropping in pitch, plus a click of noise.
  voice(110, t, 0.18, { wave: 'triangle', volume: 0.9, decay: 0.18, slideTo: 38 });
  hiss(t, { freq: 900, volume: 0.25, decay: 0.03 });
}

function hiss(t, { freq = 6000, volume = 0.08, decay = 0.04, type = 'highpass' } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + decay + 0.02);
}

// The bell: two detuned pulses an octave and a fifth apart, ringing out slowly.
function bell(t) {
  voice(NOTE('D5'), t, 2.4, { wave: 'pulse', duty: 0.5, volume: 0.09, decay: 2.4 });
  voice(NOTE('A5') * 1.003, t, 2.0, { wave: 'pulse', duty: 0.25, volume: 0.05, decay: 2.0 });
  voice(NOTE('D4'), t, 2.6, { wave: 'triangle', volume: 0.2, decay: 2.6 });
}

function noteLength(row, s, cap) {
  let k = 1;
  while (s + k < 16 && row[s + k] === '.' && k < cap) k++;
  return k * STEP;
}

function scheduleStep(i, t) {
  const round = Math.floor(i / LOOP);
  const bar = Math.floor(i / 16) % BARS;
  const s = i % 16;

  const b = BASS[bar][s];
  if (b !== '.') voice(NOTE(b), t, noteLength(BASS[bar], s, 4) * 0.95, { wave: 'triangle', volume: 0.55 });

  if (s === 0 || s === 8) thump(t);
  if (s === 12) hiss(t, { freq: 1800, volume: 0.18, decay: 0.12, type: 'bandpass' }); // muffled snare
  if (s % 4 === 2) hiss(t, { volume: 0.05, decay: 0.03 }); // faint ticking, like a clock in an empty hall

  if (bar === 0 && s === 0) bell(t);

  if (round > 0 && s % 2 === 0) {
    const arp = ARPS[bar];
    voice(NOTE(arp[(s / 2) % arp.length]), t, STEP * 1.6, { wave: 'pulse', duty: 0.25, volume: 0.06, decay: STEP * 1.6 });
  }

  const m = MELODY[bar][s];
  if (round > 0 && m !== '.') {
    const len = noteLength(MELODY[bar], s, 16);
    voice(NOTE(m), t, len * 0.9, { wave: 'pulse', duty: 0.125, volume: 0.11 });
  }
}

function tick() {
  while (nextTime < ctx.currentTime + 0.15) {
    scheduleStep(step, nextTime);
    nextTime += STEP;
    step += 1;
    if (step >= LOOP * 4) step = LOOP; // after the intro round, loop the full arrangement
  }
}

function startMusic() {
  if (!ensureContext() || timer) return;
  ctx.resume();
  nextTime = ctx.currentTime + 0.06;
  step = 0;
  timer = setInterval(tick, 25);
}

function stopMusic() {
  clearInterval(timer);
  timer = null;
  if (ctx) ctx.suspend();
}

export function isSoundOn() {
  return enabled;
}

export function setSound(on) {
  enabled = on;
  writePref(on);
  if (on) startMusic();
  else stopMusic();
  for (const fn of listeners) fn(on);
}

export function onSoundChange(fn) {
  listeners.add(fn);
}

// Short effects, only when the visitor has turned sound on.
export function sfx(name) {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime + 0.01;
  if (name === 'door') {
    // A creaking door: a low pulse bending down.
    voice(NOTE('A2'), t, 0.35, { wave: 'pulse', duty: 0.125, volume: 0.18, slideTo: NOTE('F2') });
  } else if (name === 'alive') {
    // Minor arpeggio that resolves to major: life returns.
    ['D4', 'F4', 'A4', 'D5', 'F#5'].forEach((n, i) => voice(NOTE(n), t + i * 0.09, 0.2, { wave: 'pulse', duty: 0.25, volume: 0.14, decay: 0.25 }));
  } else if (name === 'dead') {
    voice(NOTE('Eb3'), t, 0.25, { wave: 'pulse', duty: 0.5, volume: 0.15, decay: 0.3 });
    voice(NOTE('D3'), t + 0.3, 1.1, { wave: 'pulse', duty: 0.5, volume: 0.15, slideTo: NOTE('D2') });
  }
}

// A stored "on" preference can only start audio after the first user gesture (browser autoplay rules).
export function initSound() {
  if (!readPref()) return;
  enabled = true;
  const resume = () => {
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
    if (enabled) startMusic();
  };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
  for (const fn of listeners) fn(true);
}
