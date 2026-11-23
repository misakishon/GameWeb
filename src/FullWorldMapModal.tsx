import { useEffect, useRef, useState } from 'react'
import {
  CONNECTOR_STONES,
  CONTINENTS,
  WORLD_LIMIT,
  getContinentLiquidBoundary,
  getNearestContinent,
  type ContinentConfig,
  type ContinentId,
} from './continents'

interface FullWorldMapModalProps {
  paperTone: 'white' | 'studio'
  playerX: number
  playerY: number
  playerHeading: number
  activeContinentId: ContinentId
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
  onTeleportWorld,
  onTeleportContinent,
  onClose,
}: FullWorldMapModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hoverInfo, setHoverInfo] = useState<{
    wx: number
    wy: number
    sx: number
    sy: number
    region: ContinentConfig
  } | null>(null)

  // Map coordinate projection helper (shared between renderer & pointer events!)
  const getProjection = (W: number, H: number) => {
    const pad = 34
    const span = WORLD_LIMIT * 2 + 120 // ~4960 world units
    const scale = Math.min((W - pad * 2) / span, (H - pad * 2) / span)
    const cx = W * 0.5
    const cy = H * 0.5
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

      const white = paperTone === 'white'
      const proj = getProjection(W, H)
      const { toScreenX, toScreenY, scale } = proj

      // 1. Hand-inked Parchment Cartography Backdrop
      ctx.fillStyle = white ? '#f2ece0' : '#9c9f9a'
      ctx.fillRect(0, 0, W, H)

      // Subtle latitude/longitude cartography grid
      ctx.strokeStyle = 'rgba(54, 53, 50, 0.08)'
      ctx.lineWidth = 0.85
      ctx.beginPath()
      for (let g = -2200; g <= 2200; g += 550) {
        const gx = toScreenX(g)
        const gy = toScreenY(g)
        ctx.moveTo(gx, 0)
        ctx.lineTo(gx, H)
        ctx.moveTo(0, gy)
        ctx.lineTo(W, gy)
      }
      ctx.stroke()

      // Outer world boundary border
      const bLeft = toScreenX(-WORLD_LIMIT)
      const bTop = toScreenY(-WORLD_LIMIT)
      const bSize = WORLD_LIMIT * 2 * scale
      ctx.strokeStyle = 'rgba(54, 53, 50, 0.34)'
      ctx.lineWidth = 1.4
      ctx.setLineDash([8, 6])
      ctx.strokeRect(bLeft, bTop, bSize, bSize)
      ctx.setLineDash([])

      // 2. Softly Feathered Continent Territory Washes
      for (const cont of CONTINENTS) {
        const ox = toScreenX(cont.origin.x)
        const oy = toScreenY(cont.origin.y)
        const rad = 790 * scale
        const grad = ctx.createRadialGradient(ox, oy, rad * 0.18, ox, oy, rad)
        const fillHex = white ? cont.paperBase : cont.boardBase
        grad.addColorStop(0, fillHex)
        grad.addColorStop(0.74, fillHex)
        grad.addColorStop(1, 'rgba(242, 236, 224, 0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(ox, oy, rad, 0, Math.PI * 2)
        ctx.fill()

        // Delicate sumi-e contour ring framing each continent territory
        ctx.strokeStyle = `${cont.badgeColor}44`
        ctx.lineWidth = 1.25
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        ctx.arc(ox, oy, rad * 0.86, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }

      // 3. Cardinal Connecting Stone Roads linking Center Kyoto to all 4 outer continents
      ctx.fillStyle = white ? 'rgba(138, 130, 114, 0.56)' : 'rgba(72, 74, 68, 0.56)'
      for (const st of CONNECTOR_STONES) {
        const sx = toScreenX(st.x)
        const sy = toScreenY(st.y)
        ctx.fillRect(sx - 2.2, sy - 2.0, 4.4, 4.0)
      }

      // 4. All 5 Continents: Stones, Liquids, Bridges, Gates, Rocks, Lanterns, Actual Miniature Trees & Shops!
      for (const cont of CONTINENTS) {
        // Stepping stones
        ctx.fillStyle = white ? 'rgba(148, 142, 128, 0.44)' : 'rgba(84, 86, 80, 0.44)'
        for (const st of cont.stones) {
          ctx.fillRect(toScreenX(st.x) - 1.5, toScreenY(st.y) - 1.4, 3.0, 2.8)
        }

        // Liquid body contour
        ctx.beginPath()
        for (let i = 0; i <= 32; i++) {
          const a = (i / 32) * Math.PI * 2
          const pt = getContinentLiquidBoundary(cont, a)
          const px = toScreenX(pt.x)
          const py = toScreenY(pt.y)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        const lcx = toScreenX(cont.liquidCenter.x)
        const lcy = toScreenY(cont.liquidCenter.y)
        const lGrad = ctx.createRadialGradient(lcx, lcy, 3, lcx, lcy, 210 * scale)
        if (cont.liquidKind === 'oasis') {
          lGrad.addColorStop(0, white ? '#3d8e9c' : '#265c66')
          lGrad.addColorStop(1, white ? '#94cfc8' : '#53898c')
        } else if (cont.liquidKind === 'glacial-lake') {
          lGrad.addColorStop(0, white ? '#3b5d76' : '#253c4f')
          lGrad.addColorStop(1, white ? '#a4c4d6' : '#648294')
        } else if (cont.liquidKind === 'emerald-lagoon') {
          lGrad.addColorStop(0, white ? '#2c6452' : '#1d4438')
          lGrad.addColorStop(1, white ? '#7db096' : '#4a735f')
        } else if (cont.liquidKind === 'magma') {
          lGrad.addColorStop(0, '#f0b844')
          lGrad.addColorStop(0.6, '#d45b1c')
          lGrad.addColorStop(1, '#7a2518')
        } else {
          lGrad.addColorStop(0, white ? '#5b7885' : '#324852')
          lGrad.addColorStop(1, white ? '#9bb4bc' : '#58717a')
        }
        ctx.fillStyle = lGrad
        ctx.fill()
        ctx.strokeStyle = '#363532'
        ctx.lineWidth = 1.0
        ctx.stroke()

        // Bridge
        const br = cont.bridge
        const bx0 = toScreenX(br.minX + 4)
        const by0 = toScreenY(br.yCenter - 32)
        const bw = toScreenX(br.maxX - 4) - bx0
        const bh = toScreenY(br.yCenter + 32) - by0
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
        const gx0 = toScreenX(cont.gatePos.x - 88)
        const gx1 = toScreenX(cont.gatePos.x + 88)
        const gy = toScreenY(cont.gatePos.y - 6)
        ctx.fillRect(gx0, gy, gx1 - gx0, 2.8)

        // Rocks
        for (const rk of cont.rocks) {
          ctx.fillStyle =
            rk.kind === 'ice'
              ? '#9ac6d8'
              : rk.kind === 'sandstone'
                ? '#c69e68'
                : rk.kind === 'basalt'
                  ? '#433d3a'
                  : '#6c6a64'
          ctx.beginPath()
          ctx.arc(toScreenX(rk.x), toScreenY(rk.y), 2.5, 0, Math.PI * 2)
          ctx.fill()
        }

        // Actual Miniature Trees (all 8 species rendered clearly on the Full World Map!)
        for (const tr of cont.trees) {
          const tx = toScreenX(tr.x)
          const ty = toScreenY(tr.y)
          ctx.save()
          ctx.translate(tx, ty)
          ctx.fillStyle = 'rgba(32, 36, 30, 0.16)'
          ctx.beginPath()
          ctx.ellipse(1.2, 1.2, 4.4, 2.5, 0, 0, Math.PI * 2)
          ctx.fill()

          if (tr.kind === 'bamboo') {
            for (const [ox, h] of [
              [-2.0, 6.2],
              [0, 7.6],
              [2.0, 5.8],
            ]) {
              ctx.strokeStyle = '#3c4a32'
              ctx.lineWidth = 1.2
              ctx.beginPath()
              ctx.moveTo(ox, 1.0)
              ctx.lineTo(ox * 1.15, -h)
              ctx.stroke()
              ctx.fillStyle = white ? '#8da372' : '#657a55'
              ctx.beginPath()
              ctx.ellipse(ox * 1.15, -h, 2.4, 1.4, 0, 0, Math.PI * 2)
              ctx.fill()
            }
          } else if (tr.kind === 'palm') {
            ctx.strokeStyle = '#6e563b'
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(0, 1.2)
            ctx.quadraticCurveTo(1.2, -3.5, 2.0, -7.2)
            ctx.stroke()
            ctx.strokeStyle = white ? '#628549' : '#466134'
            ctx.lineWidth = 1.1
            for (let f = 0; f < 6; f++) {
              const fa = (f / 6) * Math.PI * 2
              ctx.beginPath()
              ctx.moveTo(2.0, -7.2)
              ctx.quadraticCurveTo(
                2.0 + Math.cos(fa) * 3.0,
                -8.0 + Math.sin(fa) * 1.8,
                2.0 + Math.cos(fa) * 5.0,
                -6.0 + Math.sin(fa) * 2.8
              )
              ctx.stroke()
            }
          } else if (tr.kind === 'cactus') {
            ctx.strokeStyle = white ? '#5f7e4e' : '#445d39'
            ctx.lineCap = 'round'
            ctx.lineWidth = 2.2
            ctx.beginPath()
            ctx.moveTo(0, 1.2)
            ctx.lineTo(0, -7.4)
            ctx.stroke()
            ctx.lineWidth = 1.4
            ctx.beginPath()
            ctx.moveTo(0, -3.0)
            ctx.lineTo(-2.8, -3.0)
            ctx.lineTo(-2.8, -5.6)
            ctx.moveTo(0, -4.2)
            ctx.lineTo(2.6, -4.2)
            ctx.lineTo(2.6, -6.4)
            ctx.stroke()
          } else if (tr.kind === 'pine' || tr.kind === 'snow-pine') {
            const isSnow = tr.kind === 'snow-pine'
            ctx.fillStyle = '#5c4a39'
            ctx.fillRect(-1.1, -3.8, 2.2, 5.0)
            const tiers: [number, number, string][] = isSnow
              ? [
                  [-3.4, 5.0, white ? '#364d52' : '#26383d'],
                  [-5.8, 4.0, white ? '#517178' : '#3a545a'],
                  [-8.0, 2.8, white ? '#eff7fb' : '#cde0ea'],
                ]
              : [
                  [-3.4, 5.0, white ? '#3f5241' : '#2d3b30'],
                  [-5.8, 4.0, white ? '#586e54' : '#40523f'],
                  [-8.0, 2.8, white ? '#758b6c' : '#566952'],
                ]
            for (const [cy, w, col] of tiers) {
              ctx.fillStyle = col
              ctx.beginPath()
              ctx.moveTo(0, cy - 2.4)
              ctx.lineTo(-w, cy + 1.4)
              ctx.lineTo(w, cy + 1.4)
              ctx.closePath()
              ctx.fill()
            }
          } else if (tr.kind === 'charred') {
            ctx.strokeStyle = '#2a2422'
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(0, 1.2)
            ctx.lineTo(0, -5.8)
            ctx.moveTo(0, -3.8)
            ctx.lineTo(-3.2, -7.2)
            ctx.moveTo(0, -4.2)
            ctx.lineTo(3.0, -7.5)
            ctx.stroke()
            ctx.fillStyle = '#a84426'
            ctx.beginPath()
            ctx.arc(-2.8, -7.0, 1.7, 0, Math.PI * 2)
            ctx.arc(2.6, -7.2, 1.6, 0, Math.PI * 2)
            ctx.fill()
          } else {
            const isJungle = tr.kind === 'jungle'
            ctx.fillStyle = '#57483e'
            ctx.fillRect(-1.1, -4.0, 2.2, 5.0)
            const puffs: [number, number, number, string][] = isJungle
              ? [
                  [-2.3, -4.8, 2.7, white ? '#2e583b' : '#20402b'],
                  [2.3, -4.7, 2.7, white ? '#2e583b' : '#20402b'],
                  [0, -6.2, 3.1, white ? '#467c4f' : '#325b3a'],
                ]
              : [
                  [-2.3, -4.8, 2.6, white ? '#6f3e34' : '#52302a'],
                  [2.3, -4.7, 2.6, white ? '#6f3e34' : '#52302a'],
                  [0, -6.2, 3.0, white ? '#964f3e' : '#723e32'],
                ]
            for (const [px, py, pr, col] of puffs) {
              ctx.fillStyle = col
              ctx.beginPath()
              ctx.arc(px, py, pr, 0, Math.PI * 2)
              ctx.fill()
            }
          }
          ctx.restore()
        }

        // Merchant Shop marker ('S')
        const sx = toScreenX(cont.shopPos.x)
        const sy = toScreenY(cont.shopPos.y)
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

        // Continent Title Cartouche Banner
        const labelX = toScreenX(cont.origin.x)
        const labelY = toScreenY(cont.origin.y - 595)
        const isCurrent = cont.id === activeContinentId
        const titleText = `[${cont.keyNum}] ${cont.name.toUpperCase()}`
        ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        const tw = ctx.measureText(titleText).width + 20
        ctx.fillStyle = isCurrent ? '#26262b' : 'rgba(250, 247, 240, 0.94)'
        ctx.strokeStyle = isCurrent ? cont.badgeColor : '#26262b'
        ctx.lineWidth = isCurrent ? 2.0 : 1.15
        ctx.beginPath()
        ctx.roundRect(labelX - tw * 0.5, labelY - 10, tw, 20, 3)
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = cont.badgeColor
        ctx.beginPath()
        ctx.arc(labelX - tw * 0.5 + 8, labelY, 3.2, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = isCurrent ? '#faf7f0' : '#26262b'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(titleText, labelX + 4, labelY + 0.5)
      }

      // 5. Hover Teleport Reticle
      if (hoverInfo) {
        ctx.save()
        ctx.translate(hoverInfo.sx, hoverInfo.sy)
        ctx.strokeStyle = hoverInfo.region.badgeColor
        ctx.lineWidth = 1.4
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.arc(0, 0, 12, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(-16, 0)
        ctx.lineTo(-5, 0)
        ctx.moveTo(5, 0)
        ctx.lineTo(16, 0)
        ctx.moveTo(0, -16)
        ctx.lineTo(0, -5)
        ctx.moveTo(0, 5)
        ctx.lineTo(0, 16)
        ctx.stroke()
        ctx.restore()
      }

      // 6. Live Samurai Player Marker (pulsing crimson halo + directional ink arrow!)
      const px = toScreenX(playerX)
      const py = toScreenY(playerY)
      ctx.strokeStyle = 'rgba(184, 66, 57, 0.55)'
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.arc(px, py, 10, 0, Math.PI * 2)
      ctx.stroke()

      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(playerHeading)
      ctx.fillStyle = '#26262b'
      ctx.beginPath()
      ctx.moveTo(7.5, 0)
      ctx.lineTo(-5.0, -4.8)
      ctx.lineTo(-2.6, 0)
      ctx.lineTo(-5.0, 4.8)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = '#faf7f0'
      ctx.lineWidth = 1.2
      ctx.stroke()
      ctx.restore()

      // 7. Hand-Inked Compass Rose (bottom-left of map)
      const crX = 52
      const crY = H - 52
      ctx.save()
      ctx.translate(crX, crY)
      ctx.fillStyle = 'rgba(250, 247, 240, 0.88)'
      ctx.strokeStyle = '#26262b'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(0, 0, 24, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      // N pointer (crimson)
      ctx.fillStyle = '#b84239'
      ctx.beginPath()
      ctx.moveTo(0, -16)
      ctx.lineTo(-4, 0)
      ctx.lineTo(4, 0)
      ctx.closePath()
      ctx.fill()
      // S pointer (ink)
      ctx.fillStyle = '#26262b'
      ctx.beginPath()
      ctx.moveTo(0, 16)
      ctx.lineTo(-4, 0)
      ctx.lineTo(4, 0)
      ctx.closePath()
      ctx.fill()
      ctx.font = 'bold 8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      ctx.fillStyle = '#26262b'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('N', 0, -29)
      ctx.fillText('S', 0, 30)
      ctx.fillText('W', -31, 0)
      ctx.fillText('E', 31, 0)
      ctx.restore()
    }

    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [paperTone, playerX, playerY, playerHeading, activeContinentId, hoverInfo])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[1120px] h-[88vh] max-h-[820px] bg-[#faf7f0] border-2 border-[#26262b] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="px-4 py-2.5 bg-[#26262b] text-[#faf7f0] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs uppercase tracking-[0.22em] font-bold">
              5-CONTINENT UNIFIED WORLD MAP
            </span>
            <span className="text-[11px] text-[#e5be62]">
              CLICK ANYWHERE TO TELEPORT · OR WALK THE ROADS BETWEEN CONTINENTS
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 text-[11px] uppercase font-bold bg-[#faf7f0] text-[#26262b] hover:bg-[#e5be62] transition-colors cursor-pointer"
          >
            Close [M / Esc]
          </button>
        </div>

        {/* Full Interactive Cartography Canvas */}
        <div className="relative flex-1 min-h-0">
          <canvas
            ref={canvasRef}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const sx = e.clientX - rect.left
              const sy = e.clientY - rect.top
              const proj = getProjection(rect.width, rect.height)
              const wx = Math.round(Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, proj.toWorldX(sx))))
              const wy = Math.round(Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, proj.toWorldY(sy))))
              setHoverInfo({
                wx,
                wy,
                sx,
                sy,
                region: getNearestContinent(wx, wy),
              })
            }}
            onPointerLeave={() => setHoverInfo(null)}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const sx = e.clientX - rect.left
              const sy = e.clientY - rect.top
              const proj = getProjection(rect.width, rect.height)
              const wx = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, proj.toWorldX(sx)))
              const wy = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, proj.toWorldY(sy)))
              const target = getNearestContinent(wx, wy)
              onTeleportWorld(wx, wy, `TELEPORTED · ${target.shortName.toUpperCase()}`, target.badgeColor)
              onClose()
            }}
            className="w-full h-full block cursor-crosshair"
          />

          {/* Live Hover Coordinates & Region Tooltip */}
          {hoverInfo && (
            <div className="pointer-events-none absolute top-3 left-3 px-2.5 py-1.5 bg-[#26262b]/92 text-[#faf7f0] border border-[#e5be62]/60 text-[11px]">
              <span
                className="inline-block w-2 h-2 rounded-full mr-1.5"
                style={{ backgroundColor: hoverInfo.region.badgeColor }}
              />
              <span className="font-bold uppercase">{hoverInfo.region.name}</span>
              <span className="ml-2 text-[#e5be62]">
                ({hoverInfo.wx}, {hoverInfo.wy})
              </span>
              <span className="ml-2 opacity-80">· Click to Teleport</span>
            </div>
          )}

          {/* Map Legend */}
          <div className="pointer-events-none absolute top-3 right-3 px-2.5 py-1.5 bg-white/90 border border-[#26262b] text-[10px] text-[#26262b] flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 bg-[#b84239] text-white text-[7px] leading-[10px] text-center font-bold">
                S
              </span>
              Shop Outpost
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#26262b] border border-[#b84239]" />
              You ({Math.round(playerX)}, {Math.round(playerY)})
            </span>
          </div>
        </div>

        {/* Bottom Fast-Travel Continent Teleport Bar */}
        <div className="px-4 py-2.5 bg-[#f1ece0] border-t border-[#26262b] flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-widest font-bold text-[#5a5a60] mr-1">
              FAST TELEPORT:
            </span>
            {CONTINENTS.map((cont) => {
              const isCurrent = cont.id === activeContinentId
              return (
                <button
                  key={cont.id}
                  type="button"
                  onClick={() => {
                    onTeleportContinent(cont.id)
                    onClose()
                  }}
                  className={`px-2.5 py-1 text-[11px] uppercase border transition-colors cursor-pointer flex items-center gap-1.5 ${
                    isCurrent
                      ? 'bg-[#26262b] border-[#26262b] text-[#faf7f0] font-bold'
                      : 'bg-white border-[#26262b]/50 hover:bg-[#26262b] hover:text-white text-[#26262b]'
                  }`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: cont.badgeColor }}
                  />
                  <span>
                    [{cont.keyNum}] {cont.shortName} ({cont.compassDir})
                  </span>
                </button>
              )
            })}
          </div>
          <span className="text-[10px] text-[#5a5a60]">
            Tip: Walk North, South, East, or West along the stone roads to travel on foot!
          </span>
        </div>
      </div>
    </div>
  )
}
