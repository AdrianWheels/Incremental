import { useEffect } from 'react'
import { hot, useColdVersion, isUnlocked, unlockPhase, switchPhase, type PhaseId } from './core/store'
import { initPersistence } from './core/save'
import { GoalPhase } from './phases/porteria/GoalPhase'

/* Monta SOLO la fase activa: garantiza un único bucle rAF vivo (el cleanup del
 * effect de cada fase cancela el suyo al desmontar). */

export function App() {
  useColdVersion()
  useEffect(() => initPersistence(), [])
  const active = hot.activePhase
  const basketUnlocked = isUnlocked('basket')

  const onVictory = () => {
    unlockPhase('basket')
    switchPhase('basket')
  }

  return (
    <>
      <nav style={styles.tabs}>
        <PhaseTab id="porteria" label="⚽ PORTERÍA" active={active} unlocked onPick={switchPhase} />
        <PhaseTab id="basket" label={basketUnlocked ? '🏀 CANCHA' : '🔒 CANCHA'} active={active} unlocked={basketUnlocked} onPick={switchPhase} />
      </nav>
      {active === 'porteria'
        ? <GoalPhase onVictory={onVictory} victorySeen={basketUnlocked} />
        : <BasketPlaceholder />}
    </>
  )
}

function PhaseTab(props: { id: PhaseId; label: string; active: PhaseId; unlocked: boolean; onPick: (p: PhaseId) => void }) {
  const isActive = props.active === props.id
  return (
    <button
      onClick={() => props.unlocked && props.onPick(props.id)}
      disabled={!props.unlocked}
      title={props.unlocked ? undefined : 'Bate al portero para desbloquear'}
      style={{
        ...styles.tab,
        borderColor: isActive ? '#fbbf24' : '#334155',
        color: isActive ? '#fbbf24' : props.unlocked ? '#94a3b8' : '#475569',
        background: isActive ? '#1e293bdd' : '#0c1512cc',
        cursor: props.unlocked ? 'pointer' : 'not-allowed',
      }}
    >
      {props.label}
    </button>
  )
}

function BasketPlaceholder() {
  return (
    <div style={styles.placeholder}>
      <div style={{ fontSize: 40 }}>🏀</div>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 2 }}>LA CANCHA · en construcción</div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  tabs: {
    position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
    display: 'flex', gap: 8,
  },
  tab: {
    padding: '6px 16px', borderRadius: 999, border: '1.5px solid', fontWeight: 800, fontSize: 12,
    letterSpacing: 1, font: 'inherit', transition: 'all .15s',
  },
  placeholder: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 12, background: 'radial-gradient(circle at 50% 0%, #3a2a1e 0%, #14100b 70%)',
    color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif', userSelect: 'none',
  },
}
