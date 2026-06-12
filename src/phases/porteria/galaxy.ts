/* [GLX.1] Constelación de la PORTERÍA: estrellas + selectores de balance.
 * Los selectores viven aquí (no en GoalPhase.tsx) para que la galaxia, el offline
 * y la telemetría los importen sin ciclos. Todas las constantes de balance, aquí.
 *
 * Niveles GORDOS (decisión de diseño): Cadencia y Mira pasan de muchos +X% a
 * 3 saltos caros que se sienten; `fromLegacy` convierte el save viejo a un
 * nivel de efecto equivalente o ligeramente mejor (nunca peor).
 *
 * Topología provisional GLX.1 (solo estrellas existentes): los brazos del diseño
 * final (Crítico, Combo, Cuerpo técnico, Imán de rebote, cross-fase) se añaden
 * en GLX.3/GLX.5 reconectando aristas — el desbloqueo se recalcula del grafo,
 * el save no se toca. */

import { SALA_COST, type GalaxyDef, type StarDef } from '../../core/galaxy'

/* ============================================================================
 * DIALES DE BALANCE
 * ========================================================================== */

// Cooldown del jugador: 3 niveles gordos (antes: 700×0.92^lv con suelo 250)
const CD_TABLE = [700, 500, 350, 250]
// Zonas: +20% por nivel (antes: +6%/lv cap 60%) — mismo cap, 3 saltos
const MIRA_STEP = 0.20
// Imán del ratón
const MAGNET_BASE = 34
const MAGNET_STEP = 20
// Delantero bot (cadencia de tiro)
const BOT_FIRE_BASE = 1800
const BOT_FIRE_DECAY = 0.9
const BOT_FIRE_FLOOR = 600

export type UpgKey = 'potencia' | 'rosca' | 'botas' | 'cadencia' | 'mira' | 'iman' | 'recolector'
export type Levels = Record<UpgKey, number>

const KEYS: UpgKey[] = ['potencia', 'rosca', 'botas', 'cadencia', 'mira', 'iman', 'recolector']

export const readLevels = (raw: Record<string, number>): Levels => {
  const l = {} as Levels
  for (const k of KEYS) l[k] = raw[k] ?? 0
  return l
}

/* ---- selectores derivados (funciones puras de los niveles) ---- */
export const oroBase = (l: Levels) => 1 + l.potencia
export const bonusGlobal = (l: Levels) => 1 + l.botas * 0.25
export const escuadraMult = (l: Levels) => 4 + l.rosca * 2
export const cooldownMs = (l: Levels) => CD_TABLE[Math.min(CD_TABLE.length - 1, l.cadencia)]
export const zoneScale = (l: Levels) => 1 + Math.min(3, l.mira) * MIRA_STEP
export const magnetR = (l: Levels) => MAGNET_BASE + l.iman * MAGNET_STEP
export const botFireMs = (l: Levels) =>
  Math.max(BOT_FIRE_FLOOR, Math.round(BOT_FIRE_BASE * BOT_FIRE_DECAY ** Math.max(0, l.recolector - 1)))

/** [CORE.2] Tasa offline del Delantero bot en oro/ms (0 sin bot). */
export const offlineRatePorteria = (raw: Record<string, number>): number => {
  const l = readLevels(raw)
  if (l.recolector < 1) return 0
  return Math.max(1, Math.round(oroBase(l) * bonusGlobal(l))) / botFireMs(l)
}

/* ============================================================================
 * Constelación
 * ========================================================================== */

export const SALA2_ID = 'sala2'

const lvOf = (raw: Record<string, number>, k: string) => raw[k] ?? 0
const n = (l: Levels, k: UpgKey): Levels => ({ ...l, [k]: l[k] + 1 })
const withLv = (lv: number, k: UpgKey, fn: (l: Levels) => string) => fn({ ...EMPTY, [k]: lv })
const EMPTY = readLevels({})

