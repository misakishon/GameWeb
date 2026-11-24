// =============================================================================
// 1:1 PURE-CODE MONOCHROME DOUGA SAMURAI RIG (ZERO GLITCH, NATIVE 60/120+ FPS)
// Faithfully recreates the original wandering Ronin character design in pure
// scalable vector code with:
//   - Pinched-peak wide conical kasa hat + shadowed minimalist profile face
//   - Short neat nape hair + tall Mandarin stand collar + shoulder-draped cloak
//   - Dual katanas: vertical back katana (rising under hat brim) + angled waist katana
//   - Flared short kimono sleeves, slender forearms, expressive anime hands
//   - Blouson hakama trousers tucked into tall wrapped kyahan + thin flat waraji sandals
//   - Soft-clamped C-infinity 2-bone IK + continuous exponential pose blending
//   - 120Hz fixed-timestep Verlet cloak simulation (zero jitter, zero ghosting!)
// =============================================================================

export type SamuraiAnimMode = 'Idle' | 'Walk' | 'Run' | 'Jump' | 'Fall' | 'Slash'

export interface Vec2 {
  x: number
  y: number
}

export interface ClothNode {
  x: number
  y: number
  ox: number
  oy: number
}

export interface SamuraiPalette {
  ink: string
  inkMid: string
  inkSoft: string
  fillMain: string
  fillBack: string
  fillShade: string
  hatFill: string
  hatUnder: string
  hairFill: string
  browShadow: string
  bladeLight: string
  bladeEdge: string
  blueGuide: string
  groundShadow: string
}

export interface SamuraiGear {
  crimsonScarf?: boolean
  shadowCloak?: boolean
  galeHat?: boolean
  moonlightBlade?: boolean
  warBow?: boolean
}

export interface SamuraiDrawOptions {
  paperTone: 'white' | 'studio' | 'transparent'
  showHat: boolean
  showCloak: boolean
  showBlueLines: boolean
  showRig: boolean
  scale?: number
  gear?: SamuraiGear
  activeWeapon?: 'sword' | 'bow'
  hasArrows?: boolean
  bowRecoil?: number
}

export interface SamuraiStepInput {
  x: number
  y: number
  vx: number
  vy: number
  facing: 1 | -1
  grounded: boolean
  mode: SamuraiAnimMode
  forced: boolean
  slashTimer: number
  slashDuration: number
  slashVariant: number
  landImpulse: number
  jumpImpulse: number
  groundY: number
  dt: number
}

export interface SamuraiStepEvents {
  footstep: 'none' | 'walk' | 'run'
  stepSide: number
}

export interface SamuraiRigState {
  leanAngle: number
  hipDrop: number
  headTilt: number
  hatTilt: number
  hatVel: number
  stridePhase: number
  breathPhase: number
  sprintBlend: number
  capeFlowBlend: number
  katanaDraw: number
  katanaAngle: number
  squashX: number
  squashY: number
  squashVel: number
  prevFacing: 1 | -1
  turnStretch: number
  lastStepHalf: number
  elapsed: number
  clothAccum: number
  // Blended IK targets (local space: +x = forward, 0 = ground, -y = up)
  frontFoot: Vec2
  backFoot: Vec2
  frontFootAng: number
  backFootAng: number
  nearHand: Vec2
  farHand: Vec2
  // Solved local joints
  hip: Vec2
  chest: Vec2
  neck: Vec2
  shoulderNear: Vec2
  shoulderFar: Vec2
  hipNear: Vec2
  hipFar: Vec2
  kneeFront: Vec2
  ankleFront: Vec2
  kneeBack: Vec2
  ankleBack: Vec2
  elbowNear: Vec2
  handNear: Vec2
  elbowFar: Vec2
  handFar: Vec2
  // World-space cloak chains (outer flowing edge + inner hanging edge)
  cloakOuter: ClothNode[]
  cloakInner: ClothNode[]
  // World tracking
  worldX: number
  worldY: number
  facing: 1 | -1
  mode: SamuraiAnimMode
  slashProg: number
  slashVariant: number
  grounded: boolean
}

const FIXED_CLOTH_DT = 1 / 120

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function damp(cur: number, target: number, lambda: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt))
}

function dampAngle(cur: number, target: number, lambda: number, dt: number): number {
  let diff = ((target - cur + Math.PI) % (Math.PI * 2)) - Math.PI
  if (diff < -Math.PI) diff += Math.PI * 2
  return cur + diff * (1 - Math.exp(-lambda * dt))
}

// Periodic Catmull-Rom cubic spline (C1-smooth continuous interpolation across looping keyframes!)
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

interface RunKeyframe {
  fx: number
  fy: number
  fa: number
  bx: number
  by: number
  ba: number
  drop: number
  lean: number
  nhx: number
  nhy: number
  fhx: number
  fhy: number
}

// 8-keyframe periodic full run cycle faithfully matching run/frame_00..07:
// Wide heel-strike reach -> Plant + high rear heel kick -> Passing dip -> High-knee drive & push-off (mirrored cleanly for both legs!)
const RUN_KEYS: RunKeyframe[] = [
  // 0: Wide Stride Contact (frame_00 / frame_07)
  { fx: 30, fy: -5.5, fa: -0.36, bx: -32, by: -13.0, ba: 0.95, drop: 4.5, lean: 0.08, nhx: -1.0, nhy: -71.0, fhx: 26.0, fhy: -88.0 },
  // 1: Down + High Rear Heel Kick (frame_01)
  { fx: 10, fy: -4.8, fa: 0.0, bx: -34, by: -24.0, ba: 1.22, drop: 8.5, lean: 0.12, nhx: 0.0, nhy: -69.0, fhx: 20.0, fhy: -81.0 },
  // 2: Passing Compression Load (frame_02)
  { fx: -2, fy: -4.8, fa: 0.04, bx: -12, by: -17.0, ba: 0.88, drop: 10.0, lean: 0.14, nhx: 5.0, nhy: -70.0, fhx: 15.0, fhy: -75.0 },
  // 3: High-Knee Drive & Push-Off (frame_03 / frame_04)
  { fx: -16, fy: -5.2, fa: 0.35, bx: 15, by: -26.0, ba: -0.70, drop: 1.8, lean: 0.07, nhx: 4.0, nhy: -74.0, fhx: 24.0, fhy: -90.0 },
  // 4: Opposite Stride Contact (frame_06 / frame_07)
  { fx: -32, fy: -13.0, fa: 0.95, bx: 30, by: -5.5, ba: -0.36, drop: 4.5, lean: 0.08, nhx: -1.0, nhy: -71.0, fhx: 26.0, fhy: -88.0 },
  // 5: Opposite Down + High Rear Heel Kick (frame_01)
  { fx: -34, fy: -24.0, fa: 1.22, bx: 10, by: -4.8, ba: 0.0, drop: 8.5, lean: 0.12, nhx: 0.0, nhy: -69.0, fhx: 20.0, fhy: -81.0 },
  // 6: Opposite Passing Compression Load (frame_02)
  { fx: -12, fy: -17.0, fa: 0.88, bx: -2, by: -4.8, ba: 0.04, drop: 10.0, lean: 0.14, nhx: 5.0, nhy: -70.0, fhx: 15.0, fhy: -75.0 },
  // 7: Opposite High-Knee Drive & Push-Off (frame_03 / frame_04)
  { fx: 15, fy: -26.0, fa: -0.70, bx: -16, by: -5.2, ba: 0.35, drop: 1.8, lean: 0.07, nhx: 4.0, nhy: -74.0, fhx: 24.0, fhy: -90.0 },
]

function sampleRunCycle(phaseRad: number): RunKeyframe {
  const n = RUN_KEYS.length
  const norm = (((phaseRad / (Math.PI * 2)) % 1) + 1) % 1
  const f = norm * n
  const i1 = Math.floor(f) % n
  const t = f - Math.floor(f)
  const k0 = RUN_KEYS[(i1 - 1 + n) % n]
  const k1 = RUN_KEYS[i1]
  const k2 = RUN_KEYS[(i1 + 1) % n]
  const k3 = RUN_KEYS[(i1 + 2) % n]
  return {
    fx: catmullRom(k0.fx, k1.fx, k2.fx, k3.fx, t),
    fy: catmullRom(k0.fy, k1.fy, k2.fy, k3.fy, t),
    fa: catmullRom(k0.fa, k1.fa, k2.fa, k3.fa, t),
    bx: catmullRom(k0.bx, k1.bx, k2.bx, k3.bx, t),
    by: catmullRom(k0.by, k1.by, k2.by, k3.by, t),
    ba: catmullRom(k0.ba, k1.ba, k2.ba, k3.ba, t),
    drop: catmullRom(k0.drop, k1.drop, k2.drop, k3.drop, t),
    lean: catmullRom(k0.lean, k1.lean, k2.lean, k3.lean, t),
    nhx: catmullRom(k0.nhx, k1.nhx, k2.nhx, k3.nhx, t),
    nhy: catmullRom(k0.nhy, k1.nhy, k2.nhy, k3.nhy, t),
    fhx: catmullRom(k0.fhx, k1.fhx, k2.fhx, k3.fhx, t),
    fhy: catmullRom(k0.fhy, k1.fhy, k2.fhy, k3.fhy, t),
  }
}

function createClothChain(count: number, startX: number, startY: number, dx: number, dy: number): ClothNode[] {
  const nodes: ClothNode[] = []
  for (let i = 0; i < count; i++) {
    const px = startX + i * dx
    const py = startY + i * dy
    nodes.push({ x: px, y: py, ox: px, oy: py })
  }
  return nodes
}

// Soft-clamped analytic 2-bone IK (C-infinity smooth near full extension — zero knee snap!)
function solveSoftTwoBoneIK(
  root: Vec2,
  target: Vec2,
  len1: number,
  len2: number,
  bendSign: number
): { mid: Vec2; end: Vec2 } {
  const dx = target.x - root.x
  const dy = target.y - root.y
  const rawDist = Math.hypot(dx, dy) || 0.0001

  const totalLen = len1 + len2
  const minReach = Math.abs(len1 - len2) + 2.5
  const softStart = totalLen * 0.90
  const hardMax = totalLen * 0.996

  let d = rawDist
  if (d > softStart) {
    const span = hardMax - softStart
    d = softStart + span * Math.tanh((d - softStart) / span)
  }
  d = Math.max(minReach, Math.min(hardMax, d))

  const baseAngle = Math.atan2(dy, dx)
  const cosA = clamp((len1 * len1 + d * d - len2 * len2) / (2 * len1 * d), -1, 1)
  const angleA = Math.acos(cosA)
  const jointAngle = baseAngle + bendSign * angleA

  const mid: Vec2 = {
    x: root.x + Math.cos(jointAngle) * len1,
    y: root.y + Math.sin(jointAngle) * len1,
  }

  const endScale = d / rawDist
  const end: Vec2 = {
    x: root.x + dx * endScale,
    y: root.y + dy * endScale,
  }

  return { mid, end }
}

function stepClothFixed(
  nodes: ClothNode[],
  anchor: Vec2,
  segLen: number,
  windX: number,
  windY: number,
  gravity: number,
  turbAmp: number,
  time: number,
  phaseShift: number,
  floorY: number,
  damping = 0.96,
  stiffnessPasses = 7
) {
  const dt2 = FIXED_CLOTH_DT * FIXED_CLOTH_DT
  const maxStep = segLen * 0.65

  nodes[0].x = anchor.x
  nodes[0].y = anchor.y
  nodes[0].ox = anchor.x
  nodes[0].oy = anchor.y

  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i]
    let vx = (n.x - n.ox) * damping
    let vy = (n.y - n.oy) * damping
    const spd = Math.hypot(vx, vy)
    if (spd > maxStep) {
      const s = maxStep / spd
      vx *= s
      vy *= s
    }
    n.ox = n.x
    n.oy = n.y

    const frac = i / (nodes.length - 1)
    const waveA = Math.sin(time * 7.8 - i * 0.72 + phaseShift)
    const waveB = Math.cos(time * 4.6 - i * 0.44 + phaseShift * 1.3)
    const ax = windX * (0.38 + 0.92 * frac) + waveB * turbAmp * 0.28 * frac
    const ay = gravity + windY * (0.3 + 0.7 * frac) + waveA * turbAmp * frac

    n.x += vx + ax * dt2
    n.y += vy + ay * dt2
    if (n.y > floorY) n.y = floorY
  }

  for (let pass = 0; pass < stiffnessPasses; pass++) {
    nodes[0].x = anchor.x
    nodes[0].y = anchor.y
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i]
      const b = nodes[i + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 0.0001
      const diff = (dist - segLen) / dist
      if (i === 0) {
        b.x -= dx * diff
        b.y -= dy * diff
      } else {
        a.x += dx * diff * 0.30
        a.y += dy * diff * 0.30
        b.x -= dx * diff * 0.70
        b.y -= dy * diff * 0.70
      }
      if (b.y > floorY) b.y = floorY
    }
  }
}

// Warm cream & graphite monochrome palette matching the original sprites 1:1
export function getSamuraiPalette(paperTone: 'white' | 'studio' | 'transparent'): SamuraiPalette {
  if (paperTone === 'studio') {
    return {
      ink: '#3a3a3c',
      inkMid: '#555558',
      inkSoft: 'rgba(58, 58, 60, 0.42)',
      fillMain: '#c4c5c0',
      fillBack: '#b7b9b3',
      fillShade: '#a8aaa4',
      hatFill: '#c7c6be',
      hatUnder: '#90918c',
      hairFill: '#8d8e8a',
      browShadow: 'rgba(52, 52, 58, 0.24)',
      bladeLight: '#f3f5f8',
      bladeEdge: '#cfd4dc',
      blueGuide: 'rgba(104, 114, 184, 0.50)',
      groundShadow: 'rgba(28, 28, 32, 0.14)',
    }
  }
  return {
    ink: '#54534f',
    inkMid: '#72706b',
    inkSoft: 'rgba(84, 83, 79, 0.40)',
    fillMain: '#f6f3ea',
    fillBack: '#efebe0',
    fillShade: '#e5e0d3',
    hatFill: '#f4f0e4',
    hatUnder: '#cbc6b8',
    hairFill: '#c8c4b8',
    browShadow: 'rgba(82, 82, 92, 0.20)',
    bladeLight: '#ffffff',
    bladeEdge: '#d8dce4',
    blueGuide: 'rgba(116, 122, 178, 0.45)',
    groundShadow: 'rgba(60, 58, 52, 0.09)',
  }
}

export function createSamuraiRig(startX = 0, startY = 0, facing: 1 | -1 = -1): SamuraiRigState {
  const dir = -facing
  return {
    leanAngle: 0.01,
    hipDrop: 0.3,
    headTilt: 0.0,
    hatTilt: 0.0,
    hatVel: 0,
    stridePhase: 0,
    breathPhase: 0,
    sprintBlend: 0,
    capeFlowBlend: 0,
    katanaDraw: 0,
    katanaAngle: 0.44,
    squashX: 1,
    squashY: 1,
    squashVel: 0,
    prevFacing: facing,
    turnStretch: 1,
    lastStepHalf: -1,
    elapsed: 0,
    clothAccum: 0,
    // Tall calm Idle stance matching transition/frame_03.png
    frontFoot: { x: 8.5, y: -4.8 },
    backFoot: { x: -7.0, y: -4.8 },
    frontFootAng: 0,
    backFootAng: 0,
    // Near arm hangs relaxed straight down alongside the thigh in Idle!
    nearHand: { x: 6.5, y: -61.5 },
    farHand: { x: 2.0, y: -65.0 },
    hip: { x: 0, y: -73 },
    chest: { x: 0, y: -109 },
    neck: { x: 0, y: -115 },
    shoulderNear: { x: -1.5, y: -104 },
    shoulderFar: { x: 3.5, y: -104 },
    hipNear: { x: -3.0, y: -73 },
    hipFar: { x: 4.5, y: -73 },
    kneeFront: { x: 2.5, y: -39 },
    ankleFront: { x: 8.5, y: -4.8 },
    kneeBack: { x: -3.5, y: -39 },
    ankleBack: { x: -7.0, y: -4.8 },
    elbowNear: { x: -1.5, y: -82 },
    handNear: { x: 6.5, y: -61.5 },
    elbowFar: { x: 2.0, y: -83 },
    handFar: { x: 2.0, y: -65.0 },
    cloakOuter: createClothChain(8, startX + dir * 4, startY - 107, dir * 3.8, 12.6),
    cloakInner: createClothChain(6, startX + dir * 3, startY - 82, dir * 2.1, 11.4),
    worldX: startX,
    worldY: startY,
    facing,
    mode: 'Idle',
    slashProg: 0,
    slashVariant: 0,
    grounded: true,
  }
}

export function resetSamuraiCloth(rig: SamuraiRigState, x: number, y: number, facing: 1 | -1) {
  const dir = -facing
  rig.worldX = x
  rig.worldY = y
  rig.facing = facing
  rig.prevFacing = facing
  rig.cloakOuter = createClothChain(8, x + dir * 4, y - 107, dir * 3.8, 12.6)
  rig.cloakInner = createClothChain(6, x + dir * 3, y - 82, dir * 2.1, 11.4)
}

