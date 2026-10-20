import * as THREE from 'three';

// ─── Painterly palette variants ───────────────────────────────────────────────
// Each variant shifts the 4 key block-colour families (grass, dirt, stone, leaf).
// Bark/log are derived from dirt; sand/snow are shared but receive subtle tints.
export interface BlockPalette {
  readonly name:  string;
  // [base, dark, light, hilight]
  readonly grass: readonly [string, string, string, string];
  readonly dirt:  readonly [string, string, string, string];
  readonly stone: readonly [string, string, string];
  readonly leaf:  readonly [string, string, string, string];
  readonly sand:  readonly [string, string, string];
  readonly snowTop: string;
}

export const BLOCK_PALETTES: readonly BlockPalette[] = [
  // 0 ─ Verdant: warm yellow-green, golden earth
  { name: 'verdant',
    grass: ['#78B830','#5A9018','#96CC42','#B0D858'],
    dirt:  ['#9B6B38','#7A5028','#B88046','#CCA060'],
    stone: ['#A8A48C','#7A7860','#BCBAA0'],
    leaf:  ['#4E8228','#3C6A18','#64A036','#78B840'],
    sand:  ['#D6C060','#AE9438','#EED878'],
    snowTop: '#EEF4FF' },

  // 1 ─ Arid: terracotta earth, scorched yellow-green, warm sandy stone
  { name: 'arid',
    grass: ['#B0A030','#887820','#CEC050','#E0D070'],
    dirt:  ['#A85C30','#804018','#C87C50','#DCA060'],
    stone: ['#C4B898','#9C9070','#DED2BA'],
    leaf:  ['#80902A','#5E6C18','#A0B040','#BCCC58'],
    sand:  ['#D8B850','#B09030','#ECD070'],
    snowTop: '#F2ECDC' },

  // 2 ─ Arctic: cool blue-teal tundra, silver stone, icy snow
  { name: 'arctic',
    grass: ['#5898A8','#3C7888','#78B0C0','#96C8D8'],
    dirt:  ['#708494','#506070','#8CA0B0','#A0B4C4'],
    stone: ['#B8C0CC','#8890A0','#D4DCE8'],
    leaf:  ['#3A7870','#285858','#5A9A90','#70B0A8'],
    sand:  ['#90B8B8','#6890A0','#B0D0D4'],
    snowTop: '#E8F4FF' },

  // 3 ─ Ember: autumn fire — deep reds, russet, amber bark
  { name: 'ember',
    grass: ['#A86018','#804010','#C88030','#E0A048'],
    dirt:  ['#884030','#603020','#A86048','#C47C60'],
    stone: ['#A08870','#7A6450','#C0A890'],
    leaf:  ['#A84818','#803008','#C86030','#E08040'],
    sand:  ['#C8A038','#A07820','#E0C060'],
    snowTop: '#F4EEE0' },

  // 4 ─ Grove: deep forest — cool dark greens, mossy stone
  { name: 'grove',
    grass: ['#3A7828','#285018','#549840','#6EB054'],
    dirt:  ['#5A4030','#3C2818','#786050','#9A7A64'],
    stone: ['#6A788A','#505E70','#8898A8'],
    leaf:  ['#284E18','#1A3810','#3E6C28','#568040'],
    sand:  ['#A8A870','#808058','#C8C898'],
    snowTop: '#EEF2F8' },

  // 5 ─ Classic: Minecraft-style saturated primaries
  { name: 'classic',
    grass: ['#5DA012','#3D7808','#7DC030','#98D848'],
    dirt:  ['#8B5E34','#6A3E1C','#A87848','#C49060'],
    stone: ['#888888','#606060','#AAAAAA'],
    leaf:  ['#3A8018','#285A08','#50A028','#68C040'],
    sand:  ['#DBC876','#B8A050','#F0DC98'],
    snowTop: '#F0F8FF' },

  // 6 ─ Mesa: canyon red rock, dusty sage, sun-bleached bone
  { name: 'mesa',
    grass: ['#8AAA38','#687E28','#A8C050','#C0D468'],
    dirt:  ['#C06030','#A04020','#D88050','#ECA870'],
    stone: ['#C89878','#A07050','#E0B898'],
    leaf:  ['#708830','#506020','#90A840','#A8C058'],
    sand:  ['#E8C870','#C0A048','#F8E090'],
    snowTop: '#F8F0E0' },

  // 7 ─ Mushroom: alien purples, deep mauve soil, bioluminescent greens
  { name: 'mushroom',
    grass: ['#9050C0','#6A3090','#B070E0','#CC90F8'],
    dirt:  ['#704858','#503040','#906070','#B08898'],
    stone: ['#686080','#484060','#888098'],
    leaf:  ['#40B878','#289058','#58D898','#70EAB0'],
    sand:  ['#C8A0D0','#A078B0','#E0C0E8'],
    snowTop: '#E8D8F8' },

  // 8 ─ Savanna: dry golden grass, red clay, acacia warmth
  { name: 'savanna',
    grass: ['#C0A830','#906808','#E0CC50','#F0E070'],
    dirt:  ['#B05830','#884018','#CC7848','#E49868'],
    stone: ['#B8A880','#907858','#D4C8A0'],
    leaf:  ['#789030','#507010','#98B048','#B0CC60'],
    sand:  ['#E8C858','#C0A030','#F8E078'],
    snowTop: '#F4ECD8' },

  // 9 ─ Taiga: spruce-forest dark greens, charcoal bark, slate stone
  { name: 'taiga',
    grass: ['#4A7038','#305020','#609050','#78A868'],
    dirt:  ['#483020','#301808','#604038','#785858'],
    stone: ['#707880','#505860','#909898'],
    leaf:  ['#1E5830','#103820','#2E7848','#408860'],
    sand:  ['#909870','#686850','#B0B890'],
    snowTop: '#EAF0F4' },

  // ─── Solar System palettes ────────────────────────────────────────────────

  // 10 ─ Mercury: charcoal regolith, bone-white highland craters, dark basalt
  { name: 'mercury',
    grass: ['#7A7870','#585650','#9A9888','#B0AEA0'],
    dirt:  ['#504E48','#383630','#686660','#807E78'],
    stone: ['#9C9A90','#706E68','#C0BEB4'],
    leaf:  ['#686860','#484840','#888880','#A0A098'],
    sand:  ['#C8C4B4','#A0A090','#E0DCD0'],
    snowTop: '#E8E6E0' },

  // 11 ─ Venus: sulphur yellow lowlands, copper-orange highlands, acid-cloud haze
  { name: 'venus',
    grass: ['#C8A030','#A07818','#E8C050','#F0D868'],
    dirt:  ['#C05820','#904010','#D87840','#E89860'],
    stone: ['#B88860','#906040','#D8B090'],
    leaf:  ['#A08820','#786010','#C0A838','#D8C050'],
    sand:  ['#E0C050','#B89830','#F8D870'],
    snowTop: '#F0E8A0' },

  // 12 ─ Mars: rust-red regolith, iron-oxide dirt, basalt stone, polar frost
  { name: 'mars',
    grass: ['#B84820','#903010','#D06030','#E08048'],
    dirt:  ['#A03818','#782808','#C05830','#D87848'],
    stone: ['#907060','#685040','#B09080'],
    leaf:  ['#985030','#703818','#B87048','#CC9060'],
    sand:  ['#D07840','#A85820','#E89860'],
    snowTop: '#F0E8E0' },

  // 13 ─ Jupiter: ochre-amber bands, cream storm belts, bronze-tan mid-latitude
  { name: 'jupiter',
    grass: ['#C8983C','#A07018','#E0B858','#F0CC70'],
    dirt:  ['#E0C880','#B8A060','#F0DC98','#FFF0B4'],
    stone: ['#C0905C','#986840','#DEB07C'],
    leaf:  ['#D0A84C','#A87828','#ECC868','#F8DC80'],
    sand:  ['#ECD898','#C8B070','#FAEDB8'],
    snowTop: '#FEFAE8' },

  // 14 ─ Saturn: pale gold bands, dusty cream, ring-ice stone, white cap
  { name: 'saturn',
    grass: ['#D4B870','#AC9048','#ECD08C','#FAE8A8'],
    dirt:  ['#C8A858','#A08038','#E0C07A','#F0D898'],
    stone: ['#D8D0A8','#B0A880','#EEE8CC'],
    leaf:  ['#C4A860','#9C7E3A','#DEC07C','#EED898'],
    sand:  ['#EEE0A8','#C8B880','#FEF4C8'],
    snowTop: '#FEF8F0' },

  // 15 ─ Uranus: cyan-mint ice, pale teal stone, white nitrogen frost
  { name: 'uranus',
    grass: ['#50C0C8','#3498A0','#6CD8E0','#88EAF0'],
    dirt:  ['#5890A0','#386878','#78B0C0','#98C8D8'],
    stone: ['#A0C8D0','#78A0A8','#C4E0E8'],
    leaf:  ['#30A8B8','#207888','#48C8D8','#60DCF0'],
    sand:  ['#90D0D8','#68A8B4','#B0E4EC'],
    snowTop: '#E8F8FF' },

  // 16 ─ Neptune: deep cobalt, indigo mid-band, dark teal rock, white cirrus cap
  { name: 'neptune',
    grass: ['#2050A8','#103080','#3068D0','#4880E8'],
    dirt:  ['#183880','#0C2460','#2850A0','#3868C0'],
    stone: ['#284888','#182C60','#3860A8'],
    leaf:  ['#1848A0','#0C3078','#2860C8','#3878E0'],
    sand:  ['#4070B8','#2C5090','#5890D8'],
    snowTop: '#D0E8FF' },

  // 17 ─ Pluto: nitrogen-ice pink plains, methane-red lowlands, charcoal bedrock
  { name: 'pluto',
    grass: ['#E0B0B8','#C08090','#F0C8D0','#FFD8E0'],
    dirt:  ['#C07068','#A05050','#D89090','#EAB0A8'],
    stone: ['#787070','#585050','#989090'],
    leaf:  ['#B890A0','#906878','#D0A8B8','#E8C0CC'],
    sand:  ['#D0A0A8','#B07880','#E8C0C8'],
    snowTop: '#FFF0F4' },
];

