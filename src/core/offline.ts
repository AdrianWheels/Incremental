/* [CORE.2] Progreso offline real: al volver tras cerrar la pestaña se estima lo que el
 * bot de cada fase habría producido en la ausencia (Date.now() del último autosave vs ahora)
 * y se acredita con eficiencia <100% y un cap de horas.
 * Las tasas (oro/ms) son identidad de cada fase y viven en su galaxy.ts [GLX.1]. */

import { hot, type PhaseId } from './store'
import { offlineRatePorteria } from '../phases/porteria/galaxy'
import { offlineRateBasket } from '../phases/basket/galaxy'

/* ============================================================================
 * DIALES DE BALANCE
 * ========================================================================== */

const OFFLINE_EFF = 0.5              // eficiencia offline: el bot rinde al 50% sin nadie mirando
const OFFLINE_CAP_MS = 8 * 3_600_000 // tope de ausencia acreditable (8h)
const OFFLINE_MIN_MS = 60_000        // ausencias < 1min no cuentan (evita banner en recargas)

const RATES: Record<PhaseId, (levels: Record<string, number>) => number> = {
  porteria: offlineRatePorteria,
  basket: offlineRateBasket,
}

export type OfflineGain = {
  awayMs: number                                 // tiempo ausente YA capado
  total: number                                  // oro total acreditado
  byPhase: { phase: PhaseId; gold: number }[]    // desglose (solo fases con bot)
}

let pending: OfflineGain | null = null

/** Ganancia de esta sesión para el banner (no se consume: el banner decide cuándo ocultarse). */
export const getOfflineGain = (): OfflineGain | null => pending

/** Calcula y ACREDITA la ganancia offline en hot. Llamar UNA vez tras loadSave(),
 *  antes del primer render (no hace falta commit: aún no hay suscriptores). */
export function applyOfflineProgress(lastSeen: number | null, now = Date.now()): OfflineGain | null {
  if (lastSeen === null || now <= lastSeen) return null // sin save previo o reloj retrasado
  const awayMs = Math.min(now - lastSeen, OFFLINE_CAP_MS)
  if (awayMs < OFFLINE_MIN_MS) return null

  const byPhase: OfflineGain['byPhase'] = []
  let total = 0
  for (const phase of hot.unlocked) {
    const ph = hot.phases[phase]
    const gold = Math.floor(RATES[phase](ph.levels) * awayMs * OFFLINE_EFF)
    if (gold <= 0) continue
    ph.gold += gold
    ph.total += gold
    byPhase.push({ phase, gold })
    total += gold
  }
  if (total <= 0) return null // sin bots comprados: no hay idle offline

  pending = { awayMs, total, byPhase }
  return pending
}

/** Formatea la ausencia para el banner: "5m", "1h 23m", "2d 4h". */
export function formatAway(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
