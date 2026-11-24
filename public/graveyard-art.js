// Original pixel art for the graveyard. Terrain and sprites share a three-screen-pixel grid.
export const PIXEL = 3;

const CHUNK = 192;
const BLEED = 64;
const CAVE_X = 151;
const CAVE_Y = 75;
const PALETTES = {
  light: {
    grass: ['#426e55', '#477759', '#4c7c5c', '#527f5d', '#568660'],
    soil: ['#ab7758', '#b78460', '#c08e64', '#c9966e', '#d09d73'],
    rock: ['#392b39', '#553b41', '#72504a', '#95644e', '#b48161', '#cb9770'],
    leaf: ['#233e37', '#305342', '#40654a', '#567c4e', '#6e9257', '#879d5f'],
    cliffShadow: '#365d49', shrubShadow: '#325541', caveShadow: '#355341', caveOpening: '#251e2b',
    caveSteps: ['#53403e', '#88624e'], pebble: '#926348', flower: ['#8e9b62', '#c2b37b'],
  },
  dark: {
    grass: ['#20364a', '#253d51', '#29445a', '#2d4b5f', '#33556b'],
    soil: ['#53516b', '#5d5a74', '#67637d', '#716d87', '#7a768f'],
    rock: ['#181c34', '#252840', '#35374e', '#48495f', '#5d5d76', '#6e6d89'],
    leaf: ['#162937', '#203a47', '#294958', '#345c66', '#44717a', '#5c838d'],
    cliffShadow: '#192e43', shrubShadow: '#192d41', caveShadow: '#182a3e', caveOpening: '#101322',
    caveSteps: ['#37364c', '#55546c'], pebble: '#444259', flower: ['#4d717b', '#8497a7'],
  },
};

export function gravePathY(x) {
  const tileX = x / PIXEL;
  return PIXEL * Math.round(142 + 8 * Math.sin(tileX / 34 - 0.8) + 4 * Math.sin(tileX / 17 + 0.2));
}

function random(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function ellipse(ctx, color, x, y, rx, ry) {
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const dx = Math.floor(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2));
    ctx.fillRect(x - dx, y + dy, dx * 2 + 1, 1);
  }
}

function polygon(ctx, color, points) {
  ctx.fillStyle = color;
  const ys = points.map(([, y]) => y);
  for (let y = Math.min(...ys); y < Math.max(...ys); y++) {
    const edges = [];
    points.forEach(([x1, y1], i) => {
      const [x2, y2] = points[(i + 1) % points.length];
      if ((y1 > y + 0.5) !== (y2 > y + 0.5)) {
        edges.push(Math.round(x1 + (x2 - x1) * (y + 0.5 - y1) / (y2 - y1)));
      }
    });
    edges.sort((a, b) => a - b);
    for (let i = 0; i < edges.length; i += 2) ctx.fillRect(edges[i], y, edges[i + 1] - edges[i], 1);
  }
}

function stone(ctx, x, y, w, h, rnd, rock) {
  const facet = Math.round(w * (0.42 + rnd() * 0.18));
  const crown = 3 + Math.floor(rnd() * 3);
  const cut = 3 + Math.floor(rnd() * 4);
  polygon(ctx, rock[0], [[x + 1, y + 4], [x + 6, y], [x + w - 4, y + 1], [x + w, y + 6], [x + w - 1, y + h - 5], [x + w - 5, y + h], [x + 4, y + h - 1], [x, y + h - 6]]);
  polygon(ctx, rock[1], [[x + 2, y + 5], [x + 6, y + 2], [x + w - 4, y + 2], [x + w - 2, y + 6], [x + w - 3, y + h - 5], [x + w - 6, y + h - 2], [x + 4, y + h - 3], [x + 2, y + h - 7]]);
  polygon(ctx, rock[3], [[x + 2, y + 6], [x + 6, y + 2], [x + facet + 2, y + crown], [x + facet + 3, y + cut + 6], [x + facet, y + h - 5], [x + 5, y + h - 4], [x + 2, y + h - 9]]);
  polygon(ctx, rock[2], [[x + facet + 2, y + crown], [x + w - 4, y + 4], [x + w - 3, y + 8], [x + w - 6, y + h - 4], [x + facet - 1, y + h - 5], [x + facet + 1, y + 11]]);
  polygon(ctx, rock[4], [[x + 3, y + 6], [x + 6, y + 3], [x + facet + 1, y + crown], [x + facet, y + 8], [x + 7, y + 9], [x + 5, y + 13], [x + 3, y + 12]]);
  rect(ctx, rock[5], x + 6, y + 4, Math.max(2, facet - 5), 2);
  rect(ctx, rock[2], x + 4, y + h - 10, 3, 2);
  rect(ctx, rock[4], x + 3, y + 16, 2, 2);
  rect(ctx, rock[2], x + facet - 1, y + 13, 2, 4);
  rect(ctx, rock[1], x + w - 7, y + h - 12, 1, 4);
}

