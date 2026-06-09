/* Estado multi-fase: refs calientes compartidas + suscripción fría casera.
 *
 * REGLA DE ORO: el bucle rAF y la recogida de nuggets MUTAN `hot.*` directamente
 * y JAMÁS llaman commit() — un commit() en caliente = re-render a 60fps.
 * commit() se llama SOLO en: comprar mejora, desbloquear fase, cambiar de fase.
 * La UI de alta frecuencia (oro, tally) lee de `hot` con un throttle de ~120ms. */

import { useSyncExternalStore } from 'react'
import { costOf, type UpgradeDef } from './economy'

export type PhaseId = 'porteria' | 'basket'

export type PhaseHot = {
  gold: number                      // oro gastable de la fase
  total: number                     // oro acumulado (meta; no baja al gastar)
  levels: Record<string, number>
  goles: number
  fallos: number
}

const emptyPhase = (): PhaseHot => ({ gold: 0, total: 0, levels: {}, goles: 0, fallos: 0 })

export const hot: {
  phases: Record<PhaseId, PhaseHot>
  unlocked: PhaseId[]
  activePhase: PhaseId
  muted: boolean
} = {
  phases: { porteria: emptyPhase(), basket: emptyPhase() },
  unlocked: ['porteria'],
  activePhase: 'porteria',
  muted: false,
}

let version = 0
const listeners = new Set<() => void>()
let onCommit: (() => void) | null = null

/** save.ts registra aquí su scheduleSave para no crear import circular. */
export const setCommitHook = (fn: () => void) => { onCommit = fn }

export const commit = () => {
  version++
  listeners.forEach((f) => f())
  onCommit?.()
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const getVersion = () => version

/** Re-render SOLO cuando alguien llama commit() (compra / desbloqueo / cambio de fase). */
export const useColdVersion = () => useSyncExternalStore(subscribe, getVersion)

export const isUnlocked = (p: PhaseId) => hot.unlocked.includes(p)

export const unlockPhase = (p: PhaseId) => {
  if (!isUnlocked(p)) { hot.unlocked.push(p); commit() }
}

export const switchPhase = (p: PhaseId) => {
  if (hot.activePhase !== p && isUnlocked(p)) { hot.activePhase = p; commit() }
}

/** Compra robusta ante clics síncronos rápidos: lee SIEMPRE de hot, nunca de closures de React. */
export function buyUpgrade(phase: PhaseId, key: string, def: UpgradeDef): boolean {
  const ph = hot.phases[phase]
  const lv = ph.levels[key] ?? 0
  const c = costOf(def, lv)
  if (ph.gold < c) return false
  ph.gold -= c
  ph.levels[key] = lv + 1
  commit()
  return true
}
