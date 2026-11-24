// Hand-made pixel art. One character per pixel, "." is transparent.
export const PALETTE = {
  k: 0x1a1016, // outline, eyes, shoes
  s: 0xf1c7a0, // skin
  S: 0xd9a07a, // skin shadow
  h: 0x5a3a22, // brown hair
  g: 0xc9c2b6, // grey hair and moustache
  o: 0xd9a441, // gold: glasses, buttons
  b: 0x3f7fbf, // hoodie
  B: 0x2f5f8f, // hoodie shadow
  p: 0x2b2b3a, // jeans
  w: 0xf3e6c8, // shirt
  c: 0xc9a46a, // cardigan
  C: 0xa3824f, // cardigan shadow
  n: 0x6b4a2b, // trousers
  r: 0x7a2f22, // door wood
  R: 0x5a2018, // door wood, dark
  y: 0xd9a441, // door gold
  t: 0x8f8ca0, // tombstone
  T: 0x67647a, // tombstone shadow
  x: 0x3d3a4c, // engraving
  m: 0x4f6e3b, // moss
  v: 0x6a5a86, // bat (lighter than the night sky, so you can spot it)
  q: 0xff5a5a, // bat eyes
  L: 0xbcbab0, // stone highlights
  l: 0xa29fa0,
  M: 0x738956, // moss highlights
  u: 0x7294cc, // blue cloak highlights
  a: 0xf0cd82, // sunlit straw
  e: 0x8e6d42, // straw and walking stick shadows
  j: 0x686b72, // grey hair shadows
  G: 0x98999a, // salt-and-pepper beard
  i: 0xbab08d, // linen folds
  V: 0xa45e39, // leather vest
  K: 0x673e33, // vest shadow
  Z: 0xc37d4b, // vest highlights
  P: 0x494c54, // charcoal trouser highlights
};

const DEV_TOP = [
  '....hhhh....',
  '...hhhhhh...',
  '..hhhhhhhh..',
  '..hsssssSh..',
  '..sksssksS..',
  '..sssssssS..',
  '...ssSSss...',
  '....ssss....',
  '..bbbbbbbb..',
  '.bbbbbbbbbB.',
  '.bbbbbbbbbB.',
  'sbbbbbbbbbBs',
  'sbbbbbbbbbBs',
  '..bbbbbbbb..',
];

export const DEV_A = [
  ...DEV_TOP,
  '..pppppppp..',
  '..ppp..ppp..',
  '..ppp..ppp..',
  '..ppp..ppp..',
  '..kkk..kkk..',
  '............',
];

export const DEV_B = [
  ...DEV_TOP,
  '..pppppppp..',
  '..ppp..ppp..',
  '.ppp....ppp.',
  '.ppp....ppp.',
  '.kkk....kkk.',
  '............',
];

export const UNCLE = [
  '.....ssss.....',
  '...ssssssss...',
  '..gssssssssg..',
  '..gooooSoooog.',
  '..gokkoSokkog.',
  '..gooooSoooog.',
  '...ssssSsssS..',
  '...sgggggggs..',
  '..ggggggggggg.',
  '....ssSSss....',
  '...ccwwwwcc...',
  '..cccwwwwcccC.',
  '.ccccwwwwccccC',
  '.ccccowwwocccC',
  '.sccccwwwwcccs',
  '.sccccoccccccs',
  '..cccccccccC..',
  '..nnnnnnnnnn..',
  '..nnnn..nnnn..',
  '..nnnn..nnnn..',
  '..nnnn..nnnn..',
  '.kkkkk..kkkkk.',
];

// A double door with an elliptical arch, two panels per wing and golden handles.
export function makeDoor(w = 26, h = 38, arch = 7) {
  const cx = (w - 1) / 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      let ch = '.';
      if (y < arch) {
        const nx = (x - cx) / (cx + 0.5);
        const ny = (arch - y) / arch;
        const d = nx * nx + ny * ny;
        if (d <= 1) ch = d > 0.72 ? 'y' : 'r';
      } else if (x === 0 || x === w - 1) {
        ch = 'y';
      } else if (y === h - 1) {
        ch = 'R';
      } else {
        ch = 'r';
        const inWing = (x >= 3 && x <= 10) || (x >= 15 && x <= 22);
        if (inWing && ((y >= arch + 2 && y <= 18) || (y >= 22 && y <= h - 4))) ch = 'R';
        if (x === 12 || x === 13) ch = 'R';
        if ((x === 10 || x === 15) && (y === 24 || y === 25)) ch = 'y';
      }
      row += ch;
    }
    rows.push(row);
  }
  return rows;
}