export function stepSamuraiRig(rig: SamuraiRigState, input: SamuraiStepInput): SamuraiStepEvents {
  const dt = clamp(input.dt, 0.0005, 0.05)
  rig.elapsed += dt
  rig.worldX = input.x
  rig.worldY = input.y
  rig.facing = input.facing
  rig.mode = input.mode
  rig.grounded = input.grounded
  rig.slashVariant = input.slashVariant

  const events: SamuraiStepEvents = { footstep: 'none', stepSide: 1 }

  // 1. Facing turn impulse (smooth follow-through whip)
  if (input.facing !== rig.prevFacing) {
    rig.prevFacing = input.facing
    rig.turnStretch = 0.84
    for (let i = 1; i < rig.cloakOuter.length; i++) {
      rig.cloakOuter[i].ox += input.facing * 2.0
    }
  }
  rig.turnStretch = damp(rig.turnStretch, 1.0, 18, dt)

  // 2. Volume-preserving spring squash & stretch
  if (input.landImpulse > 0) rig.squashVel -= input.landImpulse * 3.0
  if (input.jumpImpulse > 0) rig.squashVel += input.jumpImpulse * 2.5
  const squashErr = 1.0 - rig.squashY
  rig.squashVel += (squashErr * 195 - rig.squashVel * 19) * dt
  rig.squashY = clamp(rig.squashY + rig.squashVel * dt, 0.87, 1.13)
  rig.squashX = (1 / Math.sqrt(rig.squashY)) * rig.turnStretch

  // 3. Breathing & stride phase progression
  rig.breathPhase += dt * ((Math.PI * 2) / 3.6)
  rig.sprintBlend = damp(rig.sprintBlend, input.mode === 'Run' ? 1 : 0, 9.0, dt)

  const targetCapeFlow =
    input.mode === 'Idle'
      ? 0.0
      : input.mode === 'Walk'
        ? 0.36
        : input.mode === 'Slash'
          ? 0.82
          : 1.0
  rig.capeFlowBlend = damp(rig.capeFlowBlend, targetCapeFlow, 7.0, dt)

  if (input.mode === 'Run') {
    const runRate = input.forced ? 8.6 : clamp(Math.abs(input.vx) / 50, 6.8, 10.2)
    rig.stridePhase += dt * runRate
  } else if (input.mode === 'Walk') {
    const walkRate = input.forced ? 5.2 : clamp(Math.abs(input.vx) / 31, 3.6, 6.2)
    rig.stridePhase += dt * walkRate
  } else if (input.mode === 'Idle') {
    const nearest = Math.round(rig.stridePhase / (Math.PI * 2)) * Math.PI * 2
    rig.stridePhase = damp(rig.stridePhase, nearest, 5.2, dt)
  }

  if (input.mode === 'Run' || input.mode === 'Walk') {
    const halfIdx = Math.floor((rig.stridePhase + 0.35) / Math.PI)
    if (halfIdx !== rig.lastStepHalf) {
      rig.lastStepHalf = halfIdx
      events.footstep = input.mode === 'Run' ? 'run' : 'walk'
      events.stepSide = halfIdx % 2 === 0 ? 1 : -1
    }
  }

  // 4. Target pose evaluation (matched 1:1 to original Idle / Transition / Run frames!)
  const br = Math.sin(rig.breathPhase)
  const brLag = Math.sin(rig.breathPhase - 0.6)
  const p = rig.stridePhase

  // Tall, poised Idle matching transition/frame_03.png
  let targetLean = 0.008 + 0.004 * brLag
  let targetHipDrop = 0.3 + 0.55 * br
  let targetHeadTilt = 0.005 * brLag
  let targetHatLean = 0.006 * br

  let tFrontFoot: Vec2 = { x: 8.5, y: -4.8 }
  let tBackFoot: Vec2 = { x: -7.0, y: -4.8 }
  let tFrontFootAng = 0
  let tBackFootAng = 0

  // In Idle: near arm hangs calmly straight down beside the hip/thigh (fingers open & relaxed)
  let tNearHand: Vec2 = { x: 5.5 + br * 0.4, y: -61.5 + br * 0.5 }
  let tFarHand: Vec2 = { x: 0.5, y: -71.0 + br * 0.4 }
  let targetKatanaDraw = 0
  let targetKatanaAngle = 0.44

  const slashActive = input.mode === 'Slash' && input.slashTimer > 0
  const slashProg = slashActive ? clamp(1 - input.slashTimer / Math.max(0.01, input.slashDuration), 0, 1) : 0
  rig.slashProg = slashProg

  if (slashActive) {
    const v = ((input.slashVariant % 4) + 4) % 4
    const swingEase =
      slashProg < 0.16
        ? 0
        : slashProg < 0.56
          ? 1 - Math.pow(1 - (slashProg - 0.16) / 0.40, 3)
          : 1.0

    targetHeadTilt = v === 2 ? lerp(-0.08, 0.06, swingEase) : 0.02
    targetHatLean = v === 2 ? lerp(-0.06, 0.08, swingEase) : 0.05

    tFrontFoot = { x: v === 3 ? lerp(18, 32, swingEase) : 26, y: -4.8 }
    tBackFoot = { x: v === 3 ? lerp(-18, -28, swingEase) : -24, y: -4.8 }
    tFrontFootAng = -0.03
    tBackFootAng = 0.16

    targetKatanaDraw = slashProg < 0.88 ? 1 : lerp(1, 0, (slashProg - 0.88) / 0.12)

    const shX = Math.sin(targetLean) * 36
    const shY = -73 + targetHipDrop - Math.cos(targetLean) * 36 + 5

    if (v === 0) {
      // Strike 1: Wide Forehand Cross-Cut (upper-right -> lower-left)
      targetLean = lerp(0.06, 0.28, swingEase)
      targetHipDrop = lerp(5.0, 11.5, swingEase)
      const swingAng = lerp(-1.15, 0.88, swingEase)
      targetKatanaAngle = swingAng
      tNearHand = { x: shX + Math.cos(swingAng) * 35, y: shY + Math.sin(swingAng) * 35 }
      tFarHand = { x: -12, y: -70 + targetHipDrop * 0.5 }
    } else if (v === 1) {
      // Strike 2: Rising Backhand Uppercut (low -> high)
      targetLean = lerp(0.20, 0.04, swingEase)
      targetHipDrop = lerp(11.0, 4.0, swingEase)
      const swingAng = lerp(1.05, -1.18, swingEase)
      targetKatanaAngle = swingAng
      tNearHand = { x: shX + Math.cos(swingAng) * 35, y: shY + Math.sin(swingAng) * 35 }
      tFarHand = { x: -10, y: -68 + targetHipDrop * 0.5 }
    } else if (v === 2) {
      // Strike 3: High Two-Handed Overhead Vertical Helm-Splitter (above hat -> ground!)
      targetLean = lerp(-0.08, 0.34, swingEase)
      targetHipDrop = lerp(2.0, 14.0, swingEase)
      const swingAng = lerp(-1.85, 0.72, swingEase)
      targetKatanaAngle = swingAng
      const hx = shX + Math.cos(swingAng) * 38
      const hy = shY + Math.sin(swingAng) * 38 - lerp(12, 0, swingEase)
      tNearHand = { x: hx, y: hy }
      tFarHand = { x: hx - 5, y: hy + 3 }
    } else {
      // Strike 4: Two-Handed Lightning Piercing Forward Thrust (hip pull -> straight lance!)
      targetLean = lerp(0.05, 0.36, swingEase)
      targetHipDrop = lerp(7.0, 12.5, swingEase)
      targetKatanaAngle = 0.02
      const thrustX = lerp(-10, 42, swingEase)
      tNearHand = { x: shX + thrustX, y: shY + 8 }
      tFarHand = { x: shX + thrustX - 7, y: shY + 9 }
    }
  } else if (input.mode === 'Run') {
    // Exact 8-keyframe periodic Catmull-Rom spline matching run/frame_00..07 at native 60/120+ FPS!
    const rk = sampleRunCycle(p)
    targetLean = rk.lean
    targetHipDrop = rk.drop
    targetHeadTilt = 0.008 + (rk.lean - 0.09) * 0.12
    targetHatLean = 0.015 + (rk.lean - 0.09) * 0.25

    tFrontFoot = { x: rk.fx, y: rk.fy }
    tFrontFootAng = rk.fa
    tBackFoot = { x: rk.bx, y: rk.by }
    tBackFootAng = rk.ba

    tNearHand = { x: rk.nhx, y: rk.nhy }
    tFarHand = { x: rk.fhx, y: rk.fhy }
    targetKatanaAngle = 0.44 + (rk.drop - 5.5) * 0.005
  } else if (input.mode === 'Walk') {
    // Calm transition/walk stride matching transition/frame_00.png!
    targetLean = 0.08 + 0.015 * Math.cos(2 * p)
    targetHipDrop = 3.2 + 2.0 * Math.sin(2 * p)
    targetHeadTilt = 0.01
    targetHatLean = 0.02 + 0.01 * Math.sin(2 * p)

    const evalWalkFoot = (ph: number): { pt: Vec2; ang: number } => {
      const c = Math.cos(ph)
      const s = Math.sin(ph)
      const x = c * 22
      const lift = Math.pow(Math.max(0, -s), 0.95) * 9.5
      const ang = -0.12 * Math.max(0, c) + 0.28 * Math.max(0, -c) + 0.10 * Math.max(0, -s)
      return { pt: { x, y: -4.8 - lift }, ang }
    }

    const wF = evalWalkFoot(p)
    const wB = evalWalkFoot(p + Math.PI)
    tFrontFoot = wF.pt
    tFrontFootAng = wF.ang
    tBackFoot = wB.pt
    tBackFootAng = wB.ang

    const sw = Math.cos(p)
    tNearHand = { x: 4.5 + sw * 3.5, y: -67.5 + targetHipDrop * 0.5 }
    tFarHand = { x: 10.5 - sw * 6.0, y: -69.5 + targetHipDrop * 0.4 }
    targetKatanaAngle = 0.44 + sw * 0.02
  } else if (input.mode === 'Jump' || input.mode === 'Fall') {
    const rise = clamp(-input.vy / 540, -1, 1)
    const u = (rise + 1) * 0.5
    targetLean = lerp(0.12, 0.22, u)
    targetHipDrop = lerp(4, 9.5, u)
    targetHeadTilt = lerp(0.03, -0.02, u)
    targetHatLean = lerp(-0.02, 0.05, u)

    tFrontFoot = { x: lerp(14, 22, u), y: -4.8 - lerp(8, 30, u) }
    tBackFoot = { x: lerp(-16, -26, u), y: -4.8 - lerp(12, 22, u) }
    tFrontFootAng = lerp(0.24, -0.22, u)
    tBackFootAng = lerp(0.62, 0.88, u)

    tNearHand = { x: 2, y: -74 - u * 4 }
    tFarHand = { x: lerp(18, 26, u), y: -86 - u * 4 }
    targetKatanaAngle = lerp(0.40, 0.48, u)
  }

  // 5. CONTINUOUS POSE-SPACE BLENDING (Snappy & crisp on Run keyframes while silky smooth on mode switches!)
  const poseSpeed = slashActive ? 28 : input.mode === 'Run' ? 24 : 12.0
  const footSpeed = slashActive ? 24 : input.mode === 'Run' ? 28 : 12.5

  rig.leanAngle = damp(rig.leanAngle, targetLean, poseSpeed, dt)
  rig.hipDrop = damp(rig.hipDrop, targetHipDrop, poseSpeed, dt)
  rig.headTilt = damp(rig.headTilt, targetHeadTilt, poseSpeed, dt)

  const hatForce = (targetHatLean - rig.hatTilt) * 115 - rig.hatVel * 14
  rig.hatVel += hatForce * dt
  rig.hatTilt = clamp(rig.hatTilt + rig.hatVel * dt, -0.10, 0.14)

  rig.frontFoot.x = damp(rig.frontFoot.x, tFrontFoot.x, footSpeed, dt)
  rig.frontFoot.y = damp(rig.frontFoot.y, tFrontFoot.y, footSpeed, dt)
  rig.backFoot.x = damp(rig.backFoot.x, tBackFoot.x, footSpeed, dt)
  rig.backFoot.y = damp(rig.backFoot.y, tBackFoot.y, footSpeed, dt)
  rig.frontFootAng = dampAngle(rig.frontFootAng, tFrontFootAng, footSpeed, dt)
  rig.backFootAng = dampAngle(rig.backFootAng, tBackFootAng, footSpeed, dt)

  rig.nearHand.x = damp(rig.nearHand.x, tNearHand.x, slashActive ? 36 : 14.5, dt)
  rig.nearHand.y = damp(rig.nearHand.y, tNearHand.y, slashActive ? 36 : 14.5, dt)
  rig.farHand.x = damp(rig.farHand.x, tFarHand.x, 14.5, dt)
  rig.farHand.y = damp(rig.farHand.y, tFarHand.y, 14.5, dt)

  rig.katanaDraw = damp(rig.katanaDraw, targetKatanaDraw, slashActive ? 40 : 16, dt)
  rig.katanaAngle = dampAngle(rig.katanaAngle, targetKatanaAngle, slashActive ? 38 : 14, dt)

  // 6. Solve Tall Slender Spine & Soft-Clamped 2-Bone IK
  const torsoLen = 36
  const neckLen = 5.8
  rig.hip = { x: 0, y: -73 + rig.hipDrop }
  rig.chest = {
    x: rig.hip.x + Math.sin(rig.leanAngle) * torsoLen,
    y: rig.hip.y - Math.cos(rig.leanAngle) * torsoLen - br * 0.55,
  }
  rig.neck = {
    x: rig.chest.x + Math.sin(rig.leanAngle) * neckLen,
    y: rig.chest.y - Math.cos(rig.leanAngle) * neckLen,
  }

  const idleWeight = 1 - rig.capeFlowBlend
  rig.hipNear = { x: rig.hip.x - 2.6 * idleWeight, y: rig.hip.y }
  rig.hipFar = { x: rig.hip.x + 4.2 * idleWeight, y: rig.hip.y }

  // Slender tall legs: 35 + 35 = 70 (idle hip-to-ankle ~68 -> tall straight stance matching frame_03!)
  const legF = solveSoftTwoBoneIK(rig.hipNear, rig.frontFoot, 35.0, 35.0, -1)
  const legB = solveSoftTwoBoneIK(rig.hipFar, rig.backFoot, 35.0, 35.0, -1)
  rig.kneeFront = legF.mid
  rig.ankleFront = legF.end
  rig.kneeBack = legB.mid
  rig.ankleBack = legB.end

  rig.shoulderNear = { x: rig.chest.x - 1.2, y: rig.chest.y + 4.5 }
  rig.shoulderFar = { x: rig.chest.x + 3.6, y: rig.chest.y + 4.8 }

  const armN = solveSoftTwoBoneIK(rig.shoulderNear, rig.nearHand, 21.5, 20.5, 1)
  const armF = solveSoftTwoBoneIK(rig.shoulderFar, rig.farHand, 21.0, 20.0, 1)
  rig.elbowNear = armN.mid
  rig.handNear = armN.end
  rig.elbowFar = armF.mid
  rig.handFar = armF.end

  // 7. 120Hz Fixed-Timestep World-Space Cloak Simulation
  const toWorld = (pt: Vec2): Vec2 => ({
    x: input.x + pt.x * input.facing * rig.squashX,
    y: input.y + pt.y * rig.squashY,
  })

  const cloakOuterAnchor = toWorld({ x: rig.chest.x - 2.5, y: rig.chest.y - 0.5 })
  const cloakInnerAnchor = toWorld({ x: rig.hip.x - 5.5, y: rig.hip.y - 10 })

  const f = input.facing
  // Idle: calm gentle breeze swaying the draped cloak (just like idle_strip.png!)
  // Run: clean ~38-deg sweeping diagonal sail right past the waist katana (matching run/frame_00..07!)
  const idleBreeze = -f * (120 + Math.sin(rig.elapsed * 1.55) * 95 + Math.cos(rig.elapsed * 0.72) * 45)
  const runWind = -f * (480 + Math.abs(input.vx) * 0.45)
  const effWindX = lerp(idleBreeze, runWind, rig.capeFlowBlend) - input.vx * 0.38
  const airWindY = clamp(-input.vy * 1.1, -650, 650)
  const floorLimit = input.groundY - 12

  rig.clothAccum = Math.min(rig.clothAccum + dt, FIXED_CLOTH_DT * 8)
  while (rig.clothAccum >= FIXED_CLOTH_DT) {
    rig.clothAccum -= FIXED_CLOTH_DT
    const t = rig.elapsed

    // Outer cloak edge: sweeping arched ~38-deg sail in Run, calm mid-calf drape in Idle!
    stepClothFixed(
      rig.cloakOuter,
      cloakOuterAnchor,
      13.6,
      effWindX * 1.10 - f * 75,
      lerp(-10, -25, rig.capeFlowBlend) + airWindY * 0.45,
      lerp(660, 560, rig.capeFlowBlend),
      lerp(75, 130, rig.capeFlowBlend),
      t,
      0.0,
      floorLimit,
      0.96,
      7
    )

    // Inner hanging edge: hangs lower behind hips so the cloak opens cleanly like a triangular sail!
    stepClothFixed(
      rig.cloakInner,
      cloakInnerAnchor,
      11.0,
      effWindX * 0.44,
      lerp(15, 20, rig.capeFlowBlend) + airWindY * 0.35,
      lerp(740, 660, rig.capeFlowBlend),
      lerp(50, 95, rig.capeFlowBlend),
      t,
      1.1,
      floorLimit,
      0.958,
      6
    )
  }

  return events
}

