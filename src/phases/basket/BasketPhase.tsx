import { useEffect, useRef, useState } from 'react'
import { rand, lerp, formatNum } from '../../core/utils'
import { costOf, type UpgradeDef } from '../../core/economy'
import { createNuggetSystem, drawMagnetRing, type NuggetSystem } from '../../core/nuggets'
import { hot, useColdVersion, buyUpgrade } from '../../core/store'
import { sfx } from '../../core/audio'
import { Hud } from '../../ui/Hud'
import { UpgradePanel, type UpgRow } from '../../ui/UpgradePanel'

/* ============================================================================
 * DIALES DE BALANCE  ─ tocar aquí para iterar el feel rápido
 * ========================================================================== */

// Cancha (vista lateral, % del área) -----------------------------------------
const HOOP = { x: 86, y: 30 }     // centro del aro
const BOARD = { x: 91, y: 16, w: 2.2, h: 20 }  // tablero
const FLOOR_Y = 88                // línea de suelo (los pies)
const BALL_R = 13                 // radio del balón (px)

// Barra de potencia (el corazón del timing) ----------------------------------
const OSC_HZ = 0.85               // ciclos/seg de la onda triangular (time-based, NO por frame)
const SWEET_CENTER = 0.72         // el sweet spot vive "arriba" de la barra
const GOOD_RATIO = 2.0            // ventana "entra normal" = sweetW × GOOD_RATIO
const RECOVER_MS = 250            // mini-CD tras soltar (la carga ES el ritmo; sin cadencia comprable)

// Defensor (análogo móvil del portero) ----------------------------------------
const DEF_RANGE: [number, number] = [40, 72]  // patrulla (cubre media y bandeja, NUNCA el triple)
const DEF_SPEED = 7               // %/s
const DEF_JUMP_MS = 600
const DEF_CROUCH_MS = 200         // telegrafiado: se agacha antes de saltar
const DEF_JUMP_GAP: [number, number] = [1400, 2600]  // ms entre saltos
const DEF_REACT_MS: [number, number] = [250, 850]    // al cargar en posición taponeable, adelanta su salto
const DEF_BLOCK_X = 9             // % de distancia horizontal para taponar
const DEF_BLOCK_WINDOW: [number, number] = [0.15, 0.70]  // tramo del salto que tapona
const DEF_W = 7, DEF_H = 24       // tamaño del defensor (%)

// Mascota (bot con balón PROPIO: tiros libres independientes del jugador; NO recoge) --
const FT_X = 58                   // posición del tiro libre
const FT_BASE_MS = 2000           // ms entre tiros libres a nivel 1
const FT_DECAY = 0.9              // cada nivel extra recorta la cadencia ×0.9
const FT_FLOOR_MS = 700           // suelo duro de la cadencia
const FT_FLIGHT_MS = 420          // vuelo del tiro libre
const MAGNET_BASE = 34
const MAGNET_STEP = 20

// Economía / meta --------------------------------------------------------------
export const META_GOLD_BASKET = 250_000
const SWISH_MULT = 1.5            // bonus fijo del swish; el combo lo escala

/* ============================================================================
 * POSICIONES DE TIRO  (análogo raso/centro/escuadra: riesgo/recompensa)
 * ========================================================================== */

type ShotPos = 'bandeja' | 'media' | 'triple'
const POS: Record<ShotPos, { x: number; flightMs: number; arcH: number; label: string; color: string; sweetW: number; blockable: boolean }> = {
  bandeja: { x: 68, flightMs: 320, arcH: 14, label: 'BANDEJA', color: '#4ade80', sweetW: 0.16, blockable: true },
  media:   { x: 44, flightMs: 480, arcH: 26, label: 'MEDIA',   color: '#ff8c42', sweetW: 0.10, blockable: true },
  triple:  { x: 16, flightMs: 650, arcH: 38, label: 'TRIPLE',  color: '#ffd23f', sweetW: 0.06, blockable: false },
}
const POS_ORDER: ShotPos[] = ['bandeja', 'media', 'triple']

/* ============================================================================
 * MEJORAS  (árbol propio del baloncesto — economía soft-reset)
 * ========================================================================== */

type BKey = 'tiro' | 'muneca' | 'triple' | 'combo' | 'finta' | 'zapas' | 'iman' | 'mascota'
type Levels = Record<BKey, number>

const UPG: Record<BKey, UpgradeDef> = {
  tiro:    { name: 'Tiro potente', base: 10,  growth: 1.12, color: '#60a5fa' },
  muneca:  { name: 'Muñeca',       base: 40,  growth: 1.14, color: '#34d399' },
  triple:  { name: 'Triple letal', base: 80,  growth: 1.18, color: '#ffd23f' },
  combo:   { name: 'En racha',     base: 150, growth: 1.22, color: '#ff8c42' },
  finta:   { name: 'Finta',        base: 60,  growth: 1.16, color: '#a78bfa' },
  zapas:   { name: 'Zapas pro',    base: 250, growth: 1.23, color: '#fbbf24' },
  iman:    { name: 'Imán',         base: 30,  growth: 1.10, color: '#f472b6' },
  mascota: { name: 'Mascota',      base: 500, growth: 1.20, color: '#f87171' },
}
const UPG_ORDER: BKey[] = ['tiro', 'muneca', 'triple', 'combo', 'finta', 'zapas', 'iman', 'mascota']

