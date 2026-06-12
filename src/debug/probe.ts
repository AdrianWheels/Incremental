/* [BAL.1] Sonda dev: las fases publican aquí sus sistemas internos (refs privadas
 * del componente) para que la telemetría pueda leerlos sin acoplarse al render.
 * Módulo sin imports de fases a propósito — rompe el ciclo fase ↔ telemetría.
 * Coste cero en producción: escribir una ref por montaje de fase. */

import type { NuggetSystem } from '../core/nuggets'
import type { PhaseId } from '../core/store'

export const probeNuggets: Partial<Record<PhaseId, NuggetSystem>> = {}