// =============================================================================
// MAIN RENDERER — 1:1 FAITHFUL MONOCHROME PENCIL-DOUGA SAMURAI
// =============================================================================
export function drawSamuraiRig(
  ctx: CanvasRenderingContext2D,
  rig: SamuraiRigState,
  opts: SamuraiDrawOptions
) {
  const pal = getSamuraiPalette(opts.paperTone)
  const scale = opts.scale ?? 1.0

  const strokeInk = (w = 1.02, color = pal.ink) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.lineWidth = w
    ctx.stroke()
  }

  const strokeSoft = (w = 0.72) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = pal.inkSoft
    ctx.lineWidth = w
    ctx.stroke()
  }

  const strokeGuide = (w = 0.72) => {
    if (!opts.showBlueLines) return
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = pal.blueGuide
    ctx.lineWidth = w
    ctx.stroke()
  }

  // --- 0. SUBTLE GROUND SHADOW ---
  if (rig.grounded) {
    ctx.save()
    ctx.translate(rig.worldX, rig.worldY)
    const spread = (21 + Math.abs(rig.ankleFront.x - rig.ankleBack.x) * 0.32) * scale
    ctx.fillStyle = pal.groundShadow
    ctx.beginPath()
    ctx.ellipse(0, 0.8 * scale, spread, 2.8 * scale, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // --- 1. WORLD-SPACE FLOWING MONOCHROME CLOAK (BEHIND BODY, IN FRONT OF NOTHING) ---
  if (opts.showCloak) {
    ctx.save()
    const sp = rig.cloakOuter
    const hm = rig.cloakInner
    if (sp.length >= 6 && hm.length >= 5) {
      const spTip = sp[sp.length - 1]
      const hmTip = hm[hm.length - 1]
      const flutter = Math.sin(rig.elapsed * 6.4) * (1.2 + rig.capeFlowBlend * 2.2) * scale

      // Smooth draped anime cloak silhouette with graceful curved hem & pointed outer tail
      ctx.beginPath()
      ctx.moveTo(sp[0].x, sp[0].y)
      for (let i = 1; i < sp.length - 1; i++) {
        ctx.quadraticCurveTo(sp[i].x, sp[i].y, (sp[i].x + sp[i + 1].x) * 0.5, (sp[i].y + sp[i + 1].y) * 0.5)
      }
      ctx.lineTo(spTip.x, spTip.y)

      // Smooth S-curved bottom hem (matching transition/frame_00 & run/frame_03!)
      const c1x = lerp(spTip.x, hmTip.x, 0.28) + rig.facing * (3 + rig.capeFlowBlend * 6) * scale
      const c1y = lerp(spTip.y, hmTip.y, 0.28) - (5 + rig.capeFlowBlend * 5 - flutter * 0.4) * scale
      const c2x = lerp(spTip.x, hmTip.x, 0.72) - rig.facing * 2 * scale
      const c2y = lerp(spTip.y, hmTip.y, 0.72) + (2 + flutter * 0.3) * scale
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, hmTip.x, hmTip.y)

      for (let i = hm.length - 2; i >= 1; i--) {
        ctx.quadraticCurveTo(hm[i].x, hm[i].y, (hm[i].x + hm[i - 1].x) * 0.5, (hm[i].y + hm[i - 1].y) * 0.5)
      }
      ctx.lineTo(hm[0].x, hm[0].y)
      ctx.closePath()

      ctx.fillStyle = opts.gear?.shadowCloak ? '#393b42' : pal.fillMain
      ctx.fill()
      strokeInk(1.04 * scale, opts.gear?.shadowCloak ? '#22242a' : pal.ink)

      // Clip interior drapery fold lines cleanly inside the cloak silhouette (never pokes outside!)
      ctx.save()
      ctx.clip()
      ctx.beginPath()
      ctx.moveTo(lerp(sp[1].x, hm[0].x, 0.18), lerp(sp[1].y, hm[0].y, 0.18))
      ctx.quadraticCurveTo(
        lerp(sp[4].x, hm[2].x, 0.36),
        lerp(sp[4].y, hm[2].y, 0.36),
        lerp(spTip.x, hmTip.x, 0.28),
        lerp(spTip.y, hmTip.y, 0.28)
      )
      strokeInk(0.76 * scale, pal.inkMid)

      ctx.beginPath()
      ctx.moveTo(lerp(sp[1].x, hm[0].x, 0.48), lerp(sp[1].y, hm[0].y, 0.48) + 4 * scale)
      ctx.quadraticCurveTo(
        lerp(sp[4].x, hm[3].x, 0.68),
        lerp(sp[4].y, hm[3].y, 0.68),
        lerp(spTip.x, hmTip.x, 0.72),
        lerp(spTip.y, hmTip.y, 0.72)
      )
      strokeSoft(0.68 * scale)

      if (opts.showBlueLines) {
        ctx.beginPath()
        ctx.moveTo(sp[1].x + rig.facing * 1.8, sp[1].y + 2)
        ctx.quadraticCurveTo(sp[4].x + rig.facing * 1.8, sp[4].y + 2, spTip.x + rig.facing * 1.5, spTip.y - 1.5)
        strokeGuide(0.66 * scale)
      }
      ctx.restore()
    }
    ctx.restore()
  }

  // --- 2. CHARACTER BODY IN CLEAN FACING-NORMALIZED LOCAL SPACE ---
  ctx.save()
  ctx.translate(rig.worldX, rig.worldY)
  ctx.scale(rig.facing * rig.squashX * scale, rig.squashY * scale)

  // --- ICONIC BACK KATANA (rising cleanly behind shoulder right up to hat brim!) ---
  const drawBackKatana = () => {
    ctx.save()
    ctx.translate(rig.chest.x - 10.2, rig.chest.y + 4.0)
    ctx.rotate(rig.leanAngle * 0.35 - 0.15)

    // Upper scabbard neck rising behind shoulder
    ctx.beginPath()
    ctx.roundRect(-2.1, -11.5, 4.2, 15, 1.0)
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(0.95)

    // Oval horizontal tsuba guard sitting clearly above shoulder
    ctx.beginPath()
    ctx.ellipse(0, -12.0, 5.2, 1.45, 0, 0, Math.PI * 2)
    ctx.fillStyle = pal.fillShade
    ctx.fill()
    strokeInk(0.95)

    // Tall diamond-wrapped tsuka hilt rising right up to kiss the kasa hat underside!
    ctx.beginPath()
    ctx.roundRect(-1.85, -26.8, 3.7, 14.5, 1.0)
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(0.95)

    // Crisp tsuka-ito diamond criss-cross wrap lines
    ctx.beginPath()
    for (let ty = -25.2; ty <= -13.6; ty += 2.3) {
      ctx.moveTo(-1.45, ty)
      ctx.lineTo(1.45, ty + 1.2)
      ctx.moveTo(1.45, ty)
      ctx.lineTo(-1.45, ty + 1.2)
    }
    strokeSoft(0.62)

    ctx.restore()
  }

  // --- SLEEK FLAT-SOLED WARAJI SANDAL (1:1 match to transition/frame_03 & run/frame_00!) ---
  const drawSandal = (ankle: Vec2, angle: number, fill: string) => {
    ctx.save()
    ctx.translate(ankle.x, ankle.y)
    ctx.rotate(angle)

    // Slender anatomical foot / tabi profile
    ctx.beginPath()
    ctx.moveTo(-3.4, -2.8)
    ctx.quadraticCurveTo(2.4, -1.6, 8.2, 0.2)
    ctx.quadraticCurveTo(13.6, 1.6, 13.4, 3.4)
    ctx.lineTo(13.2, 4.2)
    ctx.lineTo(-5.8, 4.2)
    ctx.quadraticCurveTo(-6.6, 3.2, -5.8, 0.4)
    ctx.quadraticCurveTo(-5.2, -1.6, -3.4, -2.8)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    strokeInk(0.98)

    // Crisp thin flat straw waraji sole underneath!
    ctx.beginPath()
    ctx.roundRect(-6.4, 3.8, 20.4, 1.7, 0.8)
    ctx.fillStyle = pal.fillShade
    ctx.fill()
    strokeInk(0.92)

    // Heel wrap & twin diagonal instep straps (exact detail from frame_03!)
    ctx.beginPath()
    ctx.moveTo(-3.8, 3.8)
    ctx.quadraticCurveTo(-2.2, 0.2, -1.0, -2.2)
    ctx.moveTo(1.6, -1.0)
    ctx.quadraticCurveTo(4.2, 1.2, 6.2, 3.8)
    ctx.moveTo(4.4, -0.3)
    ctx.quadraticCurveTo(7.0, 1.5, 8.8, 3.8)
    strokeInk(0.84)

    ctx.restore()
  }

  // --- TALL BLOUSON HAKAMA TROUSERS + WRAPPED KYAHAN SHIN WRAPS ---
  const drawLeg = (hip: Vec2, knee: Vec2, ankle: Vec2, footAng: number, isBack: boolean) => {
    const fill = isBack ? pal.fillBack : pal.fillMain
    const sdx = ankle.x - knee.x
    const sdy = ankle.y - knee.y
    const slen = Math.hypot(sdx, sdy) || 1
    const sux = sdx / slen
    const suy = sdy / slen
    const snx = -suy
    const sny = sux

    // Tall shin wrap cuff (cuff starts at ~56% down the shin — matches tall kyahan in frame_03!)
    const cuff: Vec2 = { x: lerp(knee.x, ankle.x, 0.56), y: lerp(knee.y, ankle.y, 0.56) }

    // 1. Tall wrapped Kyahan shin guard
    ctx.beginPath()
    ctx.moveTo(cuff.x + snx * 4.3, cuff.y + sny * 4.3)
    ctx.lineTo(ankle.x + snx * 3.5 + sux * 1.5, ankle.y + sny * 3.5 + suy * 1.5)
    ctx.lineTo(ankle.x - snx * 3.5 + sux * 1.5, ankle.y - sny * 3.5 + suy * 1.5)
    ctx.lineTo(cuff.x - snx * 4.3, cuff.y - sny * 4.3)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(cuff.x + snx * 4.3, cuff.y + sny * 4.3)
    ctx.lineTo(ankle.x + snx * 3.5, ankle.y + sny * 3.5)
    ctx.moveTo(cuff.x - snx * 4.3, cuff.y - sny * 4.3)
    ctx.lineTo(ankle.x - snx * 3.5, ankle.y - sny * 3.5)
    strokeInk(0.96)

    // Clean horizontal/slight-diagonal cloth wrap bands
    ctx.beginPath()
    for (let i = 1; i <= 4; i++) {
      const t = i / 5
      const wx = lerp(cuff.x, ankle.x, t)
      const wy = lerp(cuff.y, ankle.y, t)
      const r = lerp(4.2, 3.5, t)
      ctx.moveTo(wx - snx * r, wy - sny * r)
      ctx.quadraticCurveTo(wx + sux * 0.8, wy + suy * 0.8, wx + snx * r, wy + sny * r)
    }
    strokeInk(0.76, pal.inkMid)

    // 2. Slender thighs with signature blouson puff right above the calf cuff!
    const tdx = knee.x - hip.x
    const tdy = knee.y - hip.y
    const tlen = Math.hypot(tdx, tdy) || 1
    const tux = tdx / tlen
    const tuy = tdy / tlen
    const tnx = -tuy
    const tny = tux

    const kbX = tux + sux
    const kbY = tuy + suy
    const kbLen = Math.hypot(kbX, kbY) || 1
    const bux = kbX / kbLen
    const buy = kbY / kbLen
    const knx = -buy
    const kny = bux

    const bend = clamp(1 - (tux * sux + tuy * suy), 0, 1.4)
    const calf: Vec2 = { x: lerp(knee.x, cuff.x, 0.62), y: lerp(knee.y, cuff.y, 0.62) }

    const hipF: Vec2 = { x: hip.x + tnx * 6.5, y: hip.y + tny * 6.5 }
    const hipB: Vec2 = { x: hip.x - tnx * 6.8, y: hip.y - tny * 6.8 }
    const kneeOut: Vec2 = { x: knee.x + knx * (6.8 + bend * 3.8), y: knee.y + kny * (6.8 + bend * 3.8) }
    const kneeIn: Vec2 = { x: knee.x - knx * (5.8 + bend * 1.4), y: knee.y - kny * (5.8 + bend * 1.4) }
    const calfOut: Vec2 = { x: calf.x + snx * 8.4, y: calf.y + sny * 8.4 }
    const calfIn: Vec2 = { x: calf.x - snx * 7.6, y: calf.y - sny * 7.6 }
    const cuffF: Vec2 = { x: cuff.x + snx * 4.2, y: cuff.y + sny * 4.2 }
    const cuffB: Vec2 = { x: cuff.x - snx * 4.2, y: cuff.y - sny * 4.2 }

    const buildTrouser = (closed: boolean) => {
      ctx.beginPath()
      ctx.moveTo(hipF.x, hipF.y)
      ctx.bezierCurveTo(
        lerp(hipF.x, kneeOut.x, 0.5) + tnx * 1.2,
        lerp(hipF.y, kneeOut.y, 0.5) + tny * 1.2,
        kneeOut.x - bux * 4.5,
        kneeOut.y - buy * 4.5,
        kneeOut.x,
        kneeOut.y
      )
      ctx.bezierCurveTo(
        kneeOut.x + bux * 3.8,
        kneeOut.y + buy * 3.8,
        calfOut.x - sux * 3.8,
        calfOut.y - suy * 3.8,
        calfOut.x,
        calfOut.y
      )
      ctx.bezierCurveTo(
        calfOut.x + sux * 4.8,
        calfOut.y + suy * 4.8,
        cuffF.x + snx * 4.2 + sux * 1.4,
        cuffF.y + sny * 4.2 + suy * 1.4,
        cuffF.x,
        cuffF.y
      )
      ctx.quadraticCurveTo(cuff.x + sux * 1.4, cuff.y + suy * 1.4, cuffB.x, cuffB.y)
      ctx.bezierCurveTo(
        cuffB.x - snx * 3.8 + sux * 1.4,
        cuffB.y - sny * 3.8 + suy * 1.4,
        calfIn.x + sux * 4.6,
        calfIn.y + suy * 4.6,
        calfIn.x,
        calfIn.y
      )
      ctx.bezierCurveTo(
        calfIn.x - sux * 3.8,
        calfIn.y - suy * 3.8,
        kneeIn.x + bux * 3.5,
        kneeIn.y + buy * 3.5,
        kneeIn.x,
        kneeIn.y
      )
      ctx.bezierCurveTo(
        kneeIn.x - bux * 3.8,
        kneeIn.y - buy * 3.8,
        lerp(hipB.x, kneeIn.x, 0.5) - tnx * 1.2,
        lerp(hipB.y, kneeIn.y, 0.5) - tny * 1.2,
        hipB.x,
        hipB.y
      )
      if (closed) ctx.closePath()
    }

    buildTrouser(true)
    ctx.fillStyle = fill
    ctx.fill()
    buildTrouser(false)
    strokeInk(1.02)

    // Subtle fabric crease at knee bend & pocket tick at hip (matching run/frame_00!)
    if (bend > 0.12) {
      ctx.beginPath()
      ctx.moveTo(kneeIn.x + knx * 1.5, kneeIn.y + kny * 1.5)
      ctx.quadraticCurveTo(knee.x + knx * 2.5, knee.y + kny * 2.5, knee.x + bux * 3.5, knee.y + buy * 3.5)
      strokeSoft(0.72)
    }
    ctx.beginPath()
    ctx.moveTo(lerp(hip.x, hipB.x, 0.25), lerp(hip.y, hipB.y, 0.25) + 4)
    ctx.bezierCurveTo(
      lerp(hip.x, knee.x, 0.55) - tnx * 1.1,
      lerp(hip.y, knee.y, 0.55) - tny * 1.1,
      kneeIn.x + knx * 2.2,
      kneeIn.y + kny * 2.2,
      calfIn.x + snx * 2.0,
      calfIn.y + sny * 2.0
    )
    strokeGuide(0.66)

    drawSandal(ankle, footAng, fill)
  }

  // --- EXPRESSIVE ANIME HANDS (Relaxed open fingers in Idle / Gripping scabbard or fist in Run!) ---
  const drawHand = (wrist: Vec2, angle: number, fill: string, style: 'open' | 'fist' | 'grip') => {
    ctx.save()
    ctx.translate(wrist.x, wrist.y)
    ctx.rotate(angle)
    ctx.fillStyle = fill

    if (style === 'open') {
      // Graceful relaxed open fingers pointing gently down-inward (exact match to transition/frame_03!)
      ctx.beginPath()
      ctx.moveTo(-1.0, -2.0)
      ctx.bezierCurveTo(2.4, -2.4, 6.2, -1.6, 8.8, 0.8)
      ctx.quadraticCurveTo(9.4, 2.0, 8.0, 2.5)
      ctx.quadraticCurveTo(5.8, 3.2, 3.8, 2.6)
      ctx.quadraticCurveTo(1.8, 2.1, -1.0, 1.9)
      ctx.closePath()
      ctx.fill()
      strokeInk(0.94)
      // Delicate finger lines
      ctx.beginPath()
      ctx.moveTo(4.2, -0.2)
      ctx.lineTo(7.8, 1.0)
      ctx.moveTo(3.8, 1.0)
      ctx.lineTo(7.0, 2.0)
      strokeSoft(0.68)
    } else if (style === 'fist') {
      // Crisp clenched anime running fist (exact match to far hand in run/frame_00 & frame_03!)
      ctx.beginPath()
      ctx.roundRect(-1.2, -3.2, 7.2, 6.4, 2.4)
      ctx.fill()
      strokeInk(0.96)
      // Knuckle finger folds + thumb wrap
      ctx.beginPath()
      ctx.moveTo(2.0, -3.0)
      ctx.lineTo(2.0, 1.8)
      ctx.moveTo(4.0, -2.8)
      ctx.lineTo(4.0, 1.8)
      ctx.moveTo(0.2, 0.5)
      ctx.quadraticCurveTo(3.4, 0.2, 4.8, 2.6)
      strokeSoft(0.70)
    } else {
      // Scabbard/katana grip hand (thumb over top, fingers curled cleanly!)
      ctx.beginPath()
      ctx.ellipse(2.2, 0.3, 4.1, 3.1, 0.12, 0, Math.PI * 2)
      ctx.fill()
      strokeInk(0.96)
      ctx.beginPath()
      ctx.moveTo(1.2, -1.4)
      ctx.lineTo(4.4, -0.4)
      ctx.moveTo(1.0, 0.6)
      ctx.lineTo(4.2, 1.4)
      strokeSoft(0.68)
    }
    ctx.restore()
  }

  // --- SLENDER ANIME ARM + BELL-FLARED SHORT KIMONO SLEEVE (NO DARK WRIST CUFFS!) ---
  const drawArm = (
    shoulder: Vec2,
    elbow: Vec2,
    hand: Vec2,
    isBack: boolean,
    handStyle: 'open' | 'fist' | 'grip'
  ) => {
    const fill = isBack ? pal.fillBack : pal.fillMain
    const fdx = hand.x - elbow.x
    const fdy = hand.y - elbow.y
    const flen = Math.hypot(fdx, fdy) || 1
    const fnx = -fdy / flen
    const fny = fdx / flen

    // 1. Clean bare slender forearm tapering gently to the wrist
    ctx.beginPath()
    ctx.moveTo(elbow.x + fnx * 3.0, elbow.y + fny * 3.0)
    ctx.quadraticCurveTo(
      lerp(elbow.x, hand.x, 0.5) + fnx * 2.4,
      lerp(elbow.y, hand.y, 0.5) + fny * 2.4,
      hand.x + fnx * 1.85,
      hand.y + fny * 1.85
    )
    ctx.lineTo(hand.x - fnx * 1.85, hand.y - fny * 1.85)
    ctx.quadraticCurveTo(
      lerp(elbow.x, hand.x, 0.5) - fnx * 2.4,
      lerp(elbow.y, hand.y, 0.5) - fny * 2.4,
      elbow.x - fnx * 3.0,
      elbow.y - fny * 3.0
    )
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(elbow.x + fnx * 3.0, elbow.y + fny * 3.0)
    ctx.quadraticCurveTo(
      lerp(elbow.x, hand.x, 0.5) + fnx * 2.4,
      lerp(elbow.y, hand.y, 0.5) + fny * 2.4,
      hand.x + fnx * 1.85,
      hand.y + fny * 1.85
    )
    ctx.moveTo(elbow.x - fnx * 3.0, elbow.y - fny * 3.0)
    ctx.quadraticCurveTo(
      lerp(elbow.x, hand.x, 0.5) - fnx * 2.4,
      lerp(elbow.y, hand.y, 0.5) - fny * 2.4,
      hand.x - fnx * 1.85,
      hand.y - fny * 1.85
    )
    strokeInk(0.96)

    // 2. Crisp flared bell-shaped short kimono sleeve ending smoothly over the elbow!
    const sleeveEnd: Vec2 = { x: lerp(shoulder.x, elbow.x, 0.96), y: lerp(shoulder.y, elbow.y, 0.96) }
    const udx = sleeveEnd.x - shoulder.x
    const udy = sleeveEnd.y - shoulder.y
    const ulen = Math.hypot(udx, udy) || 1
    const uux = udx / ulen
    const uuy = udy / ulen
    const unx = -uuy
    const uny = uux

    const topS: Vec2 = { x: shoulder.x - unx * 5.2 - uux * 2.4, y: shoulder.y - uny * 5.2 - uuy * 2.4 }
    const botS: Vec2 = { x: shoulder.x + unx * 5.4 - uux * 1.6, y: shoulder.y + uny * 5.4 - uuy * 1.6 }
    const flare = isBack ? 7.4 : 8.6
    const topE: Vec2 = { x: sleeveEnd.x - unx * flare, y: sleeveEnd.y - uny * flare }
    const botE: Vec2 = { x: sleeveEnd.x + unx * flare, y: sleeveEnd.y + uny * flare }

    // Subtle shadowed inner sleeve opening right behind the forearm
    ctx.beginPath()
    ctx.moveTo(topE.x, topE.y)
    ctx.quadraticCurveTo(
      sleeveEnd.x + uux * 2.6,
      sleeveEnd.y + uuy * 2.6,
      botE.x,
      botE.y
    )
    ctx.quadraticCurveTo(
      sleeveEnd.x - uux * 1.8,
      sleeveEnd.y - uuy * 1.8,
      topE.x,
      topE.y
    )
    ctx.closePath()
    ctx.fillStyle = pal.fillShade
    ctx.fill()

    // Outer bell sleeve silhouette (crisp open cuff matching frame_03 & run/frame_00!)
    ctx.beginPath()
    ctx.moveTo(topS.x, topS.y)
    ctx.quadraticCurveTo(
      lerp(topS.x, topE.x, 0.5) - unx * 1.2,
      lerp(topS.y, topE.y, 0.5) - uny * 1.2,
      topE.x,
      topE.y
    )
    ctx.quadraticCurveTo(
      sleeveEnd.x + uux * 1.8,
      sleeveEnd.y + uuy * 1.8,
      botE.x,
      botE.y
    )
    ctx.quadraticCurveTo(
      lerp(botS.x, botE.x, 0.5) + unx * 1.2,
      lerp(botS.y, botE.y, 0.5) + uny * 1.2,
      botS.x,
      botS.y
    )
    ctx.quadraticCurveTo(
      shoulder.x - uux * 4.5,
      shoulder.y - uuy * 4.5,
      topS.x,
      topS.y
    )
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    strokeInk(1.0)

    // Delicate vertical sleeve drapery crease
    ctx.beginPath()
    ctx.moveTo(lerp(shoulder.x, sleeveEnd.x, 0.30) + unx * 1.2, lerp(shoulder.y, sleeveEnd.y, 0.30) + uny * 1.2)
    ctx.quadraticCurveTo(
      lerp(shoulder.x, sleeveEnd.x, 0.68) + unx * 2.6,
      lerp(shoulder.y, sleeveEnd.y, 0.68) + uny * 2.6,
      lerp(topE.x, botE.x, 0.66),
      lerp(topE.y, botE.y, 0.66)
    )
    strokeSoft(0.70)

    const handAng = Math.atan2(hand.y - elbow.y, hand.x - elbow.x)
    drawHand(hand, handAng, fill, handStyle)
  }

  // --- MONOCHROME KIMONO TUNIC + TALL STAND COLLAR + IVORY OBI + CLOAK SHOULDER YOKE ---
  const drawTorso = () => {
    ctx.save()
    ctx.translate(rig.hip.x, rig.hip.y)
    ctx.rotate(rig.leanAngle)

    // Slim relaxed upper tunic
    ctx.beginPath()
    ctx.moveTo(-7.2, -36)
    ctx.quadraticCurveTo(0, -38.5, 7.0, -35.5)
    ctx.quadraticCurveTo(9.8, -20, 8.2, -2)
    ctx.quadraticCurveTo(8.4, 2.8, 5.0, 4.0)
    ctx.quadraticCurveTo(0, 4.5, -5.0, 4.0)
    ctx.quadraticCurveTo(-8.4, 2.8, -8.0, -2)
    ctx.quadraticCurveTo(-9.4, -20, -7.2, -36)
    ctx.closePath()
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(1.02)

    // Diagonal kimono lapel line
    ctx.beginPath()
    ctx.moveTo(2.4, -36.0)
    ctx.quadraticCurveTo(6.2, -28.0, 8.4, -17.0)
    ctx.moveTo(4.8, -35.0)
    ctx.quadraticCurveTo(7.8, -29.0, 9.0, -21.0)
    strokeInk(0.82, pal.inkMid)

    // Multi-layered IVORY OBI SASH (monochrome cream matching frame_03!)
    ctx.beginPath()
    ctx.moveTo(-8.4, -9.2)
    ctx.quadraticCurveTo(0, -8.0, 8.4, -9.2)
    ctx.quadraticCurveTo(9.2, -3.6, 8.4, 1.8)
    ctx.quadraticCurveTo(0, 2.8, -8.4, 1.8)
    ctx.quadraticCurveTo(-9.2, -3.6, -8.4, -9.2)
    ctx.closePath()
    ctx.fillStyle = pal.fillShade
    ctx.fill()
    strokeInk(0.98)

    // Horizontal obi wrap folds
    ctx.beginPath()
    ctx.moveTo(-8.2, -5.8)
    ctx.quadraticCurveTo(0, -4.6, 8.2, -5.8)
    ctx.moveTo(-8.2, -2.4)
    ctx.quadraticCurveTo(0, -1.2, 8.2, -2.4)
    strokeInk(0.76, pal.inkMid)

    // Signature thin diagonal cloak/scabbard shoulder strap (seen in transition/frame_03!)
    ctx.beginPath()
    ctx.moveTo(-3.5, -34.0)
    ctx.quadraticCurveTo(-5.8, -18.0, -6.2, -1.0)
    ctx.moveTo(-1.8, -33.6)
    ctx.quadraticCurveTo(-4.0, -18.0, -4.4, -0.8)
    strokeInk(0.74, pal.inkMid)

    // Tall structured Mandarin stand collar (exact silhouette from frame_03 & run/frame_00!)
    ctx.beginPath()
    ctx.moveTo(-5.4, -34.8)
    ctx.lineTo(-4.8, -42.4)
    ctx.quadraticCurveTo(0.2, -41.6, 5.4, -40.2)
    ctx.lineTo(5.6, -34.2)
    ctx.quadraticCurveTo(0, -33.2, -5.4, -34.8)
    ctx.closePath()
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(1.0)

    // Rounded cloak shoulder drape collar wrapping cleanly over the upper chest/shoulder!
    if (opts.showCloak) {
      ctx.beginPath()
      ctx.moveTo(4.2, -34.2)
      ctx.quadraticCurveTo(-1.0, -37.2, -7.8, -34.8)
      ctx.quadraticCurveTo(-9.4, -32.2, -8.0, -30.0)
      ctx.quadraticCurveTo(-1.5, -33.2, 4.4, -31.8)
      ctx.closePath()
      ctx.fillStyle = opts.gear?.crimsonScarf ? '#b84239' : opts.gear?.shadowCloak ? '#393b42' : pal.fillMain
      ctx.fill()
      strokeInk(0.96)
    }

    ctx.restore()
  }

  // --- ANGLED WAIST KATANA (Hilt UP-FORWARD, Scabbard Tip DOWN-BACKWARD — 1:1 match!) ---
  const drawWaistKatana = () => {
    ctx.save()
    ctx.translate(rig.hip.x - 1.5, rig.hip.y - 3.5)
    // Scabbard stays calmly slung at the waist even when the sword is drawn for Slash!
    const sayaAngle = -0.44 + rig.leanAngle * 0.22 + Math.sin(rig.stridePhase * 2) * 0.025 * rig.sprintBlend
    ctx.rotate(sayaAngle)

    // Sleek long ivory-cream Saya (scabbard) angled diagonally down-backward!
    ctx.beginPath()
    ctx.moveTo(-52, -1.6)
    ctx.quadraticCurveTo(-18, -2.5, 8.5, -2.0)
    ctx.quadraticCurveTo(10.0, 0, 8.5, 2.0)
    ctx.quadraticCurveTo(-18, 1.4, -52, 2.2)
    ctx.quadraticCurveTo(-54.2, 0.3, -52, -1.6)
    ctx.closePath()
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(0.98)

    // Subtle sageo cord wrap band on upper scabbard
    ctx.beginPath()
    ctx.moveTo(-1.5, -2.1)
    ctx.lineTo(-1.5, 1.9)
    ctx.moveTo(1.2, -2.1)
    ctx.lineTo(1.2, 1.9)
    ctx.moveTo(3.8, -2.1)
    ctx.lineTo(3.8, 1.9)
    strokeInk(0.80, pal.inkMid)

    // When sheathed, draw the tsuba guard & diamond-wrapped tsuka hilt extending UP-FORWARD!
    if (rig.katanaDraw < 0.25) {
      ctx.save()
      ctx.globalAlpha = 1 - rig.katanaDraw / 0.25

      // Slim vertical Tsuba guard
      ctx.beginPath()
      ctx.ellipse(9.5, 0, 1.5, 5.4, 0, 0, Math.PI * 2)
      ctx.fillStyle = pal.fillShade
      ctx.fill()
      strokeInk(0.96)

      // Diamond-wrapped Tsuka hilt
      ctx.beginPath()
      ctx.roundRect(10.8, -1.85, 21.5, 3.7, 1.2)
      ctx.fillStyle = pal.fillMain
      ctx.fill()
      strokeInk(0.96)

      // Crisp diamond tsuka-ito wrap ticks
      ctx.beginPath()
      for (let tx = 13.0; tx <= 30.0; tx += 2.7) {
        ctx.moveTo(tx, -1.5)
        ctx.lineTo(tx + 1.5, 1.5)
        ctx.moveTo(tx + 1.5, -1.5)
        ctx.lineTo(tx, 1.5)
      }
      strokeSoft(0.64)

      ctx.restore()
    }

    ctx.restore()
  }

  // --- DRAWN KATANA DURING SLASH ---
  const drawDrawnKatana = () => {
    if (opts.activeWeapon === 'bow' || rig.katanaDraw < 0.12) return
    ctx.save()
    ctx.globalAlpha = clamp(rig.katanaDraw, 0, 1)
    ctx.translate(rig.handNear.x, rig.handNear.y)
    ctx.rotate(rig.katanaAngle)

    ctx.beginPath()
    ctx.roundRect(-13, -1.5, 15, 3.0, 1.2)
    ctx.fillStyle = pal.fillShade
    ctx.fill()
    strokeInk(0.95)

    ctx.beginPath()
    ctx.ellipse(2.2, 0, 1.4, 4.4, 0, 0, Math.PI * 2)
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(0.95)

    const curve = -3.4
    const bLen = opts.gear?.moonlightBlade ? 60 : 52
    ctx.beginPath()
    ctx.moveTo(3.8, -1.4)
    ctx.quadraticCurveTo(bLen * 0.52, -1.4 + curve * 0.4, bLen, curve - 0.6)
    ctx.quadraticCurveTo(bLen + 4.2, curve + 0.15, bLen, curve + 0.9)
    ctx.quadraticCurveTo(bLen * 0.52, 1.3 + curve * 0.4, 3.8, 1.3)
    ctx.closePath()
    ctx.fillStyle = opts.gear?.moonlightBlade ? '#eef4ff' : pal.bladeLight
    ctx.fill()
    strokeInk(1.0, opts.gear?.moonlightBlade ? '#3e538c' : pal.ink)

    ctx.beginPath()
    ctx.moveTo(5, -0.25)
    ctx.quadraticCurveTo(bLen * 0.52, -0.25 + curve * 0.4, bLen - 2, curve - 0.05)
    strokeInk(0.75, pal.bladeEdge)

    ctx.restore()
  }

  // --- HELD YUMI WAR BOW (WHEN SWITCHED TO BOW WEAPON) ---
  const drawHeldBow = () => {
    if (opts.activeWeapon !== 'bow') return
    const recoil = clamp(opts.bowRecoil ?? 0, 0, 1)
    const pullX = recoil > 0 ? -recoil * 6 : -3.5
    ctx.save()
    ctx.translate(rig.chest.x + 20, rig.chest.y - 2)

    // Bowstring (taut or slightly drawn)
    ctx.beginPath()
    ctx.moveTo(-4, -36)
    ctx.lineTo(-4 + pullX, 2)
    ctx.lineTo(-2, 26)
    strokeInk(0.9, pal.inkMid)

    // Asymmetrical Japanese Yumi bow stave (taller upper limb)
    ctx.beginPath()
    ctx.moveTo(-4, -36)
    ctx.bezierCurveTo(10, -24, 12, -8, 6, 4)
    ctx.bezierCurveTo(10, 14, 7, 21, -2, 26)
    strokeInk(3.2, '#6e4e2e')
    ctx.beginPath()
    ctx.moveTo(-4, -36)
    ctx.bezierCurveTo(10, -24, 12, -8, 6, 4)
    ctx.bezierCurveTo(10, 14, 7, 21, -2, 26)
    strokeInk(1.1, pal.ink)

    // Crimson leather grip wrap
    ctx.beginPath()
    ctx.moveTo(7.5, -1)
    ctx.lineTo(6.0, 8)
    strokeInk(3.8, '#b84239')

    // Nocked arrow when player has arrows remaining
    if (opts.hasArrows !== false) {
      ctx.beginPath()
      ctx.moveTo(-4 + pullX, 2)
      ctx.lineTo(24 + pullX * 0.3, 2)
      strokeInk(1.5, '#5e4c36')
      // Steel arrowhead
      ctx.fillStyle = '#384052'
      ctx.beginPath()
      ctx.moveTo(29 + pullX * 0.3, 2)
      ctx.lineTo(22 + pullX * 0.3, -1.2)
      ctx.lineTo(22 + pullX * 0.3, 5.2)
      ctx.closePath()
      ctx.fill()
      // Crimson fletching
      ctx.beginPath()
      ctx.moveTo(-2 + pullX, 2)
      ctx.lineTo(-7 + pullX, -1.2)
      ctx.moveTo(-2 + pullX, 2)
      ctx.lineTo(-7 + pullX, 5.2)
      strokeInk(1.1, '#b84239')
    }

    ctx.restore()
  }

  // --- SHADOWED MINIMALIST FACE + SHORT NAPE HAIR + PINCHED-PEAK KASA HAT (1:1 MATCH!) ---
  const drawHeadAndHat = () => {
    ctx.save()
    ctx.translate(rig.neck.x, rig.neck.y)
    ctx.rotate(rig.headTilt)

    // Neck tucked cleanly into tall stand collar
    ctx.beginPath()
    ctx.moveTo(-4.0, 4.2)
    ctx.quadraticCurveTo(-3.6, -1.8, -3.2, -7.2)
    ctx.lineTo(3.8, -7.2)
    ctx.quadraticCurveTo(4.0, -1.8, 4.2, 4.2)
    ctx.closePath()
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(-4.0, 3.2)
    ctx.quadraticCurveTo(-3.6, -1.8, -3.2, -7.0)
    ctx.moveTo(3.8, -7.0)
    ctx.quadraticCurveTo(4.0, -1.8, 4.1, 3.2)
    strokeInk(0.96)

    // Clean minimalist anime side-profile head (faceless calm mystique, exact nose & jaw from frame_03!)
    ctx.beginPath()
    ctx.moveTo(-4.4, -6.2)
    ctx.quadraticCurveTo(-6.8, -11.0, -6.0, -16.2)
    ctx.quadraticCurveTo(-1.0, -22.5, 7.6, -17.8)
    ctx.quadraticCurveTo(8.8, -15.2, 9.1, -13.0)
    ctx.quadraticCurveTo(11.4, -10.8, 10.6, -9.8)
    ctx.quadraticCurveTo(9.1, -9.2, 9.2, -7.6)
    ctx.quadraticCurveTo(9.2, -4.8, 7.4, -3.6)
    ctx.quadraticCurveTo(2.8, -2.5, -4.4, -6.2)
    ctx.closePath()
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(1.02)

    // Crisp horizontal brim shadow band across the eyes/upper face (signature look from all 4 frames!)
    if (opts.showHat) {
      ctx.beginPath()
      ctx.moveTo(-5.8, -16.4)
      ctx.quadraticCurveTo(-1.0, -22.2, 7.6, -17.8)
      ctx.quadraticCurveTo(9.2, -14.8, 9.2, -12.6)
      ctx.quadraticCurveTo(2.0, -12.8, -5.8, -12.4)
      ctx.closePath()
      ctx.fillStyle = pal.browShadow
      ctx.fill()
    }

    // Short neat dark-gray nape hair behind the ear (exact match to frame_03 & run/frame_00!)
    ctx.beginPath()
    ctx.moveTo(-6.0, -15.2)
    ctx.quadraticCurveTo(-7.2, -11.2, -4.6, -6.4)
    ctx.quadraticCurveTo(-3.2, -8.5, -2.2, -10.2)
    ctx.quadraticCurveTo(-1.2, -12.8, -1.0, -15.5)
    ctx.closePath()
    ctx.fillStyle = pal.hairFill
    ctx.fill()
    strokeInk(0.88, pal.inkMid)

    // Delicate ear contour & subtle nape hair ticks
    ctx.beginPath()
    ctx.moveTo(-0.8, -13.4)
    ctx.quadraticCurveTo(-2.6, -10.2, 0.2, -8.6)
    ctx.moveTo(-4.2, -13.0)
    ctx.lineTo(-5.2, -9.2)
    strokeInk(0.78, pal.inkMid)

    // Subtle fitted hat chin-tie line curving along the jawline
    if (opts.showHat) {
      ctx.beginPath()
      ctx.moveTo(-1.6, -14.8)
      ctx.quadraticCurveTo(-0.6, -9.5, 2.2, -4.6)
      strokeSoft(0.68)
    } else {
      ctx.beginPath()
      ctx.arc(-1.8, -15.6, 7.8, Math.PI * 0.85, Math.PI * 2.15)
      ctx.fillStyle = pal.hairFill
      ctx.fill()
      strokeInk(0.98)
    }

    // ICONIC WIDE PINCHED-PEAK CONICAL KASA HAT (1:1 silhouette from transition/frame_03!)
    if (opts.showHat) {
      ctx.save()
      ctx.translate(0.5, -15.4)
      ctx.rotate(rig.hatTilt)

      // Dark-shaded flat underside ellipse
      ctx.beginPath()
      ctx.ellipse(0, 0.9, 43.5, 2.5, 0, 0, Math.PI * 2)
      ctx.fillStyle = pal.hatUnder
      ctx.fill()
      strokeInk(0.92)

      // Wide conical saucer crown with the signature PINCHED TOP KNOB/PEAK!
      ctx.beginPath()
      ctx.moveTo(0, -19.2)
      // Pinched peak into graceful shallow conical sweep on left
      ctx.bezierCurveTo(-1.4, -15.4, -3.6, -14.8, -9.5, -12.8)
      ctx.bezierCurveTo(-22.5, -8.4, -35.5, -3.4, -43.5, 0.2)
      // Crisp brim bottom curve
      ctx.bezierCurveTo(-44.6, 0.8, -43.0, 1.5, -37.0, 1.6)
      ctx.bezierCurveTo(-16.0, 2.1, 16.0, 2.1, 37.0, 1.6)
      ctx.bezierCurveTo(43.0, 1.5, 44.6, 0.8, 43.5, 0.2)
      // Right conical sweep back into pinched top peak
      ctx.bezierCurveTo(35.5, -3.4, 22.5, -8.4, 9.5, -12.8)
      ctx.bezierCurveTo(3.6, -14.8, 1.4, -15.4, 0, -19.2)
      ctx.closePath()
      ctx.fillStyle = pal.hatFill
      ctx.fill()
      strokeInk(1.06, opts.gear?.galeHat ? '#9b7428' : pal.ink)

      // Subtle double underside rim shadow line (gold weave trim when Gale Straw Kasa equipped!)
      ctx.beginPath()
      ctx.moveTo(-40.0, 1.2)
      ctx.quadraticCurveTo(0, 2.4, 40.0, 1.2)
      strokeInk(opts.gear?.galeHat ? 1.45 : 0.75, opts.gear?.galeHat ? '#c6993b' : pal.inkMid)

      // Signature twin curved radial bamboo seam lines on crown!
      ctx.beginPath()
      ctx.moveTo(-1.2, -16.0)
      ctx.bezierCurveTo(-10.5, -10.4, -21.5, -5.2, -31.5, 1.0)
      ctx.moveTo(1.2, -16.0)
      ctx.bezierCurveTo(10.5, -10.4, 21.5, -5.2, 31.5, 1.0)
      strokeInk(0.74, pal.inkSoft)

      ctx.restore()
    }

    ctx.restore()
  }

  // --- LAYERED DRAW ORDER (EXACT 1:1 OVERLAP FROM ORIGINAL FRAMES!) ---
  const farStyle: 'open' | 'fist' | 'grip' =
    rig.mode === 'Run' || rig.mode === 'Jump' || rig.mode === 'Fall' ? 'fist' : 'open'
  const nearStyle: 'open' | 'fist' | 'grip' =
    rig.mode === 'Idle' ? 'open' : 'grip'

  drawBackKatana()
  drawArm(rig.shoulderFar, rig.elbowFar, rig.handFar, true, farStyle)
  drawLeg(rig.hipFar, rig.kneeBack, rig.ankleBack, rig.backFootAng, true)
  drawLeg(rig.hipNear, rig.kneeFront, rig.ankleFront, rig.frontFootAng, false)
  drawTorso()
  drawHeadAndHat()
  // Waist katana scabbard passes IN FRONT OF cloak & torso, BEHIND near forearm/hand!
  drawWaistKatana()
  drawDrawnKatana()
  drawHeldBow()
  drawArm(rig.shoulderNear, rig.elbowNear, rig.handNear, false, nearStyle)

  ctx.restore()

  // --- 3. OPTIONAL ANIMATOR'S BLUE IK SKELETON OVERLAY ---
  if (opts.showRig) {
    ctx.save()
    ctx.translate(rig.worldX, rig.worldY)
    ctx.scale(rig.facing * rig.squashX * scale, rig.squashY * scale)
    const drawBone = (a: Vec2, b: Vec2, color: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(a.x, a.y, 1.9, 0, Math.PI * 2)
      ctx.arc(b.x, b.y, 1.9, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    drawBone(rig.hip, rig.chest, '#2563eb')
    drawBone(rig.chest, rig.neck, '#2563eb')
    drawBone(rig.hipNear, rig.kneeFront, '#2563eb')
    drawBone(rig.kneeFront, rig.ankleFront, '#2563eb')
    drawBone(rig.hipFar, rig.kneeBack, '#60a5fa')
    drawBone(rig.kneeBack, rig.ankleBack, '#60a5fa')
    drawBone(rig.shoulderNear, rig.elbowNear, '#1d4ed8')
    drawBone(rig.elbowNear, rig.handNear, '#1d4ed8')
    drawBone(rig.shoulderFar, rig.elbowFar, '#60a5fa')
    drawBone(rig.elbowFar, rig.handFar, '#60a5fa')
    ctx.restore()
  }
}

export interface SamuraiTopDownRig {
  x: number
  y: number
  vx: number
  vy: number
  heading: number // smooth 360-degree angle in radians (0=+x, pi/2=+y)
  targetHeading: number
  stridePhase: number
  breathPhase: number
  moveBlend: number // 0=idle, 0.5=walk, 1=run
  sprintBlend: number
  slashProg: number
  slashVariant: number
  katanaDraw: number
  katanaAngle: number
  hatShiftX: number
  hatShiftY: number
  hatVelX: number
  hatVelY: number
  dashFlash: number
  elapsed: number
  clothAccum: number
  lastStepHalf: number
  mode: SamuraiAnimMode
  // 3 parallel 120Hz Verlet cloth chains for a wide, silky 360° billowing cloak from above!
  cloakLeft: ClothNode[]
  cloakMid: ClothNode[]
  cloakRight: ClothNode[]
  // Foot offsets along heading axis (from exact 8-keyframe RUN_KEYS!)
  footL: number
  footR: number
  footLiftL: number
  footLiftR: number
}

export interface SamuraiTopDownStepInput {
  x: number
  y: number
  vx: number
  vy: number
  aimAngle: number | null // optional cursor/movement heading
  mode: SamuraiAnimMode
  forced: boolean
  slashTimer: number
  slashDuration: number
  slashVariant: number
  dashTimer: number
  dt: number
}

export function createSamuraiTopDownRig(startX = 0, startY = 0, heading = Math.PI * 0.5): SamuraiTopDownRig {
  const bx = -Math.cos(heading)
  const by = -Math.sin(heading)
  const px = -Math.sin(heading)
  const py = Math.cos(heading)
  return {
    x: startX,
    y: startY,
    vx: 0,
    vy: 0,
    heading,
    targetHeading: heading,
    stridePhase: 0,
    breathPhase: 0,
    moveBlend: 0,
    sprintBlend: 0,
    slashProg: 0,
    slashVariant: 0,
    katanaDraw: 0,
    katanaAngle: -0.9,
    hatShiftX: 0,
    hatShiftY: 0,
    hatVelX: 0,
    hatVelY: 0,
    dashFlash: 0,
    elapsed: 0,
    clothAccum: 0,
    lastStepHalf: -1,
    mode: 'Idle',
    cloakLeft: createClothChain(7, startX + bx * 6 - px * 11, startY + by * 6 - py * 11, bx * 7.5 - px * 1.4, by * 7.5 - py * 1.4),
    cloakMid: createClothChain(7, startX + bx * 7, startY + by * 7, bx * 8.2, by * 8.2),
    cloakRight: createClothChain(7, startX + bx * 6 + px * 11, startY + by * 6 + py * 11, bx * 7.5 + px * 1.4, by * 7.5 + py * 1.4),
    footL: 2,
    footR: -2,
    footLiftL: 0,
    footLiftR: 0,
  }
}

export function resetSamuraiTopDownCloth(rig: SamuraiTopDownRig, x: number, y: number, heading: number) {
  rig.x = x
  rig.y = y
  rig.heading = heading
  rig.targetHeading = heading
  const bx = -Math.cos(heading)
  const by = -Math.sin(heading)
  const px = -Math.sin(heading)
  const py = Math.cos(heading)
  rig.cloakLeft = createClothChain(7, x + bx * 6 - px * 11, y + by * 6 - py * 11, bx * 7.5 - px * 1.4, by * 7.5 - py * 1.4)
  rig.cloakMid = createClothChain(7, x + bx * 7, y + by * 7, bx * 8.2, by * 8.2)
  rig.cloakRight = createClothChain(7, x + bx * 6 + px * 11, y + by * 6 + py * 11, bx * 7.5 + px * 1.4, by * 7.5 + py * 1.4)
}

function stepTopDownClothChain(
  nodes: ClothNode[],
  anchor: Vec2,
  segLen: number,
  windX: number,
  windY: number,
  turbAmp: number,
  time: number,
  phaseShift: number
) {
  const dt2 = FIXED_CLOTH_DT * FIXED_CLOTH_DT
  const maxStep = segLen * 0.6
  const damping = 0.945

  nodes[0].x = anchor.x
  nodes[0].y = anchor.y
  nodes[0].ox = anchor.x
  nodes[0].oy = anchor.y

  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i]
    let vx = (n.x - n.ox) * damping
    let vy = (n.y - n.oy) * damping
    const spd = Math.hypot(vx, vy)
    if (spd > maxStep) {
      const s = maxStep / spd
      vx *= s
      vy *= s
    }
    n.ox = n.x
    n.oy = n.y

    const frac = i / (nodes.length - 1)
    const wLen = Math.hypot(windX, windY) || 1
    const perpX = -windY / wLen
    const perpY = windX / wLen
    const flutter = Math.sin(time * 8.6 - i * 0.85 + phaseShift) * turbAmp * frac

    const ax = windX * (0.45 + 0.85 * frac) + perpX * flutter
    const ay = windY * (0.45 + 0.85 * frac) + perpY * flutter

    n.x += vx + ax * dt2
    n.y += vy + ay * dt2
  }

  for (let pass = 0; pass < 6; pass++) {
    nodes[0].x = anchor.x
    nodes[0].y = anchor.y
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i]
      const b = nodes[i + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.hypot(dx, dy) || 0.0001
      const diff = (dist - segLen) / dist
      if (i === 0) {
        b.x -= dx * diff
        b.y -= dy * diff
      } else {
        a.x += dx * diff * 0.30
        a.y += dy * diff * 0.30
        b.x -= dx * diff * 0.70
        b.y -= dy * diff * 0.70
      }
    }
  }
}

