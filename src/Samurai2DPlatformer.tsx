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
import FullWorldMapModal from './FullWorldMapModal'
import {
  CONNECTOR_STONES,
  CONTINENTS,
  MYSTERIOUS_STATUES,
  WAYSHRINE_UNLOCK_RADIUS,
  WAYSTATIONS,
  WILDERNESS_POOLS,
  WILDERNESS_ROCKS,
  WORLD_LIMIT_X,
  WORLD_LIMIT_Y,
  getContinentById,
  getContinentLiquidBoundary,
  getNearestContinent,
  getTreeColliderRadius,
  getWildernessPoolBoundary,
  hash1,
  handDrift,
  queryTreesInRect,
  type ContinentConfig,
  type ContinentId,
  type MysteriousStatue,
} from './continents'

type LockedMode = 'Idle' | 'Walk' | 'Run' | null
type PaperTone = 'white' | 'studio'
type CameraView = 'birds-eye' | 'oblique-34'

const SHOP_INTERACT_RADIUS = 115

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
  kind: 'dust' | 'weather' | 'spark' | 'afterimage' | 'gold-petal'
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

const PLAYER_COLLIDER_R = 14

function getGatePillars(continent: ContinentConfig): { x: number; y: number; r: number }[] {
  return [
    { x: continent.gatePos.x - 56, y: continent.gatePos.y + 4, r: 10 },
    { x: continent.gatePos.x + 56, y: continent.gatePos.y + 4, r: 10 },
  ]
}

