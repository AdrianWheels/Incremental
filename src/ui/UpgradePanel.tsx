/* Panel de mejoras genérico. Cada fase precalcula sus filas (coste, descripción
 * current → next, tope) — el panel solo pinta y delega la compra. */

import { formatNum } from '../core/utils'
import type { UpgradeDef } from '../core/economy'

export type UpgRow = {
  key: string
  def: UpgradeDef
  lv: number
  cost: number
  desc: string
  maxed: boolean
}

export function UpgradePanel(props: { rows: UpgRow[]; gold: number; onBuy: (key: string) => void }) {
  return (
    <aside style={styles.panel}>
      <h2 style={styles.panelTitle}>MEJORAS</h2>
      {props.rows.map((row) => {
        const afford = props.gold >= row.cost
        return (
          <button
            key={row.key}
            onClick={() => props.onBuy(row.key)}
            disabled={!afford || row.maxed}
            style={{
              ...styles.upg,
              borderColor: row.def.color + (afford && !row.maxed ? 'aa' : '33'),
              opacity: row.maxed ? 0.5 : afford ? 1 : 0.55,
              cursor: afford && !row.maxed ? 'pointer' : 'not-allowed',
            }}
          >
            <div style={styles.upgTop}>
              <span style={{ fontWeight: 800, color: row.def.color }}>{row.def.name}</span>
              <span style={styles.upgLv}>Nv {row.lv}</span>
            </div>
            <div style={styles.upgEff}>{row.desc}</div>
            <div style={{ ...styles.upgCost, color: row.maxed ? '#64748b' : afford ? '#fbbf24' : '#64748b' }}>
              {row.maxed ? 'MÁX' : `● ${formatNum(row.cost)}`}
            </div>
          </button>
        )
      })}
    </aside>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex', flexDirection: 'column', gap: 7, width: 260, minWidth: 230, flex: '1 1 230px', maxWidth: 300,
    background: '#0c1512cc', border: '1px solid #1e293b', borderRadius: 10, padding: 12,
  },
  panelTitle: { margin: '0 0 4px', fontSize: 13, fontWeight: 800, letterSpacing: 3, color: '#64748b' },
  upg: {
    textAlign: 'left', background: '#111c18', border: '1.5px solid', borderRadius: 8, padding: '8px 10px',
    color: '#e2e8f0', font: 'inherit', display: 'flex', flexDirection: 'column', gap: 2, transition: 'opacity .15s',
  },
  upgTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 },
  upgLv: { fontSize: 11, color: '#94a3b8', fontWeight: 700 },
  upgEff: { fontSize: 11, color: '#94a3b8' },
  upgCost: { fontSize: 12, fontWeight: 800, marginTop: 2 },
}
