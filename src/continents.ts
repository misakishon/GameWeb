import type { Vec2 } from './samuraiRig'

export type ContinentId = 'kyoto' | 'desert' | 'frost' | 'jungle' | 'volcano'

export type TreeKind =
  | 'bamboo'
  | 'pine'
  | 'maple'
  | 'palm'
  | 'cactus'
  | 'snow-pine'
  | 'jungle'
  | 'charred'

export type RockKind = 'zen' | 'sandstone' | 'ice' | 'moss' | 'basalt'

export interface TreeCanopy {
  x: number
  y: number
  r: number
  kind: TreeKind
  seed: number
}

export interface WorldRock {
  x: number
  y: number
  r: number
  seed: number
  kind: RockKind
}

export interface StoneSlab {
  x: number
  y: number
  w: number
  h: number
  rot: number
  seed: number
}

export interface BridgeConfig {
  minX: number
  maxX: number
  yCenter: number
  halfH: number
  deckHalfH: number
  style: 'wood' | 'sandstone' | 'frost' | 'bamboo' | 'obsidian'
}

export interface ContinentConfig {
  id: ContinentId
  keyNum: string
  name: string
  shortName: string
  regionTag: string
  compassDir: string
  origin: Vec2
  badgeColor: string
  paperBase: string
  boardBase: string
  stoneFill: string
  stoneBoardFill: string
  woodFill: string
  woodBoardFill: string
  liquidKind: 'koi-pond' | 'oasis' | 'glacial-lake' | 'emerald-lagoon' | 'magma'
  liquidLabel: string
  liquidCenter: Vec2
  liquidRx: number
  liquidRy: number
  liquidSeedA: number
  liquidSeedB: number
  bridge: BridgeConfig
  shopPos: Vec2
  gatePos: Vec2
  gateStyle: 'torii' | 'sandstone' | 'frost-torii' | 'temple' | 'obsidian'
  weatherKind: 'leaf' | 'sand' | 'snow' | 'firefly' | 'ember'
  trees: TreeCanopy[]
  rocks: WorldRock[]
  lanterns: Vec2[]
  stones: StoneSlab[]
  coins: { x: number; y: number; value: number; phase: number }[]
  dummies: { x: number; y: number }[]
}

export const WORLD_LIMIT = 2420
export const CONTINENT_SPACING = 1650

export function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123
  return s - Math.floor(s)
}

export function handDrift(pos: number, seed: number, amp = 1.4): number {
  return (
    (Math.sin(pos * 0.035 + seed * 3.7) * 0.55 +
      Math.sin(pos * 0.092 + seed * 7.1) * 0.3 +
      Math.sin(pos * 0.21 + seed * 11.3) * 0.15) *
    amp
  )
}

export function getTreeColliderRadius(tr: TreeCanopy): number {
  if (tr.kind === 'cactus') return Math.round(tr.r * 0.36)
  if (tr.kind === 'palm') return Math.round(tr.r * 0.42)
  return Math.round(tr.r * 0.52)
}

