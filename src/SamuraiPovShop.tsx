import { useEffect, useRef, useState } from 'react'
import { clamp, type SamuraiGear } from './samuraiRig'

export interface ShopItem {
  id:
    | 'crimsonScarf'
    | 'galeHat'
    | 'moonlightBlade'
    | 'shadowCloak'
    | 'spiritBell'
    | 'matchaTea'
    | 'warBow'
    | 'arrows'
  name: string
  tag: string
  price: number
  category: 'Gear' | 'Weapon' | 'Charm' | 'Elixir' | 'Ammo'
  desc: string
  consumable?: boolean
  // 3D counter scene local coordinates (relative to 960x580 stage center)
  posX: number
  posY: number
  hitR: number
}

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'galeHat',
    name: 'Gale Straw Hat',
    tag: 'Fast Dash',
    price: 50,
    category: 'Gear',
    desc: 'Woven gold-trimmed straw hat that cuts Dash cooldown in half and increases dash distance.',
    posX: -345,
    posY: -68,
    hitR: 50,
  },
  {
    id: 'warBow',
    name: 'Yumi War Bow',
    tag: 'Switch Skill [Q]',
    price: 65,
    category: 'Weapon',
    desc: 'Asymmetrical bamboo war bow (+10 starter arrows). Buying it activates the Weapon Switch skill [Q] to swap between Katana and Bow!',
    posX: -200,
    posY: -36,
    hitR: 54,
  },
  {
    id: 'shadowCloak',
    name: 'Shadow Cloak',
    tag: 'Phantom Trail',
    price: 60,
    category: 'Gear',
    desc: 'Dyes your billowing 120Hz cloak in deep charcoal ink and leaves phantom dash afterimages.',
    posX: -335,
    posY: 94,
    hitR: 50,
  },
  {
    id: 'crimsonScarf',
    name: 'Crimson Wind Scarf',
    tag: '+18% Speed',
    price: 40,
    category: 'Gear',
    desc: 'A flowing crimson silk scarf that trails behind your cloak and boosts movement speed by +18%.',
    posX: -175,
    posY: 122,
    hitR: 50,
  },
  {
    id: 'moonlightBlade',
    name: 'Moonlight Sword',
    tag: 'Double Arc',
    price: 75,
    category: 'Weapon',
    desc: 'Forged silver-blue steel that unleashes a wide double-crescent shockwave arc on every slash.',
    posX: 0,
    posY: 100,
    hitR: 60,
  },
  {
    id: 'arrows',
    name: 'Arrow Bundle ×10',
    tag: '+10 Arrows',
    price: 20,
    category: 'Ammo',
    desc: 'A fresh bundle of 10 steel-tipped bamboo arrows with crimson fletching for your Yumi War Bow.',
    consumable: true,
    posX: 175,
    posY: 122,
    hitR: 50,
  },
  {
    id: 'spiritBell',
    name: 'Golden Magnet Bell',
    tag: 'Coin Magnet',
    price: 35,
    category: 'Charm',
    desc: 'Draws nearby Gold Coins across the courtyard automatically toward your character.',
    posX: 335,
    posY: -52,
    hitR: 48,
  },
  {
    id: 'matchaTea',
    name: 'Focus Tea Flask',
    tag: '18s Boost',
    price: 25,
    category: 'Elixir',
    desc: 'Drink immediately for 18 seconds of Focus Rush: swirling gold petals, +25% speed & rapid attacks.',
    consumable: true,
    posX: 335,
    posY: 96,
    hitR: 50,
  },
]

interface Props {
  coins: number
  arrows: number
  activeWeapon: 'sword' | 'bow'
  shopMsg: string
  ownedItems: Record<string, boolean>
  equippedGear: SamuraiGear & { spiritBell?: boolean }
  focusActive?: boolean
  onBuyOrToggle: (item: ShopItem) => void
  onGrantBonusGold: () => void
  onClose: () => void
}

interface SparkBurst {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  maxAge: number
}