function ridge(ctx, start, end, yAt, height, seed, { grass, rock, cliffShadow }) {
  const stones = [];
  const rnd = random(seed);
  for (let x = start; x < end; ) {
    const w = 12 + Math.floor(rnd() * 9);
    const y = yAt(x) + Math.floor(rnd() * 5);
    stones.push({ x, y, w, h: height + Math.floor(rnd() * 11) });
    x += w - 2;
  }
  for (const { x, y, w, h } of stones) ellipse(ctx, cliffShadow, Math.floor(x + w / 2), y + h - 1, w, 5);
  for (const { x, y, w, h } of stones) stone(ctx, x, y, w, h, rnd, rock);
  for (const { x, y, w } of stones) {
    polygon(ctx, grass[0], [[x - 2, y - 3], [x + 5, y - 2], [x + w - 4, y - 4], [x + w, y - 2], [x + w, y + 2], [x + w - 4, y + 3], [x + 6, y + 2], [x + 2, y + 5], [x - 2, y + 5]]);
    polygon(ctx, grass[3], [[x - 2, y - 3], [x + 5, y - 2], [x + w - 4, y - 4], [x + w, y - 2], [x + w, y], [x + w - 3, y + 1], [x + 5, y], [x + 1, y + 3], [x - 2, y + 3]]);
    rect(ctx, grass[4], x + 2, y - 3, 3, 1);
  }
}

function shrub(ctx, x, y, seed, { leaf, shrubShadow }) {
  const rnd = random(seed);
  const w = 8 + Math.floor(rnd() * 5);
  ellipse(ctx, shrubShadow, x + 2, y + 7, w + 3, 5);
  ellipse(ctx, leaf[0], x, y, w, 9);
  const clumps = [[-4, -5], [2, -6], [-7, -1], [-1, -2], [6, -1], [-5, 4], [2, 4], [6, 4]];
  for (const [dx, dy] of clumps) {
    const rx = 3 + Math.floor(rnd() * 3);
    const shade = dy > 1 ? 1 : 2;
    ellipse(ctx, leaf[shade], x + dx, y + dy, rx, 4);
    ellipse(ctx, leaf[shade + 1], x + dx - 1, y + dy - 2, rx - 1, 2);
    rect(ctx, leaf[shade + 3], x + dx - 2, y + dy - 3, 2, 1);
    rect(ctx, leaf[shade + 2], x + dx, y + dy - 2, 2, 2);
  }
}

function cave(ctx, x, y, seed, { rock, caveShadow, caveOpening, caveSteps }) {
  ellipse(ctx, caveShadow, x - 16, y + 2, 9, 6);
  ellipse(ctx, caveShadow, x + 17, y + 2, 10, 6);
  const rnd = random(seed);
  for (let i = 0; i < 5; i++) {
    stone(ctx, x - 25 + i * 9, y - 35 + Math.abs(i - 2) * 4, 13, 23, rnd, rock);
  }
  stone(ctx, x - 24, y - 22, 13, 23, rnd, rock);
  stone(ctx, x + 11, y - 22, 13, 23, rnd, rock);
  ellipse(ctx, rock[1], x, y - 13, 14, 16);
  ellipse(ctx, caveOpening, x, y - 12, 12, 14);
  rect(ctx, caveOpening, x - 11, y - 12, 22, 13);
  rect(ctx, caveSteps[0], x - 10, y - 2, 20, 3);
  rect(ctx, caveSteps[1], x - 8, y + 1, 16, 2);
}