// --- selectores derivados (funciones puras de los niveles) ---
const tiroBase = (l: Levels) => 1 + l.tiro
const sweetWOf = (pos: ShotPos, l: Levels) => POS[pos].sweetW * Math.min(1.8, 1 + l.muneca * 0.10) // cap +80%
const tripleMult = (l: Levels) => 3 + l.triple * 1.5
const posMult = (pos: ShotPos, l: Levels) => pos === 'triple' ? tripleMult(l) : pos === 'media' ? 2 : 1
const comboStep = (l: Levels) => l.combo > 0 ? 0.25 : 0      // +0.25× por swish consecutivo
const comboCap = (l: Levels) => l.combo > 0 ? 1 + l.combo : 0 // máx swishes apilables
const fintaDodge = (l: Levels) => Math.min(0.6, l.finta * 0.08) // cap 60% de tapones esquivados
const bonusCancha = (l: Levels) => 1 + l.zapas * 0.25
const magnetR = (l: Levels) => MAGNET_BASE + l.iman * MAGNET_STEP
const ftMs = (l: Levels) =>
  Math.max(FT_FLOOR_MS, Math.round(FT_BASE_MS * FT_DECAY ** Math.max(0, l.mascota - 1)))

const readLevels = (raw: Record<string, number>): Levels => {
  const l = {} as Levels
  for (const k of UPG_ORDER) l[k] = raw[k] ?? 0
  return l
}

const cost = (key: BKey, lv: number) => costOf(UPG[key], lv)

/* ============================================================================
 * Tipos internos
 * ========================================================================== */

type Outcome = 'swish' | 'normal' | 'corto' | 'largo' | 'tapon'
type Flight = {
  active: boolean; start: number; fromX: number; fromY: number; toX: number; toY: number
  ms: number; arcH: number; outcome: Outcome; oro: number; label: string; color: string
}
type Reject = { active: boolean; x: number; y: number; vx: number; vy: number; born: number }
type Charge = { active: boolean; phase: number; value: number; lastT: number }
type Def = { x: number; dir: number; jumping: boolean; crouching: boolean; jumpStart: number; nextJumpAt: number; lastT: number }
type Floater = { id: number; x: number; y: number; label: string; color: string }

// onda triangular 0→1→0 (sube y baja)
const tri = (p: number) => { const f = p % 1; return f < 0.5 ? f * 2 : 2 - f * 2 }

/* ============================================================================
 * Componente
 * ========================================================================== */

