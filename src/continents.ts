import type { Vec2 } from './samuraiRig'

export type ContinentId = 'kyoto' | 'desert' | 'jungle' | 'frost' | 'volcano'

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
  tier: number
  tierLabel: string
  recommendedGear: string
  name: string
  shortName: string
  regionTag: string
  compassDir: string
  origin: Vec2
  territoryRadius: number
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

export interface ExpeditionRoute {
  id: string
  name: string
  dangerTag: string
  from: Vec2
  control: Vec2
  to: Vec2
  color: string
}

export interface WaystationCamp {
  id: string
  name: string
  x: number
  y: number
  signText: string
  accent: string
  biomeKind: TreeKind
}

export interface WildernessPool {
  id: string
  x: number
  y: number
  rx: number
  ry: number
  seedA: number
  seedB: number
  kind: 'koi-pond' | 'oasis' | 'glacial-lake' | 'emerald-lagoon' | 'magma'
}

export interface MysteriousStatue {
  id: string
  trueName: string
  taskPrompt: string
  x: number
  y: number
  tier: number
  rewardGold: number
  style: 'monk' | 'kitsune' | 'obelisk' | 'guardian' | 'oni'
  accent: string
}

// Vast 12,800 x 9,600 open-world expedition bounds!
export const WORLD_LIMIT_X = 6400
export const WORLD_LIMIT_Y = 4800
export const WAYSHRINE_UNLOCK_RADIUS = 620

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
    Math.sin(angle * 3 + continent.liquidSeedA * 0.05) * 16 +
    handDrift(seg * 15, continent.liquidSeedA, 5)
  const ry =
    continent.liquidRy +
    Math.cos(angle * 2 + continent.liquidSeedB * 0.05) * 20 +
    handDrift(seg * 15, continent.liquidSeedB, 5)
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
    const rad = ring * 58
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.22
      stones.push({
        x: Math.cos(a) * rad,
        y: Math.sin(a) * rad,
        w: 38 + hash1(idx * 3.1) * 10,
        h: 28 + hash1(idx * 5.7) * 8,
        rot: a + Math.PI * 0.5 + (hash1(idx) - 0.5) * 0.18,
        seed: idx++,
      })
    }
  }
  for (let y = -165; y >= -680; y -= 56) {
    const curveX = Math.sin(y * 0.007 + seedOffset) * 28
    stones.push({
      x: curveX + (hash1(idx * 1.9) - 0.5) * 14,
      y,
      w: 46 + hash1(idx * 2.3) * 14,
      h: 30 + hash1(idx * 4.1) * 8,
      rot: (hash1(idx * 7.1) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  for (let y = 165; y <= 660; y += 56) {
    const curveX = Math.sin(y * 0.007 + seedOffset) * 30
    stones.push({
      x: curveX + (hash1(idx * 1.9) - 0.5) * 14,
      y,
      w: 46 + hash1(idx * 2.3) * 14,
      h: 30 + hash1(idx * 4.1) * 8,
      rot: (hash1(idx * 7.1) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  for (let x = 160; x <= 740; x += 56) {
    if (x > skipEastMinX && x < skipEastMaxX) continue
    const curveY = Math.sin(x * 0.007 + seedOffset) * 20
    stones.push({
      x,
      y: curveY + (hash1(idx * 2.7) - 0.5) * 10,
      w: 36 + hash1(idx * 3.7) * 12,
      h: 38 + hash1(idx * 5.1) * 10,
      rot: (hash1(idx * 6.3) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  for (let x = -160; x >= -700; x -= 56) {
    const curveY = Math.cos(x * 0.006 + seedOffset) * 20
    stones.push({
      x,
      y: curveY + (hash1(idx * 2.1) - 0.5) * 10,
      w: 36 + hash1(idx * 3.3) * 12,
      h: 38 + hash1(idx * 4.7) * 10,
      rot: (hash1(idx * 6.9) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  return stones
}

function placeContinentAtOrigin(c: ContinentConfig): ContinentConfig {
  const ox = c.origin.x
  const oy = c.origin.y
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

// =============================================================================
// 5 FAR-APART CONTINENTS ARRANGED IN AN ASYMMETRIC PROGRESSION EXPEDITION ARC
// =============================================================================
const RAW_CONTINENTS: ContinentConfig[] = [
  // 1. TIER I — KYOTO SHRINE COURTYARD (Western Heartland Spawn)
  {
    id: 'kyoto',
    keyNum: '1',
    tier: 1,
    tierLabel: 'TIER I · STARTER',
    recommendedGear: 'Starter Katana',
    name: 'Kyoto Shrine Courtyard',
    shortName: 'Kyoto',
    regionTag: 'TIER I · WEST HEARTLAND',
    compassDir: 'WEST-SW',
    origin: { x: -3900, y: 650 },
    territoryRadius: 1180,
    badgeColor: '#b84239',
    paperBase: '#f7f3ec',
    boardBase: '#a9aba8',
    stoneFill: '#f1ece0',
    stoneBoardFill: '#b6b8b3',
    woodFill: '#ebe3d3',
    woodBoardFill: '#a8a9a3',
    liquidKind: 'koi-pond',
    liquidLabel: 'Koi Pond',
    liquidCenter: { x: 370, y: 0 },
    liquidRx: 124,
    liquidRy: 192,
    liquidSeedA: 77,
    liquidSeedB: 83,
    bridge: { minX: 242, maxX: 498, yCenter: 0, halfH: 19, deckHalfH: 26, style: 'wood' },
    shopPos: { x: -145, y: -115 },
    gatePos: { x: 0, y: -430 },
    gateStyle: 'torii',
    weatherKind: 'leaf',
    trees: [
      { x: -290, y: -270, r: 62, kind: 'bamboo', seed: 11 },
      { x: -395, y: -195, r: 54, kind: 'bamboo', seed: 17 },
      { x: 255, y: -265, r: 68, kind: 'maple', seed: 23 },
      { x: 365, y: -315, r: 58, kind: 'bamboo', seed: 29 },
      { x: -280, y: 265, r: 72, kind: 'pine', seed: 31 },
      { x: -415, y: 215, r: 58, kind: 'bamboo', seed: 37 },
      { x: 235, y: 280, r: 60, kind: 'bamboo', seed: 41 },
      { x: 505, y: 245, r: 68, kind: 'maple', seed: 43 },
      { x: 575, y: -175, r: 66, kind: 'pine', seed: 47 },
      { x: -585, y: -295, r: 72, kind: 'pine', seed: 53 },
      { x: -185, y: -535, r: 60, kind: 'maple', seed: 59 },
      { x: 195, y: -530, r: 62, kind: 'maple', seed: 61 },
      { x: -210, y: 520, r: 66, kind: 'bamboo', seed: 67 },
      { x: 205, y: 515, r: 64, kind: 'pine', seed: 71 },
      { x: -640, y: 310, r: 68, kind: 'maple', seed: 73 },
      { x: 660, y: 120, r: 62, kind: 'bamboo', seed: 79 },
    ],
    rocks: [
      { x: -380, y: -72, r: 21, seed: 101, kind: 'zen' },
      { x: -305, y: 68, r: 17, seed: 107, kind: 'zen' },
    ],
    lanterns: [
      { x: 96, y: -135 },
      { x: -96, y: 135 },
      { x: 96, y: 135 },
      { x: 234, y: -58 },
      { x: 234, y: 58 },
      { x: 504, y: -58 },
      { x: 504, y: 58 },
    ],
    stones: buildCourtyardStones(0, 242, 498),
    coins: [
      { x: -65, y: -45, value: 15, phase: 0.2 },
      { x: 115, y: -35, value: 15, phase: 1.4 },
      { x: 370, y: 0, value: 25, phase: 2.3 },
      { x: 0, y: -255, value: 20, phase: 3.1 },
      { x: -255, y: 35, value: 20, phase: 4.0 },
      { x: 15, y: 205, value: 15, phase: 5.2 },
    ],
    dummies: [
      { x: 108, y: -108 },
      { x: 128, y: 108 },
      { x: -128, y: 112 },
      { x: -38, y: -315 },
    ],
  },

  // 2. TIER II — SUNSTONE DUNE OASIS (Far South-Central Badlands)
  {
    id: 'desert',
    keyNum: '2',
    tier: 2,
    tierLabel: 'TIER II · ARID FRONTIER',
    recommendedGear: 'Crimson Scarf + Gale Hat',
    name: 'Sunstone Dune Oasis',
    shortName: 'Desert',
    regionTag: 'TIER II · SOUTHERN SANDS',
    compassDir: 'SOUTH',
    origin: { x: -1050, y: 2750 },
    territoryRadius: 1220,
    badgeColor: '#c68a32',
    paperBase: '#f3e7ce',
    boardBase: '#bfb198',
    stoneFill: '#ead8b6',
    stoneBoardFill: '#b5a385',
    woodFill: '#dfcaa4',
    woodBoardFill: '#a89675',
    liquidKind: 'oasis',
    liquidLabel: 'Desert Oasis',
    liquidCenter: { x: 365, y: 10 },
    liquidRx: 128,
    liquidRy: 180,
    liquidSeedA: 131,
    liquidSeedB: 149,
    bridge: { minX: 232, maxX: 496, yCenter: 0, halfH: 19, deckHalfH: 26, style: 'sandstone' },
    shopPos: { x: -150, y: -118 },
    gatePos: { x: 0, y: -425 },
    gateStyle: 'sandstone',
    weatherKind: 'sand',
    trees: [
      { x: 250, y: -235, r: 64, kind: 'palm', seed: 211 },
      { x: 465, y: -215, r: 60, kind: 'palm', seed: 217 },
      { x: 245, y: 240, r: 62, kind: 'palm', seed: 223 },
      { x: 495, y: 215, r: 66, kind: 'palm', seed: 229 },
      { x: -315, y: -255, r: 54, kind: 'cactus', seed: 233 },
      { x: -435, y: -135, r: 50, kind: 'cactus', seed: 239 },
      { x: -295, y: 235, r: 56, kind: 'cactus', seed: 241 },
      { x: -465, y: 185, r: 52, kind: 'cactus', seed: 251 },
      { x: -185, y: -515, r: 58, kind: 'palm', seed: 257 },
      { x: 195, y: -510, r: 56, kind: 'cactus', seed: 263 },
      { x: -205, y: 480, r: 60, kind: 'palm', seed: 269 },
      { x: 185, y: 475, r: 52, kind: 'cactus', seed: 271 },
      { x: -610, y: -260, r: 54, kind: 'cactus', seed: 277 },
      { x: 640, y: -140, r: 60, kind: 'palm', seed: 281 },
    ],
    rocks: [
      { x: -365, y: -55, r: 25, seed: 301, kind: 'sandstone' },
      { x: -275, y: 92, r: 19, seed: 307, kind: 'sandstone' },
      { x: 565, y: -92, r: 23, seed: 311, kind: 'sandstone' },
    ],
    lanterns: [
      { x: 96, y: -130 },
      { x: -96, y: 130 },
      { x: 96, y: 130 },
      { x: 226, y: -58 },
      { x: 226, y: 58 },
      { x: 502, y: -58 },
      { x: 502, y: 58 },
    ],
    stones: buildCourtyardStones(1, 232, 496),
    coins: [
      { x: -75, y: -35, value: 20, phase: 0.4 },
      { x: 120, y: -25, value: 25, phase: 1.2 },
      { x: 365, y: 0, value: 35, phase: 2.0 },
      { x: 0, y: -245, value: 25, phase: 3.3 },
      { x: -240, y: 20, value: 25, phase: 4.1 },
      { x: 25, y: 215, value: 20, phase: 5.0 },
    ],
    dummies: [
      { x: 115, y: -98 },
      { x: 132, y: 118 },
      { x: -138, y: 112 },
      { x: 42, y: -310 },
    ],
  },

  // 3. TIER III — JADE MONSOON BASIN (Deep Southeast Rainforest)
  {
    id: 'jungle',
    keyNum: '3',
    tier: 3,
    tierLabel: 'TIER III · MONSOON WILDS',
    recommendedGear: 'Yumi War Bow + Magnet Bell',
    name: 'Jade Monsoon Basin',
    shortName: 'Jungle',
    regionTag: 'TIER III · SE EMERALD BASIN',
    compassDir: 'SOUTHEAST',
    origin: { x: 2150, y: 1750 },
    territoryRadius: 1260,
    badgeColor: '#3f7a56',
    paperBase: '#eaeede',
    boardBase: '#9ea894',
    stoneFill: '#dce2ce',
    stoneBoardFill: '#96a08b',
    woodFill: '#dfd7bd',
    woodBoardFill: '#9c9680',
    liquidKind: 'emerald-lagoon',
    liquidLabel: 'Emerald Lagoon',
    liquidCenter: { x: 372, y: 8 },
    liquidRx: 126,
    liquidRy: 194,
    liquidSeedA: 263,
    liquidSeedB: 281,
    bridge: { minX: 240, maxX: 502, yCenter: 0, halfH: 19, deckHalfH: 26, style: 'bamboo' },
    shopPos: { x: -145, y: -115 },
    gatePos: { x: 0, y: -430 },
    gateStyle: 'temple',
    weatherKind: 'firefly',
    trees: [
      { x: -295, y: -260, r: 70, kind: 'jungle', seed: 601 },
      { x: -405, y: -175, r: 60, kind: 'bamboo', seed: 607 },
      { x: 255, y: -255, r: 72, kind: 'jungle', seed: 613 },
      { x: 395, y: -305, r: 60, kind: 'palm', seed: 617 },
      { x: -285, y: 260, r: 74, kind: 'jungle', seed: 619 },
      { x: -415, y: 205, r: 62, kind: 'palm', seed: 631 },
      { x: 245, y: 275, r: 66, kind: 'bamboo', seed: 641 },
      { x: 515, y: 240, r: 72, kind: 'jungle', seed: 643 },
      { x: 575, y: -175, r: 66, kind: 'palm', seed: 647 },
      { x: -565, y: -275, r: 70, kind: 'jungle', seed: 653 },
      { x: -185, y: -525, r: 64, kind: 'bamboo', seed: 659 },
      { x: 195, y: -520, r: 66, kind: 'jungle', seed: 661 },
      { x: -205, y: 505, r: 68, kind: 'palm', seed: 673 },
      { x: 205, y: 500, r: 68, kind: 'jungle', seed: 677 },
      { x: -640, y: 240, r: 70, kind: 'jungle', seed: 683 },
      { x: 660, y: 140, r: 64, kind: 'bamboo', seed: 691 },
    ],
    rocks: [
      { x: -375, y: -60, r: 23, seed: 701, kind: 'moss' },
      { x: -295, y: 74, r: 19, seed: 709, kind: 'moss' },
    ],
    lanterns: [
      { x: 96, y: -135 },
      { x: -96, y: 135 },
      { x: 96, y: 135 },
      { x: 234, y: -58 },
      { x: 234, y: 58 },
      { x: 508, y: -58 },
      { x: 508, y: 58 },
    ],
    stones: buildCourtyardStones(3, 240, 502),
    coins: [
      { x: -65, y: -45, value: 25, phase: 0.5 },
      { x: 118, y: -35, value: 25, phase: 1.7 },
      { x: 372, y: 0, value: 40, phase: 2.8 },
      { x: 0, y: -255, value: 30, phase: 3.6 },
      { x: -250, y: 30, value: 25, phase: 4.4 },
      { x: 20, y: 205, value: 25, phase: 5.5 },
    ],
    dummies: [
      { x: 112, y: -106 },
      { x: 130, y: 110 },
      { x: -128, y: 115 },
      { x: -38, y: -312 },
    ],
  },

  // 4. TIER IV — FROSTPEAK SNOW SANCTUARY (Far Northern Glacier Summit)
  {
    id: 'frost',
    keyNum: '4',
    tier: 4,
    tierLabel: 'TIER IV · GLACIER SUMMIT',
    recommendedGear: 'Moonlight Sword + Shadow Cloak',
    name: 'Frostpeak Snow Sanctuary',
    shortName: 'Frostpeak',
    regionTag: 'TIER IV · NORTHERN GLACIER',
    compassDir: 'NORTH',
    origin: { x: -450, y: -2950 },
    territoryRadius: 1260,
    badgeColor: '#4a7a96',
    paperBase: '#edf3f7',
    boardBase: '#9eacb4',
    stoneFill: '#dce6ec',
    stoneBoardFill: '#92a2ab',
    woodFill: '#d8dde2',
    woodBoardFill: '#8d969e',
    liquidKind: 'glacial-lake',
    liquidLabel: 'Glacial Lake',
    liquidCenter: { x: 375, y: -5 },
    liquidRx: 128,
    liquidRy: 196,
    liquidSeedA: 193,
    liquidSeedB: 211,
    bridge: { minX: 244, maxX: 506, yCenter: 0, halfH: 19, deckHalfH: 26, style: 'frost' },
    shopPos: { x: -145, y: -115 },
    gatePos: { x: 0, y: -430 },
    gateStyle: 'frost-torii',
    weatherKind: 'snow',
    trees: [
      { x: -300, y: -265, r: 68, kind: 'snow-pine', seed: 401 },
      { x: -410, y: -170, r: 60, kind: 'snow-pine', seed: 409 },
      { x: 260, y: -265, r: 70, kind: 'snow-pine', seed: 419 },
      { x: 415, y: -295, r: 62, kind: 'snow-pine', seed: 421 },
      { x: -285, y: 255, r: 74, kind: 'snow-pine', seed: 431 },
      { x: -420, y: 205, r: 64, kind: 'snow-pine', seed: 433 },
      { x: 245, y: 275, r: 66, kind: 'snow-pine', seed: 439 },
      { x: 520, y: 235, r: 70, kind: 'snow-pine', seed: 443 },
      { x: 585, y: -165, r: 68, kind: 'snow-pine', seed: 449 },
      { x: -185, y: -525, r: 64, kind: 'snow-pine', seed: 457 },
      { x: 195, y: -520, r: 66, kind: 'snow-pine', seed: 461 },
      { x: -200, y: 505, r: 68, kind: 'snow-pine', seed: 463 },
      { x: -620, y: -280, r: 70, kind: 'snow-pine', seed: 467 },
      { x: 650, y: 125, r: 66, kind: 'snow-pine', seed: 479 },
    ],
    rocks: [
      { x: -365, y: -60, r: 23, seed: 501, kind: 'ice' },
      { x: -285, y: 72, r: 19, seed: 509, kind: 'ice' },
      { x: 185, y: 430, r: 22, seed: 521, kind: 'ice' },
    ],
    lanterns: [
      { x: 96, y: -135 },
      { x: -96, y: 135 },
      { x: 96, y: 135 },
      { x: 238, y: -58 },
      { x: 238, y: 58 },
      { x: 512, y: -58 },
      { x: 512, y: 58 },
    ],
    stones: buildCourtyardStones(2, 244, 506),
    coins: [
      { x: -60, y: -40, value: 30, phase: 0.3 },
      { x: 115, y: -30, value: 30, phase: 1.5 },
      { x: 375, y: 0, value: 45, phase: 2.6 },
      { x: 0, y: -255, value: 35, phase: 3.4 },
      { x: -245, y: 25, value: 30, phase: 4.5 },
      { x: 15, y: 215, value: 30, phase: 5.4 },
    ],
    dummies: [
      { x: 108, y: -108 },
      { x: 128, y: 108 },
      { x: -128, y: 118 },
      { x: -38, y: -315 },
    ],
  },

  // 5. TIER V — OBSIDIAN EMBER CALDERA (Far Northeast Endgame Abyss)
  {
    id: 'volcano',
    keyNum: '5',
    tier: 5,
    tierLabel: 'TIER V · ENDGAME ABYSS',
    recommendedGear: 'Full Masterwork + Focus Tea',
    name: 'Obsidian Ember Caldera',
    shortName: 'Caldera',
    regionTag: 'TIER V · NE VOLCANIC ASH',
    compassDir: 'NORTHEAST',
    origin: { x: 4650, y: -2150 },
    territoryRadius: 1320,
    badgeColor: '#c94c2c',
    paperBase: '#e3dcd4',
    boardBase: '#8f8984',
    stoneFill: '#cbc3ba',
    stoneBoardFill: '#7d7772',
    woodFill: '#b5aca4',
    woodBoardFill: '#6e6864',
    liquidKind: 'magma',
    liquidLabel: 'Molten Caldera',
    liquidCenter: { x: 374, y: 0 },
    liquidRx: 128,
    liquidRy: 192,
    liquidSeedA: 331,
    liquidSeedB: 353,
    bridge: { minX: 242, maxX: 504, yCenter: 0, halfH: 19, deckHalfH: 26, style: 'obsidian' },
    shopPos: { x: -145, y: -115 },
    gatePos: { x: 0, y: -430 },
    gateStyle: 'obsidian',
    weatherKind: 'ember',
    trees: [
      { x: -295, y: -265, r: 66, kind: 'charred', seed: 809 },
      { x: -405, y: -180, r: 58, kind: 'charred', seed: 811 },
      { x: 260, y: -265, r: 68, kind: 'charred', seed: 821 },
      { x: 410, y: -305, r: 60, kind: 'charred', seed: 823 },
      { x: -285, y: 260, r: 72, kind: 'charred', seed: 827 },
      { x: -415, y: 210, r: 60, kind: 'charred', seed: 829 },
      { x: 245, y: 275, r: 64, kind: 'charred', seed: 839 },
      { x: 515, y: 240, r: 68, kind: 'charred', seed: 853 },
      { x: 575, y: -175, r: 66, kind: 'charred', seed: 857 },
      { x: -185, y: -525, r: 62, kind: 'charred', seed: 859 },
      { x: 195, y: -520, r: 64, kind: 'charred', seed: 863 },
      { x: -205, y: 505, r: 66, kind: 'charred', seed: 877 },
      { x: -625, y: -265, r: 68, kind: 'charred', seed: 881 },
      { x: 655, y: 130, r: 64, kind: 'charred', seed: 887 },
    ],
    rocks: [
      { x: -370, y: -62, r: 24, seed: 907, kind: 'basalt' },
      { x: -295, y: 72, r: 20, seed: 911, kind: 'basalt' },
      { x: 575, y: 45, r: 22, seed: 919, kind: 'basalt' },
    ],
    lanterns: [
      { x: 96, y: -135 },
      { x: -96, y: 135 },
      { x: 96, y: 135 },
      { x: 234, y: -58 },
      { x: 234, y: 58 },
      { x: 510, y: -58 },
      { x: 510, y: 58 },
    ],
    stones: buildCourtyardStones(4, 242, 504),
    coins: [
      { x: -65, y: -40, value: 35, phase: 0.2 },
      { x: 118, y: -30, value: 35, phase: 1.3 },
      { x: 374, y: 0, value: 55, phase: 2.5 },
      { x: 0, y: -255, value: 40, phase: 3.2 },
      { x: -248, y: 25, value: 35, phase: 4.3 },
      { x: 15, y: 210, value: 35, phase: 5.1 },
    ],
    dummies: [
      { x: 110, y: -106 },
      { x: 128, y: 110 },
      { x: -128, y: 115 },
      { x: -38, y: -312 },
    ],
  },
]

export const CONTINENTS: ContinentConfig[] = RAW_CONTINENTS.map(placeContinentAtOrigin)

// =============================================================================
// 6 LONG WINDING EXPEDITION TRAILS & MIDWAY WAYSTATIONS LINKING THE VAST WORLD
// =============================================================================
export const EXPEDITION_ROUTES: ExpeditionRoute[] = [
  {
    id: 'kyoto-desert',
    name: 'Red Canyon Caravan Trail',
    dangerTag: 'TIER I → II',
    from: { x: -3900, y: 650 },
    control: { x: -2650, y: 2150 },
    to: { x: -1050, y: 2750 },
    color: '#c68a32',
  },
  {
    id: 'desert-jungle',
    name: 'Monsoon River Valley Road',
    dangerTag: 'TIER II → III',
    from: { x: -1050, y: 2750 },
    control: { x: 650, y: 2850 },
    to: { x: 2150, y: 1750 },
    color: '#3f7a56',
  },
  {
    id: 'kyoto-frost',
    name: 'Highland Pilgrim Ascent',
    dangerTag: 'TIER I → IV',
    from: { x: -3900, y: 650 },
    control: { x: -2650, y: -1550 },
    to: { x: -450, y: -2950 },
    color: '#4a7a96',
  },
  {
    id: 'crossroads-link',
    name: 'Imperial Heartland Pass',
    dangerTag: 'TIER II ↔ IV',
    from: { x: -1050, y: 2750 },
    control: { x: -350, y: -50 },
    to: { x: -450, y: -2950 },
    color: '#7a6f5d',
  },
  {
    id: 'jungle-volcano',
    name: 'Scorched Cinder Highway',
    dangerTag: 'TIER III → V',
    from: { x: 2150, y: 1750 },
    control: { x: 3750, y: 150 },
    to: { x: 4650, y: -2150 },
    color: '#c94c2c',
  },
  {
    id: 'frost-volcano',
    name: 'Ashen Glacier Ridge',
    dangerTag: 'TIER IV → V',
    from: { x: -450, y: -2950 },
    control: { x: 2150, y: -3350 },
    to: { x: 4650, y: -2150 },
    color: '#9c4c3e',
  },
]

export function sampleRouteBezier(route: ExpeditionRoute, t: number): Vec2 {
  const u = 1 - t
  return {
    x: u * u * route.from.x + 2 * u * t * route.control.x + t * t * route.to.x,
    y: u * u * route.from.y + 2 * u * t * route.control.y + t * t * route.to.y,
  }
}

export const WAYSTATIONS: WaystationCamp[] = [
  {
    id: 'ws-canyon',
    name: 'Canyon Outpost',
    x: -2560,
    y: 1920,
    signText: 'SE → SUNSTONE DESERT (TIER II)  |  NW → KYOTO',
    accent: '#c68a32',
    biomeKind: 'cactus',
  },
  {
    id: 'ws-monsoon',
    name: 'River Ferry Camp',
    x: 600,
    y: 2560,
    signText: 'NE → JADE JUNGLE (TIER III)  |  W → DESERT',
    accent: '#3f7a56',
    biomeKind: 'palm',
  },
  {
    id: 'ws-highland',
    name: 'Misty Pine Shrine',
    x: -2420,
    y: -1340,
    signText: 'NE → FROSTPEAK (TIER IV)  |  SW → KYOTO',
    accent: '#4a7a96',
    biomeKind: 'snow-pine',
  },
  {
    id: 'ws-crossroads',
    name: 'Central Watchtower',
    x: -560,
    y: -120,
    signText: 'N → FROSTPEAK  |  S → DESERT  |  SE → JUNGLE',
    accent: '#b84239',
    biomeKind: 'pine',
  },
  {
    id: 'ws-cinder',
    name: 'Cinder Pass Watch',
    x: 3580,
    y: -50,
    signText: 'N → EMBER CALDERA (TIER V)  |  SW → JUNGLE',
    accent: '#c94c2c',
    biomeKind: 'charred',
  },
  {
    id: 'ws-ridge',
    name: 'Ash-Snow Summit',
    x: 2120,
    y: -2960,
    signText: 'E → EMBER CALDERA (TIER V)  |  W → FROSTPEAK',
    accent: '#9c4c3e',
    biomeKind: 'snow-pine',
  },
]

function isInsideAnyContinentPlaza(x: number, y: number, padRadius: number): boolean {
  for (const c of CONTINENTS) {
    if (Math.hypot(x - c.origin.x, y - c.origin.y) < padRadius) return true
  }
  return false
}

// Generate continuous stepping-stone trails along all 6 long expedition routes!
export const CONNECTOR_STONES: StoneSlab[] = (() => {
  const stones: StoneSlab[] = []
  let idx = 1200
  for (const route of EXPEDITION_ROUTES) {
    const approxLen =
      Math.hypot(route.control.x - route.from.x, route.control.y - route.from.y) +
      Math.hypot(route.to.x - route.control.x, route.to.y - route.control.y)
    const steps = Math.max(24, Math.floor(approxLen / 72))
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      const pt = sampleRouteBezier(route, t)
      if (isInsideAnyContinentPlaza(pt.x, pt.y, 680)) continue
      const nextPt = sampleRouteBezier(route, Math.min(1, t + 0.01))
      const tangent = Math.atan2(nextPt.y - pt.y, nextPt.x - pt.x)
      stones.push({
        x: pt.x + (hash1(idx * 1.7) - 0.5) * 14,
        y: pt.y + (hash1(idx * 2.9) - 0.5) * 14,
        w: 44 + hash1(idx * 3.3) * 14,
        h: 32 + hash1(idx * 4.7) * 10,
        rot: tangent + (hash1(idx * 6.1) - 0.5) * 0.24,
        seed: idx++,
      })
    }
  }
  return stones
})()

// =============================================================================
// 18 WILDERNESS WATER & MAGMA POOLS + 10 MYSTERIOUS UNRECOGNIZED TASK STATUES
// =============================================================================
export const WILDERNESS_POOLS: WildernessPool[] = [
  // West Heartland & Kyoto Forest Ponds
  { id: 'wp-1', x: -5350, y: -650, rx: 145, ry: 110, seedA: 21, seedB: 37, kind: 'koi-pond' },
  { id: 'wp-2', x: -5150, y: 2150, rx: 165, ry: 120, seedA: 43, seedB: 59, kind: 'koi-pond' },
  { id: 'wp-3', x: -3450, y: 2750, rx: 135, ry: 105, seedA: 67, seedB: 79, kind: 'oasis' },
  { id: 'wp-4', x: -4950, y: -2550, rx: 155, ry: 118, seedA: 83, seedB: 97, kind: 'glacial-lake' },
  // South Sunstone Desert Oases
  { id: 'wp-5', x: -2150, y: 3750, rx: 150, ry: 112, seedA: 103, seedB: 113, kind: 'oasis' },
  { id: 'wp-6', x: 150, y: 3950, rx: 170, ry: 124, seedA: 127, seedB: 139, kind: 'oasis' },
  { id: 'wp-7', x: -1650, y: 950, rx: 130, ry: 102, seedA: 149, seedB: 163, kind: 'koi-pond' },
  // Central & Southeast Jade Jungle Lagoons
  { id: 'wp-8', x: 650, y: 950, rx: 160, ry: 122, seedA: 173, seedB: 181, kind: 'emerald-lagoon' },
  { id: 'wp-9', x: 1850, y: 3650, rx: 185, ry: 132, seedA: 191, seedB: 199, kind: 'emerald-lagoon' },
  { id: 'wp-10', x: 4150, y: 2950, rx: 175, ry: 128, seedA: 211, seedB: 223, kind: 'emerald-lagoon' },
  { id: 'wp-11', x: 5250, y: 1250, rx: 155, ry: 118, seedA: 229, seedB: 241, kind: 'emerald-lagoon' },
  // North Frostpeak Glacial Tarns
  { id: 'wp-12', x: -3550, y: -3450, rx: 175, ry: 125, seedA: 251, seedB: 263, kind: 'glacial-lake' },
  { id: 'wp-13', x: -1550, y: -1550, rx: 140, ry: 108, seedA: 271, seedB: 283, kind: 'glacial-lake' },
  { id: 'wp-14', x: 1150, y: -3950, rx: 180, ry: 126, seedA: 293, seedB: 307, kind: 'glacial-lake' },
  { id: 'wp-15', x: 1150, y: -1250, rx: 145, ry: 112, seedA: 313, seedB: 331, kind: 'koi-pond' },
  // Northeast Caldera Magma & Hot-Spring Pools
  { id: 'wp-16', x: 2950, y: -1850, rx: 150, ry: 115, seedA: 347, seedB: 359, kind: 'magma' },
  { id: 'wp-17', x: 5550, y: -3750, rx: 175, ry: 128, seedA: 367, seedB: 379, kind: 'magma' },
  { id: 'wp-18', x: 5450, y: -450, rx: 160, ry: 118, seedA: 389, seedB: 401, kind: 'magma' },
]

export function getWildernessPoolBoundary(
  pool: WildernessPool,
  angle: number
): { x: number; y: number; rx: number; ry: number } {
  const norm = (((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
  const seg = norm * 36
  const rx = pool.rx + Math.sin(angle * 3 + pool.seedA * 0.07) * 14 + handDrift(seg * 14, pool.seedA, 4)
  const ry = pool.ry + Math.cos(angle * 2 + pool.seedB * 0.07) * 16 + handDrift(seg * 14, pool.seedB, 4)
  return {
    x: pool.x + Math.cos(angle) * rx,
    y: pool.y + Math.sin(angle) * ry,
    rx,
    ry,
  }
}

export const MYSTERIOUS_STATUES: MysteriousStatue[] = [
  {
    id: 'statue-1',
    trueName: 'Weathered Jizo of the Bamboo Mist',
    taskPrompt: 'Shatter 3 Cursed Ink Effigies around the glade',
    x: -4850,
    y: -150,
    tier: 1,
    rewardGold: 65,
    style: 'monk',
    accent: '#b84239',
  },
  {
    id: 'statue-2',
    trueName: 'Moss-Bound Kitsune Watcher',
    taskPrompt: 'Cleanse 3 Fox-Fire Seals before incense fades',
    x: -3050,
    y: -350,
    tier: 1,
    rewardGold: 75,
    style: 'kitsune',
    accent: '#b84239',
  },
  {
    id: 'statue-3',
    trueName: 'Faceless Sunstone Obelisk',
    taskPrompt: 'Break 3 Mirage Totems in the canyon sands',
    x: -2450,
    y: 2950,
    tier: 2,
    rewardGold: 90,
    style: 'obelisk',
    accent: '#c68a32',
  },
  {
    id: 'statue-4',
    trueName: 'Buried Pharaoh-Kami Idol',
    taskPrompt: 'Destroy 3 Scorched Vessels guarding the oasis',
    x: -250,
    y: 3550,
    tier: 2,
    rewardGold: 95,
    style: 'guardian',
    accent: '#c68a32',
  },
  {
    id: 'statue-5',
    trueName: 'Vine-Wrapped Naga Sentinel',
    taskPrompt: 'Sever 3 Cursed Spore Pillars in the basin',
    x: 1350,
    y: 3150,
    tier: 3,
    rewardGold: 110,
    style: 'guardian',
    accent: '#3f7a56',
  },
  {
    id: 'statue-6',
    trueName: 'Ancient Monsoon Stone Sage',
    taskPrompt: 'Purify 3 Jade Spirit Stakes in the canopy clearing',
    x: 3550,
    y: 2150,
    tier: 3,
    rewardGold: 115,
    style: 'monk',
    accent: '#3f7a56',
  },
  {
    id: 'statue-7',
    trueName: 'Rime-Crowned Glacier Ronin',
    taskPrompt: 'Shatter 3 Frozen Wraith Totems on the ridge',
    x: -1950,
    y: -3350,
    tier: 4,
    rewardGold: 130,
    style: 'guardian',
    accent: '#4a7a96',
  },
  {
    id: 'statue-8',
    trueName: 'Silent Snow-Fox Monolith',
    taskPrompt: 'Break 3 Hoarfrost Seals by the glacial tarn',
    x: 750,
    y: -3550,
    tier: 4,
    rewardGold: 135,
    style: 'kitsune',
    accent: '#4a7a96',
  },
  {
    id: 'statue-9',
    trueName: 'Ashen Horned Oni Altar',
    taskPrompt: 'Crush 3 Brimstone Effigies in the ash waste',
    x: 3150,
    y: -1250,
    tier: 5,
    rewardGold: 155,
    style: 'oni',
    accent: '#c94c2c',
  },
  {
    id: 'statue-10',
    trueName: 'Obsidian Flame Sovereign',
    taskPrompt: 'Destroy 3 Molten Seal Pillars at the caldera rim',
    x: 5550,
    y: -1250,
    tier: 5,
    rewardGold: 175,
    style: 'oni',
    accent: '#c94c2c',
  },
]

// =============================================================================
// FULL-WORLD DENSE FOREST GENERATOR (~1,700+ REAL TREES) + O(1) SPATIAL GRID
// =============================================================================
function buildRoadSpatialSet(cell = 130): Set<string> {
  const occupied = new Set<string>()
  const mark = (wx: number, wy: number) => {
    const cx = Math.floor(wx / cell)
    const cy = Math.floor(wy / cell)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        occupied.add(`${cx + dx},${cy + dy}`)
      }
    }
  }
  for (const st of CONNECTOR_STONES) {
    mark(st.x, st.y)
  }
  for (const route of EXPEDITION_ROUTES) {
    for (let i = 0; i <= 80; i++) {
      const pt = sampleRouteBezier(route, i / 80)
      mark(pt.x, pt.y)
    }
  }
  return occupied
}

const WILDERNESS_DATA: { trees: TreeCanopy[]; rocks: WorldRock[] } = (() => {
  const trees: TreeCanopy[] = []
  const rocks: WorldRock[] = []
  const roadCells = buildRoadSpatialSet(118)
  let seed = 4100

  const isClearForTree = (x: number, y: number): boolean => {
    if (isInsideAnyContinentPlaza(x, y, 700)) return false
    if (roadCells.has(`${Math.floor(x / 118)},${Math.floor(y / 118)}`)) return false
    for (const ws of WAYSTATIONS) {
      if (Math.abs(x - ws.x) < 210 && Math.abs(y - ws.y) < 210) return false
    }
    for (const st of MYSTERIOUS_STATUES) {
      if (Math.hypot(x - st.x, y - st.y) < 205) return false
    }
    for (const wp of WILDERNESS_POOLS) {
      const dx = (x - wp.x) / (wp.rx + 78)
      const dy = (y - wp.y) / (wp.ry + 78)
      if (dx * dx + dy * dy < 1.0) return false
    }
    return true
  }

  // Jittered 245px grid across the entire 12,800 x 9,600 world -> lush edge-to-edge forests!
  const step = 245
  for (let gx = -WORLD_LIMIT_X + 180; gx <= WORLD_LIMIT_X - 180; gx += step) {
    for (let gy = -WORLD_LIMIT_Y + 180; gy <= WORLD_LIMIT_Y - 180; gy += step) {
      seed++
      const nearest = getNearestContinent(gx, gy)
      // Natural glade breathing room (86% forest coverage in woods/jungles, 74% in desert/ash)
      const density =
        nearest.id === 'desert' ? 0.74 : nearest.id === 'volcano' ? 0.8 : 0.88
      if (hash1(seed * 1.37) > density) continue

      const wx = Math.round(gx + (hash1(seed * 2.31) - 0.5) * 150)
      const wy = Math.round(gy + (hash1(seed * 3.73) - 0.5) * 150)
      if (!isClearForTree(wx, wy)) continue

      const pick = hash1(seed * 5.17)
      const kind: TreeKind =
        nearest.id === 'desert'
          ? pick > 0.46
            ? 'cactus'
            : 'palm'
          : nearest.id === 'frost'
            ? pick > 0.14
              ? 'snow-pine'
              : 'pine'
            : nearest.id === 'jungle'
              ? pick > 0.42
                ? 'jungle'
                : pick > 0.18
                  ? 'palm'
                  : 'bamboo'
              : nearest.id === 'volcano'
                ? 'charred'
                : pick > 0.52
                  ? 'pine'
                  : pick > 0.24
                    ? 'maple'
                    : 'bamboo'

      trees.push({
        x: wx,
        y: wy,
        r: 54 + Math.round(hash1(seed * 6.41) * 18),
        kind,
        seed: seed++,
      })

      // Occasional biome boulders tucked naturally among the forest trees
      if (hash1(seed * 8.13) > 0.88) {
        const rx = wx + (hash1(seed * 1.9) > 0.5 ? 74 : -74)
        const ry = wy + 44
        if (isClearForTree(rx, ry)) {
          const rkKind: RockKind =
            nearest.id === 'desert'
              ? 'sandstone'
              : nearest.id === 'frost'
                ? 'ice'
                : nearest.id === 'jungle'
                  ? 'moss'
                  : nearest.id === 'volcano'
                    ? 'basalt'
                    : 'zen'
          rocks.push({
            x: rx,
            y: ry,
            r: 16 + Math.round(hash1(seed * 3.3) * 9),
            seed: seed++,
            kind: rkKind,
          })
        }
      }
    }
  }
  return { trees, rocks }
})()

export const WILDERNESS_TREES: TreeCanopy[] = WILDERNESS_DATA.trees
export const WILDERNESS_ROCKS: WorldRock[] = WILDERNESS_DATA.rocks

export const ALL_WORLD_TREES: TreeCanopy[] = [
  ...CONTINENTS.flatMap((c) => c.trees),
  ...WILDERNESS_TREES,
]

// Fast 256px 2D Spatial Hash Grid for O(1) tree collision & viewport rendering!
const TREE_GRID_CELL = 256
const TREE_SPATIAL_MAP = (() => {
  const map = new Map<string, TreeCanopy[]>()
  for (const tr of ALL_WORLD_TREES) {
    const key = `${Math.floor(tr.x / TREE_GRID_CELL)},${Math.floor(tr.y / TREE_GRID_CELL)}`
    const bucket = map.get(key)
    if (bucket) bucket.push(tr)
    else map.set(key, [tr])
  }
  return map
})()

export function queryTreesInRect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): TreeCanopy[] {
  const cMinX = Math.floor(minX / TREE_GRID_CELL)
  const cMaxX = Math.floor(maxX / TREE_GRID_CELL)
  const cMinY = Math.floor(minY / TREE_GRID_CELL)
  const cMaxY = Math.floor(maxY / TREE_GRID_CELL)
  const out: TreeCanopy[] = []
  for (let cx = cMinX; cx <= cMaxX; cx++) {
    for (let cy = cMinY; cy <= cMaxY; cy++) {
      const bucket = TREE_SPATIAL_MAP.get(`${cx},${cy}`)
      if (!bucket) continue
      for (const tr of bucket) {
        if (tr.x >= minX && tr.x <= maxX && tr.y >= minY && tr.y <= maxY) {
          out.push(tr)
        }
      }
    }
  }
  return out
}

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