export default function SamuraiPovShop({
  coins,
  arrows,
  activeWeapon,
  shopMsg,
  ownedItems,
  equippedGear,
  onBuyOrToggle,
  onGrantBonusGold,
  onClose,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [selectedId, setSelectedId] = useState<ShopItem['id']>('warBow')
  const [hoveredId, setHoveredId] = useState<ShopItem['id'] | null>(null)

  const selectedRef = useRef<ShopItem['id']>('warBow')
  const hoveredRef = useRef<ShopItem['id'] | null>(null)
  const coinsRef = useRef(coins)
  const arrowsRef = useRef(arrows)
  const activeWeaponRef = useRef(activeWeapon)
  const ownedRef = useRef(ownedItems)
  const gearRef = useRef(equippedGear)
  const msgRef = useRef(shopMsg)
  const talkTimerRef = useRef(1.2)
  const sparksRef = useRef<SparkBurst[]>([])
  const onBuyRef = useRef(onBuyOrToggle)

  useEffect(() => { selectedRef.current = selectedId }, [selectedId])
  useEffect(() => { hoveredRef.current = hoveredId }, [hoveredId])
  useEffect(() => { coinsRef.current = coins }, [coins])
  useEffect(() => { arrowsRef.current = arrows }, [arrows])
  useEffect(() => { activeWeaponRef.current = activeWeapon }, [activeWeapon])
  useEffect(() => { ownedRef.current = ownedItems }, [ownedItems])
  useEffect(() => { gearRef.current = equippedGear }, [equippedGear])
  useEffect(() => {
    msgRef.current = shopMsg
    talkTimerRef.current = 1.4
  }, [shopMsg])
  useEffect(() => { onBuyRef.current = onBuyOrToggle }, [onBuyOrToggle])

  const activeItem = SHOP_ITEMS.find((it) => it.id === (hoveredId ?? selectedId)) ?? SHOP_ITEMS[3]

  const triggerItemAction = (item: ShopItem) => {
    setSelectedId(item.id)
    selectedRef.current = item.id
    onBuyRef.current(item)
    // Spawn celebratory gold sparks around the 3D item on the counter!
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3
      const spd = 60 + Math.random() * 130
      sparksRef.current.push({
        x: item.posX,
        y: item.posY,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 30,
        age: 0,
        maxAge: 0.45 + Math.random() * 0.25,
      })
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(canvas.clientWidth * dpr)
      canvas.height = Math.floor(canvas.clientHeight * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // Convert mouse client coordinates to logical 960x540 stage space
    const toStageCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect()
      const W = rect.width || 960
      const H = rect.height || 540
      const scale = Math.min(W / 960, H / 540)
      const cx = W * 0.5
      const cy = H * 0.47
      const sx = (clientX - rect.left - cx) / scale
      const sy = (clientY - rect.top - cy) / scale
      return { sx, sy }
    }

    const onPointerMove = (e: PointerEvent) => {
      const { sx, sy } = toStageCoords(e.clientX, e.clientY)

      // Hit-test stationary counter items directly in stage space
      let found: ShopItem['id'] | null = null
      for (const it of SHOP_ITEMS) {
        if (Math.hypot(sx - it.posX, sy - it.posY) <= it.hitR) {
          found = it.id
          break
        }
      }
      if (found !== hoveredRef.current) {
        hoveredRef.current = found
        setHoveredId(found)
        if (found) {
          selectedRef.current = found
          setSelectedId(found)
        }
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const { sx, sy } = toStageCoords(e.clientX, e.clientY)
      for (const it of SHOP_ITEMS) {
        if (Math.hypot(sx - it.posX, sy - it.posY) <= it.hitR) {
          triggerItemAction(it)
          return
        }
      }
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerdown', onPointerDown)

    const INK = '#2b2c32'
    const INK_MID = '#54534f'
    const INK_SOFT = 'rgba(84, 83, 79, 0.38)'
    const PARCHMENT = '#f6f3ea'
    const WOOD_LIGHT = '#e3d8c4'
    const WOOD_MID = '#cfc2aa'
    const WOOD_DARK = '#b5a68c'

    const strokeInk = (w = 1.2, col = INK) => {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = col
      ctx.lineWidth = w
      ctx.stroke()
    }

    // =========================================================================
    // LAYER 1: WOODEN SHOP ROOM & SHOJI WALLS (STATIONARY)
    // =========================================================================
    const drawRoomBackground = () => {
      ctx.save()

      // Back Shoji screen wall
      ctx.fillStyle = '#f2ede0'
      ctx.fillRect(-520, -300, 1040, 420)

      // 3D perspective ceiling beams converging toward vanishing point
      ctx.fillStyle = '#dcd1be'
      ctx.beginPath()
      ctx.moveTo(-540, -300)
      ctx.lineTo(540, -300)
      ctx.lineTo(440, -195)
      ctx.lineTo(-440, -195)
      ctx.closePath()
      ctx.fill()
      strokeInk(1.2, INK_MID)

      // Perspective ceiling rafters
      ctx.beginPath()
      for (let i = -4; i <= 4; i++) {
        ctx.moveTo(i * 130, -300)
        ctx.lineTo(i * 102, -195)
      }
      strokeInk(1.1, INK_SOFT)

      // Shoji lattice grid on back wall
      ctx.strokeStyle = 'rgba(84, 83, 79, 0.24)'
      ctx.lineWidth = 1.0
      for (let x = -420; x <= 420; x += 84) {
        ctx.beginPath()
        ctx.moveTo(x, -195)
        ctx.lineTo(x, 95)
        ctx.stroke()
      }
      for (let y = -155; y <= 85; y += 48) {
        ctx.beginPath()
        ctx.moveTo(-440, y)
        ctx.lineTo(440, y)
        ctx.stroke()
      }

      // Left & Right 3D perspective timber pillars
      for (const side of [-1, 1]) {
        ctx.fillStyle = WOOD_MID
        ctx.beginPath()
        ctx.rect(side * 345 - 16, -230, 32, 340)
        ctx.fill()
        strokeInk(1.3, INK_MID)
      }

      // Warm hanging Chochin paper lantern on upper left (stationary)
      ctx.save()
      ctx.translate(-220, -155)
      const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 68)
      glow.addColorStop(0, 'rgba(235, 175, 82, 0.32)')
      glow.addColorStop(1, 'rgba(235, 175, 82, 0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(0, 0, 68, 0, Math.PI * 2)
      ctx.fill()

      ctx.beginPath()
      ctx.moveTo(0, -45)
      ctx.lineTo(0, -24)
      strokeInk(1.2)
      ctx.fillStyle = '#fbf0d8'
      ctx.beginPath()
      ctx.ellipse(0, 0, 20, 25, 0, 0, Math.PI * 2)
      ctx.fill()
      strokeInk(1.2, '#b84239')
      // Horizontal lantern ribs
      ctx.beginPath()
      ctx.moveTo(-18, -8)
      ctx.quadraticCurveTo(0, -5, 18, -8)
      ctx.moveTo(-19, 0)
      ctx.quadraticCurveTo(0, 3, 19, 0)
      ctx.moveTo(-18, 8)
      ctx.quadraticCurveTo(0, 11, 18, 8)
      strokeInk(0.8, 'rgba(184, 66, 57, 0.55)')
      ctx.fillStyle = '#2b2c32'
      ctx.fillRect(-10, -26, 20, 4)
      ctx.fillRect(-9, 23, 18, 4)
      ctx.restore()

      ctx.restore()
    }

    // =========================================================================
    // LAYER 2: FACE-TO-FACE SHOPKEEPER CHARACTER (STATIONARY, STRAIGHT GAZE)
    // =========================================================================
    const drawMerchantFaceToFace = (time: number) => {
      ctx.save()
      ctx.translate(0, -12)

      const isTalking = talkTimerRef.current > 0
      const mouthOpen = isTalking ? Math.abs(Math.sin(time * 16)) * 4.2 + 1.0 : 0

      // Eye blink cycle (blinks every 3.6 seconds)
      const blinkPhase = time % 3.6
      const eyeOpen = blinkPhase > 3.44 ? Math.abs(blinkPhase - 3.52) / 0.08 : 1.0

      // 1. Wide Woven Merchant Straw Hat (tilted back so his entire face is clear & expressive!)
      ctx.save()
      ctx.translate(0, -68)
      // Outer hat rim arch
      ctx.beginPath()
      ctx.ellipse(0, 10, 118, 44, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#e5decb'
      ctx.fill()
      strokeInk(1.45)

      // Hat crown dome behind head
      ctx.beginPath()
      ctx.moveTo(-116, 8)
      ctx.quadraticCurveTo(-55, -52, 0, -64)
      ctx.quadraticCurveTo(55, -52, 116, 8)
      ctx.quadraticCurveTo(0, -14, -116, 8)
      ctx.closePath()
      ctx.fillStyle = '#f4efe2'
      ctx.fill()
      strokeInk(1.45)

      // Radial bamboo ribs on hat crown
      ctx.beginPath()
      for (const rx of [-75, -38, 0, 38, 75]) {
        ctx.moveTo(0, -62)
        ctx.quadraticCurveTo(rx * 0.5, -32, rx, 2)
      }
      strokeInk(0.85, INK_SOFT)

      // Crimson merchant headband ribbon under crown
      ctx.beginPath()
      ctx.ellipse(0, 6, 46, 14, 0, Math.PI, Math.PI * 2)
      ctx.strokeStyle = '#b84239'
      ctx.lineWidth = 4.5
      ctx.stroke()
      ctx.restore()

      // 2. Merchant Torso, Layered Kimono Robes & Haori Coat
      ctx.beginPath()
      ctx.moveTo(-58, 22)
      ctx.quadraticCurveTo(-78, 56, -84, 115)
      ctx.lineTo(84, 115)
      ctx.quadraticCurveTo(78, 56, 58, 22)
      ctx.quadraticCurveTo(0, 10, -58, 22)
      ctx.closePath()
      ctx.fillStyle = '#ded8c8'
      ctx.fill()
      strokeInk(1.4)

      // Inner cream kimono collar V-neck
      ctx.beginPath()
      ctx.moveTo(-24, 16)
      ctx.lineTo(0, 58)
      ctx.lineTo(24, 16)
      ctx.closePath()
      ctx.fillStyle = PARCHMENT
      ctx.fill()
      strokeInk(1.2)

      // Crossed lapel folds
      ctx.beginPath()
      ctx.moveTo(-18, 16)
      ctx.lineTo(8, 52)
      ctx.moveTo(18, 16)
      ctx.lineTo(-3, 38)
      strokeInk(1.1, INK_MID)

      // Gold merchant medallion cord on chest
      ctx.beginPath()
      ctx.arc(0, 68, 7.5, 0, Math.PI * 2)
      ctx.fillStyle = '#e5be62'
      ctx.fill()
      strokeInk(1.1)

      // 3. Neck & Ears
      ctx.fillStyle = PARCHMENT
      ctx.beginPath()
      ctx.roundRect(-15, -4, 30, 26, 6)
      ctx.fill()
      strokeInk(1.2)

      for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.ellipse(side * 38, -32, 6.5, 11, side * 0.12, 0, Math.PI * 2)
        ctx.fillStyle = PARCHMENT
        ctx.fill()
        strokeInk(1.15)
      }

      // 4. Sculpted Front-Facing Anime Face!
      ctx.beginPath()
      ctx.moveTo(-36, -54)
      ctx.quadraticCurveTo(-38, -22, -26, -6)
      ctx.quadraticCurveTo(-12, 8, 0, 9)
      ctx.quadraticCurveTo(12, 8, 26, -6)
      ctx.quadraticCurveTo(38, -22, 36, -54)
      ctx.quadraticCurveTo(0, -64, -36, -54)
      ctx.closePath()
      ctx.fillStyle = PARCHMENT
      ctx.fill()
      strokeInk(1.38)

      // Temple hair & neat sideburns
      ctx.fillStyle = '#72706b'
      for (const side of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(side * 36, -52)
        ctx.quadraticCurveTo(side * 30, -45, side * 33, -24)
        ctx.lineTo(side * 37, -34)
        ctx.closePath()
        ctx.fill()
        strokeInk(0.95)
      }

      // Soft warm shadow under the hat brim across upper forehead
      ctx.fillStyle = 'rgba(62, 60, 56, 0.12)'
      ctx.beginPath()
      ctx.moveTo(-35, -52)
      ctx.quadraticCurveTo(0, -60, 35, -52)
      ctx.lineTo(35, -42)
      ctx.quadraticCurveTo(0, -47, -35, -42)
      ctx.closePath()
      ctx.fill()

      // Calm Eyebrows
      ctx.beginPath()
      ctx.moveTo(-25, -42)
      ctx.quadraticCurveTo(-16, -46, -8, -42)
      ctx.moveTo(8, -42)
      ctx.quadraticCurveTo(16, -46, 25, -42)
      strokeInk(1.55)

      // Expressive Anime Eyes (steady straight gaze, no cursor following)
      for (const side of [-1, 1]) {
        const ex = side * 16.5
        const ey = -33
        ctx.save()
        ctx.translate(ex, ey)
        if (eyeOpen < 0.2) {
          // Closed happy/blink eye arc
          ctx.beginPath()
          ctx.moveTo(-7, 0)
          ctx.quadraticCurveTo(0, 2.5, 7, 0)
          strokeInk(1.4)
        } else {
          // Sclera
          ctx.beginPath()
          ctx.ellipse(0, 0, 7.2, 5.2 * eyeOpen, 0, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
          strokeInk(1.25)

          // Centered Iris & Pupil looking straight ahead
          ctx.beginPath()
          ctx.arc(0, 0, 3.4 * eyeOpen, 0, Math.PI * 2)
          ctx.fillStyle = '#3a3834'
          ctx.fill()

          // Eye catchlight sparkle
          ctx.beginPath()
          ctx.arc(-1.2, -1.2, 1.1, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()

          // Upper eyelid crease
          ctx.beginPath()
          ctx.moveTo(-7.8, -1.5 * eyeOpen)
          ctx.quadraticCurveTo(0, -6.2 * eyeOpen, 7.8, -1.5 * eyeOpen)
          strokeInk(1.45)
        }
        ctx.restore()
      }

      // Sculpted Nose bridge & tip shadow
      ctx.beginPath()
      ctx.moveTo(-1, -30)
      ctx.lineTo(-2.5, -19)
      ctx.lineTo(1.5, -18)
      strokeInk(1.1, INK_MID)

      // Friendly Merchant Mustache / Goatee & Animated Speaking Mouth!
      ctx.beginPath()
      ctx.moveTo(-12, -11)
      ctx.quadraticCurveTo(-5, -14, 0, -11)
      ctx.quadraticCurveTo(5, -14, 12, -11)
      strokeInk(1.35, '#54534f')

      if (mouthOpen > 0.6) {
        ctx.beginPath()
        ctx.ellipse(0, -6.5, 6.2, mouthOpen, 0, 0, Math.PI * 2)
        ctx.fillStyle = '#7a3b36'
        ctx.fill()
        strokeInk(1.15)
      } else {
        ctx.beginPath()
        ctx.moveTo(-7.5, -7.5)
        ctx.quadraticCurveTo(0, -4.0, 7.5, -7.5)
        strokeInk(1.3)
      }

      // Short neat chin beard tuft
      ctx.beginPath()
      ctx.moveTo(-4, 4)
      ctx.lineTo(0, 11)
      ctx.lineTo(4, 4)
      ctx.fillStyle = '#62605b'
      ctx.fill()
      strokeInk(0.95)

      // 5. Merchant's Illustrated Multi-Finger Resting Welcoming Hand (matching character hand style!)
      ctx.save()
      ctx.translate(34, 68)
      // Forearm kimono sleeve & crisp wrist cuff
      ctx.fillStyle = '#e7e1d2'
      ctx.beginPath()
      ctx.roundRect(-24, 2, 22, 16, 6)
      ctx.fill()
      strokeInk(1.4)
      // Rounded elbow/cuff rim
      ctx.beginPath()
      ctx.moveTo(-4, 2)
      ctx.lineTo(-4, 18)
      strokeInk(1.45)

      // Chunky palm
      ctx.fillStyle = PARCHMENT
      ctx.beginPath()
      ctx.roundRect(-4, -1, 14, 17, 5)
      ctx.fill()
      strokeInk(1.4)

      // Distinct raised thumb tucked over top
      ctx.fillStyle = PARCHMENT
      ctx.beginPath()
      ctx.ellipse(4, -2.5, 6.2, 3.6, -0.18, 0, Math.PI * 2)
      ctx.fill()
      strokeInk(1.35)

      // 3 stacked curled finger segments along front edge
      for (const fyOff of [2.5, 7.2, 11.8]) {
        ctx.fillStyle = PARCHMENT
        ctx.beginPath()
        ctx.roundRect(6.5, fyOff - 2.3, 9.5, 4.6, 2.2)
        ctx.fill()
        strokeInk(1.3)
      }
      ctx.restore()

      // Nameplate badge above merchant
      ctx.save()
      ctx.translate(0, -142)
      ctx.fillStyle = 'rgba(250, 247, 240, 0.92)'
      ctx.strokeStyle = INK
      ctx.lineWidth = 1.1
      ctx.beginPath()
      ctx.roundRect(-84, -11, 168, 22, 4)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = INK
      ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('MASTER KENJI · SHOPKEEPER', 0, 0)
      ctx.restore()

      ctx.restore()
    }

    // =========================================================================
    // LAYER 3: WOODEN COUNTER & 6 INTERACTIVE ITEMS (STATIONARY)
    // =========================================================================
    const drawCounterAndItems = () => {
      ctx.save()

      // 1. Wooden Shop Counter Table (spanning full bottom foreground)
      // Counter top surface (trapezoid in perspective)
      ctx.beginPath()
      ctx.moveTo(-430, 72)
      ctx.lineTo(430, 72)
      ctx.lineTo(485, 178)
      ctx.lineTo(-485, 178)
      ctx.closePath()
      ctx.fillStyle = WOOD_LIGHT
      ctx.fill()
      strokeInk(1.45)

      // Counter front apron thickness
      ctx.beginPath()
      ctx.moveTo(-485, 178)
      ctx.lineTo(485, 178)
      ctx.lineTo(485, 225)
      ctx.lineTo(-485, 225)
      ctx.closePath()
      ctx.fillStyle = WOOD_DARK
      ctx.fill()
      strokeInk(1.45)

      // Perspective plank grain lines on counter top
      ctx.beginPath()
      ctx.moveTo(-445, 104)
      ctx.lineTo(445, 104)
      ctx.moveTo(-465, 140)
      ctx.lineTo(465, 140)
      strokeInk(0.85, INK_SOFT)

      // 2. Render each of the 6 physical items on the counter/racks!
      const owned = ownedRef.current
      const gear = gearRef.current
      const curCoins = coinsRef.current

      for (const item of SHOP_ITEMS) {
        const isHovered = hoveredRef.current === item.id
        const isSelected = selectedRef.current === item.id
        const isOwned = Boolean(owned[item.id])
        const isEquipped = Boolean(gear[item.id as keyof typeof gear])

        ctx.save()
        ctx.translate(item.posX, item.posY)

        // Interactive golden aura ring when hovered or selected
        if (isHovered || isSelected) {
          ctx.save()
          ctx.fillStyle = isHovered ? 'rgba(229, 190, 98, 0.28)' : 'rgba(229, 190, 98, 0.14)'
          ctx.beginPath()
          ctx.arc(0, 0, item.hitR * 0.82, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = isHovered ? '#c6993b' : 'rgba(198, 153, 59, 0.55)'
          ctx.lineWidth = isHovered ? 1.8 : 1.1
          ctx.setLineDash([5, 4])
          ctx.stroke()
          ctx.setLineDash([])
          ctx.restore()
        }

        // Draw each physical 3D item illustration!
        if (item.id === 'galeHat') {
          // Conical Gale Straw Hat hanging on left timber post
          ctx.fillStyle = 'rgba(42, 40, 36, 0.12)'
          ctx.beginPath()
          ctx.ellipse(4, 8, 42, 18, -0.15, 0, Math.PI * 2)
          ctx.fill()

          ctx.save()
          ctx.rotate(-0.14)
          ctx.beginPath()
          ctx.moveTo(0, -24)
          ctx.bezierCurveTo(-12, -14, -32, -4, -44, 6)
          ctx.quadraticCurveTo(0, 16, 44, 6)
          ctx.bezierCurveTo(32, -4, 12, -14, 0, -24)
          ctx.closePath()
          ctx.fillStyle = '#f4f0e4'
          ctx.fill()
          strokeInk(1.3, '#9b7428')
          // Gold woven rim
          ctx.beginPath()
          ctx.moveTo(-42, 5)
          ctx.quadraticCurveTo(0, 14, 42, 5)
          strokeInk(2.4, '#e5be62')
          // Radial bamboo ribs
          ctx.beginPath()
          ctx.moveTo(0, -22)
          ctx.lineTo(-26, 7)
          ctx.moveTo(0, -22)
          ctx.lineTo(26, 7)
          strokeInk(0.8, INK_SOFT)
          ctx.restore()
        } else if (item.id === 'shadowCloak') {
          // Folded Sumi Shadow Cloak on wooden stand
          ctx.fillStyle = 'rgba(42, 40, 36, 0.14)'
          ctx.beginPath()
          ctx.ellipse(0, 22, 34, 9, 0, 0, Math.PI * 2)
          ctx.fill()

          // Wooden T-stand
          ctx.strokeStyle = '#6e5a42'
          ctx.lineWidth = 3.2
          ctx.beginPath()
          ctx.moveTo(0, -26)
          ctx.lineTo(0, 22)
          ctx.moveTo(-24, -18)
          ctx.lineTo(24, -18)
          ctx.stroke()

          // Draped charcoal sumi haori cloak
          ctx.beginPath()
          ctx.moveTo(-24, -20)
          ctx.quadraticCurveTo(0, -24, 24, -20)
          ctx.lineTo(30, 16)
          ctx.quadraticCurveTo(0, 22, -30, 16)
          ctx.closePath()
          ctx.fillStyle = '#393b42'
          ctx.fill()
          strokeInk(1.3, '#1e2026')
          // Collar & drapery folds
          ctx.beginPath()
          ctx.moveTo(-9, -21)
          ctx.lineTo(0, 2)
          ctx.lineTo(9, -21)
          ctx.moveTo(-12, -6)
          ctx.lineTo(-16, 14)
          ctx.moveTo(12, -6)
          ctx.lineTo(16, 14)
          strokeInk(0.95, 'rgba(255,255,255,0.28)')
        } else if (item.id === 'crimsonScarf') {
          // Folded Crimson Wind Scarf on a lacquer display tray on the counter
          ctx.fillStyle = 'rgba(42, 40, 36, 0.14)'
          ctx.beginPath()
          ctx.ellipse(2, 14, 38, 11, 0, 0, Math.PI * 2)
          ctx.fill()

          // Dark lacquer tray
          ctx.fillStyle = '#38383f'
          ctx.beginPath()
          ctx.roundRect(-36, 2, 72, 16, 4)
          ctx.fill()
          strokeInk(1.2)

          // Coiled crimson silk scarf with swallowtail end
          ctx.fillStyle = '#b84239'
          ctx.beginPath()
          ctx.moveTo(-26, 4)
          ctx.quadraticCurveTo(-28, -14, 0, -14)
          ctx.quadraticCurveTo(28, -14, 26, 4)
          ctx.quadraticCurveTo(32, 14, 20, 22)
          ctx.lineTo(15, 16)
          ctx.lineTo(9, 22)
          ctx.quadraticCurveTo(4, 10, -26, 4)
          ctx.closePath()
          ctx.fill()
          strokeInk(1.25)
          ctx.beginPath()
          ctx.moveTo(-16, -5)
          ctx.quadraticCurveTo(0, -1, 16, -5)
          strokeInk(0.9, 'rgba(255,255,255,0.35)')
        } else if (item.id === 'moonlightBlade') {
          // Centerpiece Moonlight Sword on a 3D wooden Katana-Kake stand on the counter!
          ctx.fillStyle = 'rgba(42, 40, 36, 0.14)'
          ctx.beginPath()
          ctx.ellipse(0, 22, 58, 11, 0, 0, Math.PI * 2)
          ctx.fill()

          // Wooden sword rack uprights
          ctx.fillStyle = '#5e4c36'
          ctx.fillRect(-32, -8, 6, 28)
          ctx.fillRect(26, -8, 6, 28)
          ctx.fillRect(-40, 17, 80, 5)

          // Scabbard (lower rack)
          ctx.beginPath()
          ctx.roundRect(-52, 4, 104, 5.5, 2.5)
          ctx.fillStyle = '#384052'
          ctx.fill()
          strokeInk(1.15)

          // Gleaming Silver-Blue Moonlight Katana Blade (upper rack)
          ctx.save()
          ctx.translate(0, -8)
          ctx.beginPath()
          ctx.roundRect(-56, -2.5, 28, 5, 2)
          ctx.fillStyle = '#384052'
          ctx.fill()
          strokeInk(1.15)
          // Tsuba
          ctx.beginPath()
          ctx.ellipse(-26, 0, 2.2, 7.5, 0, 0, Math.PI * 2)
          ctx.fillStyle = '#e5be62'
          ctx.fill()
          strokeInk(1.1)
          // Curved silver-blue steel blade
          ctx.beginPath()
          ctx.moveTo(-24, -2.2)
          ctx.quadraticCurveTo(16, -4.5, 54, -1.8)
          ctx.quadraticCurveTo(60, 0, 54, 2.0)
          ctx.quadraticCurveTo(16, 0.2, -24, 2.2)
          ctx.closePath()
          ctx.fillStyle = '#eef4ff'
          ctx.fill()
          strokeInk(1.2, '#3e538c')
          ctx.restore()
        } else if (item.id === 'warBow') {
          // Asymmetrical Bamboo Yumi War Bow mounted on wooden wall bracket
          ctx.fillStyle = 'rgba(42, 40, 36, 0.10)'
          ctx.beginPath()
          ctx.ellipse(4, 2, 16, 40, 0.14, 0, Math.PI * 2)
          ctx.fill()

          // Wall pegs
          ctx.fillStyle = '#5e4c36'
          ctx.fillRect(-14, -22, 26, 4)
          ctx.fillRect(-14, 18, 26, 4)

          ctx.save()
          ctx.rotate(0.16)
          // Taut bowstring
          ctx.beginPath()
          ctx.moveTo(-6, -42)
          ctx.lineTo(-6, 34)
          strokeInk(1.15, INK_MID)

          // Curved bamboo Yumi stave
          ctx.beginPath()
          ctx.moveTo(-6, -42)
          ctx.bezierCurveTo(16, -28, 18, -8, 10, 6)
          ctx.bezierCurveTo(16, 18, 10, 28, -6, 34)
          strokeInk(4.4, '#6e4e2e')
          ctx.beginPath()
          ctx.moveTo(-6, -42)
          ctx.bezierCurveTo(16, -28, 18, -8, 10, 6)
          ctx.bezierCurveTo(16, 18, 10, 28, -6, 34)
          strokeInk(1.25, INK)

          // Crimson leather center grip wrap
          ctx.beginPath()
          ctx.moveTo(12, 0)
          ctx.lineTo(10, 12)
          strokeInk(5.2, '#b84239')
          ctx.restore()
        } else if (item.id === 'arrows') {
          // Woven Bamboo Quiver packed with crimson-fletched steel-tipped arrows!
          ctx.fillStyle = 'rgba(42, 40, 36, 0.14)'
          ctx.beginPath()
          ctx.ellipse(2, 18, 30, 9, 0, 0, Math.PI * 2)
          ctx.fill()

          // Diagonal arrow shafts & crimson fletching peeking out of quiver
          for (const [ax, ay, rot] of [
            [-11, -6, -0.22],
            [-2, -10, -0.05],
            [7, -8, 0.12],
            [14, -4, 0.25],
          ] as [number, number, number][]) {
            ctx.save()
            ctx.translate(ax, ay)
            ctx.rotate(rot)
            ctx.beginPath()
            ctx.moveTo(0, 14)
            ctx.lineTo(0, -18)
            strokeInk(2.0, '#785c3a')
            // Crimson fletching feathers
            ctx.fillStyle = '#b84239'
            ctx.beginPath()
            ctx.moveTo(0, -18)
            ctx.lineTo(-4.5, -12)
            ctx.lineTo(0, -10)
            ctx.lineTo(4.5, -12)
            ctx.closePath()
            ctx.fill()
            strokeInk(0.85)
            ctx.restore()
          }

          // Woven quiver cylinder body
          ctx.fillStyle = '#755b3c'
          ctx.beginPath()
          ctx.roundRect(-16, -2, 32, 22, 4)
          ctx.fill()
          strokeInk(1.25)

          // Gold/crimson quiver binding straps
          ctx.fillStyle = '#b84239'
          ctx.fillRect(-16, 4, 32, 4)
          ctx.strokeStyle = INK
          ctx.lineWidth = 0.9
          ctx.strokeRect(-16, 4, 32, 4)
        } else if (item.id === 'spiritBell') {
          // Golden Magnet Bell hanging from overhead beam (stationary)
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(0, -36)
          ctx.lineTo(0, -14)
          strokeInk(1.4, '#b84239')

          // Golden bell dome
          ctx.beginPath()
          ctx.arc(0, 0, 15, 0, Math.PI * 2)
          ctx.fillStyle = '#e5be62'
          ctx.fill()
          strokeInk(1.3)
          ctx.beginPath()
          ctx.moveTo(-14, 3)
          ctx.quadraticCurveTo(0, 7, 14, 3)
          ctx.arc(0, 8, 2.8, 0, Math.PI * 2)
          strokeInk(1.1, '#6b531c')

          // Hanging crimson paper charm tag
          ctx.fillStyle = '#b84239'
          ctx.beginPath()
          ctx.roundRect(-4, 15, 8, 18, 1.5)
          ctx.fill()
          strokeInk(1.0)
          ctx.restore()
        } else if (item.id === 'matchaTea') {
          // Focus Tea Flask & Ceramic Cup on the right counter (stationary)
          ctx.fillStyle = 'rgba(42, 40, 36, 0.14)'
          ctx.beginPath()
          ctx.ellipse(2, 16, 34, 10, 0, 0, Math.PI * 2)
          ctx.fill()

          // Double-bulb gourd flask
          ctx.fillStyle = '#d4dcb4'
          ctx.beginPath()
          ctx.arc(-8, 4, 13, 0, Math.PI * 2)
          ctx.arc(-8, -11, 8.5, 0, Math.PI * 2)
          ctx.fill()
          strokeInk(1.25)
          // Crimson waist cord on gourd
          ctx.beginPath()
          ctx.moveTo(-16, -4)
          ctx.quadraticCurveTo(-8, -1, 0, -4)
          strokeInk(2.2, '#b84239')

          // Matcha teacup beside gourd
          ctx.fillStyle = PARCHMENT
          ctx.beginPath()
          ctx.roundRect(8, 1, 18, 14, 3)
          ctx.fill()
          strokeInk(1.15)

          // Subtle static steam wisps
          ctx.beginPath()
          for (const sx of [13, 20]) {
            ctx.moveTo(sx, -3)
            ctx.quadraticCurveTo(sx + 2, -10, sx, -17)
          }
          strokeInk(0.95, 'rgba(84, 83, 79, 0.45)')
        }

        // 3. Crisp Price & Name Tag Pill directly below each item on the counter!
        const tagY = item.id === 'spiritBell' || item.id === 'warBow' ? 42 : 34
        const isBowItem = item.id === 'warBow'
        const bowActive = isBowItem && activeWeaponRef.current === 'bow'
        const statusText =
          item.id === 'arrows'
            ? `${item.price}G · HAVE ${arrowsRef.current}`
            : item.consumable
              ? `${item.price} GOLD`
              : isBowItem && isOwned
                ? bowActive
                  ? '✓ ACTIVE BOW'
                  : 'SKILL UNLOCKED'
                : isEquipped
                  ? '✓ EQUIPPED'
                  : isOwned
                    ? 'OWNED'
                    : `${item.price} GOLD`

        const pillDark = isBowItem ? bowActive : isEquipped
        ctx.save()
        ctx.translate(0, tagY)
        const pillW = Math.max(94, item.name.length * 6.3)
        ctx.fillStyle = pillDark
          ? '#26262b'
          : isHovered
            ? '#e5be62'
            : 'rgba(250, 247, 240, 0.95)'
        ctx.strokeStyle = '#26262b'
        ctx.lineWidth = isHovered || isSelected ? 1.5 : 1.05
        ctx.beginPath()
        ctx.roundRect(-pillW * 0.5, -14, pillW, 28, 4)
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = pillDark ? '#faf7f0' : '#222226'
        ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(item.name.toUpperCase(), 0, -5)

        ctx.fillStyle = pillDark
          ? '#e5be62'
          : !isOwned && curCoins < item.price
            ? '#8c4a44'
            : '#6b531c'
        ctx.font = 'extrabold 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        ctx.fillText(statusText, 0, 6.5)
        ctx.restore()

        ctx.restore()
      }

      // Celebratory gold purchase sparks
      const sparks = sparksRef.current
      for (const sp of sparks) {
        const t = sp.age / sp.maxAge
        ctx.strokeStyle = `rgba(216, 162, 54, ${1 - t})`
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(sp.x, sp.y)
        ctx.lineTo(sp.x - sp.vx * 0.03, sp.y - sp.vy * 0.03)
        ctx.stroke()
      }

      ctx.restore()
    }

    // =========================================================================
    // LAYER 4: OVERHEAD NOREN SHOP CURTAINS & SPEECH BUBBLE (STATIONARY)
    // =========================================================================
    const drawForegroundOverlay = () => {
      ctx.save()

      // Top hanging Noren shop banner flaps framing the shop view
      for (let i = -3; i <= 3; i++) {
        const x0 = i * 132 - 58
        ctx.fillStyle = i % 2 === 0 ? '#2f3544' : '#9e3830'
        ctx.beginPath()
        ctx.moveTo(x0, -290)
        ctx.lineTo(x0 + 116, -290)
        ctx.lineTo(x0 + 112, -222)
        ctx.lineTo(x0 - 4, -222)
        ctx.closePath()
        ctx.fill()
        strokeInk(1.2)

        // Subtle cream crest line on noren flap
        ctx.strokeStyle = 'rgba(250, 247, 240, 0.45)'
        ctx.lineWidth = 1.1
        ctx.beginPath()
        ctx.arc(x0 + 58, -252, 13, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Merchant's Live Speech Bubble right beside his head
      ctx.save()
      ctx.translate(242, -132)
      const msg = msgRef.current
      const bubbleW = clamp(msg.length * 6.4 + 28, 200, 296)
      ctx.fillStyle = '#faf7f0'
      ctx.strokeStyle = '#26262b'
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.roundRect(-bubbleW * 0.5, -20, bubbleW, 38, 6)
      ctx.fill()
      ctx.stroke()

      // Speech tail pointing toward Master Kenji's mouth
      ctx.beginPath()
      ctx.moveTo(-bubbleW * 0.5 + 18, 18)
      ctx.lineTo(-bubbleW * 0.5 - 12, 34)
      ctx.lineTo(-bubbleW * 0.5 + 36, 18)
      ctx.closePath()
      ctx.fillStyle = '#faf7f0'
      ctx.fill()
      ctx.stroke()

      ctx.fillStyle = '#222226'
      ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(msg.length > 44 ? msg.slice(0, 42) + '...' : msg, 0, -1)
      ctx.restore()

      ctx.restore()
    }

    // =========================================================================
    // MAIN SHOP RENDER LOOP (STATIONARY VIEW)
    // =========================================================================
    let lastTs = performance.now()
    let elapsed = 0
    let rafId = 0

    const loop = (ts: number) => {
      rafId = requestAnimationFrame(loop)
      const dt = Math.min(0.04, Math.max(0.001, (ts - lastTs) / 1000))
      lastTs = ts
      elapsed += dt

      if (talkTimerRef.current > 0) {
        talkTimerRef.current = Math.max(0, talkTimerRef.current - dt)
      }

      const sparks = sparksRef.current
      for (let i = sparks.length - 1; i >= 0; i--) {
        sparks[i].age += dt
        sparks[i].x += sparks[i].vx * dt
        sparks[i].y += sparks[i].vy * dt
        sparks[i].vy += 220 * dt
        if (sparks[i].age >= sparks[i].maxAge) sparks.splice(i, 1)
      }

      const W = canvas.clientWidth
      const H = canvas.clientHeight
      ctx.clearRect(0, 0, W, H)

      const baseScale = Math.min(W / 960, H / 540)
      ctx.save()
      ctx.translate(W * 0.5, H * 0.47)
      ctx.scale(baseScale, baseScale)

      drawRoomBackground()
      drawMerchantFaceToFace(elapsed)
      drawCounterAndItems()
      drawForegroundOverlay()

      ctx.restore()
    }

    rafId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  const isOwned = Boolean(ownedItems[activeItem.id])
  const isEquipped = Boolean(equippedGear[activeItem.id as keyof typeof equippedGear])
  const canAfford = coins >= activeItem.price

  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex flex-col justify-between bg-[#e9e3d5] select-none font-mono">
      {/* Interactive 3D First-Person POV Shop Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block cursor-pointer" />

      {/* Top POV Bar */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pointer-events-none">
        <div className="pointer-events-auto px-3.5 py-2 bg-[#faf7f0]/92 backdrop-blur-sm border-2 border-[#26262b] shadow-md">
          <div className="text-[10px] uppercase tracking-[0.2em] font-extrabold text-[#26262b]">
            MERCHANT COUNTER // SAMURAI SHOP
          </div>
          <div className="text-[11px] text-[#4a4a50] mt-0.5">
            Click any item on the counter to buy or equip.
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2.5">
          <div className="px-3.5 py-2 bg-[#e5be62] border-2 border-[#26262b] text-xs font-extrabold text-[#222226] shadow-md">
            GOLD POUCH: {coins} GOLD
          </div>
          <div className="px-3 py-2 bg-[#faf7f0] border-2 border-[#26262b] text-xs font-extrabold text-[#222226] shadow-md">
            ARROWS: {arrows}
          </div>
          <button
            type="button"
            onClick={onGrantBonusGold}
            className="px-3 py-2 bg-[#faf7f0] border-2 border-[#26262b] hover:bg-[#26262b] hover:text-white text-xs font-bold uppercase cursor-pointer shadow-md transition-colors"
          >
            +100 Bonus Gold
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 bg-[#26262b] border-2 border-[#26262b] hover:bg-[#3e3e46] text-[#faf7f0] text-xs font-extrabold uppercase cursor-pointer shadow-md transition-colors"
          >
            ← Back to Map [E / Esc]
          </button>
        </div>
      </div>

      {/* Bottom Inspector Dock & Quick-Select Counter Shelf */}
      <div className="relative z-10 px-5 pb-4 pointer-events-none flex flex-col items-center gap-2">
        {/* Selected Item Detail Card */}
        <div className="pointer-events-auto w-full max-w-4xl bg-[#faf7f0]/95 backdrop-blur-md border-2 border-[#26262b] shadow-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-extrabold uppercase text-[#222226]">
                {activeItem.name}
              </span>
              <span className="px-2 py-0.5 text-[10px] bg-[#26262b] text-[#faf7f0] font-bold uppercase">
                {activeItem.tag} · {activeItem.category}
              </span>
              <span className="text-xs font-extrabold text-[#6b531c]">
                {activeItem.id === 'arrows'
                  ? `${activeItem.price} GOLD (HAVE ${arrows})`
                  : isOwned && !activeItem.consumable
                    ? 'OWNED'
                    : `${activeItem.price} GOLD`}
              </span>
            </div>
            <p className="text-xs text-[#45454c] mt-1 leading-snug">
              {activeItem.desc}
            </p>
          </div>

          <button
            type="button"
            onClick={() => triggerItemAction(activeItem)}
            className={`shrink-0 px-5 py-2.5 text-xs uppercase font-extrabold border-2 border-[#26262b] cursor-pointer transition-colors ${
              isOwned && !activeItem.consumable
                ? (activeItem.id === 'warBow' ? activeWeapon === 'bow' : isEquipped)
                  ? 'bg-[#26262b] text-white'
                  : 'bg-white text-[#26262b] hover:bg-[#26262b] hover:text-white'
                : canAfford
                  ? 'bg-[#b84239] text-white hover:bg-[#96332b]'
                  : 'bg-black/10 text-[#777] cursor-not-allowed'
            }`}
          >
            {activeItem.id === 'arrows'
              ? `Buy +10 Arrows · ${activeItem.price} Gold`
              : activeItem.consumable
                ? `Drink Flask · ${activeItem.price} Gold`
                : activeItem.id === 'warBow' && isOwned
                  ? activeWeapon === 'bow'
                    ? '✓ Bow Active (Switch to Katana)'
                    : 'Switch to Bow [Q]'
                  : isOwned
                    ? isEquipped
                      ? '✓ Equipped (Click to Remove)'
                      : 'Equip on Hero'
                    : `Buy Item · ${activeItem.price} Gold`}
          </button>
        </div>

        {/* Quick-Select Item Bar */}
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5">
          {SHOP_ITEMS.map((it) => {
            const owned = Boolean(ownedItems[it.id])
            const equipped =
              it.id === 'warBow'
                ? owned && activeWeapon === 'bow'
                : Boolean(equippedGear[it.id as keyof typeof equippedGear])
            const active = activeItem.id === it.id
            return (
              <button
                key={it.id}
                type="button"
                onMouseEnter={() => {
                  setHoveredId(it.id)
                  setSelectedId(it.id)
                }}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => triggerItemAction(it)}
                className={`px-2.5 py-1 text-[10.5px] uppercase border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#26262b] border-[#26262b] text-white font-extrabold'
                    : equipped
                      ? 'bg-[#e5be62] border-[#26262b] text-[#222226] font-bold'
                      : 'bg-[#faf7f0]/90 border-[#26262b]/60 text-[#222226] hover:border-[#26262b]'
                }`}
              >
                {it.name} ·{' '}
                {it.id === 'arrows'
                  ? `${it.price}G (${arrows})`
                  : equipped
                    ? '✓'
                    : owned
                      ? 'Owned'
                      : `${it.price}G`}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
