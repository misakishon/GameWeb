import { useEffect, useRef, useState } from 'react'
import {
  ALL_WORLD_TREES,
  CONNECTOR_STONES,
  CONTINENTS,
  EXPEDITION_ROUTES,
  MYSTERIOUS_STATUES,
  WAYSTATIONS,
  WILDERNESS_POOLS,
  WORLD_LIMIT_X,
  WORLD_LIMIT_Y,
  getContinentLiquidBoundary,
  getNearestContinent,
  getWildernessPoolBoundary,
  sampleRouteBezier,
  type ContinentConfig,
  type ContinentId,
  type MysteriousStatue,
  type TreeKind,
} from './continents'

interface FullWorldMapModalProps {
  paperTone: 'white' | 'studio'
  playerX: number
  playerY: number
  playerHeading: number
  activeContinentId: ContinentId
  discoveredContinents: Record<ContinentId, boolean>
  completedStatues: Record<string, boolean>
  scoutUnlockAll: boolean
  onToggleScoutUnlock: () => void
  onTeleportWorld: (wx: number, wy: number, label?: string, color?: string) => void
  onTeleportContinent: (id: ContinentId) => void
  onClose: () => void
}

export default function FullWorldMapModal({
  paperTone,
  playerX,
  playerY,
  playerHeading,
  activeContinentId,
  discoveredContinents,
  completedStatues,
  scoutUnlockAll,
  onToggleScoutUnlock,
  onTeleportWorld,
  onTeleportContinent,
  onClose,
}: FullWorldMapModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const staticCacheRef = useRef<{
    canvas: HTMLCanvasElement | null
    key: string
  }>({ canvas: null, key: '' })

  const [zoom, setZoom] = useState(1.0)
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const dragRef = useRef<{
    active: boolean
    moved: boolean
    startX: number
    startY: number
    origX: number
    origY: number
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  })
  const [hoverInfo, setHoverInfo] = useState<{
    wx: number
    wy: number
    sx: number
    sy: number
    region: ContinentConfig
    canTeleport: boolean
    nearStatue: MysteriousStatue | null
  } | null>(null)

  const getProjection = (W: number, H: number, z = zoom, p = pan) => {
    const pad = 26
    const spanX = WORLD_LIMIT_X * 2 + 240
    const spanY = WORLD_LIMIT_Y * 2 + 240
    const baseScale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY)
    const scale = baseScale * z
    const cx = W * 0.5 + p.x
    const cy = H * 0.5 + p.y
    return {
      scale,
      cx,
      cy,
      toScreenX: (wx: number) => cx + wx * scale,
      toScreenY: (wy: number) => cy + wy * scale,
      toWorldX: (sx: number) => (sx - cx) / scale,
      toWorldY: (sy: number) => (sy - cy) / scale,
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const drawMiniTree = (
      tctx: CanvasRenderingContext2D,
      tx: number,
      ty: number,
      kind: TreeKind,
      white: boolean,
      s: number
    ) => {
      tctx.save()
      tctx.translate(tx, ty)
      tctx.scale(s, s)
      if (kind === 'bamboo') {
        tctx.strokeStyle = '#3c4a32'
        tctx.lineWidth = 1.1
        tctx.beginPath()
        tctx.moveTo(-1.6, 1)
        tctx.lineTo(-1.9, -5.6)
        tctx.moveTo(0, 1)
        tctx.lineTo(0, -6.8)
        tctx.moveTo(1.6, 1)
        tctx.lineTo(1.9, -5.2)
        tctx.stroke()
        tctx.fillStyle = white ? '#8da372' : '#657a55'
        tctx.beginPath()
        tctx.ellipse(0, -6.2, 3.0, 1.7, 0, 0, Math.PI * 2)
        tctx.fill()
      } else if (kind === 'palm') {
        tctx.strokeStyle = '#6e563b'
        tctx.lineWidth = 1.4
        tctx.beginPath()
        tctx.moveTo(0, 1.2)
        tctx.quadraticCurveTo(1.1, -3.0, 1.8, -6.2)
        tctx.stroke()
        tctx.strokeStyle = white ? '#628549' : '#466134'
        tctx.lineWidth = 1.05
        tctx.beginPath()
        for (let f = 0; f < 5; f++) {
          const fa = (f / 5) * Math.PI * 2
          tctx.moveTo(1.8, -6.2)
          tctx.lineTo(1.8 + Math.cos(fa) * 4.2, -5.2 + Math.sin(fa) * 2.4)
        }
        tctx.stroke()
      } else if (kind === 'cactus') {
        tctx.strokeStyle = white ? '#5f7e4e' : '#445d39'
        tctx.lineCap = 'round'
        tctx.lineWidth = 2.0
        tctx.beginPath()
        tctx.moveTo(0, 1.2)
        tctx.lineTo(0, -6.2)
        tctx.stroke()
        tctx.lineWidth = 1.2
        tctx.beginPath()
        tctx.moveTo(0, -2.8)
        tctx.lineTo(-2.4, -2.8)
        tctx.lineTo(-2.4, -5.0)
        tctx.moveTo(0, -3.8)
        tctx.lineTo(2.2, -3.8)
        tctx.lineTo(2.2, -5.6)
        tctx.stroke()
      } else if (kind === 'pine' || kind === 'snow-pine') {
        const isSnow = kind === 'snow-pine'
        tctx.fillStyle = '#5c4a39'
        tctx.fillRect(-0.9, -3.2, 1.8, 4.4)
        tctx.fillStyle = isSnow ? (white ? '#425e64' : '#2f454a') : white ? '#486049' : '#354736'
        tctx.beginPath()
        tctx.moveTo(0, -8.0)
        tctx.lineTo(-4.2, -1.6)
        tctx.lineTo(4.2, -1.6)
        tctx.closePath()
        tctx.fill()
        if (isSnow) {
          tctx.fillStyle = '#eff7fb'
          tctx.beginPath()
          tctx.moveTo(0, -8.0)
          tctx.lineTo(-2.4, -4.5)
          tctx.lineTo(2.4, -4.5)
          tctx.closePath()
          tctx.fill()
        }
      } else if (kind === 'charred') {
        tctx.strokeStyle = '#2a2422'
        tctx.lineWidth = 1.4
        tctx.beginPath()
        tctx.moveTo(0, 1.2)
        tctx.lineTo(0, -5.2)
        tctx.moveTo(0, -3.4)
        tctx.lineTo(-2.8, -6.4)
        tctx.moveTo(0, -3.8)
        tctx.lineTo(2.6, -6.6)
        tctx.stroke()
        tctx.fillStyle = '#b84828'
        tctx.beginPath()
        tctx.arc(-2.4, -6.2, 1.4, 0, Math.PI * 2)
        tctx.arc(2.2, -6.4, 1.3, 0, Math.PI * 2)
        tctx.fill()
      } else {
        const isJungle = kind === 'jungle'
        tctx.fillStyle = '#57483e'
        tctx.fillRect(-0.9, -3.4, 1.8, 4.4)
        tctx.fillStyle = isJungle ? (white ? '#3b6f46' : '#295032') : white ? '#8c4b3b' : '#6b392d'
        tctx.beginPath()
        tctx.arc(0, -5.0, 3.3, 0, Math.PI * 2)
        tctx.fill()
      }
      tctx.restore()
    }

    const renderStaticWorldLayer = (W: number, H: number, dpr: number) => {
      let off = staticCacheRef.current.canvas
      if (!off) {
        off = document.createElement('canvas')
        staticCacheRef.current.canvas = off
      }
      off.width = Math.floor(W * dpr)
      off.height = Math.floor(H * dpr)
      const octx = off.getContext('2d')!
      octx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const white = paperTone === 'white'
      const proj = getProjection(W, H)
      const { toScreenX, toScreenY, scale } = proj
      const treeScale = Math.max(0.56, Math.min(1.5, zoom * 0.62))

      // 1. Parchment Cartography Backdrop
      octx.fillStyle = white ? '#efe8da' : '#989b96'
      octx.fillRect(0, 0, W, H)

      // Broad Regional Biome Earth Washes (so every forest sits on natural biome ground!)
      for (const cont of CONTINENTS) {
        const ox = toScreenX(cont.origin.x)
        const oy = toScreenY(cont.origin.y)
        const wideR = cont.territoryRadius * 3.0 * scale
        const wGrad = octx.createRadialGradient(ox, oy, wideR * 0.15, ox, oy, wideR)
        const fillHex = white ? cont.paperBase : cont.boardBase
        wGrad.addColorStop(0, fillHex)
        wGrad.addColorStop(0.55, fillHex)
        wGrad.addColorStop(1, 'rgba(239, 232, 218, 0)')
        octx.fillStyle = wGrad
        octx.beginPath()
        octx.arc(ox, oy, wideR, 0, Math.PI * 2)
        octx.fill()
      }

      // Cartography Grid & World Border
      octx.strokeStyle = 'rgba(54, 53, 50, 0.08)'
      octx.lineWidth = 0.85
      octx.beginPath()
      for (let gxWorld = -6000; gxWorld <= 6000; gxWorld += 1200) {
        const gx = toScreenX(gxWorld)
        octx.moveTo(gx, 0)
        octx.lineTo(gx, H)
      }
      for (let gyWorld = -4800; gyWorld <= 4800; gyWorld += 1200) {
        const gy = toScreenY(gyWorld)
        octx.moveTo(0, gy)
        octx.lineTo(W, gy)
      }
      octx.stroke()

      octx.strokeStyle = 'rgba(54, 53, 50, 0.42)'
      octx.lineWidth = 1.5
      octx.setLineDash([8, 6])
      octx.strokeRect(
        toScreenX(-WORLD_LIMIT_X),
        toScreenY(-WORLD_LIMIT_Y),
        WORLD_LIMIT_X * 2 * scale,
        WORLD_LIMIT_Y * 2 * scale
      )
      octx.setLineDash([])

      // 2. Continent Territory Rings
      for (const cont of CONTINENTS) {
        const isUnlocked = scoutUnlockAll || Boolean(discoveredContinents[cont.id])
        const ox = toScreenX(cont.origin.x)
        const oy = toScreenY(cont.origin.y)
        const rad = cont.territoryRadius * scale
        octx.strokeStyle = isUnlocked ? `${cont.badgeColor}88` : 'rgba(84, 83, 79, 0.35)'
        octx.lineWidth = isUnlocked ? 1.6 : 1.1
        octx.setLineDash([6, 5])
        octx.beginPath()
        octx.arc(ox, oy, rad * 0.82, 0, Math.PI * 2)
        octx.stroke()
        octx.setLineDash([])
      }

      // 3. 18 Wilderness Water & Magma Pools across the World!
      for (const wp of WILDERNESS_POOLS) {
        const cx = toScreenX(wp.x)
        const cy = toScreenY(wp.y)
        if (cx < -60 || cx > W + 60 || cy < -60 || cy > H + 60) continue
        octx.beginPath()
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2
          const pt = getWildernessPoolBoundary(wp, a)
          const px = toScreenX(pt.x)
          const py = toScreenY(pt.y)
          if (i === 0) octx.moveTo(px, py)
          else octx.lineTo(px, py)
        }
        octx.closePath()
        octx.fillStyle =
          wp.kind === 'oasis'
            ? '#64b2b8'
            : wp.kind === 'glacial-lake'
              ? '#6e97b0'
              : wp.kind === 'emerald-lagoon'
                ? '#4c8670'
                : wp.kind === 'magma'
                  ? '#d45b1c'
                  : '#7a98a3'
        octx.fill()
        octx.strokeStyle = '#363532'
        octx.lineWidth = 0.9
        octx.stroke()
      }

      // 4. Winding Overland Expedition Trails
      for (const route of EXPEDITION_ROUTES) {
        octx.beginPath()
        for (let i = 0; i <= 44; i++) {
          const pt = sampleRouteBezier(route, i / 44)
          const sx = toScreenX(pt.x)
          const sy = toScreenY(pt.y)
          if (i === 0) octx.moveTo(sx, sy)
          else octx.lineTo(sx, sy)
        }
        octx.strokeStyle = 'rgba(236, 226, 206, 0.85)'
        octx.lineWidth = Math.max(3.2, 26 * scale)
        octx.lineCap = 'round'
        octx.stroke()

        octx.strokeStyle = route.color
        octx.lineWidth = 1.3
        octx.setLineDash([5, 5])
        octx.stroke()
        octx.setLineDash([])
      }

      if (zoom >= 1.35) {
        octx.fillStyle = white ? 'rgba(138, 130, 114, 0.55)' : 'rgba(72, 74, 68, 0.55)'
        for (const st of CONNECTOR_STONES) {
          const sx = toScreenX(st.x)
          const sy = toScreenY(st.y)
          if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue
          octx.fillRect(sx - 1.5, sy - 1.5, 3.0, 3.0)
        }
      }

      // 5.Continent Liquids & Bridges
      for (const cont of CONTINENTS) {
        octx.beginPath()
        for (let i = 0; i <= 32; i++) {
          const a = (i / 32) * Math.PI * 2
          const pt = getContinentLiquidBoundary(cont, a)
          const px = toScreenX(pt.x)
          const py = toScreenY(pt.y)
          if (i === 0) octx.moveTo(px, py)
          else octx.lineTo(px, py)
        }
        octx.closePath()
        const lcx = toScreenX(cont.liquidCenter.x)
        const lcy = toScreenY(cont.liquidCenter.y)
        const lGrad = octx.createRadialGradient(lcx, lcy, 2, lcx, lcy, Math.max(8, 220 * scale))
        if (cont.liquidKind === 'oasis') {
          lGrad.addColorStop(0, '#3d8e9c')
          lGrad.addColorStop(1, '#94cfc8')
        } else if (cont.liquidKind === 'glacial-lake') {
          lGrad.addColorStop(0, '#3b5d76')
          lGrad.addColorStop(1, '#a4c4d6')
        } else if (cont.liquidKind === 'emerald-lagoon') {
          lGrad.addColorStop(0, '#2c6452')
          lGrad.addColorStop(1, '#7db096')
        } else if (cont.liquidKind === 'magma') {
          lGrad.addColorStop(0, '#f0b844')
          lGrad.addColorStop(0.6, '#d45b1c')
          lGrad.addColorStop(1, '#7a2518')
        } else {
          lGrad.addColorStop(0, '#5b7885')
          lGrad.addColorStop(1, '#9bb4bc')
        }
        octx.fillStyle = lGrad
        octx.fill()
        octx.strokeStyle = '#363532'
        octx.lineWidth = 1.0
        octx.stroke()

        const br = cont.bridge
        const bx0 = toScreenX(br.minX + 4)
        const by0 = toScreenY(br.yCenter - 32)
        const bw = Math.max(4, toScreenX(br.maxX - 4) - bx0)
        const bh = Math.max(3, toScreenY(br.yCenter + 32) - by0)
        octx.fillStyle = br.style === 'obsidian' ? '#4b4542' : br.style === 'frost' ? '#e6f1f6' : '#d8c8ad'
        octx.fillRect(bx0, by0, bw, bh)
        octx.strokeStyle = '#363532'
        octx.lineWidth = 0.8
        octx.strokeRect(bx0, by0, bw, bh)
      }

      // 6. ALL ~1,700+ REAL MINIATURE TREES BLANKETING THE ENTIRE WORLD MAP!
      for (const tr of ALL_WORLD_TREES) {
        const tx = toScreenX(tr.x)
        const ty = toScreenY(tr.y)
        if (tx < -12 || tx > W + 12 || ty < -12 || ty > H + 12) continue
        drawMiniTree(octx, tx, ty, tr.kind, white, treeScale)
      }

      // 7. Midway Waystation Camps
      for (const ws of WAYSTATIONS) {
        const wx = toScreenX(ws.x)
        const wy = toScreenY(ws.y)
        if (wx < -40 || wx > W + 40 || wy < -40 || wy > H + 40) continue
        octx.fillStyle = '#faf7f0'
        octx.strokeStyle = ws.accent
        octx.lineWidth = 1.5
        octx.beginPath()
        octx.arc(wx, wy, 5.0, 0, Math.PI * 2)
        octx.fill()
        octx.stroke()
        octx.fillStyle = '#e87c34'
        octx.beginPath()
        octx.arc(wx, wy, 2.2, 0, Math.PI * 2)
        octx.fill()
      }

      // 8. 10 Mysterious Unrecognized Statues ('?' Unknown vs '★' Cleansed Task!)
      for (const st of MYSTERIOUS_STATUES) {
        const sx = toScreenX(st.x)
        const sy = toScreenY(st.y)
        if (sx < -24 || sx > W + 24 || sy < -24 || sy > H + 24) continue
        const done = Boolean(completedStatues[st.id])
        octx.fillStyle = done ? '#e5be62' : '#4a3d5c'
        octx.strokeStyle = '#26262b'
        octx.lineWidth = 1.2
        octx.beginPath()
        octx.arc(sx, sy, 6.2, 0, Math.PI * 2)
        octx.fill()
        octx.stroke()
        octx.fillStyle = done ? '#222226' : '#faf7f0'
        octx.font = 'bold 8.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        octx.textAlign = 'center'
        octx.textBaseline = 'middle'
        octx.fillText(done ? '★' : '?', sx, sy + 0.5)
      }

      // 9. Continent Shops, Fog & Title Banners
      for (const cont of CONTINENTS) {
        const isUnlocked = scoutUnlockAll || Boolean(discoveredContinents[cont.id])
        const sx = toScreenX(cont.shopPos.x)
        const sy = toScreenY(cont.shopPos.y)
        octx.fillStyle = '#b84239'
        octx.fillRect(sx - 5, sy - 4.5, 10, 9)
        octx.strokeStyle = '#26262b'
        octx.lineWidth = 1.0
        octx.strokeRect(sx - 5, sy - 4.5, 10, 9)
        octx.fillStyle = '#faf7f0'
        octx.font = 'bold 7px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        octx.textAlign = 'center'
        octx.textBaseline = 'middle'
        octx.fillText('S', sx, sy + 0.5)

        if (!isUnlocked) {
          octx.fillStyle = 'rgba(38, 36, 34, 0.14)'
          octx.beginPath()
          octx.arc(
            toScreenX(cont.origin.x),
            toScreenY(cont.origin.y),
            cont.territoryRadius * scale * 0.78,
            0,
            Math.PI * 2
          )
          octx.fill()
        }

        const labelX = toScreenX(cont.origin.x)
        const labelY = toScreenY(cont.origin.y - 740)
        const isCurrent = cont.id === activeContinentId
        const lockIcon = isUnlocked ? '✓' : '🔒'
        const titleText = `[${cont.keyNum}] ${cont.shortName.toUpperCase()} · ${cont.tierLabel} ${lockIcon}`
        octx.font = 'bold 9.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        const tw = octx.measureText(titleText).width + 20
        octx.fillStyle = isCurrent
          ? '#26262b'
          : isUnlocked
            ? 'rgba(250, 247, 240, 0.96)'
            : 'rgba(228, 224, 216, 0.94)'
        octx.strokeStyle = isCurrent ? cont.badgeColor : '#26262b'
        octx.lineWidth = isCurrent ? 2.0 : 1.15
        octx.beginPath()
        octx.roundRect(labelX - tw * 0.5, labelY - 10, tw, 20, 3)
        octx.fill()
        octx.stroke()

        octx.fillStyle = cont.badgeColor
        octx.beginPath()
        octx.arc(labelX - tw * 0.5 + 8, labelY, 3.2, 0, Math.PI * 2)
        octx.fill()

        octx.fillStyle = isCurrent ? '#faf7f0' : '#26262b'
        octx.textAlign = 'center'
        octx.textBaseline = 'middle'
        octx.fillText(titleText, labelX + 4, labelY + 0.5)
      }
    }

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const W = canvas.clientWidth
      const H = canvas.clientHeight
      if (W <= 0 || H <= 0) return
      if (canvas.width !== Math.floor(W * dpr) || canvas.height !== Math.floor(H * dpr)) {
        canvas.width = Math.floor(W * dpr)
        canvas.height = Math.floor(H * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const cacheKey = `${W}x${H}@${dpr}:${paperTone}:${zoom}:${pan.x},${pan.y}:${activeContinentId}:${scoutUnlockAll}:${ JSON.stringify(discoveredContinents)}:${JSON.stringify(completedStatues)}`
      if (staticCacheRef.current.key !== cacheKey || !staticCacheRef.current.canvas) {
        renderStaticWorldLayer(W, H, dpr)
        staticCacheRef.current.key = cacheKey
      }

      ctx.drawImage(staticCacheRef.current.canvas!, 0, 0, W, H)

      const proj = getProjection(W, H)
      const { toScreenX, toScreenY } = proj

      // Hover Reticle
      if (hoverInfo) {
        ctx.save()
        ctx.translate(hoverInfo.sx, hoverInfo.sy)
        ctx.strokeStyle = hoverInfo.nearStatue
          ? '#7c52b8'
          : hoverInfo.canTeleport
            ? hoverInfo.region.badgeColor
            : '#7a7874'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.arc(0, 0, 12, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      }

      // Live Samurai Player Marker
      const px = toScreenX(playerX)
      const py = toScreenY(playerY)
      ctx.strokeStyle = 'rgba(184, 66, 57, 0.72)'
      ctx.lineWidth = 2.2
      ctx.beginPath()
      ctx.arc(px, py, 11, 0, Math.PI * 2)
      ctx.stroke()

      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(playerHeading)
      ctx.fillStyle = '#26262b'
      ctx.beginPath()
      ctx.moveTo(8, 0)
      ctx.lineTo(-5.2, -5)
      ctx.lineTo(-2.6, 0)
      ctx.lineTo(-5.2, 5)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#faf7f0'
      ctx.lineWidth = 1.2
      ctx.stroke()
      ctx.restore()

      // Compass Rose
      const crX = 48
      const crY = H - 48
      ctx.save()
      ctx.translate(crX, crY)
      ctx.fillStyle = 'rgba(250, 247, 240, 0.92)'
      ctx.strokeStyle = '#26262b'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(0, 0, 22, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#b84239'
      ctx.beginPath()
      ctx.moveTo(0, -15)
      ctx.lineTo(-4, 0)
      ctx.lineTo(4, 0)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#26262b'
      ctx.beginPath()
      ctx.moveTo(0, 15)
      ctx.lineTo(-4, 0)
      ctx.lineTo(4, 0)
      ctx.closePath()
      ctx.fill()
      ctx.font = 'bold 8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('N', 0, -28)
      ctx.fillText('S', 0, 29)
      ctx.fillText('W', -29, 0)
      ctx.fillText('E', 29, 0)
      ctx.restore()
    }

    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [
    paperTone,
    playerX,
    playerY,
    playerHeading,
    activeContinentId,
    discoveredContinents,
    completedStatues,
    scoutUnlockAll,
    zoom,
    pan,
    hoverInfo,
  ])

  const cleansedCount = Object.values(completedStatues).filter(Boolean).length

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3.5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1220px] h-[90vh] max-h-[860px] bg-[#faf7f0] border-2 border-[#26262b] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="px-4 py-2.5 bg-[#26262b] text-[#faf7f0] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs uppercase tracking-[0.2em] font-bold">
              5-CONTINENT EXPEDITION MAP · FORESTS, WATERS &amp; ANCIENT STATUES
            </span>
            <span className="text-[11px] text-[#e5be62]">
              STATUES CLEANSED: {cleansedCount}/{MYSTERIOUS_STATUES.length} · SCROLL ZOOM · DRAG PAN
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(4.5, +(z + 0.45).toFixed(2)))}
              className="px-2 py-1 text-[11px] font-bold bg-[#3a3a42] hover:bg-[#52525b] text-white cursor-pointer"
            >
              Zoom +
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1.0, +(z - 0.45).toFixed(2)))}
              className="px-2 py-1 text-[11px] font-bold bg-[#3a3a42] hover:bg-[#52525b] text-white cursor-pointer"
            >
              Zoom −
            </button>
            <button
              type="button"
              onClick={() => {
                setZoom(1.0)
                setPan({ x: 0, y: 0 })
              }}
              className="px-2 py-1 text-[11px] uppercase font-bold bg-[#3a3a42] hover:bg-[#52525b] text-white cursor-pointer"
            >
              Full Fit
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-2 px-2.5 py-1 text-[11px] uppercase font-bold bg-[#faf7f0] text-[#26262b] hover:bg-[#e5be62] transition-colors cursor-pointer"
            >
              Close [M / Esc]
            </button>
          </div>
        </div>

        {/* Interactive Zoom/Pan Cartography Canvas */}
        <div className="relative flex-1 min-h-0">
          <canvas
            ref={canvasRef}
            onWheel={(e) => {
              e.preventDefault()
              const delta = e.deltaY < 0 ? 0.28 : -0.28
              setZoom((z) => Math.max(1.0, Math.min(4.5, +(z + delta).toFixed(2))))
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              dragRef.current = {
                active: true,
                moved: false,
                startX: e.clientX,
                startY: e.clientY,
                origX: pan.x,
                origY: pan.y,
              }
            }}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              if (dragRef.current.active) {
                const dx = e.clientX - dragRef.current.startX
                const dy = e.clientY - dragRef.current.startY
                if (Math.hypot(dx, dy) > 5) dragRef.current.moved = true
                setPan({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy })
              }
              const sx = e.clientX - rect.left
              const sy = e.clientY - rect.top
              const proj = getProjection(rect.width, rect.height)
              const wx = Math.round(Math.max(-WORLD_LIMIT_X, Math.min(WORLD_LIMIT_X, proj.toWorldX(sx))))
              const wy = Math.round(Math.max(-WORLD_LIMIT_Y, Math.min(WORLD_LIMIT_Y, proj.toWorldY(sy))))
              const region = getNearestContinent(wx, wy)
              const canTeleport = scoutUnlockAll || Boolean(discoveredContinents[region.id])
              let nearStatue: MysteriousStatue | null = null
              for (const st of MYSTERIOUS_STATUES) {
                if (Math.hypot(wx - st.x, wy - st.y) < 260) {
                  nearStatue = st
                  break
                }
              }
              setHoverInfo({ wx, wy, sx, sy, region, canTeleport, nearStatue })
            }}
            onPointerUp={(e) => {
              const wasMoved = dragRef.current.moved
              dragRef.current.active = false
              if (wasMoved) return
              const rect = e.currentTarget.getBoundingClientRect()
              const sx = e.clientX - rect.left
              const sy = e.clientY - rect.top
              const proj = getProjection(rect.width, rect.height)
              const wx = Math.max(-WORLD_LIMIT_X, Math.min(WORLD_LIMIT_X, proj.toWorldX(sx)))
              const wy = Math.max(-WORLD_LIMIT_Y, Math.min(WORLD_LIMIT_Y, proj.toWorldY(sy)))
              const target = getNearestContinent(wx, wy)
              const isUnlocked = scoutUnlockAll || Boolean(discoveredContinents[target.id])
              if (!isUnlocked) return
              onTeleportWorld(wx, wy, `TELEPORTED · ${target.shortName.toUpperCase()}`, target.badgeColor)
              onClose()
            }}
            onPointerLeave={() => {
              dragRef.current.active = false
              setHoverInfo(null)
            }}
            className="w-full h-full block cursor-grab active:cursor-grabbing"
          />

          {/* Hover Region / Statue Tooltip */}
          {hoverInfo && (
            <div className="pointer-events-none absolute top-3 left-3 px-3 py-2 bg-[#26262b]/95 text-[#faf7f0] border border-[#e5be62]/60 text-[11px] max-w-md">
              {hoverInfo.nearStatue ? (
                <>
                  <div className="font-bold text-[#e5be62] uppercase">
                    {completedStatues[hoverInfo.nearStatue.id]
                      ? `★ ${hoverInfo.nearStatue.trueName}`
                      : '❓ UNRECOGNIZED ANCIENT STATUE'}
                  </div>
                  <div className="mt-0.5 text-[10px]">
                    {completedStatues[hoverInfo.nearStatue.id]
                      ? `Ancient Trial Completed (+${hoverInfo.nearStatue.rewardGold} Gold Claimed)`
                      : `Task [E]: ${hoverInfo.nearStatue.taskPrompt} · Reward: +${hoverInfo.nearStatue.rewardGold} Gold`}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: hoverInfo.region.badgeColor }}
                    />
                    <span className="font-bold uppercase">{hoverInfo.region.name}</span>
                    <span className="px-1.5 py-0.5 text-[9px] bg-white/15 font-bold">
                      {hoverInfo.region.tierLabel}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-[#e5be62]">
                    Coords: ({hoverInfo.wx}, {hoverInfo.wy}) · Distance:{' '}
                    {Math.round(Math.hypot(hoverInfo.wx - playerX, hoverInfo.wy - playerY))}m
                  </div>
                </>
              )}
              <div className="mt-0.5 text-[10px] opacity-85">
                {hoverInfo.canTeleport
                  ? '✓ Wayshrine Unlocked — Click to Teleport!'
                  : '🔒 Undiscovered — Walk trail to unlock Teleport (or toggle Scout Mode)'}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="pointer-events-none absolute top-3 right-3 px-2.5 py-1.5 bg-white/94 border border-[#26262b] text-[10px] text-[#26262b] flex items-center gap-3 flex-wrap">
            <span>Zoom: {zoom.toFixed(1)}×</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3.5 h-3.5 rounded-full bg-[#4a3d5c] text-white text-[8px] leading-[14px] text-center font-bold">
                ?
              </span>
              Unknown Statue Task
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#e87c34] border border-[#26262b]" />
              Waystation
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 bg-[#b84239] text-white text-[7px] leading-[10px] text-center font-bold">
                S
              </span>
              Shop
            </span>
          </div>
        </div>

        {/* Bottom Wayshrine Fast-Travel + Scout Toggle Bar */}
        <div className="px-4 py-2.5 bg-[#f1ece0] border-t border-[#26262b] flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-widest font-bold text-[#5a5a60] mr-1">
              WAYSHRINES:
            </span>
            {CONTINENTS.map((cont) => {
              const isUnlocked = scoutUnlockAll || Boolean(discoveredContinents[cont.id])
              const isCurrent = cont.id === activeContinentId
              return (
                <button
                  key={cont.id}
                  type="button"
                  disabled={!isUnlocked}
                  onClick={() => {
                    if (!isUnlocked) return
                    onTeleportContinent(cont.id)
                    onClose()
                  }}
                  className={`px-2.5 py-1 text-[10.5px] uppercase border transition-colors flex items-center gap-1.5 ${
                    !isUnlocked
                      ? 'bg-black/5 border-[#26262b]/25 text-[#777] cursor-not-allowed'
                      : isCurrent
                        ? 'bg-[#26262b] border-[#26262b] text-[#faf7f0] font-bold cursor-pointer'
                        : 'bg-white border-[#26262b]/55 hover:bg-[#26262b] hover:text-white text-[#26262b] cursor-pointer'
                  }`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: cont.badgeColor }}
                  />
                  <span>
                    {isUnlocked ? '✓' : '🔒'} [{cont.keyNum}] {cont.shortName} (T{cont.tier})
                  </span>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={onToggleScoutUnlock}
            className={`px-2.5 py-1 text-[10px] uppercase font-bold border border-[#26262b] cursor-pointer transition-colors ${
              scoutUnlockAll ? 'bg-[#b84239] text-white' : 'bg-white hover:bg-[#e5be62] text-[#26262b]'
            }`}
          >
            {scoutUnlockAll ? 'Scout Teleport: ALL UNLOCKED' : 'Scout Mode: Unlock All Wayshrines'}
          </button>
        </div>
      </div>
    </div>
  )
}
