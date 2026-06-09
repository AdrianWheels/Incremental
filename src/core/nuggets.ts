/* Sistema compartido de nuggets (física + imán + recogida) y bot recolector.
 * Extraído LITERALMENTE del prototipo de portería — el orden de integración
 * (acelerar → clamp velocidad → mover → absorber con la distancia pre-movimiento)
 * y la prioridad ratón > bot son parte del game feel validado: no "mejorar de paso".
 * Pensado para llamarse desde el bucle rAF de cada fase: cero asignaciones extra por frame. */

import { rand, clamp } from './utils'

export type Nugget = {
  x: number; y: number; vx: number; vy: number
  value: number; rot: number; rotV: number
  collecting: boolean; flash: number
}
export type Bot = { x: number; y: number; vx: number; vy: number; wx: number; wy: number }
export type Attractor = { x: number; y: number; r: number } | null

export type NuggetCfg = {
  r: number
  gravity: number
  floorDamp: number      // amortiguación al rebotar
  hFriction: number      // fricción horizontal al tocar suelo
  settleV: number        // por debajo de esto, se asienta
  maxNuggets: number     // cap en pantalla (auto-absorbe los más antiguos)
  kMin: number; kMax: number   // nuggets por anotación
  pullAccel: number      // aceleración hacia el atractor
  maxPull: number        // velocidad máx mientras es atraído
  absorbDist: number     // distancia a la que se absorbe
  spawnVx: [number, number]
  spawnVy: [number, number]    // portería: [-9,-4] (explotan hacia arriba); basket: caen del aro
}

export const DEFAULT_NUGGET_CFG: NuggetCfg = {
  r: 7,
  gravity: 0.42,
  floorDamp: 0.5,
  hFriction: 0.82,
  settleV: 0.7,
  maxNuggets: 150,
  kMin: 3, kMax: 8,
  pullAccel: 1.8,
  maxPull: 24,
  absorbDist: 12,
  spawnVx: [-3.5, 3.5],
  spawnVy: [-9, -4],
}

export type NuggetSystem = {
  list: Nugget[]
  /** Materializa totalValue en K nuggets desde (px, py) en píxeles; suma EXACTA (resto al último).
   *  Devuelve el oro auto-absorbido por el cap (el caller lo suma a su cartera). */
  spawn(px: number, py: number, totalValue: number): number
  /** Un frame de física + imán + recogida. Devuelve el oro absorbido este frame. */
  step(w: number, h: number, mouse: Attractor, bot: Attractor): number
  draw(ctx: CanvasRenderingContext2D): void
  /** Vacía el sistema devolviendo el valor restante (p.ej. al desmontar la fase). */
  drain(): number
}

export function createNuggetSystem(over?: Partial<NuggetCfg>): NuggetSystem {
  const cfg: NuggetCfg = { ...DEFAULT_NUGGET_CFG, ...over }
  let list: Nugget[] = []

  const spawn = (px: number, py: number, totalValue: number): number => {
    let K = clamp(3 + Math.floor(totalValue / 4), cfg.kMin, cfg.kMax)
    K = Math.max(1, Math.min(K, totalValue))        // cada nugget vale ≥1
    const base = Math.floor(totalValue / K)
    for (let i = 0; i < K; i++) {
      const value = i === K - 1 ? totalValue - base * (K - 1) : base // resto al último → suma exacta
      list.push({
        x: px + rand(-6, 6),
        y: py + rand(-6, 6),
        vx: rand(cfg.spawnVx[0], cfg.spawnVx[1]),
        vy: rand(cfg.spawnVy[0], cfg.spawnVy[1]),
        value,
        rot: rand(0, Math.PI * 2),
        rotV: rand(-0.25, 0.25),
        collecting: false,
        flash: 1,   // pop de escala/brillo al nacer (decae en step)
      })
    }
    // cap: auto-absorbe los más antiguos (su valor NO se pierde)
    let absorbed = 0
    while (list.length > cfg.maxNuggets) absorbed += list.shift()!.value
    return absorbed
  }

  const step = (w: number, h: number, mouse: Attractor, bot: Attractor): number => {
    let absorbed = 0
    const survivors: Nugget[] = []
    for (const n of list) {
      if (n.flash > 0.02) n.flash *= 0.88
      // elegir atractor: ratón (imán) tiene prioridad, si no el bot
      let ax: number | null = null, ay = 0
      if (mouse) {
        const d = Math.hypot(n.x - mouse.x, n.y - mouse.y)
        if (d < (n.collecting ? mouse.r * 1.4 : mouse.r)) { ax = mouse.x; ay = mouse.y }
      }
      if (ax === null && bot) {
        const d = Math.hypot(n.x - bot.x, n.y - bot.y)
        if (d < (n.collecting ? bot.r * 1.4 : bot.r)) { ax = bot.x; ay = bot.y }
      }

      if (ax !== null) {
        n.collecting = true
        const dx = ax - n.x, dy = ay - n.y, d = Math.hypot(dx, dy) || 1
        n.vx += (dx / d) * cfg.pullAccel; n.vy += (dy / d) * cfg.pullAccel
        const sp = Math.hypot(n.vx, n.vy)
        if (sp > cfg.maxPull) { n.vx = (n.vx / sp) * cfg.maxPull; n.vy = (n.vy / sp) * cfg.maxPull }
        n.x += n.vx; n.y += n.vy
        if (d < cfg.absorbDist) {                    // absorbido → suma oro
          absorbed += n.value
          continue
        }
      } else {
        n.collecting = false
        n.vy += cfg.gravity
        n.x += n.vx; n.y += n.vy
        if (n.x < cfg.r) { n.x = cfg.r; n.vx = -n.vx * cfg.floorDamp }
        else if (n.x > w - cfg.r) { n.x = w - cfg.r; n.vx = -n.vx * cfg.floorDamp }
        const floorY = h - cfg.r
        if (n.y > floorY) {
          n.y = floorY; n.vy = -n.vy * cfg.floorDamp; n.vx *= cfg.hFriction
          if (Math.abs(n.vy) < cfg.settleV) n.vy = 0
        } else if (n.y < cfg.r) { n.y = cfg.r; n.vy = -n.vy * cfg.floorDamp }
        n.rot += n.rotV
      }
      survivors.push(n)
    }
    list = survivors
    sys.list = list
    return absorbed
  }

  const draw = (ctx: CanvasRenderingContext2D) => {
    for (const n of list) drawNugget(ctx, n, cfg.r)
  }

  const drain = (): number => {
    let v = 0
    for (const n of list) v += n.value
    list = []
    sys.list = list
    return v
  }

  const sys: NuggetSystem = { list, spawn, step, draw, drain }
  return sys
}