export function pickPalette(seed: number): BlockPalette {
  return BLOCK_PALETTES[seed % BLOCK_PALETTES.length];
}

// ─────────────────────────────────────────────────────────────────────────────

export const enum BlockType {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Snow = 5,
  Bedrock = 6,
  Log = 7,
  Leaf = 8,
  Water = 9,
  Reed  = 10,
  Moss  = 11,
  Mushroom = 12,
}

// Atlas: 512×512, tile size 16×16 → 32×32 tiles
// Layout: block B, face F → tile index = B*3 + F (F: 0=top, 1=side, 2=bottom)
// UV: u = (tileIdx % 32) / 32, v = floor(tileIdx / 32) / 32

const TILE = 16;
const COLS = 32; // tiles per row

export class BlockAtlas {
  readonly texture: THREE.CanvasTexture;
  readonly palette: BlockPalette;

  constructor(seed = 0) {
    this.palette = pickPalette(seed);
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2); // each logical pixel becomes 2×2 → 4× detail per tile at no UV cost
    this._bake(ctx);
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.flipY = false; // UVs use canvas-top = v=0; flipY=true (default) would invert this
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestMipmapLinearFilter;
    this.texture.generateMipmaps = true;
  }

  getTileUV(block: BlockType, face: number): { u: number; v: number } {
    const tileIdx = block * 3 + face;
    return {
      u: (tileIdx % COLS) / COLS,
      v: Math.floor(tileIdx / COLS) / COLS,
    };
  }

  private _tileXY(tileIdx: number): [number, number] {
    return [(tileIdx % COLS) * TILE, Math.floor(tileIdx / COLS) * TILE];
  }

  // Deterministic LCG rand returning [0,1)
  private _rand(s: number): [number, number] {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return [s / 0x100000000, s];
  }

  // Fill a tile then scatter variation pixels using a deterministic seed.
  private _noiseTile(ctx: CanvasRenderingContext2D, tx: number, ty: number,
                     base: string, variants: { color: string; count: number; w?: number }[],
                     seed: number): void {
    ctx.fillStyle = base;
    ctx.fillRect(tx, ty, TILE, TILE);
    let s = seed;
    for (const v of variants) {
      ctx.fillStyle = v.color;
      const w = v.w ?? 1;
      for (let i = 0; i < v.count; i++) {
        let r: number;
        [r, s] = this._rand(s); const px = tx + Math.floor(r * (TILE - w + 1));
        [r, s] = this._rand(s); const py = ty + Math.floor(r * (TILE - w + 1));
        ctx.fillRect(px, py, w, w);
      }
    }
  }

  private _bake(ctx: CanvasRenderingContext2D): void {
    const p = this.palette;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 512);

    // Air (block 0) — tiles 0,1,2 — leave black (invisible)

    // ── Grass ─────────────────────────────────────────────────────────────
    {
      const [tx, ty] = this._tileXY(BlockType.Grass * 3 + 0);
      this._noiseTile(ctx, tx, ty, p.grass[0], [
        { color: p.grass[1], count: 22 },
        { color: p.grass[2], count: 18 },
        { color: p.grass[0], count: 14 },
        { color: p.grass[3], count:  5 },
        { color: p.grass[1], count:  8 },
      ], 101);
    }
    // Side: green cap fading into dirt
    {
      const [tx, ty] = this._tileXY(BlockType.Grass * 3 + 1);
      this._noiseTile(ctx, tx, ty, p.dirt[0], [
        { color: p.dirt[1], count: 18 },
        { color: p.dirt[2], count: 14 },
        { color: p.dirt[0], count: 12 },
        { color: p.dirt[3], count:  5 },
      ], 404);
      ctx.fillStyle = p.grass[0];
      ctx.fillRect(tx, ty, TILE, 2);
      ctx.fillStyle = p.grass[0];
      for (let x = 0; x < TILE; x += 2) ctx.fillRect(tx + x, ty + 2, 1, 1);
      ctx.fillStyle = p.grass[1];
      for (let x = 1; x < TILE; x += 4) ctx.fillRect(tx + x, ty + 2, 1, 1);
      ctx.fillStyle = p.grass[1];
      for (let x = 0; x < TILE; x += 5) ctx.fillRect(tx + x, ty + 3, 1, 1);
    }
    // Bottom: dirt
    {
      const [tx, ty] = this._tileXY(BlockType.Grass * 3 + 2);
      this._noiseTile(ctx, tx, ty, p.dirt[0], [
        { color: p.dirt[1], count: 20 },
        { color: p.dirt[2], count: 14 },
      ], 505);
    }

    // ── Dirt ──────────────────────────────────────────────────────────────
    for (let f = 0; f < 3; f++) {
      const [tx, ty] = this._tileXY(BlockType.Dirt * 3 + f);
      this._noiseTile(ctx, tx, ty, p.dirt[0], [
        { color: p.dirt[1], count: 22 },
        { color: p.dirt[2], count: 18 },
        { color: p.dirt[0], count: 14 },
        { color: p.dirt[3], count:  7 },
        { color: p.dirt[1], count:  6 },
      ], 500 + f * 37);
    }

    // ── Stone ─────────────────────────────────────────────────────────────
    for (let f = 0; f < 3; f++) {
      const [tx, ty] = this._tileXY(BlockType.Stone * 3 + f);
      this._noiseTile(ctx, tx, ty, p.stone[0], [
        { color: p.stone[1], count: 18 },
        { color: p.stone[2], count: 16 },
        { color: p.stone[2], count:  6, w: 2 },
        { color: p.stone[1], count:  6, w: 2 },
        { color: p.stone[0], count: 10 },
      ], 700 + f * 37);
    }

    // ── Sand ──────────────────────────────────────────────────────────────
    for (let f = 0; f < 3; f++) {
      const [tx, ty] = this._tileXY(BlockType.Sand * 3 + f);
      this._noiseTile(ctx, tx, ty, p.sand[0], [
        { color: p.sand[2], count: 20 },
        { color: p.sand[1], count: 16 },
        { color: p.sand[0], count: 12 },
        { color: p.sand[1], count:  6 },
        { color: p.sand[2], count:  5 },
      ], 1000 + f * 37);
    }

    // ── Snow ──────────────────────────────────────────────────────────────
    {
      const [tx, ty] = this._tileXY(BlockType.Snow * 3 + 0); // top
      this._noiseTile(ctx, tx, ty, p.snowTop, [
        { color: p.stone[1], count: 16 },
        { color: '#FFFFFF',   count: 10 },
        { color: p.stone[2], count:  8 },
        { color: p.snowTop,   count:  6 },
      ], 1200);
    }
    {
      const [tx, ty] = this._tileXY(BlockType.Snow * 3 + 1); // side: snow cap + stone
      this._noiseTile(ctx, tx, ty, p.stone[0], [
        { color: p.stone[1], count: 12 },
        { color: p.stone[2], count: 10 },
      ], 1400);
      ctx.fillStyle = p.snowTop;
      ctx.fillRect(tx, ty, TILE, 3);
      ctx.fillStyle = p.stone[2];
      for (let x = 1; x < TILE; x += 3) ctx.fillRect(tx + x, ty + 3, 1, 1);
    }
    {
      const [tx, ty] = this._tileXY(BlockType.Snow * 3 + 2); // bottom = stone
      this._noiseTile(ctx, tx, ty, p.stone[0], [
        { color: p.stone[1], count: 14 },
        { color: p.stone[2], count: 10 },
      ], 1500);
    }

    // ── Bedrock ───────────────────────────────────────────────────────────
    for (let f = 0; f < 3; f++) {
      const [tx, ty] = this._tileXY(BlockType.Bedrock * 3 + f);
      this._noiseTile(ctx, tx, ty, '#2E2C28', [
        { color: '#181614', count: 20 },
        { color: '#464440', count: 16 },
        { color: '#524E48', count:  8, w: 2 },
        { color: '#100E0C', count:  8, w: 2 },
      ], 1600 + f * 37);
    }

    // ── Log ───────────────────────────────────────────────────────────────
    // Bark colours derived from dirt palette (dark = bark, light = heartwood)
    for (const f of [0, 2]) {
      const [tx, ty] = this._tileXY(BlockType.Log * 3 + f);
      ctx.fillStyle = p.dirt[1];
      ctx.fillRect(tx, ty, TILE, TILE);
      ctx.fillStyle = p.dirt[0];
      ctx.fillRect(tx + 2, ty + 2, 12, 12);
      ctx.fillStyle = p.dirt[2];
      ctx.fillRect(tx + 4, ty + 4, 8, 8);
      ctx.fillStyle = p.dirt[0];
      ctx.fillRect(tx + 6, ty + 6, 4, 4);
      ctx.fillStyle = p.dirt[1];
      for (let r = 3; r <= 7; r += 2) {
        ctx.fillRect(tx + r,            ty + r,            TILE - r * 2, 1);
        ctx.fillRect(tx + r,            ty + TILE - r - 1, TILE - r * 2, 1);
        ctx.fillRect(tx + r,            ty + r,            1, TILE - r * 2);
        ctx.fillRect(tx + TILE - r - 1, ty + r,            1, TILE - r * 2);
      }
      this._noiseTile(ctx, tx, ty, '', [
        { color: p.dirt[1], count: 6 },
        { color: p.dirt[2], count: 4 },
      ], 1800 + f * 37);
    }
    // Side: vertical grain bark
    {
      const [tx, ty] = this._tileXY(BlockType.Log * 3 + 1);
      ctx.fillStyle = p.dirt[0];
      ctx.fillRect(tx, ty, TILE, TILE);
      ctx.fillStyle = p.dirt[1];
      for (let x = 1; x < TILE; x += 4) ctx.fillRect(tx + x, ty, 2, TILE);
      ctx.fillStyle = p.dirt[2];
      for (let x = 3; x < TILE; x += 4) ctx.fillRect(tx + x, ty, 1, TILE);
      ctx.fillStyle = p.dirt[0];
      ctx.fillRect(tx, ty + 5,  TILE, 1);
      ctx.fillRect(tx, ty + 11, TILE, 1);
      this._noiseTile(ctx, tx, ty, '', [
        { color: p.dirt[1], count: 10 },
        { color: p.dirt[3], count:  6 },
      ], 1900);
    }

    // ── Leaf ──────────────────────────────────────────────────────────────
    for (let f = 0; f < 3; f++) {
      const [tx, ty] = this._tileXY(BlockType.Leaf * 3 + f);
      this._noiseTile(ctx, tx, ty, p.leaf[0], [
        { color: p.leaf[1], count: 28 },
        { color: p.leaf[2], count: 22 },
        { color: p.leaf[3], count: 14 },
        { color: p.leaf[2], count:  6 },
        { color: p.leaf[1], count: 10 },
        { color: p.leaf[3], count:  4 },
      ], 2000 + f * 37);
      let s = 2500 + f * 13;
      ctx.fillStyle = '#000000';
      for (let i = 0; i < 28; i++) {
        let r: number;
        [r, s] = this._rand(s); const px = tx + Math.floor(r * TILE);
        [r, s] = this._rand(s); const py = ty + Math.floor(r * TILE);
        ctx.fillRect(px, py, 1, 1);
      }
    }

    // ── Water ─────────────────────────────────────────────────────────────
    // Water stays deep cerulean regardless of palette
    for (let f = 0; f < 3; f++) {
      const [tx, ty] = this._tileXY(BlockType.Water * 3 + f);
      this._noiseTile(ctx, tx, ty, '#2858A8', [
        { color: '#1C3E7C', count: 14 },
        { color: '#3A6ABE', count: 14 },
        { color: '#5888CC', count:  8 },
        { color: '#183460', count:  6 },
        { color: '#4476B8', count:  6 },
      ], 2200 + f * 37);
      ctx.fillStyle = '#70A0D8';
      for (let d = 0; d < TILE * 2; d += 5) {
        const x0 = tx + Math.max(0, d - TILE + 1);
        const y0 = ty + Math.max(0, TILE - 1 - d);
        const len = Math.min(d + 1, TILE, TILE * 2 - d);
        for (let k = 0; k < len; k += 3)
          ctx.fillRect(x0 + k, y0 + k, 1, 1);
      }
    }

    // ── Moss ──────────────────────────────────────────────────────────────
    // Flat earthy-green ground cover: dark leaf base, stone grey noise
    for (let f = 0; f < 3; f++) {
      const [tx, ty] = this._tileXY(BlockType.Moss * 3 + f);
      this._noiseTile(ctx, tx, ty, p.leaf[1], [
        { color: p.stone[1], count: 20 },
        { color: p.leaf[0],  count: 16 },
        { color: p.stone[0], count: 12 },
        { color: p.leaf[1],  count:  8 },
        { color: p.stone[2], count:  5 },
      ], 2600 + f * 37);
    }

    // ── Mushroom cap ──────────────────────────────────────────────────────
    // Earthy spotted dome: dirt base, leaf-colour freckles, stone highlight
    for (let f = 0; f < 3; f++) {
      const [tx, ty] = this._tileXY(BlockType.Mushroom * 3 + f);
      this._noiseTile(ctx, tx, ty, p.dirt[2], [
        { color: p.leaf[0],  count: 10 },
        { color: p.dirt[1],  count: 14 },
        { color: p.dirt[3],  count:  8 },
        { color: p.stone[2], count:  6 },
        { color: p.leaf[1],  count:  5 },
      ], 2800 + f * 37);
      // Pale gills on the underside (face 2)
      if (f === 2) {
        ctx.fillStyle = p.stone[2];
        for (let x = 1; x < TILE; x += 3) ctx.fillRect(tx + x, ty, 1, TILE);
      }
    }

    // ── Reed (water plant) ────────────────────────────────────────────────
    for (let f = 0; f < 3; f++) {
      const [tx, ty] = this._tileXY(BlockType.Reed * 3 + f);
      ctx.fillStyle = '#000';
      ctx.fillRect(tx, ty, TILE, TILE);
      const stalks = [[3, 5], [10, 12]];
      for (const [x0, x1] of stalks) {
        ctx.fillStyle = p.leaf[1];
        ctx.fillRect(tx + x0, ty, x1 - x0, TILE);
        ctx.fillStyle = p.leaf[2];
        ctx.fillRect(tx + x0, ty, 1, TILE);
        ctx.fillStyle = p.leaf[0];
        ctx.fillRect(tx + x1 - 1, ty, 1, TILE);
        ctx.fillStyle = p.leaf[1];
        ctx.fillRect(tx + x0 - 1, ty + 6, x1 - x0 + 2, 2);
      }
    }
  }
}
