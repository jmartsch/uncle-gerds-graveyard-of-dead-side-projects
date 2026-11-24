import { DEV_A, DEV_B, DEV_BLINK, UNCLE, UNCLE_BLINK, UNCLE_TWITCH, UNCLE_TWITCH_BLINK, UNCLE_TAP, UNCLE_TAP_BLINK, DOOR, TOMB, BAT_UP, BAT_DOWN, PALETTE, paintPixels } from './pixels.js';
import { sfx, setSound, isSoundOn, onSoundChange, initSound } from './sound.js';

// ---------- constants ----------
const W = 960;
const H = 540;
const FLOOR = 452;
const SCALE = 4;
const FIRST_DOOR = 660;
const DOOR_GAP = 330;
const UNCLE_X = 330;
const SPEED = 260;
const UNCLE_SPEED = 230;
const FONT_PIXEL = '"Press Start 2P", monospace';
const FONT_BODY = '"VT323", monospace';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const GREETING = 'Ach, Junge. Welcome to your graveyard. Walk right, I will show you around.';
const GREETING_EMPTY = 'Na ja. No dead projects at all? Come back in a year, Junge.';
const NIGHT_GREETING = 'Ach, Junge. Welcome to your graveyard. Mind the graves, I will show you around.';
const NIGHT_LINES = [
  'Mind your step. Some of these still compile.',
  "Hear that? Not a bat. A deprecation warning.",
  'In 1998 we buried our code on floppy disks.',
  "Na ja. At least the dead don't open issues.",
  "Go on, visit one. They won't bite. Most of them don't even run.",
];
const UNCLE_LINES = [
  "Mind the floor. It's older than your node_modules.",
  'Every door here is a promise you did not keep.',
  'In 1998 we had one server. And it ran!',
  'Na ja. At least you wrote a README. Sometimes.',
  'Go on, open one. They do not bite. Most of them do not even run.',
];
// What Uncle Gerd mutters at a door: the line Ollama wrote for this repo, or one built from its facts.
const QUIP_TEMPLATES = [
  (ex) => ex.lastWords && ex.lastWords !== '(no last words)' && `"${ex.lastWords.slice(0, 48)}"… famous last words, Junge.`,
  (ex) => ex.stars > 0 && `${ex.stars} star${ex.stars === 1 ? '' : 's'}, and still nobody watered it.`,
  (ex) => ex.language && ex.language !== 'mystery code' && `${ex.language}! Smell that? Vintage ${ex.years.split('–')[1]}.`,
  (ex) => ex.lifespanDays && `${ex.lifespanDays} days of life. My cardigan has lasted longer.`,
  (ex) => ex.years && `${ex.years}. I remember those years. Mostly the coffee.`,
  (ex) => ex.openIssues > 0 && `${ex.openIssues} open issue${ex.openIssues === 1 ? '' : 's'}, still waiting for an answer.`,
];

function doorQuip(ex, index) {
  if (ex.uncle?.quip) return ex.uncle.quip;
  // Rotate through the templates so neighbouring doors never say the same kind of thing.
  for (let k = 0; k < QUIP_TEMPLATES.length; k++) {
    const line = QUIP_TEMPLATES[(index + k + (hash(ex.id) % 2)) % QUIP_TEMPLATES.length](ex);
    if (line) return line;
  }
  return 'Ach, this one. Come in, come in.';
}

// ---------- state ----------
const state = { data: null, scene: null, open: null, poll: null, admin: readAdminKey(), theme: readTheme(), lastX: null };
const night = () => state.theme === 'graveyard';

function readTheme() {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  if (fromUrl === 'museum' || fromUrl === 'graveyard') return fromUrl;
  try {
    // The graveyard is the default; the museum only when someone picked it.
    return localStorage.getItem('ugm-theme') === 'museum' ? 'museum' : 'graveyard';
  } catch {
    return 'graveyard';
  }
}
const dlg = document.getElementById('room');

function readAdminKey() {
  const params = new URLSearchParams(location.search);
  const key = params.get('key');
  if (key) {
    try {
      sessionStorage.setItem('ugm-key', key);
    } catch {}
    params.delete('key');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
    return key;
  }
  try {
    return sessionStorage.getItem('ugm-key') || '';
  } catch {
    return '';
  }
}

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(state.admin ? { 'x-admin-key': state.admin } : {}) };
  const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ---------- helpers ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

const safeHref = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const link = (href, text) => (safeHref(href) ? el('a', { href: safeHref(href), target: '_blank', rel: 'noopener' }, text) : text);
const pct = (p) => (p == null ? '?' : `${Math.round(p * 100)}%`);
const oddsColor = (p) => (p == null ? '#c9c2b6' : p < 0.33 ? '#ff7a7a' : p < 0.66 ? '#ffcf5a' : '#6dff9e');
const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const focusGame = () => document.getElementById('game')?.focus({ preventScroll: true });
const focusIsInteractive = () => Boolean(document.activeElement?.closest?.('button, a, input, textarea, select, summary, dialog'));

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 6000);
}

const textStyle = (font, size, color, extra = {}) => ({ fontFamily: font, fontSize: `${size}px`, color, ...extra });

// ---------- the hallway ----------
class MuseumScene extends Phaser.Scene {
  constructor() {
    super('museum');
  }

  create() {
    state.scene = this;
    const exhibits = state.data.exhibits;
    this.worldW = Math.max(W, FIRST_DOOR + Math.max(exhibits.length - 1, 0) * DOOR_GAP + 620);

    this.makeTexture('dev-a', DEV_A);
    this.makeTexture('dev-b', DEV_B);
    this.makeTexture('uncle', UNCLE);
    this.makeTexture('dev-blink', DEV_BLINK);
    this.makeTexture('uncle-blink', UNCLE_BLINK);
    this.makeTexture('uncle-twitch', UNCLE_TWITCH);
    this.makeTexture('uncle-twitch-blink', UNCLE_TWITCH_BLINK);
    this.makeTexture('door', DOOR);
    this.makeTexture('tomb', TOMB);
    this.makeTexture('bat-up', BAT_UP);
    this.makeTexture('bat-down', BAT_DOWN);

    this.night = night();
    if (this.night) {
      this.drawNight();
      this.drawGraveEntrance();
    } else {
      this.drawHall();
      this.drawEntrance();
    }
    this.doors = exhibits.map((ex, i) => this.drawDoor(ex, FIRST_DOOR + i * DOOR_GAP));
    if (this.night) this.drawCrypt(this.worldW - 230);
    else this.drawGiftShop(this.worldW - 230);

    // Coming back from a theme switch: stand where you stood, with Uncle Gerd already guiding.
    const startX = state.lastX ?? 150;
    this.uncle = this.add.image(startX > UNCLE_X + 140 ? startX - 110 : UNCLE_X, FLOOR, 'uncle').setOrigin(0.5, 1).setScale(SCALE).setDepth(4);
    this.player = this.add.image(startX, FLOOR, 'dev-a').setOrigin(0.5, 1).setScale(SCALE).setDepth(5);
    this.bubble = this.makeBubble();
    this.makeHud();
    this.drawGroundHints();
    if (state.lastX == null) this.time.delayedCall(500, () => this.say(exhibits.length ? (this.night ? NIGHT_GREETING : GREETING) : GREETING_EMPTY, 6500));
    if (this.night) this.makeBat();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.worldW, H);
    cam.startFollow(this.player, true, 0.12, 0.12);

    const kb = this.input.keyboard;
    this.moveKeys = kb.addKeys({ left: 'LEFT', right: 'RIGHT', up: 'UP' }); // captured: arrows never scroll the page
    this.actionKeys = kb.addKeys({ a: 'A', d: 'D', w: 'W', e: 'E', enter: 'ENTER', space: 'SPACE' }, false);

