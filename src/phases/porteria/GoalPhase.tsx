import { useCallback, useEffect, useRef, useState } from 'react'
import { rand, lerp, inRect, formatNum } from '../../core/utils'
import { createNuggetSystem, drawMagnetRing, type NuggetSystem } from '../../core/nuggets'
import { hot, useColdVersion } from '../../core/store'
import { SALA_COST, type StarDef } from '../../core/galaxy'
import { sfx } from '../../core/audio'
import { probeNuggets } from '../../debug/probe'
import { Hud } from '../../ui/Hud'
import { GalaxyShop } from '../../ui/GalaxyShop'
import {
  GALAXY_PORTERIA, SALA2_ID, readLevels,
  oroBase, bonusGlobal, escuadraMult, cooldownMs, zoneScale, magnetR, botFireMs,
  type Levels,
} from './galaxy'

/* ============================================================================
 * DIALES DE BALANCE  ─ tocar aquí para iterar el feel rápido
 * ========================================================================== */

// Apuntado -------------------------------------------------------------------
const SPEED = 1.2          // %/frame  ── dial de dificultad (NO comprable, sube por sala)
const JITTER = 0.25        // ruido añadido al ángulo en cada rebote
const POINTER_R = 14       // radio visual de la mira (px)

// Disparo / vuelo ------------------------------------------------------------
const FLIGHT_MS = 350      // duración del vuelo de la pelota
const ARC_H = 18           // altura del arco de la trayectoria (% del área)
const BALL_R = 16          // radio base de la pelota (px)
const BALL_SCALE_START = 1.35
const BALL_SCALE_END = 0.5
const FOOT_X = 50          // punto de lanzamiento (% ancho) ── "el pie"
const FOOT_Y = 99

// Cooldown / mejoras: selectores y constelación en ./galaxy.ts [GLX.1]

// Nuggets: física y recogida → diales compartidos en core/nuggets.ts (DEFAULT_NUGGET_CFG)

// Delantero bot (tira con su PROPIO balón, independiente del jugador; NO recoge) --
const BOT_X = 10            // posición del bot (% ancho, junto al poste izquierdo)
const BOT_FLIGHT_MS = 420   // vuelo del balón del bot
// Extremos seguros del raso (×1, esquivan al portero) para el tiro del bot
const RASO_SAFE = [{ x: 18, y: 80 }, { x: 82, y: 80 }]

/* ============================================================================
 * ZONAS (rectángulos en % del área) + PORTERO
 * ========================================================================== */

type ZoneKind = 'escuadra' | 'centro' | 'raso'
type Zone = { id: string; kind: ZoneKind; label: string; x: number; y: number; w: number; h: number; prio: number; color: string }

const ZONES: Zone[] = [
  { id: 'esc-l', kind: 'escuadra', label: 'ESCUADRA', x: 4,  y: 6,  w: 16, h: 22, prio: 3, color: '#ffd23f' },
  { id: 'esc-r', kind: 'escuadra', label: 'ESCUADRA', x: 80, y: 6,  w: 16, h: 22, prio: 3, color: '#ffd23f' },
  { id: 'cen',   kind: 'centro',   label: 'CENTRO',   x: 34, y: 6,  w: 32, h: 26, prio: 2, color: '#ff8c42' },
  { id: 'raso',  kind: 'raso',     label: 'RASO',     x: 6,  y: 64, w: 88, h: 30, prio: 1, color: '#4ade80' },
]
const PORTERO = { x: 38, y: 58, w: 24, h: 38, color: '#ef4444' }

// Escala una zona alrededor de su centro (mejora Mira amplia)
const scaleZone = (z: Zone, s: number): Zone => ({
  ...z,
  x: z.x + (z.w * (1 - s)) / 2,
  y: z.y + (z.h * (1 - s)) / 2,
  w: z.w * s,
  h: z.h * s,
})

type Resolution = { kind: 'gol' | 'parada' | 'fuera'; zone: ZoneKind | null; label: string; color: string }

// Resuelve sobre las zonas YA escaladas. PORTERO no escala.
function resolveTarget(tx: number, ty: number, zones: Zone[]): Resolution {
  if (inRect(tx, ty, PORTERO)) return { kind: 'parada', zone: null, label: '¡PARADA!', color: PORTERO.color }
  let best: Zone | null = null
  for (const z of zones) if (inRect(tx, ty, z) && (!best || z.prio > best.prio)) best = z
  if (best) return { kind: 'gol', zone: best.kind, label: best.label, color: best.color }
  return { kind: 'fuera', zone: null, label: '¡FUERA!', color: '#94a3b8' }
}

/* ============================================================================
 * Tipos internos
 * ========================================================================== */

type Vec = { x: number; y: number }
type Flight = { active: boolean; start: number; fromX: number; fromY: number; toX: number; toY: number; trailColor: string }
type Reject = { active: boolean; x: number; y: number; vx: number; vy: number; born: number }
type Floater = { id: number; x: number; y: number; label: string; color: string }
type Ripple = { id: number; x: number; y: number; color: string }

/* ============================================================================
 * Componente
 * ========================================================================== */