export default function Samurai2DPlatformer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const keysRef = useRef<Record<string, boolean>>({})
  const virtualRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 })

  const [continentId, setContinentId] = useState<ContinentId>('kyoto')
  const [discoveredContinents, setDiscoveredContinents] = useState<Record<ContinentId, boolean>>({
    kyoto: true,
    desert: false,
    jungle: false,
    frost: false,
    volcano: false,
  })
  const [scoutUnlockAll, setScoutUnlockAll] = useState(false)
  const [completedStatues, setCompletedStatues] = useState<Record<string, boolean>>({})
  const [activeStatueTaskHud, setActiveStatueTaskHud] = useState<{
    prompt: string
    broken: number
    total: number
    timeLeft: number
    rewardGold: number
  } | null>(null)
  const [fullMapOpen, setFullMapOpen] = useState(false)
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
  const [hudStats, setHudStats] = useState({
    speed: 0,
    x: CONTINENTS[0].origin.x,
    y: CONTINENTS[0].origin.y,
    heading: Math.PI,
    fps: 60,
    nearShop: false,
    focusSec: 0,
  })

  // Shop, Weapon Switch Skill & Economy State
  const [coins, setCoins] = useState(120)
  const [arrows, setArrows] = useState(0)
  const [activeWeapon, setActiveWeapon] = useState<'sword' | 'bow'>('sword')
  const [shopOpen, setShopOpen] = useState(false)
  const [shopMsg, setShopMsg] = useState('Welcome, wandering blade! Browse my hand-forged wares.')
  const [ownedItems, setOwnedItems] = useState<Record<string, boolean>>({})
  const [equippedGear, setEquippedGear] = useState<SamuraiGear & { spiritBell?: boolean }>({})

  const activeContinent = getContinentById(continentId)
  const continentRef = useRef<ContinentConfig>(CONTINENTS[0])
  const discoveredRef = useRef<Record<ContinentId, boolean>>({
    kyoto: true,
    desert: false,
    jungle: false,
    frost: false,
    volcano: false,
  })
  const scoutUnlockRef = useRef(false)
  const completedStatuesRef = useRef<Record<string, boolean>>({})
  const interactStatueRef = useRef<((st: MysteriousStatue) => void) | null>(null)
  const fullMapOpenRef = useRef(false)
  const switchContinentRef = useRef<((id: ContinentId) => void) | null>(null)
  const teleportWorldRef = useRef<((wx: number, wy: number, label?: string, color?: string) => void) | null>(null)
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
  useEffect(() => { fullMapOpenRef.current = fullMapOpen }, [fullMapOpen])
  useEffect(() => { discoveredRef.current = discoveredContinents }, [discoveredContinents])
  useEffect(() => { scoutUnlockRef.current = scoutUnlockAll }, [scoutUnlockAll])
  useEffect(() => { completedStatuesRef.current = completedStatues }, [completedStatues])
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

    const paperPatterns = new Map<string, CanvasPattern | null>()
    const getPaperPattern = (hex: string): CanvasPattern | null => {
      if (!paperPatterns.has(hex)) {
        paperPatterns.set(hex, ctx.createPattern(createPaperGrainCanvas(hex), 'repeat'))
      }
      return paperPatterns.get(hex) ?? null
    }

    const startOrigin = CONTINENTS[0].origin
    const char = {
      x: startOrigin.x,
      y: startOrigin.y,
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

    const topRig = createSamuraiTopDownRig(startOrigin.x, startOrigin.y, char.heading)
    const sideRig = createSamuraiRig(startOrigin.x, startOrigin.y, char.facing)
    const cam = { x: startOrigin.x, y: startOrigin.y }

    const particles: Particle[] = []
    const slashArcs: SlashArc[] = []
    const attackBoxes: AttackBox[] = []
    const arrowProjectiles: ArrowProjectile[] = []
    const floatingTexts: FloatingText[] = []

    const mapCoins: MapCoin[] = []
    const dummies: BambooDummy[] = []
    // Active Ancient Statue Trial State (spawns 3 Cursed Spirit Effigies around an Unrecognized Statue!)
    let activeStatueTrial: {
      statue: MysteriousStatue
      timeLeft: number
      effigies: { x: number; y: number; alive: boolean; phase: number }[]
    } | null = null

    const startStatueTrial = (st: MysteriousStatue) => {
      if (completedStatuesRef.current[st.id]) {
        floatingTexts.push({
          x: st.x,
          y: st.y - 52,
          text: `★ ${st.trueName.toUpperCase()} (ALREADY CLEANSED)`,
          color: '#9b7428',
          age: 0,
          duration: 1.5,
        })
        return
      }
      const effigies: { x: number; y: number; alive: boolean; phase: number }[] = []
      for (let i = 0; i < 3; i++) {
        const ang = -Math.PI * 0.5 + (i / 3) * Math.PI * 2 + 0.35
        effigies.push({
          x: st.x + Math.cos(ang) * 112,
          y: st.y + Math.sin(ang) * 96,
          alive: true,
          phase: i * 2.1,
        })
      }
      activeStatueTrial = {
        statue: st,
        timeLeft: 24.0,
        effigies,
      }
      spawnSlashSparks(st.x, st.y - 18, -Math.PI * 0.5, 18)
      floatingTexts.push({
        x: st.x,
        y: st.y - 58,
        text: `❓ STATUE AWAKENED · ${st.taskPrompt.toUpperCase()}!`,
        color: '#6b3fa0',
        age: 0,
        duration: 2.2,
      })
    }
    interactStatueRef.current = startStatueTrial

    const completeStatueTrialIfDone = () => {
      if (!activeStatueTrial) return
      if (activeStatueTrial.effigies.some((ef) => ef.alive)) return
      const st = activeStatueTrial.statue
      activeStatueTrial = null
      const nextDone = { ...completedStatuesRef.current, [st.id]: true }
      completedStatuesRef.current = nextDone
      setCompletedStatues(nextDone)
      addCoinsRef.current(st.rewardGold)
      spawnSlashSparks(st.x, st.y - 20, -Math.PI * 0.5, 28)
      floatingTexts.push({
        x: st.x,
        y: st.y - 62,
        text: `★ STATUE RECOGNIZED: ${st.trueName.toUpperCase()} · +${st.rewardGold} GOLD!`,
        color: '#b84239',
        age: 0,
        duration: 2.8,
      })
    }

    const spawnAmbientWeather = (cur: ContinentConfig, centerX = cam.x, centerY = cam.y) => {
      for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].kind === 'weather') particles.splice(i, 1)
      }
      const count = cur.weatherKind === 'snow' || cur.weatherKind === 'sand' ? 34 : 26
      for (let i = 0; i < count; i++) {
        const wk = cur.weatherKind
        particles.push({
          x: centerX + (Math.random() - 0.5) * 1400,
          y: centerY + (Math.random() - 0.5) * 1000,
          vx:
            wk === 'sand'
              ? 88 + Math.random() * 68
              : wk === 'snow'
                ? -10 + Math.random() * 20
                : wk === 'firefly'
                  ? (Math.random() - 0.5) * 26
                  : wk === 'ember'
                    ? -12 + Math.random() * 24
                    : -18 - Math.random() * 24,
          vy:
            wk === 'sand'
              ? 8 + Math.random() * 14
              : wk === 'snow'
                ? 22 + Math.random() * 22
                : wk === 'firefly'
                  ? (Math.random() - 0.5) * 20
                  : wk === 'ember'
                    ? -26 - Math.random() * 34
                    : 14 + Math.random() * 18,
          size:
            wk === 'sand'
              ? 5 + Math.random() * 7
              : wk === 'snow'
                ? 1.8 + Math.random() * 2.4
                : wk === 'firefly'
                  ? 2.2 + Math.random() * 1.8
                  : wk === 'ember'
                    ? 1.8 + Math.random() * 2.2
                    : 3.2 + Math.random() * 3.0,
          life: Math.random() * 10,
          maxLife: 10 + Math.random() * 8,
          kind: 'weather',
          rot: Math.random() * Math.PI * 2,
          vrot: (Math.random() - 0.5) * 2.4,
        })
      }
    }

    // Populate ALL 5 Continents' + 6 Midway Waystations' Gold Coins & Bamboo Dummies!
    for (const cont of CONTINENTS) {
      for (const c of cont.coins) {
        mapCoins.push({
          x: c.x,
          y: c.y,
          value: c.value,
          collected: false,
          respawnTimer: 0,
          phase: c.phase,
        })
      }
      for (const d of cont.dummies) {
        dummies.push({ x: d.x, y: d.y, cutTimer: 0, hitAngle: 0 })
      }
    }
    for (let wIdx = 0; wIdx < WAYSTATIONS.length; wIdx++) {
      const ws = WAYSTATIONS[wIdx]
      mapCoins.push({
        x: ws.x - 42,
        y: ws.y + 34,
        value: 25,
        collected: false,
        respawnTimer: 0,
        phase: wIdx * 1.1,
      })
      dummies.push({ x: ws.x + 54, y: ws.y + 28, cutTimer: 0, hitAngle: 0 })
    }
    spawnAmbientWeather(continentRef.current, startOrigin.x, startOrigin.y)

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
      // Also check Cursed Spirit Effigies summoned by an active Unrecognized Statue Task!
      if (activeStatueTrial) {
        for (const ef of activeStatueTrial.effigies) {
          if (!ef.alive) continue
          const ddx = ef.x - atkBox.x
          const ddy = ef.y - atkBox.y
          const localX = ddx * cosA - ddy * sinA
          const localY = ddx * sinA + ddy * cosA
          if (localX >= -10 && localX <= atkBox.length + 14 && Math.abs(localY) <= atkBox.halfWidth + 14) {
            atkBox.hit = true
            ef.alive = false
            spawnSlashSparks(ef.x, ef.y, char.heading, 20)
            const brokenCount = activeStatueTrial.effigies.filter((e) => !e.alive).length
            floatingTexts.push({
              x: ef.x,
              y: ef.y - 20,
              text: `CURSED EFFIGY SHATTERED (${brokenCount}/3)!`,
              color: '#6b3fa0',
              age: 0,
              duration: 1.25,
            })
          }
        }
        completeStatueTrialIfDone()
      }
      attackBoxes.push(atkBox)
    }

    // Unified solid collision resolver across ALL 5 Continents + Dense Forests, Water Pools & Statues!
    const resolveWorldCollisions = (x: number, y: number, prevX: number, prevY: number): Vec2 => {
      let cx = clamp(x, -WORLD_LIMIT_X, WORLD_LIMIT_X)
      let cy = clamp(y, -WORLD_LIMIT_Y, WORLD_LIMIT_Y)

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

      // 1. Intact Bamboo Training Dummies & Active Statue Effigies
      for (const dm of dummies) {
        if (dm.cutTimer <= 0 && Math.abs(cx - dm.x) < 40 && Math.abs(cy - dm.y) < 40) {
          pushOutCircle(dm.x, dm.y, 11)
        }
      }
      if (activeStatueTrial) {
        for (const ef of activeStatueTrial.effigies) {
          if (ef.alive) pushOutCircle(ef.x, ef.y, 13)
        }
      }

      // 2. Check nearby Continents (Merchants, Liquids, Bridges, Rocks, Lanterns, Gates)
      for (const cur of CONTINENTS) {
        if (Math.abs(cx - cur.origin.x) > 1350 || Math.abs(cy - cur.origin.y) > 1350) continue

        pushOutRect(cur.shopPos.x, cur.shopPos.y, 40, 26)

        if (showBgRef.current) {
          const br = cur.bridge
          const wasOnBridge =
            prevX >= br.minX &&
            prevX <= br.maxX &&
            Math.abs(prevY - br.yCenter) <= br.deckHalfH
          const enteringBridge =
            cx >= br.minX &&
            cx <= br.maxX &&
            Math.abs(prevY - br.yCenter) <= br.halfH + 4 &&
            Math.abs(cy - br.yCenter) <= br.deckHalfH

          if (wasOnBridge || enteringBridge) {
            if (cx >= br.minX && cx <= br.maxX) {
              cy = clamp(cy, br.yCenter - br.halfH, br.yCenter + br.halfH)
            }
          } else {
            const dxP = cx - cur.liquidCenter.x
            const dyP = cy - cur.liquidCenter.y
            const ang = Math.atan2(dyP, dxP)
            const pt = getContinentLiquidBoundary(cur, ang)
            const radX = pt.rx + PLAYER_COLLIDER_R
            const radY = pt.ry + PLAYER_COLLIDER_R
            const nx = dxP / radX
            const ny = dyP / radY
            const d = Math.hypot(nx, ny)
            if (d < 1.0) {
              const atWestOpening = prevX <= br.minX + 6 && Math.abs(cy - br.yCenter) <= br.halfH
              const atEastOpening = prevX >= br.maxX - 6 && Math.abs(cy - br.yCenter) <= br.halfH
              if (!atWestOpening && !atEastOpening) {
                const safeD = Math.max(d, 0.0001)
                cx = cur.liquidCenter.x + (nx / safeD) * radX
                cy = cur.liquidCenter.y + (ny / safeD) * radY
              }
            }
          }

          for (const rk of cur.rocks) {
            pushOutCircle(rk.x, rk.y, rk.r)
          }
          for (const ln of cur.lanterns) {
            pushOutCircle(ln.x, ln.y, 12)
          }
          for (const tp of getGatePillars(cur)) {
            pushOutCircle(tp.x, tp.y, tp.r)
          }
        }
      }

      // 3. O(1) Spatial Hash Tree Collision + Wilderness Water Pools + Mysterious Statues + Waystations!
      if (showBgRef.current) {
        const nearTrees = queryTreesInRect(cx - 90, cy - 90, cx + 90, cy + 90)
        for (const tr of nearTrees) {
          pushOutCircle(tr.x, tr.y, getTreeColliderRadius(tr))
        }

        for (const wp of WILDERNESS_POOLS) {
          if (Math.abs(cx - wp.x) > wp.rx + 45 || Math.abs(cy - wp.y) > wp.ry + 45) continue
          const dxW = cx - wp.x
          const dyW = cy - wp.y
          const ang = Math.atan2(dyW, dxW)
          const pt = getWildernessPoolBoundary(wp, ang)
          const radX = pt.rx + PLAYER_COLLIDER_R
          const radY = pt.ry + PLAYER_COLLIDER_R
          const nx = dxW / radX
          const ny = dyW / radY
          const d = Math.hypot(nx, ny)
          if (d < 1.0) {
            const safeD = Math.max(d, 0.0001)
            cx = wp.x + (nx / safeD) * radX
            cy = wp.y + (ny / safeD) * radY
          }
        }

        for (const st of MYSTERIOUS_STATUES) {
          if (Math.abs(cx - st.x) < 55 && Math.abs(cy - st.y) < 55) {
            pushOutCircle(st.x, st.y, 20)
          }
        }

        for (const ws of WAYSTATIONS) {
          if (Math.abs(cx - ws.x) < 60 && Math.abs(cy - ws.y) < 60) {
            pushOutCircle(ws.x, ws.y, 14)
          }
        }
        for (const rk of WILDERNESS_ROCKS) {
          if (Math.abs(cx - rk.x) < 60 && Math.abs(cy - rk.y) < 60) {
            pushOutCircle(rk.x, rk.y, rk.r)
          }
        }
      }

      return {
        x: clamp(cx, -WORLD_LIMIT_X, WORLD_LIMIT_X),
        y: clamp(cy, -WORLD_LIMIT_Y, WORLD_LIMIT_Y),
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
      const home = CONTINENTS[0].origin
      char.x = home.x
      char.y = home.y
      char.vx = 0
      char.vy = 0
      char.heading = Math.PI
      char.facing = -1
      char.slashTimer = 0
      char.bowCooldown = 0
      char.bowRecoil = 0
      char.dashTimer = 0
      cam.x = home.x
      cam.y = home.y
      continentRef.current = CONTINENTS[0]
      setContinentId('kyoto')
      resetSamuraiTopDownCloth(topRig, home.x, home.y, char.heading)
      resetSamuraiCloth(sideRig, home.x, home.y, char.facing)
    }

    const teleportTo = (wx: number, wy: number, label?: string, color?: string) => {
      const safe = resolveWorldCollisions(wx, wy, wx, wy)
      const next = getNearestContinent(safe.x, safe.y)
      const prevWeather = continentRef.current.weatherKind
      continentRef.current = next
      setContinentId(next.id)

      char.x = safe.x
      char.y = safe.y
      char.vx = 0
      char.vy = 0
      char.slashTimer = 0
      char.bowCooldown = 0
      char.bowRecoil = 0
      char.dashTimer = 0
      cam.x = safe.x
      cam.y = safe.y
      slashArcs.length = 0
      attackBoxes.length = 0
      arrowProjectiles.length = 0
      resetSamuraiTopDownCloth(topRig, safe.x, safe.y, char.heading)
      resetSamuraiCloth(sideRig, safe.x, safe.y, char.facing)
      if (prevWeather !== next.weatherKind) {
        spawnAmbientWeather(next, safe.x, safe.y)
      }
      spawnFootDust(safe.x, safe.y, char.heading, 10, 1.35)
      floatingTexts.push({
        x: safe.x,
        y: safe.y - 48,
        text: label ?? `TELEPORTED · ${next.name.toUpperCase()}`,
        color: color ?? next.badgeColor,
        age: 0,
        duration: 1.75,
      })
    }

    const switchContinent = (id: ContinentId) => {
      const next = getContinentById(id)
      if (!scoutUnlockRef.current && !discoveredRef.current[id]) {
        floatingTexts.push({
          x: char.x,
          y: char.y - 44,
          text: `🔒 ${next.shortName.toUpperCase()} LOCKED! Trek the Expedition Trail on foot (or check Map [M])`,
          color: '#b84239',
          age: 0,
          duration: 2.1,
        })
        return
      }
      teleportTo(next.origin.x, next.origin.y, `TELEPORTED · ${next.name.toUpperCase()}`, next.badgeColor)
    }

    triggerDashRef.current = doDash
    triggerSlashRef.current = doAttack
    triggerSwitchWeaponRef.current = doSwitchWeapon
    switchContinentRef.current = switchContinent
    teleportWorldRef.current = teleportTo
    resetRef.current = doReset

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
        e.preventDefault()
      }
      const wasDown = keysRef.current[k]
      keysRef.current[k] = true

      if (!wasDown && k === 'escape') {
        if (fullMapOpenRef.current) {
          setFullMapOpen(false)
          return
        }
        if (shopOpenRef.current) {
          setShopOpen(false)
          return
        }
      }

      if (!wasDown && k === 'm' && !shopOpenRef.current) {
        setFullMapOpen((v) => !v)
        return
      }

      if (!wasDown && k === 'e' && !fullMapOpenRef.current) {
        // Check if standing near an Unrecognized / Ancient Task Statue first!
        for (const st of MYSTERIOUS_STATUES) {
          if (Math.hypot(char.x - st.x, char.y - st.y) <= 125) {
            startStatueTrial(st)
            return
          }
        }
        const nearest = getNearestContinent(char.x, char.y)
        const distToShop = Math.hypot(char.x - nearest.shopPos.x, char.y - nearest.shopPos.y)
        if (distToShop <= SHOP_INTERACT_RADIUS + 40 || shopOpenRef.current) {
          setShopOpen((v) => !v)
        } else {
          floatingTexts.push({
            x: char.x,
            y: char.y - 36,
            text: `Walk to Merchant Stall or Unknown Statue [?] to Interact!`,
            color: '#54534f',
            age: 0,
            duration: 1.2,
          })
        }
        return
      }

      if (shopOpenRef.current || fullMapOpenRef.current) return

      if (!wasDown && ['1', '2', '3', '4', '5'].includes(k)) {
        const target = CONTINENTS[Number(k) - 1]
        if (target) {
          switchContinent(target.id)
        }
        return
      }

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
    const getStoneFill = (cur: ContinentConfig = continentRef.current) =>
      isWhitePaper() ? cur.stoneFill : cur.stoneBoardFill
    const getWoodFill = (cur: ContinentConfig = continentRef.current) =>
      isWhitePaper() ? cur.woodFill : cur.woodBoardFill

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
      const baseHex = isWhitePaper() ? '#f1ece1' : '#9ea19d'
      const pat = getPaperPattern(baseHex)
      if (pat) {
        ctx.fillStyle = pat
        ctx.fillRect(0, 0, W, H)
      } else {
        ctx.fillStyle = baseHex
        ctx.fillRect(0, 0, W, H)
      }
      const grad = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.72)
      grad.addColorStop(0, 'rgba(255, 255, 255, 0)')
      grad.addColorStop(1, isWhitePaper() ? 'rgba(45, 42, 36, 0.07)' : 'rgba(20, 22, 24, 0.14)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
    }

    // --- 2.5D HIGH-ANGLE WANDERING MERCHANT CHARACTER & WOODEN STALL ON THE MAP! ---
    const drawMerchantShopGround = (cur: ContinentConfig, time: number, nearShop: boolean) => {
      const shopPos = cur.shopPos
      ctx.save()
      ctx.translate(shopPos.x, shopPos.y)

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
      const lookBias = clamp((char.x - shopPos.x) * 0.015, -3.2, 3.2)
      const merchBob = Math.sin(time * 2.6) * 1.0
      const waveSwing = nearShop ? Math.sin(time * 7.2) * 0.34 : Math.sin(time * 2.2) * 0.08
      const clothFill = white ? '#f6f3ea' : '#c4c6c0'
      const shadeFill = white ? '#ded8c8' : '#9da099'

      const drawMerchSandal = (fxOff: number, fyOff: number, sideSign = 1) => {
        ctx.save()
        ctx.translate(fxOff, fyOff)
        // Slight natural outward front-view splay for Master Kenji facing toward the viewer!
        ctx.rotate(sideSign * -0.14)
        // 1. Thick 3D front-facing Waraji sole bumper wall
        ctx.beginPath()
        ctx.moveTo(-3.6, -0.4)
        ctx.lineTo(-3.6, 1.8)
        ctx.quadraticCurveTo(0, 4.4, 3.6, 1.8)
        ctx.lineTo(3.6, -0.4)
        ctx.closePath()
        ctx.fillStyle = shadeFill
        ctx.fill()
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.3
        ctx.stroke()
        // 2. Foreshortened front-view sandal footbed oval
        ctx.beginPath()
        ctx.ellipse(0, 0.1, 3.6, 2.9, 0, 0, Math.PI * 2)
        ctx.fillStyle = shadeFill
        ctx.fill()
        ctx.stroke()
        // 3. Foreshortened front Tabi foot dome
        ctx.beginPath()
        ctx.ellipse(0, -0.4, 2.9, 2.4, 0, 0, Math.PI * 2)
        ctx.fillStyle = clothFill
        ctx.fill()
        ctx.stroke()
        // 4. Symmetric front-facing V-shaped Hanao thong straps + split-toe cleft!
        ctx.beginPath()
        ctx.moveTo(0, 1.4)
        ctx.quadraticCurveTo(-1.4, -0.2, -2.7, -0.8)
        ctx.moveTo(0, 1.4)
        ctx.quadraticCurveTo(1.4, -0.2, 2.7, -0.8)
        ctx.moveTo(0, 2.0)
        ctx.lineTo(0, 1.2)
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
    const drawMerchantShopOverhead = (cur: ContinentConfig, time: number, nearShop: boolean) => {
      const shopPos = cur.shopPos
      ctx.save()
      ctx.translate(shopPos.x, shopPos.y)

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

    const drawBirdsEyeWorldGround = (time: number, nearShopId: ContinentId | null, W: number, H: number) => {
      const white = isWhitePaper()
      const cullX = W * 0.5 + 1450
      const cullY = H * 0.5 + 1450

      if (showBgRef.current) {
        // 0A. Broad Regional Biome Earth Washes across the entire 12,800 x 9,600 world!
        for (const cont of CONTINENTS) {
          const wideR = cont.territoryRadius * 2.9
          if (Math.abs(cont.origin.x - cam.x) > W * 0.5 + wideR || Math.abs(cont.origin.y - cam.y) > H * 0.5 + wideR) {
            continue
          }
          const fillHex = white ? cont.paperBase : cont.boardBase
          const grad = ctx.createRadialGradient(
            cont.origin.x,
            cont.origin.y,
            wideR * 0.16,
            cont.origin.x,
            cont.origin.y,
            wideR
          )
          grad.addColorStop(0, fillHex)
          grad.addColorStop(0.55, fillHex)
          grad.addColorStop(1, 'rgba(241, 236, 225, 0)')
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(cont.origin.x, cont.origin.y, wideR, 0, Math.PI * 2)
          ctx.fill()
        }

        // 0A-2. 18 Wilderness Water & Magma Pools nestled in forest clearings!
        for (const wp of WILDERNESS_POOLS) {
          if (Math.abs(wp.x - cam.x) > W * 0.5 + wp.rx + 60 || Math.abs(wp.y - cam.y) > H * 0.5 + wp.ry + 60) {
            continue
          }
          ctx.save()
          const buildWpPath = (inset = 0) => {
            ctx.beginPath()
            for (let i = 0; i <= 36; i++) {
              const a = (i / 36) * Math.PI * 2
              const pt = getWildernessPoolBoundary(wp, a)
              const px = wp.x + Math.cos(a) * Math.max(8, pt.rx - inset)
              const py = wp.y + Math.sin(a) * Math.max(8, pt.ry - inset)
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            }
            ctx.closePath()
          }

          // Mossy / sandy / volcanic bank rim
          buildWpPath(-5)
          ctx.fillStyle =
            wp.kind === 'magma'
              ? 'rgba(58, 42, 36, 0.34)'
              : wp.kind === 'oasis'
                ? 'rgba(188, 156, 104, 0.30)'
                : 'rgba(116, 130, 114, 0.26)'
          ctx.fill()

          // Shoreline pebbles
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2 + 0.15
            const pt = getWildernessPoolBoundary(wp, a)
            const sr = 5 + hash1(i * 7.3 + wp.seedA) * 4.5
            ctx.save()
            ctx.translate(pt.x + Math.cos(a) * 2, pt.y + Math.sin(a) * 2)
            ctx.rotate(a)
            ctx.fillStyle = wp.kind === 'magma' ? '#524a46' : white ? '#dfd8c8' : '#9aa09a'
            ctx.beginPath()
            ctx.ellipse(0, 0, sr, sr * 0.68, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(54, 53, 50, 0.45)'
            ctx.lineWidth = 0.8
            ctx.stroke()
            ctx.restore()
          }

          // Deep mineral-wash water / magma fill
          buildWpPath(0)
          const pGrad = ctx.createRadialGradient(wp.x - 8, wp.y - 10, 10, wp.x, wp.y, Math.max(wp.rx, wp.ry) * 1.05)
          if (wp.kind === 'oasis') {
            pGrad.addColorStop(0, white ? '#3e8e9c' : '#275c68')
            pGrad.addColorStop(0.6, white ? '#76bec2' : '#46828a')
            pGrad.addColorStop(1, white ? '#d8d4bc' : '#8e9684')
          } else if (wp.kind === 'glacial-lake') {
            pGrad.addColorStop(0, white ? '#3a5d76' : '#243c4f')
            pGrad.addColorStop(0.6, white ? '#7299b2' : '#46687e')
            pGrad.addColorStop(1, white ? '#d5e6ef' : '#89a1ae')
          } else if (wp.kind === 'emerald-lagoon') {
            pGrad.addColorStop(0, white ? '#2c6452' : '#1d4438')
            pGrad.addColorStop(0.6, white ? '#58947d' : '#386856')
            pGrad.addColorStop(1, white ? '#bfd5c0' : '#76907b')
          } else if (wp.kind === 'magma') {
            pGrad.addColorStop(0, '#f0b844')
            pGrad.addColorStop(0.42, '#d8621e')
            pGrad.addColorStop(1, '#4b2d24')
          } else {
            pGrad.addColorStop(0, white ? '#627e8a' : '#364b54')
            pGrad.addColorStop(0.6, white ? '#94aeb6' : '#536c75')
            pGrad.addColorStop(1, white ? '#d6dfdb' : '#849495')
          }
          ctx.fillStyle = pGrad
          ctx.fill()

          ctx.save()
          buildWpPath(0)
          ctx.clip()
          buildWpPath(0)
          ctx.strokeStyle = wp.kind === 'magma' ? 'rgba(42, 22, 18, 0.55)' : 'rgba(38, 52, 58, 0.32)'
          ctx.lineWidth = 8
          ctx.stroke()

          // Gentle concentric surface ripples / magma bubbles
          for (let rIdx = 0; rIdx < 3; rIdx++) {
            const cyc = (time * 0.45 + rIdx * 0.33 + wp.seedA * 0.02) % 1
            const rr = 5 + cyc * 24
            const rxOff = (rIdx - 1) * wp.rx * 0.38
            const ryOff = ((rIdx % 2) * 2 - 1) * wp.ry * 0.25
            ctx.strokeStyle =
              wp.kind === 'magma'
                ? `rgba(255, 224, 120, ${(1 - cyc) * 0.65})`
                : `rgba(255, 253, 246, ${(1 - cyc) * 0.38})`
            ctx.lineWidth = 1.05
            ctx.beginPath()
            ctx.ellipse(wp.x + rxOff, wp.y + ryOff, rr, rr * 0.72, 0, 0, Math.PI * 2)
            ctx.stroke()
          }
          ctx.restore()

          buildWpPath(0)
          ctx.strokeStyle = 'rgba(54, 53, 50, 0.58)'
          ctx.lineWidth = 1.3
          ctx.stroke()
          ctx.restore()
        }

        // 0B. Long Winding Expedition Trail Stepping-Stones
        for (const st of CONNECTOR_STONES) {
          if (Math.abs(st.x - cam.x) > W * 0.5 + 80 || Math.abs(st.y - cam.y) > H * 0.5 + 80) continue
          ctx.save()
          ctx.translate(st.x, st.y)
          ctx.rotate(st.rot)
          ctx.fillStyle = 'rgba(42, 40, 36, 0.06)'
          ctx.beginPath()
          ctx.roundRect(-st.w * 0.5 + 2.5, -st.h * 0.5 + 3, st.w, st.h, 6)
          ctx.fill()
          ctx.fillStyle = white ? '#eae3d2' : '#abada7'
          ctx.beginPath()
          ctx.roundRect(-st.w * 0.5, -st.h * 0.5, st.w, st.h, 5)
          ctx.fill()
          ctx.strokeStyle = 'rgba(64, 62, 58, 0.36)'
          ctx.lineWidth = 1.0
          ctx.stroke()
          ctx.restore()
        }

        // 0C. Midway Waystation Rest Camps (Campfire + Straw Mat + Directional Signpost!)
        for (const ws of WAYSTATIONS) {
          if (Math.abs(ws.x - cam.x) > W * 0.5 + 260 || Math.abs(ws.y - cam.y) > H * 0.5 + 180) continue
          ctx.save()
          ctx.translate(ws.x, ws.y)

          // Warm flickering campfire light aura
          const fireGlow = 0.24 + Math.sin(time * 5.8 + ws.x) * 0.05
          const cGrad = ctx.createRadialGradient(0, 0, 4, 0, 0, 58)
          cGrad.addColorStop(0, `rgba(238, 152, 56, ${fireGlow})`)
          cGrad.addColorStop(1, 'rgba(238, 152, 56, 0)')
          ctx.fillStyle = cGrad
          ctx.beginPath()
          ctx.arc(0, 0, 58, 0, Math.PI * 2)
          ctx.fill()

          // Stone fire-ring & crossed firewood logs
          for (let s = 0; s < 8; s++) {
            const a = (s / 8) * Math.PI * 2
            ctx.fillStyle = '#6c6862'
            ctx.beginPath()
            ctx.arc(Math.cos(a) * 12, Math.sin(a) * 12, 3.6, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#26262b'
            ctx.lineWidth = 0.9
            ctx.stroke()
          }
          ctx.strokeStyle = '#523c28'
          ctx.lineWidth = 3.2
          ctx.beginPath()
          ctx.moveTo(-7, -5)
          ctx.lineTo(7, 5)
          ctx.moveTo(7, -5)
          ctx.lineTo(-7, 5)
          ctx.stroke()

          // Flickering flame core
          ctx.fillStyle = '#ea6c28'
          ctx.beginPath()
          ctx.arc(0, -1, 6.2 + Math.sin(time * 8 + ws.y) * 0.8, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#f8d264'
          ctx.beginPath()
          ctx.arc(0, -1.5, 3.2, 0, Math.PI * 2)
          ctx.fill()

          // Directional Trail Signpost Banner
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
          const banner = `${ws.name.toUpperCase()} · ${ws.signText}`
          const tw = ctx.measureText(banner).width + 20
          ctx.fillStyle = 'rgba(250, 247, 240, 0.94)'
          ctx.strokeStyle = '#26262b'
          ctx.lineWidth = 1.15
          ctx.beginPath()
          ctx.roundRect(-tw * 0.5, -42, tw, 20, 3)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = ws.accent
          ctx.fillRect(-tw * 0.5, -42, 4, 20)
          ctx.fillStyle = '#26262b'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(banner, 2, -31.5)
          ctx.restore()
        }

        // Loop over every visible continent in the unified open world!
        for (const cur of CONTINENTS) {
          if (Math.abs(cur.origin.x - cam.x) > cullX || Math.abs(cur.origin.y - cam.y) > cullY) continue
          const liqC = cur.liquidCenter

          // 1. Continent Terrain Accents (local to cur.origin) & Ground Rocks (world coords)
          ctx.save()
          ctx.save()
          ctx.translate(cur.origin.x, cur.origin.y)
          if (cur.id === 'kyoto') {
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
          } else if (cur.id === 'desert') {
            ctx.strokeStyle = white ? 'rgba(156, 118, 66, 0.24)' : 'rgba(92, 74, 48, 0.24)'
            ctx.lineWidth = 1.25
            for (let dy = -340; dy <= 340; dy += 44) {
              ctx.beginPath()
              for (let dx = -560; dx <= 160; dx += 24) {
                const wave = Math.sin(dx * 0.012 + dy * 0.015) * 14 + Math.cos(dx * 0.025) * 5
                if (dx === -560) ctx.moveTo(dx, dy + wave)
                else ctx.lineTo(dx, dy + wave)
              }
              ctx.stroke()
            }
            ctx.fillStyle = white ? 'rgba(198, 162, 108, 0.14)' : 'rgba(124, 102, 72, 0.16)'
            for (const [dx, dy, rx, ry] of [
              [-360, -140, 120, 42],
              [-330, 120, 110, 38],
              [-140, 310, 130, 36],
            ]) {
              ctx.beginPath()
              ctx.ellipse(dx, dy, rx, ry, -0.14, 0, Math.PI * 2)
              ctx.fill()
            }
          } else if (cur.id === 'frost') {
            ctx.fillStyle = white ? 'rgba(255, 255, 255, 0.42)' : 'rgba(220, 232, 240, 0.18)'
            for (const [sx, sy, rx, ry] of [
              [-350, -90, 118, 44],
              [-310, 110, 102, 36],
              [-150, -280, 96, 32],
              [110, 290, 112, 34],
            ]) {
              ctx.beginPath()
              ctx.ellipse(sx, sy, rx, ry, 0.12, 0, Math.PI * 2)
              ctx.fill()
              ctx.strokeStyle = 'rgba(92, 120, 140, 0.22)'
              ctx.lineWidth = 1.0
              ctx.stroke()
            }
          } else if (cur.id === 'jungle') {
            ctx.fillStyle = white ? 'rgba(104, 138, 92, 0.16)' : 'rgba(56, 82, 54, 0.22)'
            for (const [jx, jy, rx, ry] of [
              [-340, -60, 105, 68],
              [-270, 95, 88, 56],
              [115, 265, 92, 52],
            ]) {
              ctx.beginPath()
              ctx.ellipse(jx, jy, rx, ry, 0.25, 0, Math.PI * 2)
              ctx.fill()
            }
          } else if (cur.id === 'volcano') {
            ctx.strokeStyle = white ? 'rgba(184, 72, 34, 0.28)' : 'rgba(226, 104, 42, 0.34)'
            ctx.lineWidth = 1.3
            for (const [fx, fy, len, ang] of [
              [-390, -110, 95, 0.32],
              [-330, 85, 82, -0.42],
              [-160, 270, 88, 0.18],
              [110, -260, 74, -0.28],
            ]) {
              ctx.beginPath()
              ctx.moveTo(fx, fy)
              ctx.lineTo(fx + Math.cos(ang) * len * 0.45, fy + Math.sin(ang) * len * 0.45 + 6)
              ctx.lineTo(fx + Math.cos(ang) * len, fy + Math.sin(ang) * len - 3)
              ctx.stroke()
            }
          }
          ctx.restore()

          // Continent-specific + nearby Wilderness rocks
          for (const rk of cur.rocks) {
            if (rk.kind === 'zen') {
              drawSketchCircle(rk.x, rk.y, rk.r + 14, rk.seed + 1, 0.18, 0.9)
              drawSketchCircle(rk.x, rk.y, rk.r + 26, rk.seed + 2, 0.14, 0.85)
              ctx.fillStyle = getStoneFill(cur)
            ctx.beginPath()
            ctx.ellipse(rk.x, rk.y, rk.r, rk.r * 0.76, 0.4, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(56, 54, 50, 0.62)'
            ctx.lineWidth = 1.15
            ctx.stroke()
          } else if (rk.kind === 'sandstone') {
            // Layered desert mesa rock
            ctx.fillStyle = 'rgba(72, 54, 34, 0.14)'
            ctx.beginPath()
            ctx.ellipse(rk.x + 5, rk.y + 5, rk.r * 1.12, rk.r * 0.82, 0.18, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = white ? '#d6b27c' : '#9c835d'
            ctx.beginPath()
            ctx.ellipse(rk.x, rk.y, rk.r * 1.05, rk.r * 0.78, 0.18, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(74, 54, 34, 0.68)'
            ctx.lineWidth = 1.2
            ctx.stroke()
            ctx.fillStyle = white ? '#e6c99b' : '#b29a72'
            ctx.beginPath()
            ctx.ellipse(rk.x - 2, rk.y - 3, rk.r * 0.68, rk.r * 0.46, 0.18, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          } else if (rk.kind === 'ice') {
            // Faceted translucent glacial ice crystal cluster
            ctx.save()
            ctx.translate(rk.x, rk.y)
            ctx.fillStyle = 'rgba(42, 68, 88, 0.14)'
            ctx.beginPath()
            ctx.ellipse(4, 5, rk.r * 1.05, rk.r * 0.72, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.beginPath()
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2 + 0.3
              const rr = rk.r * (i % 2 === 0 ? 1.08 : 0.78)
              const px = Math.cos(a) * rr
              const py = Math.sin(a) * rr * 0.82
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            }
            ctx.closePath()
            ctx.fillStyle = white ? '#c4dfe9' : '#7ba0b2'
            ctx.fill()
            ctx.strokeStyle = 'rgba(46, 74, 94, 0.68)'
            ctx.lineWidth = 1.15
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(-rk.r * 0.4, -rk.r * 0.3)
            ctx.lineTo(rk.r * 0.2, -rk.r * 0.55)
            ctx.lineTo(rk.r * 0.45, rk.r * 0.1)
            ctx.closePath()
            ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
            ctx.fill()
            ctx.restore()
          } else if (rk.kind === 'moss') {
            // Weathered temple boulder draped in emerald moss
            ctx.fillStyle = 'rgba(34, 46, 34, 0.15)'
            ctx.beginPath()
            ctx.ellipse(rk.x + 4, rk.y + 4, rk.r * 1.06, rk.r * 0.8, 0.25, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = white ? '#b9bfb2' : '#7e8679'
            ctx.beginPath()
            ctx.ellipse(rk.x, rk.y, rk.r, rk.r * 0.78, 0.25, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(44, 54, 42, 0.65)'
            ctx.lineWidth = 1.15
            ctx.stroke()
            ctx.fillStyle = white ? '#6d8d5b' : '#4a653f'
            ctx.beginPath()
            ctx.ellipse(rk.x - 3, rk.y - 4, rk.r * 0.64, rk.r * 0.42, -0.2, 0, Math.PI * 2)
            ctx.fill()
          } else {
            // Angular dark volcanic basalt rock with faint ember rim
            ctx.save()
            ctx.translate(rk.x, rk.y)
            ctx.fillStyle = 'rgba(24, 18, 16, 0.22)'
            ctx.beginPath()
            ctx.ellipse(4, 5, rk.r * 1.06, rk.r * 0.76, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.beginPath()
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2 + 0.2
              const rr = rk.r * (0.85 + hash1(rk.seed + i * 5) * 0.3)
              const px = Math.cos(a) * rr
              const py = Math.sin(a) * rr * 0.8
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            }
            ctx.closePath()
            ctx.fillStyle = white ? '#5c5550' : '#3d3835'
            ctx.fill()
            ctx.strokeStyle = '#25211f'
            ctx.lineWidth = 1.25
            ctx.stroke()
            ctx.strokeStyle = 'rgba(222, 102, 40, 0.42)'
            ctx.lineWidth = 0.9
            ctx.beginPath()
            ctx.moveTo(-rk.r * 0.35, 0)
            ctx.lineTo(rk.r * 0.32, -rk.r * 0.18)
            ctx.stroke()
            ctx.restore()
          }
        }
        ctx.restore()

        // 2. Continent-Specific Realistic Liquid Body (Koi Pond / Oasis / Glacial Lake / Emerald Lagoon / Molten Magma)
        // Shares exact geometry with `resolveWorldCollisions` via `getContinentLiquidBoundary`!
        ctx.save()
        const pondSegs = 48
        const buildLiquidPath = (inset = 0) => {
          ctx.beginPath()
          for (let i = 0; i <= pondSegs; i++) {
            const a = (i / pondSegs) * Math.PI * 2
            const pt = getContinentLiquidBoundary(cur, a)
            const px = liqC.x + Math.cos(a) * Math.max(8, pt.rx - inset)
            const py = liqC.y + Math.sin(a) * Math.max(8, pt.ry - inset)
            if (i === 0) ctx.moveTo(px, py)
            else ctx.lineTo(px, py)
          }
          ctx.closePath()
        }

        // 2A. Continent Shoreline Bank & Edge Stones / Crust
        buildLiquidPath(-5)
        ctx.fillStyle =
          cur.liquidKind === 'magma'
            ? white
              ? 'rgba(72, 58, 52, 0.34)'
              : 'rgba(34, 24, 20, 0.44)'
            : cur.liquidKind === 'oasis'
              ? white
                ? 'rgba(188, 156, 104, 0.32)'
                : 'rgba(128, 104, 68, 0.32)'
              : cur.liquidKind === 'glacial-lake'
                ? white
                  ? 'rgba(218, 232, 242, 0.52)'
                  : 'rgba(130, 152, 166, 0.35)'
                : cur.liquidKind === 'emerald-lagoon'
                  ? white
                    ? 'rgba(98, 130, 94, 0.28)'
                    : 'rgba(48, 72, 52, 0.34)'
                  : white
                    ? 'rgba(132, 138, 126, 0.24)'
                    : 'rgba(56, 64, 62, 0.28)'
        ctx.fill()

        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2 + 0.12
          const pt = getContinentLiquidBoundary(cur, a)
          if (Math.abs(pt.y - cur.bridge.yCenter) < 36) continue
          const stoneR = 5.5 + hash1(i * 9.3 + cur.liquidSeedA) * 5.0
          ctx.save()
          ctx.translate(pt.x + Math.cos(a) * 2.5, pt.y + Math.sin(a) * 2.5)
          ctx.rotate(a + 0.4)
          ctx.fillStyle =
            cur.liquidKind === 'magma'
              ? white
                ? '#605854'
                : '#3f3a38'
              : cur.liquidKind === 'oasis'
                ? white
                  ? '#dfc89f'
                  : '#9f8b68'
                : cur.liquidKind === 'glacial-lake'
                  ? white
                    ? '#e2edf3'
                    : '#9db4c0'
                  : cur.liquidKind === 'emerald-lagoon'
                    ? white
                      ? '#b8c4ab'
                      : '#73826d'
                    : white
                      ? '#e4dfd0'
                      : '#9ea29c'
          ctx.beginPath()
          ctx.ellipse(0, 0, stoneR, stoneR * 0.68, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = 'rgba(54, 53, 50, 0.45)'
          ctx.lineWidth = 0.85
          ctx.stroke()
          ctx.restore()
        }

        // 2B. Liquid Fill Gradient per Continent
        buildLiquidPath(0)
        const waterGrad = ctx.createRadialGradient(liqC.x - 10, liqC.y - 16, 14, liqC.x, liqC.y, 198)
        if (cur.liquidKind === 'oasis') {
          if (white) {
            waterGrad.addColorStop(0, '#3e8e9c')
            waterGrad.addColorStop(0.48, '#6bb8be')
            waterGrad.addColorStop(0.84, '#b0d8ce')
            waterGrad.addColorStop(1, '#ddd7bd')
          } else {
            waterGrad.addColorStop(0, '#275c68')
            waterGrad.addColorStop(0.5, '#3e7c85')
            waterGrad.addColorStop(0.86, '#6d9b98')
            waterGrad.addColorStop(1, '#949c88')
          }
        } else if (cur.liquidKind === 'glacial-lake') {
          if (white) {
            waterGrad.addColorStop(0, '#3a5d76')
            waterGrad.addColorStop(0.48, '#638ba5')
            waterGrad.addColorStop(0.84, '#a2c3d6')
            waterGrad.addColorStop(1, '#d7e7f0')
          } else {
            waterGrad.addColorStop(0, '#243c4f')
            waterGrad.addColorStop(0.5, '#3d5c72')
            waterGrad.addColorStop(0.85, '#648396')
            waterGrad.addColorStop(1, '#8ba3b0')
          }
        } else if (cur.liquidKind === 'emerald-lagoon') {
          if (white) {
            waterGrad.addColorStop(0, '#2c6452')
            waterGrad.addColorStop(0.48, '#4d8a74')
            waterGrad.addColorStop(0.84, '#88b89f')
            waterGrad.addColorStop(1, '#c3d7c3')
          } else {
            waterGrad.addColorStop(0, '#1d4438')
            waterGrad.addColorStop(0.5, '#315e4e')
            waterGrad.addColorStop(0.85, '#547d69')
            waterGrad.addColorStop(1, '#78927d')
          }
        } else if (cur.liquidKind === 'magma') {
          waterGrad.addColorStop(0, '#f0b844')
          waterGrad.addColorStop(0.32, '#db6a20')
          waterGrad.addColorStop(0.72, '#a32c18')
          waterGrad.addColorStop(1, '#4b2d24')
        } else {
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
        }
        ctx.fillStyle = waterGrad
        ctx.fill()

        // Clip all interior liquid details cleanly inside shoreline
        ctx.save()
        buildLiquidPath(0)
        ctx.clip()

        // 2C. Recessed bank shadow
        buildLiquidPath(0)
        ctx.strokeStyle =
          cur.liquidKind === 'magma'
            ? 'rgba(42, 22, 18, 0.56)'
            : white
              ? 'rgba(42, 56, 62, 0.34)'
              : 'rgba(18, 26, 30, 0.45)'
        ctx.lineWidth = 10
        ctx.stroke()

        if (cur.liquidKind === 'magma') {
          // Molten Lava Flow Veins, Cooling Basalt Slag Rafts & Bubbling Magma Rings!
          for (let i = 0; i < 12; i++) {
            const bandY = liqC.y - 155 + i * 28 + Math.sin(time * 0.9 + i) * 5
            const bandX = liqC.x + Math.sin(time * 0.55 + i * 1.6) * 26
            const halfLen = 28 + hash1(i * 4.7) * 42
            const pulse = 0.45 + 0.25 * Math.sin(time * 2.4 + i * 1.9)
            ctx.strokeStyle = `rgba(255, 220, 112, ${pulse})`
            ctx.lineWidth = 2.4
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(bandX - halfLen, bandY)
            ctx.quadraticCurveTo(bandX, bandY + Math.sin(time * 1.8 + i) * 7, bandX + halfLen, bandY)
            ctx.stroke()
          }
          // Cooling dark basalt crust chunks floating slowly on lava
          for (const [cxOff, cyOff, rx, ry, rot] of [
            [-36, -92, 22, 14, 0.4],
            [32, 98, 26, 15, -0.3],
            [-28, 64, 17, 11, 0.7],
            [40, -56, 19, 12, -0.5],
          ]) {
            const dx = Math.sin(time * 0.4 + cyOff) * 2.4
            const dy = Math.cos(time * 0.35 + cxOff) * 1.8
            ctx.save()
            ctx.translate(liqC.x + cxOff + dx, liqC.y + cyOff + dy)
            ctx.rotate(rot)
            ctx.fillStyle = '#3d332e'
            ctx.beginPath()
            ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(244, 148, 52, 0.55)'
            ctx.lineWidth = 1.2
            ctx.stroke()
            ctx.restore()
          }
          // Bubbling molten vents
          for (const [bxOff, byOff, ph] of [
            [-14, -74, 0.2],
            [18, 72, 1.4],
            [-22, 112, 2.7],
            [24, -108, 4.1],
          ]) {
            const cyc = (time * 0.65 + ph) % 1
            const r = 3 + cyc * 14
            ctx.strokeStyle = `rgba(255, 226, 132, ${(1 - cyc) * 0.78})`
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.arc(liqC.x + bxOff, liqC.y + byOff, r, 0, Math.PI * 2)
            ctx.stroke()
          }
        } else {
          // 2D. Submerged riverbed stones with water refraction shimmer
          for (let i = 0; i < 16; i++) {
            const ang = hash1(i * 11.7 + cur.liquidSeedA) * Math.PI * 2
            const distFrac = 0.25 + hash1(i * 5.3 + cur.liquidSeedB) * 0.62
            const bp = getContinentLiquidBoundary(cur, ang)
            const wobX = Math.sin(time * 1.4 + i) * 0.9
            const wobY = Math.cos(time * 1.1 + i * 1.7) * 0.7
            const sx = liqC.x + Math.cos(ang) * bp.rx * distFrac + wobX
            const sy = liqC.y + Math.sin(ang) * bp.ry * distFrac + wobY
            const sr = 6 + hash1(i * 7.1) * 9
            ctx.fillStyle = white ? 'rgba(54, 72, 78, 0.16)' : 'rgba(22, 34, 38, 0.22)'
            ctx.beginPath()
            ctx.ellipse(sx, sy, sr, sr * 0.7, ang, 0, Math.PI * 2)
            ctx.fill()
          }

          // 2E. Continent Water Life / Ice Floes
          if (cur.liquidKind === 'glacial-lake') {
            // Drifting geometric arctic ice floes!
            const floes: [number, number, number, number, number][] = [
              [-32, -88, 28, 18, 0.28],
              [28, -56, 22, 15, -0.4],
              [-26, 92, 30, 19, -0.2],
              [34, 114, 24, 16, 0.45],
              [4, -124, 20, 13, 0.1],
            ]
            for (const [fx, fy, frx, fry, rot] of floes) {
              const driftX = Math.sin(time * 0.45 + fy * 0.04) * 3.0
              const driftY = Math.cos(time * 0.38 + fx * 0.04) * 2.2
              ctx.save()
              ctx.translate(liqC.x + fx + driftX, liqC.y + fy + driftY)
              ctx.rotate(rot + Math.sin(time * 0.3 + fx) * 0.04)
              // Underwater ice shelf edge
              ctx.fillStyle = 'rgba(138, 192, 214, 0.38)'
              ctx.beginPath()
              ctx.ellipse(2, 4, frx * 1.06, fry * 1.06, 0, 0, Math.PI * 2)
              ctx.fill()
              // Crisp faceted white snow/ice slab
              ctx.beginPath()
              ctx.moveTo(-frx, -fry * 0.3)
              ctx.lineTo(-frx * 0.3, -fry)
              ctx.lineTo(frx * 0.85, -fry * 0.65)
              ctx.lineTo(frx, fry * 0.4)
              ctx.lineTo(frx * 0.15, fry)
              ctx.lineTo(-frx * 0.85, fry * 0.55)
              ctx.closePath()
              ctx.fillStyle = white ? '#f1f7fa' : '#c6dae4'
              ctx.fill()
              ctx.strokeStyle = 'rgba(66, 98, 118, 0.58)'
              ctx.lineWidth = 1.0
              ctx.stroke()
              ctx.restore()
            }
          } else {
            // Articulated Swimming Fish (Koi in Kyoto, Golden Desert Carp in Oasis, Jade/Gold Koi in Lagoon!)
            const fishSpecs =
              cur.liquidKind === 'oasis'
                ? [
                    { cx: liqC.x - 10, cy: liqC.y - 78, rx: 42, ry: 30, spd: 0.48, ph: 0.4, body: '#f5d27a', spot: '#d46b2c', sz: 0.96 },
                    { cx: liqC.x + 12, cy: liqC.y + 82, rx: 44, ry: 34, spd: -0.4, ph: 2.3, body: '#faf4e6', spot: '#e2a43c', sz: 0.9 },
                    { cx: liqC.x - 20, cy: liqC.y + 42, rx: 28, ry: 24, spd: 0.54, ph: 4.1, body: '#e8b64c', spot: '#faf4e6', sz: 0.82 },
                  ]
                : cur.liquidKind === 'emerald-lagoon'
                  ? [
                      { cx: liqC.x - 6, cy: liqC.y - 86, rx: 44, ry: 34, spd: 0.42, ph: 0.5, body: '#e8bd54', spot: '#faf5e8', sz: 1.02 },
                      { cx: liqC.x + 8, cy: liqC.y + 92, rx: 46, ry: 36, spd: -0.38, ph: 2.2, body: '#faf4e8', spot: '#cf533e', sz: 0.96 },
                      { cx: liqC.x - 24, cy: liqC.y + 48, rx: 32, ry: 26, spd: 0.5, ph: 4.3, body: '#a8d4b8', spot: '#2e5948', sz: 0.88 },
                    ]
                  : [
                      { cx: liqC.x - 6, cy: liqC.y - 88, rx: 46, ry: 34, spd: 0.42, ph: 0.2, body: '#f5f0e4', spot: '#c44634', sz: 1.05 },
                      { cx: liqC.x + 6, cy: liqC.y + 96, rx: 48, ry: 38, spd: -0.36, ph: 2.1, body: '#e6b44c', spot: '#f5f0e4', sz: 0.98 },
                      { cx: liqC.x - 24, cy: liqC.y + 48, rx: 32, ry: 28, spd: 0.52, ph: 4.0, body: '#f5f0e4', spot: '#2c2f36', sz: 0.86 },
                      { cx: liqC.x + 24, cy: liqC.y - 42, rx: 30, ry: 26, spd: -0.46, ph: 5.1, body: '#c44634', spot: '#f5f0e4', sz: 0.84 },
                    ]
            for (const k of fishSpecs) {
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

              ctx.fillStyle = 'rgba(20, 32, 38, 0.22)'
              ctx.beginPath()
              ctx.ellipse(-2, 5.5, 11.5, 3.8, 0, 0, Math.PI * 2)
              ctx.fill()

              ctx.fillStyle = 'rgba(248, 244, 234, 0.55)'
              ctx.beginPath()
              ctx.ellipse(2, -4.6, 4.4, 2.0, -0.5 + tailWag * 0.14, 0, Math.PI * 2)
              ctx.ellipse(2, 4.6, 4.4, 2.0, 0.5 - tailWag * 0.14, 0, Math.PI * 2)
              ctx.fill()

              ctx.beginPath()
              ctx.moveTo(-8.5, 0)
              ctx.quadraticCurveTo(-13.5, -3.5 + tailWag * 3.2, -17.5, -4.2 + tailWag * 4.5)
              ctx.quadraticCurveTo(-14.5, tailWag * 2.5, -17.5, 4.2 + tailWag * 4.5)
              ctx.quadraticCurveTo(-13.5, 3.5 + tailWag * 3.2, -8.5, 0)
              ctx.fillStyle = 'rgba(245, 240, 228, 0.72)'
              ctx.fill()

              ctx.beginPath()
              ctx.moveTo(9.5, 0)
              ctx.quadraticCurveTo(4.5, -4.4, -3.5, -2.5 + tailWag * 0.7)
              ctx.lineTo(-9.5, tailWag * 1.6)
              ctx.lineTo(-3.5, 2.5 + tailWag * 0.7)
              ctx.quadraticCurveTo(4.5, 4.4, 9.5, 0)
              ctx.closePath()
              ctx.fillStyle = k.body
              ctx.fill()

              ctx.fillStyle = k.spot
              ctx.beginPath()
              ctx.ellipse(2.5, 0, 4.2, 2.3, 0.1, 0, Math.PI * 2)
              ctx.fill()
              ctx.beginPath()
              ctx.arc(-3.5, 0.4 + tailWag * 0.4, 1.8, 0, Math.PI * 2)
              ctx.fill()
              ctx.restore()
            }
          }

          // Translucent surface water glaze for submersion depth
          ctx.fillStyle =
            cur.liquidKind === 'oasis'
              ? white
                ? 'rgba(124, 198, 202, 0.18)'
                : 'rgba(42, 92, 98, 0.24)'
              : cur.liquidKind === 'emerald-lagoon'
                ? white
                  ? 'rgba(104, 168, 140, 0.20)'
                  : 'rgba(34, 72, 58, 0.26)'
                : white
                  ? 'rgba(148, 174, 182, 0.22)'
                  : 'rgba(46, 68, 76, 0.28)'
          ctx.fillRect(liqC.x - 165, liqC.y - 225, 330, 450)

          // 2F. Soft rippled reflection of the Bridge cast onto the water
          ctx.save()
          const br = cur.bridge
          for (let ry = br.yCenter - 28; ry <= br.yCenter + 48; ry += 6) {
            const waveShift = Math.sin(time * 2.4 + ry * 0.18) * 3.5
            ctx.fillStyle = white ? 'rgba(48, 56, 58, 0.11)' : 'rgba(18, 24, 28, 0.18)'
            ctx.fillRect(br.minX + 6 + waveShift, ry, br.maxX - br.minX - 12, 4)
          }
          ctx.restore()

          // 2G. Drifting sunlight caustic bands & shoreline meniscus
          ctx.save()
          for (let i = 0; i < 14; i++) {
            const bandY = liqC.y - 165 + i * 26 + Math.sin(time * 0.8 + i) * 4
            const bandX = liqC.x + Math.sin(time * 0.65 + i * 1.9) * 32
            const halfLen = 22 + hash1(i * 4.3) * 36
            const shimmer = 0.12 + 0.10 * Math.sin(time * 1.9 + i * 2.3)
            ctx.strokeStyle = white
              ? `rgba(255, 253, 246, ${shimmer * 1.65})`
              : `rgba(220, 232, 234, ${shimmer})`
            ctx.lineWidth = 1.4
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(bandX - halfLen, bandY)
            ctx.quadraticCurveTo(bandX, bandY + Math.sin(time * 2.1 + i) * 3.2, bandX + halfLen, bandY)
            ctx.stroke()
          }

          const lapInset = 4.2 + Math.sin(time * 1.8) * 1.4
          buildLiquidPath(lapInset)
          ctx.strokeStyle = white ? 'rgba(255, 253, 248, 0.34)' : 'rgba(210, 224, 226, 0.20)'
          ctx.lineWidth = 1.1
          ctx.setLineDash([14, 10, 6, 12])
          ctx.lineDashOffset = -time * 6
          ctx.stroke()
          ctx.setLineDash([])
          ctx.restore()

          // 2H. Concentric surface water ripples
          for (const [rxOff, ryOff, phase] of [
            [-18, -92, 0],
            [22, 92, 1.7],
            [-36, 52, 3.2],
            [14, -46, 4.6],
          ]) {
            const cyc = (time * 0.42 + phase) % 1
            const r1 = 5 + cyc * 26
            const r2 = Math.max(2, r1 - 6.5)
            const a1 = (1 - cyc) * (white ? 0.42 : 0.28)
            ctx.strokeStyle = white ? `rgba(255, 253, 246, ${a1})` : `rgba(205, 220, 224, ${a1})`
            ctx.lineWidth = 1.0
            ctx.beginPath()
            ctx.ellipse(liqC.x + rxOff, liqC.y + ryOff, r1, r1 * 0.72, 0, 0, Math.PI * 2)
            ctx.stroke()
            if (cyc > 0.18) {
              ctx.strokeStyle = `rgba(48, 62, 68, ${a1 * 0.45})`
              ctx.lineWidth = 0.75
              ctx.beginPath()
              ctx.ellipse(liqC.x + rxOff, liqC.y + ryOff, r2, r2 * 0.72, 0, 0, Math.PI * 2)
              ctx.stroke()
            }
          }

          // 2I. Floating Lily Pads & Lotus Blossoms (Kyoto, Oasis & Emerald Lagoon)
          if (cur.liquidKind !== 'glacial-lake') {
            const lilyPads: [number, number, number, number, boolean][] =
              cur.liquidKind === 'emerald-lagoon'
                ? [
                    [liqC.x + 36, liqC.y - 76, 16, 0.5, true],
                    [liqC.x + 16, liqC.y - 54, 12, 2.2, false],
                    [liqC.x - 32, liqC.y + 104, 17, -0.8, true],
                    [liqC.x - 48, liqC.y + 88, 11, 1.4, false],
                    [liqC.x + 36, liqC.y + 112, 14, -2.1, true],
                    [liqC.x - 28, liqC.y - 98, 13, 0.9, false],
                  ]
                : cur.liquidKind === 'oasis'
                  ? [
                      [liqC.x + 34, liqC.y - 68, 12, 0.6, true],
                      [liqC.x - 30, liqC.y + 94, 13, -0.7, true],
                      [liqC.x + 32, liqC.y + 102, 10, -2.0, false],
                    ]
                  : [
                      [liqC.x + 38, liqC.y - 72, 14, 0.5, true],
                      [liqC.x + 19, liqC.y - 54, 10, 2.2, false],
                      [liqC.x - 32, liqC.y + 108, 15, -0.8, true],
                      [liqC.x - 49, liqC.y + 94, 9.5, 1.4, false],
                      [liqC.x + 36, liqC.y + 118, 11.5, -2.1, false],
                    ]
            for (const [lx, ly, lr, ang, hasLotus] of lilyPads) {
              const driftX = Math.sin(time * 0.9 + lx * 0.05) * 1.2
              const driftY = Math.cos(time * 0.7 + ly * 0.05) * 0.9
              const px = lx + driftX
              const py = ly + driftY

              ctx.fillStyle = 'rgba(24, 36, 40, 0.22)'
              ctx.beginPath()
              ctx.ellipse(px + 2.5, py + 4.2, lr * 0.98, lr * 0.84, 0, 0, Math.PI * 2)
              ctx.fill()

              ctx.beginPath()
              ctx.arc(px, py, lr, ang + 0.28, ang + Math.PI * 2 - 0.28)
              ctx.lineTo(px, py)
              ctx.closePath()
              ctx.fillStyle =
                cur.liquidKind === 'emerald-lagoon'
                  ? white
                    ? '#7ea674'
                    : '#52734e'
                  : white
                    ? '#a4b596'
                    : '#73826d'
              ctx.fill()
              ctx.strokeStyle = 'rgba(46, 56, 44, 0.55)'
              ctx.lineWidth = 0.95
              ctx.stroke()

              ctx.strokeStyle = 'rgba(246, 243, 234, 0.30)'
              ctx.lineWidth = 0.65
              ctx.beginPath()
              for (let v = 0; v < 5; v++) {
                const va = ang + 0.85 + v * 1.05
                ctx.moveTo(px, py)
                ctx.lineTo(px + Math.cos(va) * lr * 0.78, py + Math.sin(va) * lr * 0.78)
              }
              ctx.stroke()

              if (hasLotus) {
                ctx.save()
                ctx.translate(px - 1, py - 1)
                for (let p = 0; p < 6; p++) {
                  ctx.save()
                  ctx.rotate((p / 6) * Math.PI * 2 + time * 0.06)
                  ctx.fillStyle =
                    cur.liquidKind === 'emerald-lagoon'
                      ? p % 2 === 0
                        ? '#f8e6ea'
                        : '#e8a8b4'
                      : p % 2 === 0
                        ? '#faf4ec'
                        : '#f1d6cf'
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
          }
        }

        ctx.restore() // end liquid clip

        // Crisp sumi-e ink outline framing the organic shoreline
        buildLiquidPath(0)
        ctx.strokeStyle = cur.liquidKind === 'magma' ? 'rgba(54, 34, 28, 0.78)' : 'rgba(54, 53, 50, 0.56)'
        ctx.lineWidth = 1.35
        ctx.stroke()
        ctx.restore()

        // 3. Stepping Stones & Central Courtyard
        for (const st of cur.stones) {
          ctx.save()
          ctx.translate(st.x, st.y)
          ctx.rotate(st.rot)
          ctx.fillStyle = 'rgba(42, 40, 36, 0.06)'
          ctx.beginPath()
          ctx.roundRect(-st.w * 0.5 + 2.5, -st.h * 0.5 + 3, st.w, st.h, 6)
          ctx.fill()
          ctx.fillStyle = getStoneFill(cur)
          ctx.beginPath()
          ctx.roundRect(-st.w * 0.5, -st.h * 0.5, st.w, st.h, 5)
          ctx.fill()
          ctx.strokeStyle = 'rgba(64, 62, 58, 0.38)'
          ctx.lineWidth = 1.0
          ctx.stroke()
          ctx.restore()
        }

        drawSketchCircle(cur.origin.x, cur.origin.y, 26, 5, 0.26, 1.0)
        drawSketchCircle(cur.origin.x, cur.origin.y, 82, 9, 0.22, 0.95)

        // 4. Continent-Themed Bridge over Liquid Body
        ctx.save()
        const br = cur.bridge
        const bx0 = br.minX + 4
        const bw = br.maxX - br.minX - 8
        const by = br.yCenter
        ctx.fillStyle = 'rgba(34, 34, 38, 0.14)'
        ctx.beginPath()
        ctx.roundRect(bx0 + 2, by - 24, bw, 62, 4)
        ctx.fill()

        const deckColor =
          br.style === 'obsidian'
            ? white
              ? '#5d5753'
              : '#3e3a38'
            : br.style === 'sandstone'
              ? white
                ? '#e2cba2'
                : '#a89674'
              : br.style === 'bamboo'
                ? white
                  ? '#cfd4ad'
                  : '#8f9678'
                : getWoodFill(cur)
        ctx.fillStyle = deckColor
        ctx.beginPath()
        ctx.roundRect(bx0, by - 32, bw, 64, 3)
        ctx.fill()
        ctx.strokeStyle = 'rgba(54, 53, 50, 0.68)'
        ctx.lineWidth = 1.25
        ctx.stroke()

        // Deck plank / slab lines
        ctx.beginPath()
        const plankStep = br.style === 'sandstone' || br.style === 'obsidian' ? 22 : br.style === 'bamboo' ? 10 : 14
        for (let px = bx0 + plankStep; px < bx0 + bw - 4; px += plankStep) {
          ctx.moveTo(px, by - 31)
          ctx.lineTo(px, by + 31)
        }
        ctx.strokeStyle = br.style === 'obsidian' ? 'rgba(222, 108, 46, 0.28)' : 'rgba(54, 53, 50, 0.32)'
        ctx.lineWidth = 0.9
        ctx.stroke()

        // Bridge railings
        const railColor =
          br.style === 'frost'
            ? white
              ? '#f4f9fc'
              : '#cbd9e2'
            : br.style === 'obsidian'
              ? white
                ? '#453f3c'
                : '#2d2927'
              : br.style === 'bamboo'
                ? white
                  ? '#9aa878'
                  : '#6d7a58'
                : getStoneFill(cur)
        ctx.fillStyle = railColor
        ctx.fillRect(bx0 - 2, by - 35, bw + 4, 6)
        ctx.fillRect(bx0 - 2, by + 29, bw + 4, 6)
        ctx.strokeStyle = 'rgba(54, 53, 50, 0.72)'
        ctx.lineWidth = 1.1
        ctx.strokeRect(bx0 - 2, by - 35, bw + 4, 6)
        ctx.strokeRect(bx0 - 2, by + 29, bw + 4, 6)
        for (let pIdx = 0; pIdx < 4; pIdx++) {
          const postX = bx0 + 4 + (pIdx / 3) * (bw - 8)
          for (const postY of [by - 32, by + 32]) {
            ctx.beginPath()
            ctx.arc(postX, postY, 4.5, 0, Math.PI * 2)
            ctx.fillStyle = br.style === 'obsidian' ? '#c9532b' : railColor
            ctx.fill()
            ctx.stroke()
          }
        }
        ctx.restore()

        // 5. Stone / Regional Lanterns
        for (const ln of cur.lanterns) {
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
          ctx.fillStyle = cur.id === 'volcano' ? (white ? '#5d5550' : '#3d3835') : getStoneFill(cur)
          ctx.fill()
          ctx.strokeStyle = 'rgba(56, 54, 50, 0.62)'
          ctx.lineWidth = 1.05
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(0, 0, 3.2, 0, Math.PI * 2)
          if (cur.id === 'volcano') {
            ctx.fillStyle = '#e87c34'
            ctx.fill()
          } else if (cur.id === 'frost') {
            ctx.fillStyle = '#e8f4fa'
            ctx.fill()
          }
          ctx.stroke()
          ctx.restore()
        }

        // 6. North Gate Shadow
        ctx.fillStyle = 'rgba(42, 40, 36, 0.10)'
        ctx.beginPath()
        ctx.roundRect(cur.gatePos.x - 84, cur.gatePos.y + 25, 196, 22, 6)
        ctx.fill()

        // Wayshrine Seal Ring at Continent Center!
        const isAttuned = scoutUnlockRef.current || Boolean(discoveredRef.current[cur.id])
        ctx.save()
        ctx.translate(cur.origin.x, cur.origin.y)
        ctx.strokeStyle = isAttuned ? `${cur.badgeColor}66` : 'rgba(84, 83, 79, 0.25)'
        ctx.lineWidth = isAttuned ? 1.8 : 1.1
        ctx.setLineDash([7, 5])
        ctx.beginPath()
        ctx.arc(0, 0, 38, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
        } // end visible continents loop

        // 7. Wilderness Trail Boulders (viewport-culled)
        for (const rk of WILDERNESS_ROCKS) {
          if (Math.abs(rk.x - cam.x) > W * 0.5 + 80 || Math.abs(rk.y - cam.y) > H * 0.5 + 80) continue
          ctx.fillStyle = 'rgba(42, 40, 36, 0.14)'
          ctx.beginPath()
          ctx.ellipse(rk.x + 4, rk.y + 4, rk.r * 1.05, rk.r * 0.76, 0.2, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle =
            rk.kind === 'sandstone'
              ? white
                ? '#d6b27c'
                : '#9c835d'
              : rk.kind === 'ice'
                ? white
                  ? '#c4dfe9'
                  : '#7ba0b2'
                : rk.kind === 'basalt'
                  ? white
                    ? '#5c5550'
                    : '#3d3835'
                  : white
                    ? '#b9bfb2'
                    : '#7e8679'
          ctx.beginPath()
          ctx.ellipse(rk.x, rk.y, rk.r, rk.r * 0.76, 0.25, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = 'rgba(54, 53, 50, 0.65)'
          ctx.lineWidth = 1.15
          ctx.stroke()
        }

        // 8. Mysterious Unrecognized Stone Statues ('???' Ancient Task Relics) + Summoned Effigies!
        for (const st of MYSTERIOUS_STATUES) {
          if (Math.abs(st.x - cam.x) > W * 0.5 + 180 || Math.abs(st.y - cam.y) > H * 0.5 + 180) continue
          const done = Boolean(completedStatuesRef.current[st.id])
          const nearSt = Math.hypot(char.x - st.x, char.y - st.y) <= 125
          ctx.save()
          ctx.translate(st.x, st.y)

          // Sacred mossy stone altar ring on ground
          ctx.fillStyle = done ? 'rgba(229, 190, 98, 0.18)' : 'rgba(92, 68, 138, 0.12)'
          ctx.beginPath()
          ctx.ellipse(0, 4, 38, 24, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = done ? '#c68a32' : nearSt ? '#6b3fa0' : 'rgba(54, 53, 50, 0.35)'
          ctx.lineWidth = nearSt || done ? 1.5 : 1.0
          ctx.setLineDash([5, 4])
          ctx.stroke()
          ctx.setLineDash([])

          // Cast shadow
          ctx.fillStyle = 'rgba(32, 30, 28, 0.18)'
          ctx.beginPath()
          ctx.ellipse(10, 8, 22, 11, 0.1, 0, Math.PI * 2)
          ctx.fill()

          // Stepped weathered stone pedestal
          ctx.fillStyle = white ? '#cfc8b8' : '#8e908a'
          ctx.strokeStyle = '#26262b'
          ctx.lineWidth = 1.25
          ctx.beginPath()
          ctx.roundRect(-20, -2, 40, 14, 2)
          ctx.fill()
          ctx.stroke()
          ctx.fillStyle = white ? '#ded8ca' : '#9fa29b'
          ctx.beginPath()
          ctx.roundRect(-15, -10, 30, 10, 2)
          ctx.fill()
          ctx.stroke()

          // Eroded Ancient Statue Silhouette (unrecognized weathered relic!)
          ctx.fillStyle = white ? '#b9b4a6' : '#7d807a'
          ctx.beginPath()
          if (st.style === 'kitsune') {
            ctx.moveTo(-11, -10)
            ctx.lineTo(-9, -34)
            ctx.lineTo(-13, -48)
            ctx.lineTo(-3, -40)
            ctx.lineTo(3, -40)
            ctx.lineTo(13, -48)
            ctx.lineTo(9, -34)
            ctx.lineTo(11, -10)
          } else if (st.style === 'obelisk') {
            ctx.moveTo(-11, -10)
            ctx.lineTo(-7, -50)
            ctx.lineTo(0, -58)
            ctx.lineTo(7, -50)
            ctx.lineTo(11, -10)
          } else if (st.style === 'oni') {
            ctx.moveTo(-13, -10)
            ctx.lineTo(-14, -36)
            ctx.lineTo(-18, -50)
            ctx.lineTo(-7, -42)
            ctx.lineTo(7, -42)
            ctx.lineTo(18, -50)
            ctx.lineTo(14, -36)
            ctx.lineTo(13, -10)
          } else {
            // Hooded monk / eroded guardian
            ctx.moveTo(-13, -10)
            ctx.quadraticCurveTo(-15, -28, -9, -40)
            ctx.arc(0, -43, 9, Math.PI, 0)
            ctx.quadraticCurveTo(15, -28, 13, -10)
          }
          ctx.closePath()
          ctx.fill()
          ctx.stroke()

          // Ancient weathered cracks & moss patch + glowing spirit seal eye!
          ctx.strokeStyle = 'rgba(42, 40, 38, 0.55)'
          ctx.lineWidth = 0.9
          ctx.beginPath()
          ctx.moveTo(-5, -34)
          ctx.lineTo(2, -26)
          ctx.lineTo(-1, -18)
          ctx.stroke()

          ctx.fillStyle = done ? '#f5c84c' : '#7c52b8'
          ctx.beginPath()
          ctx.arc(0, -31, 3.2 + Math.sin(time * 4.5 + st.x) * 0.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }

        // Active Statue Trial Cursed Spirit Effigies!
        if (activeStatueTrial) {
          for (const ef of activeStatueTrial.effigies) {
            if (!ef.alive) continue
            const bob = Math.sin(time * 5.2 + ef.phase) * 3.0
            ctx.save()
            ctx.translate(ef.x, ef.y)
            ctx.fillStyle = 'rgba(107, 63, 160, 0.22)'
            ctx.beginPath()
            ctx.ellipse(0, 4, 18, 10, 0, 0, Math.PI * 2)
            ctx.fill()

            ctx.translate(0, bob)
            ctx.fillStyle = '#362946'
            ctx.strokeStyle = '#b84239'
            ctx.lineWidth = 1.4
            ctx.beginPath()
            ctx.moveTo(-9, 2)
            ctx.lineTo(-6, -26)
            ctx.lineTo(0, -33)
            ctx.lineTo(6, -26)
            ctx.lineTo(9, 2)
            ctx.closePath()
            ctx.fill()
            ctx.stroke()

            // Glowing cursed crimson eye rune
            ctx.fillStyle = '#f25c54'
            ctx.beginPath()
            ctx.arc(0, -16, 3.4, 0, Math.PI * 2)
            ctx.fill()
            ctx.restore()
          }
        }

        // 9. O(1) Spatial-Grid Realistic 2.5D Flora Trunks (sorted front-to-back by Y!)
        const visibleTrees = queryTreesInRect(
          cam.x - W * 0.5 - 120,
          cam.y - H * 0.5 - 120,
          cam.x + W * 0.5 + 120,
          cam.y + H * 0.5 + 120
        ).sort((a, b) => a.y - b.y)

        ctx.save()
        for (const tr of visibleTrees) {
          const colR = getTreeColliderRadius(tr)
          ctx.save()
          ctx.translate(tr.x, tr.y)

          // Soft organic dappled shadow cast SE onto the ground
          ctx.fillStyle = white ? 'rgba(38, 42, 34, 0.12)' : 'rgba(18, 22, 20, 0.20)'
          ctx.beginPath()
          ctx.ellipse(
            15,
            11,
            tr.kind === 'cactus' ? tr.r * 0.56 : tr.r * 0.96,
            tr.kind === 'cactus' ? tr.r * 0.34 : tr.r * 0.58,
            0.08,
            0,
            Math.PI * 2
          )
          ctx.fill()

          // Natural soil / sand / snow / ash patch under base
          ctx.fillStyle =
            tr.kind === 'palm' || tr.kind === 'cactus'
              ? white
                ? 'rgba(186, 152, 98, 0.28)'
                : 'rgba(122, 98, 62, 0.28)'
              : tr.kind === 'snow-pine'
                ? white
                  ? 'rgba(222, 236, 245, 0.45)'
                  : 'rgba(148, 168, 180, 0.32)'
                : tr.kind === 'charred'
                  ? white
                    ? 'rgba(72, 62, 58, 0.28)'
                    : 'rgba(36, 30, 28, 0.36)'
                  : white
                    ? 'rgba(118, 124, 98, 0.22)'
                    : 'rgba(58, 68, 54, 0.28)'
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

                ctx.beginPath()
                ctx.moveTo(x0 - w * 0.22, y0)
                ctx.lineTo(x1 - w * 0.22, y1)
                ctx.strokeStyle = white ? 'rgba(238, 244, 218, 0.55)' : 'rgba(195, 210, 178, 0.35)'
                ctx.lineWidth = 1.0
                ctx.stroke()

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
          } else if (tr.kind === 'palm') {
            // Real Date / Oasis Palm: gracefully curved tapering ringed trunk!
            const lean = (hash1(tr.seed * 2.3) > 0.5 ? 1 : -1) * (12 + hash1(tr.seed * 5.1) * 10)
            const trunkH = tr.r * 0.92
            const segs = 9
            for (let s = 0; s < segs; s++) {
              const t0 = s / segs
              const t1 = (s + 1) / segs
              const x0 = lean * t0 * t0
              const y0 = 3 - trunkH * t0
              const x1 = lean * t1 * t1
              const y1 = 3 - trunkH * t1
              const w0 = 8.4 - t0 * 3.8
              ctx.beginPath()
              ctx.moveTo(x0, y0)
              ctx.lineTo(x1, y1)
              ctx.lineCap = 'round'
              ctx.strokeStyle = '#3b2f24'
              ctx.lineWidth = w0 + 2.2
              ctx.stroke()
              ctx.strokeStyle = s % 2 === 0 ? (white ? '#9c7e58' : '#735e43') : white ? '#866947' : '#635038'
              ctx.lineWidth = w0
              ctx.stroke()
              // Fibrous palm trunk ring band
              ctx.beginPath()
              ctx.moveTo(x1 - w0 * 0.55, y1 + 1)
              ctx.lineTo(x1 + w0 * 0.55, y1 - 1)
              ctx.strokeStyle = 'rgba(42, 32, 22, 0.55)'
              ctx.lineWidth = 1.0
              ctx.stroke()
            }
          } else if (tr.kind === 'cactus') {
            // Real Desert Saguaro Cactus: ribbed vertical emerald-sage column & asymmetric upward side arms!
            const cLit = white ? '#7d9b6b' : '#58704c'
            const cShade = white ? '#567048' : '#3c5034'
            const cInk = '#2c3628'
            const h = tr.r * 0.98
            const armDir = hash1(tr.seed * 3.1) > 0.5 ? 1 : -1

            // Left & right curved upward saguaro arms
            const drawArm = (side: number, startY: number, reachX: number, riseH: number) => {
              ctx.beginPath()
              ctx.moveTo(side * 5, startY)
              ctx.quadraticCurveTo(side * reachX, startY + 2, side * reachX, startY - riseH)
              ctx.lineCap = 'round'
              ctx.strokeStyle = cInk
              ctx.lineWidth = 11.4
              ctx.stroke()
              ctx.strokeStyle = side > 0 ? cShade : cLit
              ctx.lineWidth = 8.6
              ctx.stroke()
              // Vertical rib highlight along arm
              ctx.beginPath()
              ctx.moveTo(side * (reachX - 1.2), startY - 2)
              ctx.lineTo(side * (reachX - 1.2), startY - riseH + 2)
              ctx.strokeStyle = 'rgba(232, 240, 210, 0.35)'
              ctx.lineWidth = 1.1
              ctx.stroke()
            }
            drawArm(armDir, -h * 0.42, 16, 20)
            drawArm(-armDir, -h * 0.58, 14, 16)

            // Main vertical ribbed column
            ctx.beginPath()
            ctx.moveTo(-6.8, 3)
            ctx.lineTo(-6.0, -h)
            ctx.arc(0, -h, 6.0, Math.PI, 0)
            ctx.lineTo(6.8, 3)
            ctx.quadraticCurveTo(0, 6.5, -6.8, 3)
            ctx.closePath()
            const cGrad = ctx.createLinearGradient(-7, 0, 7, 0)
            cGrad.addColorStop(0, cLit)
            cGrad.addColorStop(0.6, cLit)
            cGrad.addColorStop(1, cShade)
            ctx.fillStyle = cGrad
            ctx.fill()
            ctx.strokeStyle = cInk
            ctx.lineWidth = 1.4
            ctx.stroke()

            // Vertical cactus pleats / ribs
            ctx.strokeStyle = 'rgba(40, 52, 34, 0.45)'
            ctx.lineWidth = 0.85
            ctx.beginPath()
            for (const rxOff of [-2.8, 0.2, 3.0]) {
              ctx.moveTo(rxOff, 2)
              ctx.lineTo(rxOff * 0.85, -h - 3)
            }
            ctx.stroke()
          } else if (tr.kind === 'pine' || tr.kind === 'snow-pine') {
            // Real Pine / Alpine Snow-Pine: rugged tapered bark trunk, spreading roots & branching boughs!
            const isSnow = tr.kind === 'snow-pine'
            const barkLit = isSnow ? (white ? '#655952' : '#4a423e') : white ? '#76614d' : '#594b3e'
            const barkShade = isSnow ? (white ? '#443c38' : '#312b28') : white ? '#524234' : '#3a3028'
            const barkInk = '#2b2824'
            const lean = (hash1(tr.seed * 2.1) - 0.5) * 14
            const trunkH = tr.r * 0.58

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

            ctx.strokeStyle = 'rgba(34, 28, 22, 0.52)'
            ctx.lineWidth = 0.95
            ctx.beginPath()
            for (const bxOff of [-4.5, -0.8, 3.2]) {
              ctx.moveTo(bxOff, 2.5)
              ctx.quadraticCurveTo(bxOff + lean * 0.35, -trunkH * 0.48, bxOff * 0.45 + lean * 0.85, -trunkH + 4)
            }
            ctx.stroke()

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
          } else if (tr.kind === 'charred') {
            // Volcanic Charred Ironwood Tree: gnarled dark obsidian-charcoal trunk with subtle ember bark fissures!
            const barkLit = white ? '#4f4642' : '#393330'
            const barkShade = white ? '#302a28' : '#221e1d'
            const barkInk = '#1c1816'
            const lean = (hash1(tr.seed * 2.9) - 0.5) * 14
            const trunkH = tr.r * 0.62

            for (const rAng of [-2.4, -0.5, 0.45, 2.45]) {
              const rx = Math.cos(rAng) * (colR * 0.64)
              const ry = Math.sin(rAng) * (colR * 0.38) + 3
              ctx.beginPath()
              ctx.moveTo(0, 2)
              ctx.lineTo(rx * 0.55, ry * 0.45 - 2)
              ctx.lineTo(rx, ry)
              ctx.lineCap = 'round'
              ctx.strokeStyle = barkInk
              ctx.lineWidth = 4.6
              ctx.stroke()
              ctx.strokeStyle = barkLit
              ctx.lineWidth = 2.6
              ctx.stroke()
            }

            ctx.beginPath()
            ctx.moveTo(-9.5, 4)
            ctx.bezierCurveTo(-7.5, -trunkH * 0.38, -5.5 + lean * 0.6, -trunkH * 0.7, -3.8 + lean, -trunkH)
            ctx.lineTo(4.0 + lean, -trunkH)
            ctx.bezierCurveTo(6.0 + lean * 0.6, -trunkH * 0.7, 8.5, -trunkH * 0.38, 10.2, 4)
            ctx.quadraticCurveTo(0, 7, -9.5, 4)
            ctx.closePath()
            const vGrad = ctx.createLinearGradient(-9, 0, 10, 0)
            vGrad.addColorStop(0, barkLit)
            vGrad.addColorStop(0.55, barkLit)
            vGrad.addColorStop(1, barkShade)
            ctx.fillStyle = vGrad
            ctx.fill()
            ctx.strokeStyle = barkInk
            ctx.lineWidth = 1.35
            ctx.stroke()

            // Subtle smoldering ember crack inside charred bark
            ctx.strokeStyle = 'rgba(228, 104, 38, 0.58)'
            ctx.lineWidth = 1.0
            ctx.beginPath()
            ctx.moveTo(-1.5, 1)
            ctx.quadraticCurveTo(lean * 0.4, -trunkH * 0.45, lean * 0.8 + 0.5, -trunkH * 0.82)
            ctx.stroke()
          } else {
            // Real Broadleaf Maple OR Mossy Jungle Canopy Tree
            const isJungle = tr.kind === 'jungle'
            const barkLit = isJungle ? (white ? '#6d614d' : '#524b3d') : white ? '#66564a' : '#4d443e'
            const barkShade = isJungle ? (white ? '#4b4536' : '#373329') : white ? '#473c34' : '#352f2b'
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
              ctx.fillStyle = isJungle
                ? l % 2 === 0
                  ? 'rgba(72, 118, 66, 0.50)'
                  : 'rgba(110, 142, 76, 0.46)'
                : l % 2 === 0
                  ? 'rgba(154, 72, 54, 0.52)'
                  : 'rgba(176, 108, 62, 0.46)'
              ctx.beginPath()
              ctx.ellipse(0, 0, 2.8, 1.5, 0, 0, Math.PI * 2)
              ctx.fill()
              ctx.restore()
            }

            // Spreading / buttress roots
            for (const rAng of isJungle ? [-2.5, -1.7, -0.5, 0.4, 1.5, 2.5] : [-2.3, -0.4, 0.5, 2.5]) {
              const rx = Math.cos(rAng) * (colR * (isJungle ? 0.68 : 0.56))
              const ry = Math.sin(rAng) * (colR * (isJungle ? 0.44 : 0.36)) + 3
              ctx.beginPath()
              ctx.moveTo(0, 2)
              ctx.quadraticCurveTo(rx * 0.5, ry * 0.4 - 1.5, rx, ry)
              ctx.lineCap = 'round'
              ctx.strokeStyle = barkInk
              ctx.lineWidth = isJungle ? 5.6 : 4.5
              ctx.stroke()
              ctx.strokeStyle = barkLit
              ctx.lineWidth = isJungle ? 3.4 : 2.6
              ctx.stroke()
            }

            // Tapered curving trunk
            const baseW = isJungle ? 10.2 : 8.2
            ctx.beginPath()
            ctx.moveTo(-baseW, 4)
            ctx.quadraticCurveTo(-baseW * 0.66 + lean * 0.3, -trunkH * 0.5, -4.0 + lean, -trunkH)
            ctx.lineTo(4.4 + lean, -trunkH)
            ctx.quadraticCurveTo(baseW * 0.72 + lean * 0.3, -trunkH * 0.5, baseW + 0.6, 4)
            ctx.quadraticCurveTo(0, 7, -baseW, 4)
            ctx.closePath()
            const mGrad = ctx.createLinearGradient(-baseW, 0, baseW + 1, 0)
            mGrad.addColorStop(0, barkLit)
            mGrad.addColorStop(0.6, barkLit)
            mGrad.addColorStop(1, barkShade)
            ctx.fillStyle = mGrad
            ctx.fill()
            ctx.strokeStyle = barkInk
            ctx.lineWidth = 1.3
            ctx.stroke()

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

      // Always render Collectibles, Dummies & visible Merchant Shop Outposts!
      drawCollectiblesAndDummies(time)
      for (const cur of CONTINENTS) {
        if (Math.abs(cur.shopPos.x - cam.x) > W * 0.5 + 160 || Math.abs(cur.shopPos.y - cam.y) > H * 0.5 + 160) {
          continue
        }
        drawMerchantShopGround(cur, time, nearShopId === cur.id)
      }
    }

    const drawBirdsEyeOverhead = (time: number, nearShopId: ContinentId | null, W: number, H: number) => {
      for (const cur of CONTINENTS) {
        if (Math.abs(cur.shopPos.x - cam.x) <= W * 0.5 + 160 && Math.abs(cur.shopPos.y - cam.y) <= H * 0.5 + 160) {
          drawMerchantShopOverhead(cur, time, nearShopId === cur.id)
        }
      }

      if (!showBgRef.current) return

      const white = isWhitePaper()
      const cullX = W * 0.5 + 1450
      const cullY = H * 0.5 + 1450

      for (const cur of CONTINENTS) {
        if (Math.abs(cur.origin.x - cam.x) > cullX || Math.abs(cur.origin.y - cam.y) > cullY) continue

        // Continent North Gate Top Beam (Torii / Desert Sandstone Arch / Frost Torii / Moss Temple / Obsidian Torii)
        ctx.save()
        ctx.translate(cur.gatePos.x, cur.gatePos.y)
        const pillarFill =
          cur.gateStyle === 'obsidian'
            ? white
              ? '#4f4845'
              : '#342f2d'
            : cur.gateStyle === 'sandstone'
              ? white
                ? '#dfC79c'
                : '#a6916d'
              : getStoneFill(cur)
      for (const px of [-56, 56]) {
        ctx.beginPath()
        ctx.arc(px, 4, 8, 0, Math.PI * 2)
        ctx.fillStyle = pillarFill
        ctx.fill()
        ctx.strokeStyle = 'rgba(54, 53, 50, 0.65)'
        ctx.lineWidth = 1.15
        ctx.stroke()
      }

      if (cur.gateStyle === 'sandstone') {
        // Stepped Desert Sandstone Gateway Arch
        ctx.fillStyle = white ? '#e3cba0' : '#a8936f'
        ctx.beginPath()
        ctx.roundRect(-84, -10, 168, 20, 3)
        ctx.fill()
        ctx.strokeStyle = 'rgba(72, 54, 34, 0.72)'
        ctx.lineWidth = 1.3
        ctx.stroke()
        ctx.fillStyle = white ? '#d4b37e' : '#967e58'
        ctx.fillRect(-66, -15, 132, 7)
        ctx.strokeRect(-66, -15, 132, 7)
      } else if (cur.gateStyle === 'temple') {
        // Carved Mossy Jungle Temple Stone Lintel
        ctx.fillStyle = white ? '#c4cbb6' : '#858f7c'
        ctx.beginPath()
        ctx.roundRect(-90, -10, 180, 20, 4)
        ctx.fill()
        ctx.strokeStyle = 'rgba(46, 56, 42, 0.72)'
        ctx.lineWidth = 1.3
        ctx.stroke()
        ctx.fillStyle = white ? '#6c9159' : '#4a683e'
        ctx.beginPath()
        ctx.ellipse(-34, -4, 24, 5, 0.1, 0, Math.PI * 2)
        ctx.ellipse(28, 3, 22, 5, -0.1, 0, Math.PI * 2)
        ctx.fill()
      } else {
        // Curved Torii Beam (Kyoto Stone / Frost Snow-Capped / Volcanic Obsidian)
        ctx.beginPath()
        ctx.moveTo(-98, -8)
        ctx.quadraticCurveTo(0, -14, 98, -8)
        ctx.lineTo(94, 8)
        ctx.quadraticCurveTo(0, 12, -94, 8)
        ctx.closePath()
        ctx.fillStyle = pillarFill
        ctx.fill()
        ctx.strokeStyle = 'rgba(54, 53, 50, 0.72)'
        ctx.lineWidth = 1.3
        ctx.stroke()

        if (cur.gateStyle === 'frost-torii') {
          ctx.fillStyle = white ? '#f5fafd' : '#d2e2ec'
          ctx.beginPath()
          ctx.moveTo(-92, -7)
          ctx.quadraticCurveTo(0, -13, 92, -7)
          ctx.lineTo(86, 0)
          ctx.quadraticCurveTo(0, -4, -86, 0)
          ctx.closePath()
          ctx.fill()
        } else if (cur.gateStyle === 'obsidian') {
          ctx.strokeStyle = '#d45828'
          ctx.lineWidth = 2.0
          ctx.beginPath()
          ctx.moveTo(-88, 0)
          ctx.quadraticCurveTo(0, -3, 88, 0)
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.moveTo(-90, 0)
          ctx.quadraticCurveTo(0, -3, 90, 0)
          ctx.strokeStyle = 'rgba(54, 53, 50, 0.35)'
          ctx.lineWidth = 0.9
          ctx.stroke()
        }
      }
      ctx.restore()
      } // end visible continent gates loop

      // Floating Callout Prompts above nearby Mysterious Statues!
      for (const st of MYSTERIOUS_STATUES) {
        if (Math.abs(st.x - cam.x) > W * 0.5 + 180 || Math.abs(st.y - cam.y) > H * 0.5 + 180) continue
        const done = Boolean(completedStatuesRef.current[st.id])
        const nearSt = Math.hypot(char.x - st.x, char.y - st.y) <= 135
        const bobY = Math.sin(time * 3.4 + st.x) * 2.2
        ctx.save()
        ctx.translate(st.x, st.y - 68 + bobY)
        const label = done
          ? `★ ${st.trueName.toUpperCase()}`
          : nearSt
            ? `[E] or CLICK · AWAKEN STATUE TASK (+${st.rewardGold}G)`
            : '❓ UNRECOGNIZED STATUE'
        ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        const bw = ctx.measureText(label).width + 18
        ctx.fillStyle = done ? '#26262b' : nearSt ? '#4a326e' : 'rgba(250, 247, 240, 0.94)'
        ctx.strokeStyle = done ? '#e5be62' : '#26262b'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.roundRect(-bw * 0.5, -10, bw, 20, 4)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = done ? '#e5be62' : nearSt ? '#faf7f0' : '#26262b'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, 0, 0.5)
        ctx.restore()
      }

      // Real Botanical 2.5D Flora Crowns via O(1) Spatial Hash Grid!
      const visibleCrowns = queryTreesInRect(
        cam.x - W * 0.5 - 130,
        cam.y - H * 0.5 - 130,
        cam.x + W * 0.5 + 130,
        cam.y + H * 0.5 + 130
      ).sort((a, b) => a.y - b.y)

      for (const tr of visibleCrowns) {
        const swayX = Math.sin(time * 1.1 + tr.seed) * 2.2
        const swayY = Math.cos(time * 0.85 + tr.seed * 1.3) * 1.2

        ctx.save()
        if (tr.kind === 'bamboo') {
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
        } else if (tr.kind === 'palm') {
          // Real Arching Feathered Date Palm Fronds + Date Clusters!
          const lean = (hash1(tr.seed * 2.3) > 0.5 ? 1 : -1) * (12 + hash1(tr.seed * 5.1) * 10)
          const trunkH = tr.r * 0.92
          ctx.translate(tr.x + lean + swayX * 0.85, tr.y + 3 - trunkH + swayY * 0.75)

          // Small clusters of golden-amber desert dates beneath crown
          for (const [dx, dy] of [
            [-5, 6],
            [5, 7],
          ]) {
            ctx.fillStyle = '#c88732'
            ctx.beginPath()
            ctx.arc(dx, dy, 3.2, 0, Math.PI * 2)
            ctx.arc(dx + 2.5, dy + 2.2, 2.6, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#3b2f24'
            ctx.lineWidth = 0.7
            ctx.stroke()
          }

          const frondCount = 10
          for (let f = 0; f < frondCount; f++) {
            const ang = (f / frondCount) * Math.PI * 2 + tr.seed * 0.4 + Math.sin(time * 1.3 + f) * 0.04
            const fLen = tr.r * (0.68 + hash1(tr.seed + f * 3.7) * 0.28)
            const isUpper = f % 2 === 0
            ctx.save()
            ctx.rotate(ang)
            // Arching palm midrib
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.quadraticCurveTo(fLen * 0.55, -5, fLen, 4)
            ctx.strokeStyle = '#38462c'
            ctx.lineWidth = 1.6
            ctx.stroke()

            // Feathered split leaflets along both sides of midrib
            const leaflets = 7
            for (let lf = 1; lf <= leaflets; lf++) {
              const t = lf / (leaflets + 0.5)
              const lx = fLen * t
              const ly = -5 * (2 * t * (1 - t)) + 4 * t * t
              const ll = (1 - Math.abs(t - 0.48) * 1.2) * 13 + 4
              for (const side of [-1, 1]) {
                ctx.beginPath()
                ctx.moveTo(lx, ly)
                ctx.quadraticCurveTo(lx + ll * 0.45, ly + side * ll * 0.55, lx + ll * 0.78, ly + side * ll * 0.92)
                ctx.quadraticCurveTo(lx + ll * 0.25, ly + side * ll * 0.45, lx - 1.5, ly)
                ctx.closePath()
                ctx.fillStyle = isUpper
                  ? white
                    ? '#7a9a5a'
                    : '#567042'
                  : white
                    ? '#5c7a45'
                    : '#405632'
                ctx.fill()
                ctx.strokeStyle = 'rgba(34, 44, 28, 0.45)'
                ctx.lineWidth = 0.55
                ctx.stroke()
              }
            }
            ctx.restore()
          }
        } else if (tr.kind === 'cactus') {
          // Delicate desert blossoms crowning the Saguaro tips
          const h = tr.r * 0.98
          ctx.translate(tr.x + swayX * 0.15, tr.y - h - 4)
          for (const [bx, by] of [
            [-2, 0],
            [2.5, -1],
            [0, -2.5],
          ]) {
            ctx.fillStyle = white ? '#f4e6c4' : '#d6c8a8'
            ctx.beginPath()
            ctx.arc(bx, by, 2.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#b85c44'
            ctx.lineWidth = 0.7
            ctx.stroke()
          }
        } else if (tr.kind === 'pine' || tr.kind === 'snow-pine') {
          // Real Organic Pine OR Snow-Laden Alpine Spruce!
          const isSnow = tr.kind === 'snow-pine'
          const lean = (hash1(tr.seed * 2.1) - 0.5) * 14
          const trunkH = tr.r * 0.58
          ctx.translate(tr.x + lean + swayX * 0.55, tr.y - trunkH + swayY * 0.55)

          const boughCount = 16
          for (let b = 0; b < boughCount; b++) {
            const tier = b < 6 ? 0 : b < 12 ? 1 : 2
            const ang = (b / 6) * Math.PI * 2 + tr.seed * 0.7 + tier * 0.55
            const radFrac = tier === 0 ? 0.58 : tier === 1 ? 0.38 : 0.18
            const bx = Math.cos(ang) * tr.r * radFrac + (hash1(tr.seed + b * 3.1) - 0.5) * 8
            const by = Math.sin(ang) * tr.r * radFrac * 0.64 - tier * 10 + 8
            const br = tr.r * (tier === 0 ? 0.34 : tier === 1 ? 0.32 : 0.28)
            const fillCol = isSnow
              ? tier === 0
                ? white
                  ? '#364d52'
                  : '#26383d'
                : tier === 1
                  ? white
                    ? '#4b686e'
                    : '#374f55'
                  : white
                    ? '#64838a'
                    : '#4b666c'
              : tier === 0
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

            if (isSnow && tier >= 1) {
              // Crisp white snowdrift cap clinging to upper pine boughs!
              ctx.beginPath()
              ctx.ellipse(0, -br * 0.14, br * 0.76, br * 0.44, 0, Math.PI, Math.PI * 2)
              ctx.quadraticCurveTo(br * 0.35, br * 0.08, 0, -br * 0.04)
              ctx.quadraticCurveTo(-br * 0.4, br * 0.1, -br * 0.76, -br * 0.14)
              ctx.closePath()
              ctx.fillStyle = white ? 'rgba(247, 251, 254, 0.92)' : 'rgba(214, 228, 236, 0.86)'
              ctx.fill()
              ctx.strokeStyle = 'rgba(78, 104, 122, 0.42)'
              ctx.lineWidth = 0.7
              ctx.stroke()
            } else {
              ctx.strokeStyle = tier === 2 ? 'rgba(232, 238, 214, 0.34)' : 'rgba(28, 36, 28, 0.34)'
              ctx.lineWidth = 0.75
              ctx.beginPath()
              for (let n = 0; n < 8; n++) {
                const na = (n / 8) * Math.PI * 2 + tr.seed + b
                ctx.moveTo(Math.cos(na) * br * 0.18, Math.sin(na) * br * 0.14)
                ctx.lineTo(Math.cos(na) * br * 0.92, Math.sin(na) * br * 0.66)
              }
              ctx.stroke()
            }
            ctx.restore()
          }
        } else if (tr.kind === 'charred') {
          // Volcanic Charred Ironwood Crown: stark twisted burnt branches + sparse smoldering ember-ash leaf tufts!
          const lean = (hash1(tr.seed * 2.9) - 0.5) * 14
          const trunkH = tr.r * 0.62
          ctx.translate(tr.x + lean + swayX * 0.35, tr.y - trunkH + swayY * 0.35)

          // Twisted gnarled charcoal branches
          ctx.lineCap = 'round'
          for (let b = 0; b < 7; b++) {
            const ba = (b / 7) * Math.PI * 2 + tr.seed * 0.5
            const bLen = tr.r * (0.58 + hash1(tr.seed + b * 4.1) * 0.25)
            const mx = Math.cos(ba) * bLen * 0.52 + Math.sin(b) * 6
            const my = Math.sin(ba) * bLen * 0.38 - 6
            const ex = Math.cos(ba) * bLen
            const ey = Math.sin(ba) * bLen * 0.46 - 10
            ctx.beginPath()
            ctx.moveTo(0, 2)
            ctx.quadraticCurveTo(mx, my, ex, ey)
            ctx.strokeStyle = '#1f1b1a'
            ctx.lineWidth = 4.2
            ctx.stroke()
            ctx.strokeStyle = white ? '#4a413e' : '#352f2d'
            ctx.lineWidth = 2.1
            ctx.stroke()
          }

          // Sparse smoldering russet-ash leaf clusters
          for (let c = 0; c < 11; c++) {
            const ca = (c / 11) * Math.PI * 2 + tr.seed * 0.8
            const cd = tr.r * (0.28 + hash1(tr.seed + c * 5.3) * 0.42)
            const cx = Math.cos(ca) * cd
            const cy = Math.sin(ca) * cd * 0.58 - 8
            const cr = tr.r * (0.16 + hash1(tr.seed + c * 2.7) * 0.09)
            ctx.fillStyle = c % 3 === 0 ? '#a84426' : c % 2 === 0 ? '#693c32' : '#4a3d3a'
            ctx.beginPath()
            ctx.ellipse(cx, cy, cr, cr * 0.72, ca, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = 'rgba(30, 22, 20, 0.65)'
            ctx.lineWidth = 0.8
            ctx.stroke()
          }
        } else {
          // Real Broadleaf Maple OR Lush Emerald Jungle Canopy!
          const isJungle = tr.kind === 'jungle'
          const lean = (hash1(tr.seed * 3.7) - 0.5) * 10
          const trunkH = tr.r * 0.56
          ctx.translate(tr.x + lean + swayX * 0.7, tr.y - trunkH + swayY * 0.7)

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
            const col = isJungle
              ? tier === 0
                ? white
                  ? '#2e583b'
                  : '#20402b'
                : tier === 1
                  ? white
                    ? '#467c4f'
                    : '#325b3a'
                  : white
                    ? '#69a263'
                    : '#4b7847'
              : tier === 0
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
            ctx.strokeStyle = isJungle ? 'rgba(26, 46, 30, 0.52)' : 'rgba(46, 32, 28, 0.52)'
            ctx.lineWidth = 0.8
            ctx.stroke()

            if (tier === 2) {
              ctx.fillStyle = isJungle
                ? white
                  ? 'rgba(218, 240, 178, 0.42)'
                  : 'rgba(176, 206, 146, 0.28)'
                : white
                  ? 'rgba(236, 198, 152, 0.45)'
                  : 'rgba(210, 174, 136, 0.28)'
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
      const modalOpen = shopOpenRef.current || fullMapOpenRef.current
      let inX = modalOpen ? 0 : (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0) + vIn.dx
      let inY = modalOpen ? 0 : (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0) + vIn.dy
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

      if (activeStatueTrial) {
        activeStatueTrial.timeLeft -= rawDt
        if (activeStatueTrial.timeLeft <= 0) {
          const st = activeStatueTrial.statue
          activeStatueTrial = null
          floatingTexts.push({
            x: st.x,
            y: st.y - 54,
            text: 'STATUE INCENSE FADED · Press [E] at Statue to Retry!',
            color: '#8c4a44',
            age: 0,
            duration: 1.9,
          })
        }
      }

      for (let i = floatingTexts.length - 1; i >= 0; i--) {
        floatingTexts[i].age += rawDt
        floatingTexts[i].y -= 24 * rawDt
        if (floatingTexts[i].age >= floatingTexts[i].duration) floatingTexts.splice(i, 1)
      }

      // Detect walking across continent borders & attuning new Continent Wayshrines!
      const nearestContinent = getNearestContinent(char.x, char.y)
      if (nearestContinent.id !== continentRef.current.id) {
        const prevWeather = continentRef.current.weatherKind
        continentRef.current = nearestContinent
        setContinentId(nearestContinent.id)
        if (prevWeather !== nearestContinent.weatherKind) {
          spawnAmbientWeather(nearestContinent, cam.x, cam.y)
        }
        floatingTexts.push({
          x: char.x,
          y: char.y - 46,
          text: `ENTERED REGION · ${nearestContinent.name.toUpperCase()} (${nearestContinent.tierLabel})`,
          color: nearestContinent.badgeColor,
          age: 0,
          duration: 1.95,
        })
      }

      if (
        !discoveredRef.current[nearestContinent.id] &&
        Math.hypot(char.x - nearestContinent.origin.x, char.y - nearestContinent.origin.y) <= WAYSHRINE_UNLOCK_RADIUS
      ) {
        const updated = { ...discoveredRef.current, [nearestContinent.id]: true }
        discoveredRef.current = updated
        setDiscoveredContinents(updated)
        spawnSlashSparks(char.x, char.y, -Math.PI * 0.5, 22)
        floatingTexts.push({
          x: char.x,
          y: char.y - 64,
          text: `✦ WAYSHRINE UNLOCKED · ${nearestContinent.shortName.toUpperCase()} TELEPORT ENABLED! ✦`,
          color: '#c68a32',
          age: 0,
          duration: 2.6,
        })
      }

      const curContinent = continentRef.current
      let nearShopId: ContinentId | null = null
      for (const cont of CONTINENTS) {
        if (Math.hypot(char.x - cont.shopPos.x, char.y - cont.shopPos.y) <= SHOP_INTERACT_RADIUS) {
          nearShopId = cont.id
          break
        }
      }
      const isNearShop = nearShopId !== null

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
      const wk = curContinent.weatherKind
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i]
        pt.life += dt
        if (pt.kind === 'weather') {
          if (wk === 'sand') {
            pt.x += (pt.vx + Math.sin(elapsed * 2.2 + i) * 24) * dt
            pt.y += (pt.vy + Math.cos(elapsed * 1.6 + i) * 10) * dt
            if (pt.x - cam.x > 820 || Math.abs(pt.y - cam.y) > 580) {
              pt.x = cam.x - 760 - Math.random() * 140
              pt.y = cam.y + (Math.random() - 0.5) * 980
            }
          } else if (wk === 'ember') {
            pt.x += (pt.vx + Math.sin(elapsed * 2.1 + i) * 16) * dt
            pt.y += pt.vy * dt
            if (pt.y - cam.y < -560 || Math.abs(pt.x - cam.x) > 820) {
              pt.x = cam.x + (Math.random() - 0.5) * 1300
              pt.y = cam.y + 460 + Math.random() * 100
            }
          } else if (wk === 'firefly') {
            pt.x += (pt.vx + Math.sin(elapsed * 1.4 + i * 1.7) * 20) * dt
            pt.y += (pt.vy + Math.cos(elapsed * 1.2 + i * 2.1) * 16) * dt
            if (Math.abs(pt.x - cam.x) > 800 || Math.abs(pt.y - cam.y) > 560) {
              pt.x = cam.x + (Math.random() - 0.5) * 1200
              pt.y = cam.y + (Math.random() - 0.5) * 860
            }
          } else {
            // leaf & snow gentle drift
            pt.x += (pt.vx + Math.sin(elapsed * 1.3 + i) * (wk === 'snow' ? 16 : 12)) * dt
            pt.y += (pt.vy + Math.cos(elapsed * 1.1 + i) * 8) * dt
            pt.rot += pt.vrot * dt
            if (Math.abs(pt.x - cam.x) > 820 || Math.abs(pt.y - cam.y) > 580) {
              pt.x = cam.x + (Math.random() - 0.5) * 1300
              pt.y = cam.y - 460 - Math.random() * 100
            }
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

      // Step flying Samurai Arrows & check hits against Bamboo Dummies + solid continent obstacles!
      for (let i = arrowProjectiles.length - 1; i >= 0; i--) {
        const ar = arrowProjectiles[i]
        ar.age += dt
        ar.x += ar.vx * dt
        ar.y += ar.vy * dt

        if (
          ar.age >= ar.maxAge ||
          Math.abs(ar.x) > WORLD_LIMIT_X ||
          Math.abs(ar.y) > WORLD_LIMIT_Y
        ) {
          arrowProjectiles.splice(i, 1)
          continue
        }

        // Stop arrow if it strikes ANY continent's Merchant Stall, Tree/Cactus, Rock, Lantern, Gate Pillar, or Statue!
        let blocked = false
        for (const cont of CONTINENTS) {
          if (Math.abs(ar.x - cont.origin.x) > 1350 || Math.abs(ar.y - cont.origin.y) > 1350) continue
          if (Math.abs(ar.x - cont.shopPos.x) < 42 && Math.abs(ar.y - cont.shopPos.y) < 28) {
            blocked = true
            break
          }
          if (!showBgRef.current) continue
          for (const rk of cont.rocks) {
            if (Math.hypot(ar.x - rk.x, ar.y - rk.y) < rk.r) {
              blocked = true
              break
            }
          }
          if (blocked) break
          for (const ln of cont.lanterns) {
            if (Math.hypot(ar.x - ln.x, ar.y - ln.y) < 12) {
              blocked = true
              break
            }
          }
          if (blocked) break
          for (const tp of getGatePillars(cont)) {
            if (Math.hypot(ar.x - tp.x, ar.y - tp.y) < tp.r) {
              blocked = true
              break
            }
          }
          if (blocked) break
        }
        if (!blocked && showBgRef.current) {
          const nearTrees = queryTreesInRect(ar.x - 65, ar.y - 65, ar.x + 65, ar.y + 65)
          for (const tr of nearTrees) {
            if (Math.hypot(ar.x - tr.x, ar.y - tr.y) < getTreeColliderRadius(tr)) {
              blocked = true
              break
            }
          }
          if (!blocked) {
            for (const rk of WILDERNESS_ROCKS) {
              if (Math.abs(ar.x - rk.x) < 40 && Math.abs(ar.y - rk.y) < 40 && Math.hypot(ar.x - rk.x, ar.y - rk.y) < rk.r) {
                blocked = true
                break
              }
            }
          }
          if (!blocked) {
            for (const st of MYSTERIOUS_STATUES) {
              if (Math.hypot(ar.x - st.x, ar.y - st.y) < 20) {
                blocked = true
                break
              }
            }
          }
        }
        if (blocked) {
          spawnSlashSparks(ar.x, ar.y, ar.angle + Math.PI, 7)
          arrowProjectiles.splice(i, 1)
          continue
        }

        // Check hitting Cursed Spirit Effigies of an active Statue Task!
        if (activeStatueTrial) {
          let hitEffigy = false
          for (const ef of activeStatueTrial.effigies) {
            if (ef.alive && Math.hypot(ef.x - ar.x, ef.y - ar.y) < 22) {
              ef.alive = false
              hitEffigy = true
              spawnSlashSparks(ef.x, ef.y, ar.angle, 18)
              const brokenCount = activeStatueTrial.effigies.filter((e) => !e.alive).length
              floatingTexts.push({
                x: ef.x,
                y: ef.y - 20,
                text: `EFFIGY BULLSEYE (${brokenCount}/3)!`,
                color: '#6b3fa0',
                age: 0,
                duration: 1.25,
              })
              break
            }
          }
          if (hitEffigy) {
            completeStatueTrialIfDone()
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

      // Ground layer + Merchant Shop Outposts + Coins + Dummies across all visible continents
      drawBirdsEyeWorldGround(elapsed, nearShopId, W, H)

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

      // Overhead canopies, Gates & Merchant Shop Awnings across all visible continents
      drawBirdsEyeOverhead(elapsed, nearShopId, W, H)

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

        // 2. Merchant Stall Collider Boxes & Visible Continents Colliders
        for (const cont of CONTINENTS) {
          if (Math.abs(cont.origin.x - cam.x) > W * 0.5 + 950 || Math.abs(cont.origin.y - cam.y) > H * 0.5 + 950) {
            continue
          }
          ctx.strokeStyle = '#d97706'
          ctx.fillStyle = 'rgba(217, 119, 6, 0.12)'
          ctx.fillRect(cont.shopPos.x - 40, cont.shopPos.y - 26, 80, 52)
          ctx.strokeRect(cont.shopPos.x - 40, cont.shopPos.y - 26, 80, 52)
        }

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
          for (const cont of CONTINENTS) {
            if (Math.abs(cont.origin.x - cam.x) > W * 0.5 + 950 || Math.abs(cont.origin.y - cam.y) > H * 0.5 + 950) {
              continue
            }
            // 5. Continent Liquid No-Entry Collider
            ctx.strokeStyle = cont.liquidKind === 'magma' ? '#dc2626' : '#0284c7'
            ctx.fillStyle = cont.liquidKind === 'magma' ? 'rgba(220, 38, 38, 0.12)' : 'rgba(2, 132, 199, 0.10)'
            ctx.beginPath()
            for (let i = 0; i <= 40; i++) {
              const a = (i / 40) * Math.PI * 2
              const pt = getContinentLiquidBoundary(cont, a)
              if (i === 0) ctx.moveTo(pt.x, pt.y)
              else ctx.lineTo(pt.x, pt.y)
            }
            ctx.closePath()
            ctx.fill()
            ctx.stroke()

            // Safe Walkable Bridge Deck
            const br = cont.bridge
            ctx.strokeStyle = '#16a34a'
            ctx.fillStyle = 'rgba(22, 163, 74, 0.10)'
            ctx.fillRect(br.minX, br.yCenter - br.halfH, br.maxX - br.minX, br.halfH * 2)
            ctx.strokeRect(br.minX, br.yCenter - br.halfH, br.maxX - br.minX, br.halfH * 2)

            // 6. Rocks, Lanterns, Gate Pillars
            ctx.strokeStyle = '#d97706'
            ctx.fillStyle = 'rgba(217, 119, 6, 0.12)'
            for (const rk of cont.rocks) {
              ctx.beginPath()
              ctx.arc(rk.x, rk.y, rk.r, 0, Math.PI * 2)
              ctx.fill()
              ctx.stroke()
            }
            for (const ln of cont.lanterns) {
              ctx.beginPath()
              ctx.arc(ln.x, ln.y, 12, 0, Math.PI * 2)
              ctx.fill()
              ctx.stroke()
            }
            for (const tp of getGatePillars(cont)) {
              ctx.beginPath()
              ctx.arc(tp.x, tp.y, tp.r, 0, Math.PI * 2)
              ctx.fill()
              ctx.stroke()
            }
          }

          // Visible Spatial-Grid Trees, Wilderness Water Pools & Statues Hitboxes
          ctx.strokeStyle = '#d97706'
          ctx.fillStyle = 'rgba(217, 119, 6, 0.12)'
          for (const tr of queryTreesInRect(cam.x - W * 0.5 - 80, cam.y - H * 0.5 - 80, cam.x + W * 0.5 + 80, cam.y + H * 0.5 + 80)) {
            ctx.beginPath()
            ctx.arc(tr.x, tr.y, getTreeColliderRadius(tr), 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
          for (const st of MYSTERIOUS_STATUES) {
            if (Math.abs(st.x - cam.x) > W * 0.5 + 80 || Math.abs(st.y - cam.y) > H * 0.5 + 80) continue
            ctx.beginPath()
            ctx.arc(st.x, st.y, 20, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          }
          ctx.strokeStyle = '#0284c7'
          ctx.fillStyle = 'rgba(2, 132, 199, 0.10)'
          for (const wp of WILDERNESS_POOLS) {
            if (Math.abs(wp.x - cam.x) > W * 0.5 + wp.rx + 40 || Math.abs(wp.y - cam.y) > H * 0.5 + wp.ry + 40) continue
            ctx.beginPath()
            for (let i = 0; i <= 32; i++) {
              const a = (i / 32) * Math.PI * 2
              const pt = getWildernessPoolBoundary(wp, a)
              if (i === 0) ctx.moveTo(pt.x, pt.y)
              else ctx.lineTo(pt.x, pt.y)
            }
            ctx.closePath()
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

      // Continent Ambient Weather (Drifting Leaves / Desert Sand / Falling Snow / Jungle Fireflies / Rising Embers)
      if (showBgRef.current) {
        for (const pt of particles) {
          if (pt.kind !== 'weather') continue
          ctx.save()
          ctx.translate(pt.x, pt.y)
          if (wk === 'sand') {
            ctx.strokeStyle = 'rgba(176, 134, 72, 0.44)'
            ctx.lineWidth = 1.15
            ctx.beginPath()
            ctx.moveTo(-pt.size, 0)
            ctx.lineTo(pt.size, pt.size * 0.16)
            ctx.stroke()
          } else if (wk === 'snow') {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
            ctx.strokeStyle = 'rgba(92, 122, 146, 0.42)'
            ctx.lineWidth = 0.7
            ctx.beginPath()
            ctx.arc(0, 0, pt.size, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
          } else if (wk === 'firefly') {
            const glowA = 0.4 + 0.45 * Math.sin(elapsed * 4.2 + pt.rot)
            ctx.fillStyle = `rgba(218, 232, 114, ${glowA * 0.35})`
            ctx.beginPath()
            ctx.arc(0, 0, pt.size * 2.8, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = `rgba(246, 252, 178, ${glowA})`
            ctx.beginPath()
            ctx.arc(0, 0, pt.size * 0.85, 0, Math.PI * 2)
            ctx.fill()
          } else if (wk === 'ember') {
            const flicker = 0.55 + 0.35 * Math.sin(elapsed * 6.5 + pt.rot)
            ctx.fillStyle = `rgba(240, 126, 44, ${flicker * 0.42})`
            ctx.beginPath()
            ctx.arc(0, 0, pt.size * 2.2, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = `rgba(255, 210, 108, ${flicker})`
            ctx.beginPath()
            ctx.arc(0, 0, pt.size * 0.8, 0, Math.PI * 2)
            ctx.fill()
          } else {
            ctx.rotate(pt.rot)
            ctx.strokeStyle = 'rgba(54, 53, 50, 0.34)'
            ctx.lineWidth = 0.95
            ctx.beginPath()
            ctx.ellipse(0, 0, pt.size, pt.size * 0.44, 0, 0, Math.PI * 2)
            ctx.stroke()
          }
          ctx.restore()
        }
      }

      ctx.restore()

      // --- 6. LIVE PLAYER-CENTERED RADAR MINIMAP (TOP-RIGHT · CLICK TO OPEN FULL 5-CONTINENT WORLD MAP!) ---
      if (showMinimapRef.current && !shopOpenRef.current && !fullMapOpenRef.current) {
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
        const scaleX = (mapW - 14) / worldSpanX
        const scaleY = (bodyH - 12) / worldSpanY
        const toMapX = (wx: number) => mapCX + (wx - char.x) * scaleX
        const toMapY = (wy: number) => mapCY + (wy - char.y) * scaleY
        const white = isWhitePaper()

        ctx.save()
        ctx.fillStyle = 'rgba(26, 26, 30, 0.14)'
        ctx.fillRect(mapX + 3, mapY + 3, mapW, mapH)

        // Neutral world parchment backdrop
        ctx.fillStyle = white ? '#f1ece1' : '#9ea19d'
        ctx.fillRect(mapX, mapY, mapW, mapH)

        // Header bar with continent accent swatch + Click-for-Full-Map cue
        ctx.fillStyle = '#26262b'
        ctx.fillRect(mapX, mapY, mapW, headerH)
        ctx.fillStyle = curContinent.badgeColor
        ctx.fillRect(mapX, mapY, 4, headerH)
        ctx.fillStyle = '#faf7f0'
        ctx.font = 'bold 8.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${curContinent.shortName.toUpperCase()}`, mapX + 9, mapY + headerH * 0.5)
        ctx.textAlign = 'right'
        ctx.fillStyle = '#e5be62'
        ctx.fillText('FULL MAP ⤢', mapX + mapW - 7, mapY + headerH * 0.5)

        ctx.save()
        ctx.beginPath()
        ctx.rect(mapX + 1, bodyY, mapW - 2, bodyH - 1)
        ctx.clip()

        if (showBgRef.current) {
          // Feathered continent biome territories visible in minimap radar
          for (const cont of CONTINENTS) {
            if (Math.abs(cont.origin.x - char.x) > 1500 || Math.abs(cont.origin.y - char.y) > 1400) continue
            const ox = toMapX(cont.origin.x)
            const oy = toMapY(cont.origin.y)
            const rad = 820 * scaleX
            const bgGrad = ctx.createRadialGradient(ox, oy, rad * 0.2, ox, oy, rad)
            const hex = white ? cont.paperBase : cont.boardBase
            bgGrad.addColorStop(0, hex)
            bgGrad.addColorStop(0.75, hex)
            bgGrad.addColorStop(1, 'rgba(241, 236, 225, 0)')
            ctx.fillStyle = bgGrad
            ctx.beginPath()
            ctx.arc(ox, oy, rad, 0, Math.PI * 2)
            ctx.fill()
          }

          // Connecting roads between continents
          ctx.fillStyle = white ? 'rgba(138, 130, 114, 0.52)' : 'rgba(72, 74, 68, 0.52)'
          for (const st of CONNECTOR_STONES) {
            if (Math.abs(st.x - char.x) > 760 || Math.abs(st.y - char.y) > 680) continue
            ctx.fillRect(toMapX(st.x) - 1.6, toMapY(st.y) - 1.4, 3.2, 2.8)
          }
        }

        ctx.strokeStyle = 'rgba(54, 53, 50, 0.08)'
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(mapCX, bodyY)
        ctx.lineTo(mapCX, mapY + mapH)
        ctx.moveTo(mapX, mapCY)
        ctx.lineTo(mapX + mapW, mapCY)
        ctx.stroke()

        if (showBgRef.current) {
          for (const cont of CONTINENTS) {
            if (Math.abs(cont.origin.x - char.x) > 1350 || Math.abs(cont.origin.y - char.y) > 1250) continue

            // Stepping stone pathways
            ctx.fillStyle = white ? 'rgba(148, 142, 128, 0.42)' : 'rgba(92, 94, 88, 0.42)'
            for (const st of cont.stones) {
              ctx.fillRect(toMapX(st.x) - 1.6, toMapY(st.y) - 1.4, 3.2, 2.8)
            }

            // Continent Liquid Body contour with matching realistic palette!
            ctx.beginPath()
            for (let i = 0; i <= 32; i++) {
              const a = (i / 32) * Math.PI * 2
              const pt = getContinentLiquidBoundary(cont, a)
              const px = toMapX(pt.x)
              const py = toMapY(pt.y)
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            }
            ctx.closePath()
            const mpGrad = ctx.createRadialGradient(
              toMapX(cont.liquidCenter.x),
              toMapY(cont.liquidCenter.y),
              3,
              toMapX(cont.liquidCenter.x),
              toMapY(cont.liquidCenter.y),
              28
            )
            if (cont.liquidKind === 'oasis') {
              mpGrad.addColorStop(0, white ? '#3d8e9c' : '#265c66')
              mpGrad.addColorStop(1, white ? '#94cfc8' : '#53898c')
            } else if (cont.liquidKind === 'glacial-lake') {
              mpGrad.addColorStop(0, white ? '#3b5d76' : '#253c4f')
              mpGrad.addColorStop(1, white ? '#a4c4d6' : '#648294')
            } else if (cont.liquidKind === 'emerald-lagoon') {
              mpGrad.addColorStop(0, white ? '#2c6452' : '#1d4438')
              mpGrad.addColorStop(1, white ? '#7db096' : '#4a735f')
            } else if (cont.liquidKind === 'magma') {
              mpGrad.addColorStop(0, '#f0b844')
              mpGrad.addColorStop(0.6, '#d45b1c')
              mpGrad.addColorStop(1, '#7a2518')
            } else {
              mpGrad.addColorStop(0, white ? '#5b7885' : '#324852')
              mpGrad.addColorStop(1, white ? '#9bb4bc' : '#58717a')
            }
            ctx.fillStyle = mpGrad
            ctx.fill()
            ctx.strokeStyle = '#363532'
            ctx.lineWidth = 0.95
            ctx.stroke()

            // Continent Bridge crossing liquid body
            const br = cont.bridge
            const bx0 = toMapX(br.minX + 4)
            const by0 = toMapY(br.yCenter - 32)
            const bw = toMapX(br.maxX - 4) - bx0
            const bh = toMapY(br.yCenter + 32) - by0
            ctx.fillStyle =
              br.style === 'obsidian'
                ? '#4b4542'
                : br.style === 'frost'
                  ? '#e6f1f6'
                  : br.style === 'bamboo'
                    ? '#b8c498'
                    : white
                      ? '#d8c8ad'
                      : '#9b9688'
            ctx.fillRect(bx0, by0, bw, bh)
            ctx.strokeStyle = '#363532'
            ctx.lineWidth = 0.85
            ctx.strokeRect(bx0, by0, bw, bh)

            // North Gate
            ctx.fillStyle = '#363532'
            const gx0 = toMapX(cont.gatePos.x - 88)
            const gx1 = toMapX(cont.gatePos.x + 88)
            const gy = toMapY(cont.gatePos.y - 6)
            ctx.fillRect(gx0, gy, gx1 - gx0, 3.0)
            ctx.fillRect(toMapX(cont.gatePos.x - 60), gy + 2, 2.4, 5.0)
            ctx.fillRect(toMapX(cont.gatePos.x + 52), gy + 2, 2.4, 5.0)

            // Rocks & Lanterns
            for (const rk of cont.rocks) {
              ctx.fillStyle =
                rk.kind === 'ice'
                  ? '#a4cbd9'
                  : rk.kind === 'sandstone'
                    ? '#c69e68'
                    : rk.kind === 'basalt'
                      ? '#433d3a'
                      : '#6c6a64'
              ctx.beginPath()
              ctx.arc(toMapX(rk.x), toMapY(rk.y), 2.8, 0, Math.PI * 2)
              ctx.fill()
            }
            ctx.fillStyle = '#54534f'
            for (const ln of cont.lanterns) {
              ctx.fillRect(toMapX(ln.x) - 1.3, toMapY(ln.y) - 1.3, 2.6, 2.6)
            }
          }

          // Nearby Wilderness Water & Magma Pools on Minimap
          for (const wp of WILDERNESS_POOLS) {
            if (Math.abs(wp.x - char.x) > 850 || Math.abs(wp.y - char.y) > 750) continue
            ctx.beginPath()
            for (let i = 0; i <= 24; i++) {
              const a = (i / 24) * Math.PI * 2
              const pt = getWildernessPoolBoundary(wp, a)
              const px = toMapX(pt.x)
              const py = toMapY(pt.y)
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            }
            ctx.closePath()
            ctx.fillStyle =
              wp.kind === 'oasis'
                ? '#64b2b8'
                : wp.kind === 'glacial-lake'
                  ? '#6e97b0'
                  : wp.kind === 'emerald-lagoon'
                    ? '#4c8670'
                    : wp.kind === 'magma'
                      ? '#d45b1c'
                      : '#7a98a3'
            ctx.fill()
            ctx.strokeStyle = '#363532'
            ctx.lineWidth = 0.85
            ctx.stroke()
          }

          // ACTUAL MINIATURE TREES ON THE MINIMAP ACROSS ENTIRE WORLD (Continent + Dense Forest!)
          const miniTrees = queryTreesInRect(char.x - 720, char.y - 620, char.x + 720, char.y + 620)
          for (const tr of miniTrees) {
              const tx = toMapX(tr.x)
              const ty = toMapY(tr.y)
              if (tx < mapX - 12 || tx > mapX + mapW + 12 || ty < bodyY - 12 || ty > mapY + mapH + 12) continue
              ctx.save()
              ctx.translate(tx, ty)
              ctx.fillStyle = 'rgba(32, 36, 30, 0.18)'
              ctx.beginPath()
              ctx.ellipse(1.5, 1.5, 5.2, 3.0, 0, 0, Math.PI * 2)
              ctx.fill()

              if (tr.kind === 'bamboo') {
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
              } else if (tr.kind === 'palm') {
                ctx.strokeStyle = '#6e563b'
                ctx.lineWidth = 1.8
                ctx.beginPath()
                ctx.moveTo(0, 1.5)
                ctx.quadraticCurveTo(1.5, -4, 2.2, -8.5)
                ctx.stroke()
                ctx.strokeStyle = white ? '#628549' : '#466134'
                ctx.lineWidth = 1.25
                for (let f = 0; f < 6; f++) {
                  const fa = (f / 6) * Math.PI * 2
                  ctx.beginPath()
                  ctx.moveTo(2.2, -8.5)
                  ctx.quadraticCurveTo(
                    2.2 + Math.cos(fa) * 3.5,
                    -9.5 + Math.sin(fa) * 2,
                    2.2 + Math.cos(fa) * 5.8,
                    -7.2 + Math.sin(fa) * 3.2
                  )
                  ctx.stroke()
                }
              } else if (tr.kind === 'cactus') {
                ctx.strokeStyle = white ? '#5f7e4e' : '#445d39'
                ctx.lineCap = 'round'
                ctx.lineWidth = 2.6
                ctx.beginPath()
                ctx.moveTo(0, 1.5)
                ctx.lineTo(0, -8.5)
                ctx.stroke()
                ctx.lineWidth = 1.7
                ctx.beginPath()
                ctx.moveTo(0, -3.5)
                ctx.lineTo(-3.2, -3.5)
                ctx.lineTo(-3.2, -6.5)
                ctx.moveTo(0, -5.0)
                ctx.lineTo(3.0, -5.0)
                ctx.lineTo(3.0, -7.5)
                ctx.stroke()
              } else if (tr.kind === 'pine' || tr.kind === 'snow-pine') {
                const isSnow = tr.kind === 'snow-pine'
                ctx.fillStyle = '#5c4a39'
                ctx.fillRect(-1.4, -4.5, 2.8, 6.0)
                const tiers: [number, number, string][] = isSnow
                  ? [
                      [-4.0, 6.2, white ? '#364d52' : '#26383d'],
                      [-6.8, 5.0, white ? '#517178' : '#3a545a'],
                      [-9.4, 3.6, white ? '#eff7fb' : '#cde0ea'],
                    ]
                  : [
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
              } else if (tr.kind === 'charred') {
                ctx.strokeStyle = '#2a2422'
                ctx.lineWidth = 1.9
                ctx.beginPath()
                ctx.moveTo(0, 1.5)
                ctx.lineTo(0, -6.5)
                ctx.moveTo(0, -4.5)
                ctx.lineTo(-3.8, -8.5)
                ctx.moveTo(0, -5.0)
                ctx.lineTo(3.6, -8.8)
                ctx.stroke()
                ctx.fillStyle = '#a84426'
                ctx.beginPath()
                ctx.arc(-3.2, -8.2, 2.0, 0, Math.PI * 2)
                ctx.arc(3.0, -8.4, 1.9, 0, Math.PI * 2)
                ctx.fill()
              } else {
                const isJungle = tr.kind === 'jungle'
                ctx.fillStyle = '#57483e'
                ctx.fillRect(-1.3, -4.8, 2.6, 6.0)
                const puffs: [number, number, number, string][] = isJungle
                  ? [
                      [-2.8, -5.8, 3.3, white ? '#2e583b' : '#20402b'],
                      [2.8, -5.6, 3.3, white ? '#2e583b' : '#20402b'],
                      [0, -7.2, 3.8, white ? '#467c4f' : '#325b3a'],
                      [-1.0, -8.8, 2.8, white ? '#69a263' : '#4b7847'],
                    ]
                  : [
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
                ctx.strokeStyle = isJungle ? 'rgba(26, 46, 30, 0.55)' : 'rgba(46, 32, 28, 0.55)'
                ctx.lineWidth = 0.65
                ctx.beginPath()
                ctx.arc(0, -6.8, 4.6, 0, Math.PI * 2)
                ctx.stroke()
              }
              ctx.restore()
            }
        }

        // Merchant Shop Stall icons, Waystation Campfires & Mysterious Statues ('?' / '★')
        for (const ws of WAYSTATIONS) {
          const wx = toMapX(ws.x)
          const wy = toMapY(ws.y)
          if (wx < mapX - 8 || wx > mapX + mapW + 8 || wy < bodyY - 8 || wy > mapY + mapH + 8) continue
          ctx.fillStyle = '#ea6c28'
          ctx.beginPath()
          ctx.arc(wx, wy, 3.0, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#26262b'
          ctx.lineWidth = 0.8
          ctx.stroke()
        }
        for (const st of MYSTERIOUS_STATUES) {
          const sx = toMapX(st.x)
          const sy = toMapY(st.y)
          if (sx < mapX - 10 || sx > mapX + mapW + 10 || sy < bodyY - 10 || sy > mapY + mapH + 10) continue
          const done = Boolean(completedStatuesRef.current[st.id])
          ctx.fillStyle = done ? '#e5be62' : '#4a3d5c'
          ctx.beginPath()
          ctx.arc(sx, sy, 5.2, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#26262b'
          ctx.lineWidth = 0.9
          ctx.stroke()
          ctx.fillStyle = done ? '#222226' : '#faf7f0'
          ctx.font = 'bold 7.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(done ? '★' : '?', sx, sy + 0.5)
        }
        for (const cont of CONTINENTS) {
          const sx = toMapX(cont.shopPos.x)
          const sy = toMapY(cont.shopPos.y)
          if (sx < mapX - 10 || sx > mapX + mapW + 10 || sy < bodyY - 10 || sy > mapY + mapH + 10) continue
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
        }

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
          heading: topRig.heading,
          fps: Math.round(fpsSmooth),
          nearShop: isNearShop,
          focusSec: Math.ceil(focusTimerRef.current),
        })
        if (activeStatueTrial) {
          setActiveStatueTaskHud({
            prompt: activeStatueTrial.statue.taskPrompt,
            broken: activeStatueTrial.effigies.filter((e) => !e.alive).length,
            total: activeStatueTrial.effigies.length,
            timeLeft: Math.ceil(activeStatueTrial.timeLeft),
            rewardGold: activeStatueTrial.statue.rewardGold,
          })
        } else {
          setActiveStatueTaskHud(null)
        }
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
      className="relative w-screen h-screen overflow-hidden select-none font-mono text-[#222226]"
      style={{ backgroundColor: paperTone === 'white' ? activeContinent.paperBase : activeContinent.boardBase }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          if (e.button === 0) {
            if (shopOpen || fullMapOpen) return
            const rect = e.currentTarget.getBoundingClientRect()
            const localX = e.clientX - rect.left
            const localY = e.clientY - rect.top
            // Clicking inside the top-right Minimap opens the Full-View 5-Continent World Map!
            if (
              showMinimap &&
              localX >= rect.width - 212 &&
              localX <= rect.width - 20 &&
              localY >= 16 &&
              localY <= 194
            ) {
              setFullMapOpen(true)
              return
            }
            const clickScreenX = localX - rect.width * 0.5
            const clickScreenY = localY - rect.height * 0.5
            const worldClickX = hudStats.x + clickScreenX
            const worldClickY = hudStats.y + clickScreenY
            // If clicking directly on an Unrecognized / Ancient Task Statue when nearby, start its Trial!
            for (const st of MYSTERIOUS_STATUES) {
              if (Math.hypot(worldClickX - st.x, worldClickY - st.y) < 56 && Math.hypot(hudStats.x - st.x, hudStats.y - st.y) <= 185) {
                interactStatueRef.current?.(st)
                return
              }
            }
            // If clicking directly on ANY continent's Merchant Stall on the map, open the Shop!
            for (const cont of CONTINENTS) {
              if (Math.hypot(worldClickX - cont.shopPos.x, worldClickY - cont.shopPos.y) < 72) {
                setShopOpen(true)
                return
              }
            }
            triggerSlashRef.current?.(Math.atan2(clickScreenY, clickScreenX))
          }
        }}
        className="w-full h-full block cursor-crosshair"
      />

      {/* Clickable Transparent Overlay over Top-Right Minimap for pointer cursor & Full-View Map trigger */}
      {showMinimap && !shopOpen && !fullMapOpen && (
        <button
          type="button"
          onClick={() => setFullMapOpen(true)}
          aria-label="Open Full-View 5-Continent World Map"
          title="Click to open Full-View 5-Continent World Map [M]"
          className="absolute top-[16px] right-[20px] w-[192px] h-[178px] z-30 cursor-pointer bg-transparent hover:ring-2 hover:ring-[#e5be62] transition-shadow"
        />
      )}

      {/* Minimalist Top Bar + 5-Continent Walk/Teleport Bar */}
      <div className="pointer-events-none absolute top-4 left-5 right-5 flex items-start justify-between z-20 gap-3">
        <div className="pointer-events-auto flex flex-col gap-1.5 max-w-[680px]">
          <div className="px-3.5 py-2 bg-white/85 backdrop-blur-sm border border-[#26262b]">
            <div className="text-[10px] uppercase tracking-[0.2em] font-bold flex items-center gap-2 flex-wrap">
              <span>2D SAMURAI // {activeContinent.name.toUpperCase()}</span>
              <span
                className="px-1.5 py-0.5 text-[9px] text-white font-bold tracking-wider"
                style={{ backgroundColor: activeContinent.badgeColor }}
              >
                {activeContinent.regionTag}
              </span>
            </div>
            <div className="text-[11px] text-[#45454a] mt-0.5">
              W/A/S/D: Walk Roads · Space: Dash · Click / J: {activeWeapon === 'bow' ? 'Bow' : 'Slash'} · Q: Switch · 1–5: Teleport · M / Click Map: Full World
            </div>
          </div>

          {/* 5-Continent Wayshrine Fast-Teleport + Full Map Bar */}
          <div className="flex flex-wrap items-center gap-1 bg-white/85 backdrop-blur-sm border border-[#26262b] px-2 py-1.5">
            <span className="text-[9px] uppercase tracking-widest font-bold text-[#5a5a60] mr-1">
              WAYSHRINES
            </span>
            {CONTINENTS.map((cont) => {
              const isActive = cont.id === continentId
              const isUnlocked = scoutUnlockAll || Boolean(discoveredContinents[cont.id])
              return (
                <button
                  key={cont.id}
                  type="button"
                  onClick={() => switchContinentRef.current?.(cont.id)}
                  className={`px-2 py-0.5 text-[10px] uppercase border transition-colors cursor-pointer flex items-center gap-1 ${
                    isActive
                      ? 'bg-[#26262b] border-[#26262b] text-[#faf7f0] font-bold'
                      : isUnlocked
                        ? 'bg-white/85 border-[#26262b]/45 hover:border-[#26262b] text-[#26262b]'
                        : 'bg-black/5 border-[#26262b]/25 text-[#777]'
                  }`}
                  title={
                    isUnlocked
                      ? `Teleport to ${cont.name} (${cont.tierLabel}) [Key ${cont.keyNum}]`
                      : `🔒 ${cont.name} (${cont.tierLabel}) — Walk the Expedition Trail on foot to unlock Wayshrine!`
                  }
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: cont.badgeColor }}
                  />
                  <span>
                    {isUnlocked ? '' : '🔒'}[{cont.keyNum}] {cont.shortName}
                  </span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => setFullMapOpen(true)}
              className="ml-auto px-2 py-0.5 text-[10px] uppercase border border-[#26262b] bg-[#e5be62] hover:bg-[#d6ae50] text-[#222226] font-extrabold transition-colors cursor-pointer"
              title="Open Full-View 5-Continent World Map [M]"
            >
              World Map [M]
            </button>
          </div>

          {/* Live Ancient Statue Task Tracker Banner */}
          {activeStatueTaskHud && (
            <div className="px-3 py-1.5 bg-[#362946]/95 text-[#faf7f0] border border-[#e5be62] flex items-center justify-between gap-3 text-[11px]">
              <div>
                <span className="font-extrabold text-[#e5be62] uppercase mr-2">❓ STATUE TASK:</span>
                <span>{activeStatueTaskHud.prompt}</span>
              </div>
              <div className="font-bold whitespace-nowrap">
                <span className="px-1.5 py-0.5 bg-[#e5be62] text-[#222226] mr-1.5">
                  {activeStatueTaskHud.broken}/{activeStatueTaskHud.total}
                </span>
                <span>{activeStatueTaskHud.timeLeft}s</span>
              </div>
            </div>
          )}
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
                  : `Stall at NW (${activeContinent.shopPos.x}, ${activeContinent.shopPos.y})`}
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

      {/* FULL-VIEW INTERACTIVE 5-CONTINENT WORLD MAP OVERLAY (CLICK MINIMAP OR PRESS [M]!) */}
      {fullMapOpen && (
        <FullWorldMapModal
          paperTone={paperTone}
          playerX={hudStats.x}
          playerY={hudStats.y}
          playerHeading={hudStats.heading}
          activeContinentId={continentId}
          discoveredContinents={discoveredContinents}
          completedStatues={completedStatues}
          scoutUnlockAll={scoutUnlockAll}
          onToggleScoutUnlock={() => setScoutUnlockAll((v) => !v)}
          onTeleportWorld={(wx, wy, label, color) => teleportWorldRef.current?.(wx, wy, label, color)}
          onTeleportContinent={(id) => switchContinentRef.current?.(id)}
          onClose={() => setFullMapOpen(false)}
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
