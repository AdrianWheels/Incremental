/* [BAL.1] Telemetría de balance — dev-only, se activa añadiendo `?debug` a la URL.
 *
 * Mide lo que hace falta para afinar `base`/`growth` de las mejoras:
 *   - tiempo real de juego hasta batir cada sala, partido en ACTIVO vs IDLE
 *     (activo = hubo input hace <ACTIVE_WINDOW_MS; idle = pestaña visible sin tocar;
 *     pestaña oculta NO cuenta — el rAF está parado y el offline [CORE.2] queda fuera)
 *   - oro/min GENERADO en cada bucket — se muestrea cartera + oro en el suelo:
 *     los bots no recogen [BOT.1], así que mirar solo `total` atribuiría al barrido
 *     del jugador (activo) el oro que el bot generó en idle
 *   - snapshot de niveles de cada mejora en el instante de cruzar la meta
 *
 * Overlay en vivo (abajo-izda) + export a JSON: botones, `window.__telem.export()`,
 * y console.log automático al cruzar la meta. El estado persiste en una clave de
 * localStorage PROPIA (el reloj del run sobrevive a F5 sin tocar el save del juego).
 *
 * Objetivo de diseño a calibrar con estos datos: Sala 1 activa ~8-12 min, idle ~30-40 min.
 */

import { hot, type PhaseId } from '../core/store'
import { formatNum } from '../core/utils'
import { probeNuggets } from './probe'
import { META_GOLD, offlineRatePorteria } from '../phases/porteria/GoalPhase'
import { META_GOLD_BASKET, offlineRateBasket } from '../phases/basket/BasketPhase'

// Diales -----------------------------------------------------------------------
const TICK_MS = 1000            // muestreo del sampler
const ACTIVE_WINDOW_MS = 4000   // input hace <4s = "jugando activo"
const RECENT_WINDOW_MS = 60_000 // ventana del ritmo reciente (ETA)
const LS_KEY = 'incremental.telemetry'

const PHASE_IDS: PhaseId[] = ['porteria', 'basket']
const META: Record<PhaseId, number> = { porteria: META_GOLD, basket: META_GOLD_BASKET }
// tasa teórica del bot en oro/ms (mismas fórmulas que el bucle vivo / offline)
const BOT_RATE: Record<PhaseId, (levels: Record<string, number>) => number> = {
  porteria: offlineRatePorteria,
  basket: offlineRateBasket,
}
const LABEL: Record<PhaseId, string> = { porteria: '⚽ portería', basket: '🏀 cancha' }

// Tipos ------------------------------------------------------------------------
type GoalSnapshot = {
  measured: boolean   // false = la meta YA estaba batida al arrancar la telemetría (run no representativo)
  totalMs: number; activeMs: number; idleMs: number
  activeGold: number; idleGold: number
  levels: Record<string, number>
  goles: number; fallos: number
}
type PhaseStats = {
  activeMs: number; idleMs: number
  activeGold: number; idleGold: number
  goal: GoalSnapshot | null
}
type TelemetryState = { schemaVersion: 1; phases: Record<PhaseId, PhaseStats> }

const emptyStats = (): PhaseStats => ({ activeMs: 0, idleMs: 0, activeGold: 0, idleGold: 0, goal: null })

// Carga defensiva (mismo espíritu que save.ts: un estado corrupto jamás rompe nada)
function loadState(): TelemetryState {
  const fresh: TelemetryState = { schemaVersion: 1, phases: { porteria: emptyStats(), basket: emptyStats() } }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return fresh
    const d = JSON.parse(raw) as Partial<TelemetryState>
    if (d.schemaVersion !== 1 || typeof d.phases !== 'object' || d.phases === null) return fresh
    for (const id of PHASE_IDS) {
      const s = d.phases[id]
      if (typeof s !== 'object' || s === null) continue
      const t = fresh.phases[id]
      for (const k of ['activeMs', 'idleMs', 'activeGold', 'idleGold'] as const) {
        const v = s[k]
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) t[k] = v
      }
      if (typeof s.goal === 'object' && s.goal !== null) t.goal = s.goal
    }
    return fresh
  } catch {
    return fresh
  }
}