export function GoalPhase(props: { onVictory?: () => void; victorySeen?: boolean }) {
  useColdVersion() // re-render frío en compra/desbloqueo/cambio de fase
  const P = hot.phases.porteria

  // --- refs de animación (NUNCA provocan re-render) ---
  const areaRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<HTMLDivElement>(null)
  const ballRef = useRef<HTMLDivElement>(null)
  const ballShadowRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const goldElRef = useRef<HTMLSpanElement>(null)
  const netRef = useRef<HTMLDivElement>(null)
  const porteroFigRef = useRef<HTMLDivElement>(null)
  const footBallRef = useRef<HTMLDivElement>(null)

  const posRef = useRef<Vec>({ x: 50, y: 50 })
  const velRef = useRef<Vec>({ x: 0.8, y: -0.9 })
  const flightRef = useRef<Flight>({ active: false, start: 0, fromX: 0, fromY: 0, toX: 0, toY: 0, trailColor: '#ffffff' })
  const rejectRef = useRef<Reject>({ active: false, x: 0, y: 0, vx: 0, vy: 0, born: 0 })
  const cooldownRef = useRef(false)
  // estelas (solo lectura/escritura desde el rAF; jamás provocan render)
  const ptrTrailRef = useRef<Vec[]>([])
  const ballTrailRef = useRef<Vec[]>([])
  const lastPtrColorRef = useRef('')

  // economía caliente: fuente de verdad en store.hot (mutación directa, sin commit)
  const goldDispRef = useRef(P.gold)    // valor mostrado (lerp → "tick")
  const nugSysRef = useRef<NuggetSystem | null>(null)
  if (!nugSysRef.current) nugSysRef.current = createNuggetSystem()
  probeNuggets.porteria = nugSysRef.current // sonda [BAL.1]: el oro del suelo cuenta como generado
  const mouseRef = useRef({ x: 0, y: 0, inside: false })
  // bot delantero: balón y reloj propios — nunca toca el cooldown del jugador
  const botBallRef = useRef<HTMLDivElement>(null)
  const botFlightRef = useRef({ active: false, start: 0, toX: 0, toY: 0 })
  const botNextShotRef = useRef(0)
  const autoSideRef = useRef(false)
  const cssWRef = useRef(760)
  const cssHRef = useRef(475)

  const levels = readLevels(P.levels)
  const levelsRef = useRef<Levels>(levels)
  levelsRef.current = levels // espejo siempre fresco para el bucle/resolución
  const effZonesRef = useRef<Zone[]>(ZONES)

  const resolveRef = useRef<(tx: number, ty: number, quiet?: boolean) => void>(() => {})

  // --- estado React (baja frecuencia) ---
  const [goldUi, setGoldUi] = useState(P.gold)
  const [goles, setGoles] = useState(P.goles)
  const [fallos, setFallos] = useState(P.fallos)
  const [cooldown, setCooldown] = useState(false)
  const [cdKey, setCdKey] = useState(0)
  const [cdMs, setCdMs] = useState(700)
  const [floaters, setFloaters] = useState<Floater[]>([])
  const [ripples, setRipples] = useState<Ripple[]>([])
  // [GLX.1] tienda-galaxia (mientras está abierta el juego sigue vivo debajo)
  const [shopOpen, setShopOpen] = useState(false)
  const shopOpenRef = useRef(false)
  shopOpenRef.current = shopOpen
  const floaterId = useRef(0)

  const pushRipple = (x: number, y: number, color: string) => {
    const id = floaterId.current++
    setRipples((rs) => [...rs, { id, x, y, color }])
    window.setTimeout(() => setRipples((rs) => rs.filter((r) => r.id !== id)), 600)
  }

  // Normaliza la velocidad inicial a SPEED una sola vez
  useEffect(() => {
    const v = velRef.current
    const m = Math.hypot(v.x, v.y) || 1
    v.x = (v.x / m) * SPEED
    v.y = (v.y / m) * SPEED
  }, [])

  // Al desmontar la fase, los nuggets en pantalla se vuelcan a la cartera (no se pierde oro)
  useEffect(() => () => {
    const v = nugSysRef.current!.drain()
    P.gold += v
    P.total += v
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // --- resolución del tiro: feedback + genera nuggets (NO suma oro directo) ---
  // quiet = tiro del bot: mismo efecto, sonido atenuado
  resolveRef.current = (tx: number, ty: number, quiet = false) => {
    const l = levelsRef.current
    const zones = ZONES.map((z) => scaleZone(z, zoneScale(l)))
    const res = resolveTarget(tx, ty, zones)
    const ball = ballRef.current
    const f = flightRef.current

    if (res.kind === 'gol') {
      P.goles++
      // valor del gol según zona
      const mult = res.zone === 'escuadra' ? escuadraMult(l) : res.zone === 'centro' ? 2 : 1
      const oroGol = Math.max(1, Math.round(oroBase(l) * mult * bonusGlobal(l)))
      spawnNuggets(tx, ty, oroGol)
      // el balón entra: se lo traga la red + ripple + onda de la red
      if (ball) ball.style.opacity = '0'
      if (res.zone === 'escuadra') sfx.escuadra(); else sfx.goal(quiet)
      pushRipple(tx, ty, res.color)
      netRef.current?.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.012) skewX(0.5deg)' }, { transform: 'scale(1)' }],
        { duration: 260, easing: 'ease-out' },
      )
      if (res.zone === 'escuadra') {
        // momento premium: micro zoom-punch del área
        areaRef.current?.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.015)' }, { transform: 'scale(1)' }],
          { duration: 160, easing: 'ease-out' },
        )
      }
    } else {
      P.fallos++
      if (res.kind === 'parada') sfx.parada(); else sfx.fuera()
      if (res.kind === 'parada') {
        // ESTIRADA del portero hacia el punto del tiro (visual; el hitbox no se mueve)
        const cx = PORTERO.x + PORTERO.w / 2
        const cy = PORTERO.y + PORTERO.h / 2
        const dir = tx < cx ? -1 : 1
        const dy = ty < cy ? -16 : 6
        porteroFigRef.current?.animate(
          [
            { transform: 'translate(0,0) rotate(0deg)' },
            { transform: `translate(${dir * 30}px, ${dy}px) rotate(${dir * 16}deg)`, offset: 0.35 },
            { transform: 'translate(0,0) rotate(0deg)' },
          ],
          { duration: 480, easing: 'ease-out' },
        )
        // rechace: el balón sale despedido lejos del portero
        rejectRef.current = {
          active: true, x: tx, y: ty,
          vx: dir * rand(0.9, 1.6), vy: rand(-1.3, -0.7),
          born: performance.now(),
        }
      } else {
        // fuera: el balón sigue su trayectoria y se pierde
        const dx = tx - f.fromX, dy2 = ty - f.fromY
        const m = Math.hypot(dx, dy2) || 1
        rejectRef.current = {
          active: true, x: tx, y: ty,
          vx: (dx / m) * 1.3, vy: (dy2 / m) * 1.3 - 0.3,
          born: performance.now() - 250, // se desvanece antes (fade total 650ms)
        }
      }
      // shake imperativo (NO remonta el área/canvas/mira como haría un key change)
      areaRef.current?.animate(
        [
          { transform: 'translate(0,0)' }, { transform: 'translate(-7px,3px)' },
          { transform: 'translate(6px,-4px)' }, { transform: 'translate(-5px,2px)' },
          { transform: 'translate(4px,-2px)' }, { transform: 'translate(0,0)' },
        ],
        { duration: 320, easing: 'ease' },
      )
    }

    const id = floaterId.current++
    const label = res.kind === 'gol'
      ? `GOL ×${res.zone === 'escuadra' ? escuadraMult(l) : res.zone === 'centro' ? 2 : 1}`
      : res.label
    setFloaters((fs) => [...fs, { id, x: tx, y: ty, label, color: res.color }])
    window.setTimeout(() => setFloaters((fs) => fs.filter((f) => f.id !== id)), 850)
  }

  // Materializa el oro del gol en K nuggets físicos desde el punto de impacto.
  const spawnNuggets = (txPct: number, tyPct: number, oroGol: number) => {
    const cw = cssWRef.current, ch = cssHRef.current
    const absorbed = nugSysRef.current!.spawn((txPct / 100) * cw, (tyPct / 100) * ch, oroGol)
    P.gold += absorbed
    P.total += absorbed
  }

  // --- disparo del jugador (el bot tiene su propio balón y no pasa por aquí) ---
  const shootAt = useCallback((tx: number, ty: number) => {
    if (shopOpenRef.current) return // comprando en la galaxia: el ESPACIO no chuta
    if (cooldownRef.current) return
    // Con Cadencia al suelo (250ms) el CD es MENOR que el vuelo (350ms): un tiro nuevo
    // pisaría al anterior en el aire y este jamás resolvería (ni gol ni fallo). El
    // resultado se decide al disparar, así que el tiro en vuelo aterriza YA.
    const prev = flightRef.current
    if (prev.active) { prev.active = false; resolveRef.current(prev.toX, prev.toY) }
    // la estela toma el color de la zona destino (dorada en escuadra, gris si va fuera/parada)
    const zones = ZONES.map((z) => scaleZone(z, zoneScale(levelsRef.current)))
    const res = resolveTarget(tx, ty, zones)
    const trailColor = res.kind === 'gol' ? res.color : '#94a3b8'
    flightRef.current = { active: true, start: 0, fromX: FOOT_X, fromY: FOOT_Y, toX: tx, toY: ty, trailColor }
    sfx.kick()
    // chut del balón estático del pie
    footBallRef.current?.animate(
      [
        { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
        { transform: 'translateY(-9px) rotate(-30deg)', opacity: 0.4, offset: 0.4 },
        { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
      ],
      { duration: 240, easing: 'ease-out' },
    )
    const cd = cooldownMs(levelsRef.current)
    cooldownRef.current = true
    setCooldown(true)
    setCdMs(cd)
    setCdKey((k) => k + 1)
    window.setTimeout(() => { cooldownRef.current = false; setCooldown(false) }, cd)
  }, [])

  const shoot = useCallback(() => {
    const p = posRef.current
    shootAt(p.x, p.y) // captura la posición de la mira
  }, [shootAt])

  // ESPACIO para disparar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); shoot() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shoot])

  // --- throttle: refresca la UI (HUD/tienda) sin tocar el bucle de 60fps ---
  useEffect(() => {
    const id = window.setInterval(() => {
      setGoldUi(P.gold)
      setGoles(P.goles)
      setFallos(P.fallos)
    }, 120)
    return () => window.clearInterval(id)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // --- BUCLE ÚNICO: mira + vuelo + física de nuggets + bot + auto-tiro ---
  useEffect(() => {
    let raf = 0

    const loop = (time: number) => {
      const area = areaRef.current
      const ptr = pointerRef.current
      const canvas = canvasRef.current
      if (area && ptr && canvas) {
        const aw = area.clientWidth
        const ah = area.clientHeight

        /* ---- mira rebotando (sin cambios respecto al prototipo) ---- */
        const p = posRef.current
        const v = velRef.current
        p.x += v.x; p.y += v.y
        const rx = (POINTER_R / aw) * 100
        const ry = (POINTER_R / ah) * 100
        if (p.x <= rx) { p.x = rx; bounce(v, 'x', +1) }
        else if (p.x >= 100 - rx) { p.x = 100 - rx; bounce(v, 'x', -1) }
        if (p.y <= ry) { p.y = ry; bounce(v, 'y', +1) }
        else if (p.y >= 100 - ry) { p.y = 100 - ry; bounce(v, 'y', -1) }
        ptr.style.transform = `translate(${(p.x / 100) * aw - POINTER_R}px, ${(p.y / 100) * ah - POINTER_R}px)`

        /* ---- estela de la mira (se dibuja en el canvas más abajo) ---- */
        const ptrTrail = ptrTrailRef.current
        ptrTrail.push({ x: p.x, y: p.y })
        if (ptrTrail.length > 14) ptrTrail.shift()

        /* ---- la mira toma el color de lo que tiene debajo (escritura solo al cambiar) ---- */
        {
          const zs = effZonesRef.current
          const under = resolveTarget(p.x, p.y, zs)
          const c = cooldownRef.current ? '#ef4444' : under.kind === 'gol' ? under.color : under.kind === 'parada' ? PORTERO.color : '#ffffff'
          if (c !== lastPtrColorRef.current) {
            lastPtrColorRef.current = c
            ptr.style.borderColor = c
            ptr.style.color = c            // el punto central (::after) usa currentColor
            ptr.style.boxShadow = `0 0 10px ${c}cc, inset 0 0 6px ${c}99`
          }
        }

        /* ---- vuelo de la pelota ---- */
        const f = flightRef.current
        const ball = ballRef.current
        const shadow = ballShadowRef.current
        if (f.active && ball) {
          if (f.start === 0) f.start = time
          const t = Math.min(1, (time - f.start) / FLIGHT_MS)
          const cx = lerp(f.fromX, f.toX, t)
          const cyFlat = lerp(f.fromY, f.toY, t)
          const cy = cyFlat - Math.sin(t * Math.PI) * ARC_H
          const scale = lerp(BALL_SCALE_START, BALL_SCALE_END, t)
          ball.style.transform = `translate(${(cx / 100) * aw - BALL_R}px, ${(cy / 100) * ah - BALL_R}px) scale(${scale}) rotate(${t * 540}deg)`
          ball.style.opacity = '1'
          // sombra de despegue: queda en la trayectoria "plana" y se desvanece con la profundidad
          if (shadow) {
            shadow.style.transform = `translate(${(cx / 100) * aw - 13}px, ${(cyFlat / 100) * ah - 2}px) scale(${1 - t * 0.5})`
            shadow.style.opacity = String(0.5 * (1 - t))
          }
          // estela del color de la zona destino
          const bt = ballTrailRef.current
          bt.push({ x: cx, y: cy })
          if (bt.length > 22) bt.shift()
          if (t >= 1) {
            f.active = false
            if (shadow) shadow.style.opacity = '0'
            resolveRef.current(f.toX, f.toY)
          }
        } else if (ballTrailRef.current.length) {
          ballTrailRef.current.shift()
          ballTrailRef.current.shift()
        }

        /* ---- rechace del balón (parada/fuera): física simple + fade ---- */
        const rj = rejectRef.current
        if (rj.active && ball) {
          rj.vy += 0.085
          rj.x += rj.vx * 0.32
          rj.y += rj.vy * 0.32
          const age = time - rj.born
          ball.style.transform = `translate(${(rj.x / 100) * aw - BALL_R}px, ${(rj.y / 100) * ah - BALL_R}px) scale(0.6) rotate(${age * 0.4}deg)`
          ball.style.opacity = String(Math.max(0, 1 - age / 650))
          if (age > 650 || rj.y > 106) { rj.active = false; ball.style.opacity = '0' }
        }

        /* ---- canvas: tamaño + dpr ---- */
        const dpr = window.devicePixelRatio || 1
        if (canvas.width !== Math.round(aw * dpr) || canvas.height !== Math.round(ah * dpr)) {
          canvas.width = Math.round(aw * dpr); canvas.height = Math.round(ah * dpr)
          canvas.style.width = aw + 'px'; canvas.style.height = ah + 'px'
        }
        cssWRef.current = aw; cssHRef.current = ah
        const ctx = canvas.getContext('2d')!
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, aw, ah)

        /* ---- estelas: mira (fantasmas blancos) y balón (color de la zona destino) ---- */
        for (let i = 0; i < ptrTrail.length - 1; i++) {
          ctx.beginPath()
          ctx.arc((ptrTrail[i].x / 100) * aw, (ptrTrail[i].y / 100) * ah, 1.5 + (i / ptrTrail.length) * 2.5, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,255,255,${(i / ptrTrail.length) * 0.22})`
          ctx.fill()
        }
        const bt = ballTrailRef.current
        for (let i = 0; i < bt.length; i++) {
          ctx.beginPath()
          ctx.arc((bt[i].x / 100) * aw, (bt[i].y / 100) * ah, 2 + (i / bt.length) * 4, 0, Math.PI * 2)
          ctx.globalAlpha = (i / bt.length) * 0.45
          ctx.fillStyle = flightRef.current.trailColor
          ctx.fill()
        }
        ctx.globalAlpha = 1

        const l = levelsRef.current
        const sys = nugSysRef.current!
        const mr = magnetR(l)
        const botActive = l.recolector >= 1
        const m = mouseRef.current

        /* ---- física + recogida de nuggets (el imán del ratón es el ÚNICO recolector) ---- */
        const absorbed = sys.step(aw, ah, m.inside ? { x: m.x, y: m.y, r: mr } : null)
        if (absorbed > 0) { P.gold += absorbed; P.total += absorbed; sfx.coin() }

        /* ---- dibujar nuggets / radio del imán ---- */
        sys.draw(ctx)
        if (m.inside) drawMagnetRing(ctx, m.x, m.y, mr)

        /* ---- delantero bot: balón y reloj PROPIOS, independiente del jugador ---- */
        if (botActive) {
          const bf = botFlightRef.current
          if (!bf.active && time >= botNextShotRef.current) {
            autoSideRef.current = !autoSideRef.current
            const t = RASO_SAFE[autoSideRef.current ? 0 : 1]
            bf.active = true; bf.start = 0; bf.toX = t.x; bf.toY = t.y
            botNextShotRef.current = time + botFireMs(l)
          }
          const botBall = botBallRef.current
          if (bf.active && botBall) {
            if (bf.start === 0) bf.start = time
            const t = Math.min(1, (time - bf.start) / BOT_FLIGHT_MS)
            const cx = lerp(BOT_X, bf.toX, t)
            const cy = lerp(FOOT_Y, bf.toY, t) - Math.sin(t * Math.PI) * 14
            const scale = lerp(1.1, 0.5, t)
            botBall.style.transform = `translate(${(cx / 100) * aw - BALL_R}px, ${(cy / 100) * ah - BALL_R}px) scale(${scale}) rotate(${t * 540}deg)`
            botBall.style.opacity = '1'
            if (t >= 1) {
              bf.active = false
              botBall.style.opacity = '0'
              resolveRef.current(bf.toX, bf.toY, true)  // raso seguro → siempre gol ×1 (sonido atenuado)
            }
          }
        }

        /* ---- tick animado del contador de oro ---- */
        goldDispRef.current += (P.gold - goldDispRef.current) * 0.25
        if (goldElRef.current) goldElRef.current.textContent = formatNum(goldDispRef.current)
      }
      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // --- ratón en coords del área (ref, sin re-render) ---
  const onMouseMove = (e: React.MouseEvent) => {
    const r = areaRef.current!.getBoundingClientRect()
    mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top, inside: true }
  }
  const onMouseLeave = () => { mouseRef.current.inside = false }

  // --- compra en la galaxia: la ⭐ de Sala gana la zona y viaja [GLX.1] ---
  const onStarBought = (star: StarDef) => {
    setGoldUi(P.gold)
    if (star.id === SALA2_ID) {
      sfx.victory()
      setShopOpen(false)
      props.onVictory?.()
    }
  }
  const openShop = () => {
    mouseRef.current.inside = false // el imán no se queda enganchado bajo el overlay
    setShopOpen(true)
  }

  const effZones = ZONES.map((z) => scaleZone(z, zoneScale(levels)))
  effZonesRef.current = effZones // espejo para el bucle (color de la mira) sin alocar por frame

  const salaBought = (P.levels[SALA2_ID] ?? 0) >= 1

  return (
    <div style={styles.page}>
      <style>{css}</style>

      {/* ---- HUD: oro + ahorro hacia la ⭐ + botón de la galaxia ---- */}
      <Hud
        goldElRef={goldElRef}
        metaLabel={salaBought ? '✓ sala 2 desbloqueada' : '⭐ SALA 2 (oro gastable)'}
        totalUi={salaBought ? SALA_COST : goldUi}
        metaGold={SALA_COST}
        onShop={openShop}
        shopColor="#4ade80"
        tally={[
          { label: `${goles} goles`, color: '#4ade80' },
          { label: `${fallos} fallos`, color: '#ef4444' },
        ]}
      />

      <div style={styles.stage}>
        {/* ---- CAMPO ---- */}
        <div
          ref={areaRef}
          className="goal-area"
          onClick={shoot}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          style={styles.area}
        >
          {/* red con profundidad (ondula al marcar) */}
          <div ref={netRef} className="net" />

          {/* césped con bandas de corte + línea de gol */}
          <div className="grass" />

          {/* postes + travesaño */}
          <div className="post post-l" />
          <div className="post post-r" />
          <div className="post crossbar" />

          {/* zonas (escaladas por Mira amplia; brackets de esquina, glow en escuadra) */}
          {effZones.map((z) => (
            <div
              key={z.id}
              className={z.kind === 'escuadra' ? 'zone zone-glow' : 'zone'}
              style={{
                left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`,
                backgroundColor: `${z.color}0d`,
                '--zc': z.color,
              } as React.CSSProperties}
            >
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: z.color, marginTop: 3, textShadow: '0 1px 2px #000' }}>
                {z.label} ×{z.kind === 'escuadra' ? escuadraMult(levels) : z.kind === 'centro' ? 2 : 1}
              </span>
            </div>
          ))}

          {/* portero: el contenedor es el hitbox ESTÁTICO; la figura interior se mueve (sway/estirada) */}
          <div style={{ position: 'absolute', left: `${PORTERO.x}%`, top: `${PORTERO.y}%`, width: `${PORTERO.w}%`, height: `${PORTERO.h}%`, pointerEvents: 'none' }}>
            <div ref={porteroFigRef} style={{ position: 'absolute', inset: 0 }}>
              <div className="goalie">
                <div className="goalie-head" />
                <div className="goalie-glove gl" />
                <div className="goalie-glove gr" />
                <div className="goalie-body">
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', letterSpacing: 1 }}>PORTERO</span>
                </div>
                <div className="goalie-leg ll" />
                <div className="goalie-leg lr" />
              </div>
            </div>
          </div>

          {/* viñeta + focos de estadio */}
          <div className="vignette" />

          {/* canvas de nuggets y estelas (encima de zonas, debajo de pelota/mira) */}
          <canvas ref={canvasRef} className="nug-canvas" />

          {/* balón estático en el pie (chuta con element.animate) */}
          <div ref={footBallRef} className="ball foot-ball" />

          {/* delantero bot: avatar + su propio balón */}
          {levels.recolector >= 1 && (
            <>
              <div className="bot-avatar" style={{ left: `${BOT_X}%` }}>🤖</div>
              <div ref={botBallRef} className="ball" style={{ width: BALL_R * 2, height: BALL_R * 2, opacity: 0 }} />
            </>
          )}

          {/* sombra de despegue del balón */}
          <div ref={ballShadowRef} className="ball-shadow" />

          {/* pelota en vuelo */}
          <div ref={ballRef} className="ball" style={{ width: BALL_R * 2, height: BALL_R * 2, opacity: 0 }} />

          {/* mira */}
          <div ref={pointerRef} className={cooldown ? 'pointer cd' : 'pointer'} style={{ width: POINTER_R * 2, height: POINTER_R * 2 }}>
            {cooldown && (
              <svg className="cd-ring" viewBox="0 0 36 36" key={cdKey}>
                <circle cx="18" cy="18" r="16" style={{ animationDuration: `${cdMs}ms` }} />
              </svg>
            )}
          </div>

          {/* ripples de impacto en la red */}
          {ripples.map((rp) => (
            <div key={rp.id} className="ripple" style={{ left: `${rp.x}%`, top: `${rp.y}%`, color: rp.color }} />
          ))}

          {/* textos flotantes */}
          {floaters.map((fl) => (
            <div key={fl.id} className="floater" style={{ left: `${fl.x}%`, top: `${fl.y}%`, color: fl.color }}>{fl.label}</div>
          ))}
        </div>
      </div>

      {/* ---- TIENDA-GALAXIA (overlay; el campo sigue vivo debajo) ---- */}
      <GalaxyShop
        def={GALAXY_PORTERIA}
        phase="porteria"
        gold={goldUi}
        open={shopOpen}
        onClose={() => setShopOpen(false)}
        onBought={onStarBought}
      />

      <p style={styles.hint}>
        Clic / <kbd style={styles.kbd}>ESPACIO</kbd> para chutar · barre los <b style={{ color: '#fbbf24' }}>nuggets</b> con el ratón ·
        compra mejoras en la <b style={{ color: '#4ade80' }}>🌌 galaxia</b> · la ⭐ de 1M gana la zona
      </p>
    </div>
  )
}