const STARS: StarDef[] = [
  {
    id: 'potencia', name: 'Potencia', color: '#60a5fa', base: 10, growth: 1.12, maxLv: 50,
    x: 50, y: 56, edges: ['rosca', 'cadencia', 'mira'],
    desc: (lv) => withLv(lv, 'potencia', (l) => `oro base ${oroBase(l)} → ${oroBase(n(l, 'potencia'))}`),
  },
  {
    id: 'rosca', name: 'Rosca', color: '#ffd23f', base: 60, growth: 1.18, maxLv: 10,
    x: 29, y: 42, edges: ['botas'],
    desc: (lv) => withLv(lv, 'rosca', (l) => `escuadra ×${escuadraMult(l)} → ×${escuadraMult(n(l, 'rosca'))}`),
  },
  {
    id: 'botas', name: 'Botas de oro', color: '#fbbf24', base: 200, growth: 1.23, maxLv: 20,
    x: 39, y: 26, edges: ['cadencia', SALA2_ID], // puente lateral GOLPEO↔RITMO + ruta a la ⭐
    desc: (lv) => `oro global +${lv * 25}% → +${(lv + 1) * 25}%`,
  },
  {
    id: 'cadencia', name: 'Cadencia', color: '#34d399', base: 280, growth: 3.0, maxLv: 3,
    x: 71, y: 42, edges: ['recolector'],
    desc: (lv) => lv >= 3 ? `CD ${CD_TABLE[3]}ms (suelo)` : `CD ${CD_TABLE[lv]}ms → ${CD_TABLE[lv + 1]}ms`,
    // viejo: 700×0.92^lv → equivalencia por CD alcanzado (generosa, nunca peor)
    fromLegacy: (old) => { const v = lvOf(old, 'cadencia'); return v >= 11 ? 3 : v >= 5 ? 2 : v >= 1 ? 1 : 0 },
  },
  {
    id: 'recolector', name: 'Delantero bot', color: '#f87171', base: 500, growth: 1.20, maxLv: 8,
    x: 82, y: 26, edges: [SALA2_ID],
    desc: (lv) => {
      if (lv === 0) return 'activa delantero bot (tira solo al raso ×1)'
      const cur = botFireMs({ ...EMPTY, recolector: lv })
      const nxt = botFireMs({ ...EMPTY, recolector: lv + 1 })
      return `tira cada ${cur}ms${cur <= BOT_FIRE_FLOOR ? ' (suelo)' : ` → ${nxt}ms`}`
    },
  },
  {
    id: 'mira', name: 'Mira amplia', color: '#a78bfa', base: 300, growth: 3.0, maxLv: 3,
    x: 38, y: 74, edges: ['iman'],
    desc: (lv) => {
      const pct = Math.round(Math.min(3, lv) * MIRA_STEP * 100)
      return lv >= 3 ? `zonas +${pct}% (cap)` : `zonas +${pct}% → +${pct + 20}%`
    },
    // viejo: +6%/lv cap 60 → al tramo de 20% más cercano por arriba
    fromLegacy: (old) => Math.min(3, Math.ceil((Math.min(60, lvOf(old, 'mira') * 6)) / 20)),
  },
  {
    id: 'iman', name: 'Imán', color: '#f472b6', base: 30, growth: 1.10, maxLv: 10,
    x: 24, y: 86, edges: [],
    desc: (lv) => `radio ${MAGNET_BASE + lv * MAGNET_STEP}px → ${MAGNET_BASE + (lv + 1) * MAGNET_STEP}px`,
  },
  {
    id: SALA2_ID, name: '⭐ SALA 2', color: '#fbbf24', base: SALA_COST, growth: 1, maxLv: 1,
    x: 60, y: 9, edges: [], sala: true,
    desc: (lv) => lv >= 1 ? 'sala 2 desbloqueada — ¡a la cancha!' : 'desbloquea la CANCHA · ganar la zona',
    // saves pre-galaxia que ya batieron al portero (cancha desbloqueada) la conservan comprada
    fromLegacy: (_old, unlocked) => unlocked.includes('basket') ? 1 : 0,
  },
]

export const GALAXY_PORTERIA: GalaxyDef = {
  phase: 'porteria',
  title: '⚽ TIENDA · PORTERÍA',
  centerId: 'potencia',
  stars: STARS,
}