/* ---- dibujo de un nugget (oro con brillo y rotación) ---- */
function drawNugget(ctx: CanvasRenderingContext2D, n: Nugget, r: number) {
  ctx.save()
  ctx.translate(n.x, n.y)
  ctx.rotate(n.rot)
  if (n.flash > 0.02) ctx.scale(1 + n.flash * 0.9, 1 + n.flash * 0.9)
  if (n.collecting) { ctx.shadowColor = '#ffe066'; ctx.shadowBlur = 12 }
  // cuerpo
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fillStyle = n.collecting ? '#ffe680' : n.flash > 0.3 ? '#fff3bf' : '#f5c518'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#b8860b'
  ctx.stroke()
  // brillo
  ctx.beginPath()
  ctx.arc(-r * 0.32, -r * 0.32, r * 0.34, 0, Math.PI * 2)
  ctx.fillStyle = '#fffde0cc'
  ctx.fill()
  ctx.restore()
}

/* ---- anillo del imán bajo el ratón ---- */
export function drawMagnetRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.strokeStyle = '#f472b655'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 4])
  ctx.stroke()
  ctx.setLineDash([])
}

/* ============================================================================
 * Bot recolector (persecución de nuggets / deambulación). El auto-tiro idle
 * es lógica de tiro de cada fase y NO vive aquí.
 * ========================================================================== */

export const BOT_SPEED = 3.2       // velocidad máx de desplazamiento del bot
export const BOT_ACCEL = 0.45

export function createBot(x: number, y: number): Bot {
  return { x, y, vx: 0, vy: 0, wx: x, wy: y }
}

export function stepBot(
  b: Bot, targets: Nugget[], w: number, h: number, r: number,
  speed = BOT_SPEED, accel = BOT_ACCEL,
) {
  let best: Nugget | null = null, bd = Infinity
  for (const n of targets) { const d = Math.hypot(n.x - b.x, n.y - b.y); if (d < bd) { bd = d; best = n } }
  let tx: number, ty: number
  if (best) { tx = best.x; ty = best.y }
  else {
    if (Math.hypot(b.x - b.wx, b.y - b.wy) < 24) { b.wx = rand(w * 0.15, w * 0.85); b.wy = rand(h * 0.55, h * 0.92) }
    tx = b.wx; ty = b.wy
  }
  const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1
  b.vx += (dx / d) * accel; b.vy += (dy / d) * accel
  const sp = Math.hypot(b.vx, b.vy)
  if (sp > speed) { b.vx = (b.vx / sp) * speed; b.vy = (b.vy / sp) * speed }
  b.x = clamp(b.x + b.vx, r, w - r); b.y = clamp(b.y + b.vy, r, h - r)
}

/* ---- dibujo del bot recolector + halo de su radio ---- */
export function drawBot(ctx: CanvasRenderingContext2D, b: Bot, r: number, time: number) {
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