/* Rebote: invierte componente, jitter al ángulo, renormaliza a SPEED, fuerza signo. */
function bounce(v: Vec, axis: 'x' | 'y', sign: number) {
  if (axis === 'x') v.x = -v.x; else v.y = -v.y
  v.x += rand(-JITTER, JITTER); v.y += rand(-JITTER, JITTER)
  const m = Math.hypot(v.x, v.y) || 1
  v.x = (v.x / m) * SPEED; v.y = (v.y / m) * SPEED
  if (axis === 'x') v.x = Math.abs(v.x) * sign; else v.y = Math.abs(v.y) * sign
}

/* ============================================================================
 * Estilos
 * ========================================================================== */

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
    background: 'radial-gradient(circle at 50% 0%, #1e3a2f 0%, #0b1411 70%)',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#e2e8f0', userSelect: 'none', padding: 16,
  },
  stage: { display: 'flex', gap: 16, alignItems: 'flex-start', width: 'min(94vw, 1080px)', justifyContent: 'center', flexWrap: 'wrap' },
  area: {
    position: 'relative', width: 'min(90vw, 760px)', aspectRatio: '16 / 10', flexShrink: 0,
    background: 'linear-gradient(180deg,#0f2018,#0a1510)', border: '4px solid #cbd5e1', borderRadius: 6,
    boxShadow: '0 10px 40px #000a, inset 0 0 60px #0006', cursor: 'crosshair', overflow: 'hidden',
  },
  hint: { fontSize: 13, color: '#64748b', margin: 0, textAlign: 'center' },
  kbd: { background: '#1e293b', border: '1px solid #475569', borderRadius: 4, padding: '1px 6px', fontSize: 12, color: '#cbd5e1' },
}