    this.touchDir = 0;
    this.walkClock = 0;
    this.target = null;
    this.near = null;
    this.guiding = startX > UNCLE_X + 140;
    this.chatIndex = 0;
    this.nextChat = 0;
    this.idle = { devBlinkAt: 1500, devBlinkUntil: 0, uncleBlinkAt: 2600, uncleBlinkUntil: 0, twitchAt: 4000, twitchUntil: 0 };
    if (state.open) this.pauseInput(true); // a room was opened via deep link before the hallway existed
  }

  makeTexture(key, rows) {
    if (this.textures.exists(key)) return;
    const g = this.add.graphics();
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const color = PALETTE[row[x]];
        if (color === undefined) continue;
        g.fillStyle(color, 1);
        g.fillRect(x, y, 1, 1);
      }
    });
    g.generateTexture(key, rows[0].length, rows.length);
    g.destroy();
  }

  drawHall() {
    const g = this.add.graphics();
    const w = this.worldW;
    g.fillStyle(0x3a1d2b, 1).fillRect(0, 0, w, FLOOR);
    for (let x = 0; x < w; x += 32) g.fillStyle(0x432334, 1).fillRect(x, 0, 12, 326);
    g.fillStyle(0x2a1420, 1).fillRect(0, 330, w, FLOOR - 330);
    g.fillStyle(0xd9a441, 1).fillRect(0, 326, w, 4);
    g.fillStyle(0x1f0f18, 1).fillRect(0, FLOOR - 8, w, 8);
    for (let x = 0, i = 0; x < w; x += 32, i++) {
      for (let y = FLOOR, j = 0; y < H; y += 22, j++) g.fillStyle((i + j) % 2 ? 0xe9dcc2 : 0x2b2230, 1).fillRect(x, y, 32, 22);
    }
    for (let x = 120; x < w; x += 240) {
      g.fillStyle(0xfff2c6, 0.05).fillTriangle(x - 14, 34, x + 14, 34, x + 96, FLOOR);
      g.fillStyle(0xfff2c6, 0.05).fillTriangle(x - 14, 34, x + 96, FLOOR, x - 96, FLOOR);
      g.fillStyle(0x1f0f18, 1).fillRect(x - 2, 0, 4, 26);
      g.fillStyle(0xd9a441, 1).fillRect(x - 14, 26, 28, 8);
    }
  }

  // The in-game title: "THE PUBLIC MUSEUM / GRAVEYARD" and "OF @AUTHOR" underneath.
  drawTitle(x, y, title, titleColor, nameColor, footer, footerColor) {
    let name = `OF @${String(state.data.owner || 'nobody').toUpperCase()}`;
    if (name.length > 30) name = `${name.slice(0, 29)}…`;
    this.add.text(x, y + 30, title, textStyle(FONT_PIXEL, 16, titleColor)).setOrigin(0.5);
    this.add.text(x, y + 62, name, textStyle(FONT_PIXEL, name.length > 22 ? 9 : 12, nameColor)).setOrigin(0.5);
    this.add.text(x, y + 94, footer, textStyle(FONT_BODY, 20, footerColor)).setOrigin(0.5);
    // Right under the title: dig up your own graveyard.
    this.makeButton(x, y + 138, 'DIG YOURS >', (btn, pointer) => openDigDialog(pointer?.event ? { x: pointer.event.clientX, y: pointer.event.clientY } : null), {
      fixed: false,
      anchor: 'center',
      size: 10,
      depth: 2,
    });
  }

  // ---------- buttons inside the game ----------
  // x < 0 means "from the right edge". fixed buttons stay put on screen, the others live in the world.
  makeButton(x, y, label, onClick, { fixed = true, anchor = 'left', size = 8, active = false, depth = 30 } = {}) {
    const night = this.night;
    const text = this.add.text(0, 0, label, textStyle(FONT_PIXEL, size, '#1a1016')).setDepth(depth + 1);
    const padX = 8;
    const padY = 7;
    const w = Math.ceil(text.width) + padX * 2;
    const h = Math.ceil(text.height) + padY * 2;
    const left = anchor === 'center' ? Math.round(x - w / 2) : x < 0 ? W + x - w : x;
    const bg = this.add.graphics().setDepth(depth);
    text.setPosition(left + padX, y + padY);
    const zone = this.add.zone(left, y, w, h).setOrigin(0).setDepth(depth + 2).setInteractive({ useHandCursor: true });
    if (fixed) for (const o of [bg, text, zone]) o.setScrollFactor(0);
    const accent = night ? 0xc9c4e6 : 0xd9a441;
    const btn = { w, h, active, hover: false, text };
    btn.draw = () => {
      const lit = btn.active || btn.hover;
      bg.clear();
      bg.fillStyle(0x000000, 0.4).fillRect(left + 4, y + 4, w, h);
      bg.fillStyle(accent, 1).fillRect(left - 3, y - 3, w + 6, h + 6);
      bg.fillStyle(lit ? accent : night ? 0x14101f : 0x1a1016, 1).fillRect(left, y, w, h);
      text.setColor(lit ? '#1a1016' : night ? '#e8e2ff' : '#f3e6c8');
    };
    btn.setLabel = (l) => text.setText(l);
    zone.on('pointerover', () => {
      btn.hover = true;
      btn.draw();
    });
    zone.on('pointerout', () => {
      btn.hover = false;
      btn.draw();
    });
    zone.on('pointerdown', (pointer) => onClick(btn, pointer));
    btn.draw();
    return btn;
  }

  // The basic controls and the Hacksgiving note, painted on the ground and fixed to the screen.
  drawGroundHints() {
    const night = this.night;
    const ink = night ? '#e8e2ff' : '#f3e6c8';
    const accent = night ? 0xc9c4e6 : 0xd9a441;
    const line = this.add.container(0, 0).setScrollFactor(0).setDepth(25);
    const items = [['←'], ['→'], 'walk', null, ['↑'], 'enter', null, ['Esc'], 'leave'];
    const g = this.add.graphics();
    line.add(g);
    let x = 0;
    const y = FLOOR + 30;
    const keys = [];
    for (const item of items) {
      if (item === null) {
        x += 22;
      } else if (Array.isArray(item)) {
        const t = this.add.text(0, y, item[0], textStyle(FONT_BODY, 22, '#1a1016')).setOrigin(0.5);
        const w = Math.max(28, Math.ceil(t.width) + 14);
        t.x = x + w / 2;
        keys.push({ x, w });
        line.add(t);
        x += w + 6;
      } else {
        const t = this.add.text(x + 2, y, item, textStyle(FONT_BODY, 22, ink)).setOrigin(0, 0.5);
        line.add(t);
        x += Math.ceil(t.width) + 10;
      }
    }
    const offset = Math.round((W - x) / 2);
    line.x = offset;
    // backdrop strip so the hints stay readable on the checkered floor
    const strip = this.add.graphics().setScrollFactor(0).setDepth(24);
    strip.fillStyle(night ? 0x000000 : 0x1a1016, night ? 0.45 : 0.9).fillRect(offset - 18, FLOOR + 12, x + 36, 70);
    for (const k of keys) {
      g.fillStyle(0x000000, 0.5).fillRect(k.x + 3, y - 12 + 3, k.w, 26);
      g.fillStyle(accent, 1).fillRect(k.x, y - 12, k.w, 26);
    }
    const note = this.add
      .text(W / 2, FLOOR + 64, 'A personal agent living on a Fly.io Sprite · Built for Hacksgiving 2026', textStyle(FONT_BODY, 18, night ? '#a9a5c4' : '#c9c2b6'))
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(25)
      .setInteractive({ useHandCursor: true });
    note.on('pointerdown', () => window.open('https://fly.io/hacksgiving/', '_blank', 'noopener'));
  }

  makeHud() {
    const pad = 12;
    this.hud = {};
    const sound = this.makeButton(-pad, pad, isSoundOn() ? 'SOUND ON ' : 'SOUND OFF', () => setSound(!isSoundOn()));
    const museum = this.makeButton(-(pad + sound.w + 18), pad, 'MUSEUM', () => setTheme('museum'), { active: !this.night });
    const grave = this.makeButton(-(pad + sound.w + 18 + museum.w + 6), pad, 'GRAVEYARD', () => setTheme('graveyard'), { active: this.night });
    const help = this.makeButton(-(pad + sound.w + 18 + museum.w + 6 + grave.w + 18), pad, 'INSTRUCTIONS', (btn, pointer) =>
      openHelp(pointer?.event ? { x: pointer.event.clientX, y: pointer.event.clientY } : null),
    );
    this.makeButton(-(pad + sound.w + 18 + museum.w + 6 + grave.w + 18 + help.w + 6), pad, 'ALL GRAVEYARDS', (btn, pointer) =>
      openGuestsDialog(pointer?.event ? { x: pointer.event.clientX, y: pointer.event.clientY } : null),
    );
    this.hud.sound = sound;
    if (state.data.guest) {
      this.makeButton(pad, pad, this.night ? "< CURATOR'S GRAVEYARD" : "< CURATOR'S MUSEUM", () => {
        location.href = `/${location.search}`;
      });
    } else if (state.admin) {
      this.hud.rescan = this.makeButton(pad, pad, state.rescanning || 'RESCAN GITHUB', () => rescan());
    }
  }

  refreshHud() {
    this.hud?.sound?.setLabel(isSoundOn() ? 'SOUND ON ' : 'SOUND OFF');
    this.hud?.rescan?.setLabel(state.rescanning || 'RESCAN GITHUB');
  }

  drawEntrance() {
    const x = 300;
    const y = 64;
    const w = 400;
    const h = 120;
    const g = this.add.graphics();
    g.fillStyle(0xd9a441, 1).fillRect(x - w / 2 - 6, y - 6, w + 12, h + 12);
    g.fillStyle(0x1a1016, 1).fillRect(x - w / 2, y, w, h);
    this.drawTitle(x, y, 'THE PUBLIC MUSEUM', '#d9a441', '#f3e6c8', 'Curated by Uncle Gerd · Admission free', '#c9c2b6');
    this.add
      .text(x + 180, FLOOR - 60, 'Please do not\nfeed the bugs', textStyle(FONT_BODY, 18, '#1a1016', { backgroundColor: '#f3e6c8', padding: { x: 6, y: 2 }, align: 'center' }))
      .setOrigin(0.5, 1);
  }

  drawDoor(ex, x) {
    const frame = this.night ? 0x8f8ca0 : 0xd9a441;
    const door = this.add.image(x, FLOOR + (this.night ? 6 : 0), this.night ? 'tomb' : 'door').setOrigin(0.5, 1).setScale(SCALE).setInteractive({ useHandCursor: true });
    const top = FLOOR - door.displayHeight;
    const pw = 230;
    const ph = 86;
    // Signs hang at the same height in both themes (tombstones are shorter than doors).
    const py = FLOOR - 152 - 92;
    const g = this.add.graphics();
    if (this.night) {
      // A wooden sign post next to the grave instead of a brass plaque
      g.fillStyle(0x3b2a20, 1).fillRect(x - 4, py + ph, 8, top - py - ph + 10);
    }
    g.fillStyle(frame, 1).fillRect(x - pw / 2 - 4, py - 4, pw + 8, ph + 8);
    g.fillStyle(this.night ? 0x14101f : 0x1a1016, 1).fillRect(x - pw / 2, py, pw, ph);
    this.add
      .text(x, py + 22, ex.title.toUpperCase(), textStyle(FONT_PIXEL, 10, '#f3e6c8', { align: 'center', wordWrap: { width: pw - 20 }, maxLines: 2, lineSpacing: 4 }))
      .setOrigin(0.5);
    // The real repository name under the exhibit title.
    let repoName = (ex.repo || '').split('/').pop() || ex.id;
    if (repoName.length > 26) repoName = `${repoName.slice(0, 25)}…`;
    this.add.text(x, py + 50, repoName, textStyle(FONT_BODY, 18, this.night ? '#a9a5c4' : '#c9c2b6')).setOrigin(0.5);
    this.add.text(x, py + ph - 13, `${ex.years} · ${ex.language}`, textStyle(FONT_BODY, 20, '#d9a441')).setOrigin(0.5);

    const cx = x + 132;
    const cy = FLOOR - 150;
    g.fillStyle(frame, 1).fillRect(cx - 52, cy - 4, 104, 64);
    g.fillStyle(this.night ? 0x14101f : 0x1a1016, 1).fillRect(cx - 48, cy, 96, 56);
    this.add.text(cx, cy + 14, 'REVIVAL', textStyle(FONT_PIXEL, 8, '#c9c2b6')).setOrigin(0.5);
    const odds = this.add.text(cx, cy + 38, '', textStyle(FONT_PIXEL, 14, '#c9c2b6')).setOrigin(0.5);

    const status = this.add.text(x, py - 18, '', textStyle(FONT_PIXEL, 10, '#6dff9e')).setOrigin(0.5);
    const prompt = this.add
      .text(x, top - 6, this.night ? '^ VISIT' : '^ ENTER', textStyle(FONT_PIXEL, 10, '#1a1016', { backgroundColor: this.night ? '#c9c4e6' : '#d9a441', padding: { x: 6, y: 4 } }))
      .setOrigin(0.5, 1)
      .setDepth(6)
      .setVisible(false);
    door.on('pointerdown', () => this.walkTo(ex.id));

    const d = { ex, x, door, odds, status, prompt, blink: null };
    this.updateDoor(d, ex);
    return d;
  }

  updateDoor(d, ex) {
    d.ex = ex;
    const p = ex.odds?.revival ?? null;
    d.odds.setText(pct(p)).setColor(oddsColor(p));
    d.blink?.stop();
    d.blink = null;
    d.status.setAlpha(1);
    const st = ex.revival?.status;
    if (st === 'live') {
      d.status.setText(this.night ? '* RISEN *' : '* LIVE *').setColor('#6dff9e');
      d.door.setTint(0xc8ffd8);
    } else if (st === 'reviving') {
      d.status.setText('REVIVING…').setColor('#ffcf5a');
      d.door.clearTint();
      if (!reduceMotion) d.blink = this.tweens.add({ targets: d.status, alpha: 0.25, duration: 500, yoyo: true, repeat: -1 });
    } else if (st === 'failed') {
      d.status.setText('STILL DEAD').setColor('#ff7a7a');
      d.door.clearTint();
    } else {
      d.status.setText('');
      d.door.clearTint();
    }
  }

  // Where a door currently is on screen (page coordinates), so the room can zoom out of it.
  doorScreenPoint(id) {
    const d = this.doors.find((door) => door.ex.id === id);
    const canvas = this.game.canvas;
    if (!d || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cam = this.cameras.main;
    const sx = rect.width / this.scale.width;
    const sy = rect.height / this.scale.height;
    return { x: rect.left + (d.x - cam.scrollX) * sx, y: rect.top + (FLOOR - d.door.displayHeight / 2 - cam.scrollY) * sy };
  }

  refreshDoor(id) {
    const d = this.doors.find((door) => door.ex.id === id);
    const ex = state.data.exhibits.find((e) => e.id === id);
    if (d && ex) this.updateDoor(d, ex);
  }

  // ---------- the graveyard at night ----------
  drawNight() {
    const w = this.worldW;
    const rnd = mulberry32(19980101);
    // Sky in hard 8-bit bands, fixed to the camera.
    const sky = this.add.graphics().setScrollFactor(0).setDepth(-10);
    const bands = [0x05061a, 0x080a22, 0x0c0d2b, 0x120f33, 0x18123a, 0x1f1640, 0x271a45];
    const bandH = Math.ceil(FLOOR / bands.length);
    bands.forEach((c, i) => sky.fillStyle(c, 1).fillRect(0, i * bandH, W, bandH));

    // Stars on a slow parallax layer: small ones twinkle, a few bright ones sparkle.
    const layerW = W + (w - W) * 0.15 + 40;
    if (!this.textures.exists('star')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 3, 3);
      g.generateTexture('star', 3, 3);
      g.clear();
      g.fillStyle(0xfff6c8, 1).fillRect(3, 0, 3, 9).fillRect(0, 3, 9, 3);
      g.fillStyle(0xffffff, 1).fillRect(3, 3, 3, 3);
      g.generateTexture('star-big', 9, 9);
      g.destroy();
    }
    for (let i = 0; i < 120; i++) {
      const big = i < 14;
      const star = this.add
        .image(rnd() * layerW, 8 + rnd() * (big ? 220 : 300), big ? 'star-big' : 'star')
        .setScrollFactor(0.15)
        .setDepth(-9)
        .setAlpha(big ? 1 : 0.5 + rnd() * 0.5);
      if (!reduceMotion) {
        this.tweens.add({
          targets: star,
          alpha: big ? 0.35 : 0.15,
          scale: big ? 1.5 : 1,
          duration: 500 + rnd() * 1400,
          delay: rnd() * 2000,
          yoyo: true,
          repeat: -1,
          ease: 'Stepped',
          easeParams: [3],
        });
      }
    }

    // The moon with a pixel glow.
    const moon = this.add.graphics().setScrollFactor(0.08).setDepth(-8);
    const mx = W * 0.8;
    const my = 92;
    moon.fillStyle(0xe8e2ff, 0.05).fillCircle(mx, my, 96);
    moon.fillStyle(0xe8e2ff, 0.07).fillCircle(mx, my, 66);
    moon.fillStyle(0xf4f0d8, 1).fillCircle(mx, my, 34);
    moon.fillStyle(0xd8d0b0, 1).fillCircle(mx - 10, my - 8, 7).fillCircle(mx + 12, my + 6, 5).fillCircle(mx + 2, my + 16, 4);

    // Hills far away, then a dead tree line, then the iron fence.
    const hills = this.add.graphics().setScrollFactor(0.4).setDepth(-7);
    const hillW = W + (w - W) * 0.4 + 80;
    const pts = [{ x: 0, y: FLOOR }];
    for (let x = 0; x <= hillW; x += 40) pts.push({ x, y: 300 + Math.sin(x / 170) * 34 + Math.sin(x / 61) * 12 });
    pts.push({ x: hillW, y: FLOOR });
    hills.fillStyle(0x161026, 1).fillPoints(pts, true);

    const trees = this.add.graphics().setScrollFactor(0.7).setDepth(-6);
    const treeW = W + (w - W) * 0.7;
    for (let tx = 140; tx < treeW; tx += 380 + rnd() * 260) {
      const base = FLOOR - 10;
      trees.fillStyle(0x0e0a16, 1).fillRect(tx, base - 190, 14, 190);
      trees.fillRect(tx - 46, base - 150, 50, 8).fillRect(tx - 46, base - 176, 8, 30);
      trees.fillRect(tx + 10, base - 120, 56, 8).fillRect(tx + 58, base - 150, 8, 34);
      trees.fillRect(tx - 24, base - 210, 8, 30).fillRect(tx + 16, base - 230, 8, 50);
    }

    const fence = this.add.graphics().setScrollFactor(0.9).setDepth(-5);
    const fenceW = W + (w - W) * 0.9;
    fence.fillStyle(0x0b0812, 1).fillRect(0, FLOOR - 58, fenceW, 6).fillRect(0, FLOOR - 22, fenceW, 6);
    for (let fx = 0; fx < fenceW; fx += 18) {
      fence.fillRect(fx, FLOOR - 74, 6, 74);
      fence.fillTriangle(fx - 3, FLOOR - 74, fx + 9, FLOOR - 74, fx + 3, FLOOR - 86);
    }

    // Ground: dark grass with tufts on top of dirt.
    const ground = this.add.graphics().setDepth(-4);
    ground.fillStyle(0x1b1420, 1).fillRect(0, FLOOR, w, H - FLOOR);
    ground.fillStyle(0x24402a, 1).fillRect(0, FLOOR - 4, w, 10);
    for (let gx = 0; gx < w; gx += 6) {
      const h = 4 + Math.floor(rnd() * 8);
      ground.fillStyle(rnd() < 0.5 ? 0x2f5535 : 0x24402a, 1).fillRect(gx, FLOOR - 4 - h, 3, h);
    }
    for (let i = 0; i < w / 10; i++) ground.fillStyle(0x2b2132, 1).fillRect(rnd() * w, FLOOR + 12 + rnd() * (H - FLOOR - 16), 4, 4);

    // Ground fog drifting lazily.
    for (let i = 0; i < 2; i++) {
      const fog = this.add.graphics().setDepth(6);
      fog.fillStyle(0xc8c4e0, 0.06).fillRect(-200, FLOOR - 40 + i * 22, w + 400, 34);
      if (!reduceMotion) this.tweens.add({ targets: fog, x: i ? -60 : 60, duration: 5000 + i * 2500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  drawGraveEntrance() {
    const x = 300;
    const y = 64;
    const w = 400;
    const h = 120;
    const g = this.add.graphics();
    g.fillStyle(0x8f8ca0, 1).fillRect(x - w / 2 - 6, y - 6, w + 12, h + 12);
    g.fillStyle(0x67647a, 1).fillRect(x + w / 2 - 6, y - 6, 12, h + 12);
    g.fillStyle(0x14101f, 1).fillRect(x - w / 2, y, w, h);
    this.drawTitle(x, y, 'THE PUBLIC GRAVEYARD', '#e8e2ff', '#c9c2b6', 'Kept by Uncle Gerd · Open all night', '#8f8ca0');
    this.add
      .text(x + 180, FLOOR - 60, 'Please do not\nwake the dead code', textStyle(FONT_BODY, 18, '#14101f', { backgroundColor: '#c9c4e6', padding: { x: 6, y: 2 }, align: 'center' }))
      .setOrigin(0.5, 1);
  }

  drawCrypt(x) {
    const g = this.add.graphics();
    g.fillStyle(0x6f6c84, 1).fillTriangle(x - 90, FLOOR - 150, x + 90, FLOOR - 150, x, FLOOR - 210);
    g.fillStyle(0x8f8ca0, 1).fillRect(x - 80, FLOOR - 150, 160, 150);
    g.fillStyle(0x67647a, 1).fillRect(x - 70, FLOOR - 140, 14, 140).fillRect(x + 56, FLOOR - 140, 14, 140);
    g.fillStyle(0x0b0812, 1).fillRect(x - 34, FLOOR - 104, 68, 104);
    this.add.text(x, FLOOR - 250, 'CRYPT GIFT SHOP →', textStyle(FONT_PIXEL, 10, '#e8e2ff')).setOrigin(0.5);
    this.add.text(x, FLOOR - 124, 'CLOSED', textStyle(FONT_PIXEL, 8, '#14101f')).setOrigin(0.5);
    this.add.text(x, FLOOR - 60, 'forever', textStyle(FONT_BODY, 20, '#8f8ca0')).setOrigin(0.5);
  }

  makeBat() {
    this.bat = this.add.image(-40, 120, 'bat-up').setScale(SCALE).setScrollFactor(0.6).setDepth(3);
    this.batDir = 1;
    this.batBaseY = 110;
    if (reduceMotion) this.bat.setPosition(W * 0.62, 150); // just hangs around
  }

  flyBat(time, delta) {
    const bat = this.bat;
    if (!bat || reduceMotion) return;
    bat.setTexture(Math.floor(time / 110) % 2 ? 'bat-down' : 'bat-up');
    bat.x += (this.batDir * 120 * delta) / 1000;
    bat.y = this.batBaseY + Math.sin(time / 260) * 14 + Math.sin(time / 1100) * 26;
    // Turn around once it leaves the screen, at a new height.
    const screenX = bat.x - this.cameras.main.scrollX * 0.6;
    if ((this.batDir > 0 && screenX > W + 60) || (this.batDir < 0 && screenX < -60)) {
      this.batDir *= -1;
      bat.setFlipX(this.batDir < 0);
      this.batBaseY = 70 + Math.random() * 150;
    }
  }

  drawGiftShop(x) {
    const g = this.add.graphics();
    g.fillStyle(0x1a1016, 1).fillRect(x - 70, FLOOR - 150, 140, 150);
    g.fillStyle(0x5a2f22, 1).fillRect(x - 60, FLOOR - 110, 120, 8).fillRect(x - 60, FLOOR - 60, 120, 8);
    this.add.text(x, FLOOR - 196, 'EXIT THROUGH\nTHE GIFT SHOP →', textStyle(FONT_PIXEL, 10, '#d9a441', { align: 'center', lineSpacing: 6 })).setOrigin(0.5);
    this.add.text(x, FLOOR - 132, 'SOLD OUT:', textStyle(FONT_BODY, 18, '#ff7a7a')).setOrigin(0.5);
    this.add.text(x, FLOOR - 86, 'motivation', textStyle(FONT_BODY, 20, '#f3e6c8')).setOrigin(0.5);
    this.add.text(x, FLOOR - 36, 'free time', textStyle(FONT_BODY, 20, '#f3e6c8')).setOrigin(0.5);
  }

  makeBubble() {
    const container = this.add.container(0, 0).setDepth(10).setVisible(false);
    const bg = this.add.graphics();
    const text = this.add.text(12, 8, '', textStyle(FONT_BODY, 22, '#1a1016', { wordWrap: { width: 280 }, lineSpacing: -2 }));
    container.add([bg, text]);
    container.bg = bg;
    container.text = text;
    return container;
  }

  say(line, ms = 5000, isQuip = false) {
    const b = this.bubble;
    this.quipShown = isQuip;
    b.text.setText(line);
    b.w = Math.ceil(b.text.width) + 24;
    b.h = Math.ceil(b.text.height) + 16;
    b.bg.clear();
    b.bg.fillStyle(0x1a1016, 1).fillRect(-3, -3, b.w + 6, b.h + 6);
    b.bg.fillStyle(0xf3e6c8, 1).fillRect(0, 0, b.w, b.h);
    b.bg.fillTriangle(18, b.h, 40, b.h, 12, b.h + 16);
    b.setVisible(true);
    this.positionBubble();
    this.bubbleTimer?.remove();
    this.bubbleTimer = this.time.delayedCall(ms, () => b.setVisible(false));
  }

  positionBubble() {
    const b = this.bubble;
    const x = Phaser.Math.Clamp(this.uncle.x - 30, 8, this.worldW - b.w - 8);
    b.setPosition(x, FLOOR - this.uncle.displayHeight - b.h - 24);
  }

  walkTo(id) {
    const d = this.doors.find((door) => door.ex.id === id);
    if (!d) return;
    if (Math.abs(d.x - this.player.x) < 70) openRoom(id);
    else this.target = { id, x: d.x };
  }

  update(time, delta) {
    if (state.open) return;
    const k = { ...this.moveKeys, ...this.actionKeys };
    let blocked = focusIsInteractive();
    // Walking with the arrow keys hands the keyboard back to the game (e.g. after clicking "Sound on"),
    // so Enter opens the door instead of pressing the focused button again.
    if (blocked && (k.left.isDown || k.right.isDown)) {
      focusGame();
      blocked = false;
    }

    let dir = this.touchDir;
    if (k.left.isDown || (!blocked && k.a.isDown)) dir = -1;
    else if (k.right.isDown || (!blocked && k.d.isDown)) dir = 1;
    if (dir) this.target = null;
    else if (this.target) {
      const dx = this.target.x - this.player.x;
      if (Math.abs(dx) < 8) {
        const { id } = this.target;
        this.target = null;
        openRoom(id);
        return;
      }
      dir = Math.sign(dx);
    }

    if (dir) {
      this.player.x = Phaser.Math.Clamp(this.player.x + (dir * SPEED * delta) / 1000, 40, this.worldW - 40);
      this.player.setFlipX(dir < 0);
      this.walkClock += delta;
      this.player.setTexture(Math.floor(this.walkClock / 150) % 2 ? 'dev-b' : 'dev-a');
    } else {
      this.player.setTexture(time < this.idle.devBlinkUntil ? 'dev-blink' : 'dev-a');
      this.walkClock = 0;
    }
    this.animateIdle(time);
    if (this.night) this.flyBat(time, delta);

    // Uncle Gerd starts guiding once you walk past him, and trails a few steps behind.
    if (!this.guiding && this.player.x > UNCLE_X + 140) {
      this.guiding = true;
      this.say('Komm, Junge. Every room has a story.', 3500);
    }
    if (this.guiding) {
      const behind = this.player.flipX ? 110 : -110;
      const dx = this.player.x + behind - this.uncle.x;
      if (Math.abs(dx) > 14) {
        this.uncle.x += Math.sign(dx) * Math.min(Math.abs(dx), (UNCLE_SPEED * delta) / 1000);
        this.uncle.setFlipX(dx < 0);
        this.uncle.y = reduceMotion ? FLOOR : FLOOR - (Math.floor(time / 160) % 2) * 3;
      } else {
        this.uncle.y = FLOOR;
      }
    } else if (time > this.nextChat && Math.abs(this.player.x - this.uncle.x) < 110 && !this.bubble.visible) {
      const lines = this.night ? NIGHT_LINES : UNCLE_LINES;
      this.say(lines[this.chatIndex++ % lines.length]);
      this.nextChat = time + 9000;
    }
    if (this.bubble.visible) this.positionBubble();

    const near = this.doors.find((d) => Math.abs(d.x - this.player.x) < 70) || null;
    if (near !== this.near) {
      this.near?.prompt.setVisible(false);
      near?.prompt.setVisible(true);
      this.near = near;
      setEnterButton(near);
      if (near) this.say(doorQuip(near.ex, this.doors.indexOf(near)), 3500, true);
      else if (this.quipShown) {
        // Walked away from the door: the quip goes with them.
        this.bubbleTimer?.remove();
        this.bubble.setVisible(false);
        this.quipShown = false;
      }
    }

    // Evaluate every key so their "just pressed" flags reset each frame.
    const pressed = [k.up, k.w, k.e, k.enter, k.space].map((key) => Phaser.Input.Keyboard.JustDown(key));
    const actionPressed = pressed[0] || (!blocked && pressed.slice(1).some(Boolean));
    if (actionPressed && near) openRoom(near.ex.id);
  }

  // Idle life: both blink now and then, Uncle Gerd's moustache twitches, and wiggles while he talks.
  animateIdle(time) {
    const idle = this.idle;
    const rand = (min, max) => min + Math.random() * (max - min);
    if (time > idle.devBlinkAt) {
      idle.devBlinkUntil = time + 130;
      idle.devBlinkAt = time + (Math.random() < 0.2 ? 260 : rand(2200, 5200)); // sometimes a double blink
    }
    if (time > idle.uncleBlinkAt) {
      idle.uncleBlinkUntil = time + 160;
      idle.uncleBlinkAt = time + rand(2800, 6000);
    }
    if (time > idle.twitchAt) {
      idle.twitchUntil = time + 480;
      idle.twitchAt = time + rand(3500, 7000);
    }
    const talking = this.bubble.visible;
    const twitching = talking ? Math.floor(time / 130) % 2 === 0 : time < idle.twitchUntil && Math.floor((idle.twitchUntil - time) / 80) % 2 === 0;
    const blinking = time < idle.uncleBlinkUntil;
    const key = `uncle${twitching ? '-twitch' : ''}${blinking ? '-blink' : ''}`;
    if (this.uncle.texture.key !== key) this.uncle.setTexture(key);
  }

  pauseInput(paused) {
    const kb = this.input.keyboard;
    kb.enabled = !paused;
    if (paused) kb.disableGlobalCapture();
    else {
      kb.enableGlobalCapture();
      kb.resetKeys();
    }
  }
}

// ---------- the room ----------
function openRoom(id) {
  const ex = state.data.exhibits.find((e) => e.id === id);
  if (!ex) return;
  state.open = id;
  state.scene?.pauseInput(true);
  renderRoom(ex);
  if (!dlg.open) {
    dlg.showModal();
    zoomRoom(id, 'in');
    sfx('door');
  }
  history.replaceState(null, '', `${location.pathname}${location.search}#room=${encodeURIComponent(id)}`);
  if (ex.revival?.status === 'reviving') startPolling();
}

// Zoom the room out of (and back into) the door it belongs to. Reduced motion: a short fade only.
// Slow and jaggy on purpose: the zoom moves in a few hard pixel-art steps instead of smoothly.
const ZOOM_MS = 900;
const ZOOM_OUT_MS = 650;
const ZOOM_STEPS = 8;
let closing = false;

function zoomRoom(id, direction) {
  if (!dlg.animate) return Promise.resolve();
  const opening = direction === 'in';
  const fade = [{ opacity: 0 }, { opacity: 1 }];
  if (reduceMotion) {
    return dlg.animate(opening ? fade : [...fade].reverse(), { duration: 150, easing: 'ease-out' }).finished.catch(() => {});
  }
  const box = dlg.getBoundingClientRect();
  const door = state.scene?.doorScreenPoint(id);
  const origin = door ? `${door.x - box.left}px ${door.y - box.top}px` : '50% 50%';
  const frames = [
    { transform: 'scale(0.08)', opacity: 0, transformOrigin: origin },
    { transform: 'scale(1)', opacity: 1, transformOrigin: origin },
  ];
  const opts = { duration: opening ? ZOOM_MS : ZOOM_OUT_MS, easing: `steps(${opening ? ZOOM_STEPS : ZOOM_STEPS - 2}, jump-end)` };
  const backdrop = [{ opacity: 0 }, { opacity: 1 }];
  try {
    dlg.animate(opening ? backdrop : [...backdrop].reverse(), { ...opts, pseudoElement: '::backdrop' });
  } catch {}
  return dlg.animate(opening ? frames : [...frames].reverse(), opts).finished.catch(() => {});
}

async function closeRoom() {
  if (!dlg.open || closing) return;
  closing = true;
  await zoomRoom(state.open, 'out');
  dlg.close();
  closing = false;
}

dlg.addEventListener('cancel', (e) => {
  e.preventDefault(); // Esc: animate out instead of vanishing
  closeRoom();
});
dlg.addEventListener('close', () => {
  state.open = null;
  stopPolling();
  state.scene?.pauseInput(false);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
});
dlg.addEventListener('click', (e) => {
  if (e.target === dlg) closeRoom();
});

function renderRoom(ex) {
  const dd = (term, value) => [el('dt', {}, term), el('dd', {}, value)];
  dlg.replaceChildren(
    el(
      'div',
      { class: 'room' },
      el('div', { class: 'close' }, el('button', { type: 'button', 'aria-label': 'Leave the room', onclick: closeRoom }, '✕')),
      el(
        'header',
        {},
        el('p', { class: 'eyebrow' }, `${night() ? 'Here lies' : 'Exhibit'} · ${ex.years}`),
        el('h2', { id: 'room-title' }, ex.title),
        el('p', { class: 'repo' }, link(ex.url, ex.repo)),
      ),
      el(
        'div',
        { class: 'room-grid' },
        el(
          'div',
          { class: 'plaque' },
          el('p', {}, ex.plaque),
          el(
            'dl',
            {},
            ...dd('Language', ex.language),
            ...dd('Born', shortDate(ex.born)),
            ...dd('Died', shortDate(ex.died)),
            ...dd('Lifespan', `${ex.lifespanDays} days`),
            ...dd('Last words', `“${ex.lastWords}”`),
            ...dd('Cause of death', ex.causeOfDeath),
            ...dd('Survived by', `${ex.openIssues} open issue${ex.openIssues === 1 ? '' : 's'}, ${ex.stars} star${ex.stars === 1 ? '' : 's'}`),
          ),
        ),
      ),
      el(
        'aside',
        { class: 'uncle', 'aria-label': 'Uncle Gerd says' },
        portrait(),
        el('blockquote', {}, el('p', {}, ex.uncle?.line || '…'), el('footer', {}, moodLabel(ex))),
      ),
      oddsBlock(ex),
      artifactsBlock(ex),
      questBlock(ex),
      el('section', { class: 'revival', id: 'revival', 'aria-labelledby': 'revival-title' }, ...revivalContent(ex)),
    ),
  );
}

function portrait() {
  const c = el('canvas', { width: 14, height: 22, class: 'pixel portrait', role: 'img', 'aria-label': 'Uncle Gerd' });
  paintPixels(c.getContext('2d'), UNCLE);
  return c;
}

function moodLabel(ex) {
  const mood = ex.uncle?.mood;
  if (!mood) return 'Uncle Gerd';
  const conf = ex.odds?.moodConfidence;
  return `Uncle Gerd, mood: ${mood.replaceAll('_', ' ')}${conf != null ? ` (${pct(conf)} sure, says Jev)` : ''}`;
}

function gauge(label, p) {
  const bar = el('span', { class: 'bar', 'aria-hidden': 'true' });
  bar.style.setProperty('--p', `${p == null ? 0 : Math.round(p * 100)}%`);
  bar.style.setProperty('--c', oddsColor(p));
  return el('div', { class: 'gauge' }, el('span', {}, label), bar, el('strong', {}, pct(p)));
}

function oddsBlock(ex) {
  if (!ex.odds) return el('section', { class: 'odds' }, el('p', { class: 'muted' }, 'Jev has not judged this one yet.'));
  return el(
    'section',
    { class: 'odds', 'aria-label': 'Decisions by Jev' },
    gauge('Revival odds', ex.odds.revival),
    gauge('Worth reviving', ex.odds.worthIt),
    el('p', { class: 'muted' }, `Decided by ${ex.odds.model || 'Jev'} from TypeSafe AI`),
  );
}

function artifactsBlock(ex) {
  if (!ex.artifacts?.length) return null;
  return el(
    'section',
    { class: 'artifacts' },
    el('h3', {}, 'Found at the excavation site'),
    el(
      'ul',
      {},
      ...ex.artifacts.map((a) =>
        el('li', { class: `a-${a.kind}` }, el('span', { class: 'kind' }, a.kind), ' ', link(a.url, a.label), a.date ? el('time', { datetime: a.date }, ` · ${shortDate(a.date)}`) : null),
      ),
    ),
  );
}

function questBlock(ex) {
  if (!ex.quest) return null;
  return el('section', { class: 'quest' }, el('h3', {}, 'Revival quest'), el('p', { class: 'quest-title' }, link(ex.quest.url, ex.quest.title)), ex.quest.why ? el('p', {}, ex.quest.why) : null);
}

function revivalContent(ex) {
  const r = ex.revival || { status: 'idle', log: [] };
  const items = [el('h3', { id: 'revival-title' }, 'Resurrection')];
  if (r.status === 'live') {
    items.push(
      el(
        'p',
        { class: 'live' },
        '● Alive again on its own Sprite. ',
        r.url && safeHref(r.url) ? el('a', { href: safeHref(r.url), target: '_blank', rel: 'noopener' }, 'Visit the living exhibit →') : null,
        r.simulated ? el('small', {}, ' (simulation)') : null,
      ),
    );
  } else if (r.status === 'failed') {
    items.push(el('p', { class: 'dead' }, 'Still dead. Uncle Gerd: “Hab ich doch gesagt.”'));
  } else if (r.status === 'reviving') {
    items.push(el('p', { class: 'busy', role: 'status' }, `Attempt ${r.attempts || 1}: surgery in progress…`));
  } else {
    items.push(el('p', { class: 'muted' }, 'A fresh Sprite, a checkpoint, and Claude Code as the surgeon. If it fails, we restore and try again.'));
  }
  if (r.log?.length) items.push(logView(r.log));
  if (r.status === 'idle' || r.status === 'failed') {
    if (state.data.guest) {
      items.push(el('p', { class: 'muted' }, 'Revivals are reserved for the curator. Start with the quest above, the code is yours.'));
    } else if (state.admin || state.data.demo) {
      items.push(el('button', { type: 'button', class: 'revive', onclick: () => revive(ex.id) }, r.status === 'failed' ? 'Try again' : 'Revive on a fresh Sprite'));
    } else {
      items.push(el('p', { class: 'muted' }, 'Revivals are performed live by the curator.'));
    }
  }
  return items;
}

function logView(log) {
  const list = el(
    'ol',
    { class: 'log', 'aria-live': 'polite' },
    ...log.slice(-60).map((e) => el('li', { class: `k-${e.kind || 'info'}` }, el('time', {}, (e.t || '').slice(11, 19)), ' ', e.msg)),
  );
  requestAnimationFrame(() => {
    list.scrollTop = list.scrollHeight;
  });
  return list;
}

async function revive(id) {
  try {
    setRevival(id, await api(`/api/exhibits/${encodeURIComponent(id)}/revive`, { method: 'POST' }));
    startPolling();
  } catch (err) {
    toast(err.message);
  }
}

function setRevival(id, r) {
  const ex = state.data.exhibits.find((e) => e.id === id);
  if (!ex) return;
  const before = ex.revival?.status;
  ex.revival = r;
  if (state.open === id) document.getElementById('revival')?.replaceChildren(...revivalContent(ex));
  state.scene?.refreshDoor(id);
  renderList();
  if (before === 'reviving' && r.status === 'live') {
    state.scene?.say('Na also! It lives!', 4000);
    sfx('alive');
  }
  if (before === 'reviving' && r.status === 'failed') {
    state.scene?.say('Hab ich doch gesagt.', 4000);
    sfx('dead');
  }
}

function startPolling() {
  stopPolling();
  state.poll = setInterval(async () => {
    const id = state.open;
    if (!id) return stopPolling();
    try {
      const r = await api(`/api/exhibits/${encodeURIComponent(id)}/revival`);
      setRevival(id, r);
      if (r.status !== 'reviving') stopPolling();
    } catch {}
  }, 1500);
}

function stopPolling() {
  clearInterval(state.poll);
  state.poll = null;
}

// Keeps the door signs fresh while something is being revived with the room closed.
async function refreshIfBusy() {
  if (state.data.guest) return;
  if (!state.data.exhibits.some((e) => e.revival?.status === 'reviving' && e.id !== state.open)) return;
  try {
    const fresh = await api('/api/exhibits');
    for (const ex of fresh.exhibits) if (ex.id !== state.open) setRevival(ex.id, ex.revival);
  } catch {}
}

// ---------- page chrome ----------
function setEnterButton(near) {
  const b = document.getElementById('enter');
  b.disabled = !near;
  const verb = night() ? 'Visit' : 'Enter';
  b.textContent = near ? `${verb}: ${near.ex.title}` : verb;
}

function statusText(ex) {
  const st = ex.revival?.status;
  if (st === 'live') return '● live';
  if (st === 'reviving') return 'reviving…';
  if (st === 'failed') return 'still dead';
  return `revival odds ${pct(ex.odds?.revival ?? null)}`;
}

function renderList() {
  const ul = document.querySelector('#list ul');
  ul.replaceChildren(
    ...state.data.exhibits.map((ex) =>
      el('li', {}, el('button', { type: 'button', onclick: () => openRoom(ex.id) }, `${ex.title} (${ex.years})`), el('span', { class: 'muted' }, ` ${statusText(ex)}`)),
    ),
  );
}

// Curator mode: rescan GitHub from the HUD button; the label shows what the curator is doing.
async function rescan() {
  if (state.rescanning) return;
  state.rescanning = 'SCANNING…';
  state.scene?.refreshHud();
  try {
    await api('/api/scan', { method: 'POST' });
  } catch (err) {
    if (!/already|409/i.test(err.message)) toast(err.message);
  }
  const timer = setInterval(async () => {
    const s = await api('/api/scan').catch(() => null);
    if (!s || s.running) return;
    clearInterval(timer);
    state.rescanning = null;
    state.scene?.refreshHud();
    if (s.error) toast(`Scan failed: ${s.error}`);
    else location.reload();
  }, 2000);
}

function toggleList(force) {
  const list = document.getElementById('list');
  list.hidden = force === undefined ? !list.hidden : !force;
  document.getElementById('list-toggle').setAttribute('aria-expanded', String(!list.hidden));
}

document.getElementById('list-toggle').addEventListener('click', () => {
  toggleList();
  document.getElementById('help-dialog').close();
  if (!document.getElementById('list').hidden) document.getElementById('list').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- theme: museum or graveyard ----------
const PLACE = { museum: 'Museum', graveyard: 'Graveyard' };

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const place = PLACE[state.theme];
  document.getElementById('site-place').textContent = place;
  // (read the guest name from the URL here: this runs before GUEST is declared further down)
  const guest = decodeURIComponent(location.pathname.match(/^\/u\/([^/]+)\/?$/)?.[1] || '');
  document.title = guest ? `@${guest} · Uncle Gerd's ${place}` : `Uncle Gerd's ${place} of Dead Side Projects`;
}

function setTheme(theme) {
  if (theme === state.theme) return;
  state.theme = theme;
  try {
    localStorage.setItem('ugm-theme', theme);
  } catch {}
  applyTheme();
  const scene = state.scene;
  if (scene?.player) {
    state.lastX = scene.player.x;
    scene.scene.restart();
  }
}

applyTheme();

// ---------- sound (off by default) ----------
onSoundChange(() => state.scene?.refreshHud());
// Clicking into the hallway also gives it the keyboard.
document.getElementById('game').addEventListener('pointerdown', () => {
  if (!document.querySelector('dialog[open]')) focusGame();
});
// Shortcuts: M sound, T theme, G dig up your own graveyard.
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, dialog')) return;
  const key = e.key.toLowerCase();
  if (key === 'm') setSound(!isSoundOn());
  if (key === 't') setTheme(night() ? 'museum' : 'graveyard');
  if (key === 'g') openDigDialog();
  if (key === 'h' || key === '?') openHelp();
  if (key === 'l') openGuestsDialog();
});
initSound();

for (const btn of document.querySelectorAll('[data-move]')) {
  const dir = Number(btn.dataset.move);
  const start = (e) => {
    e.preventDefault();
    if (state.scene) state.scene.touchDir = dir;
  };
  const stop = () => {
    if (state.scene) state.scene.touchDir = 0;
  };
  btn.addEventListener('pointerdown', start);
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(type, stop);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

document.getElementById('enter').addEventListener('click', () => {
  const near = state.scene?.near;
  if (near) openRoom(near.ex.id);
});

async function fontsReady() {
  const sheet = document.getElementById('fonts');
  if (sheet && !sheet.sheet) {
    await new Promise((resolve) => {
      sheet.addEventListener('load', resolve, { once: true });
      sheet.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 2500);
    });
  }
  await Promise.race([Promise.all([document.fonts.load('16px "Press Start 2P"'), document.fonts.load('20px "VT323"')]), sleep(2500)]).catch(() => {});
}

// ---------- guest museums: /u/<github-username> ----------
const GUEST = decodeURIComponent(location.pathname.match(/^\/u\/([^/]+)\/?$/)?.[1] || '');
const VALID_NAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

// "Dig yours": a popup to type a GitHub handle. It zooms out of the button, in hard steps like the rooms.
const digDialog = document.getElementById('dig-dialog');
const visitInput = document.getElementById('visit-name');

function openDigDialog(from = null) {
  if (digDialog.open || state.open) return;
  state.scene?.pauseInput(true);
  digDialog.showModal();
  // Focus after the click that opened us has finished bubbling (it would otherwise refocus the hallway).
  setTimeout(() => {
    visitInput.focus();
    visitInput.select();
  }, 0);
  if (!digDialog.animate || reduceMotion) return;
  const box = digDialog.getBoundingClientRect();
  const origin = from ? `${from.x - box.left}px ${from.y - box.top}px` : '50% 50%';
  digDialog.animate(
    [
      { transform: 'scale(0.08)', opacity: 0, transformOrigin: origin },
      { transform: 'scale(1)', opacity: 1, transformOrigin: origin },
    ],
    { duration: 600, easing: 'steps(6, jump-end)' },
  );
}

digDialog.addEventListener('close', () => {
  if (!state.open) state.scene?.pauseInput(false);
});
digDialog.addEventListener('click', (e) => {
  if (e.target === digDialog) digDialog.close();
});
document.getElementById('visit-cancel').addEventListener('click', () => digDialog.close());
// "Instructions": every control beyond the basics painted on the ground.
const helpDialog = document.getElementById('help-dialog');
function openHelp(from = null) {
  if (helpDialog.open || digDialog.open || state.open) return;
  state.scene?.pauseInput(true);
  helpDialog.showModal();
  if (!helpDialog.animate || reduceMotion) return;
  const box = helpDialog.getBoundingClientRect();
  const origin = from ? `${from.x - box.left}px ${from.y - box.top}px` : '50% 0%';
  helpDialog.animate(
    [
      { transform: 'scale(0.08)', opacity: 0, transformOrigin: origin },
      { transform: 'scale(1)', opacity: 1, transformOrigin: origin },
    ],
    { duration: 600, easing: 'steps(6, jump-end)' },
  );
}
helpDialog.addEventListener('close', () => {
  if (!state.open) state.scene?.pauseInput(false);
});
helpDialog.addEventListener('click', (e) => {
  if (e.target === helpDialog) helpDialog.close();
});
document.getElementById('help-close').addEventListener('click', () => helpDialog.close());

// "All graveyards": every guest museum dug so far, in a scrollable popup.
const guestsDialog = document.getElementById('guests-dialog');
async function openGuestsDialog(from = null) {
  if (guestsDialog.open || helpDialog.open || digDialog.open || state.open) return;
  state.scene?.pauseInput(true);
  const list = document.getElementById('guests-list');
  const empty = document.getElementById('guests-empty');
  list.replaceChildren(el('li', { class: 'muted' }, 'Digging through the records…'));
  empty.hidden = true;
  guestsDialog.showModal();
  if (guestsDialog.animate && !reduceMotion) {
    const box = guestsDialog.getBoundingClientRect();
    const origin = from ? `${from.x - box.left}px ${from.y - box.top}px` : '50% 50%';
    guestsDialog.animate(
      [
        { transform: 'scale(0.08)', opacity: 0, transformOrigin: origin },
        { transform: 'scale(1)', opacity: 1, transformOrigin: origin },
      ],
      { duration: 600, easing: 'steps(6, jump-end)' },
    );
  }
  try {
    const rows = await api('/api/guests');
    empty.hidden = rows.length > 0;
    list.replaceChildren(
      ...rows.map((g) =>
        el(
          'li',
          {},
          el('a', { href: `/u/${encodeURIComponent(g.slug)}${location.search}` }, el('span', {}, `@${g.name}`), el('span', { class: 'muted' }, `${g.count} ${g.count === 1 ? 'grave' : 'graves'}`)),
        ),
      ),
    );
  } catch (err) {
    list.replaceChildren(el('li', { class: 'muted' }, err.message));
  }
}
guestsDialog.addEventListener('close', () => {
  if (!state.open) state.scene?.pauseInput(false);
});
guestsDialog.addEventListener('click', (e) => {
  if (e.target === guestsDialog) guestsDialog.close();
});
document.getElementById('guests-close').addEventListener('click', () => guestsDialog.close());

document.getElementById('dig-again').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  openDigDialog({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
});

document.getElementById('visit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = visitInput.value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//i, '').split('/')[0];
  if (!VALID_NAME.test(name)) {
    toast('That does not look like a GitHub handle.');
    visitInput.focus();
    return;
  }
  location.href = `/u/${encodeURIComponent(name)}${location.search}`;
});

// Uncle Gerd taps his foot (and blinks) while he digs, so you can see he is still at it.
function tappingUncle() {
  const c = el('canvas', { width: 14, height: 22, class: 'pixel portrait', role: 'img', 'aria-label': 'Uncle Gerd, tapping his foot while he digs' });
  const g = c.getContext('2d');
  let tick = 0;
  let blinkUntil = 0;
  const draw = () => {
    const beat = tick % 8; // tap, tap, rest: tap-tap ... tap-tap ...
    const tapping = !reduceMotion && (beat === 0 || beat === 2);
    if (!reduceMotion && Math.random() < 0.03) blinkUntil = tick + 1;
    const blink = tick <= blinkUntil;
    g.clearRect(0, 0, 14, 22);
    paintPixels(g, tapping ? (blink ? UNCLE_TAP_BLINK : UNCLE_TAP) : blink ? UNCLE_BLINK : UNCLE);
    tick += 1;
  };
  draw();
  const timer = setInterval(draw, 150);
  return { canvas: c, stop: () => clearInterval(timer) };
}

// Uncle Gerd's speech bubble on the digging screen: new lines type themselves out, 8-bit style.
let bubbleTimer = null;
function uncleSays(text) {
  const bubble = document.getElementById('dig-bubble');
  if (bubble.dataset.full === text) return;
  bubble.dataset.full = text;
  clearInterval(bubbleTimer);
  if (reduceMotion) {
    bubble.textContent = text;
    return;
  }
  let n = 0;
  bubbleTimer = setInterval(() => {
    n += 2;
    bubble.textContent = text.slice(0, n);
    if (n >= text.length) clearInterval(bubbleTimer);
  }, 30);
}

// "about 3 min" / "about 40 s"
function duration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(10, Math.round(s / 10) * 10)} s`;
}

// When the gate is full (or Uncle Gerd hit his hourly limit), count down visibly and try again.
async function waitAtGate(reason, seconds, status) {
  document.getElementById('dig-progress').classList.add('queued');
  for (let left = Math.ceil(seconds); left > 0; left--) {
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    uncleSays(`${reason} I'll knock again in a moment, Junge.`);
    status.textContent = `Trying again in ${clock}…`;
    await sleep(1000);
  }
  document.getElementById('dig-progress').classList.remove('queued');
}

