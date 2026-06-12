/* [GLX.1] Tienda-galaxia: overlay a pantalla completa con el juego VIVO debajo
 * (el rAF de la fase no se toca; este componente es UI fría — re-render solo
 * vía el cold-version del padre y el throttle de oro de la fase).
 * SVG + CSS, sin rAF propio. Compra en dos pasos: clic en estrella → tarjeta → COMPRAR.
 * El pulido del momento de compra (partículas/ignición/aristas animadas) es [GLX.2]. */

import { useEffect, useState } from 'react'
import { formatNum } from '../core/utils'
import { hot, type PhaseId } from '../core/store'
import { buyStar, starStates, starLevel, starCost, type GalaxyDef, type StarDef, type StarState } from '../core/galaxy'
import { sfx } from '../core/audio'

export function GalaxyShop(props: {
  def: GalaxyDef
  phase: PhaseId
  gold: number
  open: boolean
  onClose: () => void
  onBought?: (star: StarDef) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // ESC cierra (solo mientras está abierta)
  useEffect(() => {
    if (!props.open) return
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.open])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!props.open) return null

  const levels = hot.phases[props.phase].levels
  const states = starStates(props.def, levels)
  const selected = props.def.stars.find((s) => s.id === selectedId) ?? null
  const selState: StarState | null = selected ? states[selected.id] : null

  const buy = (star: StarDef) => {
    if (!buyStar(props.phase, star)) return
    sfx.buy()
    // mini-flash de la estrella (la ignición de verdad es GLX.2)
    document.getElementById(starDomId(props.phase, star.id))?.animate(
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(1.6)', opacity: 0.65 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 320, easing: 'ease-out' },
    )
    props.onBought?.(star)
  }

  return (
    <div style={styles.overlay}>
      <style>{css}</style>

      {/* polvo estelar de fondo (CSS puro, deriva lenta) */}
      <div className="glx-dust" />

      <header style={styles.head}>
        <span style={styles.title}>{props.def.title}</span>
        <span style={styles.gold}>● {formatNum(props.gold)}</span>
        <button style={styles.close} onClick={props.onClose} title="cerrar (ESC)">✕</button>
      </header>

      <svg viewBox="0 0 100 100" style={styles.svg}>
        {/* aristas: visibles cuando ambos extremos se conocen (la ⭐ se conoce siempre) */}
        {props.def.stars.flatMap((s) =>
          s.edges.map((to) => {
            const t = props.def.stars.find((x) => x.id === to)
            if (!t) return null
            const known = (st: StarState, star: StarDef) => star.sala || st !== 'far'
            if (!known(states[s.id], s) || !known(states[to], t)) return null
            const lit = states[s.id] === 'owned' && states[to] === 'owned'
            return (
              <line
                key={`${s.id}-${to}`}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={lit ? '#fbbf24' : '#334155'}
                strokeWidth={lit ? 0.35 : 0.22}
                strokeDasharray={lit ? undefined : '1 1.2'}
                opacity={lit ? 0.85 : 0.6}
              />
            )
          }),
        )}

        {props.def.stars.map((s) => (
          <Star
            key={s.id}
            star={s}
            state={s.sala && states[s.id] === 'far' ? 'named' : states[s.id]}
            lv={starLevel(levels, s.id)}
            domId={starDomId(props.phase, s.id)}
            selected={selectedId === s.id}
            onPick={() => setSelectedId(s.id)}
          />
        ))}
      </svg>

      {/* tarjeta de compra */}
      {selected && selState && (selState === 'owned' || selState === 'unlocked' || selected.sala) && (
        <BuyCard
          star={selected}
          lv={starLevel(levels, selected.id)}
          gold={props.gold}
          locked={selState !== 'owned' && selState !== 'unlocked'}
          onBuy={() => buy(selected)}
        />
      )}
      {selected && selState === 'named' && !selected.sala && (
        <div style={styles.card}>
          <div style={{ fontWeight: 800, color: '#94a3b8' }}>{selected.name}</div>
          <div style={styles.cardDesc}>🔒 se desbloquea comprando una estrella vecina</div>
        </div>
      )}

      <p style={styles.hint}>compra nivel 1 de una estrella para iluminar a sus vecinas · la ⭐ de Sala gana la zona</p>
    </div>
  )
}

const starDomId = (phase: PhaseId, id: string) => `glx-${phase}-${id}`

