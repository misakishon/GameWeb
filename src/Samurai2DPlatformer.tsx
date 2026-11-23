import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createSamuraiRig,
  resetSamuraiCloth,
  stepSamuraiRig,
  drawSamuraiRig,
  createSamuraiTopDownRig,
  resetSamuraiTopDownCloth,
  stepSamuraiTopDown,
  drawSamuraiTopDown,
  clamp,
  damp,
  type SamuraiAnimMode,
  type SamuraiGear,
  type Vec2,
} from './samuraiRig'
import SamuraiPovShop, { type ShopItem } from './SamuraiPovShop'

type LockedMode = 'Idle' | 'Walk' | 'Run' | null
type PaperTone = 'white' | 'studio'
type CameraView = 'birds-eye' | 'oblique-34'

// Merchant Stall right in the NW Courtyard Plaza (immediately visible on load!)
const SHOP_POS: Vec2 = { x: -135, y: -110 }
const SHOP_INTERACT_RADIUS = 115

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
  kind: 'dust' | 'leaf' | 'spark' | 'afterimage' | 'gold-petal'
  rot: number
  vrot: number
}

interface FloatingText {
  x: number
  y: number
  text: string
  color: string
  age: number
  duration: number
}

interface MapCoin {
  x: number
  y: number
  value: number
  collected: boolean
  respawnTimer: number
  phase: number
}

interface BambooDummy {
  x: number
  y: number
  cutTimer: number
  hitAngle: number
}

interface SlashArc {
  x: number
  y: number
  angle: number
  age: number
  duration: number
  variant: number
  moonlight?: boolean
}

interface ArrowProjectile {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  age: number
  maxAge: number
  focusBoost: boolean
}

interface AttackBox {
  x: number
  y: number
  angle: number
  length: number
  halfWidth: number
  age: number
  duration: number
  hit: boolean
}

interface TreeCanopy {
  x: number
  y: number
  r: number
  kind: 'bamboo' | 'pine' | 'maple'
  seed: number
}

interface StoneSlab {
  x: number
  y: number
  w: number
  h: number
  rot: number
  seed: number
}

function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123
  return s - Math.floor(s)
}

function handDrift(pos: number, seed: number, amp = 1.4): number {
  return (
    (Math.sin(pos * 0.035 + seed * 3.7) * 0.55 +
      Math.sin(pos * 0.092 + seed * 7.1) * 0.30 +
      Math.sin(pos * 0.21 + seed * 11.3) * 0.15) *
    amp
  )
}

function createPaperGrainCanvas(baseHex: string): HTMLCanvasElement {
  const size = 256
  const off = document.createElement('canvas')
  off.width = size
  off.height = size
  const octx = off.getContext('2d')!
  octx.fillStyle = baseHex
  octx.fillRect(0, 0, size, size)
  for (let i = 0; i < 3600; i++) {
    const x = hash1(i * 1.13) * size
    const y = hash1(i * 2.71 + 19) * size
    octx.fillStyle = hash1(i * 4.17) > 0.5 ? 'rgba(20,20,22,0.024)' : 'rgba(255,255,255,0.20)'
    octx.fillRect(x, y, 1.5, 1.5)
  }
  return off
}

const WORLD_LIMIT = 1150

