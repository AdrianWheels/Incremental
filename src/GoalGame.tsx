import { useCallback, useEffect, useRef, useState } from 'react'

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

// Cooldown (base; lo recorta la mejora Cadencia) -----------------------------
const COOLDOWN_MS = 700
const COOLDOWN_FLOOR = 250  // suelo duro del CD

// Economía / meta ------------------------------------------------------------
const META_GOLD = 100_000   // oro acumulado para "batir al portero"

// Nuggets: física -----------------------------------------------------------
const NUGGET_R = 7
const GRAVITY = 0.42
const FLOOR_DAMP = 0.5      // amortiguación al rebotar
const H_FRICTION = 0.82     // fricción horizontal al tocar suelo
const SETTLE_V = 0.7        // por debajo de esto, se asienta
const MAX_NUGGETS = 150     // cap en pantalla (auto-absorbe los más antiguos)
const K_MIN = 3, K_MAX = 8  // nuggets por gol

// Nuggets: recogida (imán) --------------------------------------------------
const MAGNET_BASE = 34      // radio de imán del ratón (px) ── pequeño al inicio
const MAGNET_STEP = 20      // +radio por nivel de Imán
const PULL_ACCEL = 1.8      // aceleración hacia el atractor (zip al cursor)
const MAX_PULL = 24         // velocidad máx mientras es atraído
const ABSORB_DIST = 12      // distancia a la que se absorbe

// Recolector (bot idle combinado: auto-dispara + recoge) --------------------
const BOT_R_BASE = 42       // radio de aspiración del bot (px)
const BOT_R_STEP = 14
const BOT_SPEED = 3.2       // velocidad máx de desplazamiento del bot
const BOT_ACCEL = 0.45
const AUTO_IDLE_DELAY = 1400 // ms sin tiro manual antes de que el bot dispare
// Extremos seguros del raso (×1, esquivan al portero) para el auto-tiro
const RASO_SAFE = [{ x: 18, y: 80 }, { x: 82, y: 80 }]

/* ============================================================================
 * MEJORAS  (todas las constantes de balance aquí)
 * ========================================================================== */

type UpgKey = 'potencia' | 'rosca' | 'botas' | 'cadencia' | 'mira' | 'iman' | 'recolector'
type Levels = Record<UpgKey, number>

const UPG: Record<UpgKey, { name: string; base: number; growth: number; color: string }> = {
  potencia:   { name: 'Potencia',     base: 10,  growth: 1.12, color: '#60a5fa' },
  rosca:      { name: 'Rosca',        base: 60,  growth: 1.18, color: '#ffd23f' },
  botas:      { name: 'Botas de oro', base: 200, growth: 1.23, color: '#fbbf24' },
  cadencia:   { name: 'Cadencia',     base: 40,  growth: 1.14, color: '#34d399' },
  mira:       { name: 'Mira amplia',  base: 80,  growth: 1.17, color: '#a78bfa' },
  iman:       { name: 'Imán',         base: 30,  growth: 1.10, color: '#f472b6' },
  recolector: { name: 'Recolector',   base: 500, growth: 1.20, color: '#f87171' },
}
const UPG_ORDER: UpgKey[] = ['potencia', 'rosca', 'botas', 'cadencia', 'mira', 'iman', 'recolector']

const cost = (key: UpgKey, lv: number) => Math.floor(UPG[key].base * UPG[key].growth ** lv)

// --- selectores derivados (funciones puras de los niveles) ---
const oroBase = (l: Levels) => 1 + l.potencia
const bonusGlobal = (l: Levels) => 1 + l.botas * 0.25
const escuadraMult = (l: Levels) => 4 + l.rosca * 2
const cooldownMs = (l: Levels) => Math.max(COOLDOWN_FLOOR, Math.round(COOLDOWN_MS * 0.92 ** l.cadencia))
const miraPct = (l: Levels) => Math.min(60, l.mira * 6)         // cap +60%
const zoneScale = (l: Levels) => 1 + miraPct(l) / 100
const magnetR = (l: Levels) => MAGNET_BASE + l.iman * MAGNET_STEP
const botR = (l: Levels) => BOT_R_BASE + Math.max(0, l.recolector - 1) * BOT_R_STEP

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

/* ============================================================================
 * Helpers
 * ========================================================================== */

const rand = (min: number, max: number) => Math.random() * (max - min) + min
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const inRect = (px: number, py: number, r: { x: number; y: number; w: number; h: number }) =>
  px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h

