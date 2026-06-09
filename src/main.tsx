import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { loadSave } from './core/save'

loadSave() // hidrata el store ANTES del primer render

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