function pathAt(x, y) {
  const center = gravePathY(x * PIXEL) / PIXEL;
  const width = 12 + 3 * Math.sin(x / 25) + 1.5 * Math.sin(x / 3);
  const trail = width - Math.abs(y - center);
  // A branch connects the first cave to the main trail.
  const fromCave = y - CAVE_Y;
  const caveX = CAVE_X + Math.sin(fromCave * 0.077) * 12 + fromCave * 0.28;
  const branch = fromCave >= -16 && y <= center ? 7 + Math.sin(y * 0.4) - Math.abs(x - caveX) : -10;
  return Math.max(trail, branch);
}

function lantern(ctx, x, y) {
  ellipse(ctx, 'rgb(239 164 76 / 0.14)', x, y - 3, 18, 9);
  ellipse(ctx, 'rgb(255 176 79 / 0.2)', x, y - 3, 11, 6);
  ellipse(ctx, '#373344', x, y + 1, 5, 2);
  rect(ctx, '#332b3c', x - 1, y - 11, 3, 12);
  rect(ctx, '#292639', x - 4, y - 17, 9, 2);
  rect(ctx, '#352b35', x - 3, y - 15, 7, 7);
  rect(ctx, '#c78454', x - 2, y - 14, 5, 5);
  rect(ctx, '#ffdb91', x - 1, y - 14, 3, 4);
}

function graveyardChunk(start, width, height, lighting) {
  const colors = PALETTES[lighting];
  const { grass, soil, pebble, flower } = colors;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const end = start + width;

  for (let x = start; x < end; x++) {
    const rnd = random(x + 2143);
    rnd();
    rnd();
    for (let y = 0; y < height; y++) {
      const mottling = Math.sin(x / 19 + Math.cos(y / 12)) + Math.cos(y / 8 - x / 20);
      const variation = rnd();
      const distance = pathAt(x, y) + variation * 2 - 1;
      if (distance > 0) {
        const tone = distance < 2 ? 0 : Math.floor(1 + rnd() * 4);
        rect(ctx, soil[tone], x - start, y, 1, 1);
      } else {
        const tone = Math.round(2 + mottling * 0.65 + (variation - 0.5) * 2.7);
        rect(ctx, grass[Math.max(0, Math.min(4, tone))], x - start, y, 1, 1);
      }
    }
  }

  ctx.translate(-start, 0);
  for (let cell = Math.max(-1, Math.floor((start - BLEED) / CHUNK)); cell <= Math.floor((end + BLEED) / CHUNK); cell++) {
    const left = cell * CHUNK;
    const rnd = random(cell + 2319);
    for (let i = 0; i < 102; i++) {
      const x = left + Math.floor(rnd() * CHUNK);
      const y = Math.floor(rnd() * height);
      if (pathAt(x, y) > 2) {
        if (i % 3 === 0) rect(ctx, pebble, x, y, 2, 1);
      } else if (pathAt(x, y) < -4) {
        rect(ctx, grass[0], x - 2, y - 1, 1, 2);
        rect(ctx, grass[0], x - 1, y, 3, 2);
        rect(ctx, grass[0], x + 2, y - 1, 1, 2);
        rect(ctx, grass[4], x, y - 2, 1, 3);
        if (i % 13 === 0) {
          rect(ctx, flower[0], x - 1, y - 2, 2, 1);
          rect(ctx, flower[1], x, y - 3, 1, 1);
        }
      }
    }
    shrub(ctx, left + 38 + Math.floor(rnd() * 26), 85 + Math.floor(rnd() * 25), cell * 7 + 391, colors);
    const shrubX = left + 142 + Math.floor(rnd() * 25);
    const shrubY = 65 + Math.floor(rnd() * 19);
    if (pathAt(shrubX, shrubY) < -15) shrub(ctx, shrubX, shrubY, cell * 7 + 392, colors);
    shrub(ctx, left + 93 + Math.floor(rnd() * 20), 159 + Math.floor(rnd() * 9), cell * 7 + 393, colors);
  }
  // Back ridge: the rock sequence is fixed in world coordinates across texture boundaries.
  for (let x = Math.floor((start - BLEED) / 80) * 80; x < end + BLEED; x += 80) {
    ridge(ctx, x, x + 80, (p) => Math.floor(24 + 12 * Math.sin(p / 63) + 6 * Math.cos(p / 22)), 22, x + 4102, colors);
  }
  if (start < 28) ridge(ctx, -20, 21, (x) => 89 + Math.floor(6 * Math.sin(x / 10)), 20, 801, colors);
  if (start < CAVE_X + 29 && end > CAVE_X - 29) cave(ctx, CAVE_X, CAVE_Y, 782, colors);
  // Raised foreground ledges frame the trail without covering its walkable strip.
  for (let x = Math.floor((start - BLEED) / 196) * 196; x < end + BLEED; x += 196) {
    ridge(ctx, x + 139, x + 184, (p) => Math.max(gravePathY(p * PIXEL) / PIXEL + 18, 166 + Math.floor(7 * Math.sin(p / 11))), 20, x + 120, colors);
  }
  if (lighting === 'dark') {
    for (let x = 78 + 196 * Math.max(0, Math.floor((start - BLEED - 78) / 196)); x < end + BLEED; x += 196) {
      lantern(ctx, x, gravePathY(x * PIXEL) / PIXEL - 11);
    }
  }
  return canvas;
}

