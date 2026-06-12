/* [GLX.1] Constelación de la CANCHA: estrellas + selectores de balance.
 * Mismo patrón que porteria/galaxy.ts: selectores aquí, sin React ni ciclos.
 *
 * Niveles GORDOS: Muñeca y Finta pasan a 3 saltos caros con tabla de efecto;
 * `fromLegacy` convierte el save viejo a efecto equivalente o mejor.
 * Topología provisional GLX.1 — GLX.4/GLX.5 añaden estrellas reconectando aristas. */

import { SALA_COST, type GalaxyDef, type StarDef } from '../../core/galaxy'

/* ============================================================================
 * DIALES DE BALANCE
 * ========================================================================== */

// Muñeca: factor del sweet spot por nivel (antes +10%/lv cap +80%) — 3 saltos, mismo cap
const MUNECA_TABLE = [1, 1.3, 1.6, 1.8]
// Finta: prob. de esquivar tapón por nivel (antes 8%/lv cap 60%) — 3 saltos, mismo cap
const FINTA_TABLE = [0, 0.25, 0.45, 0.6]
// Imán del ratón
const MAGNET_BASE = 34
const MAGNET_STEP = 20
// Mascota (cadencia de tiros libres)
const FT_BASE_MS = 2000
const FT_DECAY = 0.9
export const FT_FLOOR_MS = 700

export type BKey = 'tiro' | 'muneca' | 'triple' | 'combo' | 'finta' | 'zapas' | 'iman' | 'mascota'
export type Levels = Record<BKey, number>

const KEYS: BKey[] = ['tiro', 'muneca', 'triple', 'combo', 'finta', 'zapas', 'iman', 'mascota']

export const readLevels = (raw: Record<string, number>): Levels => {
  const l = {} as Levels
  for (const k of KEYS) l[k] = raw[k] ?? 0
  return l
}

/* ---- selectores derivados (funciones puras de los niveles) ---- */
export const tiroBase = (l: Levels) => 1 + l.tiro
export const sweetFactor = (l: Levels) => MUNECA_TABLE[Math.min(MUNECA_TABLE.length - 1, l.muneca)]
export const tripleMult = (l: Levels) => 3 + l.triple * 1.5
export const comboStep = (l: Levels) => l.combo > 0 ? 0.25 : 0      // +0.25× por swish consecutivo
export const comboCap = (l: Levels) => l.combo > 0 ? 1 + l.combo : 0 // máx swishes apilables
export const fintaDodge = (l: Levels) => FINTA_TABLE[Math.min(FINTA_TABLE.length - 1, l.finta)]
export const bonusCancha = (l: Levels) => 1 + l.zapas * 0.25
export const magnetR = (l: Levels) => MAGNET_BASE + l.iman * MAGNET_STEP
export const ftMs = (l: Levels) =>
  Math.max(FT_FLOOR_MS, Math.round(FT_BASE_MS * FT_DECAY ** Math.max(0, l.mascota - 1)))

/** [CORE.2] Tasa offline de la Mascota en oro/ms (0 sin mascota). */
export const offlineRateBasket = (raw: Record<string, number>): number => {
  const l = readLevels(raw)
  if (l.mascota < 1) return 0
  return Math.max(1, Math.round(tiroBase(l) * bonusCancha(l))) / ftMs(l)
}

/* ============================================================================
 * Constelación
 * ========================================================================== */

export const SALA3_ID = 'sala3'

const lvOf = (raw: Record<string, number>, k: string) => raw[k] ?? 0
const pct = (v: number) => Math.round((v - 1) * 100)

