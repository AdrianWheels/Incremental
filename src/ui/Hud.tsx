/* HUD genérico de fase: oro (contador imperativo vía ref — lo anima el rAF de la fase),
 * barra de meta y tally de aciertos/fallos. */

import { formatNum } from '../core/utils'

export type TallyItem = { label: string; color: string }

export function Hud(props: {
  goldElRef: React.Ref<HTMLSpanElement>
  metaLabel: string
  totalUi: number
  metaGold: number
  tally: TallyItem[]
  /** [GLX.1] abre la tienda-galaxia; el color identifica la fase */
  onShop?: () => void
  shopColor?: string
}) {
  const progress = Math.min(100, (props.totalUi / props.metaGold) * 100)
  return (
    <header style={styles.hud}>
      <div style={styles.goldBox}>
        <span style={styles.goldIcon}>●</span>
        <span ref={props.goldElRef} style={styles.goldNum}>0</span>
        <span style={styles.goldLbl}>ORO</span>
        {props.onShop && (
          <>
            <style>{shopBtnCss}</style>
            <button
              className="hud-shop"
              onClick={props.onShop}
              style={{ ...styles.shopBtn, borderColor: props.shopColor ?? '#94a3b8', color: props.shopColor ?? '#94a3b8' }}
              title="abrir la tienda de mejoras"
            >
              🛒 TIENDA
            </button>
          </>
        )}
      </div>
      <div style={styles.metaWrap}>
        <div style={styles.metaTop}>
          <span>{props.metaLabel}</span>
          <span>{formatNum(props.totalUi)} / {formatNum(props.metaGold)}</span>
        </div>
        <div style={styles.metaBar}>
          <div style={{ ...styles.metaFill, width: `${progress}%` }} />
        </div>
      </div>
      <div style={styles.tally}>
        {props.tally.map((t, i) => <span key={i} style={{ color: t.color }}>{t.label}</span>)}
      </div>
    </header>
  )
}

const styles: Record<string, React.CSSProperties> = {
  hud: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, width: 'min(94vw, 1080px)', flexWrap: 'wrap' },
  goldBox: { display: 'flex', alignItems: 'baseline', gap: 8 },
  goldIcon: { color: '#fbbf24', fontSize: 18 },
  goldNum: { fontSize: 34, fontWeight: 900, color: '#fbbf24', fontVariantNumeric: 'tabular-nums', minWidth: 80 },
  goldLbl: { fontSize: 12, fontWeight: 700, letterSpacing: 2, color: '#a16207' },
  metaWrap: { flex: 1, minWidth: 240, maxWidth: 460 },
  metaTop: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600 },
  metaBar: { height: 10, background: '#0f1f18', borderRadius: 6, overflow: 'hidden', border: '1px solid #1e3a2f' },
  metaFill: { height: '100%', background: 'linear-gradient(90deg,#4ade80,#fbbf24)', transition: 'width 0.2s ease', borderRadius: 6 },
  tally: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: 12, fontWeight: 700, gap: 2 },
  shopBtn: {
    font: 'inherit', fontSize: 12, fontWeight: 800, letterSpacing: 1, marginLeft: 14, alignSelf: 'center',
    padding: '6px 14px', borderRadius: 999, border: '1.5px solid', background: '#0c1512cc', cursor: 'pointer',
    transition: 'all .15s',
  },
}

// hover solo en dispositivos con puntero (en táctil no hay hover que se quede pegado)
const shopBtnCss = `
@media (hover: hover) {
  .hud-shop:hover { background: #1e293b; box-shadow: 0 0 12px currentColor; transform: translateY(-1px); }
}
.hud-shop:active { transform: scale(.96); }
`