export function BasketPhase() {
  useColdVersion()
  const P = hot.phases.basket

  // --- refs de animación (NUNCA provocan re-render) ---
  const areaRef = useRef<HTMLDivElement>(null)
  const ballRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const goldElRef = useRef<HTMLSpanElement>(null)
  const barCursorRef = useRef<HTMLDivElement>(null)
  const barFillRef = useRef<HTMLDivElement>(null)
  const defElRef = useRef<HTMLDivElement>(null)

  const chargeRef = useRef<Charge>({ active: false, phase: 0, value: 0, lastT: 0 })
  const recoverUntilRef = useRef(0)
  const flightRef = useRef<Flight>({ active: false, start: 0, fromX: 0, fromY: 0, toX: 0, toY: 0, ms: 400, arcH: 20, outcome: 'normal', oro: 0, label: '', color: '#fff' })
  const rejectRef = useRef<Reject>({ active: false, x: 0, y: 0, vx: 0, vy: 0, born: 0 })
  const defRef = useRef<Def>({ x: 56, dir: 1, jumping: false, crouching: false, jumpStart: 0, nextJumpAt: 0, lastT: 0 })
  const comboRef = useRef(0)
  // mascota: balón y reloj propios — nunca toca la carga/vuelo del jugador
  const ftBallRef = useRef<HTMLDivElement>(null)
  const ftFlightRef = useRef({ active: false, start: 0 })
  const nextFtAtRef = useRef(0)

  const goldDispRef = useRef(P.gold)
  const nugSysRef = useRef<NuggetSystem | null>(null)
  if (!nugSysRef.current) {
    // los nuggets CAEN del aro (no explotan hacia arriba como en la portería)
    nugSysRef.current = createNuggetSystem({ spawnVx: [-1.6, 1.6], spawnVy: [0.5, 2.5] })
  }
  const mouseRef = useRef({ x: 0, y: 0, inside: false })
  const cssWRef = useRef(760)
  const cssHRef = useRef(475)

  const levels = readLevels(P.levels)
  const levelsRef = useRef<Levels>(levels)
  levelsRef.current = levels

  const [posKey, setPosKey] = useState<ShotPos>('bandeja')
  const posKeyRef = useRef<ShotPos>(posKey)
  posKeyRef.current = posKey

  // --- estado React (baja frecuencia) ---
  const [goldUi, setGoldUi] = useState(P.gold)
  const [totalUi, setTotalUi] = useState(P.total)
  const [canastas, setCanastas] = useState(P.goles)
  const [fallos, setFallos] = useState(P.fallos)
  const [comboUi, setComboUi] = useState(0)
  const [charging, setCharging] = useState(false)
  const [floaters, setFloaters] = useState<Floater[]>([])
  const [victory, setVictory] = useState(false)
  // el banner solo se arma si la meta NO estaba ya batida al entrar (no reaparece en cada visita)
  const victoryArmedRef = useRef(P.total < META_GOLD_BASKET)
  const floaterId = useRef(0)

  const pushFloater = (x: number, y: number, label: string, color: string) => {
    const id = floaterId.current++
    setFloaters((fs) => [...fs, { id, x, y, label, color }])
    window.setTimeout(() => setFloaters((fs) => fs.filter((f) => f.id !== id)), 850)
  }

  // Al desmontar la fase, los nuggets en pantalla se vuelcan a la cartera
  useEffect(() => () => {
    const v = nugSysRef.current!.drain()
    P.gold += v
    P.total += v
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- resolución del tiro MANUAL: se decide AL SOLTAR; el vuelo es presentación.
   *      (la mascota tiene su propio mini-sistema en el bucle y no pasa por aquí) ---- */
  const releaseShot = (value: number, fromPos: ShotPos) => {
    const l = levelsRef.current
    const pos = POS[fromPos]
    const fromX = pos.x
    const ms = pos.flightMs
    const arcH = pos.arcH

    let outcome: Outcome
    {
      const def = defRef.current
      const jumpT = def.jumping ? (performance.now() - def.jumpStart) / DEF_JUMP_MS : -1
      const blocked = pos.blockable
        && Math.abs(def.x - pos.x) < DEF_BLOCK_X
        && jumpT >= DEF_BLOCK_WINDOW[0] && jumpT <= DEF_BLOCK_WINDOW[1]
        && Math.random() >= fintaDodge(l)
      if (blocked) outcome = 'tapon'
      else {
        const d = Math.abs(value - SWEET_CENTER)
        const sw = sweetWOf(fromPos, l)
        if (d <= sw / 2) outcome = 'swish'
        else if (d <= (sw * GOOD_RATIO) / 2) outcome = 'normal'
        else outcome = value < SWEET_CENTER ? 'corto' : 'largo'
      }
    }

    // oro y combo (el combo solo sube con swish; se rompe al fallar o ser taponado)
    let oro = 0, label = '', color = '#94a3b8'
    if (outcome === 'swish' || outcome === 'normal') {
      const mult = posMult(fromPos, l)
      let swishFactor = 1
      if (outcome === 'swish') {
        comboRef.current = Math.min(comboRef.current + 1, Math.max(1, comboCap(l)))
        swishFactor = SWISH_MULT * (1 + comboRef.current * comboStep(l))
      }
      oro = Math.max(1, Math.round(tiroBase(l) * mult * swishFactor * bonusCancha(l)))
      label = outcome === 'swish'
        ? `SWISH${comboRef.current > 1 ? ` ×${comboRef.current}` : ''}!`
        : 'CANASTA'
      color = outcome === 'swish' ? '#ffd23f' : '#4ade80'
    } else {
      comboRef.current = 0
      label = outcome === 'tapon' ? '¡TAPÓN!' : outcome === 'corto' ? '¡CORTO!' : '¡LARGO!'
      color = outcome === 'tapon' ? '#ef4444' : '#94a3b8'
    }

    // destino del vuelo según resultado
    let toX = HOOP.x, toY = HOOP.y
    if (outcome === 'corto') { toX = HOOP.x - 3.5; toY = HOOP.y - 1 }
    else if (outcome === 'largo') { toX = BOARD.x; toY = HOOP.y - 7 }
    else if (outcome === 'tapon') { toX = defRef.current.x; toY = 52 }

    flightRef.current = {
      active: true, start: 0,
      fromX, fromY: FLOOR_Y - 10, toX, toY,
      ms: outcome === 'tapon' ? Math.min(ms, 260) : ms,
      arcH: outcome === 'tapon' ? 8 : arcH,
      outcome, oro, label, color,
    }
    recoverUntilRef.current = performance.now() + RECOVER_MS
    sfx.throwBall()
  }

  /* ---- hold-and-release (pointer + ESPACIO; release SIEMPRE en window) ---- */
  const startCharge = () => {
    const now = performance.now()
    if (chargeRef.current.active || flightRef.current.active || rejectRef.current.active) return
    if (now < recoverUntilRef.current) return
    chargeRef.current = { active: true, phase: 0, value: 0, lastT: now }
    setCharging(true)
    sfx.chargeStart()
    // el defensor "huele" el tiro: si la posición es taponeable, adelanta su salto
    // (telegrafiado — el jugador ve el agachado y decide soltar antes o arriesgar)
    const def = defRef.current
    if (POS[posKeyRef.current].blockable && !def.jumping) {
      def.nextJumpAt = Math.min(def.nextJumpAt, now + rand(DEF_REACT_MS[0], DEF_REACT_MS[1]))
    }
  }
  const endCharge = (cancel: boolean) => {
    const c = chargeRef.current
    if (!c.active) return
    c.active = false
    setCharging(false)
    if (!cancel) releaseShot(c.value, posKeyRef.current)
  }
  const startChargeRef = useRef(startCharge); startChargeRef.current = startCharge
  const endChargeRef = useRef(endCharge); endChargeRef.current = endCharge

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) startChargeRef.current() }
      else if (e.code === 'Digit1') setPosKey('bandeja')
      else if (e.code === 'Digit2') setPosKey('media')
      else if (e.code === 'Digit3') setPosKey('triple')
    }
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') endChargeRef.current(false) }
    const onPointerUp = () => endChargeRef.current(false)
    const onPointerCancel = () => endChargeRef.current(true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [])

  // --- throttle: refresca la UI sin tocar el bucle de 60fps ---
  useEffect(() => {
    const id = window.setInterval(() => {
      setGoldUi(P.gold)
      setTotalUi(P.total)
      setCanastas(P.goles)
      setFallos(P.fallos)
      setComboUi(comboRef.current)
      if (victoryArmedRef.current && P.total >= META_GOLD_BASKET) {
        victoryArmedRef.current = false
        setVictory(true)
        sfx.victory()
      }
    }, 120)
    return () => window.clearInterval(id)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- BUCLE ÚNICO: barra + vuelo + rechace + defensor + nuggets + mascota ---- */
  useEffect(() => {
    let raf = 0

    const loop = (time: number) => {
      const area = areaRef.current
      const canvas = canvasRef.current
      const ball = ballRef.current
      if (area && canvas && ball) {
        const aw = area.clientWidth
        const ah = area.clientHeight

        /* ---- barra de potencia: TIME-BASED (igual feel a 60 y 144Hz) ---- */
        const c = chargeRef.current
        if (c.active) {
          const dt = Math.min(0.05, (time - c.lastT) / 1000)
          c.lastT = time
          c.phase += dt * OSC_HZ
          c.value = tri(c.phase)
        }
        const cursor = barCursorRef.current, fill = barFillRef.current
        if (cursor && fill) {
          const barH = fill.parentElement!.clientHeight
          cursor.style.transform = `translateY(${(1 - c.value) * barH}px)`
          fill.style.height = `${c.value * 100}%`
        }

        /* ---- defensor: patrulla + salto telegrafiado (time-based) ---- */
        const def = defRef.current
        if (def.lastT === 0) { def.lastT = time; def.nextJumpAt = time + rand(DEF_JUMP_GAP[0], DEF_JUMP_GAP[1]) }
        const ddt = Math.min(0.05, (time - def.lastT) / 1000)
        def.lastT = time
        def.x += def.dir * DEF_SPEED * ddt
        if (def.x <= DEF_RANGE[0]) { def.x = DEF_RANGE[0]; def.dir = 1 }
        else if (def.x >= DEF_RANGE[1]) { def.x = DEF_RANGE[1]; def.dir = -1 }
        if (!def.jumping) {
          def.crouching = time >= def.nextJumpAt - DEF_CROUCH_MS
          if (time >= def.nextJumpAt) { def.jumping = true; def.crouching = false; def.jumpStart = time }
        } else if (time - def.jumpStart >= DEF_JUMP_MS) {
          def.jumping = false
          def.nextJumpAt = time + rand(DEF_JUMP_GAP[0], DEF_JUMP_GAP[1])
        }
        const defEl = defElRef.current
        if (defEl) {
          const jumpT = def.jumping ? (time - def.jumpStart) / DEF_JUMP_MS : 0
          const jumpPx = def.jumping ? -Math.sin(Math.PI * jumpT) * ah * 0.13 : 0
          const squash = def.crouching ? 0.82 : 1
          defEl.style.transform = `translate(${(def.x / 100) * aw - ((DEF_W / 100) * aw) / 2}px, ${((FLOOR_Y - DEF_H) / 100) * ah + jumpPx}px) scaleY(${squash})`
        }

        /* ---- vuelo del balón ---- */
        const f = flightRef.current
        if (f.active) {
          if (f.start === 0) f.start = time
          const t = Math.min(1, (time - f.start) / f.ms)
          const cx = lerp(f.fromX, f.toX, t)
          const cy = lerp(f.fromY, f.toY, t) - Math.sin(t * Math.PI) * f.arcH
          ball.style.transform = `translate(${(cx / 100) * aw - BALL_R}px, ${(cy / 100) * ah - BALL_R}px)`
          ball.style.opacity = '1'
          if (t >= 1) {
            f.active = false
            const hoopPxX = (HOOP.x / 100) * aw
            const hoopPxY = ((HOOP.y + 4) / 100) * ah
            if (f.outcome === 'swish' || f.outcome === 'normal') {
              P.goles++
              ball.style.opacity = '0'
              if (f.outcome === 'swish') sfx.swish(comboRef.current); else sfx.basket()
              const absorbed = nugSysRef.current!.spawn(hoopPxX, hoopPxY, f.oro)
              if (absorbed > 0) { P.gold += absorbed; P.total += absorbed }
              pushFloater(HOOP.x, HOOP.y - 6, f.label, f.color)
            } else {
              P.fallos++
              if (f.outcome === 'tapon') sfx.tapon(); else sfx.rim()
              pushFloater(f.toX, f.toY - 5, f.label, f.color)
              // rechace: el balón sale despedido con física simple y se desvanece
              rejectRef.current = {
                active: true, x: f.toX, y: f.toY,
                vx: f.outcome === 'largo' ? rand(-1.6, -0.8) : f.outcome === 'corto' ? rand(-1.1, -0.4) : rand(-1.4, 1.4),
                vy: f.outcome === 'tapon' ? rand(0.2, 0.8) : rand(-1.1, -0.4),
                born: time,
              }
              if (f.outcome === 'tapon') {
                area.animate(
                  [
                    { transform: 'translate(0,0)' }, { transform: 'translate(-6px,2px)' },
                    { transform: 'translate(5px,-3px)' }, { transform: 'translate(0,0)' },
                  ],
                  { duration: 260, easing: 'ease' },
                )
              }
            }
          }
        }

        /* ---- rechace del balón (fallo) ---- */
        const rj = rejectRef.current
        if (rj.active) {
          rj.vy += 0.085
          rj.x += rj.vx * 0.32
          rj.y += rj.vy * 0.32
          const age = time - rj.born
          ball.style.transform = `translate(${(rj.x / 100) * aw - BALL_R}px, ${(rj.y / 100) * ah - BALL_R}px)`
          ball.style.opacity = String(Math.max(0, 1 - age / 650))
          if (age > 650 || rj.y > 104) { rj.active = false; ball.style.opacity = '0' }
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
        const sys = nugSysRef.current!
        const mr = magnetR(l)
        const botActive = l.mascota >= 1
        const m = mouseRef.current

        /* ---- física + recogida (el imán del ratón es el ÚNICO recolector) ---- */
        const absorbed = sys.step(aw, ah, m.inside ? { x: m.x, y: m.y, r: mr } : null)
        if (absorbed > 0) { P.gold += absorbed; P.total += absorbed; sfx.coin() }

        sys.draw(ctx)
        if (m.inside) drawMagnetRing(ctx, m.x, m.y, mr)

        /* ---- mascota: tiro libre con balón y reloj PROPIOS, independiente del jugador ---- */
        if (botActive) {
          const mf = ftFlightRef.current
          if (!mf.active && time >= nextFtAtRef.current) {
            mf.active = true; mf.start = 0
            nextFtAtRef.current = time + ftMs(l)
          }
          const ftBall = ftBallRef.current
          if (mf.active && ftBall) {
            if (mf.start === 0) mf.start = time
            const t = Math.min(1, (time - mf.start) / FT_FLIGHT_MS)
            const cx = lerp(FT_X, HOOP.x, t)
            const cy = lerp(FLOOR_Y - 10, HOOP.y, t) - Math.sin(t * Math.PI) * 22
            ftBall.style.transform = `translate(${(cx / 100) * aw - BALL_R}px, ${(cy / 100) * ah - BALL_R}px)`
            ftBall.style.opacity = '1'
            if (t >= 1) {
              mf.active = false
              ftBall.style.opacity = '0'
              // la mascota nunca falla ni hace swish; no toca el combo del jugador
              P.goles++
              sfx.basket(true)  // atenuado: es la mascota
              const oroFt = Math.max(1, Math.round(tiroBase(l) * bonusCancha(l)))
              const abs2 = sys.spawn((HOOP.x / 100) * aw, ((HOOP.y + 4) / 100) * ah, oroFt)
              if (abs2 > 0) { P.gold += abs2; P.total += abs2 }
              pushFloater(HOOP.x, HOOP.y - 6, 'TIRO LIBRE', '#4ade80')
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

  const onBuy = (key: string) => {
    if (buyUpgrade('basket', key, UPG[key as BKey])) { setGoldUi(P.gold); sfx.buy() }
  }

  const upgRows: UpgRow[] = UPG_ORDER.map((key) => {
    const { txt, maxed } = upgradeDesc(key, levels)
    return { key, def: UPG[key], lv: levels[key], cost: cost(key, levels[key]), desc: txt, maxed }
  })

  // geometría de la barra (las franjas solo cambian al comprar Muñeca → render frío)
  const sw = sweetWOf(posKey, levels)
  const goodW = sw * GOOD_RATIO
  const band = (w: number) => ({ bottom: `${(SWEET_CENTER - w / 2) * 100}%`, height: `${w * 100}%` })

  return (
    <div style={styles.page}>
      <style>{css}</style>

      <Hud
        goldElRef={goldElRef}
        metaLabel="Dominar la cancha"
        totalUi={totalUi}
        metaGold={META_GOLD_BASKET}
        tally={[
          { label: `${canastas} canastas`, color: '#4ade80' },
          { label: `${fallos} fallos`, color: '#ef4444' },
          ...(comboUi > 1 ? [{ label: `racha ×${comboUi} 🔥`, color: '#ff8c42' }] : []),
        ]}
      />

      <div style={styles.stage}>
        {/* ---- CANCHA ---- */}
        <div
          ref={areaRef}
          className="court-area"
          onPointerDown={startCharge}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          style={styles.area}
        >
          {/* suelo de parqué */}
          <div className="parquet" style={{ top: `${FLOOR_Y}%` }} />

          {/* tablero + poste + aro */}
          <div style={{
            position: 'absolute', left: `${BOARD.x}%`, top: `${BOARD.y}%`, width: `${BOARD.w}%`, height: `${BOARD.h}%`,
            background: 'linear-gradient(90deg,#e2e8f0,#94a3b8)', borderRadius: 2, border: '1px solid #cbd5e1',
          }} />
          <div style={{
            position: 'absolute', left: `${BOARD.x + BOARD.w / 2 - 0.4}%`, top: `${BOARD.y + BOARD.h}%`, width: '0.8%', height: `${FLOOR_Y - BOARD.y - BOARD.h}%`,
            background: 'linear-gradient(180deg,#475569,#1e293b)',
          }} />
          <div className="rim" style={{ left: `${HOOP.x - 3.2}%`, top: `${HOOP.y}%`, width: '6.4%' }} />
          <div className="rim-net" style={{ left: `${HOOP.x - 2.4}%`, top: `${HOOP.y + 1}%`, width: '4.8%', height: '7%' }} />

          {/* defensor (movido por transform en el bucle) */}
          <div ref={defElRef} className="defender" style={{ width: `${DEF_W}%`, height: `${DEF_H}%` }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: 1 }}>DEF</span>
          </div>

          {/* marcas de posición en el suelo */}
          {POS_ORDER.map((k) => {
            const p = POS[k]
            const mult = posMult(k, levels)
            const sel = k === posKey
            return (
              <button
                key={k}
                onPointerDown={(e) => { e.stopPropagation(); setPosKey(k) }}
                className="pos-mark"
                style={{
                  left: `${p.x}%`, top: `${FLOOR_Y + 3}%`,
                  borderColor: sel ? p.color : '#475569',
                  color: sel ? p.color : '#64748b',
                  background: sel ? '#0c1512ee' : '#0c1512aa',
                  boxShadow: sel ? `0 0 10px ${p.color}66` : 'none',
                }}
              >
                {p.label} ×{mult}
              </button>
            )
          })}

          {/* jugador en la posición elegida */}
          <div className="player" style={{ left: `${POS[posKey].x}%`, top: `${FLOOR_Y}%` }}>⛹️</div>

          {/* canvas de nuggets (encima de la cancha, debajo del balón) */}
          <canvas ref={canvasRef} className="nug-canvas" />

          {/* balón (vuelo + rechace por transform) */}
          <div ref={ballRef} className="bball" style={{ width: BALL_R * 2, height: BALL_R * 2, opacity: 0 }} />

          {/* mascota: avatar en la línea de tiros libres + su propio balón */}
          {levels.mascota >= 1 && (
            <>
              <div className="mascot" style={{ left: `${FT_X}%`, top: `${FLOOR_Y}%` }}>🐧</div>
              <div ref={ftBallRef} className="bball" style={{ width: BALL_R * 2, height: BALL_R * 2, opacity: 0 }} />
            </>
          )}

          {/* barra de potencia */}
          <div className={charging ? 'power-bar charging' : 'power-bar'} style={styles.bar}>
            <div ref={barFillRef} className="bar-fill" />
            <div className="bar-band good" style={band(goodW)} />
            <div className="bar-band sweet" style={band(sw)} />
            <div ref={barCursorRef} className="bar-cursor" />
          </div>

          {/* textos flotantes */}
          {floaters.map((fl) => (
            <div key={fl.id} className="floater" style={{ left: `${fl.x}%`, top: `${fl.y}%`, color: fl.color }}>{fl.label}</div>
          ))}

          {/* banner de victoria */}
          {victory && (
            <div style={styles.victory}>
              <div style={styles.victoryTitle}>¡CANCHA DOMINADA!</div>
              <div style={styles.victorySub}>{formatNum(P.total)} de oro acumulado</div>
              <button style={styles.sala3} disabled>SALA 3 · próximamente</button>
              <button style={styles.keepPlaying} onClick={() => setVictory(false)}>seguir jugando</button>
            </div>
          )}
        </div>

        {/* ---- PANEL DE MEJORAS ---- */}
        <UpgradePanel rows={upgRows} gold={goldUi} onBuy={onBuy} />
      </div>

      <p style={styles.hint}>
        <b style={{ color: '#e2e8f0' }}>Mantén pulsado</b> (clic o <kbd style={styles.kbd}>ESPACIO</kbd>) y suelta en la
        franja <b style={{ color: '#ffd23f' }}>dorada</b> = SWISH · <kbd style={styles.kbd}>1</kbd>/<kbd style={styles.kbd}>2</kbd>/<kbd style={styles.kbd}>3</kbd> cambia
        de posición · el <b style={{ color: '#ef4444' }}>defensor</b> tapona bandeja y media
      </p>
    </div>
  )
}

/* ============================================================================
 * Texto de efecto de cada mejora (current → next) + flag de tope
 * ========================================================================== */
function upgradeDesc(key: BKey, l: Levels): { txt: string; maxed: boolean } {
  const n = (k: BKey, v: number) => ({ ...l, [k]: v }) as Levels
  switch (key) {
    case 'tiro':   return { txt: `oro base ${tiroBase(l)} → ${tiroBase(n('tiro', l.tiro + 1))}`, maxed: false }
    case 'muneca': {
      const cur = Math.round((Math.min(1.8, 1 + l.muneca * 0.10) - 1) * 100)
      const nxt = Math.round((Math.min(1.8, 1 + (l.muneca + 1) * 0.10) - 1) * 100)
      return { txt: `sweet spot +${cur}%${cur >= 80 ? ' (cap)' : ` → +${nxt}%`}`, maxed: cur >= 80 }
    }
    case 'triple': return { txt: `triple ×${tripleMult(l)} → ×${tripleMult(n('triple', l.triple + 1))}`, maxed: false }
    case 'combo':
      return l.combo === 0
        ? { txt: 'activa racha: swishes seguidos +25% c/u', maxed: false }
        : { txt: `racha máx ×${comboCap(l)} → ×${comboCap(n('combo', l.combo + 1))}`, maxed: false }
    case 'finta': {
      const cur = Math.round(fintaDodge(l) * 100)
      const nxt = Math.round(fintaDodge(n('finta', l.finta + 1)) * 100)
      return { txt: `esquiva tapones ${cur}%${cur >= 60 ? ' (cap)' : ` → ${nxt}%`}`, maxed: cur >= 60 }
    }
    case 'zapas':  return { txt: `global +${l.zapas * 25}% → +${(l.zapas + 1) * 25}%`, maxed: false }
    case 'iman':   return { txt: `radio ${magnetR(l)}px → ${magnetR(n('iman', l.iman + 1))}px`, maxed: false }
    case 'mascota': {
      if (l.mascota === 0) return { txt: 'activa mascota (tiros libres automáticos)', maxed: false }
      const cur = ftMs(l), nxt = ftMs(n('mascota', l.mascota + 1))
      return { txt: `TL cada ${cur}ms${cur <= FT_FLOOR_MS ? ' (suelo)' : ` → ${nxt}ms`}`, maxed: cur <= FT_FLOOR_MS }
    }
  }
}

/* ============================================================================
 * Estilos
 * ========================================================================== */

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
    background: 'radial-gradient(circle at 50% 0%, #3a2a1e 0%, #14100b 70%)',
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', color: '#e2e8f0', userSelect: 'none', padding: 16,
  },
  stage: { display: 'flex', gap: 16, alignItems: 'flex-start', width: 'min(94vw, 1080px)', justifyContent: 'center', flexWrap: 'wrap' },
  area: {
    position: 'relative', width: 'min(90vw, 760px)', aspectRatio: '16 / 10', flexShrink: 0,
    background: 'linear-gradient(180deg,#241a10,#171109)', border: '4px solid #cbd5e1', borderRadius: 6,
    boxShadow: '0 10px 40px #000a, inset 0 0 60px #0006', cursor: 'pointer', overflow: 'hidden', touchAction: 'none',
  },
  bar: {
    position: 'absolute', left: '3%', top: '18%', width: 16, height: '58%',
    background: '#0c0a07', border: '1.5px solid #475569', borderRadius: 8, overflow: 'hidden',
  },
  hint: { fontSize: 13, color: '#64748b', margin: 0, textAlign: 'center', maxWidth: 720 },
  kbd: { background: '#1e293b', border: '1px solid #475569', borderRadius: 4, padding: '1px 6px', fontSize: 12, color: '#cbd5e1' },
  victory: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 12, background: 'radial-gradient(circle, #14100bdd, #000d)', backdropFilter: 'blur(2px)', zIndex: 20,
  },
  victoryTitle: { fontSize: 32, fontWeight: 900, color: '#fbbf24', letterSpacing: 2, textShadow: '0 0 20px #fbbf2466' },
  victorySub: { fontSize: 14, color: '#cbd5e1' },
  sala3: { marginTop: 8, padding: '10px 20px', borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: '#94a3b8', fontWeight: 700, cursor: 'not-allowed' },
  keepPlaying: { padding: '6px 14px', borderRadius: 8, border: '1px solid #fbbf24', background: 'transparent', color: '#fbbf24', fontWeight: 700, cursor: 'pointer', font: 'inherit', fontSize: 13 },
}

const css = `
.parquet {
  position:absolute; left:0; right:0; bottom:0; pointer-events:none;
  background:
    repeating-linear-gradient(90deg, #00000022 0 2px, transparent 2px 56px),
    linear-gradient(180deg, #8a5a2b, #6b431f);
  border-top: 2px solid #b97f43;
}
.nug-canvas { position:absolute; inset:0; pointer-events:none; }
.rim {
  position:absolute; height:0; border-top:4px solid #ff8c42; border-radius:2px; pointer-events:none;
  box-shadow:0 0 10px #ff8c4288; z-index:5;
}
.rim-net {
  position:absolute; pointer-events:none; opacity:.5; z-index:4;
  background-image: linear-gradient(#ffffff44 1px, transparent 1px), linear-gradient(90deg, #ffffff44 1px, transparent 1px);
  background-size: 7px 7px;
  clip-path: polygon(0 0, 100% 0, 78% 100%, 22% 100%);
}
.defender {
  position:absolute; top:0; left:0; will-change:transform; transform-origin:bottom center;
  background: linear-gradient(180deg,#dc2626,#7f1d1d); border:2px solid #fca5a5; border-radius:8px 8px 4px 4px;
  display:flex; align-items:flex-start; justify-content:center; padding-top:4px;
  box-shadow:0 0 14px #ef444455; pointer-events:none; z-index:6;
}
.player {
  position:absolute; transform:translate(-50%,-92%); font-size:34px; pointer-events:none; z-index:6;
  filter: drop-shadow(0 4px 6px #000a);
}
.mascot {
  position:absolute; transform:translate(-50%,-92%); font-size:26px; pointer-events:none; z-index:6;
  filter: drop-shadow(0 4px 6px #000a);
  animation: mascot-bob 1.6s ease-in-out infinite;
}
@keyframes mascot-bob { 0%,100% { transform:translate(-50%,-92%) translateY(0); } 50% { transform:translate(-50%,-92%) translateY(-4px); } }
.pos-mark {
  position:absolute; transform:translateX(-50%); padding:3px 10px; border-radius:999px; border:1.5px solid;
  font-size:10px; font-weight:800; letter-spacing:1px; font-family:inherit; cursor:pointer; z-index:7;
  transition: all .15s;
}
.bball {
  position:absolute; top:0; left:0; will-change:transform,opacity; border-radius:50%; z-index:8;
  background: radial-gradient(circle at 32% 30%, #ff9d5c 0%, #e8702a 45%, #b34a14 80%, #8a3710 100%);
  border:1.5px solid #5e2a0d; box-shadow:0 0 14px #ff8c4255, 0 4px 10px #0008; pointer-events:none;
}
.bball::after {
  content:''; position:absolute; inset:0; border-radius:50%;
  background:
    linear-gradient(#5e2a0d88, #5e2a0d88) 50% 0 / 1.5px 100% no-repeat,
    linear-gradient(90deg, #5e2a0d88, #5e2a0d88) 0 50% / 100% 1.5px no-repeat;
}
.power-bar { z-index:9; }
.power-bar .bar-fill {
  position:absolute; left:0; right:0; bottom:0; height:0%;
  background: linear-gradient(180deg,#ffd23f66,#ff8c4233); pointer-events:none;
}
.power-bar .bar-band { position:absolute; left:0; right:0; pointer-events:none; }
.power-bar .bar-band.good { background:#4ade8033; border-top:1px solid #4ade8055; border-bottom:1px solid #4ade8055; }
.power-bar .bar-band.sweet { background:#ffd23f99; box-shadow:0 0 8px #ffd23f88; }
.power-bar .bar-cursor {
  position:absolute; left:-3px; right:-3px; top:-2px; height:4px; border-radius:2px; background:#fff;
  box-shadow:0 0 8px #fff; will-change:transform; pointer-events:none;
}
.power-bar.charging { border-color:#ffd23f; box-shadow:0 0 12px #ffd23f44; }
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
