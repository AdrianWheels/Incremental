/* Persistencia en localStorage, versionada y defensiva.
 * Un save corrupto NUNCA rompe el arranque: se respalda en otra key y se arranca limpio. */

import { hot, setCommitHook, type PhaseId, type PhaseHot } from './store'

const SAVE_KEY = 'incremental.save'
const CORRUPT_KEY = 'incremental.save.corrupt'
const PHASE_IDS: PhaseId[] = ['porteria', 'basket']

export type SaveV1 = {
  schemaVersion: 1
  unlocked: PhaseId[]
  activePhase: PhaseId
  phases: Record<PhaseId, { gold: number; total: number; levels: Record<string, number>; goles: number; fallos: number }>
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPhaseId = (v: unknown): v is PhaseId => PHASE_IDS.includes(v as PhaseId)

function hydratePhase(target: PhaseHot, raw: unknown) {
  if (typeof raw !== 'object' || raw === null) return
  const r = raw as Record<string, unknown>
  if (isNum(r.gold) && r.gold >= 0) target.gold = r.gold
  if (isNum(r.total) && r.total >= 0) target.total = r.total
  if (isNum(r.goles) && r.goles >= 0) target.goles = r.goles
  if (isNum(r.fallos) && r.fallos >= 0) target.fallos = r.fallos
  if (typeof r.levels === 'object' && r.levels !== null) {
    for (const [k, v] of Object.entries(r.levels as Record<string, unknown>)) {
      if (isNum(v) && v >= 0) target.levels[k] = Math.floor(v)
    }
  }
}

/** Hidrata store.hot desde localStorage. Llamar UNA vez, antes del primer render. */
export function loadSave(): void {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as Partial<SaveV1>
    if (data.schemaVersion !== 1) throw new Error(`schemaVersion desconocida: ${data.schemaVersion}`)

    for (const id of PHASE_IDS) hydratePhase(hot.phases[id], data.phases?.[id])

    if (Array.isArray(data.unlocked)) {
      for (const p of data.unlocked) {
        if (isPhaseId(p) && !hot.unlocked.includes(p)) hot.unlocked.push(p)
      }
    }
    if (isPhaseId(data.activePhase) && hot.unlocked.includes(data.activePhase)) {
      hot.activePhase = data.activePhase
    }
  } catch (err) {
    console.warn('[save] save corrupto — respaldado y reseteado:', err)
    try {
      if (raw) localStorage.setItem(CORRUPT_KEY, raw)
      localStorage.removeItem(SAVE_KEY)
    } catch { /* storage lleno/bloqueado: seguimos con el estado por defecto */ }
  }
}

export function writeSave(): void {
  const data: SaveV1 = {
    schemaVersion: 1,
    unlocked: hot.unlocked,
    activePhase: hot.activePhase,
    phases: hot.phases,
  }
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)) } catch { /* storage no disponible */ }
}

/** Autosave: en cada commit (compra/desbloqueo/cambio de fase) + cada 2s (el JSON es
 *  minúsculo, no hace falta dirty flag) + al cerrar la pestaña. Devuelve el cleanup. */
export function initPersistence(): () => void {
  setCommitHook(writeSave)
  const id = window.setInterval(writeSave, 2000)
  window.addEventListener('beforeunload', writeSave)
  return () => {
    window.clearInterval(id)
    window.removeEventListener('beforeunload', writeSave)
  }
}