/** Punto de entrada (llamar una vez desde main.tsx). Sin `?debug` no instala NADA. */
export function initTelemetry(): void {
  if (!new URLSearchParams(location.search).has('debug')) return

  const state = loadState()
  const rings: Record<PhaseId, { t: number; w: number }[]> = { porteria: [], basket: [] }
  const lastWealth = {} as Record<PhaseId, number>
  let lastInputAt = -Infinity
  let lastTickAt = performance.now()

  // oro generado y aún sin recoger (suelo + en vuelo hacia el imán) de la fase
  const floorGold = (id: PhaseId): number => {
    const sys = probeNuggets[id]
    if (!sys) return 0
    let v = 0
    for (const n of sys.list) v += n.value
    return v
  }
  const wealthOf = (id: PhaseId) => hot.phases[id].total + floorGold(id)

  const snapshotGoal = (id: PhaseId, st: PhaseStats, measured: boolean): GoalSnapshot => ({
    measured,
    totalMs: st.activeMs + st.idleMs, activeMs: st.activeMs, idleMs: st.idleMs,
    activeGold: st.activeGold, idleGold: st.idleGold,
    levels: { ...hot.phases[id].levels },
    goles: hot.phases[id].goles, fallos: hot.phases[id].fallos,
  })

  // baseline post-hidratación (el oro offline [CORE.2] ya está acreditado: no se atribuye)
  for (const id of PHASE_IDS) {
    lastWealth[id] = wealthOf(id)
    const st = state.phases[id]
    if (!st.goal && hot.phases[id].total >= META[id]) {
      st.goal = snapshotGoal(id, st, false)
      console.warn(`[telemetry] meta de ${id} ya batida al iniciar — el tiempo-hasta-meta no es representativo (resetea el save para medir)`)
    }
  }

  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)) } catch { /* storage no disponible */ } }

  const exportData = () => ({
    exportedAt: new Date().toISOString(),
    tickMs: TICK_MS, activeWindowMs: ACTIVE_WINDOW_MS,
    phases: Object.fromEntries(PHASE_IDS.map((id) => {
      const st = state.phases[id]
      const P = hot.phases[id]
      return [id, {
        metaGold: META[id],
        current: { total: P.total, gold: P.gold, goles: P.goles, fallos: P.fallos, levels: { ...P.levels } },
        run: {
          activeMs: Math.round(st.activeMs), idleMs: Math.round(st.idleMs),
          totalMs: Math.round(st.activeMs + st.idleMs),
          activeGold: st.activeGold, idleGold: st.idleGold,
          goldPerMinActive: ratePerMin(st.activeGold, st.activeMs),
          goldPerMinIdle: ratePerMin(st.idleGold, st.idleMs),
          botPerMinTeorico: Math.round(BOT_RATE[id](P.levels) * 60_000),
        },
        goal: st.goal,
      }]
    })),
  })

  const reset = () => {
    for (const id of PHASE_IDS) {
      state.phases[id] = emptyStats()
      rings[id].length = 0
      lastWealth[id] = wealthOf(id)
    }
    persist()
    render(false)
  }

  // expone el export para iterar constantes desde la consola
  ;(window as unknown as Record<string, unknown>).__telem = { export: exportData, reset, state }
  console.info('[telemetry] BAL.1 activa — overlay abajo-izda · window.__telem.export()')

  /* ---- input global: marca "activo" (passive, jamás interfiere con el juego) ---- */
  const onInput = () => { lastInputAt = performance.now() }
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, onInput, { passive: true })
  }

  /* ---- overlay (DOM plano, sin React: no toca el árbol ni el rAF del juego) ---- */
  document.getElementById('bal1-telemetry')?.remove() // guard de hot-reload
  const root = document.createElement('div')
  root.id = 'bal1-telemetry'
  root.style.cssText = [
    'position:fixed', 'left:10px', 'bottom:10px', 'z-index:9999', 'max-width:380px',
    'background:#0c1512ee', 'border:1px solid #334155', 'border-radius:8px', 'padding:8px 10px',
    'font:11px/1.55 ui-monospace,Consolas,monospace', 'color:#cbd5e1', 'user-select:text',
    'box-shadow:0 6px 24px #000a',
  ].join(';')

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:700;color:#fbbf24'
  const status = document.createElement('span')
  const collapseBtn = mkBtn('▁', 'plegar/desplegar')
  header.append('📊 BAL.1', status, collapseBtn)

  const content = document.createElement('div')
  content.style.marginTop = '4px'

  const footer = document.createElement('div')
  footer.style.cssText = 'display:flex;gap:6px;margin-top:6px'
  const copyBtn = mkBtn('copiar JSON', 'copia el export al portapapeles')
  const logBtn = mkBtn('consola', 'console.log del export')
  const resetBtn = mkBtn('reset', 'borra SOLO la telemetría (no toca el save)')
  footer.append(copyBtn, logBtn, resetBtn)

  root.append(header, content, footer)
  document.body.appendChild(root)

  let collapsed = false
  collapseBtn.onclick = () => {
    collapsed = !collapsed
    content.style.display = footer.style.display = collapsed ? 'none' : ''
    collapseBtn.textContent = collapsed ? '▔' : '▁'
  }
  copyBtn.onclick = () => {
    navigator.clipboard?.writeText(JSON.stringify(exportData(), null, 2))
      .then(() => flashBtn(copyBtn, '✓ copiado'))
      .catch(() => flashBtn(copyBtn, '✗ error'))
  }
  logBtn.onclick = () => { console.log('[telemetry]', exportData()); flashBtn(logBtn, '✓') }
  resetBtn.onclick = () => { if (window.confirm('¿Resetear telemetría? (el save del juego NO se toca)')) reset() }

  /* ---- sampler 1Hz ---- */
  const tick = () => {
    const now = performance.now()
    if (document.hidden) { lastTickAt = now; return } // pestaña oculta: ni tiempo ni oro
    const dt = Math.min(now - lastTickAt, TICK_MS * 3) // clamp anti-throttle al volver
    lastTickAt = now

    const id = hot.activePhase // solo la fase montada progresa (un único rAF)
    const st = state.phases[id]
    const w = wealthOf(id)
    const delta = Math.max(0, w - lastWealth[id])
    lastWealth[id] = w

    const isActive = now - lastInputAt < ACTIVE_WINDOW_MS
    if (isActive) { st.activeMs += dt; st.activeGold += delta }
    else { st.idleMs += dt; st.idleGold += delta }

    const ring = rings[id]
    ring.push({ t: now, w })
    while (ring.length > 0 && now - ring[0].t > RECENT_WINDOW_MS) ring.shift()

    if (!st.goal && hot.phases[id].total >= META[id]) {
      st.goal = snapshotGoal(id, st, true)
      console.log(`[telemetry] 🏁 META de ${id} en ${fmtDur(st.goal.totalMs)} (activo ${fmtDur(st.goal.activeMs)} / idle ${fmtDur(st.goal.idleMs)})`, exportData())
    }

    persist()
    render(isActive)
  }

  function render(isActive: boolean) {
    status.textContent = isActive ? '🟢 activo' : '🌙 idle'
    const active = hot.activePhase
    const others = PHASE_IDS.filter((id) => id !== active && (state.phases[id].activeMs + state.phases[id].idleMs > 0 || state.phases[id].goal))
    content.innerHTML = phaseBlock(active, true) + others.map((id) => phaseBlock(id, false)).join('')
  }

  function phaseBlock(id: PhaseId, full: boolean): string {
    const P = hot.phases[id]
    const st = state.phases[id]
    const runMs = st.activeMs + st.idleMs
    const actRate = ratePerMin(st.activeGold, st.activeMs)
    const idleRate = ratePerMin(st.idleGold, st.idleMs)
    const botRate = Math.round(BOT_RATE[id](P.levels) * 60_000)
    const pct = Math.min(100, (P.total / META[id]) * 100)

    const goalLine = st.goal
      ? `<div style="color:#4ade80">🏁 meta en <b>${fmtDur(st.goal.totalMs)}</b> (act ${fmtDur(st.goal.activeMs)} · idle ${fmtDur(st.goal.idleMs)})${st.goal.measured ? '' : ' <i style="color:#f87171">— ya batida al iniciar, no representativo</i>'}</div>`
        + (st.goal.measured ? `<div style="color:#64748b">niveles@meta: ${lvlLine(st.goal.levels)}</div>` : '')
      : etaLine(id, P.total)

    const head = `<div style="color:#fbbf24;margin-top:${full ? 0 : 6}px">${LABEL[id]}${full ? '' : ' <span style="color:#64748b">(inactiva)</span>'}</div>`
    const base =
      `<div>run <b>${fmtDur(runMs)}</b> · act ${fmtDur(st.activeMs)} · idle ${fmtDur(st.idleMs)}</div>` +
      `<div>meta ${formatNum(P.total)} / ${formatNum(META[id])} (${pct.toFixed(pct < 10 ? 1 : 0)}%)</div>` +
      `<div>oro/min · act <b style="color:#4ade80">${formatNum(actRate)}</b> · idle <b style="color:#60a5fa">${formatNum(idleRate)}</b> · bot teórico ${formatNum(botRate)}</div>`
    if (!full) return head + base + goalLine
    return head + base +
      `<div style="color:#64748b">niveles: ${lvlLine(P.levels)}</div>` +
      goalLine
  }

  function etaLine(id: PhaseId, total: number): string {
    const ring = rings[id]
    if (ring.length < 2) return '<div style="color:#64748b">ETA: midiendo…</div>'
    const span = ring[ring.length - 1].t - ring[0].t
    const gained = ring[ring.length - 1].w - ring[0].w
    if (span < 5000 || gained <= 0) return '<div style="color:#64748b">ETA: — (sin ritmo en 60s)</div>'
    const perMin = (gained / span) * 60_000
    const etaMs = ((META[id] - total) / perMin) * 60_000
    return `<div>ETA meta ~<b>${fmtDur(etaMs)}</b> (ritmo 60s: ${formatNum(perMin)}/min)</div>`
  }

  window.setInterval(tick, TICK_MS)
  render(false)
}

/* ---- helpers ---- */

const ratePerMin = (gold: number, ms: number) => (ms > 0 ? Math.round((gold / ms) * 60_000) : 0)

const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${ss}s` : `${ss}s`
}

const lvlLine = (levels: Record<string, number>): string => {
  const parts = Object.entries(levels).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

function mkBtn(label: string, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.title = title
  b.style.cssText = 'font:inherit;font-size:10px;padding:1px 8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#94a3b8;cursor:pointer'
  return b
}

function flashBtn(b: HTMLButtonElement, txt: string) {
  const prev = b.textContent
  b.textContent = txt
  window.setTimeout(() => { b.textContent = prev }, 1200)
}
