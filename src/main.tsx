import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { hot } from './core/store'
import { loadSave } from './core/save'
import { migrateGalaxy } from './core/galaxy'
import { GALAXY_PORTERIA } from './phases/porteria/galaxy'
import { GALAXY_BASKET } from './phases/basket/galaxy'
import { applyOfflineProgress } from './core/offline'
import { initTelemetry } from './debug/telemetry'

// hidrata el store, convierte saves pre-galaxia [GLX.1] y acredita el idle offline ANTES del primer render
const lastSeen = loadSave()
migrateGalaxy(GALAXY_PORTERIA, hot.phases.porteria.levels, hot.unlocked)
migrateGalaxy(GALAXY_BASKET, hot.phases.basket.levels, hot.unlocked)
applyOfflineProgress(lastSeen)
initTelemetry() // [BAL.1] no-op sin `?debug`; tras la hidratación para no atribuir el oro offline

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
