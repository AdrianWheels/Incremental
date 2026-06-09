/* Sistema compartido de nuggets (física + imán + recogida).
 * El orden de integración (acelerar → clamp velocidad → mover → absorber con la
 * distancia pre-movimiento) es parte del game feel validado: no "mejorar de paso".
 * El ÚNICO recolector es el imán del ratón (decisión de diseño [BOT.1]): el oro se
 * acumula en el suelo y, al superar el cap, los nuggets asentados se FUSIONAN en
 * pilas de mayor valor (tier 0-3) — nunca se absorbe solo.
 * Pensado para llamarse desde el bucle rAF de cada fase: cero asignaciones extra por frame. */

import { rand, clamp } from './utils'

export type Nugget = {
  x: number; y: number; vx: number; vy: number
  value: number; rot: number; rotV: number
  collecting: boolean; flash: number
  tier: number   // 0 = nugget suelto; 1-3 = pila fusionada (se dibuja como monedas apiladas)
}
export type Attractor = { x: number; y: number; r: number } | null

export type NuggetCfg = {
  r: number
  gravity: number
  floorDamp: number      // amortiguación al rebotar
  hFriction: number      // fricción horizontal al tocar suelo
  settleV: number        // por debajo de esto, se asienta
  maxNuggets: number     // cap en pantalla (al superarlo, fusiona los asentados más antiguos)
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
   *  Devuelve el oro auto-absorbido SOLO si el cap no pudo fusionar (caso raro: nada asentado). */
  spawn(px: number, py: number, totalValue: number): number
  /** Un frame de física + imán + recogida. Devuelve el oro absorbido este frame. */
  step(w: number, h: number, mouse: Attractor): number
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
        tier: 0,
      })
    }
    // cap: FUSIONA los dos asentados más antiguos en una pila (el valor NO se pierde
    // ni se recoge solo). Fallback rarísimo (nada asentado): absorbe el más antiguo.
    let absorbed = 0
    while (list.length > cfg.maxNuggets) {
      let i = -1, j = -1
      for (let k = 0; k < list.length; k++) {
        const n = list[k]
        if (!n.collecting && n.vy === 0) { if (i < 0) i = k; else { j = k; break } }
      }
      if (i >= 0 && j >= 0) {
        const a = list[i], b = list[j]
        a.value += b.value
        a.tier = Math.min(3, Math.max(a.tier, b.tier) + 1)
        a.flash = 1
        list.splice(j, 1)
      } else {
        absorbed += list.shift()!.value
      }
    }
    return absorbed
  }

  const step = (w: number, h: number, mouse: Attractor): number => {
    let absorbed = 0
    const survivors: Nugget[] = []
    for (const n of list) {
      if (n.flash > 0.02) n.flash *= 0.88
      // único atractor: el imán del ratón
      let ax: number | null = null, ay = 0
      if (mouse) {
        const d = Math.hypot(n.x - mouse.x, n.y - mouse.y)
        if (d < (n.collecting ? mouse.r * 1.4 : mouse.r)) { ax = mouse.x; ay = mouse.y }
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

/* ---- dibujo de un nugget: moneda suelta (tier 0, rota) o pila de monedas (tier 1-3) ---- */
function drawNugget(ctx: CanvasRenderingContext2D, n: Nugget, r: number) {
  ctx.save()
  ctx.translate(n.x, n.y)
  if (n.flash > 0.02) ctx.scale(1 + n.flash * 0.9, 1 + n.flash * 0.9)
  if (n.collecting) { ctx.shadowColor = '#ffe066'; ctx.shadowBlur = 12 }
  const fill = n.collecting ? '#ffe680' : n.flash > 0.3 ? '#fff3bf' : '#f5c518'
  if (n.tier === 0) {
    ctx.rotate(n.rot)
    drawCoin(ctx, 0, 0, r, fill)
  } else {
    // pila: monedas de abajo arriba, ligeramente desplazadas (jitter determinista por rot)
    const rr = r * (1 + n.tier * 0.22)
    const coins = n.tier + 1
    for (let k = 0; k < coins; k++) {
      const jx = Math.sin(n.rot * 7 + k * 2.4) * rr * 0.18
      drawCoin(ctx, jx, -k * rr * 0.72, rr, fill)
    }
  }
  ctx.restore()
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#b8860b'
  ctx.stroke()
  // brillo
  ctx.beginPath()
  ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.34, 0, Math.PI * 2)
  ctx.fillStyle = '#fffde0cc'
  ctx.fill()
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

