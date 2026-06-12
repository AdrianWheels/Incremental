/* [GLX.1] Motor de la galaxia de mejoras: tipos + reglas puras (sin React).
 * Cada fase define su constelación en src/phases/<fase>/galaxy.ts; este módulo
 * solo sabe de grafos: qué estrella se puede comprar y qué se ve de cada una.
 *
 * Regla de desbloqueo (decisión de diseño, ver "Galaxia de mejoras - Diseño"):
 * comprable = es el centro, o alguna vecina tiene nivel ≥ 1.
 * Visibilidad: comprada > comprable > vecina-con-nombre (apagada) > punto borroso.
 * La ⭐ de Sala (sala: true) es la excepción: SIEMPRE visible con su precio. */

import { costOf, type UpgradeDef } from './economy'
import { hot, buyUpgrade, type PhaseId } from './store'

export const SALA_COST = 1_000_000 // la pared: comprarla = ganar la zona + desbloquear la siguiente

export type StarDef = UpgradeDef & {
  id: string
  x: number; y: number          // posición en el lienzo de la galaxia (0-100)
  maxLv: number                 // 1 = compra única
  edges: string[]               // vecinas (basta declarar cada arista en una dirección)
  desc: (lv: number) => string  // efecto "actual → siguiente" para la tarjeta de compra
  sala?: boolean                // estrella de sala: compra única que gana la zona
  /** Conversión one-shot de niveles del save anterior a la galaxia (mismo efecto o mejor). */
  fromLegacy?: (old: Record<string, number>, unlocked: PhaseId[]) => number
}

export type GalaxyDef = {
  phase: PhaseId
  title: string
  centerId: string
  stars: StarDef[]
}

export type StarState = 'owned' | 'unlocked' | 'named' | 'far'

export const starLevel = (levels: Record<string, number>, id: string) => levels[id] ?? 0

/** Vecindad no dirigida (las aristas se declaran en una sola dirección). */
export function neighborsOf(def: GalaxyDef, id: string): string[] {
  const out: string[] = []
  for (const s of def.stars) {
    if (s.id === id) out.push(...s.edges)
    else if (s.edges.includes(id)) out.push(s.id)
  }
  return out
}

/** Estado de TODAS las estrellas de una pasada (la UI lo pide entero en cada render frío). */
export function starStates(def: GalaxyDef, levels: Record<string, number>): Record<string, StarState> {
  const states: Record<string, StarState> = {}
  for (const s of def.stars) states[s.id] = 'far'

  const markNeighbors = (id: string, st: StarState) => {
    for (const n of neighborsOf(def, id)) {
      if (rank(st) > rank(states[n] ?? 'far')) states[n] = st
    }
  }
  // 1ª pasada: compradas + el centro siempre comprable
  for (const s of def.stars) if (starLevel(levels, s.id) >= 1) states[s.id] = 'owned'
  if (rank(states[def.centerId]) < rank('unlocked')) states[def.centerId] = 'unlocked'
  // 2ª: vecinas de compradas → comprables
  for (const s of def.stars) if (states[s.id] === 'owned') markNeighbors(s.id, 'unlocked')
  // 3ª: vecinas de la frontera comprable → con nombre (apagadas)
  for (const s of def.stars) if (states[s.id] === 'unlocked' || states[s.id] === 'owned') markNeighbors(s.id, 'named')
  return states
}

const RANK: Record<StarState, number> = { far: 0, named: 1, unlocked: 2, owned: 3 }
const rank = (s: StarState) => RANK[s]

export const starCost = (star: StarDef, lv: number) => costOf(star, lv)

/** Compra un nivel de la estrella (valida cap; el coste/oro lo valida buyUpgrade). */
export function buyStar(phase: PhaseId, star: StarDef): boolean {
  if (starLevel(hot.phases[phase].levels, star.id) >= star.maxLv) return false
  return buyUpgrade(phase, star.id, star)
}

/* ============================================================================
 * Migración one-shot del save pre-galaxia [GLX.1]
 * ========================================================================== */

/** Marca de migración dentro de `levels` (el save tolera keys extra; la UI y la
 *  telemetría ignoran las que empiezan por '_'). */
export const GLX_MIGRATED_KEY = '_glx'

/** Reinterpreta los niveles del save viejo según `fromLegacy` de cada estrella.
 *  Idempotente (marca `_glx`); leer-todo-luego-escribir para no pisar entradas. */
export function migrateGalaxy(def: GalaxyDef, levels: Record<string, number>, unlocked: PhaseId[]): void {
  if ((levels[GLX_MIGRATED_KEY] ?? 0) >= 1) return
  const converted: [string, number][] = []
  for (const s of def.stars) {
    const v = s.fromLegacy ? s.fromLegacy(levels, unlocked) : Math.min(s.maxLv, levels[s.id] ?? 0)
    converted.push([s.id, Math.max(0, Math.min(s.maxLv, Math.floor(v)))])
  }
  for (const [id, v] of converted) {
    if (v > 0) levels[id] = v
    else delete levels[id]
  }
  levels[GLX_MIGRATED_KEY] = 1
}