// Steps the excavation goes through: search, then exhume / Jev / Uncle Gerd per repo, then done.
const DIG_STEPS = 11;

// Shows Uncle Gerd digging while a guest museum is being built, then resolves with its data.
async function digGuestMuseum(name) {
  const panel = document.getElementById('digging');
  const status = document.getElementById('digging-status');
  const bar = document.getElementById('dig-progress');
  const fill = bar.querySelector('span');
  const clock = document.getElementById('dig-clock');
  const uncle = tappingUncle();
  state.digAnimation = uncle;
  document.getElementById('digging-portrait').replaceChildren(uncle.canvas);
  document.getElementById('digging-title').textContent = `Uncle Gerd is digging up @${name}'s graveyard…`;
  const t0 = Date.now();
  const clockTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    clock.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }, 250);
  const setProgress = (p) => {
    const pctValue = Math.round(Math.min(p, 1) * 100);
    // Fill in 8-bit chunks of 10%, never quite full until the museum is ready.
    fill.style.width = `${Math.max(10, Math.floor(pctValue / 10) * 10)}%`;
    bar.setAttribute('aria-valuenow', String(pctValue));
  };
  setProgress(0.04);
  const finish = () => {
    clearInterval(clockTimer);
    uncle.stop();
  };
  let started = false;
  try {
    for (;;) {
      const res = await fetch(`/api/guests/${encodeURIComponent(name)}`);
      const body = await res.json().catch(() => ({}));
      if (res.status === 200) {
        setProgress(1);
        uncleSays('Fertig! Come in, come in.');
        await sleep(400);
        panel.hidden = true;
        finish();
        return body;
      }
      if (res.status === 404 && !started) {
        const r = await fetch(`/api/guests/${encodeURIComponent(name)}/scan`, { method: 'POST' });
        const b = await r.json().catch(() => ({}));
        if (r.status === 200) continue;
        if (r.status === 429) {
          // Gate is full or the hourly limit is reached: wait it out visibly, then knock again.
          panel.hidden = false;
          await waitAtGate(b.error || 'The cemetery gate is crowded.', b.retryAfter || 30, status);
          continue;
        }
        if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
        started = true;
      } else if (res.status !== 202) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      if (body.status === 'error') throw new Error(body.error || 'The excavation failed.');
      panel.hidden = false;
      const queued = body.status === 'queued' && body.position;
      status.textContent = queued
        ? `In the queue: number ${body.position} of ${body.total} · about ${duration(body.etaSeconds)} until it's ready`
        : 'Digging… this takes about a minute.';
      bar.classList.toggle('queued', Boolean(queued));
      if (!queued) setProgress(Math.max(0.08, Math.min(0.95, (body.log?.length || 0) / DIG_STEPS)));
      const last = body.log?.at(-1)?.msg;
      uncleSays(
        queued
          ? `You are number ${body.position} of ${body.total} at the cemetery gate. Patience, Junge.`
          : last || 'Moment, Junge. Let me get my shovel.',
      );
      await sleep(1500);
    }
  } catch (err) {
    finish();
    throw err;
  }
}

