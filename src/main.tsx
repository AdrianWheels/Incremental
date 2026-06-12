import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { loadSave } from './core/save'
import { applyOfflineProgress } from './core/offline'
import { initTelemetry } from './debug/telemetry'

// hidrata el store y acredita el idle offline de los bots ANTES del primer render
applyOfflineProgress(loadSave())
initTelemetry() // [BAL.1] no-op sin `?debug`; tras la hidratación para no atribuir el oro offline

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