export function getContinentLiquidBoundary(
  continent: ContinentConfig,
  angle: number
): { x: number; y: number; rx: number; ry: number } {
  const norm = (((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
  const seg = norm * 40
  const rx =
    continent.liquidRx +
    Math.sin(angle * 3 + continent.liquidSeedA * 0.05) * 14 +
    handDrift(seg * 15, continent.liquidSeedA, 4)
  const ry =
    continent.liquidRy +
    Math.cos(angle * 2 + continent.liquidSeedB * 0.05) * 18 +
    handDrift(seg * 15, continent.liquidSeedB, 4)
  return {
    x: continent.liquidCenter.x + Math.cos(angle) * rx,
    y: continent.liquidCenter.y + Math.sin(angle) * ry,
    rx,
    ry,
  }
}

function buildCourtyardStones(seedOffset: number, skipEastMinX: number, skipEastMaxX: number): StoneSlab[] {
  const stones: StoneSlab[] = []
  let idx = 1 + seedOffset * 100
  for (let ring = 1; ring <= 2; ring++) {
    const count = ring * 8
    const rad = ring * 54
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.22
      stones.push({
        x: Math.cos(a) * rad,
        y: Math.sin(a) * rad,
        w: 36 + hash1(idx * 3.1) * 10,
        h: 26 + hash1(idx * 5.7) * 8,
        rot: a + Math.PI * 0.5 + (hash1(idx) - 0.5) * 0.18,
        seed: idx++,
      })
    }
  }
  for (let y = -155; y >= -540; y -= 52) {
    const curveX = Math.sin(y * 0.008 + seedOffset) * 26
    stones.push({
      x: curveX + (hash1(idx * 1.9) - 0.5) * 14,
      y,
      w: 44 + hash1(idx * 2.3) * 14,
      h: 28 + hash1(idx * 4.1) * 8,
      rot: (hash1(idx * 7.1) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  for (let y = 155; y <= 500; y += 54) {
    const curveX = Math.sin(y * 0.007 + seedOffset) * 30
    stones.push({
      x: curveX + (hash1(idx * 1.9) - 0.5) * 14,
      y,
      w: 44 + hash1(idx * 2.3) * 14,
      h: 28 + hash1(idx * 4.1) * 8,
      rot: (hash1(idx * 7.1) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  for (let x = 150; x <= 600; x += 52) {
    if (x > skipEastMinX && x < skipEastMaxX) continue
    const curveY = Math.sin(x * 0.007 + seedOffset) * 20
    stones.push({
      x,
      y: curveY + (hash1(idx * 2.7) - 0.5) * 10,
      w: 34 + hash1(idx * 3.7) * 12,
      h: 36 + hash1(idx * 5.1) * 10,
      rot: (hash1(idx * 6.3) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  for (let x = -150; x >= -540; x -= 52) {
    const curveY = Math.cos(x * 0.006 + seedOffset) * 20
    stones.push({
      x,
      y: curveY + (hash1(idx * 2.1) - 0.5) * 10,
      w: 34 + hash1(idx * 3.3) * 12,
      h: 36 + hash1(idx * 4.7) * 10,
      rot: (hash1(idx * 6.9) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  return stones
}

function placeContinentAtOrigin(c: ContinentConfig): ContinentConfig {
  const ox = c.origin.x
  const oy = c.origin.y
  if (ox === 0 && oy === 0) return c
  return {
    ...c,
    liquidCenter: { x: c.liquidCenter.x + ox, y: c.liquidCenter.y + oy },
    bridge: {
      ...c.bridge,
      minX: c.bridge.minX + ox,
      maxX: c.bridge.maxX + ox,
      yCenter: c.bridge.yCenter + oy,
    },
    shopPos: { x: c.shopPos.x + ox, y: c.shopPos.y + oy },
    gatePos: { x: c.gatePos.x + ox, y: c.gatePos.y + oy },
    trees: c.trees.map((t) => ({ ...t, x: t.x + ox, y: t.y + oy })),
    rocks: c.rocks.map((r) => ({ ...r, x: r.x + ox, y: r.y + oy })),
    lanterns: c.lanterns.map((l) => ({ x: l.x + ox, y: l.y + oy })),
    stones: c.stones.map((s) => ({ ...s, x: s.x + ox, y: s.y + oy })),
    coins: c.coins.map((cn) => ({ ...cn, x: cn.x + ox, y: cn.y + oy })),
    dummies: c.dummies.map((d) => ({ x: d.x + ox, y: d.y + oy })),
  }
}

const RAW_CONTINENTS: ContinentConfig[] = [
  // ===========================================================================
  // 1. KYOTO SHRINE COURTYARD (Center Heartland)
  // ===========================================================================
  {
    id: 'kyoto',
    keyNum: '1',
    name: 'Kyoto Shrine Courtyard',
    shortName: 'Kyoto',
    regionTag: 'CENTER · HEARTLAND',
    compassDir: 'CENTER',
    origin: { x: 0, y: 0 },
    badgeColor: '#b84239',
    paperBase: '#f7f3ec',
    boardBase: '#a9aba8',
    stoneFill: '#f1ece0',
    stoneBoardFill: '#b6b8b3',
    woodFill: '#ebe3d3',
    woodBoardFill: '#a8a9a3',
    liquidKind: 'koi-pond',
    liquidLabel: 'Koi Pond',
    liquidCenter: { x: 350, y: 0 },
    liquidRx: 112,
    liquidRy: 175,
    liquidSeedA: 77,
    liquidSeedB: 83,
    bridge: { minX: 236, maxX: 464, yCenter: 0, halfH: 19, deckHalfH: 26, style: 'wood' },
    shopPos: { x: -135, y: -110 },
    gatePos: { x: 0, y: -390 },
    gateStyle: 'torii',
    weatherKind: 'leaf',
    trees: [
      { x: -270, y: -250, r: 60, kind: 'bamboo', seed: 11 },
      { x: -355, y: -185, r: 52, kind: 'bamboo', seed: 17 },
      { x: 245, y: -240, r: 68, kind: 'maple', seed: 23 },
      { x: 340, y: -290, r: 56, kind: 'bamboo', seed: 29 },
      { x: -260, y: 245, r: 72, kind: 'pine', seed: 31 },
      { x: -375, y: 205, r: 58, kind: 'bamboo', seed: 37 },
      { x: 225, y: 260, r: 60, kind: 'bamboo', seed: 41 },
      { x: 465, y: 225, r: 66, kind: 'maple', seed: 43 },
      { x: 525, y: -155, r: 64, kind: 'pine', seed: 47 },
      { x: -535, y: -275, r: 70, kind: 'pine', seed: 53 },
      { x: -165, y: -490, r: 58, kind: 'maple', seed: 59 },
      { x: 175, y: -485, r: 60, kind: 'maple', seed: 61 },
      { x: -190, y: 470, r: 66, kind: 'bamboo', seed: 67 },
      { x: 185, y: 465, r: 64, kind: 'pine', seed: 71 },
    ],
    rocks: [
      { x: -360, y: -68, r: 20, seed: 101, kind: 'zen' },
      { x: -285, y: 62, r: 16, seed: 107, kind: 'zen' },
    ],
    lanterns: [
      { x: 92, y: -130 },
      { x: -92, y: 130 },
      { x: 92, y: 130 },
      { x: 228, y: -56 },
      { x: 228, y: 56 },
      { x: 470, y: -56 },
      { x: 470, y: 56 },
    ],
    stones: buildCourtyardStones(0, 250, 450),
    coins: [
      { x: -65, y: -45, value: 15, phase: 0.2 },
      { x: 115, y: -35, value: 15, phase: 1.4 },
      { x: 350, y: 0, value: 25, phase: 2.3 },
      { x: 0, y: -235, value: 20, phase: 3.1 },
      { x: -245, y: 35, value: 20, phase: 4.0 },
      { x: 15, y: 185, value: 15, phase: 5.2 },
    ],
    dummies: [
      { x: 105, y: -105 },
      { x: 125, y: 105 },
      { x: -125, y: 110 },
      { x: -35, y: -295 },
    ],
  },

  // ===========================================================================
  // 2. SUNSTONE DUNE OASIS (West Golden Desert Continent)
  // ===========================================================================
  {
    id: 'desert',
    keyNum: '2',
    name: 'Sunstone Dune Oasis',
    shortName: 'Desert',
    regionTag: 'WEST · GOLDEN SANDS',
    compassDir: 'WEST',
    origin: { x: -CONTINENT_SPACING, y: 0 },
    badgeColor: '#c68a32',
    paperBase: '#f3e7ce',
    boardBase: '#bfb198',
    stoneFill: '#ead8b6',
    stoneBoardFill: '#b5a385',
    woodFill: '#dfcaa4',
    woodBoardFill: '#a89675',
    liquidKind: 'oasis',
    liquidLabel: 'Desert Oasis',
    liquidCenter: { x: 340, y: 10 },
    liquidRx: 118,
    liquidRy: 162,
    liquidSeedA: 131,
    liquidSeedB: 149,
    bridge: { minX: 224, maxX: 458, yCenter: 0, halfH: 19, deckHalfH: 26, style: 'sandstone' },
    shopPos: { x: -145, y: -115 },
    gatePos: { x: 0, y: -385 },
    gateStyle: 'sandstone',
    weatherKind: 'sand',
    trees: [
      { x: 240, y: -215, r: 62, kind: 'palm', seed: 211 },
      { x: 430, y: -195, r: 58, kind: 'palm', seed: 217 },
      { x: 235, y: 220, r: 60, kind: 'palm', seed: 223 },
      { x: 465, y: 195, r: 64, kind: 'palm', seed: 229 },
      { x: -295, y: -235, r: 52, kind: 'cactus', seed: 233 },
      { x: -395, y: -120, r: 48, kind: 'cactus', seed: 239 },
      { x: -275, y: 215, r: 54, kind: 'cactus', seed: 241 },
      { x: -425, y: 165, r: 50, kind: 'cactus', seed: 251 },
      { x: -165, y: -465, r: 56, kind: 'palm', seed: 257 },
      { x: 175, y: -460, r: 54, kind: 'cactus', seed: 263 },
      { x: -185, y: 420, r: 58, kind: 'palm', seed: 269 },
      { x: 165, y: 415, r: 50, kind: 'cactus', seed: 271 },
    ],
    rocks: [
      { x: -345, y: -50, r: 24, seed: 301, kind: 'sandstone' },
      { x: -255, y: 88, r: 18, seed: 307, kind: 'sandstone' },
      { x: 520, y: -82, r: 22, seed: 311, kind: 'sandstone' },
    ],
    lanterns: [
      { x: 96, y: -125 },
      { x: -96, y: 125 },
      { x: 96, y: 125 },
      { x: 216, y: -56 },
      { x: 216, y: 56 },
      { x: 466, y: -56 },
      { x: 466, y: 56 },
    ],
    stones: buildCourtyardStones(1, 224, 458),
    coins: [
      { x: -75, y: -35, value: 15, phase: 0.4 },
      { x: 120, y: -25, value: 20, phase: 1.2 },
      { x: 340, y: 0, value: 30, phase: 2.0 },
      { x: 0, y: -225, value: 20, phase: 3.3 },
      { x: -230, y: 20, value: 20, phase: 4.1 },
      { x: 25, y: 195, value: 15, phase: 5.0 },
    ],
    dummies: [
      { x: 115, y: -95 },
      { x: 130, y: 115 },
      { x: -135, y: 110 },
      { x: 40, y: -290 },
    ],
  },

  // ===========================================================================
  // 3. FROSTPEAK SNOW SANCTUARY (North Glacier Continent)
  // ===========================================================================
  {
    id: 'frost',
    keyNum: '3',
    name: 'Frostpeak Snow Sanctuary',
    shortName: 'Frostpeak',
    regionTag: 'NORTH · GLACIER',
    compassDir: 'NORTH',
    origin: { x: 0, y: -CONTINENT_SPACING },
    badgeColor: '#4a7a96',
    paperBase: '#edf3f7',
    boardBase: '#9eacb4',
    stoneFill: '#dce6ec',
    stoneBoardFill: '#92a2ab',
    woodFill: '#d8dde2',
    woodBoardFill: '#8d969e',
    liquidKind: 'glacial-lake',
    liquidLabel: 'Glacial Lake',
    liquidCenter: { x: 355, y: -5 },
    liquidRx: 116,
    liquidRy: 180,
    liquidSeedA: 193,
    liquidSeedB: 211,
    bridge: { minX: 238, maxX: 472, yCenter: 0, halfH: 19, deckHalfH: 26, style: 'frost' },
    shopPos: { x: -135, y: -110 },
    gatePos: { x: 0, y: -390 },
    gateStyle: 'frost-torii',
    weatherKind: 'snow',
    trees: [
      { x: -280, y: -245, r: 66, kind: 'snow-pine', seed: 401 },
      { x: -380, y: -155, r: 58, kind: 'snow-pine', seed: 409 },
      { x: 245, y: -245, r: 68, kind: 'snow-pine', seed: 419 },
      { x: 385, y: -270, r: 60, kind: 'snow-pine', seed: 421 },
      { x: -265, y: 235, r: 72, kind: 'snow-pine', seed: 431 },
      { x: -390, y: 190, r: 62, kind: 'snow-pine', seed: 433 },
      { x: 225, y: 255, r: 64, kind: 'snow-pine', seed: 439 },
      { x: 480, y: 215, r: 68, kind: 'snow-pine', seed: 443 },
      { x: 535, y: -145, r: 66, kind: 'snow-pine', seed: 449 },
      { x: -165, y: -480, r: 62, kind: 'snow-pine', seed: 457 },
      { x: 175, y: -475, r: 64, kind: 'snow-pine', seed: 461 },
      { x: -180, y: 455, r: 66, kind: 'snow-pine', seed: 463 },
    ],
    rocks: [
      { x: -345, y: -55, r: 22, seed: 501, kind: 'ice' },
      { x: -270, y: 65, r: 18, seed: 509, kind: 'ice' },
      { x: 165, y: 390, r: 21, seed: 521, kind: 'ice' },
    ],
    lanterns: [
      { x: 92, y: -130 },
      { x: -92, y: 130 },
      { x: 92, y: 130 },
      { x: 230, y: -56 },
      { x: 230, y: 56 },
      { x: 478, y: -56 },
      { x: 478, y: 56 },
    ],
    stones: buildCourtyardStones(2, 238, 472),
    coins: [
      { x: -60, y: -40, value: 15, phase: 0.3 },
      { x: 115, y: -30, value: 20, phase: 1.5 },
      { x: 355, y: 0, value: 30, phase: 2.6 },
      { x: 0, y: -235, value: 20, phase: 3.4 },
      { x: -235, y: 25, value: 20, phase: 4.5 },
      { x: 15, y: 195, value: 15, phase: 5.4 },
    ],
    dummies: [
      { x: 105, y: -105 },
      { x: 125, y: 105 },
      { x: -125, y: 115 },
      { x: -35, y: -295 },
    ],
  },

  // ===========================================================================
  // 4. JADE MONSOON BASIN (South Emerald Jungle Continent)
  // ===========================================================================
  {
    id: 'jungle',
    keyNum: '4',
    name: 'Jade Monsoon Basin',
    shortName: 'Jungle',
    regionTag: 'SOUTH · EMERALD BASIN',
    compassDir: 'SOUTH',
    origin: { x: 0, y: CONTINENT_SPACING },
    badgeColor: '#3f7a56',
    paperBase: '#eaeede',
    boardBase: '#9ea894',
    stoneFill: '#dce2ce',
    stoneBoardFill: '#96a08b',
    woodFill: '#dfd7bd',
    woodBoardFill: '#9c9680',
    liquidKind: 'emerald-lagoon',
    liquidLabel: 'Emerald Lagoon',
    liquidCenter: { x: 348, y: 8 },
    liquidRx: 115,
    liquidRy: 178,
    liquidSeedA: 263,
    liquidSeedB: 281,
    bridge: { minX: 232, maxX: 464, yCenter: 0, halfH: 19, deckHalfH: 26, style: 'bamboo' },
    shopPos: { x: -140, y: -110 },
    gatePos: { x: 0, y: -388 },
    gateStyle: 'temple',
    weatherKind: 'firefly',
    trees: [
      { x: -275, y: -240, r: 68, kind: 'jungle', seed: 601 },
      { x: -375, y: -160, r: 58, kind: 'bamboo', seed: 607 },
      { x: 240, y: -235, r: 70, kind: 'jungle', seed: 613 },
      { x: 365, y: -285, r: 58, kind: 'palm', seed: 617 },
      { x: -265, y: 240, r: 72, kind: 'jungle', seed: 619 },
      { x: -380, y: 185, r: 60, kind: 'palm', seed: 631 },
      { x: 225, y: 255, r: 64, kind: 'bamboo', seed: 641 },
      { x: 475, y: 220, r: 70, kind: 'jungle', seed: 643 },
      { x: 525, y: -155, r: 64, kind: 'palm', seed: 647 },
      { x: -515, y: -255, r: 68, kind: 'jungle', seed: 653 },
      { x: -165, y: -480, r: 62, kind: 'bamboo', seed: 659 },
      { x: 175, y: -475, r: 64, kind: 'jungle', seed: 661 },
      { x: -185, y: 455, r: 66, kind: 'palm', seed: 673 },
      { x: 185, y: 450, r: 66, kind: 'jungle', seed: 677 },
    ],
    rocks: [
      { x: -355, y: -55, r: 22, seed: 701, kind: 'moss' },
      { x: -280, y: 68, r: 18, seed: 709, kind: 'moss' },
    ],
    lanterns: [
      { x: 92, y: -130 },
      { x: -92, y: 130 },
      { x: 92, y: 130 },
      { x: 224, y: -56 },
      { x: 224, y: 56 },
      { x: 470, y: -56 },
      { x: 470, y: 56 },
    ],
    stones: buildCourtyardStones(3, 232, 464),
    coins: [
      { x: -65, y: -45, value: 20, phase: 0.5 },
      { x: 118, y: -35, value: 20, phase: 1.7 },
      { x: 348, y: 0, value: 30, phase: 2.8 },
      { x: 0, y: -235, value: 20, phase: 3.6 },
      { x: -240, y: 30, value: 20, phase: 4.4 },
      { x: 20, y: 185, value: 15, phase: 5.5 },
    ],
    dummies: [
      { x: 110, y: -102 },
      { x: 128, y: 108 },
      { x: -125, y: 112 },
      { x: -35, y: -292 },
    ],
  },

  // ===========================================================================
  // 5. OBSIDIAN EMBER CALDERA (East Volcanic Ash Continent)
  // ===========================================================================
  {
    id: 'volcano',
    keyNum: '5',
    name: 'Obsidian Ember Caldera',
    shortName: 'Caldera',
    regionTag: 'EAST · VOLCANIC ASH',
    compassDir: 'EAST',
    origin: { x: CONTINENT_SPACING, y: 0 },
    badgeColor: '#c94c2c',
    paperBase: '#e3dcd4',
    boardBase: '#8f8984',
    stoneFill: '#cbc3ba',
    stoneBoardFill: '#7d7772',
    woodFill: '#b5aca4',
    woodBoardFill: '#6e6864',
    liquidKind: 'magma',
    liquidLabel: 'Molten Caldera',
    liquidCenter: { x: 352, y: 0 },
    liquidRx: 114,
    liquidRy: 174,
    liquidSeedA: 331,
    liquidSeedB: 353,
    bridge: { minX: 236, maxX: 468, yCenter: 0, halfH: 19, deckHalfH: 26, style: 'obsidian' },
    shopPos: { x: -140, y: -112 },
    gatePos: { x: 0, y: -388 },
    gateStyle: 'obsidian',
    weatherKind: 'ember',
    trees: [
      { x: -275, y: -245, r: 64, kind: 'charred', seed: 809 },
      { x: -375, y: -165, r: 56, kind: 'charred', seed: 811 },
      { x: 245, y: -245, r: 66, kind: 'charred', seed: 821 },
      { x: 380, y: -280, r: 58, kind: 'charred', seed: 823 },
      { x: -265, y: 240, r: 70, kind: 'charred', seed: 827 },
      { x: -385, y: 195, r: 58, kind: 'charred', seed: 829 },
      { x: 225, y: 255, r: 62, kind: 'charred', seed: 839 },
      { x: 475, y: 220, r: 66, kind: 'charred', seed: 853 },
      { x: 525, y: -155, r: 64, kind: 'charred', seed: 857 },
      { x: -165, y: -480, r: 60, kind: 'charred', seed: 859 },
      { x: 175, y: -475, r: 62, kind: 'charred', seed: 863 },
      { x: -185, y: 455, r: 64, kind: 'charred', seed: 877 },
    ],
    rocks: [
      { x: -350, y: -58, r: 23, seed: 907, kind: 'basalt' },
      { x: -275, y: 66, r: 19, seed: 911, kind: 'basalt' },
      { x: 525, y: 35, r: 21, seed: 919, kind: 'basalt' },
    ],
    lanterns: [
      { x: 92, y: -130 },
      { x: -92, y: 130 },
      { x: 92, y: 130 },
      { x: 228, y: -56 },
      { x: 228, y: 56 },
      { x: 474, y: -56 },
      { x: 474, y: 56 },
    ],
    stones: buildCourtyardStones(4, 236, 468),
    coins: [
      { x: -65, y: -40, value: 20, phase: 0.2 },
      { x: 118, y: -30, value: 20, phase: 1.3 },
      { x: 352, y: 0, value: 35, phase: 2.5 },
      { x: 0, y: -235, value: 25, phase: 3.2 },
      { x: -238, y: 25, value: 20, phase: 4.3 },
      { x: 15, y: 190, value: 20, phase: 5.1 },
    ],
    dummies: [
      { x: 108, y: -102 },
      { x: 126, y: 108 },
      { x: -125, y: 112 },
      { x: -35, y: -292 },
    ],
  },
]

export const CONTINENTS: ContinentConfig[] = RAW_CONTINENTS.map(placeContinentAtOrigin)

// Scenic stepping-stone border roads connecting Center Kyoto to all 4 Cardinal Continents!
export const CONNECTOR_STONES: StoneSlab[] = (() => {
  const stones: StoneSlab[] = []
  let idx = 900
  // West road: Kyoto (-540) -> Desert (-1090)
  for (let x = -590; x >= -1080; x -= 58) {
    const curveY = Math.sin(x * 0.008) * 18
    stones.push({
      x,
      y: curveY,
      w: 38 + hash1(idx * 2.1) * 12,
      h: 34 + hash1(idx * 3.7) * 10,
      rot: (hash1(idx * 5.3) - 0.5) * 0.2,
      seed: idx++,
    })
  }
  // East road: Kyoto (+600) -> Caldera (+1120)
  for (let x = 640; x <= 1110; x += 58) {
    const curveY = Math.sin(x * 0.008) * 18
    stones.push({
      x,
      y: curveY,
      w: 38 + hash1(idx * 2.1) * 12,
      h: 34 + hash1(idx * 3.7) * 10,
      rot: (hash1(idx * 5.3) - 0.5) * 0.2,
      seed: idx++,
    })
  }
  // North road: Kyoto (-560) -> Frostpeak (-1140)
  for (let y = -590; y >= -1120; y -= 58) {
    const curveX = Math.sin(y * 0.008) * 20
    stones.push({
      x: curveX,
      y,
      w: 44 + hash1(idx * 2.3) * 12,
      h: 30 + hash1(idx * 4.1) * 8,
      rot: (hash1(idx * 6.7) - 0.5) * 0.2,
      seed: idx++,
    })
  }
  // South road: Kyoto (+520) -> Jungle (+1120)
  for (let y = 555; y <= 1100; y += 58) {
    const curveX = Math.sin(y * 0.008) * 20
    stones.push({
      x: curveX,
      y,
      w: 44 + hash1(idx * 2.3) * 12,
      h: 30 + hash1(idx * 4.1) * 8,
      rot: (hash1(idx * 6.7) - 0.5) * 0.2,
      seed: idx++,
    })
  }
  return stones
})()

export interface RoadSignpost {
  x: number
  y: number
  label: string
  accent: string
}

export const ROAD_SIGNPOSTS: RoadSignpost[] = [
  { x: -640, y: -44, label: '← WEST · SUNSTONE DESERT', accent: '#c68a32' },
  { x: 660, y: -44, label: 'EAST · EMBER CALDERA →', accent: '#c94c2c' },
  { x: 68, y: -620, label: '↑ NORTH · FROSTPEAK', accent: '#4a7a96' },
  { x: 68, y: 580, label: '↓ SOUTH · JADE JUNGLE', accent: '#3f7a56' },
]

export function getContinentById(id: ContinentId): ContinentConfig {
  return CONTINENTS.find((c) => c.id === id) ?? CONTINENTS[0]
}

export function getNearestContinent(x: number, y: number): ContinentConfig {
  let best = CONTINENTS[0]
  let bestDistSq = Infinity
  for (const c of CONTINENTS) {
    const dx = x - c.origin.x
    const dy = y - c.origin.y
    const d2 = dx * dx + dy * dy
    if (d2 < bestDistSq) {
      bestDistSq = d2
      best = c
    }
  }
  return best
}
