/* SFX sintetizados con Web Audio — sin assets: cada efecto es un mini-patch de
 * osciladores + ruido filtrado, con sus diales aquí arriba.
 * - El mute vive en store.hot.muted (persiste en el save); play() lo consulta en vivo.
 * - El AudioContext se desbloquea con el primer gesto del usuario (unlockAudio desde App).
 * - gate() limita la cadencia por tipo de sonido: barrer 30 monedas suena a "puñado"
 *   con pitch ascendente, no a clipping. */

import { hot } from './store'

const MASTER_VOL = 0.5
const COIN_GAP_MS = 38        // mínimo entre clinks
const COIN_LADDER_RESET = 350 // ms sin recoger → la escalera de pitch vuelve a empezar
const COIN_LADDER_MAX = 14    // peldaños (semitonos ×2) de la escalera

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = MASTER_VOL
    master.connect(ctx.destination)
    // 1s de ruido blanco reutilizable para whooshes/golpes
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__sfxDebug = { get ctx() { return ctx }, get master() { return master } }
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Llamar en el primer gesto del usuario (los navegadores bloquean el audio hasta entonces). */
export function unlockAudio() { ensureCtx() }

const lastPlay: Record<string, number> = {}
function gate(key: string, minGapMs: number): boolean {
  const now = performance.now()
  if (now - (lastPlay[key] ?? 0) < minGapMs) return false
  lastPlay[key] = now
  return true
}

type BlipOpts = { type?: OscillatorType; gain?: number; delay?: number; slideTo?: number }
function blip(freq: number, dur: number, opts: BlipOpts = {}) {
  if (hot.muted) return
  const c = ensureCtx()
  if (!c || !master) return
  const t0 = c.currentTime + (opts.delay ?? 0)
  const osc = c.createOscillator()
  osc.type = opts.type ?? 'triangle'
  osc.frequency.setValueAtTime(freq, t0)
  if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(opts.gain ?? 0.16, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  g.connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

type NoiseOpts = { gain?: number; delay?: number; q?: number; slideTo?: number; filter?: BiquadFilterType }
function noiseBurst(freq: number, dur: number, opts: NoiseOpts = {}) {
  if (hot.muted) return
  const c = ensureCtx()
  if (!c || !master || !noiseBuf) return
  const t0 = c.currentTime + (opts.delay ?? 0)
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  const f = c.createBiquadFilter()
  f.type = opts.filter ?? 'bandpass'
  f.frequency.setValueAtTime(freq, t0)
  if (opts.slideTo) f.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur)
  f.Q.value = opts.q ?? 1
  const g = c.createGain()
  g.gain.setValueAtTime(opts.gain ?? 0.12, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f)
  f.connect(g)
  g.connect(master)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
}

// --- escalera de pitch de las monedas (se resetea tras una pausa) ---
let coinStep = 0
let lastCoinAt = 0

export const sfx = {
  /* ---- compartidos ---- */
  coin() {
    const now = performance.now()
    if (now - lastCoinAt > COIN_LADDER_RESET) coinStep = 0
    if (!gate('coin', COIN_GAP_MS)) return
    lastCoinAt = now
    const f = 740 * 2 ** ((coinStep * 2) / 12)
    coinStep = Math.min(coinStep + 1, COIN_LADDER_MAX)
    blip(f, 0.07, { type: 'triangle', gain: 0.10 })
    blip(f * 1.5, 0.05, { type: 'sine', gain: 0.06, delay: 0.012 })
  },
  buy() {
    if (!gate('buy', 80)) return
    blip(520, 0.07, { type: 'square', gain: 0.07 })
    blip(780, 0.10, { type: 'square', gain: 0.07, delay: 0.07 })
  },
  victory() {
    if (!gate('victory', 1000)) return
    const notes = [523, 659, 784, 1046, 1318]
    notes.forEach((n, i) => blip(n, 0.28, { type: 'triangle', gain: 0.14, delay: i * 0.11 }))
    noiseBurst(1800, 0.9, { gain: 0.05, q: 0.6, slideTo: 3500 })
  },

  /* ---- portería ---- */
  kick() {
    if (!gate('kick', 60)) return
    noiseBurst(750, 0.13, { gain: 0.12, q: 0.9, slideTo: 280 })
  },
  goal(quiet = false) {
    if (!gate('goal', 70)) return
    const g = quiet ? 0.05 : 0.13
    blip(660, 0.09, { type: 'triangle', gain: g })
    blip(880, 0.13, { type: 'triangle', gain: g, delay: 0.07 })
  },
  escuadra() {
    if (!gate('goal', 70)) return
    ;[523, 659, 784, 1046].forEach((n, i) => blip(n, 0.16, { type: 'triangle', gain: 0.13, delay: i * 0.055 }))
    noiseBurst(1200, 0.45, { gain: 0.06, q: 0.7, slideTo: 2600 })
  },
  parada() {
    if (!gate('miss', 70)) return
    blip(130, 0.13, { type: 'sine', gain: 0.22, slideTo: 70 })
    noiseBurst(350, 0.10, { gain: 0.12, filter: 'lowpass' })
  },
  fuera() {
    if (!gate('miss', 70)) return
    blip(420, 0.18, { type: 'sine', gain: 0.08, slideTo: 190 })
  },

  /* ---- cancha ---- */
  throwBall() {
    if (!gate('kick', 60)) return
    noiseBurst(900, 0.16, { gain: 0.10, q: 0.8, slideTo: 400 })
  },
  swish(combo = 0) {
    if (!gate('goal', 70)) return
    noiseBurst(2400, 0.22, { gain: 0.14, q: 0.6, slideTo: 900 })          // la red
    const base = 880 * 2 ** (Math.min(combo, 6) / 12)                      // la racha sube el tono
    blip(base, 0.12, { type: 'triangle', gain: 0.12, delay: 0.05 })
    blip(base * 1.25, 0.16, { type: 'triangle', gain: 0.12, delay: 0.12 })
  },
  basket(quiet = false) {
    if (!gate('goal', 70)) return
    const g = quiet ? 0.05 : 0.11
    noiseBurst(1800, 0.14, { gain: g * 0.7, q: 0.7, slideTo: 800 })
    blip(740, 0.11, { type: 'triangle', gain: g, delay: 0.04 })
  },
  rim() {
    if (!gate('miss', 70)) return
    blip(225, 0.09, { type: 'square', gain: 0.10, slideTo: 180 })
    noiseBurst(500, 0.07, { gain: 0.07, filter: 'highpass' })
  },
  tapon() {
    if (!gate('miss', 70)) return
    noiseBurst(280, 0.12, { gain: 0.2, filter: 'lowpass' })
    blip(95, 0.12, { type: 'sine', gain: 0.18, slideTo: 55 })
  },
  chargeStart() {
    if (!gate('charge', 120)) return
    blip(330, 0.05, { type: 'sine', gain: 0.05 })
  },
}