export const DOOR = makeDoor();

export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// Draws pixel art into a 2D canvas context (used for the portrait in the room dialog).
export function paintPixels(ctx, rows, x0 = 0, y0 = 0) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = PALETTE[row[x]];
      if (color === undefined) continue;
      ctx.fillStyle = hex(color);
      ctx.fillRect(x0 + x, y0 + y, 1, 1);
    }
  });
}

// Idle frames: blinking eyes and a twitching moustache.
const withRows = (rows, changes) => rows.map((row, i) => changes[i] ?? row);
export const DEV_BLINK = withRows(DEV_A, { 4: '..sSsssSsS..' });
export const UNCLE_BLINK = withRows(UNCLE, { 4: '..goSSoSoSSog.' });
export const UNCLE_TWITCH = withRows(UNCLE, { 7: '..gsgggggggsg.', 8: '...ggggggggg..' });
export const UNCLE_TWITCH_BLINK = withRows(UNCLE_TWITCH, { 4: '..goSSoSoSSog.' });

// Foot tapping while he digs: the right shoe lifts one pixel row.
export const UNCLE_TAP = withRows(UNCLE, { 20: '..nnnn..kkkkk.', 21: '.kkkkk........' });
export const UNCLE_TAP_BLINK = withRows(UNCLE_TAP, { 4: '..goSSoSoSSog.' });

// A rounded tombstone with an engraved cross, a shaded right edge, a crack and some moss.
export function makeTomb(w = 22, h = 30, arch = 10) {
  const cx = (w - 1) / 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      let inside;
      let edge;
      if (y < arch) {
        const nx = (x - cx) / (cx + 0.5);
        const ny = (arch - y) / arch;
        const d = nx * nx + ny * ny;
        inside = d <= 1;
        edge = inside && d > 0.8;
      } else {
        inside = true;
        edge = x === 0 || x === w - 1 || y === h - 1;
      }
      let ch = '.';
      if (inside) {
        ch = edge ? 'k' : x >= w - 4 ? 'T' : 't';
        // engraved cross
        if (!edge && x >= cx - 0.5 && x <= cx + 1.5 && y >= 6 && y <= 17) ch = 'x';
        if (!edge && y >= 9 && y <= 10 && x >= cx - 3.5 && x <= cx + 4.5) ch = 'x';
        // a crack
        if (!edge && ((x === 4 && y >= 13 && y <= 15) || (x === 5 && y >= 16 && y <= 18) || (x === 4 && y === 19))) ch = 'x';
        // moss creeping up from the ground
        if (!edge && y >= h - 4 && (x * 7 + y * 3) % 5 < 3) ch = 'm';
        if (!edge && y === h - 5 && (x * 5) % 7 < 2) ch = 'm';
      }
      row += ch;
    }
    rows.push(row);
  }
  return rows;
}

export const TOMB = makeTomb();

export const BAT_UP = [
  'v..........v',
  'vv........vv',
  '.vvv....vvv.',
  '..vvqvvqvv..',
  '....vvvv....',
  '.....vv.....',
];

export const BAT_DOWN = [
  '............',
  '.....vv.....',
  '..vvqvvqvv..',
  '.vvvvvvvvvv.',
  'vv.v....v.vv',
  'v..........v',
];

// A small, right-facing robin. Its head stays in place during the wingbeat.
export const BIRD_UP = [
  '.....kk',
  '....kCck',
  '....kcCck...kk',
  '.....kcCCk.kcck',
  '..kkk.kCCkkcckky',
  '.kCCckccCCCCwwk',
  '..kkccCVVVwwwk',
  '....kkVVVVwwk',
  '......kkkkkk',
  '',
  '',
].map((row) => row.padEnd(16, '.'));

export const BIRD_DOWN = [
  '',
  '',
  '............kk',
  '...........kcck',
  '..kkk..kkkkcckky',
  '.kCCckccCCCCwwk',
  '..kkcccCCCCwwk',
  '....kkcCCVVwk',
  '....kcCCkkkk',
  '...kCCkk',
  '....kk',
].map((row) => row.padEnd(16, '.'));