/* ---- una estrella ---- */
function Star(props: {
  star: StarDef
  state: StarState
  lv: number
  domId: string
  selected: boolean
  onPick: () => void
}) {
  const { star, state, lv } = props
  if (state === 'far' && !star.sala) {
    return <circle cx={star.x} cy={star.y} r={0.8} fill="#334155" opacity={0.45} />
  }
  const r = star.sala ? 3.2 : 2.1
  const owned = state === 'owned'
  const unlocked = state === 'unlocked'
  const color = owned || unlocked ? star.color : '#475569'

  return (
    <g
      id={props.domId}
      onClick={props.onPick}
      style={{ cursor: 'pointer', transformOrigin: `${star.x}px ${star.y}px` }}
      className={unlocked ? 'glx-pulse' : undefined}
    >
      {/* halo de selección */}
      {props.selected && <circle cx={star.x} cy={star.y} r={r + 1.4} fill="none" stroke="#e2e8f0" strokeWidth={0.22} strokeDasharray="0.8 0.8" />}
      {/* glow de comprada */}
      {owned && <circle cx={star.x} cy={star.y} r={r + 0.9} fill={star.color} opacity={0.18} />}
      <circle
        className="glx-core"
        cx={star.x} cy={star.y} r={r}
        fill={owned ? star.color : '#0c1512'}
        fillOpacity={owned ? 0.9 : 1}
        stroke={color}
        strokeWidth={star.sala ? 0.5 : 0.35}
      />
      {star.sala && (
        <text x={star.x} y={star.y + 1.1} textAnchor="middle" fontSize={3} style={{ pointerEvents: 'none' }}>⭐</text>
      )}
      <text
        x={star.x} y={star.y + r + 2.4} textAnchor="middle"
        fontSize={2.1} fontWeight={700} fill={color}
        style={{ pointerEvents: 'none', letterSpacing: 0.1 }}
      >
        {star.name}
      </text>
      <text x={star.x} y={star.y + r + 4.6} textAnchor="middle" fontSize={1.7} fill="#64748b" style={{ pointerEvents: 'none' }}>
        {star.sala
          ? (lv >= 1 ? '✓' : `● ${formatNum(star.base)}`)
          : owned ? `Nv ${lv}/${star.maxLv}` : unlocked ? '· nueva ·' : ''}
      </text>
    </g>
  )
}

/* ---- tarjeta de compra ---- */
function BuyCard(props: { star: StarDef; lv: number; gold: number; locked: boolean; onBuy: () => void }) {
  const { star, lv } = props
  const maxed = lv >= star.maxLv
  const cost = starCost(star, lv)
  const afford = props.gold >= cost
  return (
    <div style={{ ...styles.card, borderColor: star.color + '88' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 800, color: star.color }}>{star.name}</span>
        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>{star.sala ? '' : `Nv ${lv}/${star.maxLv}`}</span>
      </div>
      <div style={styles.cardDesc}>{star.desc(lv)}</div>
      {props.locked ? (
        <div style={{ ...styles.cardDesc, color: '#f87171' }}>🔒 ilumina una vecina para desbloquearla</div>
      ) : maxed ? (
        <div style={{ ...styles.cardCost, color: '#64748b' }}>MÁX</div>
      ) : (
        <button
          onClick={props.onBuy}
          disabled={!afford}
          style={{
            ...styles.buyBtn,
            borderColor: star.color + (afford ? 'cc' : '44'),
            color: afford ? star.color : '#475569',
            cursor: afford ? 'pointer' : 'not-allowed',
          }}
        >
          COMPRAR · ● {formatNum(cost)}
        </button>
      )}
    </div>
  )
}

/* ---- estilos ---- */

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 45,
    background: 'radial-gradient(ellipse at 50% 30%, #0b1320ee 0%, #04070cf2 75%)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    animation: 'glx-fade .25s ease-out',
  },
  head: {
    display: 'flex', alignItems: 'center', gap: 18, marginTop: 54,
    padding: '6px 16px', borderRadius: 999, border: '1px solid #1e293b', background: '#0c1512cc',
  },
  title: { fontSize: 13, fontWeight: 800, letterSpacing: 2, color: '#e2e8f0' },
  gold: { fontSize: 15, fontWeight: 900, color: '#fbbf24', fontVariantNumeric: 'tabular-nums' },
  close: {
    font: 'inherit', fontSize: 13, fontWeight: 800, color: '#94a3b8', background: 'transparent',
    border: '1px solid #334155', borderRadius: 999, padding: '2px 10px', cursor: 'pointer',
  },
  svg: { width: 'min(92vw, 78vh)', flex: 1, maxHeight: '78vh', fontFamily: 'inherit' },
  card: {
    position: 'fixed', right: 'max(16px, calc(50vw - 39vh - 250px))', top: '50%', transform: 'translateY(-50%)',
    width: 230, display: 'flex', flexDirection: 'column', gap: 8, padding: 12,
    background: '#0c1512f2', border: '1.5px solid #334155', borderRadius: 10,
    boxShadow: '0 8px 30px #000c', zIndex: 2,
  },
  cardDesc: { fontSize: 12, color: '#94a3b8', lineHeight: 1.5 },
  cardCost: { fontSize: 13, fontWeight: 800 },
  buyBtn: {
    font: 'inherit', fontSize: 13, fontWeight: 800, padding: '8px 10px', borderRadius: 8,
    border: '1.5px solid', background: '#111c18', letterSpacing: 0.5,
  },
  hint: { fontSize: 12, color: '#475569', margin: '0 0 14px' },
}

const css = `
@keyframes glx-fade { from { opacity: 0; } to { opacity: 1; } }
.glx-dust {
  position:absolute; inset:-20%; pointer-events:none; opacity:.5;
  background-image:
    radial-gradient(1px 1px at 12% 28%, #94a3b8aa 50%, transparent 51%),
    radial-gradient(1px 1px at 68% 12%, #64748baa 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 84% 64%, #94a3b877 50%, transparent 51%),
    radial-gradient(1px 1px at 36% 76%, #64748b99 50%, transparent 51%),
    radial-gradient(1px 1px at 52% 44%, #94a3b855 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 22% 56%, #64748b88 50%, transparent 51%);
  background-size: 46% 46%;
  animation: glx-drift 80s linear infinite;
}
@keyframes glx-drift { from { transform: translate(0,0); } to { transform: translate(-9%, -5%); } }
.glx-pulse .glx-core { animation: glx-pulse 1.8s ease-in-out infinite; }
@keyframes glx-pulse { 50% { stroke-width: 0.7; } }
`