const GRAVE = [
  '.......kkkkkkkk..........',
  '.....kkLLLLLLLLkk........',
  '....kLLLLLLLllltTk.......',
  '...kLLLLLLltttttTTk......',
  '..kLLLLlltttTTtttTTk.....',
  '..kLLLltLLtTTttttTxxk....',
  '.kLLLtttLttTTtttttTxxk...',
  '.kLLtttttttTTttttttTxxk..',
  '.kLltlltttxxTLtttttTxxk..',
  '.kLtttttttxxTLtttttTxxk..',
  '.kLtttttxxxxxxxLtttTxxk..',
  '.kLtttttxxxxxxxLtttTxxk..',
  '.kLtttttttxxTLLttttTxxk..',
  '.kLtttttttxxTLtttttTxxk..',
  '.kLTTtttttxxTLtttttTxxk..',
  '.kLttTttttxxTLttTttTxxk..',
  '.kLttTtttttLLttTtttTxxk..',
  '.kLtttTtttttttTttttTxxk..',
  '.kLttttttttttttttttTxxk..',
  '.kLttLttttttLtttttmTxxk..',
  '.kLmttmtttttttttmmmxTkk..',
  '.kmmMmmmmtttmmmmmMmxTkk..',
  '.kMmMMMMmmmmmmMMMmmxkk...',
  'kkmmmmmmkkkkkmmmmmmkkkk..',
  'ktttttttttttttttttttTTxk.',
  'kttLLLLLLLttttttttTTTxxk.',
  'kTTTTTTTTTTTTTTTTTTxxxxk.',
  '.kkkkkkkkkkkkkkkkkkkkkk..',
];

const HOOD = [
  '........kkkkkkk.........',
  '......kkbbbbbbbkk.......',
  '.....kbbbbbBBBBbbk......',
  '....kubbbbBBbbbBBBk.....',
  '...kubbbbBBbbbbBBBBk....',
  '..kubbbbBBbbbboookBk....',
  '..kubbbbbbBBBoosookk....',
  '.kuubbbbBBBBoosssSok....',
  '.kubbbbBBBBoossssSok....',
  '.kbbbbBBBBoosssssSok....',
  '..kbbBBBBBoossksskok....',
  '..kbbBBBBBoosssssSok....',
  '...kbbBBBBBoossssok.....',
  '...kkbbBBBBBooSSok......',
  '....kkbbbBBBBBkkk.......',
  '...kbbkbbbbBBnnnkk......',
  '..kubbbbbbbBBnnnBsk.....',
  '..kubbbbbbBBBnnnBssk....',
  '.kubbbbbbbBBBBnnnkk.....',
  '.kbbbbbbBBBBBnnnk.......',
  '.kbbbbBBBBBBnook........',
  '..kBBBBBBBBppppk........',
  '...kkkkkBBpppppk........',
  '.......kpppppppk........',
];