const STEPPING_STONES: StoneSlab[] = (() => {
  const stones: StoneSlab[] = []
  let idx = 1
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
  for (let y = -155; y >= -560; y -= 52) {
    const curveX = Math.sin(y * 0.008) * 28
    stones.push({
      x: curveX + (hash1(idx * 1.9) - 0.5) * 14,
      y,
      w: 44 + hash1(idx * 2.3) * 14,
      h: 28 + hash1(idx * 4.1) * 8,
      rot: (hash1(idx * 7.1) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  for (let y = 155; y <= 520; y += 54) {
    const curveX = Math.sin(y * 0.007) * 34
    stones.push({
      x: curveX + (hash1(idx * 1.9) - 0.5) * 14,
      y,
      w: 44 + hash1(idx * 2.3) * 14,
      h: 28 + hash1(idx * 4.1) * 8,
      rot: (hash1(idx * 7.1) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  for (let x = 150; x <= 620; x += 52) {
    if (x > 250 && x < 450) continue
    const curveY = Math.sin(x * 0.007) * 24
    stones.push({
      x,
      y: curveY + (hash1(idx * 2.7) - 0.5) * 10,
      w: 34 + hash1(idx * 3.7) * 12,
      h: 36 + hash1(idx * 5.1) * 10,
      rot: (hash1(idx * 6.3) - 0.5) * 0.22,
      seed: idx++,
    })
  }
  for (let x = -150; x >= -560; x -= 52) {
    const curveY = Math.cos(x * 0.006) * 22
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
})()

const TREES: TreeCanopy[] = [
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
]

const LANTERNS: Vec2[] = [
  { x: 92, y: -130 },
  { x: -92, y: 130 },
  { x: 92, y: 130 },
  { x: 228, y: -56 },
  { x: 228, y: 56 },
  { x: 470, y: -56 },
  { x: 470, y: 56 },
]

const ZEN_ROCKS: { x: number; y: number; r: number; seed: number }[] = [
  { x: -360, y: -68, r: 20, seed: 101 },
  { x: -285, y: 62, r: 16, seed: 107 },
]

const TORII_PILLARS: { x: number; y: number; r: number }[] = [
  { x: -56, y: -386, r: 10 },
  { x: 56, y: -386, r: 10 },
]

const PLAYER_COLLIDER_R = 14
const POND_CENTER: Vec2 = { x: 350, y: 0 }
const BRIDGE_WALK = { minX: 236, maxX: 464, halfH: 19, deckHalfH: 26 }

function getPondBoundary(angle: number): { x: number; y: number; rx: number; ry: number } {
  const norm = (((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
  const seg = norm * 40
  const rx = 112 + Math.sin(angle * 3) * 14 + handDrift(seg * 15, 77, 4)
  const ry = 175 + Math.cos(angle * 2) * 18 + handDrift(seg * 15, 83, 4)
  return {
    x: POND_CENTER.x + Math.cos(angle) * rx,
    y: POND_CENTER.y + Math.sin(angle) * ry,
    rx,
    ry,
  }
}

function getTreeColliderRadius(tr: TreeCanopy): number {
  return Math.round(tr.r * 0.52)
}

export default function Samurai2DPlatformer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const keysRef = useRef<Record<string, boolean>>({})
  const virtualRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })

  const [animState, setAnimState] = useState<SamuraiAnimMode>('Idle')
  const [lockedMode, setLockedMode] = useState<LockedMode>(null)
  const [cameraView, setCameraView] = useState<CameraView>('birds-eye')
  const [paperTone, setPaperTone] = useState<PaperTone>('white')
  const [sprintToggle, setSprintToggle] = useState(true)
  const [showHat, setShowHat] = useState(true)
  const [showCloak, setShowCloak] = useState(true)
  const [showBg, setShowBg] = useState(true)
  const [showRig, setShowRig] = useState(false)
  const [showHitboxes, setShowHitboxes] = useState(false)
  const [showMinimap, setShowMinimap] = useState(true)
  const [speedScale, setSpeedScale] = useState(1.0)
  const [hudStats, setHudStats] = useState({ speed: 0, x: 0, y: 0, fps: 60, nearShop: false, focusSec: 0 })

  // Shop, Weapon Switch Skill & Economy State
  const [coins, setCoins] = useState(120)
  const [arrows, setArrows] = useState(0)
  const [activeWeapon, setActiveWeapon] = useState<'sword' | 'bow'>('sword')
  const [shopOpen, setShopOpen] = useState(false)
  const [shopMsg, setShopMsg] = useState('Welcome, wandering blade! Browse my hand-forged wares.')
  const [ownedItems, setOwnedItems] = useState<Record<string, boolean>>({})
  const [equippedGear, setEquippedGear] = useState<SamuraiGear & { spiritBell?: boolean }>({})

  const lockedRef = useRef<LockedMode>(null)
  const cameraViewRef = useRef<CameraView>('birds-eye')
  const paperToneRef = useRef<PaperTone>('white')
  const sprintToggleRef = useRef(true)
  const showHatRef = useRef(true)
  const showCloakRef = useRef(true)
  const showBgRef = useRef(true)
  const showRigRef = useRef(false)
  const showHitboxesRef = useRef(false)
  const showMinimapRef = useRef(true)
  const speedScaleRef = useRef(1.0)
  const shopOpenRef = useRef(false)
  const gearRef = useRef<SamuraiGear & { spiritBell?: boolean }>({})
  const bowUnlockedRef = useRef(false)
  const activeWeaponRef = useRef<'sword' | 'bow'>('sword')
  const arrowsRef = useRef(0)
  const focusTimerRef = useRef(0)
  const addCoinsRef = useRef<(amt: number) => void>(() => {})
  const consumeArrowRef = useRef<() => void>(() => {})
  const syncWeaponRef = useRef<(w: 'sword' | 'bow') => void>(() => {})

  const triggerSlashRef = useRef<((aimAngle?: number) => void) | null>(null)
  const triggerSwitchWeaponRef = useRef<(() => void) | null>(null)
  const triggerDashRef = useRef<(() => void) | null>(null)
  const resetRef = useRef<(() => void) | null>(null)

  useEffect(() => { lockedRef.current = lockedMode }, [lockedMode])
  useEffect(() => { cameraViewRef.current = cameraView }, [cameraView])
  useEffect(() => { paperToneRef.current = paperTone }, [paperTone])
  useEffect(() => { sprintToggleRef.current = sprintToggle }, [sprintToggle])
  useEffect(() => { showHatRef.current = showHat }, [showHat])
  useEffect(() => { showCloakRef.current = showCloak }, [showCloak])
  useEffect(() => { showBgRef.current = showBg }, [showBg])
  useEffect(() => { showRigRef.current = showRig }, [showRig])
  useEffect(() => { showHitboxesRef.current = showHitboxes }, [showHitboxes])
  useEffect(() => { showMinimapRef.current = showMinimap }, [showMinimap])
  useEffect(() => { speedScaleRef.current = speedScale }, [speedScale])
  useEffect(() => { shopOpenRef.current = shopOpen }, [shopOpen])
  useEffect(() => { gearRef.current = equippedGear }, [equippedGear])
  useEffect(() => { bowUnlockedRef.current = Boolean(ownedItems.warBow) }, [ownedItems])
  useEffect(() => { activeWeaponRef.current = activeWeapon }, [activeWeapon])
  useEffect(() => { arrowsRef.current = arrows }, [arrows])

  addCoinsRef.current = (amt: number) => {
    setCoins((c) => c + amt)
  }
  consumeArrowRef.current = () => {
    setArrows((a) => Math.max(0, a - 1))
  }
  syncWeaponRef.current = (w: 'sword' | 'bow') => {
    setActiveWeapon(w)
  }

  const selectLocked = useCallback((m: LockedMode) => {
    setLockedMode(m)
    lockedRef.current = m
  }, [])

  const handleBuyOrToggleItem = (item: ShopItem) => {
    if (item.id === 'arrows') {
      if (coins < item.price) {
        setShopMsg(`Need ${item.price} Gold to buy +10 Arrows!`)
        return
      }
      setCoins((c) => c - item.price)
      setArrows((a) => a + 10)
      setShopMsg('Purchased +10 Bamboo Arrows! Quiver restocked.')
      return
    }

    if (item.consumable) {
      if (coins < item.price) {
        setShopMsg(`Need ${item.price} Gold! Collect Gold Coins or slash bamboo targets in the courtyard.`)
        return
      }
      setCoins((c) => c - item.price)
      focusTimerRef.current = 18.0
      setShopMsg('Focus Rush active for 18s! Swirling gold wind & rapid attacks!')
      return
    }

    if (item.id === 'warBow') {
      if (ownedItems.warBow) {
        setActiveWeapon((prev) => {
          const next = prev === 'bow' ? 'sword' : 'bow'
          setShopMsg(
            next === 'bow'
              ? 'Weapon Switch: Equipped Yumi War Bow! Press [Q] anytime to swap.'
              : 'Weapon Switch: Returned to Katana! Press [Q] anytime to swap.'
          )
          return next
        })
        return
      }
      if (coins < item.price) {
        setShopMsg(`Not enough Gold (${coins}/${item.price} Gold). Slice bamboo targets or pick up Gold Coins!`)
        return
      }
      setCoins((c) => c - item.price)
      setOwnedItems((prev) => ({ ...prev, warBow: true }))
      setEquippedGear((prev) => ({ ...prev, warBow: true }))
      setArrows((a) => a + 10)
      setActiveWeapon('bow')
      setShopMsg('Bought Yumi War Bow (+10 Arrows)! Weapon Switch skill [Q] is now active!')
      return
    }

    if (ownedItems[item.id]) {
      setEquippedGear((prev) => {
        const next = { ...prev, [item.id]: !prev[item.id as keyof typeof prev] }
        setShopMsg(next[item.id as keyof typeof next] ? `Equipped ${item.name}!` : `Unequipped ${item.name}.`)
        return next
      })
      return
    }

    if (coins < item.price) {
      setShopMsg(`Not enough Gold (${coins}/${item.price} Gold). Slice bamboo targets or pick up Gold Coins!`)
      return
    }

    setCoins((c) => c - item.price)
    setOwnedItems((prev) => ({ ...prev, [item.id]: true }))
    setEquippedGear((prev) => ({ ...prev, [item.id]: true }))
    setShopMsg(`Purchased & equipped ${item.name} (${item.tag})!`)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const whitePaperPat = ctx.createPattern(createPaperGrainCanvas('#f7f3ec'), 'repeat')
    const studioPaperPat = ctx.createPattern(createPaperGrainCanvas('#a9aba8'), 'repeat')

    const char = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      heading: Math.PI,
      facing: -1 as 1 | -1,
      slashTimer: 0,
      slashDuration: 0.28,
      slashVariant: 3,
      slashComboReset: 0,
      slashAim: null as number | null,
      bowCooldown: 0,
      bowRecoil: 0,
      dashTimer: 0,
      dashCooldown: 0,
    }

    const topRig = createSamuraiTopDownRig(0, 0, char.heading)
    const sideRig = createSamuraiRig(0, 0, char.facing)
    const cam = { x: 0, y: 0 }

    const particles: Particle[] = []
    const slashArcs: SlashArc[] = []
    const attackBoxes: AttackBox[] = []
    const arrowProjectiles: ArrowProjectile[] = []
    const floatingTexts: FloatingText[] = []

    // Collectible Gold Koban Coins around the courtyard
    const mapCoins: MapCoin[] = [
      { x: -65, y: -45, value: 15, collected: false, respawnTimer: 0, phase: 0.2 },
      { x: 115, y: -35, value: 15, collected: false, respawnTimer: 0, phase: 1.4 },
      { x: 350, y: 0, value: 25, collected: false, respawnTimer: 0, phase: 2.3 },
      { x: 0, y: -235, value: 20, collected: false, respawnTimer: 0, phase: 3.1 },
      { x: -245, y: 35, value: 20, collected: false, respawnTimer: 0, phase: 4.0 },
      { x: 15, y: 185, value: 15, collected: false, respawnTimer: 0, phase: 5.2 },
    ]

    // Slashable Tameshigiri Bamboo Training Dummies (drop +25 Ryo when sliced!)
    const dummies: BambooDummy[] = [
      { x: 105, y: -105, cutTimer: 0, hitAngle: 0 },
      { x: 125, y: 105, cutTimer: 0, hitAngle: 0 },
      { x: -125, y: 110, cutTimer: 0, hitAngle: 0 },
      { x: -35, y: -295, cutTimer: 0, hitAngle: 0 },
    ]

    for (let i = 0; i < 24; i++) {
      particles.push({
        x: (Math.random() - 0.5) * 1400,
        y: (Math.random() - 0.5) * 1000,
        vx: -18 - Math.random() * 24,
        vy: 14 + Math.random() * 18,
        size: 3.2 + Math.random() * 3.0,
        life: Math.random() * 10,
        maxLife: 10 + Math.random() * 8,
        kind: 'leaf',
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 2.4,
      })
    }

    const spawnFootDust = (x: number, y: number, heading: number, count: number, boost = 1) => {
      const bx = -Math.cos(heading)
      const by = -Math.sin(heading)
      for (let i = 0; i < count; i++) {
        particles.push({
          x: x + bx * 8 + (Math.random() - 0.5) * 12,
          y: y + by * 8 + (Math.random() - 0.5) * 12,
          vx: bx * (25 + Math.random() * 55) * boost + (Math.random() - 0.5) * 28,
          vy: by * (25 + Math.random() * 55) * boost + (Math.random() - 0.5) * 28,
          size: 3.5 + Math.random() * 4.5 * boost,
          life: 0,
          maxLife: 0.26 + Math.random() * 0.18,
          kind: 'dust',
          rot: Math.random() * Math.PI * 2,
          vrot: (Math.random() - 0.5) * 3.0,
        })
      }
    }

    const spawnSlashSparks = (x: number, y: number, angle: number, count = 12) => {
      for (let i = 0; i < count; i++) {
        const a = angle + (Math.random() - 0.5) * 1.7
        const spd = 110 + Math.random() * 190
        particles.push({
          x: x + Math.cos(angle) * 28,
          y: y + Math.sin(angle) * 28,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          size: 3.5 + Math.random() * 4,
          life: 0,
          maxLife: 0.16 + Math.random() * 0.15,
          kind: 'spark',
          rot: a,
          vrot: 0,
        })
      }
    }

    const doDash = () => {
      if (char.dashCooldown > 0) return
      if (lockedRef.current !== null) {
        lockedRef.current = null
        setLockedMode(null)
      }
      const hasGale = Boolean(gearRef.current.galeHat)
      const dashSpd = hasGale ? 820 : 680
      char.vx = Math.cos(char.heading) * dashSpd
      char.vy = Math.sin(char.heading) * dashSpd
      char.dashTimer = hasGale ? 0.20 : 0.16
      char.dashCooldown = hasGale ? 0.18 : 0.36
      spawnFootDust(char.x, char.y, char.heading, 8, 1.3)
    }

    const doSlash = (explicitAngle?: number) => {
      const minWait = focusTimerRef.current > 0 ? 0.05 : 0.09
      if (char.slashTimer > minWait) return
      if (explicitAngle !== undefined) {
        char.heading = explicitAngle
        char.slashAim = explicitAngle
        if (Math.cos(explicitAngle) !== 0) {
          char.facing = Math.cos(explicitAngle) >= 0 ? 1 : -1
        }
      } else {
        char.slashAim = char.heading
      }

      // Advance 4-move Kenjutsu combo (0: Forehand Sweep, 1: Rising Uppercut, 2: Overhead Cleave, 3: Piercing Thrust)
      const nextVariant = char.slashComboReset > 0 ? (char.slashVariant + 1) % 4 : 0
      char.slashVariant = nextVariant
      char.slashComboReset = 1.25
      char.slashDuration = nextVariant === 2 ? 0.34 : nextVariant === 3 ? 0.30 : 0.27
      char.slashTimer = char.slashDuration

      if (lockedRef.current === null) {
        const lunge = nextVariant === 3 ? 250 : nextVariant === 2 ? 175 : 140
        char.vx += Math.cos(char.heading) * lunge
        char.vy += Math.sin(char.heading) * lunge
      }
      if (nextVariant === 2 || nextVariant === 3) {
        spawnFootDust(char.x, char.y, char.heading, 6, 1.1)
      }

      const isMoonlight = Boolean(gearRef.current.moonlightBlade)
      slashArcs.push({
        x: char.x,
        y: char.y,
        angle: char.heading,
        age: 0,
        duration: isMoonlight ? 0.32 : 0.26,
        variant: char.slashVariant,
        moonlight: isMoonlight,
      })
      spawnSlashSparks(char.x, char.y, char.heading, isMoonlight ? 18 : 12)

      // Tailored oriented Attack Box (OBB) matching each strike's swing geometry!
      const atkLength =
        nextVariant === 3
          ? isMoonlight
            ? 142
            : 118
          : nextVariant === 2
            ? isMoonlight
              ? 118
              : 94
            : isMoonlight
              ? 114
              : 88
      const atkHalfW =
        nextVariant === 3
          ? isMoonlight
            ? 28
            : 22
          : nextVariant === 2
            ? isMoonlight
              ? 38
              : 30
            : isMoonlight
              ? 48
              : 38

      const atkBox: AttackBox = {
        x: char.x,
        y: char.y,
        angle: char.heading,
        length: atkLength,
        halfWidth: atkHalfW,
        age: 0,
        duration: isMoonlight ? 0.28 : 0.22,
        hit: false,
      }
      const cosA = Math.cos(-atkBox.angle)
      const sinA = Math.sin(-atkBox.angle)
      for (const dm of dummies) {
        if (dm.cutTimer > 0) continue
        const ddx = dm.x - atkBox.x
        const ddy = dm.y - atkBox.y
        const localX = ddx * cosA - ddy * sinA
        const localY = ddx * sinA + ddy * cosA
        if (localX >= -8 && localX <= atkBox.length + 12 && Math.abs(localY) <= atkBox.halfWidth + 12) {
          atkBox.hit = true
          dm.cutTimer = 5.5
          dm.hitAngle = char.heading
          addCoinsRef.current(25)
          const cutLabel =
            nextVariant === 3
              ? '+25 GOLD · PIERCING THRUST!'
              : nextVariant === 2
                ? '+25 GOLD · OVERHEAD CLEAVE!'
                : '+25 GOLD · TARGET CUT!'
          floatingTexts.push({
            x: dm.x,
            y: dm.y - 16,
            text: cutLabel,
            color: nextVariant >= 2 ? '#b84239' : '#9b7428',
            age: 0,
            duration: 1.1,
          })
          spawnSlashSparks(dm.x, dm.y, char.heading, 16)
        }
      }
      attackBoxes.push(atkBox)
    }

    // Unified solid collision resolver: keeps character out of Koi Pond Water (except on Wooden Bridge),
    // Trees, Zen Rocks, Stone Lanterns, Torii Gate Pillars, Merchant Stall & intact Training Dummies!
    const resolveWorldCollisions = (x: number, y: number, prevX: number, prevY: number): Vec2 => {
      let cx = clamp(x, -WORLD_LIMIT, WORLD_LIMIT)
      let cy = clamp(y, -WORLD_LIMIT, WORLD_LIMIT)

      const pushOutCircle = (ox: number, oy: number, rad: number) => {
        const dx = cx - ox
        const dy = cy - oy
        const minDist = rad + PLAYER_COLLIDER_R
        const distSq = dx * dx + dy * dy
        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq)
          if (dist < 0.0001) {
            cx = ox + minDist
          } else {
            cx = ox + (dx / dist) * minDist
            cy = oy + (dy / dist) * minDist
          }
        }
      }

      const pushOutRect = (rx: number, ry: number, halfW: number, halfH: number) => {
        const dx = cx - rx
        const dy = cy - ry
        const padW = halfW + PLAYER_COLLIDER_R
        const padH = halfH + PLAYER_COLLIDER_R
        if (Math.abs(dx) < padW && Math.abs(dy) < padH) {
          if (Math.abs(dx) / padW > Math.abs(dy) / padH) {
            cx = rx + Math.sign(dx || 1) * padW
          } else {
            cy = ry + Math.sign(dy || 1) * padH
          }
        }
      }

      // 1. Merchant Stall counter (always solid)
      pushOutRect(SHOP_POS.x, SHOP_POS.y, 40, 26)

      // 2. Intact Bamboo Training Dummies
      for (const dm of dummies) {
        if (dm.cutTimer <= 0) {
          pushOutCircle(dm.x, dm.y, 11)
        }
      }

      if (showBgRef.current) {
        // 3. Koi Pond Water & Wooden Bridge Deck / Railings
        const wasOnBridge =
          prevX >= BRIDGE_WALK.minX &&
          prevX <= BRIDGE_WALK.maxX &&
          Math.abs(prevY) <= BRIDGE_WALK.deckHalfH
        const enteringBridge =
          cx >= BRIDGE_WALK.minX &&
          cx <= BRIDGE_WALK.maxX &&
          Math.abs(prevY) <= BRIDGE_WALK.halfH + 4 &&
          Math.abs(cy) <= BRIDGE_WALK.deckHalfH

        if (wasOnBridge || enteringBridge) {
          // Safely walking on the Wooden Bridge: clamp inside North/South wooden railings
          if (cx >= BRIDGE_WALK.minX && cx <= BRIDGE_WALK.maxX) {
            cy = clamp(cy, -BRIDGE_WALK.halfH, BRIDGE_WALK.halfH)
          }
        } else {
          // Outside bridge deck: block entry into Koi Pond water & bridge side railings!
          const dxP = cx - POND_CENTER.x
          const dyP = cy - POND_CENTER.y
          const ang = Math.atan2(dyP, dxP)
          const pt = getPondBoundary(ang)
          const radX = pt.rx + PLAYER_COLLIDER_R
          const radY = pt.ry + PLAYER_COLLIDER_R
          const nx = dxP / radX
          const ny = dyP / radY
          const d = Math.hypot(nx, ny)
          if (d < 1.0) {
            // Allow smooth stepping onto the West/East ends of the bridge only when aligned with the deck
            const atWestOpening = prevX <= BRIDGE_WALK.minX + 6 && Math.abs(cy) <= BRIDGE_WALK.halfH
            const atEastOpening = prevX >= BRIDGE_WALK.maxX - 6 && Math.abs(cy) <= BRIDGE_WALK.halfH
            if (!atWestOpening && !atEastOpening) {
              const safeD = Math.max(d, 0.0001)
              cx = POND_CENTER.x + (nx / safeD) * radX
              cy = POND_CENTER.y + (ny / safeD) * radY
            }
          }
        }

        // 4. Trees (solid bamboo/pine/maple trunks & dense root cluster)
        for (const tr of TREES) {
          pushOutCircle(tr.x, tr.y, getTreeColliderRadius(tr))
        }

        // 5. Zen Garden Rocks
        for (const rk of ZEN_ROCKS) {
          pushOutCircle(rk.x, rk.y, rk.r)
        }

        // 6. Stone Lanterns
        for (const ln of LANTERNS) {
          pushOutCircle(ln.x, ln.y, 12)
        }

        // 7. North Shrine Torii Gate Pillars (walk cleanly through the gate arch, blocked by pillars)
        for (const tp of TORII_PILLARS) {
          pushOutCircle(tp.x, tp.y, tp.r)
        }
      }

      return {
        x: clamp(cx, -WORLD_LIMIT, WORLD_LIMIT),
        y: clamp(cy, -WORLD_LIMIT, WORLD_LIMIT),
      }
    }

    const doSwitchWeapon = () => {
      if (!bowUnlockedRef.current) {
        floatingTexts.push({
          x: char.x,
          y: char.y - 38,
          text: 'Buy Yumi War Bow in Shop [E] to activate Switch Skill!',
          color: '#8c4a44',
          age: 0,
          duration: 1.4,
        })
        return
      }
      const next: 'sword' | 'bow' = activeWeaponRef.current === 'bow' ? 'sword' : 'bow'
      activeWeaponRef.current = next
      syncWeaponRef.current(next)
      spawnSlashSparks(char.x, char.y, char.heading, 8)
      floatingTexts.push({
        x: char.x,
        y: char.y - 38,
        text: next === 'bow' ? `SKILL: SWITCH → YUMI BOW (${arrowsRef.current} ARROWS)` : 'SKILL: SWITCH → KATANA',
        color: next === 'bow' ? '#b84239' : '#26262b',
        age: 0,
        duration: 1.15,
      })
    }

    const doShootBow = (explicitAngle?: number) => {
      if (char.bowCooldown > 0) return
      if (arrowsRef.current <= 0) {
        char.bowCooldown = 0.28
        floatingTexts.push({
          x: char.x,
          y: char.y - 38,
          text: 'OUT OF ARROWS! Buy Arrows in Shop [E]',
          color: '#b84239',
          age: 0,
          duration: 1.25,
        })
        return
      }
      const aimAngle = explicitAngle !== undefined ? explicitAngle : char.heading
      char.heading = aimAngle
      if (Math.cos(aimAngle) !== 0) {
        char.facing = Math.cos(aimAngle) >= 0 ? 1 : -1
      }
      const focusBoost = focusTimerRef.current > 0
      char.bowCooldown = focusBoost ? 0.14 : 0.25
      char.bowRecoil = 1.0

      arrowsRef.current = Math.max(0, arrowsRef.current - 1)
      consumeArrowRef.current()

      const speed = focusBoost ? 920 : 760
      arrowProjectiles.push({
        x: char.x + Math.cos(aimAngle) * 24,
        y: char.y + Math.sin(aimAngle) * 24,
        vx: Math.cos(aimAngle) * speed,
        vy: Math.sin(aimAngle) * speed,
        angle: aimAngle,
        age: 0,
        maxAge: 1.4,
        focusBoost,
      })
      spawnSlashSparks(char.x + Math.cos(aimAngle) * 14, char.y + Math.sin(aimAngle) * 14, aimAngle, 6)
    }

    const doAttack = (explicitAngle?: number) => {
      if (activeWeaponRef.current === 'bow') {
        doShootBow(explicitAngle)
      } else {
        doSlash(explicitAngle)
      }
    }

    const doReset = () => {
      char.x = 0
      char.y = 0
      char.vx = 0
      char.vy = 0
      char.heading = Math.PI
      char.facing = -1
      char.slashTimer = 0
      char.bowCooldown = 0
      char.bowRecoil = 0
      char.dashTimer = 0
      cam.x = 0
      cam.y = 0
      resetSamuraiTopDownCloth(topRig, 0, 0, char.heading)
      resetSamuraiCloth(sideRig, 0, 0, char.facing)
    }

    triggerDashRef.current = doDash
    triggerSlashRef.current = doAttack
    triggerSwitchWeaponRef.current = doSwitchWeapon
    resetRef.current = doReset

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
        e.preventDefault()
      }
      const wasDown = keysRef.current[k]
      keysRef.current[k] = true

      if (!wasDown && k === 'e') {
        const distToShop = Math.hypot(char.x - SHOP_POS.x, char.y - SHOP_POS.y)
        if (distToShop <= SHOP_INTERACT_RADIUS + 40 || shopOpenRef.current) {
          setShopOpen((v) => !v)
        } else {
          floatingTexts.push({
            x: char.x,
            y: char.y - 36,
            text: 'Walk to Merchant Stall (NW) to Shop!',
            color: '#54534f',
            age: 0,
            duration: 1.2,
          })
        }
        return
      }
      if (!wasDown && k === 'escape' && shopOpenRef.current) {
        setShopOpen(false)
        return
      }
      if (shopOpenRef.current) return

      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k) && lockedRef.current !== null) {
        lockedRef.current = null
        setLockedMode(null)
      }
      if (!wasDown && k === ' ') {
        doDash()
      }
      if (!wasDown && k === 'q') {
        doSwitchWeapon()
      }
      if (!wasDown && (k === 'j' || k === 'z' || k === 'k' || k === 'x')) {
        doAttack()
      }
      if (!wasDown && k === 'r') {
        doReset()
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(canvas.clientWidth * dpr)
      canvas.height = Math.floor(canvas.clientHeight * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // =========================================================================
    // FREEHAND INK-WASH BIRD'S-EYE WORLD + MERCHANT SHOPKEEPER RENDERERS
    // =========================================================================
    const isWhitePaper = () => paperToneRef.current === 'white'
    const getStoneFill = () => (isWhitePaper() ? '#f1ece0' : '#b6b8b3')
    const getWoodFill = () => (isWhitePaper() ? '#ebe3d3' : '#a8a9a3')

    const drawSketchCircle = (cx: number, cy: number, r: number, seed: number, alpha = 0.55, lw = 1.1) => {
      ctx.beginPath()
      const segs = 28
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2
        const rr = r + handDrift(i * 14, seed, Math.min(2.2, r * 0.08))
        const px = cx + Math.cos(a) * rr
        const py = cy + Math.sin(a) * rr
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.strokeStyle = `rgba(54, 53, 50, ${alpha})`
      ctx.lineWidth = lw
      ctx.stroke()
    }

    const drawBackdropPaper = (W: number, H: number) => {
      const pat = isWhitePaper() ? whitePaperPat : studioPaperPat
      if (pat) {
        ctx.fillStyle = pat
        ctx.fillRect(0, 0, W, H)
      } else {
        ctx.fillStyle = isWhitePaper() ? '#f7f3ec' : '#a9aba8'
        ctx.fillRect(0, 0, W, H)
      }
      const grad = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.72)
      grad.addColorStop(0, 'rgba(255, 255, 255, 0)')
      grad.addColorStop(1, isWhitePaper() ? 'rgba(45, 42, 36, 0.07)' : 'rgba(20, 22, 24, 0.14)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
    }

    // --- 2.5D HIGH-ANGLE WANDERING MERCHANT CHARACTER & WOODEN STALL ON THE MAP! ---
    const drawMerchantShopGround = (time: number, nearShop: boolean) => {
      ctx.save()
      ctx.translate(SHOP_POS.x, SHOP_POS.y)

      const white = isWhitePaper()
      const ink = '#363532'
      const inkMid = '#54534f'
      const woodTop = white ? '#ebe3d3' : '#adb0a9'
      const woodFront = white ? '#cfc2aa' : '#8c8f88'
      const woodPost = white ? '#8a7860' : '#656862'

      // 1. Pulsing interaction ring in front of the counter when player is nearby
      const pulse = 1 + Math.sin(time * 4.2) * 0.04
      ctx.beginPath()
      ctx.ellipse(0, 32, (nearShop ? 44 : 34) * pulse, (nearShop ? 24 : 18) * pulse, 0, 0, Math.PI * 2)
      ctx.strokeStyle = nearShop ? 'rgba(184, 66, 57, 0.50)' : 'rgba(84, 83, 79, 0.20)'
      ctx.lineWidth = nearShop ? 1.5 : 1.0
      ctx.setLineDash([5, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // 2. Ground cast shadow & woven Tatami floor platform
      ctx.fillStyle = 'rgba(42, 40, 36, 0.12)'
      ctx.beginPath()
      ctx.roundRect(-48, -26, 98, 58, 5)
      ctx.fill()

      ctx.fillStyle = white ? '#efe9d8' : '#b2b3ad'
      ctx.beginPath()
      ctx.roundRect(-44, -24, 88, 50, 3)
      ctx.fill()
      ctx.strokeStyle = 'rgba(54, 53, 50, 0.55)'
      ctx.lineWidth = 1.05
      ctx.stroke()
      // Subtle tatami edge tape
      ctx.strokeStyle = 'rgba(56, 64, 82, 0.35)'
      ctx.lineWidth = 2.0
      ctx.beginPath()
      ctx.moveTo(-42, -21)
      ctx.lineTo(42, -21)
      ctx.moveTo(-42, 23)
      ctx.lineTo(42, 23)
      ctx.stroke()

      // Back wooden corner pillars rising vertically in 2.5D!
      for (const px of [-41, 41]) {
        ctx.fillStyle = woodPost
        ctx.fillRect(px - 2.6, -54, 5.2, 34)
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.0
        ctx.strokeRect(px - 2.6, -54, 5.2, 34)
      }

      // 3. Standing 2.5D Merchant Character (Master Kenji — matching bold ink, 3D sandals & multi-finger hands!)
      const lookBias = clamp((char.x - SHOP_POS.x) * 0.015, -3.2, 3.2)
      const merchBob = Math.sin(time * 2.6) * 1.0
      const waveSwing = nearShop ? Math.sin(time * 7.2) * 0.34 : Math.sin(time * 2.2) * 0.08
      const clothFill = white ? '#f6f3ea' : '#c4c6c0'
      const shadeFill = white ? '#ded8c8' : '#9da099'

      const drawMerchSandal = (fxOff: number, fyOff: number, flipX = 1) => {
        ctx.save()
        ctx.translate(fxOff, fyOff)
        ctx.scale(flipX, 1)
        // Thick 3D raised waraji sandal sole wall
        ctx.beginPath()
        ctx.moveTo(-5.2, 0.5)
        ctx.quadraticCurveTo(0.6, 3.0, 6.2, 1.2)
        ctx.quadraticCurveTo(7.2, 0.2, 6.4, -1.0)
        ctx.lineTo(6.0, -2.0)
        ctx.quadraticCurveTo(0.6, -0.3, -5.0, -1.6)
        ctx.closePath()
        ctx.fillStyle = shadeFill
        ctx.fill()
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.3
        ctx.stroke()
        // Tabi foot dome & V-shaped hanao thong straps
        ctx.beginPath()
        ctx.ellipse(0.6, -1.4, 5.4, 2.5, 0.05, 0, Math.PI * 2)
        ctx.fillStyle = clothFill
        ctx.fill()
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(4.0, -1.7)
        ctx.quadraticCurveTo(1.5, -3.4, -1.8, -0.4)
        ctx.moveTo(4.0, -1.7)
        ctx.quadraticCurveTo(2.0, -2.9, 1.2, 0.5)
        ctx.lineWidth = 1.05
        ctx.stroke()
        ctx.restore()
      }

      const drawMerchHand = (hxOff: number, hyOff: number, ang: number, flipY = false) => {
        ctx.save()
        ctx.translate(hxOff, hyOff)
        ctx.rotate(ang)
        if (flipY) ctx.scale(1, -1)
        // Rounded palm
        ctx.beginPath()
        ctx.roundRect(-3.0, -3.0, 5.2, 6.2, 2.0)
        ctx.fillStyle = clothFill
        ctx.fill()
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.25
        ctx.stroke()
        // Raised thumb
        ctx.beginPath()
        ctx.ellipse(0.2, -3.2, 2.4, 1.45, 0.12, 0, Math.PI * 2)
        ctx.fillStyle = clothFill
        ctx.fill()
        ctx.stroke()
        // 3 stacked curled fingers
        for (const fyo of [-1.2, 0.6, 2.4]) {
          ctx.beginPath()
          ctx.roundRect(0.6, fyo - 0.9, 3.3, 1.8, 0.85)
          ctx.fillStyle = clothFill
          ctx.fill()
          ctx.lineWidth = 1.1
          ctx.stroke()
        }
        ctx.restore()
      }

      ctx.save()
      ctx.translate(0, -1 + merchBob)

      // Merchant ground shadow
      ctx.fillStyle = 'rgba(42, 40, 36, 0.14)'
      ctx.beginPath()
      ctx.ellipse(0, 6, 14, 5.8, 0, 0, Math.PI * 2)
      ctx.fill()

      // Standing Legs: Blouson Hakama + 4-Wrap Kyahan Shins + 3D Waraji Sandals!
      for (const side of [-1, 1]) {
        const lx = side * 6.2
        drawMerchSandal(lx, 6.2, side)
        // Tall wrapped kyahan shin
        ctx.fillStyle = clothFill
        ctx.beginPath()
        ctx.roundRect(lx - 2.6, -2.5, 5.2, 7.2, 1.2)
        ctx.fill()
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.25
        ctx.stroke()
        ctx.beginPath()
        for (const wy of [-0.6, 1.2, 3.0]) {
          ctx.moveTo(lx - 2.5, wy)
          ctx.lineTo(lx + 2.5, wy + 0.5)
        }
        ctx.strokeStyle = inkMid
        ctx.lineWidth = 0.95
        ctx.stroke()
      }

      // Upright Kimono Torso, Obi Sash & Haori Coat (bold crisp ink outline!)
      ctx.beginPath()
      ctx.moveTo(-11, -18.5)
      ctx.quadraticCurveTo(-14.5, -8, -13.5, 2)
      ctx.lineTo(13.5, 2)
      ctx.quadraticCurveTo(14.5, -8, 11, -18.5)
      ctx.quadraticCurveTo(0, -21, -11, -18.5)
      ctx.closePath()
      ctx.fillStyle = shadeFill
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.4
      ctx.stroke()

      // Horizontal waist obi sash
      ctx.fillStyle = clothFill
      ctx.beginPath()
      ctx.roundRect(-12.5, -4.5, 25, 5.5, 1.4)
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.25
      ctx.stroke()

      // Warm cream kimono V-collar & gold merchant medallion
      ctx.beginPath()
      ctx.moveTo(-5.5, -18.5)
      ctx.lineTo(lookBias * 0.4, -7)
      ctx.lineTo(5.5, -18.5)
      ctx.closePath()
      ctx.fillStyle = clothFill
      ctx.fill()
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(lookBias * 0.4, -5.2, 2.3, 0, Math.PI * 2)
      ctx.fillStyle = '#e5be62'
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 0.95
      ctx.stroke()

      // Left segmented arm with rounded elbow cap & multi-finger hand resting calmly on hip/counter!
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(-11.5, -15)
      ctx.lineTo(-16.5, -9.5)
      ctx.lineTo(-12.0, -3.5)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = ink
      ctx.lineWidth = 6.2
      ctx.stroke()
      ctx.strokeStyle = clothFill
      ctx.lineWidth = 3.6
      ctx.stroke()
      // Rounded elbow cap
      ctx.beginPath()
      ctx.arc(-16.5, -9.5, 3.0, 0, Math.PI * 2)
      ctx.fillStyle = shadeFill
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.25
      ctx.stroke()
      drawMerchHand(-11.5, -3.2, 0.35, false)
      ctx.restore()

      // Right segmented waving arm with rounded elbow cap & multi-finger waving hand!
      ctx.save()
      const elX = 16.5
      const elY = -11.0
      const handAng = -0.65 + waveSwing
      const hX = elX + Math.cos(handAng) * 9.5
      const hY = elY + Math.sin(handAng) * 9.5
      ctx.beginPath()
      ctx.moveTo(11.5, -15)
      ctx.lineTo(elX, elY)
      ctx.lineTo(hX, hY)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = ink
      ctx.lineWidth = 6.2
      ctx.stroke()
      ctx.strokeStyle = clothFill
      ctx.lineWidth = 3.6
      ctx.stroke()
      // Rounded elbow cap
      ctx.beginPath()
      ctx.arc(elX, elY, 3.0, 0, Math.PI * 2)
      ctx.fillStyle = shadeFill
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.25
      ctx.stroke()
      drawMerchHand(hX, hY, handAng, false)
      ctx.restore()

      // Head, friendly mustache & face peeking under raised conical merchant hat!
      ctx.fillStyle = clothFill
      ctx.beginPath()
      ctx.arc(lookBias * 0.5, -24.5, 7.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.35
      ctx.stroke()

      // Warm brow shadow under hat brim
      ctx.fillStyle = 'rgba(54, 53, 50, 0.14)'
      ctx.beginPath()
      ctx.ellipse(lookBias * 0.5, -27.5, 7.2, 2.6, 0, 0, Math.PI * 2)
      ctx.fill()

      // Friendly merchant eyes & mustache
      ctx.fillStyle = ink
      ctx.beginPath()
      ctx.arc(lookBias * 0.7 - 2.6, -24.5, 1.1, 0, Math.PI * 2)
      ctx.arc(lookBias * 0.7 + 2.6, -24.5, 1.1, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(lookBias * 0.7 - 3.2, -21.2)
      ctx.quadraticCurveTo(lookBias * 0.7, -22.4, lookBias * 0.7 + 3.2, -21.2)
      ctx.strokeStyle = inkMid
      ctx.lineWidth = 1.2
      ctx.stroke()

      // Bold Conical Woven Merchant Sugegasa Straw Hat (with dark underside rim & straight bamboo ribs!)
      const hx = lookBias * 0.35
      const hy = -29.5
      // Underside shadow ellipse
      ctx.beginPath()
      ctx.ellipse(hx, hy + 1.4, 22.0, 8.2, 0, 0, Math.PI * 2)
      ctx.fillStyle = white ? '#dcd5c3' : '#9c9e98'
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.3
      ctx.stroke()

      // Conical straw hat crown
      ctx.beginPath()
      ctx.moveTo(hx, hy - 13.5)
      ctx.bezierCurveTo(hx - 8, hy - 8.5, hx - 16, hy - 3, hx - 23.0, hy + 0.5)
      ctx.ellipse(hx, hy + 0.5, 23.0, 8.6, 0, Math.PI, 0, true)
      ctx.bezierCurveTo(hx + 16, hy - 3, hx + 8, hy - 8.5, hx, hy - 13.5)
      ctx.closePath()
      ctx.fillStyle = white ? '#f4efe2' : '#c0c2bc'
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.55
      ctx.stroke()

      // Crimson merchant band across the crown
      ctx.beginPath()
      ctx.ellipse(hx, hy - 2.5, 13.8, 4.8, 0, 0.15, Math.PI - 0.15)
      ctx.strokeStyle = '#b84239'
      ctx.lineWidth = 2.4
      ctx.stroke()

      // Crisp straight radial bamboo ribs
      ctx.beginPath()
      for (const a of [0.18, 0.72, 1.24, 1.88, 2.42, 2.94]) {
        ctx.moveTo(hx, hy - 12.2)
        ctx.lineTo(hx + Math.cos(a) * 22.0, hy + 0.5 + Math.sin(a) * 8.2)
      }
      ctx.strokeStyle = 'rgba(84, 83, 79, 0.42)'
      ctx.lineWidth = 0.9
      ctx.stroke()

      // Rounded crimson top knot cap
      ctx.beginPath()
      ctx.arc(hx, hy - 13.0, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = '#b84239'
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.25
      ctx.stroke()

      ctx.restore()

      // 4. 2.5D Raised Wooden Display Counter in front of Master Kenji (open lower legs so his sandals show!)
      // Wooden counter side legs + recessed lower shadow
      ctx.fillStyle = woodFront
      ctx.fillRect(-42, 16, 7, 11)
      ctx.fillRect(35, 16, 7, 11)
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.15
      ctx.strokeRect(-42, 16, 7, 11)
      ctx.strokeRect(35, 16, 7, 11)

      // Upper front counter apron fascia (leaves a clean space underneath so Master Kenji's waraji sandals stay visible!)
      ctx.fillStyle = woodFront
      ctx.beginPath()
      ctx.roundRect(-44, 15, 88, 6.5, 1.5)
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.2
      ctx.stroke()

      // Counter top tabletop surface
      ctx.fillStyle = woodTop
      ctx.beginPath()
      ctx.roundRect(-45, 2, 90, 15, 2.5)
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.2
      ctx.stroke()

      // Displayed wares resting on the 2.5D tabletop:
      // (a) Folded Crimson Wind Scarf on lacquer tray (left)
      ctx.fillStyle = '#38383f'
      ctx.fillRect(-37, 6, 17, 8)
      ctx.fillStyle = '#b84239'
      ctx.beginPath()
      ctx.roundRect(-35, 5, 13, 7, 2)
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 0.9
      ctx.stroke()

      // (b) Miniature Moonlight Katana on wooden stand (center)
      ctx.fillStyle = '#5e4c36'
      ctx.fillRect(-9, 10, 2.2, 4)
      ctx.fillRect(6, 10, 2.2, 4)
      ctx.beginPath()
      ctx.moveTo(-14, 10)
      ctx.lineTo(13, 8.5)
      ctx.strokeStyle = '#384052'
      ctx.lineWidth = 2.4
      ctx.stroke()
      ctx.fillStyle = '#e5be62'
      ctx.beginPath()
      ctx.arc(-6, 9.6, 2.0, 0, Math.PI * 2)
      ctx.fill()

      // (c) Matcha Tea Gourd & Cup (right)
      ctx.fillStyle = white ? '#d4dcb4' : '#9aa38e'
      ctx.beginPath()
      ctx.arc(24, 9.5, 4.2, 0, Math.PI * 2)
      ctx.arc(24, 4.5, 2.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 0.9
      ctx.stroke()
      ctx.fillStyle = white ? '#faf7f0' : '#c8cac4'
      ctx.fillRect(30, 8, 5.5, 4.5)
      ctx.strokeRect(30, 8, 5.5, 4.5)

      // (d) Standing Yumi War Bow leaning against left side of stall!
      ctx.save()
      ctx.translate(-47, 8)
      ctx.rotate(-0.12)
      ctx.beginPath()
      ctx.moveTo(0, -18)
      ctx.lineTo(0, 12)
      ctx.strokeStyle = inkMid
      ctx.lineWidth = 0.8
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, -18)
      ctx.quadraticCurveTo(-7, -4, 0, 12)
      ctx.strokeStyle = '#6e4e2e'
      ctx.lineWidth = 2.4
      ctx.stroke()
      ctx.restore()

      // 5. Standing Timber Lantern Post & Hanging Glowing Chochin Paper Lantern (right side!)
      ctx.fillStyle = woodPost
      ctx.fillRect(50, -24, 3.6, 46)
      ctx.strokeStyle = ink
      ctx.lineWidth = 0.95
      ctx.strokeRect(50, -24, 3.6, 46)
      ctx.beginPath()
      ctx.moveTo(51, -22)
      ctx.lineTo(61, -22)
      ctx.lineTo(61, -15)
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.4
      ctx.stroke()

      const glow = 0.26 + Math.sin(time * 4.5) * 0.05
      const radGlow = ctx.createRadialGradient(61, -6, 2, 61, -6, 26)
      radGlow.addColorStop(0, `rgba(235, 168, 72, ${glow})`)
      radGlow.addColorStop(1, 'rgba(235, 168, 72, 0)')
      ctx.fillStyle = radGlow
      ctx.beginPath()
      ctx.arc(61, -6, 26, 0, Math.PI * 2)
      ctx.fill()

      // Oval hanging paper chochin lantern
      ctx.fillStyle = '#fbf0d8'
      ctx.beginPath()
      ctx.ellipse(61, -6, 6.5, 8.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#b84239'
      ctx.lineWidth = 1.1
      ctx.stroke()
      ctx.fillStyle = ink
      ctx.fillRect(57.5, -15.5, 7, 2)
      ctx.fillRect(58, 2, 6, 2)

      ctx.restore()
    }

    // 2.5D Sloped Merchant Stall Roof Awning, Hanging Noren Curtains & Floating Prompt!
    const drawMerchantShopOverhead = (time: number, nearShop: boolean) => {
      ctx.save()
      ctx.translate(SHOP_POS.x, SHOP_POS.y)

      const white = isWhitePaper()
      const ink = '#363532'
      const woodPost = white ? '#8a7860' : '#656862'

      // Front wooden corner pillars rising from counter corners up to roof eave
      for (const px of [-42, 42]) {
        ctx.fillStyle = woodPost
        ctx.fillRect(px - 2.4, -46, 4.8, 68)
        ctx.strokeStyle = ink
        ctx.lineWidth = 0.95
        ctx.strokeRect(px - 2.4, -46, 4.8, 68)
      }

      // Elevated 2.5D Pitched Wooden/Tile Stall Roof Awning (clear above Master Kenji's hat!)
      ctx.fillStyle = 'rgba(38, 36, 32, 0.14)'
      ctx.beginPath()
      ctx.roundRect(-50, -64, 102, 20, 3)
      ctx.fill()

      ctx.fillStyle = white ? '#ded4c2' : '#969992'
      ctx.beginPath()
      ctx.moveTo(-46, -68)
      ctx.lineTo(46, -68)
      ctx.lineTo(52, -46)
      ctx.lineTo(-52, -46)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = ink
      ctx.lineWidth = 1.25
      ctx.stroke()

      // Roof shingle/tile ribs converging toward ridge
      ctx.beginPath()
      for (let i = -3; i <= 3; i++) {
        ctx.moveTo(i * 13, -68)
        ctx.lineTo(i * 15, -46)
      }
      ctx.strokeStyle = 'rgba(54, 53, 50, 0.34)'
      ctx.lineWidth = 0.9
      ctx.stroke()

      // Top ridge beam
      ctx.fillStyle = '#384052'
      ctx.fillRect(-48, -70, 96, 3.6)
      ctx.strokeStyle = ink
      ctx.lineWidth = 0.9
      ctx.strokeRect(-48, -70, 96, 3.6)

      // Gently fluttering Noren curtain flaps hanging down from the front roof eave
      const breeze = Math.sin(time * 2.2) * 1.4
      for (let i = -2; i <= 2; i++) {
        const nx = i * 18 - 7.5
        ctx.fillStyle = i % 2 === 0 ? '#2f3544' : '#b84239'
        ctx.beginPath()
        ctx.moveTo(nx, -46)
        ctx.lineTo(nx + 15, -46)
        ctx.lineTo(nx + 14.5 + breeze * 0.4, -36.5)
        ctx.lineTo(nx - 0.5 + breeze * 0.4, -36.5)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = ink
        ctx.lineWidth = 0.9
        ctx.stroke()
      }

      // Floating Ink-Scroll Callout Banner cleanly above the Stall Roof
      const bobY = Math.sin(time * 3.2) * 2.0
      ctx.save()
      ctx.translate(0, -86 + bobY)
      const label = nearShop ? '[E] or CLICK · OPEN SHOP' : 'MERCHANT SHOP'
      const boxW = nearShop ? 166 : 118
      ctx.fillStyle = nearShop ? '#26262b' : 'rgba(250, 247, 240, 0.94)'
      ctx.strokeStyle = '#26262b'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.roundRect(-boxW * 0.5, -11, boxW, 22, 4)
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = nearShop ? '#faf7f0' : '#26262b'
      ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 0, 0)
      ctx.restore()

      ctx.restore()
    }

    const drawCollectiblesAndDummies = (time: number) => {
      // 1. Shimmering Gold Koban Coins on the ground
      for (const c of mapCoins) {
        if (c.collected) continue
        const spin = Math.cos(time * 3.6 + c.phase)
        const bob = Math.sin(time * 3.0 + c.phase) * 1.5
        ctx.save()
        ctx.translate(c.x, c.y + bob)
        // Soft gold aura
        ctx.fillStyle = 'rgba(198, 153, 59, 0.18)'
        ctx.beginPath()
        ctx.arc(0, 0, 12, 0, Math.PI * 2)
        ctx.fill()
        // Oval Japanese Koban gold coin
        ctx.beginPath()
        ctx.ellipse(0, 0, Math.max(3.5, Math.abs(spin) * 8.5), 5.5, -0.35, 0, Math.PI * 2)
        ctx.fillStyle = '#e5be62'
        ctx.fill()
        ctx.strokeStyle = '#6b531c'
        ctx.lineWidth = 1.05
        ctx.stroke()
        // Inner stamp lines
        ctx.beginPath()
        ctx.moveTo(-2.5 * Math.abs(spin), -2)
        ctx.lineTo(2.5 * Math.abs(spin), -2)
        ctx.moveTo(-2.5 * Math.abs(spin), 2)
        ctx.lineTo(2.5 * Math.abs(spin), 2)
        ctx.stroke()
        ctx.restore()
      }

      // 2. Slashable Tameshigiri Bamboo Dummies
      for (const dm of dummies) {
        ctx.save()
        ctx.translate(dm.x, dm.y)
        // Shadow
        ctx.fillStyle = 'rgba(42, 40, 36, 0.11)'
        ctx.beginPath()
        ctx.arc(3, 4, 14, 0, Math.PI * 2)
        ctx.fill()
        // Wooden cross-stand base
        ctx.strokeStyle = '#54534f'
        ctx.lineWidth = 3.0
        ctx.beginPath()
        ctx.moveTo(-11, -11)
        ctx.lineTo(11, 11)
        ctx.moveTo(11, -11)
        ctx.lineTo(-11, 11)
        ctx.stroke()

        if (dm.cutTimer > 0) {
          // Sliced top half sliding off!
          const slide = Math.min(1, (5.5 - dm.cutTimer) * 4.5) * 10
          const ox = Math.cos(dm.hitAngle) * slide
          const oy = Math.sin(dm.hitAngle) * slide
          ctx.fillStyle = '#c8cfa8'
          ctx.beginPath()
          ctx.arc(0, 0, 8.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#54534f'
          ctx.lineWidth = 1.1
          ctx.stroke()

          ctx.beginPath()
          ctx.arc(ox, oy, 7.5, 0, Math.PI * 2)
          ctx.fillStyle = '#dce2be'
          ctx.fill()
          ctx.stroke()
        } else {
          // Intact rolled straw/bamboo target seen from above
          ctx.fillStyle = '#d4dcb4'
          ctx.beginPath()
          ctx.arc(0, 0, 10.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#54534f'
          ctx.lineWidth = 1.2
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(0, 0, 5.5, 0, Math.PI * 2)
          ctx.fillStyle = '#9aa874'
          ctx.fill()
          ctx.stroke()
        }
        ctx.restore()
      }
    }

    const drawBirdsEyeWorldGround = (time: number, nearShop: boolean) => {
      if (showBgRef.current) {
        // 1. Zen Raked Gravel Garden (West)
        ctx.save()
        ctx.strokeStyle = 'rgba(62, 60, 56, 0.15)'
        ctx.lineWidth = 1.0
        for (let gy = -150; gy <= 150; gy += 12) {
          ctx.beginPath()
          for (let gx = -470; gx <= -180; gx += 16) {
            const wave = Math.sin(gx * 0.025 + gy * 0.02) * 3.5
            if (gx === -470) ctx.moveTo(gx, gy + wave)
            else ctx.lineTo(gx, gy + wave)
          }
          ctx.stroke()
        }
        for (const rk of ZEN_ROCKS) {
          drawSketchCircle(rk.x, rk.y, rk.r + 14, rk.seed + 1, 0.18, 0.9)
          drawSketchCircle(rk.x, rk.y, rk.r + 26, rk.seed + 2, 0.14, 0.85)
          ctx.fillStyle = getStoneFill()
          ctx.beginPath()
          ctx.ellipse(rk.x, rk.y, rk.r, rk.r * 0.76, 0.4, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = 'rgba(56, 54, 50, 0.62)'
          ctx.lineWidth = 1.15
          ctx.stroke()
        }
        ctx.restore()

        // 2. Realistic Sumi-e Mineral-Wash Koi Pond (East) — shares exact geometry with water collision!
        ctx.save()
        const white = isWhitePaper()
        const pondSegs = 48
        const buildPondPath = (inset = 0) => {
          ctx.beginPath()
          for (let i = 0; i <= pondSegs; i++) {
            const a = (i / pondSegs) * Math.PI * 2
            const pt = getPondBoundary(a)
            const px = POND_CENTER.x + Math.cos(a) * Math.max(8, pt.rx - inset)
            const py = POND_CENTER.y + Math.sin(a) * Math.max(8, pt.ry - inset)
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.closePath()
        }

        // 2A. Damp mossy bank & smooth river stones lining the shoreline
        buildPondPath(-5)
        ctx.fillStyle = white ? 'rgba(132, 138, 126, 0.24)' : 'rgba(56, 64, 62, 0.28)'
        ctx.fill()

        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2 + 0.12
          const pt = getPondBoundary(a)
          // Skip bridge landing openings
          if (Math.abs(pt.y) < 36) continue
          const stoneR = 5.5 + hash1(i * 9.3 + 4) * 5.0
          ctx.save()
          ctx.translate(pt.x + Math.cos(a) * 2.5, pt.y + Math.sin(a) * 2.5)
          ctx.rotate(a + 0.4)
          ctx.fillStyle = white ? '#e4dfd0' : '#9ea29c'
          ctx.beginPath()
          ctx.ellipse(0, 0, stoneR, stoneR * 0.68, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = 'rgba(54, 53, 50, 0.45)'
          ctx.lineWidth = 0.85
          ctx.stroke()
          ctx.restore()
        }

        // 2B. Deep mineral-wash translucent water fill (theme-connected sumi-e slate/celadon!)
        buildPondPath(0)
        const waterGrad = ctx.createRadialGradient(
          POND_CENTER.x - 10,
          POND_CENTER.y - 16,
          14,
          POND_CENTER.x,
          POND_CENTER.y,
          195
        )
        if (white) {
          waterGrad.addColorStop(0, '#627e8a')
          waterGrad.addColorStop(0.45, '#89a3ac')
          waterGrad.addColorStop(0.82, '#b8c8c9')
          waterGrad.addColorStop(1, '#d7e0dc')
        } else {
          waterGrad.addColorStop(0, '#364b54')
          waterGrad.addColorStop(0.5, '#4d656f')
          waterGrad.addColorStop(0.85, '#6b8085')
          waterGrad.addColorStop(1, '#849495')
        }
        ctx.fillStyle = waterGrad
        ctx.fill()

        // Clip all underwater & water-surface effects cleanly inside the pond shoreline
        ctx.save()
        buildPondPath(0)
        ctx.clip()

        // 2C. Inner bank recessed shadow (gives genuine sunken depth below the ground!)
        buildPondPath(0)
        ctx.strokeStyle = white ? 'rgba(42, 56, 62, 0.34)' : 'rgba(18, 26, 30, 0.45)'
        ctx.lineWidth = 10
        ctx.stroke()

        // 2D. Submerged riverbed stones with gentle water refraction shimmer
        for (let i = 0; i < 18; i++) {
          const ang = hash1(i * 11.7 + 3) * Math.PI * 2
          const distFrac = 0.25 + hash1(i * 5.3 + 17) * 0.62
          const bp = getPondBoundary(ang)
          const wobX = Math.sin(time * 1.4 + i) * 0.9
          const wobY = Math.cos(time * 1.1 + i * 1.7) * 0.7
          const sx = POND_CENTER.x + Math.cos(ang) * bp.rx * distFrac + wobX
          const sy = POND_CENTER.y + Math.sin(ang) * bp.ry * distFrac + wobY
          const sr = 6 + hash1(i * 7.1) * 9
          ctx.fillStyle = white ? 'rgba(54, 72, 78, 0.16)' : 'rgba(22, 34, 38, 0.22)'
          ctx.beginPath()
          ctx.ellipse(sx, sy, sr, sr * 0.7, ang, 0, Math.PI * 2)
          ctx.fill()
        }

        // 2E. Articulated Swimming Japanese Koi Fish beneath the water surface!
        const koiSpecs = [
          { cx: 344, cy: -88, rx: 46, ry: 34, spd: 0.42, ph: 0.2, body: '#f5f0e4', spot: '#c44634', sz: 1.05 },
          { cx: 356, cy: 96, rx: 48, ry: 38, spd: -0.36, ph: 2.1, body: '#e6b44c', spot: '#f5f0e4', sz: 0.98 },
          { cx: 326, cy: 48, rx: 32, ry: 28, spd: 0.52, ph: 4.0, body: '#f5f0e4', spot: '#2c2f36', sz: 0.86 },
          { cx: 374, cy: -42, rx: 30, ry: 26, spd: -0.46, ph: 5.1, body: '#c44634', spot: '#f5f0e4', sz: 0.84 },
        ]
        for (const k of koiSpecs) {
          const t0 = time * k.spd + k.ph
          const tNext = t0 + 0.06 * Math.sign(k.spd)
          const kx = k.cx + Math.cos(t0) * k.rx
          const ky = k.cy + Math.sin(t0 * 1.5) * k.ry
          const nx = k.cx + Math.cos(tNext) * k.rx
          const ny = k.cy + Math.sin(tNext * 1.5) * k.ry
          const kAng = Math.atan2(ny - ky, nx - kx)
          const tailWag = Math.sin(time * 6.5 + k.ph * 3)

          ctx.save()
          ctx.translate(kx, ky)
          ctx.rotate(kAng)
          ctx.scale(k.sz, k.sz)

          // Soft deep underwater koi shadow
          ctx.fillStyle = 'rgba(20, 32, 38, 0.22)'
          ctx.beginPath()
          ctx.ellipse(-2, 5.5, 11.5, 3.8, 0, 0, Math.PI * 2)
          ctx.fill()

          // Fluttering translucent pectoral fins
          ctx.fillStyle = 'rgba(248, 244, 234, 0.55)'
          ctx.beginPath()
          ctx.ellipse(2, -4.6, 4.4, 2.0, -0.5 + tailWag * 0.14, 0, Math.PI * 2)
          ctx.ellipse(2, 4.6, 4.4, 2.0, 0.5 - tailWag * 0.14, 0, Math.PI * 2)
          ctx.fill()

          // Graceful undulating tail fin
          ctx.beginPath()
          ctx.moveTo(-8.5, 0)
          ctx.quadraticCurveTo(-13.5, -3.5 + tailWag * 3.2, -17.5, -4.2 + tailWag * 4.5)
          ctx.quadraticCurveTo(-14.5, tailWag * 2.5, -17.5, 4.2 + tailWag * 4.5)
          ctx.quadraticCurveTo(-13.5, 3.5 + tailWag * 3.2, -8.5, 0)
          ctx.fillStyle = 'rgba(245, 240, 228, 0.72)'
          ctx.fill()

          // Streamlined koi body
          ctx.beginPath()
          ctx.moveTo(9.5, 0)
          ctx.quadraticCurveTo(4.5, -4.4, -3.5, -2.5 + tailWag * 0.7)
          ctx.lineTo(-9.5, tailWag * 1.6)
          ctx.lineTo(-3.5, 2.5 + tailWag * 0.7)
          ctx.quadraticCurveTo(4.5, 4.4, 9.5, 0)
          ctx.closePath()
          ctx.fillStyle = k.body
          ctx.fill()

          // Authentic koi dorsal pattern spot
          ctx.fillStyle = k.spot
          ctx.beginPath()
          ctx.ellipse(2.5, 0, 4.2, 2.3, 0.1, 0, Math.PI * 2)
          ctx.fill()
          ctx.beginPath()
          ctx.arc(-3.5, 0.4 + tailWag * 0.4, 1.8, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }

        // Translucent surface water glaze over fish & pebbles for realistic submersion
        ctx.fillStyle = white ? 'rgba(148, 174, 182, 0.22)' : 'rgba(46, 68, 76, 0.28)'
        ctx.fillRect(POND_CENTER.x - 160, POND_CENTER.y - 220, 320, 440)

        // 2F. Soft rippled reflection of the Wooden Bridge cast onto the water!
        ctx.save()
        for (let ry = -28; ry <= 48; ry += 6) {
          const waveShift = Math.sin(time * 2.4 + ry * 0.18) * 3.5
          ctx.fillStyle = white ? 'rgba(48, 56, 58, 0.11)' : 'rgba(18, 24, 28, 0.18)'
          ctx.fillRect(246 + waveShift, ry, 208, 4)
        }
        ctx.restore()

        // 2G. Drifting sunlight caustic bands & surface sheen ripples
        ctx.save()
        for (let i = 0; i < 14; i++) {
          const bandY = -165 + i * 26 + Math.sin(time * 0.8 + i) * 4
          const bandX = POND_CENTER.x + Math.sin(time * 0.65 + i * 1.9) * 32
          const halfLen = 22 + hash1(i * 4.3) * 36
          const shimmer = 0.12 + 0.10 * Math.sin(time * 1.9 + i * 2.3)
          ctx.strokeStyle = white
            ? `rgba(255, 253, 246, ${shimmer * 1.65})`
            : `rgba(220, 232, 234, ${shimmer})`
          ctx.lineWidth = 1.4
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(bandX - halfLen, bandY)
          ctx.quadraticCurveTo(
            bandX,
            bandY + Math.sin(time * 2.1 + i) * 3.2,
            bandX + halfLen,
            bandY
          )
          ctx.stroke()
        }

        // Gentle lapping shoreline water highlight meniscus
        const lapInset = 4.2 + Math.sin(time * 1.8) * 1.4
        buildPondPath(lapInset)
        ctx.strokeStyle = white ? 'rgba(255, 253, 248, 0.34)' : 'rgba(210, 224, 226, 0.20)'
        ctx.lineWidth = 1.1
        ctx.setLineDash([14, 10, 6, 12])
        ctx.lineDashOffset = -time * 6
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()

        // 2H. Dual-ring concentric surface water ripples
        for (const [wx, wy, phase] of [
          [332, -92, 0],
          [372, 92, 1.7],
          [314, 52, 3.2],
          [364, -46, 4.6],
        ]) {
          const cyc = (time * 0.42 + phase) % 1
          const r1 = 5 + cyc * 26
          const r2 = Math.max(2, r1 - 6.5)
          const a1 = (1 - cyc) * (white ? 0.42 : 0.28)
          ctx.strokeStyle = white ? `rgba(255, 253, 246, ${a1})` : `rgba(205, 220, 224, ${a1})`
          ctx.lineWidth = 1.0
          ctx.beginPath()
          ctx.ellipse(wx, wy, r1, r1 * 0.72, 0, 0, Math.PI * 2)
          ctx.stroke()
          if (cyc > 0.18) {
            ctx.strokeStyle = `rgba(48, 62, 68, ${a1 * 0.45})`
            ctx.lineWidth = 0.75
            ctx.beginPath()
            ctx.ellipse(wx, wy, r2, r2 * 0.72, 0, 0, Math.PI * 2)
            ctx.stroke()
          }
        }

        // 2I. Floating Sage-Wash Lily Pads with Underwater Shadows & Delicate Lotus Blossoms
        const lilyPads: [number, number, number, number, boolean][] = [
          [388, -72, 14, 0.5, true],
          [369, -54, 10, 2.2, false],
          [318, 108, 15, -0.8, true],
          [301, 94, 9.5, 1.4, false],
          [386, 118, 11.5, -2.1, false],
        ]
        for (const [lx, ly, lr, ang, hasLotus] of lilyPads) {
          const driftX = Math.sin(time * 0.9 + lx * 0.05) * 1.2
          const driftY = Math.cos(time * 0.7 + ly * 0.05) * 0.9
          const px = lx + driftX
          const py = ly + driftY

          // Soft underwater shadow beneath lily pad
          ctx.fillStyle = 'rgba(24, 36, 40, 0.22)'
          ctx.beginPath()
          ctx.ellipse(px + 2.5, py + 4.2, lr * 0.98, lr * 0.84, 0, 0, Math.PI * 2)
          ctx.fill()

          // Notched lily pad leaf
          ctx.beginPath()
          ctx.arc(px, py, lr, ang + 0.28, ang + Math.PI * 2 - 0.28)
          ctx.lineTo(px, py)
          ctx.closePath()
          ctx.fillStyle = white ? '#a4b596' : '#73826d'
          ctx.fill()
          ctx.strokeStyle = 'rgba(46, 56, 44, 0.55)'
          ctx.lineWidth = 0.95
          ctx.stroke()

          // Delicate radial leaf veins
          ctx.strokeStyle = 'rgba(246, 243, 234, 0.30)'
          ctx.lineWidth = 0.65
          ctx.beginPath()
          for (let v = 0; v < 5; v++) {
            const va = ang + 0.85 + v * 1.05
            ctx.moveTo(px, py)
            ctx.lineTo(px + Math.cos(va) * lr * 0.78, py + Math.sin(va) * lr * 0.78)
          }
          ctx.stroke()

          // Delicate pale-ivory & blush Japanese Lotus Blossom
          if (hasLotus) {
            ctx.save()
            ctx.translate(px - 1, py - 1)
            for (let p = 0; p < 6; p++) {
              ctx.save()
              ctx.rotate((p / 6) * Math.PI * 2 + time * 0.06)
              ctx.fillStyle = p % 2 === 0 ? '#faf4ec' : '#f1d6cf'
              ctx.beginPath()
              ctx.ellipse(3.6, 0, 4.2, 1.8, 0, 0, Math.PI * 2)
              ctx.fill()
              ctx.strokeStyle = 'rgba(138, 72, 66, 0.42)'
              ctx.lineWidth = 0.55
              ctx.stroke()
              ctx.restore()
            }
            ctx.fillStyle = '#e5be62'
            ctx.beginPath()
            ctx.arc(0, 0, 2.0, 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
          }
        }

        ctx.restore() // end pond clip

        // Crisp sumi-e ink outline framing the organic shoreline
        buildPondPath(0)
        ctx.strokeStyle = 'rgba(54, 53, 50, 0.56)'
        ctx.lineWidth = 1.35
        ctx.stroke()
        ctx.restore()

        // 3. Stepping Stones & Central Courtyard
        for (const st of STEPPING_STONES) {
          ctx.save()
          ctx.translate(st.x, st.y)
          ctx.rotate(st.rot)
          ctx.fillStyle = 'rgba(42, 40, 36, 0.06)'
          ctx.beginPath()
          ctx.roundRect(-st.w * 0.5 + 2.5, -st.h * 0.5 + 3, st.w, st.h, 6)
          ctx.fill()
          ctx.fillStyle = getStoneFill()
          ctx.beginPath()
          ctx.roundRect(-st.w * 0.5, -st.h * 0.5, st.w, st.h, 5)
          ctx.fill()
          ctx.strokeStyle = 'rgba(64, 62, 58, 0.38)'
          ctx.lineWidth = 1.0
          ctx.stroke()
          ctx.restore()
        }

        drawSketchCircle(0, 0, 26, 5, 0.26, 1.0)
        drawSketchCircle(0, 0, 82, 9, 0.22, 0.95)

        // 4. Wooden Bridge over Koi Pond
        ctx.save()
        ctx.fillStyle = 'rgba(34, 34, 38, 0.12)'
        ctx.beginPath()
        ctx.roundRect(244, -24, 214, 62, 4)
        ctx.fill()
        ctx.fillStyle = getWoodFill()
        ctx.beginPath()
        ctx.roundRect(242, -32, 216, 64, 3)
        ctx.fill()
        ctx.strokeStyle = 'rgba(54, 53, 50, 0.62)'
        ctx.lineWidth = 1.25
        ctx.stroke()
        ctx.beginPath()
        for (let px = 256; px < 454; px += 14) {
          ctx.moveTo(px, -31)
          ctx.lineTo(px, 31)
        }
        ctx.strokeStyle = 'rgba(54, 53, 50, 0.32)'
        ctx.lineWidth = 0.9
        ctx.stroke()
        ctx.fillStyle = getStoneFill()
        ctx.fillRect(240, -35, 220, 6)
        ctx.fillRect(240, 29, 220, 6)
        ctx.strokeStyle = 'rgba(54, 53, 50, 0.7)'
        ctx.lineWidth = 1.1
        ctx.strokeRect(240, -35, 220, 6)
        ctx.strokeRect(240, 29, 220, 6)
        for (const postX of [244, 316, 384, 454]) {
          for (const postY of [-32, 32]) {
            ctx.beginPath()
            ctx.arc(postX, postY, 4.5, 0, Math.PI * 2)
            ctx.fillStyle = getStoneFill()
            ctx.fill()
            ctx.stroke()
          }
        }
        ctx.restore()

        // 5. Stone Lanterns
        for (const ln of LANTERNS) {
          ctx.save()
          ctx.translate(ln.x, ln.y)
          ctx.fillStyle = 'rgba(42, 40, 36, 0.10)'
          ctx.beginPath()
          ctx.arc(3.5, 4.5, 13, 0, Math.PI * 2)
          ctx.fill()
          ctx.beginPath()
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2
            const px = Math.cos(a) * 12
            const py = Math.sin(a) * 12
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.closePath()
          ctx.fillStyle = getStoneFill()
          ctx.fill()
          ctx.strokeStyle = 'rgba(56, 54, 50, 0.62)'
          ctx.lineWidth = 1.05
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(0, 0, 3.2, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        }

        // 6. North Torii Gate Shadow & Realistic 2.5D Tree Trunks, Roots & Bamboo Culms
        ctx.save()
        ctx.fillStyle = 'rgba(42, 40, 36, 0.10)'
        ctx.beginPath()
        ctx.roundRect(-84, -365, 196, 22, 6)
        ctx.fill()

        for (const tr of TREES) {
          const colR = getTreeColliderRadius(tr)
          ctx.save()
          ctx.translate(tr.x, tr.y)

          // Soft organic dappled shadow cast SE onto the courtyard ground
          ctx.fillStyle = white ? 'rgba(38, 42, 34, 0.12)' : 'rgba(18, 22, 20, 0.20)'
          ctx.beginPath()
          ctx.ellipse(15, 11, tr.r * 0.96, tr.r * 0.58, 0.08, 0, Math.PI * 2)
          ctx.fill()

          // Natural earthy soil & moss patch under roots
          ctx.fillStyle = white ? 'rgba(118, 124, 98, 0.22)' : 'rgba(58, 68, 54, 0.28)'
          ctx.beginPath()
          ctx.ellipse(0, 3, colR * 0.92, colR * 0.56, 0, 0, Math.PI * 2)
          ctx.fill()

          if (tr.kind === 'bamboo') {
            // Real Bamboo Grove: 6 slender curving culms with cylindrical internode shading & side twigs!
            const stalks: [number, number, number, number, number][] = [
              [-15, 4, -6, 46, 3.6],
              [-7, 7, -2.5, 56, 4.2],
              [-1, -4, 1.0, 52, 3.8],
              [5, 5, 2.5, 60, 4.4],
              [13, 2, 5.5, 48, 3.6],
              [10, -5, 4.0, 42, 3.2],
            ]
            for (const [bx, by, leanX, h, w] of stalks) {
              const segs = 5
              for (let s = 0; s < segs; s++) {
                const t0 = s / segs
                const t1 = (s + 1) / segs
                const x0 = bx + leanX * t0 * t0
                const y0 = by - h * t0
                const x1 = bx + leanX * t1 * t1
                const y1 = by - h * t1

                // Dark outline + shaded green culm body
                ctx.beginPath()
                ctx.moveTo(x0, y0)
                ctx.lineTo(x1, y1)
                ctx.lineCap = 'butt'
                ctx.strokeStyle = '#2f322c'
                ctx.lineWidth = w + 1.5
                ctx.stroke()
                ctx.strokeStyle = white ? '#8a9d6f' : '#5e6f52'
                ctx.lineWidth = w - 0.2
                ctx.stroke()

                // Sunlit cylindrical sheen along left edge of bamboo stalk
                ctx.beginPath()
                ctx.moveTo(x0 - w * 0.22, y0)
                ctx.lineTo(x1 - w * 0.22, y1)
                ctx.strokeStyle = white ? 'rgba(238, 244, 218, 0.55)' : 'rgba(195, 210, 178, 0.35)'
                ctx.lineWidth = 1.0
                ctx.stroke()

                // Realistic raised bamboo node ring & subtle pale sheath line
                if (s > 0) {
                  ctx.beginPath()
                  ctx.moveTo(x0 - w * 0.68, y0)
                  ctx.lineTo(x0 + w * 0.68, y0)
                  ctx.strokeStyle = '#2f322c'
                  ctx.lineWidth = 1.3
                  ctx.stroke()
                  ctx.beginPath()
                  ctx.moveTo(x0 - w * 0.52, y0 + 1.1)
                  ctx.lineTo(x0 + w * 0.52, y0 + 1.1)
                  ctx.strokeStyle = 'rgba(246, 244, 228, 0.45)'
                  ctx.lineWidth = 0.7
                  ctx.stroke()
                }

                // Delicate diagonal bamboo side twigs sprouting from upper nodes
                if (s >= 3) {
                  const sideDir = (s + Math.round(bx)) % 2 === 0 ? 1 : -1
                  ctx.beginPath()
                  ctx.moveTo(x1, y1)
                  ctx.quadraticCurveTo(x1 + sideDir * 7, y1 - 3, x1 + sideDir * 13, y1 - 1)
                  ctx.strokeStyle = '#3b4232'
                  ctx.lineWidth = 0.9
                  ctx.stroke()
                }
              }
            }
          } else if (tr.kind === 'pine') {
            // Real Pine Tree: rugged tapered bark trunk, spreading roots & branching main boughs!
            const barkLit = white ? '#76614d' : '#594b3e'
            const barkShade = white ? '#524234' : '#3a3028'
            const barkInk = '#2b2824'
            const lean = (hash1(tr.seed * 2.1) - 0.5) * 14
            const trunkH = tr.r * 0.58

            // Spreading woody surface roots gripping the ground
            for (const rAng of [-2.5, -0.55, 0.3, 1.2, 2.3, 2.85]) {
              const rLen = colR * (0.55 + hash1(tr.seed + rAng * 5) * 0.3)
              const rx = Math.cos(rAng) * rLen
              const ry = Math.sin(rAng) * rLen * 0.58 + 3
              ctx.beginPath()
              ctx.moveTo(0, 1)
              ctx.quadraticCurveTo(rx * 0.52, ry * 0.42 - 2.5, rx, ry)
              ctx.lineCap = 'round'
              ctx.strokeStyle = barkInk
              ctx.lineWidth = 5.4
              ctx.stroke()
              ctx.strokeStyle = barkLit
              ctx.lineWidth = 3.2
              ctx.stroke()
            }

            // Rugged curved wooden pine trunk (left sunlit, right shaded!)
            ctx.beginPath()
            ctx.moveTo(-10.5, 4)
            ctx.bezierCurveTo(-8.5, -trunkH * 0.35, -6 + lean * 0.6, -trunkH * 0.7, -4.5 + lean, -trunkH)
            ctx.lineTo(4.5 + lean, -trunkH)
            ctx.bezierCurveTo(6.5 + lean * 0.6, -trunkH * 0.7, 9.5, -trunkH * 0.35, 11.5, 4)
            ctx.quadraticCurveTo(0, 7.5, -10.5, 4)
            ctx.closePath()
            const trunkGrad = ctx.createLinearGradient(-10, 0, 11, 0)
            trunkGrad.addColorStop(0, barkLit)
            trunkGrad.addColorStop(0.58, barkLit)
            trunkGrad.addColorStop(1, barkShade)
            ctx.fillStyle = trunkGrad
            ctx.fill()
            ctx.strokeStyle = barkInk
            ctx.lineWidth = 1.35
            ctx.stroke()

            // Rough pine bark plates & vertical fissures
            ctx.strokeStyle = 'rgba(34, 28, 22, 0.52)'
            ctx.lineWidth = 0.95
            ctx.beginPath()
            for (const bxOff of [-4.5, -0.8, 3.2]) {
              ctx.moveTo(bxOff, 2.5)
              ctx.quadraticCurveTo(bxOff + lean * 0.35, -trunkH * 0.48, bxOff * 0.45 + lean * 0.85, -trunkH + 4)
            }
            ctx.stroke()

            // Visible woody main limbs branching out into the pine crown
            for (const [bDx, bDy, bw] of [
              [-24, -14, 4.6],
              [22, -12, 4.4],
              [-14, -22, 3.6],
              [16, -24, 3.4],
            ]) {
              ctx.beginPath()
              ctx.moveTo(lean * 0.75, -trunkH * 0.78)
              ctx.quadraticCurveTo(lean + bDx * 0.45, -trunkH + bDy * 0.3, lean + bDx, -trunkH + bDy)
              ctx.lineCap = 'round'
              ctx.strokeStyle = barkInk
              ctx.lineWidth = bw + 1.8
              ctx.stroke()
              ctx.strokeStyle = barkShade
              ctx.lineWidth = bw
              ctx.stroke()
            }
          } else {
            // Real Broadleaf / Japanese Maple Tree: forked dark-wood trunk, roots, multiple limbs & fallen leaves!
            const barkLit = white ? '#66564a' : '#4d443e'
            const barkShade = white ? '#473c34' : '#352f2b'
            const barkInk = '#2b2824'
            const lean = (hash1(tr.seed * 3.7) - 0.5) * 10
            const trunkH = tr.r * 0.56

            // Natural scattered fallen leaves on ground around trunk
            for (let l = 0; l < 8; l++) {
              const la = hash1(tr.seed + l * 7.3) * Math.PI * 2
              const ld = colR * (0.42 + hash1(tr.seed + l * 4.1) * 0.9)
              ctx.save()
              ctx.translate(Math.cos(la) * ld, Math.sin(la) * ld * 0.62 + 4)
              ctx.rotate(la)
              ctx.fillStyle = l % 2 === 0 ? 'rgba(154, 72, 54, 0.52)' : 'rgba(176, 108, 62, 0.46)'
              ctx.beginPath()
              ctx.ellipse(0, 0, 2.8, 1.5, 0, 0, Math.PI * 2)
              ctx.fill()
              ctx.restore()
            }

            // Spreading roots
            for (const rAng of [-2.3, -0.4, 0.5, 2.5]) {
              const rx = Math.cos(rAng) * (colR * 0.56)
              const ry = Math.sin(rAng) * (colR * 0.36) + 3
              ctx.beginPath()
              ctx.moveTo(0, 2)
              ctx.quadraticCurveTo(rx * 0.5, ry * 0.4 - 1.5, rx, ry)
              ctx.lineCap = 'round'
              ctx.strokeStyle = barkInk
              ctx.lineWidth = 4.5
              ctx.stroke()
              ctx.strokeStyle = barkLit
              ctx.lineWidth = 2.6
              ctx.stroke()
            }

            // Tapered curving trunk with lit/shaded bark gradient
            ctx.beginPath()
            ctx.moveTo(-8.2, 4)
            ctx.quadraticCurveTo(-5.5 + lean * 0.3, -trunkH * 0.5, -3.5 + lean, -trunkH)
            ctx.lineTo(4.0 + lean, -trunkH)
            ctx.quadraticCurveTo(6.5 + lean * 0.3, -trunkH * 0.5, 8.8, 4)
            ctx.quadraticCurveTo(0, 7, -8.2, 4)
            ctx.closePath()
            const mGrad = ctx.createLinearGradient(-8, 0, 9, 0)
            mGrad.addColorStop(0, barkLit)
            mGrad.addColorStop(0.6, barkLit)
            mGrad.addColorStop(1, barkShade)
            ctx.fillStyle = mGrad
            ctx.fill()
            ctx.strokeStyle = barkInk
            ctx.lineWidth = 1.3
            ctx.stroke()

            // Forked main limbs spreading into canopy
            for (const [bDx, bDy, bw] of [
              [-22, -16, 4.0],
              [21, -15, 3.8],
              [-8, -26, 3.2],
              [12, -25, 3.0],
            ]) {
              ctx.beginPath()
              ctx.moveTo(lean * 0.6, -trunkH * 0.62)
              ctx.quadraticCurveTo(lean + bDx * 0.45, -trunkH + bDy * 0.35, lean + bDx, -trunkH + bDy)
              ctx.lineCap = 'round'
              ctx.strokeStyle = barkInk
              ctx.lineWidth = bw + 1.6
              ctx.stroke()
              ctx.strokeStyle = barkShade
              ctx.lineWidth = bw
              ctx.stroke()
            }
          }

          ctx.restore()
        }
        ctx.restore()
      }

      // Always render the Merchant Shop Stall & Coins/Targets!
      drawCollectiblesAndDummies(time)
      drawMerchantShopGround(time, nearShop)
    }

    const drawBirdsEyeOverhead = (time: number, nearShop: boolean) => {
      drawMerchantShopOverhead(time, nearShop)

      if (!showBgRef.current) return

      // North Shrine Torii Gate Top Beam
      ctx.save()
      ctx.translate(0, -390)
      for (const px of [-56, 56]) {
        ctx.beginPath()
        ctx.arc(px, 4, 8, 0, Math.PI * 2)
        ctx.fillStyle = getStoneFill()
        ctx.fill()
        ctx.strokeStyle = 'rgba(54, 53, 50, 0.65)'
        ctx.lineWidth = 1.15
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(-98, -8)
      ctx.quadraticCurveTo(0, -14, 98, -8)
      ctx.lineTo(94, 8)
      ctx.quadraticCurveTo(0, 12, -94, 8)
      ctx.closePath()
      ctx.fillStyle = getStoneFill()
      ctx.fill()
      ctx.strokeStyle = 'rgba(54, 53, 50, 0.72)'
      ctx.lineWidth = 1.3
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-90, 0)
      ctx.quadraticCurveTo(0, -3, 90, 0)
      ctx.strokeStyle = 'rgba(54, 53, 50, 0.35)'
      ctx.lineWidth = 0.9
      ctx.stroke()
      ctx.restore()

      // Real Botanical 2.5D Courtyard Trees (Natural jagged pine needles, organic dappled maple leaves & drooping bamboo!)
      const white = isWhitePaper()
      for (const tr of TREES) {
        const swayX = Math.sin(time * 1.1 + tr.seed) * 2.2
        const swayY = Math.cos(time * 0.85 + tr.seed * 1.3) * 1.2

        ctx.save()
        if (tr.kind === 'bamboo') {
          // Real drooping asymmetric bamboo leaf sprays hanging naturally from upper culm twigs!
          const nodes: [number, number, number][] = [
            [-21, -44, -1],
            [-11, -55, -1],
            [1, -51, 1],
            [8, -59, 1],
            [18, -46, 1],
            [14, -40, 1],
            [-3, -61, -1],
          ]
          ctx.translate(tr.x + swayX, tr.y + swayY)
          for (let n = 0; n < nodes.length; n++) {
            const [nx, ny, dir] = nodes[n]
            const isUpper = n >= 4
            const colDark = white ? '#5c6f4b' : '#404f38'
            const colMid = white ? '#7d9266' : '#586b4d'
            const colLit = white ? '#9fb382' : '#738764'
            const blades = 5
            for (let b = 0; b < blades; b++) {
              const spread = (b / (blades - 1) - 0.5) * 1.15
              // Natural downward-drooping gravity angle (between 0.25 and 1.35 rad below horizontal!)
              const droopAng =
                (dir > 0 ? 0.35 : Math.PI - 0.35) +
                spread * 0.65 +
                Math.sin(time * 1.6 + n + b) * 0.045
              const len = 14 + hash1(tr.seed + n * 5.3 + b * 2.1) * 11
              const wid = 2.1 + hash1(tr.seed + b * 3.7) * 0.9
              ctx.save()
              ctx.translate(nx + (b - 2) * 1.6, ny + Math.abs(b - 2) * 0.8)
              ctx.rotate(droopAng)
              ctx.beginPath()
              ctx.moveTo(0, 0)
              ctx.quadraticCurveTo(len * 0.42, -wid, len, 0)
              ctx.quadraticCurveTo(len * 0.42, wid, 0, 0)
              ctx.closePath()
              ctx.fillStyle = b === 2 && isUpper ? colLit : b % 2 === 0 ? colMid : colDark
              ctx.fill()
              ctx.strokeStyle = 'rgba(38, 46, 34, 0.52)'
              ctx.lineWidth = 0.65
              ctx.stroke()
              ctx.restore()
            }
          }
        } else if (tr.kind === 'pine') {
          // Real Organic Pine Tree: dense overlapping jagged needle-spray boughs (NO smooth cartoon clouds!)
          const lean = (hash1(tr.seed * 2.1) - 0.5) * 14
          const trunkH = tr.r * 0.58
          ctx.translate(tr.x + lean + swayX * 0.55, tr.y - trunkH + swayY * 0.55)

          // 16 organically placed pine bough clusters (bottom deep shadow -> mid pine -> top sunlit needles!)
          const boughCount = 16
          for (let b = 0; b < boughCount; b++) {
            const tier = b < 6 ? 0 : b < 12 ? 1 : 2
            const ang = (b / 6) * Math.PI * 2 + tr.seed * 0.7 + tier * 0.55
            const radFrac = tier === 0 ? 0.58 : tier === 1 ? 0.38 : 0.18
            const bx = Math.cos(ang) * tr.r * radFrac + (hash1(tr.seed + b * 3.1) - 0.5) * 8
            const by = Math.sin(ang) * tr.r * radFrac * 0.64 - tier * 10 + 8
            const br = tr.r * (tier === 0 ? 0.34 : tier === 1 ? 0.32 : 0.28)
            const fillCol =
              tier === 0
                ? white
                  ? '#3f5241'
                  : '#2d3b30'
                : tier === 1
                  ? white
                    ? '#586e54'
                    : '#40523f'
                  : white
                    ? '#758b6c'
                    : '#566952'

            ctx.save()
            ctx.translate(bx, by)
            // Jagged irregular pine bough silhouette (built from sharp radiating needle tips!)
            ctx.beginPath()
            const needles = 22
            for (let i = 0; i <= needles; i++) {
              const a = (i / needles) * Math.PI * 2
              const spiky = i % 2 === 0 ? 1.12 + hash1(tr.seed + b * 11 + i) * 0.22 : 0.76
              const vx = Math.cos(a) * br * spiky
              const vy = Math.sin(a) * br * 0.72 * spiky
              if (i === 0) ctx.moveTo(vx, vy)
              else ctx.lineTo(vx, vy)
            }
            ctx.closePath()
            ctx.fillStyle = fillCol
            ctx.fill()
            ctx.strokeStyle = 'rgba(32, 40, 32, 0.58)'
            ctx.lineWidth = 0.85
            ctx.stroke()

            // Fine textured pine-needle brush strokes across the bough
            ctx.strokeStyle = tier === 2 ? 'rgba(232, 238, 214, 0.34)' : 'rgba(28, 36, 28, 0.34)'
            ctx.lineWidth = 0.75
            ctx.beginPath()
            for (let n = 0; n < 8; n++) {
              const na = (n / 8) * Math.PI * 2 + tr.seed + b
              ctx.moveTo(Math.cos(na) * br * 0.18, Math.sin(na) * br * 0.14)
              ctx.lineTo(Math.cos(na) * br * 0.92, Math.sin(na) * br * 0.66)
            }
            ctx.stroke()
            ctx.restore()
          }
        } else {
          // Real Broadleaf / Japanese Maple Tree: dark inner branches peeking through 24 organic dappled leaf tufts!
          const lean = (hash1(tr.seed * 3.7) - 0.5) * 10
          const trunkH = tr.r * 0.56
          ctx.translate(tr.x + lean + swayX * 0.7, tr.y - trunkH + swayY * 0.7)

          // Inner branching dark twigs visible inside canopy gaps
          ctx.strokeStyle = '#3b332c'
          ctx.lineWidth = 1.6
          ctx.lineCap = 'round'
          ctx.beginPath()
          for (let t = 0; t < 6; t++) {
            const ta = (t / 6) * Math.PI * 2 + tr.seed * 0.4
            ctx.moveTo(0, 2)
            ctx.lineTo(Math.cos(ta) * tr.r * 0.54, Math.sin(ta) * tr.r * 0.36 - 4)
          }
          ctx.stroke()

          // 24 small varied organic leaf tufts (shadow underside -> deep russet-olive -> sunlit outer leaves!)
          const tuftCount = 24
          for (let c = 0; c < tuftCount; c++) {
            const tier = c < 9 ? 0 : c < 18 ? 1 : 2
            const ang = (c / 9) * Math.PI * 2 + tr.seed * 0.9 + tier * 0.42
            const radFrac =
              (tier === 0 ? 0.56 : tier === 1 ? 0.40 : 0.22) +
              (hash1(tr.seed + c * 6.7) - 0.5) * 0.18
            const cx = Math.cos(ang) * tr.r * radFrac
            const cy = Math.sin(ang) * tr.r * radFrac * 0.68 - tier * 8.5 + 6
            const cr = tr.r * (0.20 + hash1(tr.seed + c * 4.3) * 0.11)
            const col =
              tier === 0
                ? white
                  ? '#6f3e34'
                  : '#52302a'
                : tier === 1
                  ? white
                    ? '#964f3e'
                    : '#723e32'
                  : white
                    ? '#b86c4d'
                    : '#8e543e'

            ctx.save()
            ctx.translate(cx, cy)
            // Irregular jagged organic leaf-cluster silhouette
            ctx.beginPath()
            const segs = 14
            for (let i = 0; i <= segs; i++) {
              const a = (i / segs) * Math.PI * 2
              const rJ = 0.8 + hash1(tr.seed + c * 17 + i * 3.3) * 0.42
              const vx = Math.cos(a) * cr * rJ
              const vy = Math.sin(a) * cr * 0.76 * rJ
              if (i === 0) ctx.moveTo(vx, vy)
              else ctx.lineTo(vx, vy)
            }
            ctx.closePath()
            ctx.fillStyle = col
            ctx.fill()
            ctx.strokeStyle = 'rgba(46, 32, 28, 0.52)'
            ctx.lineWidth = 0.8
            ctx.stroke()

            // Crisp individual tiny leaf accents on sunlit upper tufts
            if (tier === 2) {
              ctx.fillStyle = white ? 'rgba(236, 198, 152, 0.45)' : 'rgba(210, 174, 136, 0.28)'
              ctx.beginPath()
              ctx.ellipse(-cr * 0.18, -cr * 0.18, cr * 0.34, cr * 0.20, -0.35, 0, Math.PI * 2)
              ctx.fill()
            }
            ctx.restore()
          }
        }
        ctx.restore()
      }
    }

    // =========================================================================
    // MAIN NATIVE-FPS BIRD'S-EYE EXPLORATION & SHOP LOOP
    // =========================================================================
    let lastTs = performance.now()
    let elapsed = 0
    let rafId = 0
    let hudTick = 0
    let fpsSmooth = 60
    let reportedState: SamuraiAnimMode = 'Idle'
    let afterimageTick = 0
    let petalTick = 0

    const frame = (ts: number) => {
      rafId = requestAnimationFrame(frame)
      const rawDt = Math.min(0.04, Math.max(0.001, (ts - lastTs) / 1000))
      lastTs = ts
      fpsSmooth = damp(fpsSmooth, 1 / rawDt, 6, rawDt)
      const dt = rawDt * speedScaleRef.current
      elapsed += dt

      const W = canvas.clientWidth
      const H = canvas.clientHeight

      if (focusTimerRef.current > 0) {
        focusTimerRef.current = Math.max(0, focusTimerRef.current - rawDt)
        petalTick += dt
        if (petalTick > 0.05) {
          petalTick = 0
          const a = Math.random() * Math.PI * 2
          particles.push({
            x: char.x + Math.cos(a) * 20,
            y: char.y + Math.sin(a) * 20,
            vx: -Math.sin(a) * 65 - char.vx * 0.2,
            vy: Math.cos(a) * 65 - char.vy * 0.2,
            size: 3.5,
            life: 0,
            maxLife: 0.45,
            kind: 'gold-petal',
            rot: a,
            vrot: 4.0,
          })
        }
      }

      // --- 1. 360° BIRD'S-EYE MOVEMENT PHYSICS ---
      const keys = keysRef.current
      const vIn = virtualRef.current
      let inX = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0) + vIn.dx
      let inY = (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0) + vIn.dy
      const inLen = Math.hypot(inX, inY)
      if (inLen > 1) {
        inX /= inLen
        inY /= inLen
      }

      const wantsSprint = Boolean(keys['shift']) || sprintToggleRef.current
      const forced = lockedRef.current
      const gear = gearRef.current
      const speedMult = (gear.crimsonScarf ? 1.18 : 1.0) * (focusTimerRef.current > 0 ? 1.22 : 1.0)

      if (char.slashTimer > 0) char.slashTimer = Math.max(0, char.slashTimer - dt)
      if (char.slashComboReset > 0) char.slashComboReset = Math.max(0, char.slashComboReset - rawDt)
      if (char.bowCooldown > 0) char.bowCooldown = Math.max(0, char.bowCooldown - dt)
      if (char.bowRecoil > 0) char.bowRecoil = Math.max(0, char.bowRecoil - dt * 5.5)
      if (char.dashTimer > 0) char.dashTimer = Math.max(0, char.dashTimer - dt)
      if (char.dashCooldown > 0) char.dashCooldown = Math.max(0, char.dashCooldown - dt)

      let activeMode: SamuraiAnimMode = 'Idle'

      if (forced) {
        char.vx = damp(char.vx, 0, 12, dt)
        char.vy = damp(char.vy, 0, 12, dt)
        activeMode = char.slashTimer > 0 ? 'Slash' : forced
      } else {
        if (char.dashTimer > 0) {
          char.vx = damp(char.vx, Math.cos(char.heading) * 320 * speedMult, 4.5, dt)
          char.vy = damp(char.vy, Math.sin(char.heading) * 320 * speedMult, 4.5, dt)
          afterimageTick += dt
          if (afterimageTick > (gear.shadowCloak ? 0.02 : 0.035)) {
            afterimageTick = 0
            particles.push({
              x: char.x,
              y: char.y,
              vx: 0,
              vy: 0,
              size: 24,
              life: 0,
              maxLife: gear.shadowCloak ? 0.32 : 0.22,
              kind: 'afterimage',
              rot: char.heading,
              vrot: 0,
            })
          }
        } else if (inLen > 0.05) {
          const targetSpd = (wantsSprint ? 330 : 155) * speedMult
          const accel = wantsSprint ? 13.0 : 14.5
          char.vx = damp(char.vx, inX * targetSpd, accel, dt)
          char.vy = damp(char.vy, inY * targetSpd, accel, dt)
          char.heading = Math.atan2(inY, inX)
          if (Math.abs(inX) > 0.08) char.facing = inX > 0 ? 1 : -1
        } else {
          char.vx = damp(char.vx, 0, 13.5, dt)
          char.vy = damp(char.vy, 0, 13.5, dt)
          if (Math.hypot(char.vx, char.vy) < 4) {
            char.vx = 0
            char.vy = 0
          }
        }

        // Sub-stepped movement + unified world obstacle collision (prevents tunneling into water/trees even when dashing!)
        const moveDx = char.vx * dt
        const moveDy = char.vy * dt
        const steps = Math.max(1, Math.ceil(Math.hypot(moveDx, moveDy) / 8))
        for (let s = 0; s < steps; s++) {
          const prevX = char.x
          const prevY = char.y
          const resolved = resolveWorldCollisions(char.x + moveDx / steps, char.y + moveDy / steps, prevX, prevY)
          char.x = resolved.x
          char.y = resolved.y
        }

        const spd = Math.hypot(char.vx, char.vy)
        if (char.slashTimer > 0) {
          activeMode = 'Slash'
        } else if (spd > 205 || (inLen > 0.05 && wantsSprint && spd > 110)) {
          activeMode = 'Run'
        } else if (spd > 14) {
          activeMode = 'Walk'
        } else {
          activeMode = 'Idle'
        }
      }

      if (activeMode !== reportedState) {
        reportedState = activeMode
        setAnimState(activeMode)
      }

      // --- 2. STEP COLLECTIBLE KOBAN COINS & BAMBOO DUMMIES ---
      const magnetRadius = gear.spiritBell ? 195 : 32
      for (const c of mapCoins) {
        if (c.collected) {
          c.respawnTimer -= rawDt
          if (c.respawnTimer <= 0) c.collected = false
          continue
        }
        const dist = Math.hypot(char.x - c.x, char.y - c.y)
        if (dist < magnetRadius && dist > 1) {
          const pull = gear.spiritBell ? 340 : 180
          c.x += ((char.x - c.x) / dist) * pull * dt
          c.y += ((char.y - c.y) / dist) * pull * dt
        }
        if (dist < 26) {
          c.collected = true
          c.respawnTimer = 9.0
          addCoinsRef.current(c.value)
          floatingTexts.push({
            x: c.x,
            y: c.y - 12,
            text: `+${c.value} GOLD`,
            color: '#9b7428',
            age: 0,
            duration: 0.9,
          })
        }
      }

      for (const dm of dummies) {
        if (dm.cutTimer > 0) dm.cutTimer = Math.max(0, dm.cutTimer - rawDt)
      }

      for (let i = floatingTexts.length - 1; i >= 0; i--) {
        floatingTexts[i].age += rawDt
        floatingTexts[i].y -= 24 * rawDt
        if (floatingTexts[i].age >= floatingTexts[i].duration) floatingTexts.splice(i, 1)
      }

      const distToShop = Math.hypot(char.x - SHOP_POS.x, char.y - SHOP_POS.y)
      const isNearShop = distToShop <= SHOP_INTERACT_RADIUS

      // --- 3. STEP BOTH SAMURAI RIGS ---
      const topEvents = stepSamuraiTopDown(topRig, {
        x: char.x,
        y: char.y,
        vx: char.vx,
        vy: char.vy,
        aimAngle: char.slashTimer > 0 ? char.slashAim : char.bowRecoil > 0 ? char.heading : null,
        mode: activeMode,
        forced: forced !== null,
        slashTimer: char.slashTimer,
        slashDuration: char.slashDuration,
        slashVariant: char.slashVariant,
        dashTimer: char.dashTimer,
        dt,
      })

      const sideEvents = stepSamuraiRig(sideRig, {
        x: char.x,
        y: char.y,
        vx: char.vx,
        vy: 0,
        facing: char.facing,
        grounded: true,
        mode: activeMode,
        forced: forced !== null,
        slashTimer: char.slashTimer,
        slashDuration: char.slashDuration,
        slashVariant: char.slashVariant,
        landImpulse: 0,
        jumpImpulse: 0,
        groundY: char.y,
        dt,
      })

      const stepEvt = cameraViewRef.current === 'birds-eye' ? topEvents : sideEvents
      if (stepEvt.footstep === 'run') {
        spawnFootDust(char.x, char.y, topRig.heading, 3, 0.9)
      } else if (stepEvt.footstep === 'walk') {
        spawnFootDust(char.x, char.y, topRig.heading, 1, 0.5)
      }

      // --- 4. STEP PARTICLES & 360° SLASH ARCS ---
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i]
        pt.life += dt
        if (pt.kind === 'leaf') {
          pt.x += (pt.vx + Math.sin(elapsed * 1.3 + i) * 12) * dt
          pt.y += (pt.vy + Math.cos(elapsed * 1.1 + i) * 8) * dt
          pt.rot += pt.vrot * dt
          if (Math.abs(pt.x - cam.x) > 820 || Math.abs(pt.y - cam.y) > 580) {
            pt.x = cam.x + (Math.random() - 0.5) * 1300
            pt.y = cam.y - 460 - Math.random() * 100
          }
          continue
        }
        if (pt.life >= pt.maxLife) {
          particles.splice(i, 1)
          continue
        }
        pt.x += pt.vx * dt
        pt.y += pt.vy * dt
        pt.rot += pt.vrot * dt
        if (pt.kind === 'dust') {
          pt.vx *= Math.pow(0.92, dt * 60)
          pt.vy *= Math.pow(0.92, dt * 60)
        }
      }

      for (let i = slashArcs.length - 1; i >= 0; i--) {
        slashArcs[i].age += dt
        if (slashArcs[i].age >= slashArcs[i].duration) slashArcs.splice(i, 1)
      }

      for (let i = attackBoxes.length - 1; i >= 0; i--) {
        attackBoxes[i].age += dt
        if (attackBoxes[i].age >= attackBoxes[i].duration) attackBoxes.splice(i, 1)
      }

      // Step flying Samurai Arrows & check hits against Bamboo Dummies + solid obstacles (Trees, Rocks, Lanterns, Torii Pillars)!
      for (let i = arrowProjectiles.length - 1; i >= 0; i--) {
        const ar = arrowProjectiles[i]
        ar.age += dt
        ar.x += ar.vx * dt
        ar.y += ar.vy * dt

        if (
          ar.age >= ar.maxAge ||
          Math.abs(ar.x) > WORLD_LIMIT ||
          Math.abs(ar.y) > WORLD_LIMIT
        ) {
          arrowProjectiles.splice(i, 1)
          continue
        }

        // Stop arrow harmlessly if it hits the wooden Merchant Stall
        if (Math.abs(ar.x - SHOP_POS.x) < 42 && Math.abs(ar.y - SHOP_POS.y) < 28) {
          spawnSlashSparks(ar.x, ar.y, ar.angle + Math.PI, 6)
          arrowProjectiles.splice(i, 1)
          continue
        }

        // Stop arrow if it strikes a solid Tree trunk, Zen Rock, Stone Lantern, or Torii Pillar!
        if (showBgRef.current) {
          let blocked = false
          for (const tr of TREES) {
            if (Math.hypot(ar.x - tr.x, ar.y - tr.y) < getTreeColliderRadius(tr)) {
              blocked = true
              break
            }
          }
          if (!blocked) {
            for (const rk of ZEN_ROCKS) {
              if (Math.hypot(ar.x - rk.x, ar.y - rk.y) < rk.r) {
                blocked = true
                break
              }
            }
          }
          if (!blocked) {
            for (const ln of LANTERNS) {
              if (Math.hypot(ar.x - ln.x, ar.y - ln.y) < 12) {
                blocked = true
                break
              }
            }
          }
          if (!blocked) {
            for (const tp of TORII_PILLARS) {
              if (Math.hypot(ar.x - tp.x, ar.y - tp.y) < tp.r) {
                blocked = true
                break
              }
            }
          }
          if (blocked) {
            spawnSlashSparks(ar.x, ar.y, ar.angle + Math.PI, 7)
            arrowProjectiles.splice(i, 1)
            continue
          }
        }

        let hitDummy = false
        for (const dm of dummies) {
          if (dm.cutTimer <= 0 && Math.hypot(dm.x - ar.x, dm.y - ar.y) < 22) {
            dm.cutTimer = 5.5
            dm.hitAngle = ar.angle
            addCoinsRef.current(25)
            floatingTexts.push({
              x: dm.x,
              y: dm.y - 16,
              text: '+25 GOLD · BULLSEYE!',
              color: '#b84239',
              age: 0,
              duration: 1.15,
            })
            spawnSlashSparks(dm.x, dm.y, ar.angle, 16)
            hitDummy = true
            break
          }
        }
        if (hitDummy) {
          arrowProjectiles.splice(i, 1)
        }
      }

      const lookMag = forced ? 0 : 28 + topRig.sprintBlend * 32
      const targetCamX = char.x + Math.cos(topRig.heading) * lookMag
      const targetCamY = char.y + Math.sin(topRig.heading) * lookMag
      cam.x = damp(cam.x, targetCamX, 6.2, rawDt)
      cam.y = damp(cam.y, targetCamY, 6.2, rawDt)

      // --- 5. RENDER BIRD'S-EYE SCENE ---
      ctx.clearRect(0, 0, W, H)
      drawBackdropPaper(W, H)

      ctx.save()
      ctx.translate(W * 0.5 - cam.x, H * 0.5 - cam.y)

      // Ground layer + Merchant Shop Counter + Coins + Dummies
      drawBirdsEyeWorldGround(elapsed, isNearShop)

      // Footstep dust & dash afterimages
      for (const pt of particles) {
        const t = pt.life / pt.maxLife
        if (pt.kind === 'dust') {
          const r = pt.size * (0.65 + t * 1.1)
          ctx.strokeStyle = `rgba(62, 60, 56, ${(1 - t) * 0.36})`
          ctx.lineWidth = 0.95
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, r, pt.rot, pt.rot + Math.PI * 1.4)
          ctx.stroke()
        } else if (pt.kind === 'afterimage' && cameraViewRef.current === 'birds-eye') {
          ctx.save()
          ctx.translate(pt.x, pt.y)
          ctx.strokeStyle = gear.shadowCloak
            ? `rgba(42, 44, 54, ${(1 - t) * 0.45})`
            : `rgba(68, 66, 62, ${(1 - t) * 0.28})`
          ctx.lineWidth = gear.shadowCloak ? 1.6 : 1.1
          ctx.beginPath()
          ctx.arc(0, 0, 24 * (1 - t * 0.12), 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        } else if (pt.kind === 'gold-petal') {
          ctx.save()
          ctx.translate(pt.x, pt.y)
          ctx.rotate(pt.rot)
          ctx.fillStyle = `rgba(214, 166, 62, ${(1 - t) * 0.85})`
          ctx.beginPath()
          ctx.ellipse(0, 0, pt.size, pt.size * 0.48, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }

      // Golden Spirit Bell magnetic aura ring when equipped
      if (gear.spiritBell) {
        ctx.save()
        ctx.translate(char.x, char.y)
        ctx.strokeStyle = 'rgba(198, 153, 59, 0.22)'
        ctx.lineWidth = 1.0
        ctx.beginPath()
        ctx.arc(0, 0, 34 + Math.sin(elapsed * 4) * 2.5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // Draw Samurai Character (with equipped shop gear & active weapon!)
      if (cameraViewRef.current === 'birds-eye') {
        drawSamuraiTopDown(ctx, topRig, {
          paperTone: paperToneRef.current,
          showHat: showHatRef.current,
          showCloak: showCloakRef.current,
          showBlueLines: false,
          showRig: showRigRef.current,
          scale: 1.18,
          gear,
          activeWeapon: activeWeaponRef.current,
          hasArrows: arrowsRef.current > 0,
          bowRecoil: char.bowRecoil,
        })
      } else {
        drawSamuraiRig(ctx, sideRig, {
          paperTone: paperToneRef.current,
          showHat: showHatRef.current,
          showCloak: showCloakRef.current,
          showBlueLines: false,
          showRig: showRigRef.current,
          scale: 0.92,
          gear,
          activeWeapon: activeWeaponRef.current,
          hasArrows: arrowsRef.current > 0,
          bowRecoil: char.bowRecoil,
        })
      }

      // Flying Samurai Arrows (with crisp wind streak & crimson fletching!)
      for (const ar of arrowProjectiles) {
        ctx.save()
        ctx.translate(ar.x, cameraViewRef.current === 'birds-eye' ? ar.y - 24 : ar.y - 44)
        ctx.rotate(ar.angle)

        // Motion wind streak behind arrow
        const grad = ctx.createLinearGradient(-46, 0, 0, 0)
        grad.addColorStop(0, ar.focusBoost ? 'rgba(229, 190, 98, 0)' : 'rgba(84, 83, 79, 0)')
        grad.addColorStop(1, ar.focusBoost ? 'rgba(229, 190, 98, 0.72)' : 'rgba(84, 83, 79, 0.42)')
        ctx.strokeStyle = grad
        ctx.lineWidth = ar.focusBoost ? 3.2 : 2.0
        ctx.beginPath()
        ctx.moveTo(-46, 0)
        ctx.lineTo(-10, 0)
        ctx.stroke()

        // Bamboo arrow shaft
        ctx.strokeStyle = '#5e4c36'
        ctx.lineWidth = 2.0
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(-14, 0)
        ctx.lineTo(14, 0)
        ctx.stroke()

        // Steel broadhead tip
        ctx.fillStyle = '#2b2c32'
        ctx.beginPath()
        ctx.moveTo(20, 0)
        ctx.lineTo(11, -3.2)
        ctx.lineTo(11, 3.2)
        ctx.closePath()
        ctx.fill()

        // Crimson fletching feathers
        ctx.strokeStyle = '#b84239'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(-9, 0)
        ctx.lineTo(-16, -3.8)
        ctx.moveTo(-9, 0)
        ctx.lineTo(-16, 3.8)
        ctx.stroke()

        ctx.restore()
      }

      // 360° 4-Move Calligraphic Ink / Moonlight Slash Effects!
      for (const sa of slashArcs) {
        const t = sa.age / sa.duration
        const alpha = (1 - t) * (1 - t)
        const inkCol = sa.moonlight
          ? `rgba(54, 74, 128, ${alpha * 0.92})`
          : `rgba(54, 53, 50, ${alpha * 0.88})`
        const accentCol = sa.moonlight
          ? `rgba(120, 152, 224, ${alpha * 0.60})`
          : `rgba(184, 66, 57, ${alpha * 0.45})`

        ctx.save()
        ctx.translate(sa.x, cameraViewRef.current === 'birds-eye' ? sa.y - 24 : sa.y - 54)

        if (sa.variant === 3) {
          // STRIKE 4: Razor-Sharp Piercing Forward Thrust Lance + Sonic Shock Rings!
          ctx.rotate(sa.angle)
          const reach = (sa.moonlight ? 98 : 80) + t * 18
          const startX = 12 + t * 14

          // Tapered ink thrust lance streak
          ctx.beginPath()
          ctx.moveTo(startX, -4.4 * (1 - t * 0.5))
          ctx.lineTo(reach, 0)
          ctx.lineTo(startX, 4.4 * (1 - t * 0.5))
          ctx.closePath()
          ctx.fillStyle = inkCol
          ctx.fill()

          // Inner bright steel needle core
          ctx.strokeStyle = `rgba(255, 253, 248, ${alpha * 0.96})`
          ctx.lineWidth = 2.2 * (1 - t * 0.45)
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(startX + 5, 0)
          ctx.lineTo(reach - 3, 0)
          ctx.stroke()

          // Dual piercing shockwave rings rippling around the thrust axis
          for (const rxOff of [32, 56]) {
            ctx.strokeStyle = accentCol
            ctx.lineWidth = 1.7 * (1 - t * 0.5)
            ctx.beginPath()
            ctx.ellipse(rxOff + t * 14, 0, 4 + t * 3, 11 + t * 10, 0, 0, Math.PI * 2)
            ctx.stroke()
          }
        } else if (sa.variant === 2) {
          // STRIKE 3: High Overhead Vertical Helm-Splitter Cleave + Ground Impact Ring!
          const fx = Math.cos(sa.angle)
          const fy = Math.sin(sa.angle)
          const impactX = fx * (sa.moonlight ? 56 : 44)
          const impactY = fy * (sa.moonlight ? 56 : 44) + 18

          // Dramatic overhead downward vertical blade arc (high above hat -> ground impact!)
          ctx.strokeStyle = inkCol
          ctx.lineWidth = (sa.moonlight ? 9.0 : 7.2) * (1 - t * 0.55)
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(fx * 5, -36 + t * 9)
          ctx.quadraticCurveTo(impactX * 0.85, -20 + impactY * 0.25, impactX, impactY)
          ctx.stroke()

          ctx.strokeStyle = `rgba(255, 253, 248, ${alpha * 0.95})`
          ctx.lineWidth = 2.1 * (1 - t * 0.5)
          ctx.beginPath()
          ctx.moveTo(fx * 8, -32 + t * 9)
          ctx.quadraticCurveTo(impactX * 0.85, -17 + impactY * 0.25, impactX, impactY)
          ctx.stroke()

          // Ground cleave shockwave ellipse at impact point!
          ctx.strokeStyle = accentCol
          ctx.lineWidth = 2.0 * (1 - t * 0.5)
          ctx.beginPath()
          ctx.ellipse(impactX, impactY, 13 + t * 22, 6.5 + t * 11, 0, 0, Math.PI * 2)
          ctx.stroke()
        } else {
          // STRIKE 1 (variant 0: Forehand Sweep) & STRIKE 2 (variant 1: Rising Backhand Uppercut)
          if (cameraViewRef.current === 'birds-eye') {
            ctx.rotate(sa.angle)
            if (sa.variant === 1) ctx.scale(1, -1)
          } else {
            ctx.scale(Math.cos(sa.angle) >= 0 ? 1 : -1, sa.variant === 0 ? 1 : -1)
          }
          const baseR = sa.moonlight ? 54 : 44
          ctx.strokeStyle = inkCol
          ctx.lineWidth = (sa.moonlight ? 8.2 : 6.8) * (1 - t * 0.6)
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.arc(0, 0, baseR + t * 12, -1.55 + t * 0.7, 1.35 + t * 0.2)
          ctx.stroke()

          if (sa.moonlight) {
            // Outer secondary Moonlight shockwave crescent!
            ctx.strokeStyle = `rgba(120, 152, 224, ${alpha * 0.55})`
            ctx.lineWidth = 3.4 * (1 - t * 0.5)
            ctx.beginPath()
            ctx.arc(0, 0, baseR + 9 + t * 16, -1.35 + t * 0.6, 1.15 + t * 0.2)
            ctx.stroke()
          }

          ctx.strokeStyle = `rgba(255, 253, 248, ${alpha * 0.95})`
          ctx.lineWidth = 2.0 * (1 - t * 0.5)
          ctx.beginPath()
          ctx.arc(0, 0, baseR + t * 12, -1.25 + t * 0.7, 1.05 + t * 0.2)
          ctx.stroke()
        }
        ctx.restore()
      }

      // Sparks
      for (const pt of particles) {
        if (pt.kind !== 'spark') continue
        const t = pt.life / pt.maxLife
        ctx.strokeStyle = `rgba(52, 51, 48, ${1 - t})`
        ctx.lineWidth = 1.3
        ctx.beginPath()
        ctx.moveTo(pt.x, pt.y)
        ctx.lineTo(pt.x - pt.vx * 0.025, pt.y - pt.vy * 0.025)
        ctx.stroke()
      }

      // Overhead canopies, Torii roof & Merchant Shop Awning Banner
      drawBirdsEyeOverhead(elapsed, isNearShop)

      // Oriented Attack Boxes (always flashes crisply during attacks; full label when Hitbox toggle is ON)
      for (const ab of attackBoxes) {
        const t = ab.age / ab.duration
        const alpha = (1 - t) * (showHitboxesRef.current ? 0.92 : 0.55)
        ctx.save()
        ctx.translate(ab.x, cameraViewRef.current === 'birds-eye' ? ab.y : ab.y - 54)
        ctx.rotate(ab.angle)
        ctx.fillStyle = ab.hit
          ? `rgba(229, 190, 98, ${alpha * 0.24})`
          : `rgba(184, 66, 57, ${alpha * 0.16})`
        ctx.strokeStyle = ab.hit
          ? `rgba(198, 153, 59, ${alpha})`
          : `rgba(184, 66, 57, ${alpha})`
        ctx.lineWidth = showHitboxesRef.current ? 1.8 : 1.2
        ctx.setLineDash([6, 4])
        ctx.fillRect(-4, -ab.halfWidth, ab.length + 4, ab.halfWidth * 2)
        ctx.strokeRect(-4, -ab.halfWidth, ab.length + 4, ab.halfWidth * 2)
        ctx.setLineDash([])
        if (showHitboxesRef.current) {
          ctx.fillStyle = `rgba(184, 66, 57, ${alpha})`
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
          ctx.textAlign = 'center'
          ctx.fillText(ab.hit ? 'ATK BOX · HIT' : 'ATK BOX', ab.length * 0.5, -ab.halfWidth - 5)
        }
        ctx.restore()
      }

      // Full World Collision Box & Hitbox Overlay (when Hitbox toggle is ON)
      if (showHitboxesRef.current) {
        ctx.save()
        ctx.lineWidth = 1.4
        ctx.setLineDash([5, 4])

        // 1. Player Collider Circle
        ctx.strokeStyle = '#2563eb'
        ctx.fillStyle = 'rgba(37, 99, 235, 0.12)'
        ctx.beginPath()
        ctx.arc(char.x, char.y, PLAYER_COLLIDER_R, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        // 2. Merchant Stall Collider Box
        ctx.strokeStyle = '#d97706'
        ctx.fillStyle = 'rgba(217, 119, 6, 0.12)'
        ctx.fillRect(SHOP_POS.x - 40, SHOP_POS.y - 26, 80, 52)
        ctx.strokeRect(SHOP_POS.x - 40, SHOP_POS.y - 26, 80, 52)

        // 3. Bamboo Dummy Hitboxes
        for (const dm of dummies) {
          if (dm.cutTimer > 0) continue
          ctx.strokeStyle = '#b84239'
          ctx.beginPath()
          ctx.arc(dm.x, dm.y, 12, 0, Math.PI * 2)
          ctx.stroke()
        }

        // 4. Flying Arrow Attack Boxes
        for (const ar of arrowProjectiles) {
          ctx.save()
          ctx.translate(ar.x, cameraViewRef.current === 'birds-eye' ? ar.y : ar.y - 44)
          ctx.rotate(ar.angle)
          ctx.strokeStyle = '#b84239'
          ctx.fillStyle = 'rgba(184, 66, 57, 0.18)'
          ctx.fillRect(-16, -6, 36, 12)
          ctx.strokeRect(-16, -6, 36, 12)
          ctx.restore()
        }

        if (showBgRef.current) {
          // 5. Koi Pond Water No-Entry Collider
          ctx.strokeStyle = '#0284c7'
          ctx.fillStyle = 'rgba(2, 132, 199, 0.10)'
          ctx.beginPath()
          for (let i = 0; i <= 40; i++) {
            const a = (i / 40) * Math.PI * 2
            const pt = getPondBoundary(a)
            if (i === 0) ctx.moveTo(pt.x, pt.y)
            else ctx.lineTo(pt.x, pt.y)
          }
          ctx.closePath()
          ctx.fill()
          ctx.stroke()

          // Wooden Bridge Safe Walkable Deck
          ctx.strokeStyle = '#16a34a'
          ctx.fillStyle = 'rgba(22, 163, 74, 0.10)'
          ctx.fillRect(
            BRIDGE_WALK.minX,
            -BRIDGE_WALK.halfH,
            BRIDGE_WALK.maxX - BRIDGE_WALK.minX,
            BRIDGE_WALK.halfH * 2
          )
          ctx.strokeRect(
            BRIDGE_WALK.minX,
            -BRIDGE_WALK.halfH,
            BRIDGE_WALK.maxX - BRIDGE_WALK.minX,
            BRIDGE_WALK.halfH * 2
          )

          // 6. Trees, Zen Rocks, Stone Lanterns, Torii Gate Pillars
          ctx.strokeStyle = '#d97706'
          ctx.fillStyle = 'rgba(217, 119, 6, 0.12)'
          for (const tr of TREES) {
            ctx.beginPath()
            ctx.arc(tr.x, tr.y, getTreeColliderRadius(tr), 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
          for (const rk of ZEN_ROCKS) {
            ctx.beginPath()
            ctx.arc(rk.x, rk.y, rk.r, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
          for (const ln of LANTERNS) {
            ctx.beginPath()
            ctx.arc(ln.x, ln.y, 12, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
          for (const tp of TORII_PILLARS) {
            ctx.beginPath()
            ctx.arc(tp.x, tp.y, tp.r, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
        }
        ctx.setLineDash([])
        ctx.restore()
      }

      // Floating coin / cut popups
      for (const ft of floatingTexts) {
        const t = ft.age / ft.duration
        ctx.save()
        ctx.globalAlpha = 1 - t * t
        ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        ctx.textAlign = 'center'
        ctx.fillStyle = ft.color
        ctx.fillText(ft.text, ft.x, ft.y)
        ctx.restore()
      }

      // Drifting leaves
      if (showBgRef.current) {
        for (const pt of particles) {
          if (pt.kind !== 'leaf') continue
          ctx.save()
          ctx.translate(pt.x, pt.y)
          ctx.rotate(pt.rot)
          ctx.strokeStyle = 'rgba(54, 53, 50, 0.34)'
          ctx.lineWidth = 0.95
          ctx.beginPath()
          ctx.ellipse(0, 0, pt.size, pt.size * 0.44, 0, 0, Math.PI * 2)
          ctx.stroke()
          ctx.restore()
        }
      }

      ctx.restore()

      // --- 6. LIVE SUMI-E COURTYARD MINIMAP (TOP-RIGHT CORNER WITH ACTUAL MINIATURE TREES!) ---
      if (showMinimapRef.current && !shopOpenRef.current) {
        const mapW = 192
        const mapH = 178
        const mapX = W - mapW - 20
        const mapY = 16
        const headerH = 19
        const bodyY = mapY + headerH
        const bodyH = mapH - headerH
        const mapCX = mapX + mapW * 0.5
        const mapCY = bodyY + bodyH * 0.5
        const worldSpanX = 1320
        const worldSpanY = 1120
        const toMapX = (wx: number) => mapCX + (wx / worldSpanX) * (mapW - 14)
        const toMapY = (wy: number) => mapCY + (wy / worldSpanY) * (bodyH - 12)
        const white = isWhitePaper()

        ctx.save()
        // Drop shadow
        ctx.fillStyle = 'rgba(26, 26, 30, 0.14)'
        ctx.fillRect(mapX + 3, mapY + 3, mapW, mapH)

        // Parchment / board backdrop
        ctx.fillStyle = white ? 'rgba(250, 247, 240, 0.94)' : 'rgba(176, 178, 172, 0.94)'
        ctx.fillRect(mapX, mapY, mapW, mapH)

        // Header bar
        ctx.fillStyle = '#26262b'
        ctx.fillRect(mapX, mapY, mapW, headerH)
        ctx.fillStyle = '#faf7f0'
        ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText('COURTYARD MAP', mapX + 7, mapY + headerH * 0.5)
        ctx.textAlign = 'right'
        ctx.fillStyle = '#e5be62'
        ctx.fillText('N ↑', mapX + mapW - 7, mapY + headerH * 0.5)

        // Clipped minimap viewport
        ctx.save()
        ctx.beginPath()
        ctx.rect(mapX + 1, bodyY, mapW - 2, bodyH - 1)
        ctx.clip()

        // Subtle ink gridlines
        ctx.strokeStyle = 'rgba(54, 53, 50, 0.08)'
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(mapCX, bodyY)
        ctx.lineTo(mapCX, mapY + mapH)
        ctx.moveTo(mapX, mapCY)
        ctx.lineTo(mapX + mapW, mapCY)
        ctx.stroke()

        if (showBgRef.current) {
          // Zen Gravel Garden patch (West) with raked gravel lines
          const zx0 = toMapX(-470)
          const zy0 = toMapY(-150)
          const zw = toMapX(-180) - zx0
          const zh = toMapY(150) - zy0
          ctx.fillStyle = white ? 'rgba(196, 190, 174, 0.34)' : 'rgba(122, 124, 118, 0.34)'
          ctx.fillRect(zx0, zy0, zw, zh)
          ctx.strokeStyle = 'rgba(62, 60, 56, 0.16)'
          ctx.lineWidth = 0.6
          ctx.beginPath()
          for (let ry = zy0 + 4; ry < zy0 + zh; ry += 5) {
            ctx.moveTo(zx0, ry)
            ctx.lineTo(zx0 + zw, ry)
          }
          ctx.stroke()

          // Stepping stone courtyard pathways
          ctx.fillStyle = white ? 'rgba(148, 142, 128, 0.42)' : 'rgba(92, 94, 88, 0.42)'
          for (const st of STEPPING_STONES) {
            ctx.fillRect(toMapX(st.x) - 1.6, toMapY(st.y) - 1.4, 3.2, 2.8)
          }

          // Koi Pond water contour with subtle depth gradient & lily pads!
          ctx.beginPath()
          for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI * 2
            const pt = getPondBoundary(a)
            const px = toMapX(pt.x)
            const py = toMapY(pt.y)
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.closePath()
          const mpGrad = ctx.createRadialGradient(
            toMapX(POND_CENTER.x),
            toMapY(POND_CENTER.y),
            3,
            toMapX(POND_CENTER.x),
            toMapY(POND_CENTER.y),
            28
          )
          mpGrad.addColorStop(0, white ? '#5b7885' : '#324852')
          mpGrad.addColorStop(1, white ? '#9bb4bc' : '#58717a')
          ctx.fillStyle = mpGrad
          ctx.fill()
          ctx.strokeStyle = '#363532'
          ctx.lineWidth = 0.95
          ctx.stroke()

          // Tiny floating lily pads on minimap pond
          ctx.fillStyle = white ? '#9db28c' : '#6c7c66'
          for (const [lx, ly] of [
            [388, -72],
            [318, 108],
            [386, 118],
          ]) {
            ctx.beginPath()
            ctx.arc(toMapX(lx), toMapY(ly), 1.8, 0, Math.PI * 2)
            ctx.fill()
          }

          // Wooden Bridge crossing Koi Pond with wood plank ticks
          const bx0 = toMapX(242)
          const by0 = toMapY(-32)
          const bw = toMapX(458) - bx0
          const bh = toMapY(32) - by0
          ctx.fillStyle = white ? '#d8c8ad' : '#9b9688'
          ctx.fillRect(bx0, by0, bw, bh)
          ctx.strokeStyle = '#363532'
          ctx.lineWidth = 0.85
          ctx.strokeRect(bx0, by0, bw, bh)

          // North Shrine Torii Gate (pillars + top beam)
          ctx.fillStyle = '#363532'
          ctx.fillRect(toMapX(-88), toMapY(-396), toMapX(88) - toMapX(-88), 3.0)
          ctx.fillRect(toMapX(-60), toMapY(-394), 2.4, 5.0)
          ctx.fillRect(toMapX(52), toMapY(-394), 2.4, 5.0)

          // Zen Rocks & Stone Lanterns
          ctx.fillStyle = '#6c6a64'
          for (const rk of ZEN_ROCKS) {
            ctx.beginPath()
            ctx.arc(toMapX(rk.x), toMapY(rk.y), 2.8, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.fillStyle = '#54534f'
          for (const ln of LANTERNS) {
            ctx.fillRect(toMapX(ln.x) - 1.3, toMapY(ln.y) - 1.3, 2.6, 2.6)
          }

          // ACTUAL MINIATURE TREES ON THE MINIMAP (Real trunks, jagged pine boughs, leafy maples & bamboo stalks!)
          for (const tr of TREES) {
            const tx = toMapX(tr.x)
            const ty = toMapY(tr.y)
            ctx.save()
            ctx.translate(tx, ty)
            // Soft shadow
            ctx.fillStyle = 'rgba(32, 36, 30, 0.18)'
            ctx.beginPath()
            ctx.ellipse(1.5, 1.5, 5.5, 3.2, 0, 0, Math.PI * 2)
            ctx.fill()

            if (tr.kind === 'bamboo') {
              // Mini Bamboo Grove: 3 upright green culms + drooping leafy tops!
              for (const [ox, h] of [
                [-2.4, 7.5],
                [0, 9.2],
                [2.4, 7.0],
              ]) {
                ctx.strokeStyle = '#3c4a32'
                ctx.lineWidth = 1.4
                ctx.beginPath()
                ctx.moveTo(ox, 1.2)
                ctx.lineTo(ox * 1.15, -h)
                ctx.stroke()
                ctx.fillStyle = white ? '#8da372' : '#657a55'
                ctx.beginPath()
                ctx.ellipse(ox * 1.15, -h, 3.0, 1.8, 0, 0, Math.PI * 2)
                ctx.fill()
              }
            } else if (tr.kind === 'pine') {
              // Mini Real Pine Tree: brown wooden trunk + 3-tier jagged evergreen boughs!
              ctx.fillStyle = '#5c4a39'
              ctx.fillRect(-1.4, -4.5, 2.8, 6.0)
              const tiers: [number, number, string][] = [
                [-4.0, 6.2, white ? '#3f5241' : '#2d3b30'],
                [-6.8, 5.0, white ? '#586e54' : '#40523f'],
                [-9.4, 3.4, white ? '#758b6c' : '#566952'],
              ]
              for (const [cy, w, col] of tiers) {
                ctx.fillStyle = col
                ctx.beginPath()
                ctx.moveTo(0, cy - 3.0)
                ctx.lineTo(-w, cy + 1.8)
                ctx.lineTo(-w * 0.45, cy + 1.1)
                ctx.lineTo(0, cy + 2.2)
                ctx.lineTo(w * 0.45, cy + 1.1)
                ctx.lineTo(w, cy + 1.8)
                ctx.closePath()
                ctx.fill()
                ctx.strokeStyle = 'rgba(32, 40, 32, 0.55)'
                ctx.lineWidth = 0.6
                ctx.stroke()
              }
            } else {
              // Mini Real Broadleaf / Maple Tree: forked brown trunk + clustered organic autumn foliage!
              ctx.fillStyle = '#57483e'
              ctx.fillRect(-1.3, -4.8, 2.6, 6.0)
              const puffs: [number, number, number, string][] = [
                [-2.8, -5.8, 3.2, white ? '#6f3e34' : '#52302a'],
                [2.8, -5.6, 3.2, white ? '#6f3e34' : '#52302a'],
                [0, -7.2, 3.6, white ? '#964f3e' : '#723e32'],
                [-1.0, -8.8, 2.6, white ? '#b86c4d' : '#8e543e'],
              ]
              for (const [px, py, pr, col] of puffs) {
                ctx.fillStyle = col
                ctx.beginPath()
                ctx.arc(px, py, pr, 0, Math.PI * 2)
                ctx.fill()
              }
              ctx.strokeStyle = 'rgba(46, 32, 28, 0.55)'
              ctx.lineWidth = 0.65
              ctx.beginPath()
              ctx.arc(0, -6.8, 4.6, 0, Math.PI * 2)
              ctx.stroke()
            }
            ctx.restore()
          }
        }

        // Merchant Shop Stall icon (crimson roof square + 'S')
        const sx = toMapX(SHOP_POS.x)
        const sy = toMapY(SHOP_POS.y)
        ctx.fillStyle = '#b84239'
        ctx.fillRect(sx - 5.5, sy - 4.5, 11, 9)
        ctx.strokeStyle = '#26262b'
        ctx.lineWidth = 1.0
        ctx.strokeRect(sx - 5.5, sy - 4.5, 11, 9)
        ctx.fillStyle = '#faf7f0'
        ctx.font = 'bold 7.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('S', sx, sy + 0.5)

        // Collectible Gold Coins
        for (const c of mapCoins) {
          if (c.collected) continue
          ctx.fillStyle = '#e5be62'
          ctx.beginPath()
          ctx.arc(toMapX(c.x), toMapY(c.y), 2.4, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#6b531c'
          ctx.lineWidth = 0.7
          ctx.stroke()
        }

        // Intact Bamboo Training Dummies
        for (const dm of dummies) {
          if (dm.cutTimer > 0) continue
          ctx.fillStyle = '#7e9158'
          ctx.beginPath()
          ctx.arc(toMapX(dm.x), toMapY(dm.y), 2.3, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#26262b'
          ctx.lineWidth = 0.7
          ctx.stroke()
        }

        // Live flying Arrows on minimap
        ctx.fillStyle = '#b84239'
        for (const ar of arrowProjectiles) {
          ctx.beginPath()
          ctx.arc(toMapX(ar.x), toMapY(ar.y), 1.6, 0, Math.PI * 2)
          ctx.fill()
        }

        // Live Samurai Player Directional Marker (clamped smoothly inside minimap viewport!)
        const px = clamp(toMapX(char.x), mapX + 7, mapX + mapW - 7)
        const py = clamp(toMapY(char.y), bodyY + 7, mapY + mapH - 7)
        // Pulsing locator halo
        const haloR = 5.5 + Math.sin(elapsed * 5) * 1.4
        ctx.strokeStyle = 'rgba(184, 66, 57, 0.45)'
        ctx.lineWidth = 1.0
        ctx.beginPath()
        ctx.arc(px, py, haloR, 0, Math.PI * 2)
        ctx.stroke()

        // Directional Samurai arrow pointing along heading
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(topRig.heading)
        ctx.fillStyle = '#26262b'
        ctx.beginPath()
        ctx.moveTo(5.6, 0)
        ctx.lineTo(-3.8, -3.6)
        ctx.lineTo(-2.0, 0)
        ctx.lineTo(-3.8, 3.6)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = '#faf7f0'
        ctx.lineWidth = 0.9
        ctx.stroke()
        ctx.restore()

        ctx.restore() // end minimap clip

        // Crisp outer frame border
        ctx.strokeStyle = '#26262b'
        ctx.lineWidth = 1.5
        ctx.strokeRect(mapX, mapY, mapW, mapH)
        ctx.restore()
      }

      hudTick += rawDt
      if (hudTick > 0.1) {
        hudTick = 0
        setHudStats({
          speed: Math.round(Math.hypot(char.vx, char.vy)),
          x: Math.round(char.x),
          y: Math.round(char.y),
          fps: Math.round(fpsSmooth),
          nearShop: isNearShop,
          focusSec: Math.ceil(focusTimerRef.current),
        })
      }
    }

    rafId = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('resize', resize)
    }
  }, [])

  const setVirtualMove = (dx: number, dy: number) => {
    if ((dx !== 0 || dy !== 0) && lockedRef.current !== null) {
      lockedRef.current = null
      setLockedMode(null)
    }
    virtualRef.current.dx = dx
    virtualRef.current.dy = dy
  }

  return (
    <div
      className={`relative w-screen h-screen overflow-hidden select-none font-mono ${
        paperTone === 'white' ? 'bg-[#f7f3ec] text-[#222226]' : 'bg-[#a9aba8] text-[#222226]'
      }`}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          if (e.button === 0) {
            const rect = e.currentTarget.getBoundingClientRect()
            const localX = e.clientX - rect.left
            const localY = e.clientY - rect.top
            // Ignore clicks inside the top-right Courtyard Minimap
            if (
              showMinimap &&
              localX >= rect.width - 212 &&
              localX <= rect.width - 20 &&
              localY >= 16 &&
              localY <= 194
            ) {
              return
            }
            const clickScreenX = localX - rect.width * 0.5
            const clickScreenY = localY - rect.height * 0.5
            const worldClickX = hudStats.x + clickScreenX
            const worldClickY = hudStats.y + clickScreenY
            // If clicking directly on the Merchant Stall on the map, open the Shop!
            if (Math.hypot(worldClickX - SHOP_POS.x, worldClickY - SHOP_POS.y) < 72) {
              setShopOpen(true)
              return
            }
            triggerSlashRef.current?.(Math.atan2(clickScreenY, clickScreenX))
          }
        }}
        className="w-full h-full block cursor-crosshair"
      />

      {/* Minimalist Top Bar */}
      <div className="pointer-events-none absolute top-4 left-5 right-5 flex items-start justify-between z-20 gap-3">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <div className="px-3.5 py-2 bg-white/85 backdrop-blur-sm border border-[#26262b]">
            <div className="text-[10px] uppercase tracking-[0.22em] font-bold">
              2D BIRD&apos;S-EYE SAMURAI // COURTYARD &amp; MERCHANT SHOP
            </div>
            <div className="text-[11px] text-[#45454a] mt-0.5">
              W/A/S/D: Move · Space: Dash · J / Click: {activeWeapon === 'bow' ? 'Shoot Bow' : 'Slash'} · Q: Switch Weapon · E / Click Stall: Shop · R: Center
            </div>
          </div>
        </div>

        {/* Right HUD: Gold Coin Pouch + Shop Button + State (shifts left cleanly when top-right Minimap is visible) */}
        <div
          className={`pointer-events-auto flex flex-wrap justify-end items-center gap-2 ${
            showMinimap ? 'mr-[204px]' : ''
          }`}
        >
          <button
            type="button"
            onClick={() => setShopOpen((v) => !v)}
            className={`px-3.5 py-2 border border-[#26262b] transition-colors cursor-pointer text-left ${
              shopOpen || hudStats.nearShop
                ? 'bg-[#26262b] text-[#faf7f0]'
                : 'bg-white/90 hover:bg-[#26262b] hover:text-white'
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider font-bold flex items-center gap-2">
              <span>MERCHANT SHOP [E]</span>
              <span className="px-1.5 py-0.5 bg-[#e5be62] text-[#222226] font-extrabold rounded-xs">
                {coins} GOLD
              </span>
            </div>
            <div className="text-[10px] opacity-80 mt-0.5">
              {hudStats.focusSec > 0
                ? `FOCUS RUSH: ${hudStats.focusSec}s`
                : hudStats.nearShop
                  ? 'Press [E] or Click to Browse'
                  : 'Stall at NW Plaza (-135, -110)'}
            </div>
          </button>

          <div className="px-3.5 py-2 bg-white/85 backdrop-blur-sm border border-[#26262b] text-right text-[11px] leading-relaxed">
            <div>
              <span className="text-[#5a5a60]">STATE </span>
              <span className="font-extrabold uppercase underline underline-offset-2">{animState}</span>
              <span className="ml-2 px-1.5 py-0.5 bg-[#26262b] text-white text-[10px] font-bold">
                {hudStats.fps} FPS · {cameraView === 'birds-eye' ? "BIRD'S-EYE" : '3/4 SIDE'}
              </span>
            </div>
            <div className="text-[#3f3f44]">
              {hudStats.speed} px/s · ({hudStats.x}, {hudStats.y})
            </div>
          </div>
        </div>
      </div>

      {/* FIRST-PERSON MERCHANT SHOP SCENE OVERLAY */}
      {shopOpen && (
        <SamuraiPovShop
          coins={coins}
          arrows={arrows}
          activeWeapon={activeWeapon}
          shopMsg={shopMsg}
          ownedItems={ownedItems}
          equippedGear={equippedGear}
          focusActive={hudStats.focusSec > 0}
          onBuyOrToggle={handleBuyOrToggleItem}
          onGrantBonusGold={() => {
            setCoins((c) => c + 100)
            setShopMsg('Added +100 Gold to your pouch!')
          }}
          onClose={() => setShopOpen(false)}
        />
      )}

      {/* Bottom Left: Camera View & Character Controls */}
      <div className="pointer-events-auto absolute bottom-5 left-5 flex flex-col gap-2 z-20 max-w-xl">
        <div className="p-3 bg-white/85 backdrop-blur-sm border border-[#26262b]">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => selectLocked(null)}
              className={`px-2.5 py-1 text-[11px] uppercase border transition-colors cursor-pointer ${
                lockedMode === null
                  ? 'bg-[#26262b] border-[#26262b] text-white font-bold'
                  : 'bg-white/75 border-[#26262b]/40 hover:border-[#26262b]'
              }`}
            >
              Free Roam
            </button>
            {(['Idle', 'Walk', 'Run'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => selectLocked(m)}
                className={`px-2.5 py-1 text-[11px] uppercase border transition-colors cursor-pointer ${
                  lockedMode === m
                    ? 'bg-[#26262b] border-[#26262b] text-white font-bold'
                    : 'bg-white/75 border-[#26262b]/40 hover:border-[#26262b]'
                }`}
              >
                {m === 'Run' ? 'Sprint' : m}
              </button>
            ))}
            <button
              type="button"
              onClick={() => triggerSlashRef.current?.()}
              className="px-2.5 py-1 text-[11px] uppercase border border-[#26262b] bg-black/10 hover:bg-[#26262b] hover:text-white font-bold transition-colors cursor-pointer"
            >
              {activeWeapon === 'bow' ? `Shoot [J] (${arrows})` : 'Slash [J]'}
            </button>
            <button
              type="button"
              onClick={() => triggerSwitchWeaponRef.current?.()}
              className={`px-2.5 py-1 text-[11px] uppercase border border-[#26262b] font-bold transition-colors cursor-pointer ${
                ownedItems.warBow
                  ? activeWeapon === 'bow'
                    ? 'bg-[#b84239] text-white hover:bg-[#96332b]'
                    : 'bg-[#26262b] text-[#e5be62] hover:bg-[#3f3f46]'
                  : 'bg-black/5 text-[#666] border-[#26262b]/40 hover:border-[#26262b]'
              }`}
              title={
                ownedItems.warBow
                  ? 'Skill Active: Press [Q] to switch between Katana and Yumi War Bow'
                  : 'Buy Yumi War Bow in Shop [E] to activate Weapon Switch skill'
              }
            >
              {ownedItems.warBow
                ? `Switch [Q]: ${activeWeapon === 'bow' ? `Bow (${arrows})` : 'Katana'}`
                : 'Switch [Q] (Buy Bow)'}
            </button>
            <button
              type="button"
              onClick={() => setShopOpen((v) => !v)}
              className="px-2.5 py-1 text-[11px] uppercase border border-[#26262b] bg-[#e5be62] hover:bg-[#d6ae50] text-[#222226] font-extrabold transition-colors cursor-pointer"
            >
              Shop [E]
            </button>
            <button
              type="button"
              onClick={() => setCameraView((v) => (v === 'birds-eye' ? 'oblique-34' : 'birds-eye'))}
              className="ml-auto px-2.5 py-1 text-[10px] uppercase border border-[#26262b] bg-[#26262b] text-white font-bold cursor-pointer"
            >
              View: {cameraView === 'birds-eye' ? "Bird's-Eye" : '3/4 Side'}
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="text-[#4a4a50] uppercase">Speed</span>
            <input
              type="range"
              min={0.2}
              max={1.6}
              step={0.05}
              value={speedScale}
              onChange={(e) => setSpeedScale(parseFloat(e.target.value))}
              className="w-24 accent-[#26262b] cursor-pointer"
            />
            <span className="font-bold w-10">{speedScale.toFixed(2)}×</span>

            <button
              type="button"
              onClick={() => setShowHat((v) => !v)}
              className={`px-2 py-0.5 text-[10px] uppercase border cursor-pointer ${
                showHat ? 'bg-[#26262b] border-[#26262b] text-white' : 'bg-transparent border-[#26262b]/35 text-[#555]'
              }`}
            >
              Hat
            </button>
            <button
              type="button"
              onClick={() => setShowCloak((v) => !v)}
              className={`px-2 py-0.5 text-[10px] uppercase border cursor-pointer ${
                showCloak ? 'bg-[#26262b] border-[#26262b] text-white' : 'bg-transparent border-[#26262b]/35 text-[#555]'
              }`}
            >
              Cloak
            </button>
            <button
              type="button"
              onClick={() => setShowBg((v) => !v)}
              className={`px-2 py-0.5 text-[10px] uppercase border cursor-pointer ${
                showBg ? 'bg-[#26262b] border-[#26262b] text-white' : 'bg-transparent border-[#26262b]/35 text-[#555]'
              }`}
            >
              Garden
            </button>
            <button
              type="button"
              onClick={() => setShowRig((v) => !v)}
              className={`px-2 py-0.5 text-[10px] uppercase border cursor-pointer ${
                showRig ? 'bg-[#2563eb] border-[#2626eb] text-white' : 'bg-transparent border-[#26262b]/35 text-[#555]'
              }`}
            >
              Rig
            </button>
            <button
              type="button"
              onClick={() => setShowHitboxes((v) => !v)}
              className={`px-2 py-0.5 text-[10px] uppercase border cursor-pointer ${
                showHitboxes ? 'bg-[#b84239] border-[#b84239] text-white font-bold' : 'bg-transparent border-[#26262b]/35 text-[#555]'
              }`}
              title="Toggle Attack Boxes & World Collision Boxes (Water, Trees, Rocks, Lanterns)"
            >
              Hitbox
            </button>
            <button
              type="button"
              onClick={() => setShowMinimap((v) => !v)}
              className={`px-2 py-0.5 text-[10px] uppercase border cursor-pointer ${
                showMinimap ? 'bg-[#26262b] border-[#26262b] text-white font-bold' : 'bg-transparent border-[#26262b]/35 text-[#555]'
              }`}
              title="Toggle Courtyard Minimap"
            >
              Map
            </button>
            <button
              type="button"
              onClick={() => setPaperTone((t) => (t === 'white' ? 'studio' : 'white'))}
              className="px-2 py-0.5 text-[10px] uppercase border border-[#26262b]/50 bg-white/75 hover:border-[#26262b] cursor-pointer"
            >
              {paperTone === 'white' ? 'Paper' : 'Board'}
            </button>
            <button
              type="button"
              onClick={() => setSprintToggle((v) => !v)}
              className={`ml-auto px-2 py-0.5 text-[10px] uppercase border cursor-pointer ${
                sprintToggle ? 'bg-[#26262b] border-[#26262b] text-white font-bold' : 'bg-transparent border-[#26262b]/40 text-[#444]'
              }`}
            >
              Sprint: {sprintToggle ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Right: On-Screen 4-Way Bird's-Eye D-Pad + Dash/Slash */}
      <div className="pointer-events-auto absolute bottom-5 right-5 p-2.5 bg-white/85 backdrop-blur-sm border border-[#26262b] z-20 flex items-center gap-3">
        <div className="grid grid-cols-3 gap-1">
          <div />
          <button
            type="button"
            onPointerDown={() => setVirtualMove(0, -1)}
            onPointerUp={() => setVirtualMove(0, 0)}
            onPointerLeave={() => setVirtualMove(0, 0)}
            className="w-9 h-9 bg-white/80 hover:bg-[#26262b] hover:text-white border border-[#26262b] text-xs font-bold cursor-pointer"
          >
            ↑
          </button>
          <div />
          <button
            type="button"
            onPointerDown={() => setVirtualMove(-1, 0)}
            onPointerUp={() => setVirtualMove(0, 0)}
            onPointerLeave={() => setVirtualMove(0, 0)}
            className="w-9 h-9 bg-white/80 hover:bg-[#26262b] hover:text-white border border-[#26262b] text-xs font-bold cursor-pointer"
          >
            ←
          </button>
          <button
            type="button"
            onPointerDown={() => setVirtualMove(0, 1)}
            onPointerUp={() => setVirtualMove(0, 0)}
            onPointerLeave={() => setVirtualMove(0, 0)}
            className="w-9 h-9 bg-white/80 hover:bg-[#26262b] hover:text-white border border-[#26262b] text-xs font-bold cursor-pointer"
          >
            ↓
          </button>
          <button
            type="button"
            onPointerDown={() => setVirtualMove(1, 0)}
            onPointerUp={() => setVirtualMove(0, 0)}
            onPointerLeave={() => setVirtualMove(0, 0)}
            className="w-9 h-9 bg-white/80 hover:bg-[#26262b] hover:text-white border border-[#26262b] text-xs font-bold cursor-pointer"
          >
            →
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => triggerDashRef.current?.()}
              className="px-3 h-9 bg-white/80 hover:bg-[#26262b] hover:text-white border border-[#26262b] text-[11px] uppercase font-bold cursor-pointer"
            >
              Dash
            </button>
            <button
              type="button"
              onClick={() => triggerSwitchWeaponRef.current?.()}
              className={`px-2.5 h-9 border border-[#26262b] text-[10.5px] uppercase font-bold cursor-pointer transition-colors ${
                ownedItems.warBow
                  ? activeWeapon === 'bow'
                    ? 'bg-[#b84239] text-white hover:bg-[#96332b]'
                    : 'bg-[#e5be62] text-[#222226] hover:bg-[#d6ae50]'
                  : 'bg-black/5 text-[#777] border-[#26262b]/40'
              }`}
              title={ownedItems.warBow ? 'Switch Weapon [Q]' : 'Buy Yumi War Bow in Shop to unlock'}
            >
              {ownedItems.warBow ? (activeWeapon === 'bow' ? '→ Sword' : '→ Bow') : '🔒 Bow'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => triggerSlashRef.current?.()}
            className="px-3 h-9 bg-[#26262b] hover:bg-[#3f3f46] border border-[#26262b] text-[11px] uppercase font-bold text-white cursor-pointer"
          >
            {activeWeapon === 'bow' ? `Shoot (${arrows})` : 'Slash'}
          </button>
        </div>
      </div>
    </div>
  )
}