const css = `
.net {
  position:absolute; inset:0 0 7% 0; pointer-events:none; opacity:.3; will-change:transform;
  background-image: linear-gradient(#ffffff22 1px, transparent 1px), linear-gradient(90deg, #ffffff22 1px, transparent 1px);
  background-size: 22px 22px;
  mask-image: radial-gradient(ellipse at 50% 45%, #fff6 0%, #fff 75%);
  -webkit-mask-image: radial-gradient(ellipse at 50% 45%, #fff6 0%, #fff 75%);
}
.grass {
  position:absolute; left:0; right:0; bottom:0; height:7%; pointer-events:none;
  background: repeating-linear-gradient(90deg, #15803d 0 48px, #166534 48px 96px);
  border-top: 3px solid #f8fafccc;
  box-shadow: 0 -6px 14px #0007;
}
.post { position:absolute; pointer-events:none; z-index:2; background: linear-gradient(90deg,#f8fafc,#cbd5e1 60%,#94a3b8); box-shadow: 0 0 10px #0009, inset 0 0 3px #fff; }
.post-l { left:0; top:0; bottom:7%; width:9px; border-radius:0 4px 4px 0; }
.post-r { right:0; top:0; bottom:7%; width:9px; border-radius:4px 0 0 4px; background: linear-gradient(270deg,#f8fafc,#cbd5e1 60%,#94a3b8); }
.crossbar { left:0; right:0; top:0; height:9px; border-radius:0 0 4px 4px; background: linear-gradient(180deg,#f8fafc,#cbd5e1 60%,#94a3b8); }
.vignette {
  position:absolute; inset:0; pointer-events:none;
  background:
    radial-gradient(ellipse at 50% 40%, transparent 52%, #00000052 100%),
    radial-gradient(ellipse 38% 22% at 8% 0%, #ffffff0d, transparent 60%),
    radial-gradient(ellipse 38% 22% at 92% 0%, #ffffff0d, transparent 60%);
}
.zone {
  position:absolute; pointer-events:none; border-radius:6px;
  display:flex; align-items:flex-start; justify-content:center;
  background-image:
    linear-gradient(var(--zc),var(--zc)), linear-gradient(var(--zc),var(--zc)),
    linear-gradient(var(--zc),var(--zc)), linear-gradient(var(--zc),var(--zc)),
    linear-gradient(var(--zc),var(--zc)), linear-gradient(var(--zc),var(--zc)),
    linear-gradient(var(--zc),var(--zc)), linear-gradient(var(--zc),var(--zc));
  background-repeat: no-repeat;
  background-size: 14px 2px, 2px 14px, 14px 2px, 2px 14px, 14px 2px, 2px 14px, 14px 2px, 2px 14px;
  background-position: top left, top left, top right, top right, bottom left, bottom left, bottom right, bottom right;
  transition: left .25s ease, top .25s ease, width .25s ease, height .25s ease;
}
.zone-glow::after {
  content:''; position:absolute; inset:0; border-radius:6px; pointer-events:none;
  box-shadow: 0 0 16px var(--zc), inset 0 0 16px var(--zc);
  opacity:.14; animation: zpulse 2.4s ease-in-out infinite;
}
@keyframes zpulse { 50% { opacity:.38; } }
.goalie { position:absolute; inset:0; animation: goalie-sway 2.4s ease-in-out infinite alternate; transform-origin: bottom center; }
@keyframes goalie-sway { from { transform: translateX(-5%) rotate(-1.4deg); } to { transform: translateX(5%) rotate(1.4deg); } }
.goalie-head {
  position:absolute; left:50%; top:0; transform:translateX(-50%); width:27%; aspect-ratio:1; border-radius:50%;
  background: radial-gradient(circle at 38% 35%, #f5c89e, #d99c66 75%, #b97f43); border:2px solid #7f1d1d; z-index:1;
}
.goalie-body {
  position:absolute; left:16%; right:16%; top:24%; bottom:22%;
  background: linear-gradient(180deg,#dc2626,#7f1d1d); border:2px solid #fca5a5; border-radius:10px 10px 6px 6px;
  display:flex; align-items:center; justify-content:center; box-shadow:0 0 14px #ef444466;
}
.goalie-glove { position:absolute; top:26%; width:19%; aspect-ratio:1; border-radius:50%; background: radial-gradient(circle at 35% 35%, #fde68a, #f59e0b 80%); border:2px solid #92400e; z-index:2; }
.goalie-glove.gl { left:-3%; }
.goalie-glove.gr { right:-3%; }
.goalie-leg { position:absolute; bottom:0; width:14%; height:24%; background: linear-gradient(180deg,#1e293b,#0f172a); border-radius:0 0 5px 5px; }
.goalie-leg.ll { left:28%; }
.goalie-leg.lr { right:28%; }
.nug-canvas { position:absolute; inset:0; pointer-events:none; }
.ball-shadow {
  position:absolute; top:0; left:0; width:26px; height:9px; border-radius:50%;
  background: radial-gradient(ellipse, #000d, transparent 72%);
  will-change:transform,opacity; opacity:0; pointer-events:none;
}
.ball.foot-ball {
  left:50%; bottom:1.4%; width:20px; height:20px; margin-left:-10px; top:auto;
  opacity:1; box-shadow:0 0 12px #ffffff55, 0 2px 6px #0009;
}
.bot-avatar {
  position:absolute; bottom:1%; transform:translateX(-50%); font-size:26px; pointer-events:none; z-index:6;
  filter: drop-shadow(0 4px 6px #000a);
  animation: bot-bob 1.6s ease-in-out infinite;
}
@keyframes bot-bob { 0%,100% { transform:translateX(-50%) translateY(0); } 50% { transform:translateX(-50%) translateY(-4px); } }
.ripple {
  position:absolute; width:72px; height:72px; margin:-36px 0 0 -36px; border-radius:50%;
  border:2.5px solid currentColor; box-shadow:0 0 12px currentColor; pointer-events:none; z-index:9;
  animation: ripple .55s ease-out forwards;
}
@keyframes ripple { from { transform: scale(.15); opacity:.95; } to { transform: scale(1.5); opacity:0; } }
.pointer {
  position:absolute; top:0; left:0; will-change:transform; border-radius:50%; border:2px solid #fff;
  background: radial-gradient(circle at 35% 35%, #fff 0%, #fff 18%, transparent 22%), radial-gradient(circle, #ffffff10 40%, transparent 60%);
  box-shadow:0 0 10px #fff8, inset 0 0 6px #fff6; pointer-events:none; display:flex; align-items:center; justify-content:center;
}
.pointer::after { content:''; position:absolute; width:3px; height:3px; border-radius:50%; background:#fff; }
.pointer.cd { border-color:#ef4444; opacity:.5; box-shadow:0 0 8px #ef444488; }
.cd-ring { position:absolute; width:140%; height:140%; transform:rotate(-90deg); }
.cd-ring circle { fill:none; stroke:#ef4444; stroke-width:3; stroke-linecap:round; stroke-dasharray:100.5; stroke-dashoffset:0; animation: cd-deplete linear forwards; }
@keyframes cd-deplete { from { stroke-dashoffset:0; } to { stroke-dashoffset:100.5; } }
.ball {
  position:absolute; top:0; left:0; will-change:transform,opacity; border-radius:50%;
  background:
    radial-gradient(circle at 50% 28%, #1e293b 0 11%, transparent 12%),
    radial-gradient(circle at 25% 56%, #1e293b 0 9%, transparent 10%),
    radial-gradient(circle at 75% 56%, #1e293b 0 9%, transparent 10%),
    radial-gradient(circle at 50% 84%, #1e293b 0 8%, transparent 9%),
    radial-gradient(circle at 32% 30%, #ffffff 0%, #e8e8e8 45%, #b8b8b8 80%, #888 100%);
  border:1.5px solid #fff; box-shadow:0 0 16px #fff6, 0 4px 10px #0008; pointer-events:none;
}
.floater {
  position:absolute; transform:translate(-50%,-50%); font-size:20px; font-weight:900; letter-spacing:1px; pointer-events:none;
  text-shadow:0 2px 6px #000, 0 0 12px currentColor; animation: float-up 0.85s ease-out forwards; white-space:nowrap; z-index:10;
}
@keyframes float-up {
  0% { opacity:0; transform:translate(-50%,-50%) scale(.6); }
  20% { opacity:1; transform:translate(-50%,-90%) scale(1.1); }
  100% { opacity:0; transform:translate(-50%,-220%) scale(1); }
}
`