export function stepSamuraiTopDown(rig: SamuraiTopDownRig, input: SamuraiTopDownStepInput): SamuraiStepEvents {
  const dt = clamp(input.dt, 0.0005, 0.05)
  rig.elapsed += dt
  rig.x = input.x
  rig.y = input.y
  rig.vx = input.vx
  rig.vy = input.vy
  rig.mode = input.mode
  rig.slashVariant = input.slashVariant
  rig.dashFlash = damp(rig.dashFlash, input.dashTimer > 0 ? 1 : 0, 18, dt)

  const events: SamuraiStepEvents = { footstep: 'none', stepSide: 1 }

  const speed = Math.hypot(input.vx, input.vy)
  if (input.aimAngle !== null) {
    rig.targetHeading = input.aimAngle
  } else if (speed > 12) {
    rig.targetHeading = Math.atan2(input.vy, input.vx)
  }

  // Smooth 360-degree heading interpolation (zero directional snapping!)
  rig.heading = dampAngle(rig.heading, rig.targetHeading, input.slashTimer > 0 ? 22 : 14, dt)

  rig.breathPhase += dt * ((Math.PI * 2) / 3.4)
  const targetMove = input.mode === 'Run' ? 1 : input.mode === 'Walk' ? 0.5 : 0
  rig.moveBlend = damp(rig.moveBlend, targetMove, 10, dt)
  rig.sprintBlend = damp(rig.sprintBlend, input.mode === 'Run' ? 1 : 0, 9.5, dt)

  if (input.mode === 'Run') {
    const rate = input.forced ? 8.6 : clamp(speed / 44, 6.8, 10.6)
    rig.stridePhase += dt * rate
  } else if (input.mode === 'Walk') {
    const rate = input.forced ? 5.2 : clamp(speed / 30, 3.8, 6.4)
    rig.stridePhase += dt * rate
  } else if (input.mode === 'Idle') {
    const nearest = Math.round(rig.stridePhase / (Math.PI * 2)) * Math.PI * 2
    rig.stridePhase = damp(rig.stridePhase, nearest, 5.5, dt)
  }

  if (input.mode === 'Run' || input.mode === 'Walk') {
    const halfIdx = Math.floor((rig.stridePhase + 0.35) / Math.PI)
    if (halfIdx !== rig.lastStepHalf) {
      rig.lastStepHalf = halfIdx
      events.footstep = input.mode === 'Run' ? 'run' : 'walk'
      events.stepSide = halfIdx % 2 === 0 ? 1 : -1
    }
  }

  // Project the exact 8-keyframe RUN_KEYS stride onto the bird's-eye ground plane!
  let targetFootL = 2.5
  let targetFootR = -2.5
  let targetLiftL = 0
  let targetLiftR = 0
  if (input.mode === 'Run') {
    const rk = sampleRunCycle(rig.stridePhase)
    targetFootL = rk.fx * 0.56
    targetFootR = rk.bx * 0.56
    targetLiftL = clamp((-rk.fy - 4.8) / 22, 0, 1)
    targetLiftR = clamp((-rk.by - 4.8) / 22, 0, 1)
  } else if (input.mode === 'Walk') {
    const c = Math.cos(rig.stridePhase)
    const s = Math.sin(rig.stridePhase)
    targetFootL = c * 11.5
    targetFootR = -c * 11.5
    targetLiftL = Math.max(0, -s) * 0.45
    targetLiftR = Math.max(0, s) * 0.45
  }

  const fRate = input.mode === 'Run' ? 26 : 13
  rig.footL = damp(rig.footL, targetFootL, fRate, dt)
  rig.footR = damp(rig.footR, targetFootR, fRate, dt)
  rig.footLiftL = damp(rig.footLiftL, targetLiftL, fRate, dt)
  rig.footLiftR = damp(rig.footLiftR, targetLiftR, fRate, dt)

  // 4-Move Kenjutsu Slash Combo (0: Forehand Sweep, 1: Rising Uppercut, 2: Overhead Cleave, 3: Piercing Thrust)
  const slashActive = input.mode === 'Slash' && input.slashTimer > 0
  const slashProg = slashActive ? clamp(1 - input.slashTimer / Math.max(0.01, input.slashDuration), 0, 1) : 0
  rig.slashProg = slashProg
  if (slashActive) {
    rig.slashVariant = ((input.slashVariant % 4) + 4) % 4
    const swingEase =
      slashProg < 0.15
        ? 0
        : slashProg < 0.56
          ? 1 - Math.pow(1 - (slashProg - 0.15) / 0.41, 3)
          : 1.0
    const startAng =
      rig.slashVariant === 0
        ? -1.55
        : rig.slashVariant === 1
          ? 1.55
          : rig.slashVariant === 2
            ? -0.25
            : 0
    const endAng =
      rig.slashVariant === 0
        ? 1.45
        : rig.slashVariant === 1
          ? -1.45
          : rig.slashVariant === 2
            ? 0.15
            : 0
    rig.katanaDraw = damp(rig.katanaDraw, slashProg < 0.88 ? 1 : 0, 44, dt)
    rig.katanaAngle = lerp(startAng, endAng, swingEase)
  } else {
    rig.katanaDraw = damp(rig.katanaDraw, 0, 16, dt)
    rig.katanaAngle = dampAngle(rig.katanaAngle, -0.9, 12, dt)
  }

  // Spring inertia on the wide Kasa hat peak (subtly leans forward into movement & turns!)
  const hx = Math.cos(rig.heading)
  const hy = Math.sin(rig.heading)
  const targetShiftX = hx * (1.2 + rig.moveBlend * 2.6 + rig.dashFlash * 2.2)
  const targetShiftY = hy * (1.2 + rig.moveBlend * 2.6 + rig.dashFlash * 2.2)
  rig.hatVelX += ((targetShiftX - rig.hatShiftX) * 120 - rig.hatVelX * 15) * dt
  rig.hatVelY += ((targetShiftY - rig.hatShiftY) * 120 - rig.hatVelY * 15) * dt
  rig.hatShiftX = clamp(rig.hatShiftX + rig.hatVelX * dt, -6, 6)
  rig.hatShiftY = clamp(rig.hatShiftY + rig.hatVelY * dt, -6, 6)

  // 120Hz 360° Bird's-Eye Verlet Cloak (3 parallel ribbons: Left Edge, Center Spine, Right Edge)
  const bx = -hx
  const by = -hy
  const px = -hy
  const py = hx

  const anchorL: Vec2 = { x: rig.x + bx * 5 - px * 11.5, y: rig.y + by * 5 - py * 11.5 }
  const anchorM: Vec2 = { x: rig.x + bx * 6, y: rig.y + by * 6 }
  const anchorR: Vec2 = { x: rig.x + bx * 5 + px * 11.5, y: rig.y + by * 5 + py * 11.5 }

  // Ambient soft garden breeze + movement counter-airflow behind heading
  const ambWindX = Math.cos(rig.elapsed * 0.55) * 120 - 80
  const ambWindY = Math.sin(rig.elapsed * 0.72) * 110 + 70
  const moveWindMag = lerp(190, 920, rig.moveBlend) + rig.dashFlash * 850
  const windX = bx * moveWindMag - input.vx * 1.45 + ambWindX * (1 - rig.moveBlend * 0.65)
  const windY = by * moveWindMag - input.vy * 1.45 + ambWindY * (1 - rig.moveBlend * 0.65)
  const turb = lerp(110, 290, rig.moveBlend)
  const segLen = lerp(6.6, 8.8, rig.moveBlend)

  rig.clothAccum = Math.min(rig.clothAccum + dt, FIXED_CLOTH_DT * 8)
  while (rig.clothAccum >= FIXED_CLOTH_DT) {
    rig.clothAccum -= FIXED_CLOTH_DT
    const t = rig.elapsed
    // Slight lateral fan-out force on left/right edges so the cloak never collapses into a thin line!
    stepTopDownClothChain(rig.cloakLeft, anchorL, segLen, windX - px * 155, windY - py * 155, turb, t, 0.0)
    stepTopDownClothChain(rig.cloakMid, anchorM, segLen * 1.06, windX, windY, turb * 0.75, t, 0.9)
    stepTopDownClothChain(rig.cloakRight, anchorR, segLen, windX + px * 155, windY + py * 155, turb, t, 1.8)
  }

  return events
}

