// "Crypt Crawl": an original soundtrack in two arrangements, with NES-style
// oscillators for the classic look and sampled instruments for the SNES look.
import { playSample } from './snes-audio.js';

const STORAGE_KEY = 'ugm-sound';
const MIX_LEVEL = { '8bit': 1, snes: 1.4 };
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
let mix = null;
let effects = null;
let noise = null;
const pulses = {};
let enabled = false;
let soundStyle = '8bit';
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

function resumeAudio() {
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

// Renders the soundtrack offline (used to export a preview WAV, never during normal visits).
export function renderOffline(seconds = 20, sampleRate = 44100, style = '8bit') {
  const saved = [ctx, master, mix, effects, noise, { ...pulses }];
  try {
    ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * seconds), sampleRate);
    buildGraph();
    mix = makeMix(MIX_LEVEL[style]);
    for (let i = 0, t = 0.05; t < seconds; i++, t += STEP) scheduleStep(style, i, t);
    return ctx.startRendering();
  } finally {
    [ctx, master, mix, effects, noise] = saved;
    Object.assign(pulses, saved[5]);
  }
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
  effects = makeMix(MIX_LEVEL[soundStyle]);
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

function makeMix(level = 1) {
  const gain = ctx.createGain();
  gain.gain.value = level;
  gain.connect(master);
  return gain;
}

function voice(freq, t, len, { wave = 'triangle', duty = 0.5, volume = 0.3, decay = null, slideTo = null, output = mix }) {
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
  osc.connect(g).connect(output);
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
  src.connect(f).connect(g).connect(mix);
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

function scheduleClassicStep(i, t) {
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

function sampled(instrument, note, time, length, volume, { pan = 0, slideTo, output = mix } = {}) {
  const frequency = note ? NOTE(note) : 220;
  playSample(ctx, output, instrument, frequency, time, length, { volume, pan, slideTo });
}

function scheduleSnesStep(i, t) {
  const bar = Math.floor(i / 16) % BARS;
  const s = i % 16;
  const chord = ARPS[bar];
  const bass = BASS[bar][s];
  const lead = MELODY[bar][s];
  if (s === 0) {
    chord.slice(0, 3).forEach((note, index) => sampled('strings', note, t, STEP * 15.9, 0.095, { pan: (index - 1) * 0.28 }));
    if (bar === 0) sampled('chime', 'D5', t, 0.9, 0.13, { pan: 0.24 });
  }
  if (bass !== '.') sampled('bass', bass, t, noteLength(BASS[bar], s, 4) * 0.94, 0.37);
  if (lead !== '.') sampled('flute', lead, t, noteLength(MELODY[bar], s, 8) * 0.85, 0.22, { pan: -0.2 });
  if (s % 2 === 0) sampled('mallet', chord[(s / 2) % chord.length], t, STEP * 1.8, s % 4 === 0 ? 0.15 : 0.1, { pan: 0.35 });
  if (s === 0 || s === 8) sampled('kick', null, t, 0.25, 0.3);
  if (s === 4 || s === 12) sampled('rim', null, t, 0.16, 0.2, { pan: -0.14 });
  if (s % 4 === 2) sampled('brush', null, t, 0.1, 0.1, { pan: 0.3 });
}

function scheduleStep(style, i, t) {
  if (style === 'snes') scheduleSnesStep(i, t);
  else scheduleClassicStep(i, t);
}

function tick() {
  const now = ctx.currentTime;
  // While a background tab throttles timers, skip missed notes and keep the beat.
  if (nextTime < now) {
    const missed = Math.ceil((now - nextTime) / STEP);
    nextTime += missed * STEP;
    step += missed;
  }
  while (nextTime < now + 0.15) {
    scheduleStep(soundStyle, step, nextTime);
    nextTime += STEP;
    step += 1;
  }
}

function startMusic() {
  if (!ensureContext() || timer) return;
  mix = makeMix(MIX_LEVEL[soundStyle]);
  resumeAudio();
  nextTime = ctx.currentTime + 0.06;
  step = 0;
  timer = setInterval(tick, 25);
}

function stopMusic() {
  clearInterval(timer);
  timer = null;
  mix?.disconnect();
  mix = null;
}

export function setSoundStyle(style) {
  if (style === soundStyle) return;
  soundStyle = style;
  if (effects) effects.gain.value = MIX_LEVEL[style];
  if (!mix || !timer) return;
  const oldMix = mix;
  const now = ctx.currentTime;
  const end = now + 0.06;
  if (oldMix.gain.cancelAndHoldAtTime) oldMix.gain.cancelAndHoldAtTime(now);
  else {
    oldMix.gain.cancelScheduledValues(now);
    oldMix.gain.setValueAtTime(oldMix.gain.value, now);
  }
  oldMix.gain.linearRampToValueAtTime(0, end);
  mix = makeMix(0);
  mix.gain.setValueAtTime(0, now);
  mix.gain.linearRampToValueAtTime(MIX_LEVEL[style], end);
  setTimeout(() => oldMix.disconnect(), 90);
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

// Direct interaction speaks independently of the soundtrack.
export function sfx(name) {
  if (name !== 'lantern' && name !== 'door' && (!enabled || !mix)) return;
  if (!ensureContext()) return;
  resumeAudio();
  const t = ctx.currentTime + 0.01;
  const output = effects;
  if (soundStyle === 'snes') {
    if (name === 'lantern') {
      sampled('switch', null, t, 0.08, 0.6, { output });
    } else if (name === 'door') {
      sampled('wood', 'C3', t, 0.36, 0.33, { output, slideTo: NOTE('G2') });
    } else if (name === 'alive') {
      ['D4', 'F4', 'A4', 'D5', 'F#5'].forEach((note, i) => sampled('chime', note, t + i * 0.09, 0.48, 0.28, { output }));
    } else if (name === 'dead') {
      sampled('mallet', 'Eb3', t, 0.26, 0.29, { output });
      sampled('bass', 'D3', t + 0.23, 0.85, 0.34, { output, slideTo: NOTE('D2') });
    }
    return;
  }
  if (name === 'door') {
    // A creaking door: a low pulse bending down.
    voice(NOTE('A2'), t, 0.35, { output, wave: 'pulse', duty: 0.125, volume: 0.18, slideTo: NOTE('F2') });
  } else if (name === 'alive') {
    // Minor arpeggio that resolves to major: life returns.
    ['D4', 'F4', 'A4', 'D5', 'F#5'].forEach((n, i) => voice(NOTE(n), t + i * 0.09, 0.2, { output, wave: 'pulse', duty: 0.25, volume: 0.14, decay: 0.25 }));
  } else if (name === 'dead') {
    voice(NOTE('Eb3'), t, 0.25, { output, wave: 'pulse', duty: 0.5, volume: 0.15, decay: 0.3 });
    voice(NOTE('D3'), t + 0.3, 1.1, { output, wave: 'pulse', duty: 0.5, volume: 0.15, slideTo: NOTE('D2') });
  }
}

// Unlock audio on the first gesture, including effects triggered after an auto-walk.
export function initSound() {
  enabled = readPref();
  const resume = () => {
    window.removeEventListener('pointerdown', resume, true);
    window.removeEventListener('keydown', resume, true);
    if (enabled) startMusic();
    else if (ensureContext()) resumeAudio();
  };
  window.addEventListener('pointerdown', resume, true);
  window.addEventListener('keydown', resume, true);
  if (enabled) for (const fn of listeners) fn(true);
}