function showDigError(message) {
  document.getElementById('digging').hidden = false;
  document.getElementById('dig-meter').hidden = true;
  const still = el('canvas', { width: 14, height: 22, class: 'pixel portrait', role: 'img', 'aria-label': 'Uncle Gerd' });
  paintPixels(still.getContext('2d'), UNCLE);
  document.getElementById('digging-portrait').replaceChildren(still);
  document.getElementById('digging-title').textContent = 'Uncle Gerd put down his shovel.';
  document.getElementById('digging-status').textContent = '';
  uncleSays(`Ach. ${message}`);
  document.getElementById('dig-again').hidden = false;
}

async function boot() {
  if (GUEST) {
    const hallway = [document.getElementById('game')];
    for (const node of hallway) node.hidden = true; // nothing to walk through until the digging is done
    document.getElementById('visit-name').value = GUEST;
    if (!VALID_NAME.test(GUEST)) return showDigError('That is not a valid GitHub username.');
    try {
      state.data = await digGuestMuseum(GUEST);
    } catch (err) {
      return showDigError(err.message);
    }
    for (const node of hallway) node.hidden = false;
  } else {
    try {
      state.data = await api('/api/exhibits');
    } catch (err) {
      toast(`The museum is closed today: ${err.message}`);
      return;
    }
  }
  renderList();
  await fontsReady();
  const deepLink = decodeURIComponent(location.hash.match(/^#room=([\w-]+)/)?.[1] || '');
  if (deepLink) openRoom(deepLink);
  if (!window.Phaser) {
    toast('The game engine did not load, so here is the list of exhibits.');
    toggleList(true);
    return;
  }
  state.game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: W,
    height: H,
    pixelArt: true,
    backgroundColor: '#1a1016',
    banner: false,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: MuseumScene,
  });
  setInterval(refreshIfBusy, 6000);
}

boot();

// Debug hook for automated checks: /?debug exposes internal state.
if (new URLSearchParams(location.search).has('debug')) window.__ugm = { state, openRoom, closeRoom };