const GERD = [
  '..........kkkkkkkk',
  '........kkaaaaaacck',
  '.......kaaaacaaaaacek',
  '.......kacaaaccccceek',
  '......kaacccceceeeehk',
  '.....kaceehhhhhhecek',
  '...kkaaccaacccccccceekk',
  '.kkaaaaaaaaaaccacccceekkk',
  '.kaacacacccccceccaacccceek',
  '..kecccehhhhehhhecceeceeeek',
  '....kkkhejjSSSSSSjkehheekkk',
  '.......kjGGSSsSSsSSjSkk',
  '.......kjGsggssgGssjSsk',
  '.......kjGskssskssssSsk',
  '........kGSsSssssssSsk',
  '........kjGsssSSsSSsGk',
  '........kjGgggGGgggGjk',
  '.........kGgwgSSSggGjk',
  '..........kGGgggggGGjkk',
  '..........kkjGGGjkkZZVkk',
  '........kkwikjjkwwVZZVKk',
  '.......kwwikViwiiVZVVKik',
  '......kiwwikZVwiZVVVKwik',
  '......kiwiiKZkVVVVVVKiwwik',
  '.....kiwwiKZVVVZVVVKiwwiik',
  '.....kiiiikZVVkVVVKKkiwwsSk',
  '......ksskkVZVVVVVKk.kiiSSsk',
  '......kSSkkVVVVVVKKk..khSSShk',
  '.......kk.kVKZVKVVKk....khCk',
  '.........kkVVKkVKkk.....knCk',
];

const rows = (head, feet, width = 25) => [...head, ...feet].map((line) => line.padEnd(width, '.'));
const replaceRow = (sprite, i, line) => sprite.map((row, y) => y === i ? line.padEnd(row.length, '.') : row);

const WALKER = rows(HOOD, [
  '.......knnnkpnk', '.......knnnkpnk', '......knnnkknnnk', '......kkkk.kkkkk',
]);
const WALKER_STEP = rows(HOOD, [
  '......knnk.kpnnk', '.....knnnk..knnk', '....knnnk...knnnk', '....kkkk.....kkkk',
]);
const WALKER_BLINK = replaceRow(WALKER, 10, '..kbbBBBBBoossSssSok');

const GUIDE = rows(GERD, [
  '.........kPPPPpPPPPk....knCk',
  '.........kPPppkpPPPk....knCk',
  '.........kPppk.kPPPk....knCk',
  '.........kpppk.kpPpk....khek',
  '.........khnnk.khhnk....khek',
  '........khnnnk.knnnk....knCk',
  '.......knnnnnk.knnnnk...knCk',
  '.......kkkkkkk.kkkkkk...kkkk',
], 30);
const GUIDE_STEP = rows(GERD, [
  '.........kPPPPpPPPPk....knCk',
  '........kPPpppkpPPPk....knCk',
  '........kPpppk.kpPPpk...knCk',
  '.......kPppk...kpPpk....khek',
  '.......khhnk....khnnk...khek',
  '......khnnnk...knnnnk...knCk',
  '.....knnnnnk..knnnnnk...knCk',
  '.....kkkkkkk..kkkkkkk...kkkk',
], 30);
const GUIDE_TALK = replaceRow(GUIDE, 17, '.........kGgwgkhggGjk');
const blink = (sprite) => replaceRow(sprite, 13, '.......kjGSGssGSsssSsk');

export const GRAVE_SPRITES = {
  walker: WALKER,
  'walker-step': WALKER_STEP,
  'walker-blink': WALKER_BLINK,
  guide: GUIDE,
  'guide-step': GUIDE_STEP,
  'guide-step-blink': blink(GUIDE_STEP),
  'guide-blink': blink(GUIDE),
  'guide-twitch': GUIDE_TALK,
  'guide-twitch-blink': blink(GUIDE_TALK),
  grave: GRAVE,
};

function caveTexture(lighting) {
  const canvas = document.createElement('canvas');
  canvas.width = 58;
  canvas.height = 48;
  cave(canvas.getContext('2d'), 28, 39, 263, PALETTES[lighting]);
  return canvas;
}

export function addGraveyardTerrain(scene, width, height, lighting) {
  const worldTiles = Math.ceil(width / PIXEL);
  for (let start = 0; start < worldTiles; start += CHUNK) {
    const size = Math.min(CHUNK, worldTiles - start);
    const key = `graveyard-land-${lighting}-${start}-${size}`;
    if (!scene.textures.exists(key)) scene.textures.addCanvas(key, graveyardChunk(start, size, height / PIXEL, lighting));
    scene.add.image(start * PIXEL, 0, key).setOrigin(0).setScale(PIXEL).setDepth(-10);
  }
  const crypt = `crypt-cave-${lighting}`;
  if (!scene.textures.exists(crypt)) scene.textures.addCanvas(crypt, caveTexture(lighting));
  return crypt;
}