function formatNum(n: number): string {
  if (n < 1000) return Math.floor(n).toString()
  const u = ['', 'K', 'M', 'B', 'T']
  let i = 0
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++ }
  return n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0) + u[i]
}

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
type Flight = { active: boolean; start: number; fromX: number; fromY: number; toX: number; toY: number }
type Floater = { id: number; x: number; y: number; label: string; color: string }
type Nugget = { x: number; y: number; vx: number; vy: number; value: number; rot: number; rotV: number; collecting: boolean; flash: number }
type Bot = { x: number; y: number; vx: number; vy: number; wx: number; wy: number }

/* ============================================================================
 * Componente
 * ========================================================================== */

export function GoalGame() {
  // --- refs de animación (NUNCA provocan re-render) ---
  const areaRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<HTMLDivElement>(null)
  const ballRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const goldElRef = useRef<HTMLSpanElement>(null)

  const posRef = useRef<Vec>({ x: 50, y: 50 })
  const velRef = useRef<Vec>({ x: 0.8, y: -0.9 })
  const flightRef = useRef<Flight>({ active: false, start: 0, fromX: 0, fromY: 0, toX: 0, toY: 0 })
  const cooldownRef = useRef(false)

  // economía (fuente de verdad en refs; React solo lee de forma throttle)
  const goldRef = useRef(0)        // oro gastable
  const totalRef = useRef(0)       // oro acumulado (para la meta; no baja al gastar)
  const goldDispRef = useRef(0)    // valor mostrado (lerp → "tick")
  const nuggetsRef = useRef<Nugget[]>([])
  const mouseRef = useRef({ x: 0, y: 0, inside: false })
  const botRef = useRef<Bot>({ x: 200, y: 300, vx: 0, vy: 0, wx: 200, wy: 300 })
  const lastManualShotRef = useRef(0)
  const autoSideRef = useRef(false)
  const cssWRef = useRef(760)
  const cssHRef = useRef(475)

  const levelsRef = useRef<Levels>({ potencia: 0, rosca: 0, botas: 0, cadencia: 0, mira: 0, iman: 0, recolector: 0 })
  const resolveRef = useRef<(tx: number, ty: number) => void>(() => {})
  const shootAtRef = useRef<(tx: number, ty: number, manual: boolean) => void>(() => {})

  // --- estado React (baja frecuencia) ---
  const [levels, setLevels] = useState<Levels>({ potencia: 0, rosca: 0, botas: 0, cadencia: 0, mira: 0, iman: 0, recolector: 0 })
  const [goldUi, setGoldUi] = useState(0)
  const [totalUi, setTotalUi] = useState(0)
  const [goles, setGoles] = useState(0)
  const [fallos, setFallos] = useState(0)
  const [cooldown, setCooldown] = useState(false)
  const [cdKey, setCdKey] = useState(0)
  const [cdMs, setCdMs] = useState(COOLDOWN_MS)
  const [floaters, setFloaters] = useState<Floater[]>([])
  const [victory, setVictory] = useState(false)
  const floaterId = useRef(0)

  levelsRef.current = levels // espejo siempre fresco para el bucle/resolución

  // Normaliza la velocidad inicial a SPEED una sola vez
  useEffect(() => {
    const v = velRef.current
    const m = Math.hypot(v.x, v.y) || 1
    v.x = (v.x / m) * SPEED
    v.y = (v.y / m) * SPEED
  }, [])

  // --- resolución del tiro: feedback + genera nuggets (NO suma oro directo) ---
  resolveRef.current = (tx: number, ty: number) => {
    const l = levelsRef.current
    const zones = ZONES.map((z) => scaleZone(z, zoneScale(l)))
    const res = resolveTarget(tx, ty, zones)

    if (res.kind === 'gol') {
      setGoles((g) => g + 1)
      // valor del gol según zona
      const mult = res.zone === 'escuadra' ? escuadraMult(l) : res.zone === 'centro' ? 2 : 1
      const oroGol = Math.max(1, Math.round(oroBase(l) * mult * bonusGlobal(l)))
      spawnNuggets(tx, ty, oroGol)
    } else {
      setFallos((f) => f + 1)
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
    const ix = (txPct / 100) * cw
    const iy = (tyPct / 100) * ch
    let K = clamp(3 + Math.floor(oroGol / 4), K_MIN, K_MAX)
    K = Math.max(1, Math.min(K, oroGol))            // cada nugget vale ≥1
    const base = Math.floor(oroGol / K)
    const ng = nuggetsRef.current
    for (let i = 0; i < K; i++) {
      const value = i === K - 1 ? oroGol - base * (K - 1) : base // resto al último → suma exacta
      ng.push({
        x: ix + rand(-6, 6),
        y: iy + rand(-6, 6),
        vx: rand(-3.5, 3.5),
        vy: rand(-9, -4),                            // sale hacia arriba
        value,
        rot: rand(0, Math.PI * 2),
        rotV: rand(-0.25, 0.25),
        collecting: false,
        flash: 0,
      })
    }
    // cap: auto-absorbe los más antiguos (su valor NO se pierde)
    while (ng.length > MAX_NUGGETS) {
      const old = ng.shift()!
      goldRef.current += old.value
      totalRef.current += old.value
    }
  }

  // --- disparar a un objetivo concreto (manual = mira; auto = raso seguro) ---
  const shootAt = useCallback((tx: number, ty: number, manual: boolean) => {
    if (cooldownRef.current) return
    flightRef.current = { active: true, start: 0, fromX: FOOT_X, fromY: FOOT_Y, toX: tx, toY: ty }
    const cd = cooldownMs(levelsRef.current)
    cooldownRef.current = true
    setCooldown(true)
    setCdMs(cd)
    setCdKey((k) => k + 1)
    window.setTimeout(() => { cooldownRef.current = false; setCooldown(false) }, cd)
    if (manual) lastManualShotRef.current = performance.now()
  }, [])
  shootAtRef.current = shootAt

  const shoot = useCallback(() => {
    const p = posRef.current
    shootAt(p.x, p.y, true) // captura la posición de la mira
  }, [shootAt])

  // ESPACIO para disparar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); shoot() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shoot])

  // --- throttle: refresca la UI (panel/meta) sin tocar el bucle de 60fps ---
  useEffect(() => {
    const id = window.setInterval(() => {
      setGoldUi(goldRef.current)
      setTotalUi(totalRef.current)
      if (totalRef.current >= META_GOLD) setVictory(true)
    }, 120)
    return () => window.clearInterval(id)
  }, [])

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

        /* ---- vuelo de la pelota ---- */
        const f = flightRef.current
        const ball = ballRef.current
        if (f.active && ball) {
          if (f.start === 0) f.start = time
          const t = Math.min(1, (time - f.start) / FLIGHT_MS)
          const cx = lerp(f.fromX, f.toX, t)
          const cy = lerp(f.fromY, f.toY, t) - Math.sin(t * Math.PI) * ARC_H
          const scale = lerp(BALL_SCALE_START, BALL_SCALE_END, t)
          ball.style.transform = `translate(${(cx / 100) * aw - BALL_R}px, ${(cy / 100) * ah - BALL_R}px) scale(${scale})`
          ball.style.opacity = '1'
          if (t >= 1) { f.active = false; ball.style.opacity = '0'; resolveRef.current(f.toX, f.toY) }
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

        const l = levelsRef.current
        const ng = nuggetsRef.current
        const mr = magnetR(l)
        const keepR = mr * 1.4
        const botActive = l.recolector >= 1
        const bR = botR(l)
        const m = mouseRef.current

        /* ---- bot recolector: persigue el nugget más cercano / deambula ---- */
        if (botActive) {
          const b = botRef.current
          let best: Nugget | null = null, bd = Infinity
          for (const n of ng) { const d = Math.hypot(n.x - b.x, n.y - b.y); if (d < bd) { bd = d; best = n } }
          let tx: number, ty: number
          if (best) { tx = best.x; ty = best.y }
          else {
            if (Math.hypot(b.x - b.wx, b.y - b.wy) < 24) { b.wx = rand(aw * 0.15, aw * 0.85); b.wy = rand(ah * 0.55, ah * 0.92) }
            tx = b.wx; ty = b.wy
          }
          const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1
          b.vx += (dx / d) * BOT_ACCEL; b.vy += (dy / d) * BOT_ACCEL
          const sp = Math.hypot(b.vx, b.vy)
          if (sp > BOT_SPEED) { b.vx = (b.vx / sp) * BOT_SPEED; b.vy = (b.vy / sp) * BOT_SPEED }
          b.x = clamp(b.x + b.vx, bR, aw - bR); b.y = clamp(b.y + b.vy, bR, ah - bR)
        }

        /* ---- física + recogida de nuggets ---- */
        const survivors: Nugget[] = []
        for (const n of ng) {
          // elegir atractor: ratón (imán) tiene prioridad, si no el bot
          let ax: number | null = null, ay = 0
          if (m.inside) {
            const d = Math.hypot(n.x - m.x, n.y - m.y)
            if (d < (n.collecting ? keepR : mr)) { ax = m.x; ay = m.y }
          }
          if (ax === null && botActive) {
            const b = botRef.current
            const d = Math.hypot(n.x - b.x, n.y - b.y)
            if (d < (n.collecting ? bR * 1.4 : bR)) { ax = b.x; ay = b.y }
          }

          if (ax !== null) {
            n.collecting = true
            const dx = ax - n.x, dy = ay - n.y, d = Math.hypot(dx, dy) || 1
            n.vx += (dx / d) * PULL_ACCEL; n.vy += (dy / d) * PULL_ACCEL
            const sp = Math.hypot(n.vx, n.vy)
            if (sp > MAX_PULL) { n.vx = (n.vx / sp) * MAX_PULL; n.vy = (n.vy / sp) * MAX_PULL }
            n.x += n.vx; n.y += n.vy
            if (d < ABSORB_DIST) {                    // absorbido → suma oro
              goldRef.current += n.value
              totalRef.current += n.value
              continue
            }
          } else {
            n.collecting = false
            n.vy += GRAVITY
            n.x += n.vx; n.y += n.vy
            if (n.x < NUGGET_R) { n.x = NUGGET_R; n.vx = -n.vx * FLOOR_DAMP }
            else if (n.x > aw - NUGGET_R) { n.x = aw - NUGGET_R; n.vx = -n.vx * FLOOR_DAMP }
            const floorY = ah - NUGGET_R
            if (n.y > floorY) {
              n.y = floorY; n.vy = -n.vy * FLOOR_DAMP; n.vx *= H_FRICTION
              if (Math.abs(n.vy) < SETTLE_V) n.vy = 0
            } else if (n.y < NUGGET_R) { n.y = NUGGET_R; n.vy = -n.vy * FLOOR_DAMP }
            n.rot += n.rotV
          }
          survivors.push(n)
        }
        nuggetsRef.current = survivors

        /* ---- dibujar nuggets ---- */
        for (const n of survivors) drawNugget(ctx, n)

        /* ---- dibujar bot + su radio ---- */
        if (botActive) drawBot(ctx, botRef.current, bR, time)

        /* ---- dibujar radio del imán bajo el ratón ---- */
        if (m.inside) {
          ctx.beginPath()
          ctx.arc(m.x, m.y, mr, 0, Math.PI * 2)
          ctx.strokeStyle = '#f472b655'
          ctx.lineWidth = 1.5
          ctx.setLineDash([4, 4])
          ctx.stroke()
          ctx.setLineDash([])
        }

        /* ---- auto-tiro idle del recolector (raso seguro alterno) ---- */
        if (botActive && !cooldownRef.current && time - lastManualShotRef.current > AUTO_IDLE_DELAY) {
          autoSideRef.current = !autoSideRef.current
          const t = RASO_SAFE[autoSideRef.current ? 0 : 1]
          shootAtRef.current(t.x, t.y, false)
        }

        /* ---- tick animado del contador de oro ---- */
        goldDispRef.current += (goldRef.current - goldDispRef.current) * 0.25
        if (goldElRef.current) goldElRef.current.textContent = formatNum(goldDispRef.current)
      }
      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // --- ratón en coords del área (ref, sin re-render) ---
  const onMouseMove = (e: React.MouseEvent) => {
    const r = areaRef.current!.getBoundingClientRect()
    mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top, inside: true }
  }
  const onMouseLeave = () => { mouseRef.current.inside = false }

  // --- comprar mejora (lee de levelsRef → robusto ante clics síncronos rápidos) ---
  const buy = (key: UpgKey) => {
    const lv = levelsRef.current[key]
    const c = cost(key, lv)
    if (goldRef.current < c) return
    goldRef.current -= c
    const next = { ...levelsRef.current, [key]: lv + 1 }
    levelsRef.current = next
    setLevels(next)
    setGoldUi(goldRef.current)
  }

  const effZones = ZONES.map((z) => scaleZone(z, zoneScale(levels)))
  const progress = Math.min(100, (totalUi / META_GOLD) * 100)

  return (
    <div style={styles.page}>
      <style>{css}</style>

      {/* ---- HUD: oro + meta ---- */}
      <header style={styles.hud}>
        <div style={styles.goldBox}>
          <span style={styles.goldIcon}>●</span>
          <span ref={goldElRef} style={styles.goldNum}>0</span>
          <span style={styles.goldLbl}>ORO</span>
        </div>
        <div style={styles.metaWrap}>
          <div style={styles.metaTop}>
            <span>Batir al portero</span>
            <span>{formatNum(totalUi)} / {formatNum(META_GOLD)}</span>
          </div>
          <div style={styles.metaBar}>
            <div style={{ ...styles.metaFill, width: `${progress}%` }} />
          </div>
        </div>
        <div style={styles.tally}>
          <span style={{ color: '#4ade80' }}>{goles} goles</span>
          <span style={{ color: '#ef4444' }}>{fallos} fallos</span>
        </div>
      </header>

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
          <div className="net" />

          {/* zonas (escaladas por Mira amplia; solo referencia visual) */}
          {effZones.map((z) => (
            <div key={z.id} style={{
              position: 'absolute', left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`,
              border: `2px dashed ${z.color}`, background: `${z.color}1a`, borderRadius: 4,
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center', pointerEvents: 'none',
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: z.color, marginTop: 2, textShadow: '0 1px 2px #000' }}>
                {z.label} ×{z.kind === 'escuadra' ? escuadraMult(levels) : z.kind === 'centro' ? 2 : 1}
              </span>
            </div>
          ))}

          {/* portero (no escala) */}
          <div style={{
            position: 'absolute', left: `${PORTERO.x}%`, top: `${PORTERO.y}%`, width: `${PORTERO.w}%`, height: `${PORTERO.h}%`,
            background: 'linear-gradient(180deg,#dc2626,#7f1d1d)', border: '2px solid #fca5a5', borderRadius: '8px 8px 4px 4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', boxShadow: '0 0 14px #ef444466',
          }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: 1 }}>PORTERO</span>
          </div>

          <div style={styles.frame} />

          {/* canvas de nuggets (encima de zonas, debajo de pelota/mira) */}
          <canvas ref={canvasRef} className="nug-canvas" />

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

          {/* textos flotantes */}
          {floaters.map((fl) => (
            <div key={fl.id} className="floater" style={{ left: `${fl.x}%`, top: `${fl.y}%`, color: fl.color }}>{fl.label}</div>
          ))}

          {/* banner de victoria */}
          {victory && (
            <div style={styles.victory}>
              <div style={styles.victoryTitle}>¡PORTERO BATIDO!</div>
              <div style={styles.victorySub}>{formatNum(totalRef.current)} de oro acumulado</div>
              <button style={styles.sala2} disabled>SALA 2 · próximamente</button>
            </div>
          )}
        </div>

        {/* ---- PANEL DE MEJORAS ---- */}
        <aside style={styles.panel}>
          <h2 style={styles.panelTitle}>MEJORAS</h2>
          {UPG_ORDER.map((key) => {
            const lv = levels[key]
            const c = cost(key, lv)
            const afford = goldUi >= c
            const { txt, maxed } = upgradeDesc(key, levels)
            return (
              <button
                key={key}
                onClick={() => buy(key)}
                disabled={!afford || maxed}
                style={{
                  ...styles.upg,
                  borderColor: UPG[key].color + (afford && !maxed ? 'aa' : '33'),
                  opacity: maxed ? 0.5 : afford ? 1 : 0.55,
                  cursor: afford && !maxed ? 'pointer' : 'not-allowed',
                }}
              >
                <div style={styles.upgTop}>
                  <span style={{ fontWeight: 800, color: UPG[key].color }}>{UPG[key].name}</span>
                  <span style={styles.upgLv}>Nv {lv}</span>
                </div>
                <div style={styles.upgEff}>{txt}</div>
                <div style={{ ...styles.upgCost, color: maxed ? '#64748b' : afford ? '#fbbf24' : '#64748b' }}>
                  {maxed ? 'MÁX' : `● ${formatNum(c)}`}
                </div>
              </button>
            )
          })}
        </aside>
      </div>

      <div style={styles.foot}>▲ el pie</div>
      <p style={styles.hint}>
        Clic / <kbd style={styles.kbd}>ESPACIO</kbd> para chutar · barre los <b style={{ color: '#fbbf24' }}>nuggets</b> con el ratón ·
        la <b style={{ color: '#ffd23f' }}>escuadra</b> da el oro gordo
      </p>
    </div>
  )
}

/* ============================================================================
 * Texto de efecto de cada mejora (current → next) + flag de tope
 * ========================================================================== */
function upgradeDesc(key: UpgKey, l: Levels): { txt: string; maxed: boolean } {
  const n = (k: keyof Levels, v: number) => ({ ...l, [k]: v }) as Levels
  switch (key) {
    case 'potencia': return { txt: `oro base ${oroBase(l)} → ${oroBase(n('potencia', l.potencia + 1))}`, maxed: false }
    case 'rosca':    return { txt: `escuadra ×${escuadraMult(l)} → ×${escuadraMult(n('rosca', l.rosca + 1))}`, maxed: false }
    case 'botas':    return { txt: `global +${l.botas * 25}% → +${(l.botas + 1) * 25}%`, maxed: false }
    case 'cadencia': {
      const cur = cooldownMs(l), nxt = cooldownMs(n('cadencia', l.cadencia + 1))
      return { txt: `CD ${cur}ms${cur <= COOLDOWN_FLOOR ? ' (suelo)' : ` → ${nxt}ms`}`, maxed: cur <= COOLDOWN_FLOOR }
    }
    case 'mira': {
      const cur = miraPct(l), nxt = miraPct(n('mira', l.mira + 1))
      return { txt: `zonas +${cur}%${cur >= 60 ? ' (cap)' : ` → +${nxt}%`}`, maxed: cur >= 60 }
    }
    case 'iman':     return { txt: `radio ${magnetR(l)}px → ${magnetR(n('iman', l.iman + 1))}px`, maxed: false }
    case 'recolector':
      return l.recolector === 0
        ? { txt: 'activa bot idle (auto-tira al raso + recoge)', maxed: false }
        : { txt: `bot radio ${botR(l)}px → ${botR(n('recolector', l.recolector + 1))}px`, maxed: false }
  }
}

/* Rebote: invierte componente, jitter al ángulo, renormaliza a SPEED, fuerza signo. */
function bounce(v: Vec, axis: 'x' | 'y', sign: number) {
  if (axis === 'x') v.x = -v.x; else v.y = -v.y
  v.x += rand(-JITTER, JITTER); v.y += rand(-JITTER, JITTER)
  const m = Math.hypot(v.x, v.y) || 1
  v.x = (v.x / m) * SPEED; v.y = (v.y / m) * SPEED
  if (axis === 'x') v.x = Math.abs(v.x) * sign; else v.y = Math.abs(v.y) * sign
}

/* ---- dibujo de un nugget (oro con brillo y rotación) ---- */
function drawNugget(ctx: CanvasRenderingContext2D, n: Nugget) {
  ctx.save()
  ctx.translate(n.x, n.y)
  ctx.rotate(n.rot)
  if (n.collecting) { ctx.shadowColor = '#ffe066'; ctx.shadowBlur = 12 }
  // cuerpo
  ctx.beginPath()
  ctx.arc(0, 0, NUGGET_R, 0, Math.PI * 2)
  ctx.fillStyle = n.collecting ? '#ffe680' : '#f5c518'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#b8860b'
  ctx.stroke()
  // brillo
  ctx.beginPath()
  ctx.arc(-NUGGET_R * 0.32, -NUGGET_R * 0.32, NUGGET_R * 0.34, 0, Math.PI * 2)
  ctx.fillStyle = '#fffde0cc'
  ctx.fill()
  ctx.restore()
}

/* ---- dibujo del bot recolector + halo de su radio ---- */
function drawBot(ctx: CanvasRenderingContext2D, b: Bot, r: number, time: number) {
  // halo de radio
  ctx.beginPath()
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2)
  ctx.fillStyle = '#f8717111'
  ctx.fill()
  ctx.strokeStyle = '#f8717144'
  ctx.lineWidth = 1.5
  ctx.stroke()
  // cuerpo (platillo pulsante)
  const pulse = 1 + Math.sin(time / 200) * 0.08
  ctx.save()
  ctx.translate(b.x, b.y)
  ctx.scale(pulse, pulse)
  ctx.beginPath()
  ctx.arc(0, 0, 10, 0, Math.PI * 2)
  ctx.fillStyle = '#1e293b'
  ctx.fill()
  ctx.strokeStyle = '#f87171'
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(0, 0, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = '#f87171'
  ctx.fill()
  ctx.restore()
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
  hud: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, width: 'min(94vw, 1080px)', flexWrap: 'wrap' },
  goldBox: { display: 'flex', alignItems: 'baseline', gap: 8 },
  goldIcon: { color: '#fbbf24', fontSize: 18 },
  goldNum: { fontSize: 34, fontWeight: 900, color: '#fbbf24', fontVariantNumeric: 'tabular-nums', minWidth: 80 },
  goldLbl: { fontSize: 12, fontWeight: 700, letterSpacing: 2, color: '#a16207' },
  metaWrap: { flex: 1, minWidth: 240, maxWidth: 460 },
  metaTop: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600 },
  metaBar: { height: 10, background: '#0f1f18', borderRadius: 6, overflow: 'hidden', border: '1px solid #1e3a2f' },
  metaFill: { height: '100%', background: 'linear-gradient(90deg,#4ade80,#fbbf24)', transition: 'width 0.2s ease', borderRadius: 6 },
  tally: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: 12, fontWeight: 700, gap: 2 },
  stage: { display: 'flex', gap: 16, alignItems: 'flex-start', width: 'min(94vw, 1080px)', justifyContent: 'center', flexWrap: 'wrap' },
  area: {
    position: 'relative', width: 'min(90vw, 760px)', aspectRatio: '16 / 10', flexShrink: 0,
    background: 'linear-gradient(180deg,#0f2018,#0a1510)', border: '4px solid #cbd5e1', borderRadius: 6,
    boxShadow: '0 10px 40px #000a, inset 0 0 60px #0006', cursor: 'crosshair', overflow: 'hidden',
  },
  frame: { position: 'absolute', inset: 0, border: '3px solid #e2e8f088', borderRadius: 4, pointerEvents: 'none' },
  panel: {
    display: 'flex', flexDirection: 'column', gap: 7, width: 260, minWidth: 230, flex: '1 1 230px', maxWidth: 300,
    background: '#0c1512cc', border: '1px solid #1e293b', borderRadius: 10, padding: 12,
  },
  panelTitle: { margin: '0 0 4px', fontSize: 13, fontWeight: 800, letterSpacing: 3, color: '#64748b' },
  upg: {
    textAlign: 'left', background: '#111c18', border: '1.5px solid', borderRadius: 8, padding: '8px 10px',
    color: '#e2e8f0', font: 'inherit', display: 'flex', flexDirection: 'column', gap: 2, transition: 'opacity .15s',
  },
  upgTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 },
  upgLv: { fontSize: 11, color: '#94a3b8', fontWeight: 700 },
  upgEff: { fontSize: 11, color: '#94a3b8' },
  upgCost: { fontSize: 12, fontWeight: 800, marginTop: 2 },
  foot: { fontSize: 12, color: '#64748b', fontWeight: 600, letterSpacing: 1, marginTop: -4 },
  hint: { fontSize: 13, color: '#64748b', margin: 0, textAlign: 'center' },
  kbd: { background: '#1e293b', border: '1px solid #475569', borderRadius: 4, padding: '1px 6px', fontSize: 12, color: '#cbd5e1' },
  victory: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 12, background: 'radial-gradient(circle, #0a1510dd, #000d)', backdropFilter: 'blur(2px)', zIndex: 20,
  },
  victoryTitle: { fontSize: 32, fontWeight: 900, color: '#fbbf24', letterSpacing: 2, textShadow: '0 0 20px #fbbf2466' },
  victorySub: { fontSize: 14, color: '#cbd5e1' },
  sala2: { marginTop: 8, padding: '10px 20px', borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: '#94a3b8', fontWeight: 700, cursor: 'not-allowed' },
}

const css = `
.net {
  position:absolute; inset:0; pointer-events:none; opacity:.35;
  background-image: linear-gradient(#ffffff22 1px, transparent 1px), linear-gradient(90deg, #ffffff22 1px, transparent 1px);
  background-size: 22px 22px;
}
.nug-canvas { position:absolute; inset:0; pointer-events:none; }
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
  background: radial-gradient(circle at 32% 30%, #fff 0%, #e8e8e8 40%, #b8b8b8 75%, #888 100%);
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