// =============================================================================
// 2.5D HIGH-ANGLE BIRD'S-EYE RONIN RENDERER — FULL STANDING CHARACTER IN 360°!
// Projects height (+z -> upward on screen) above the ground plane so you clearly
// see the stepping waraji sandals, wrapped kyahan shins, blouson hakama trousers,
// kimono torso & obi sash, pumping sleeves, waist/back katanas, Yumi war bow,
// billowing 120Hz cloak, shadowed anime face, and elevated pinched-peak kasa hat!
// =============================================================================
export function drawSamuraiTopDown(
  ctx: CanvasRenderingContext2D,
  rig: SamuraiTopDownRig,
  opts: SamuraiDrawOptions
) {
  const pal = getSamuraiPalette(opts.paperTone)
  const scale = opts.scale ?? 1.0

  const strokeInk = (w = 1.08, color = pal.ink) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.lineWidth = w
    ctx.stroke()
  }

  const strokeSoft = (w = 0.74) => strokeInk(w, pal.inkSoft)

  const fx = Math.cos(rig.heading)
  const fy = Math.sin(rig.heading)
  const rx = -fy
  const ry = fx
  const DEPTH_Y = 0.56

  const br = Math.sin(rig.breathPhase)
  const bob = Math.abs(Math.sin(rig.stridePhase)) * 1.9 * rig.moveBlend
  const armPump = Math.cos(rig.stridePhase) * rig.moveBlend
  const leanFwd = rig.sprintBlend * 4.8 + rig.moveBlend * 1.4
  const facingNorth = fy < -0.22

  // Local 2.5D projection helper (groundX, groundY -> screen, heightZ -> upward)
  const proj = (fwd: number, lat: number, z: number): Vec2 => ({
    x: fwd * fx + lat * rx,
    y: (fwd * fy + lat * ry) * DEPTH_Y - z,
  })

  // --- 0. SOFT GROUND SHADOW DIRECTLY UNDER THE FEET ---
  ctx.save()
  ctx.translate(rig.x, rig.y + 1.5 * scale)
  ctx.fillStyle = pal.groundShadow
  ctx.beginPath()
  const shadowSpread = (16 + Math.abs(rig.footL - rig.footR) * 0.25) * scale
  ctx.ellipse(0, 0, shadowSpread, 9.5 * scale, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(rig.x, rig.y)
  ctx.scale(scale, scale)

  const hipZ = 18.5 - bob
  const chestZ = 27.5 - bob + br * 0.35
  const shoulderZ = 32.5 - bob + br * 0.4
  const headZ = 38.8 - bob + br * 0.45

  // --- HELPER: 2.5D BILLOWING 120Hz VERLET CLOAK & CRIMSON SCARF ---
  const drawCloak25D = () => {
    if (!opts.showCloak) return
    const L = rig.cloakLeft
    const M = rig.cloakMid
    const R = rig.cloakRight
    if (L.length < 6 || M.length < 6 || R.length < 6) return

    const mapChain = (chain: ClothNode[]): Vec2[] => {
      const n = chain.length
      const pts: Vec2[] = []
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        const dx = (chain[i].x - rig.x) / scale
        const dy = (chain[i].y - rig.y) / scale
        const z = lerp(shoulderZ - 1.5, 7.5, Math.pow(t, 0.82))
        pts.push({
          x: dx,
          y: dy * 0.64 - z,
        })
      }
      return pts
    }

    const pL = mapChain(L)
    const pM = mapChain(M)
    const pR = mapChain(R)
    const tipL = pL[pL.length - 1]
    const tipM = pM[pM.length - 1]
    const tipR = pR[pR.length - 1]

    ctx.save()
    ctx.beginPath()
    ctx.moveTo(pL[0].x, pL[0].y)
    for (let i = 1; i < pL.length - 1; i++) {
      ctx.quadraticCurveTo(pL[i].x, pL[i].y, (pL[i].x + pL[i + 1].x) * 0.5, (pL[i].y + pL[i + 1].y) * 0.5)
    }
    ctx.lineTo(tipL.x, tipL.y)
    ctx.quadraticCurveTo(lerp(tipL.x, tipM.x, 0.5), lerp(tipL.y, tipM.y, 0.5) + 2.2, tipM.x, tipM.y)
    ctx.quadraticCurveTo(lerp(tipM.x, tipR.x, 0.5), lerp(tipM.y, tipR.y, 0.5) + 2.2, tipR.x, tipR.y)
    for (let i = pR.length - 2; i >= 1; i--) {
      ctx.quadraticCurveTo(pR[i].x, pR[i].y, (pR[i].x + pR[i - 1].x) * 0.5, (pR[i].y + pR[i - 1].y) * 0.5)
    }
    ctx.lineTo(pR[0].x, pR[0].y)
    ctx.closePath()

    ctx.fillStyle = opts.gear?.shadowCloak ? '#393b42' : pal.fillMain
    ctx.fill()
    strokeInk(1.42, opts.gear?.shadowCloak ? '#22242a' : pal.ink)

    // Interior drapery fold lines clipped cleanly inside cloak
    ctx.save()
    ctx.clip()
    ctx.beginPath()
    ctx.moveTo(pM[0].x, pM[0].y)
    for (let i = 1; i < pM.length - 1; i++) {
      ctx.quadraticCurveTo(pM[i].x, pM[i].y, (pM[i].x + pM[i + 1].x) * 0.5, (pM[i].y + pM[i + 1].y) * 0.5)
    }
    ctx.lineTo(tipM.x, tipM.y)
    strokeInk(1.05, opts.gear?.shadowCloak ? 'rgba(255,255,255,0.28)' : pal.inkMid)

    ctx.beginPath()
    ctx.moveTo(lerp(pL[1].x, pM[1].x, 0.5), lerp(pL[1].y, pM[1].y, 0.5))
    ctx.quadraticCurveTo(
      lerp(pL[3].x, pM[3].x, 0.5),
      lerp(pL[3].y, pM[3].y, 0.5),
      lerp(tipL.x, tipM.x, 0.45),
      lerp(tipL.y, tipM.y, 0.45)
    )
    ctx.moveTo(lerp(pR[1].x, pM[1].x, 0.5), lerp(pR[1].y, pM[1].y, 0.5))
    ctx.quadraticCurveTo(
      lerp(pR[3].x, pM[3].x, 0.5),
      lerp(pR[3].y, pM[3].y, 0.5),
      lerp(tipR.x, tipM.x, 0.45),
      lerp(tipR.y, tipM.y, 0.45)
    )
    strokeSoft(0.68)
    ctx.restore()

    // Flowing Crimson Wind Scarf ribbon overlay when equipped
    if (opts.gear?.crimsonScarf) {
      ctx.beginPath()
      ctx.moveTo(pM[0].x, pM[0].y)
      for (let i = 1; i < pM.length - 1; i++) {
        ctx.quadraticCurveTo(pM[i].x, pM[i].y, (pM[i].x + pM[i + 1].x) * 0.5, (pM[i].y + pM[i + 1].y) * 0.5)
      }
      ctx.lineTo(tipM.x, tipM.y)
      ctx.strokeStyle = '#b84239'
      ctx.lineWidth = 4.2
      ctx.lineCap = 'round'
      ctx.stroke()
      ctx.strokeStyle = pal.ink
      ctx.lineWidth = 0.85
      ctx.stroke()
    }
    ctx.restore()
  }

  // --- HELPER: FULL 2.5D LEG (BLOUSON HAKAMA + 4-WRAP KYAHAN SHIN + TRUE 360° FORESHORTENED WARAJI SANDAL!) ---
  const drawLeg25D = (side: -1 | 1, footFwd: number, lift: number, isBack: boolean) => {
    const fill = isBack ? pal.fillBack : pal.fillMain
    const hip = proj(leanFwd * 0.2, side * 5.2, hipZ)
    const strideFwd = footFwd * 1.18
    const footZ = lift * 6.5
    const ankle = proj(strideFwd, side * 6.0, footZ + 4.1)
    const knee = proj(
      lerp(leanFwd * 0.2, strideFwd, 0.5) + 2.8 + lift * 2.5,
      side * 5.7,
      lerp(hipZ, footZ + 4.1, 0.52) + lift * 2.0
    )
    const cuff = { x: lerp(knee.x, ankle.x, 0.28), y: lerp(knee.y, ankle.y, 0.28) }

    // 1. TRUE 3D-PROJECTED 360° WARAJI SANDAL & TABI FOOT (foreshortens naturally in Front, Back, 3/4 & Side views!)
    const footGround = proj(strideFwd, side * 6.0, footZ)
    // Subtle natural outward stance splay (~11°) when facing Front (+Y) or Back (-Y)
    const splay = side * 0.19 * (1 - Math.abs(fx) * 0.75)
    const footAng3D = rig.heading + splay
    const ufx = Math.cos(footAng3D)
    const ufy = Math.sin(footAng3D)

    const pFoot = (len: number, wid: number, z: number): Vec2 => ({
      x: footGround.x + len * ufx - wid * ufy,
      y: footGround.y + (len * ufy + wid * ufx) * DEPTH_Y - z,
    })

    const soleH = 2.3
    const cLen = 1.65
    const halfL = 6.7
    const halfW = 3.85
    const segs = 24
    const topRim: Vec2[] = []
    let minIdx = 0
    let maxIdx = 0
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const pt = pFoot(cLen + Math.cos(a) * halfL, Math.sin(a) * halfW, soleH)
      topRim.push(pt)
      if (pt.x < topRim[minIdx].x) minIdx = i
      if (pt.x > topRim[maxIdx].x) maxIdx = i
    }

    // Determine which arc between minIdx and maxIdx is the visible lower/front screen edge!
    const midFwdIdx = ((minIdx + Math.floor(((maxIdx - minIdx + segs) % segs) * 0.5)) % segs)
    const midRevIdx = ((maxIdx + Math.floor(((minIdx - maxIdx + segs) % segs) * 0.5)) % segs)
    const goForward = topRim[midFwdIdx].y >= topRim[midRevIdx].y

    // 1A. Extruded 3D thick sandal sole side wall (wraps cleanly around front toe in Front View & side in Side View!)
    ctx.beginPath()
    ctx.moveTo(topRim[minIdx].x, topRim[minIdx].y)
    ctx.lineTo(topRim[minIdx].x, topRim[minIdx].y + soleH)
    let idx = minIdx
    while (idx !== maxIdx) {
      idx = goForward ? (idx + 1) % segs : (idx - 1 + segs) % segs
      ctx.lineTo(topRim[idx].x, topRim[idx].y + soleH)
    }
    ctx.lineTo(topRim[maxIdx].x, topRim[maxIdx].y)
    // Close back along upper rim
    while (idx !== minIdx) {
      idx = goForward ? (idx - 1 + segs) % segs : (idx + 1) % segs
      ctx.lineTo(topRim[idx].x, topRim[idx].y)
    }
    ctx.closePath()
    ctx.fillStyle = pal.fillShade
    ctx.fill()
    strokeInk(1.42)

    // 1B. Top woven Waraji footbed surface
    ctx.beginPath()
    for (let i = 0; i < segs; i++) {
      if (i === 0) ctx.moveTo(topRim[i].x, topRim[i].y)
      else ctx.lineTo(topRim[i].x, topRim[i].y)
    }
    ctx.closePath()
    ctx.fillStyle = pal.hatFill
    ctx.fill()
    strokeInk(1.25)

    // 1C. 3D Domed Tabi Foot (rises up at instep/ankle, tapers forward to toes, foreshortens in Front/Back view!)
    const tabiSegs = 20
    ctx.beginPath()
    for (let i = 0; i < tabiSegs; i++) {
      const a = (i / tabiSegs) * Math.PI * 2
      const l = 1.25 + Math.cos(a) * 5.15
      const w = Math.sin(a) * 3.05
      const instepLift = clamp((2.9 - l) * 0.36, 0, 2.45)
      const pt = pFoot(l, w, soleH + 0.32 + instepLift)
      if (i === 0) ctx.moveTo(pt.x, pt.y)
      else ctx.lineTo(pt.x, pt.y)
    }
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    strokeInk(1.34)

    // 1D. Authentic V-Shaped Hanao Thong Straps & Split-Toe Tabi Cleft (rotates smoothly in 3D!)
    if (ufy > -0.45) {
      const cleftSide = side * 0.25
      const toeCleft = pFoot(5.1, cleftSide, soleH + 0.55)
      const strapL = pFoot(0.1, -3.1, soleH + 0.45)
      const strapR = pFoot(0.1, 3.1, soleH + 0.45)
      const midSL = pFoot(2.6, -1.6, soleH + 1.85)
      const midSR = pFoot(2.6, 1.6, soleH + 1.85)

      ctx.beginPath()
      ctx.moveTo(toeCleft.x, toeCleft.y)
      ctx.quadraticCurveTo(midSL.x, midSL.y, strapL.x, strapL.y)
      ctx.moveTo(toeCleft.x, toeCleft.y)
      ctx.quadraticCurveTo(midSR.x, midSR.y, strapR.x, strapR.y)
      // Subtle front split-toe tabi notch when facing Front / 3/4-Front!
      if (ufy > 0.28) {
        const tipNotch = pFoot(6.35, cleftSide, soleH + 0.35)
        ctx.moveTo(tipNotch.x, tipNotch.y)
        ctx.lineTo(toeCleft.x, toeCleft.y)
      }
      strokeInk(1.15, pal.ink)
    }
    if (ufy < 0.35) {
      // Rear Waraji heel-tie cords visible in Side & Back views
      const hL = pFoot(-4.2, -2.5, soleH + 0.4)
      const hR = pFoot(-4.2, 2.5, soleH + 0.4)
      const aL = pFoot(-1.6, -2.4, soleH + 2.5)
      const aR = pFoot(-1.6, 2.4, soleH + 2.5)
      ctx.beginPath()
      ctx.moveTo(hL.x, hL.y)
      ctx.lineTo(aL.x, aL.y)
      ctx.moveTo(hR.x, hR.y)
      ctx.lineTo(aR.x, aR.y)
      strokeInk(1.05, pal.ink)
    }

    // 2. Tall Wrapped Kyahan Shin Guard (cuff -> ankle) with 4 crisp cloth wrap bands!
    const sdx = ankle.x - cuff.x
    const sdy = ankle.y - cuff.y
    const slen = Math.hypot(sdx, sdy) || 1
    const snx = -sdy / slen
    const sny = sdx / slen

    ctx.beginPath()
    ctx.moveTo(cuff.x + snx * 3.5, cuff.y + sny * 3.5)
    ctx.lineTo(ankle.x + snx * 2.9, ankle.y + sny * 2.9)
    ctx.lineTo(ankle.x - snx * 2.9, ankle.y - sny * 2.9)
    ctx.lineTo(cuff.x - snx * 3.5, cuff.y - sny * 3.5)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    strokeInk(1.38)

    // 4 Crisp diagonal/horizontal shin wrap lines (exact match to reference!)
    ctx.beginPath()
    for (const frac of [0.18, 0.42, 0.66, 0.86]) {
      const wx = lerp(cuff.x, ankle.x, frac)
      const wy = lerp(cuff.y, ankle.y, frac)
      const r = lerp(3.4, 2.9, frac)
      ctx.moveTo(wx - snx * r, wy - sny * r - 0.5)
      ctx.lineTo(wx + snx * r, wy + sny * r + 0.5)
    }
    strokeInk(1.05, pal.inkMid)

    // 3. Puffy Blouson Hakama Trouser Thigh tucking sharply into shin cuff!
    const tdx = cuff.x - hip.x
    const tdy = cuff.y - hip.y
    const tlen = Math.hypot(tdx, tdy) || 1
    const tnx = -tdy / tlen
    const tny = tdx / tlen
    const midX = lerp(hip.x, cuff.x, 0.58)
    const midY = lerp(hip.y, cuff.y, 0.58)

    ctx.beginPath()
    ctx.moveTo(hip.x + tnx * 5.0, hip.y + tny * 5.0)
    ctx.quadraticCurveTo(midX + tnx * 6.8, midY + tny * 6.8, cuff.x + snx * 4.0, cuff.y + sny * 4.0)
    ctx.lineTo(cuff.x - snx * 4.0, cuff.y - sny * 4.0)
    ctx.quadraticCurveTo(midX - tnx * 5.8, midY - tny * 5.8, hip.x - tnx * 5.0, hip.y - tny * 5.0)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    strokeInk(1.42)
  }

  // --- HELPER: CHUNKY ILLUSTRATED MULTI-FINGER HAND (THUMB + 3 CURLED FINGERS + WRIST CUFF!) ---
  const drawHand25D = (
    pos: Vec2,
    angle: number,
    fill: string,
    style: 'bow-draw' | 'bow-hold' | 'fist',
    flipY = false
  ) => {
    ctx.save()
    ctx.translate(pos.x, pos.y)
    ctx.rotate(angle)
    if (flipY) ctx.scale(1, -1)

    if (style === 'bow-hold') {
      // Front hand wrapping physically around the wooden bow grip (thumb on top + 3 curled fingers!)
      // Thumb arching over top of bow handle
      ctx.beginPath()
      ctx.ellipse(-0.4, -3.6, 2.8, 1.9, -0.25, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      strokeInk(1.28)
      // 3 stacked curled fingers gripping right around the front of the bow stave
      for (const fyOff of [-1.7, 0.5, 2.7]) {
        ctx.beginPath()
        ctx.roundRect(-2.4, fyOff - 1.15, 5.4, 2.3, 1.15)
        ctx.fillStyle = fill
        ctx.fill()
        strokeInk(1.22)
      }
      // Subtle wrist cuff edge on back of grip
      ctx.beginPath()
      ctx.moveTo(-2.6, -2.6)
      ctx.lineTo(-2.6, 3.0)
      strokeInk(1.25)
    } else if (style === 'bow-draw') {
      // Chunky illustrated draw hand pinching the bowstring & arrow nock!
      // Rounded palm body
      ctx.beginPath()
      ctx.roundRect(-3.8, -3.6, 6.2, 7.6, 2.4)
      ctx.fillStyle = fill
      ctx.fill()
      strokeInk(1.35)
      // Distinct raised thumb tucked over the top of the fist
      ctx.beginPath()
      ctx.ellipse(0.2, -3.9, 3.0, 1.85, 0.12, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      strokeInk(1.3)
      // 3 stacked curled finger segments along the front knuckle edge
      for (const fyOff of [-1.4, 0.8, 2.9]) {
        ctx.beginPath()
        ctx.roundRect(0.6, fyOff - 1.05, 3.8, 2.1, 1.0)
        ctx.fillStyle = fill
        ctx.fill()
        strokeInk(1.18)
      }
      // Crisp wrist cuff band
      ctx.beginPath()
      ctx.moveTo(-3.8, -3.4)
      ctx.lineTo(-3.8, 3.6)
      strokeInk(1.45)
    } else {
      // Chunky anime fist with thumb & curled finger creases (for running / sword grip)
      ctx.beginPath()
      ctx.roundRect(-3.0, -3.1, 5.8, 6.2, 2.2)
      ctx.fillStyle = fill
      ctx.fill()
      strokeInk(1.32)
      // Thumb cap
      ctx.beginPath()
      ctx.ellipse(0.0, -3.2, 2.4, 1.45, 0.1, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      strokeInk(1.2)
      // Curled finger divider creases
      ctx.beginPath()
      ctx.moveTo(0.8, -1.0)
      ctx.lineTo(2.9, -1.0)
      ctx.moveTo(0.8, 1.1)
      ctx.lineTo(2.9, 1.1)
      strokeInk(1.05)
    }

    ctx.restore()
  }

  // --- HELPER: ARTICULATED SEGMENTED ARM (UPPER ARM + ROUNDED ELBOW CAP + FOREARM + WRIST CUFF + HAND) ---
  const drawSegmentedArm = (
    sh: Vec2,
    elbow: Vec2,
    hand: Vec2,
    fill: string,
    handStyle: 'bow-draw' | 'bow-hold' | 'fist',
    drawHandNow = true,
    flipHandY = false
  ) => {
    const drawLimbTube = (a: Vec2, b: Vec2, wA: number, wB: number) => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len
      ctx.beginPath()
      ctx.moveTo(a.x + nx * wA, a.y + ny * wA)
      ctx.lineTo(b.x + nx * wB, b.y + ny * wB)
      ctx.lineTo(b.x - nx * wB, b.y - ny * wB)
      ctx.lineTo(a.x - nx * wA, a.y - ny * wA)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      strokeInk(1.38)
    }

    // 1. Upper arm / short kimono sleeve segment
    drawLimbTube(sh, elbow, 3.8, 3.3)

    // 2. Forearm segment tapering slightly to wrist cuff
    drawLimbTube(elbow, hand, 3.2, 2.9)

    // 3. Rounded elbow joint cap (exact match to reference's crisp elbow cap!)
    ctx.beginPath()
    ctx.arc(elbow.x, elbow.y, 3.35, 0, Math.PI * 2)
    ctx.fillStyle = pal.fillShade
    ctx.fill()
    strokeInk(1.35)

    // 4. Multi-finger hand at wrist
    if (drawHandNow) {
      const handAng = Math.atan2(hand.y - elbow.y, hand.x - elbow.x)
      drawHand25D(hand, handAng, fill, handStyle, flipHandY)
    }
  }

  // --- HELPER: 2.5D ARM FOR SWORD / IDLE / RUN ---
  const drawArm25D = (side: -1 | 1, swing: number, isBack: boolean) => {
    const fill = isBack ? pal.fillBack : pal.fillMain
    const sh = proj(leanFwd * 0.72, side * 9.5, shoulderZ - 1.8)
    const handFwd = leanFwd * 0.55 + swing * 8.5 + (side === 1 ? 4.0 : 1.5)
    const handLat = side * 10.6
    const handZ = chestZ - 7.0 + Math.abs(swing) * 2.4
    const hand = proj(handFwd, handLat, handZ)
    const elbow = proj(
      lerp(leanFwd * 0.72, handFwd, 0.48) - 2.2,
      side * 11.2,
      lerp(shoulderZ - 1.8, handZ, 0.52) - 0.8
    )
    const flipY = hand.x < elbow.x
    drawSegmentedArm(sh, elbow, hand, fill, 'fist', true, flipY)
  }

  // --- HELPER: TWO-HANDED YUMI BOW ARCHERY POSE (EXACT MATCH TO REFERENCE!) ---
  const drawBowArchery25D = () => {
    const recoil = clamp(opts.bowRecoil ?? 0, 0, 1)
    const bowZ = chestZ - 2.2
    const bowGrip = proj(20.5 + leanFwd * 0.3, 0, bowZ)
    const drawPt = proj(4.2 + leanFwd * 0.3 - recoil * 4.5, 0, bowZ)
    const aimAng = Math.atan2(bowGrip.y - drawPt.y, bowGrip.x - drawPt.x)
    const aimFlip = Math.cos(aimAng) < 0

    // Front (bow-holding) arm reaches straight out to grip the bow handle
    const bowSh = proj(leanFwd * 0.65, -8.5, shoulderZ - 2.0)
    const bowElbow = proj(10.0 + leanFwd * 0.4, -6.5, bowZ - 0.5)

    // Back (string-drawing) arm pulls back to a distinct bent elbow, forearm straight across chest to arrow nock!
    const drawSh = proj(leanFwd * 0.55, 8.8, shoulderZ - 2.0)
    const drawElbow = proj(-8.2 + leanFwd * 0.3, 8.6, bowZ - 0.8)

    // 1. Front bow arm shaft (drawn behind the bow stave so fingers wrap around in front!)
    drawSegmentedArm(bowSh, bowElbow, bowGrip, pal.fillBack, 'bow-hold', false, aimFlip)

    // 2. Curved Wooden Yumi War Bow, Taut Bowstring & Arrow
    const topTip = { x: bowGrip.x - fx * 6.5, y: bowGrip.y - 18.5 }
    const botTip = { x: bowGrip.x - fx * 5.5, y: bowGrip.y + 16.5 }

    ctx.save()
    // Taut bowstring pulled straight back to the draw hand's fingers!
    ctx.beginPath()
    ctx.moveTo(topTip.x, topTip.y)
    ctx.lineTo(drawPt.x, drawPt.y)
    ctx.lineTo(botTip.x, botTip.y)
    strokeInk(1.3, pal.ink)

    // Bold dark-wood curved bow stave with crisp dark ink outline
    const bowCtrlTop = { x: bowGrip.x + fx * 3.8, y: bowGrip.y - 10.0 }
    const bowCtrlBot = { x: bowGrip.x + fx * 3.5, y: bowGrip.y + 9.0 }
    ctx.beginPath()
    ctx.moveTo(topTip.x, topTip.y)
    ctx.quadraticCurveTo(bowCtrlTop.x, bowCtrlTop.y, bowGrip.x, bowGrip.y)
    ctx.quadraticCurveTo(bowCtrlBot.x, bowCtrlBot.y, botTip.x, botTip.y)
    strokeInk(6.0, pal.ink)
    ctx.beginPath()
    ctx.moveTo(topTip.x, topTip.y)
    ctx.quadraticCurveTo(bowCtrlTop.x, bowCtrlTop.y, bowGrip.x, bowGrip.y)
    ctx.quadraticCurveTo(bowCtrlBot.x, bowCtrlBot.y, botTip.x, botTip.y)
    strokeInk(3.6, '#6e4726')

    // Nocked Bamboo Arrow running straight from draw hand through bow grip to bold broadhead tip!
    if (opts.hasArrows !== false) {
      const tipPt = proj(33.5 + leanFwd * 0.3 - recoil * 2.5, 0, bowZ)
      const fletchPt = proj(8.5 + leanFwd * 0.3 - recoil * 4.0, 0, bowZ)

      // Olive-sage / crimson feather fletching right at the draw hand
      ctx.save()
      ctx.translate(fletchPt.x, fletchPt.y)
      ctx.rotate(aimAng)
      ctx.fillStyle = '#9aa864'
      ctx.beginPath()
      ctx.moveTo(2.5, 0)
      ctx.lineTo(-4.5, -3.2)
      ctx.lineTo(-6.2, 0)
      ctx.lineTo(-4.5, 3.2)
      ctx.closePath()
      ctx.fill()
      strokeInk(1.1)
      ctx.restore()

      // Thick dark-wood arrow shaft
      ctx.beginPath()
      ctx.moveTo(drawPt.x, drawPt.y)
      ctx.lineTo(tipPt.x, tipPt.y)
      strokeInk(3.2, pal.ink)
      ctx.beginPath()
      ctx.moveTo(drawPt.x, drawPt.y)
      ctx.lineTo(tipPt.x, tipPt.y)
      strokeInk(1.7, '#6e4726')

      // Bold dark-slate triangular steel arrowhead
      ctx.save()
      ctx.translate(tipPt.x, tipPt.y)
      ctx.rotate(aimAng)
      ctx.fillStyle = '#333b4a'
      ctx.beginPath()
      ctx.moveTo(7.2, 0)
      ctx.lineTo(-2.0, -3.8)
      ctx.lineTo(-1.0, 0)
      ctx.lineTo(-2.0, 3.8)
      ctx.closePath()
      ctx.fill()
      strokeInk(1.2)
      ctx.restore()
    }
    ctx.restore()

    // 3. Front Bow Hand fingers wrapping right OVER the bow handle & arrow shaft!
    drawHand25D(bowGrip, aimAng, pal.fillMain, 'bow-hold', aimFlip)

    // 4. Back Draw Arm, distinct rounded Elbow Cap & Multi-Finger Draw Hand gripping the bowstring!
    drawSegmentedArm(drawSh, drawElbow, drawPt, pal.fillMain, 'bow-draw', true, aimFlip)
  }

  // --- HELPER: BACK KATANA HILT & ARROW QUIVER ---
  const drawBackGear25D = () => {
    // Back Katana hilt rising behind right shoulder (compact, proportional!)
    const katBase = proj(-4.2 + leanFwd * 0.45, 5.0, shoulderZ - 1.5)
    ctx.save()
    ctx.translate(katBase.x, katBase.y)
    ctx.rotate(fx * 0.24 + 0.14)
    ctx.beginPath()
    ctx.roundRect(-1.4, -10.5, 2.8, 10.2, 0.9)
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(1.18)
    ctx.beginPath()
    ctx.ellipse(0, -1.2, 3.6, 1.3, 0, 0, Math.PI * 2)
    ctx.fillStyle = pal.fillShade
    ctx.fill()
    strokeInk(1.15)
    ctx.restore()

    // Back Arrow Quiver when War Bow is owned
    if (opts.gear?.warBow) {
      const qBase = proj(-5.0 + leanFwd * 0.45, -5.8, shoulderZ - 3.5)
      ctx.save()
      ctx.translate(qBase.x, qBase.y)
      ctx.rotate(-0.28)
      ctx.fillStyle = '#755b3c'
      ctx.beginPath()
      ctx.roundRect(-3.4, -5.5, 6.8, 12.5, 2)
      ctx.fill()
      strokeInk(1.2)
      for (const ax of [-1.8, 0, 1.8]) {
        ctx.beginPath()
        ctx.moveTo(ax, -5.5)
        ctx.lineTo(ax, -11.5)
        strokeInk(1.3, '#b84239')
      }
      ctx.restore()
    }
  }

  // --- HELPER: KIMONO TORSO + IVORY OBI SASH + NECK WRAP COLLAR ---
  const drawTorso25D = () => {
    const hipC = proj(leanFwd * 0.25, 0, hipZ)
    const shC = proj(leanFwd * 0.78, 0, shoulderZ)
    const shHalfW = 8.6 + Math.abs(fy) * 2.0
    const hipHalfW = 7.8 + Math.abs(fy) * 1.4

    ctx.beginPath()
    ctx.moveTo(shC.x - shHalfW, shC.y)
    ctx.quadraticCurveTo(shC.x, shC.y - 2.4, shC.x + shHalfW, shC.y)
    ctx.quadraticCurveTo(lerp(shC.x, hipC.x, 0.5) + shHalfW * 0.96, lerp(shC.y, hipC.y, 0.5), hipC.x + hipHalfW, hipC.y + 1.5)
    ctx.quadraticCurveTo(hipC.x, hipC.y + 3.8, hipC.x - hipHalfW, hipC.y + 1.5)
    ctx.quadraticCurveTo(lerp(shC.x, hipC.x, 0.5) - shHalfW * 0.96, lerp(shC.y, hipC.y, 0.5), shC.x - shHalfW, shC.y)
    ctx.closePath()
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(1.45)

    // Crossed Kimono V-Lapel when visible from front/side
    if (!facingNorth) {
      const lapX = fx * 2.4
      ctx.beginPath()
      ctx.moveTo(shC.x - 3.6 + lapX, shC.y + 0.5)
      ctx.lineTo(hipC.x + 1.8 + lapX * 0.7, hipC.y - 3.5)
      ctx.moveTo(shC.x + 3.6 + lapX, shC.y + 0.5)
      ctx.lineTo(hipC.x - 1.2 + lapX * 0.7, hipC.y - 5.5)
      strokeInk(1.0, pal.inkMid)
    }

    // Wrapped Ivory Obi Sash around waist
    const obiY = hipC.y - 1.5
    ctx.beginPath()
    ctx.moveTo(hipC.x - hipHalfW - 0.5, obiY - 2.4)
    ctx.quadraticCurveTo(hipC.x, obiY - 0.8, hipC.x + hipHalfW + 0.5, obiY - 2.4)
    ctx.lineTo(hipC.x + hipHalfW + 0.3, obiY + 3.4)
    ctx.quadraticCurveTo(hipC.x, obiY + 5.0, hipC.x - hipHalfW - 0.3, obiY + 3.4)
    ctx.closePath()
    ctx.fillStyle = pal.fillShade
    ctx.fill()
    strokeInk(1.38)

    // Horizontal obi crease
    ctx.beginPath()
    ctx.moveTo(hipC.x - hipHalfW, obiY + 0.6)
    ctx.quadraticCurveTo(hipC.x, obiY + 2.0, hipC.x + hipHalfW, obiY + 0.6)
    strokeInk(0.92, pal.inkMid)

    // Neck Wrap / Cloak Collar Yoke (matches reference's clean rolled collar under the kasa hat!)
    if (opts.showCloak) {
      ctx.beginPath()
      ctx.ellipse(shC.x, shC.y - 0.2, shHalfW + 1.0, 4.0, 0, 0, Math.PI * 2)
      ctx.fillStyle = opts.gear?.crimsonScarf
        ? '#b84239'
        : opts.gear?.shadowCloak
          ? '#393b42'
          : pal.fillMain
      ctx.fill()
      strokeInk(1.38)
    }

    // Tall Mandarin Stand Collar
    ctx.beginPath()
    ctx.roundRect(shC.x - 4.4, shC.y - 5.2, 8.8, 5.8, 2.0)
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(1.3)
  }

  // --- HELPER: ANGLED WAIST KATANA SCABBARD AT HIP HEIGHT (COMPACT & PROPORTIONAL!) ---
  const drawWaistKatana25D = () => {
    const hipL = proj(leanFwd * 0.2, -7.4, hipZ + 1.5)
    const tipBack = proj(-17.5 + leanFwd * 0.2, -9.6, hipZ - 3.2)
    const hiltFwd = proj(10.5 + leanFwd * 0.2, -6.0, hipZ + 3.8)

    // Scabbard body
    ctx.beginPath()
    ctx.moveTo(tipBack.x, tipBack.y)
    ctx.lineTo(hipL.x, hipL.y)
    strokeInk(3.6, pal.ink)
    ctx.beginPath()
    ctx.moveTo(tipBack.x, tipBack.y)
    ctx.lineTo(hipL.x, hipL.y)
    strokeInk(1.9, pal.fillMain)

    // Sheathed tsuba + tsuka hilt extending forward when not slashing
    if (rig.katanaDraw < 0.25) {
      ctx.save()
      ctx.globalAlpha = 1 - rig.katanaDraw / 0.25
      ctx.beginPath()
      ctx.moveTo(hipL.x, hipL.y)
      ctx.lineTo(hiltFwd.x, hiltFwd.y)
      strokeInk(3.0, pal.ink)
      ctx.beginPath()
      ctx.moveTo(hipL.x, hipL.y)
      ctx.lineTo(hiltFwd.x, hiltFwd.y)
      strokeInk(1.5, pal.fillShade)
      ctx.beginPath()
      ctx.arc(hipL.x, hipL.y, 2.2, 0, Math.PI * 2)
      ctx.fillStyle = pal.fillShade
      ctx.fill()
      strokeInk(1.0)
      ctx.restore()
    }
  }

  // --- HELPER: 4-MOVE KENJUTSU KATANA SLASH POSE (ARMS + MULTI-FINGER HANDS PHYSICALLY GRIPPING THE HILT!) ---
  const isKatanaSlashing = opts.activeWeapon !== 'bow' && rig.katanaDraw >= 0.12
  const slashVariant = ((rig.slashVariant % 4) + 4) % 4
  const slashEase =
    rig.slashProg < 0.15
      ? 0
      : rig.slashProg < 0.56
        ? 1 - Math.pow(1 - (rig.slashProg - 0.15) / 0.41, 3)
        : 1.0

  const drawKatanaBladeAt = (hilt: Vec2, bladeAngle: number, bladeScaleLen = 1.0) => {
    ctx.save()
    ctx.globalAlpha = clamp(rig.katanaDraw, 0, 1)
    ctx.translate(hilt.x, hilt.y)
    ctx.rotate(bladeAngle)
    // Hilt & Guard (grip sits right at (0, 0) inside the Samurai's hand!)
    ctx.beginPath()
    ctx.roundRect(-8.8, -1.5, 11.2, 3.0, 1.0)
    ctx.fillStyle = pal.fillShade
    ctx.fill()
    strokeInk(1.15)
    ctx.beginPath()
    ctx.ellipse(2.6, 0, 1.4, 3.9, 0, 0, Math.PI * 2)
    ctx.fillStyle = pal.fillMain
    ctx.fill()
    strokeInk(1.15)
    // Sleek proportional curved steel katana blade (radiant silver-blue when Moonlight Blade is equipped!)
    const bLen = (opts.gear?.moonlightBlade ? 38 : 31) * bladeScaleLen
    ctx.beginPath()
    ctx.moveTo(3.9, -1.35)
    ctx.quadraticCurveTo(bLen * 0.52, -2.5, bLen, -1.1)
    ctx.quadraticCurveTo(bLen + 3.6, -0.2, bLen, 0.9)
    ctx.quadraticCurveTo(bLen * 0.52, 0.25, 3.9, 1.35)
    ctx.closePath()
    ctx.fillStyle = opts.gear?.moonlightBlade ? '#eef4ff' : pal.bladeLight
    ctx.fill()
    strokeInk(1.22, opts.gear?.moonlightBlade ? '#3e538c' : pal.ink)
    ctx.restore()
  }

  const drawKatanaSlash25D = (layer: 'body' | 'overhead-high') => {
    if (!isKatanaSlashing) return
    const isOverheadRaised = slashVariant === 2 && slashEase < 0.42
    if (layer === 'overhead-high' && !isOverheadRaised) return
    if (layer === 'body' && isOverheadRaised) return

    const shR = proj(leanFwd * 0.72, 9.5, shoulderZ - 1.8)
    const shL = proj(leanFwd * 0.72, -9.5, shoulderZ - 1.8)

    if (slashVariant === 0) {
      // STRIKE 1: Wide Forehand Cross-Cut (upper-right -> lower-left)
      const hFwd = lerp(2.0, 16.0, slashEase) + Math.sin(slashEase * Math.PI) * 9.0
      const hLat = lerp(17.5, -17.0, slashEase)
      const hZ = lerp(chestZ + 5.5, chestZ - 7.5, slashEase)
      const hilt = proj(hFwd, hLat, hZ)
      const elbow = proj(lerp(-3.0, 6.0, slashEase), lerp(16.5, -4.0, slashEase), lerp(chestZ + 3.0, chestZ - 4.0, slashEase))
      const bladeAng = rig.heading + lerp(-1.6, 1.48, slashEase)
      const offHand = proj(-4.5, -12.5, chestZ - 5.0)
      const offElbow = proj(-8.0, -12.0, chestZ - 1.5)

      drawSegmentedArm(shL, offElbow, offHand, pal.fillBack, 'fist', true, offHand.x < offElbow.x)
      drawSegmentedArm(shR, elbow, hilt, pal.fillMain, 'bow-draw', false, hilt.x < elbow.x)
      drawKatanaBladeAt(hilt, bladeAng, 1.0)
      drawHand25D(hilt, bladeAng, pal.fillMain, 'bow-hold', Math.cos(bladeAng) < 0)
    } else if (slashVariant === 1) {
      // STRIKE 2: Rising Backhand Uppercut (lower-left -> upper-right)
      const hFwd = lerp(3.0, 16.5, slashEase) + Math.sin(slashEase * Math.PI) * 8.5
      const hLat = lerp(-17.0, 18.0, slashEase)
      const hZ = lerp(chestZ - 9.0, chestZ + 9.0, slashEase)
      const hilt = proj(hFwd, hLat, hZ)
      const elbow = proj(lerp(-1.0, 8.0, slashEase), lerp(-10.0, 15.0, slashEase), lerp(chestZ - 5.5, chestZ + 3.0, slashEase))
      const bladeAng = rig.heading + lerp(1.6, -1.48, slashEase)
      const offHand = proj(-5.0, -11.5, chestZ - 3.0)
      const offElbow = proj(-9.0, -11.0, chestZ)

      drawSegmentedArm(shL, offElbow, offHand, pal.fillBack, 'fist', true, offHand.x < offElbow.x)
      drawSegmentedArm(shR, elbow, hilt, pal.fillMain, 'bow-draw', false, hilt.x < elbow.x)
      drawKatanaBladeAt(hilt, bladeAng, 1.0)
      drawHand25D(hilt, bladeAng, pal.fillMain, 'bow-hold', Math.cos(bladeAng) < 0)
    } else if (slashVariant === 2) {
      // STRIKE 3: High Two-Handed Overhead Vertical Helm-Splitter (raised high above Kasa hat -> chopped down!)
      const hFwd = lerp(2.0, 21.0, slashEase) + Math.sin(slashEase * Math.PI) * 6.0
      const hZ = lerp(headZ + 18.5, chestZ - 11.5, slashEase)
      const hilt = proj(hFwd, 0, hZ)
      const offHilt = proj(hFwd - 4.0, -2.5, hZ + 1.5)
      const elR = proj(lerp(0, 10, slashEase), 10.5, lerp(headZ + 5, chestZ - 2, slashEase))
      const elL = proj(lerp(0, 9, slashEase), -10.5, lerp(headZ + 5, chestZ - 2, slashEase))
      const faceSign = fx >= -0.05 ? 1 : -1
      // Blade rotates cleanly in vertical chop plane from pointing back-up to chopping forward-down!
      const chopAng =
        faceSign >= 0
          ? lerp(-2.35, 0.58, slashEase)
          : lerp(-0.79, Math.PI - 0.58, slashEase)

      drawSegmentedArm(shL, elL, offHilt, pal.fillBack, 'bow-hold', false, false)
      drawSegmentedArm(shR, elR, hilt, pal.fillMain, 'bow-hold', false, false)
      drawKatanaBladeAt(hilt, chopAng, 1.06)
      drawHand25D(offHilt, chopAng, pal.fillBack, 'bow-hold', faceSign < 0)
      drawHand25D(hilt, chopAng, pal.fillMain, 'bow-hold', faceSign < 0)
    } else {
      // STRIKE 4: Two-Handed Lightning Piercing Forward Thrust (hip pull -> razor-sharp lance forward!)
      const hFwd = lerp(-5.0, 26.5, slashEase)
      const hZ = chestZ - 3.5
      const hilt = proj(hFwd, 1.5, hZ)
      const offHilt = proj(hFwd - 6.5, -1.5, hZ)
      const elR = proj(lerp(-11.0, 9.0, slashEase), 10.5, hZ - 1.0)
      const elL = proj(lerp(-10.0, 7.0, slashEase), -10.0, hZ - 1.0)
      const thrustAng = rig.heading

      drawSegmentedArm(shL, elL, offHilt, pal.fillBack, 'bow-hold', false, Math.cos(thrustAng) < 0)
      drawSegmentedArm(shR, elR, hilt, pal.fillMain, 'bow-hold', false, Math.cos(thrustAng) < 0)
      drawKatanaBladeAt(hilt, thrustAng, 1.18)
      drawHand25D(offHilt, thrustAng, pal.fillBack, 'bow-hold', Math.cos(thrustAng) < 0)
      drawHand25D(hilt, thrustAng, pal.fillMain, 'bow-hold', Math.cos(thrustAng) < 0)
    }
  }

  // --- HELPER: HEAD, SHADOWED ANIME FACE / NAPE HAIR & BOLD PINCHED-PEAK CONICAL KASA HAT ---
  const drawHeadAndHat25D = () => {
    const headC = proj(leanFwd * 0.92, 0, headZ)

    // Head base & jaw/chin peeking beneath the elevated kasa brim
    ctx.beginPath()
    ctx.arc(headC.x, headC.y, 7.2, 0, Math.PI * 2)
    ctx.fillStyle = facingNorth ? pal.hairFill : pal.fillMain
    ctx.fill()
    strokeInk(1.32)

    if (!facingNorth) {
      // Short dark side locks / nape hair framing face
      ctx.fillStyle = pal.hairFill
      ctx.beginPath()
      ctx.arc(headC.x - fx * 2.2, headC.y - 1.2, 6.4, Math.PI * 0.85, Math.PI * 2.15)
      ctx.fill()
      strokeInk(1.0)

      // Subtle brow shadow band under hat brim
      ctx.fillStyle = pal.browShadow
      ctx.beginPath()
      ctx.ellipse(headC.x + fx * 1.4, headC.y - 1.2, 6.2, 2.5, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    if (opts.showHat) {
      // Bold Conical Kasa Hat (matches reference's clean wide cone, straight bamboo ribs & dark brim underside!)
      const hatX = headC.x + rig.hatShiftX * 0.25
      const hatY = headC.y - 3.4 + rig.hatShiftY * 0.14
      const brimRX = 23.0
      const brimRY = 10.2
      const peakX = hatX + rig.hatShiftX * 0.34
      const peakY = hatY - 15.2 + rig.hatShiftY * 0.12

      // Hat underside dark shadow rim
      ctx.beginPath()
      ctx.ellipse(hatX, hatY + 1.5, brimRX * 0.95, brimRY * 0.84, 0, 0, Math.PI * 2)
      ctx.fillStyle = pal.hatUnder
      ctx.fill()
      strokeInk(1.35)

      // Conical hat silhouette
      ctx.beginPath()
      ctx.moveTo(peakX, peakY)
      ctx.bezierCurveTo(peakX - 4, peakY + 5, hatX - 12, hatY - 5, hatX - brimRX, hatY)
      ctx.ellipse(hatX, hatY, brimRX, brimRY, 0, Math.PI, 0, true)
      ctx.bezierCurveTo(hatX + 12, hatY - 5, peakX + 4, peakY + 5, peakX, peakY)
      ctx.closePath()
      ctx.fillStyle = pal.hatFill
      ctx.fill()
      strokeInk(1.62, opts.gear?.galeHat ? '#9b7428' : pal.ink)

      // Subtle top-rim shade band matching reference
      ctx.beginPath()
      ctx.moveTo(peakX, peakY)
      ctx.lineTo(hatX - brimRX * 0.95, hatY)
      ctx.quadraticCurveTo(hatX - 6, hatY + brimRY * 0.85, hatX, hatY + brimRY * 0.95)
      ctx.closePath()
      ctx.fillStyle = 'rgba(68, 66, 60, 0.065)'
      ctx.fill()

      // Gleaming woven gold rim band when Gale Straw Hat is equipped
      if (opts.gear?.galeHat) {
        ctx.beginPath()
        ctx.ellipse(hatX, hatY, brimRX - 0.8, brimRY - 0.6, 0, 0.08, Math.PI - 0.08)
        strokeInk(2.1, '#e5be62')
      }

      // Crisp radial bamboo ribs converging cleanly to the rounded top cap
      ctx.beginPath()
      for (const a of [0.18, 0.72, 1.24, 1.88, 2.42, 2.94]) {
        const bx = hatX + Math.cos(a) * brimRX * 0.96
        const by = hatY + Math.sin(a) * brimRY * 0.96
        ctx.moveTo(peakX, peakY + 1.4)
        ctx.lineTo(bx, by)
      }
      strokeInk(0.92, pal.inkSoft)

      // Rounded bamboo top knot cap
      ctx.beginPath()
      ctx.arc(peakX, peakY + 0.4, 2.7, 0, Math.PI * 2)
      ctx.fillStyle = pal.fillShade
      ctx.fill()
      strokeInk(1.38)
    }
  }

  // --- DEPTH-SORTED 2.5D ASSEMBLY ---
  const leftLegY = (rig.footL * fy - 5.8 * ry) * DEPTH_Y
  const rightLegY = (rig.footR * fy + 5.8 * ry) * DEPTH_Y
  const leftFirst = leftLegY <= rightLegY

  const leftArmY = -9.5 * ry * DEPTH_Y
  const rightArmY = 9.5 * ry * DEPTH_Y
  const leftArmBack = leftArmY <= rightArmY

  if (facingNorth) {
    // Facing North/Away: weapon/bow ahead -> legs -> arms -> torso -> waist katana -> cloak over back -> back gear -> head & hat
    if (opts.activeWeapon === 'bow') {
      drawBowArchery25D()
    } else if (isKatanaSlashing) {
      drawKatanaSlash25D('body')
    }
    if (leftFirst) {
      drawLeg25D(-1, rig.footL, rig.footLiftL, true)
      drawLeg25D(1, rig.footR, rig.footLiftR, false)
    } else {
      drawLeg25D(1, rig.footR, rig.footLiftR, true)
      drawLeg25D(-1, rig.footL, rig.footLiftL, false)
    }
    if (opts.activeWeapon !== 'bow' && !isKatanaSlashing) {
      drawArm25D(-1, -armPump * 0.65, true)
      drawArm25D(1, armPump, false)
    }
    drawTorso25D()
    drawWaistKatana25D()
    drawCloak25D()
    drawBackGear25D()
    drawHeadAndHat25D()
    if (isKatanaSlashing) {
      drawKatanaSlash25D('overhead-high')
    }
  } else {
    // Facing South / Side / Diagonals: cloak behind -> back gear -> back arm -> legs -> torso -> waist katana -> front arm / two-handed bow / katana slash -> head & hat
    drawCloak25D()
    drawBackGear25D()
    if (opts.activeWeapon !== 'bow' && !isKatanaSlashing) {
      if (leftArmBack) {
        drawArm25D(-1, -armPump * 0.65, true)
      } else {
        drawArm25D(1, armPump, true)
      }
    }
    if (leftFirst) {
      drawLeg25D(-1, rig.footL, rig.footLiftL, true)
      drawLeg25D(1, rig.footR, rig.footLiftR, false)
    } else {
      drawLeg25D(1, rig.footR, rig.footLiftR, true)
      drawLeg25D(-1, rig.footL, rig.footLiftL, false)
    }
    drawTorso25D()
    drawWaistKatana25D()
    if (opts.activeWeapon === 'bow') {
      drawBowArchery25D()
    } else if (isKatanaSlashing) {
      drawKatanaSlash25D('body')
    } else {
      if (leftArmBack) {
        drawArm25D(1, armPump, false)
      } else {
        drawArm25D(-1, -armPump * 0.65, false)
      }
    }
    drawHeadAndHat25D()
    if (isKatanaSlashing) {
      drawKatanaSlash25D('overhead-high')
    }
  }

  // Optional debug heading + rig overlay
  if (opts.showRig) {
    const fL = proj(rig.footL * 1.18, -5.6, rig.footLiftL * 6.5)
    const fR = proj(rig.footR * 1.18, 5.6, rig.footLiftR * 6.5)
    const aimTip = proj(34, 0, chestZ - 2)
    const aimBase = proj(0, 0, chestZ - 2)
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(aimBase.x, aimBase.y)
    ctx.lineTo(aimTip.x, aimTip.y)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(0, 0, 2.4, 0, Math.PI * 2)
    ctx.arc(fL.x, fL.y, 2.2, 0, Math.PI * 2)
    ctx.arc(fR.x, fR.y, 2.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  ctx.restore()
}