const STARS: StarDef[] = [
  {
    id: 'tiro', name: 'Tiro potente', color: '#60a5fa', base: 10, growth: 1.12, maxLv: 50,
    x: 50, y: 56, edges: ['muneca', 'combo', 'zapas'],
    desc: (lv) => `oro base ${1 + lv} → ${2 + lv}`,
  },
  {
    id: 'muneca', name: 'Muñeca', color: '#34d399', base: 200, growth: 3.0, maxLv: 3,
    x: 32, y: 42, edges: ['triple'],
    desc: (lv) => lv >= 3
      ? `sweet spot +${pct(MUNECA_TABLE[3])}% (cap)`
      : `sweet spot +${pct(MUNECA_TABLE[lv])}% → +${pct(MUNECA_TABLE[lv + 1])}%`,
    // viejo: +10%/lv cap +80% → tramo equivalente o mejor
    fromLegacy: (old) => { const v = lvOf(old, 'muneca'); return v >= 7 ? 3 : v >= 4 ? 2 : v >= 1 ? 1 : 0 },
  },
  {
    id: 'triple', name: 'Triple letal', color: '#ffd23f', base: 80, growth: 1.18, maxLv: 5,
    x: 22, y: 24, edges: [SALA3_ID],
    desc: (lv) => `triple ×${3 + lv * 1.5} → ×${3 + (lv + 1) * 1.5}`,
  },
  {
    id: 'combo', name: 'En racha', color: '#ff8c42', base: 150, growth: 1.22, maxLv: 10,
    x: 68, y: 42, edges: ['finta'],
    desc: (lv) => lv === 0 ? 'activa racha: swishes seguidos +25% c/u' : `racha máx ×${1 + lv} → ×${2 + lv}`,
  },
  {
    id: 'finta', name: 'Finta', color: '#a78bfa', base: 250, growth: 3.0, maxLv: 3,
    x: 80, y: 27, edges: ['mascota'],
    desc: (lv) => lv >= 3
      ? `esquiva tapones ${FINTA_TABLE[3] * 100}% (cap)`
      : `esquiva tapones ${FINTA_TABLE[lv] * 100}% → ${FINTA_TABLE[lv + 1] * 100}%`,
    // viejo: 8%/lv cap 60% → tramo equivalente o mejor
    fromLegacy: (old) => { const v = lvOf(old, 'finta'); return v >= 6 ? 3 : v >= 3 ? 2 : v >= 1 ? 1 : 0 },
  },
  {
    id: 'mascota', name: 'Mascota', color: '#f87171', base: 500, growth: 1.20, maxLv: 8,
    x: 66, y: 12, edges: [SALA3_ID],
    desc: (lv) => {
      if (lv === 0) return 'activa mascota 🐧 (tiros libres automáticos)'
      const cur = ftMs(readLevels({ mascota: lv }))
      const nxt = ftMs(readLevels({ mascota: lv + 1 }))
      return `TL cada ${cur}ms${cur <= FT_FLOOR_MS ? ' (suelo)' : ` → ${nxt}ms`}`
    },
  },
  {
    id: 'zapas', name: 'Zapas pro', color: '#fbbf24', base: 250, growth: 1.23, maxLv: 10,
    x: 36, y: 74, edges: ['iman'],
    desc: (lv) => `oro global +${lv * 25}% → +${(lv + 1) * 25}%`,
  },
  {
    id: 'iman', name: 'Imán', color: '#f472b6', base: 30, growth: 1.10, maxLv: 10,
    x: 52, y: 86, edges: [],
    desc: (lv) => `radio ${MAGNET_BASE + lv * MAGNET_STEP}px → ${MAGNET_BASE + (lv + 1) * MAGNET_STEP}px`,
  },
  {
    id: SALA3_ID, name: '⭐ SALA 3', color: '#fbbf24', base: SALA_COST, growth: 1, maxLv: 1,
    x: 42, y: 9, edges: [], sala: true,
    desc: (lv) => lv >= 1 ? 'cancha dominada — partida ganada 🏆' : 'gana la zona (la Sala 3 llegará)',
  },
]

export const GALAXY_BASKET: GalaxyDef = {
  phase: 'basket',
  title: '🏀 TIENDA · CANCHA',
  centerId: 'tiro',
  stars: STARS,
}
