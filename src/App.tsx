import { useEffect, useState } from 'react'
import { hot, useColdVersion, isUnlocked, unlockPhase, switchPhase, commit, type PhaseId } from './core/store'
import { initPersistence } from './core/save'
import { getOfflineGain, formatAway } from './core/offline'
import { formatNum } from './core/utils'
import { unlockAudio } from './core/audio'
import { GoalPhase } from './phases/porteria/GoalPhase'
import { BasketPhase } from './phases/basket/BasketPhase'

/* Monta SOLO la fase activa: garantiza un único bucle rAF vivo (el cleanup del
 * effect de cada fase cancela el suyo al desmontar). */

export function App() {
  useColdVersion()
  useEffect(() => initPersistence(), [])

  // los navegadores bloquean el AudioContext hasta el primer gesto del usuario
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])
  // [CORE.2] banner "Mientras no estabas": el oro ya está acreditado en main.tsx;
  // aquí solo se muestra una vez por sesión (estado local = descartable)
  const [offlineSeen, setOfflineSeen] = useState(false)
  const offline = getOfflineGain()

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
        <button
          onClick={() => { hot.muted = !hot.muted; commit() }}
          title={hot.muted ? 'Activar sonido' : 'Silenciar'}
          style={{ ...styles.tab, borderColor: '#334155', color: hot.muted ? '#475569' : '#94a3b8', background: '#0c1512cc', cursor: 'pointer' }}
        >
          {hot.muted ? '🔇' : '🔊'}
        </button>
      </nav>
      {offline && !offlineSeen && (
        <div style={styles.offlineBanner}>
          <span>
            💤 Mientras no estabas ({formatAway(offline.awayMs)}):{' '}
            <b style={{ color: '#fbbf24' }}>+{formatNum(offline.total)} oro</b>
            {offline.byPhase.length > 1 && (
              <span style={{ color: '#94a3b8' }}>
                {' '}({offline.byPhase.map((g) => `${PHASE_EMOJI[g.phase]} +${formatNum(g.gold)}`).join(' · ')})
              </span>
            )}
          </span>
          <button style={styles.offlineOk} onClick={() => setOfflineSeen(true)}>OK</button>
        </div>
      )}
      {active === 'porteria'
        ? <GoalPhase onVictory={onVictory} victorySeen={basketUnlocked} />
        : <BasketPhase />}
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

const PHASE_EMOJI: Record<PhaseId, string> = { porteria: '⚽', basket: '🏀' }

const styles: Record<string, React.CSSProperties> = {
  tabs: {
    position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
    display: 'flex', gap: 8,
  },
  tab: {
    padding: '6px 16px', borderRadius: 999, border: '1.5px solid', fontWeight: 800, fontSize: 12,
    letterSpacing: 1, font: 'inherit', transition: 'all .15s',
  },
  offlineBanner: {
    position: 'fixed', top: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
    display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderRadius: 10,
    border: '1.5px solid #fbbf24', background: '#0c1512f2', color: '#e2e8f0', fontSize: 13,
    boxShadow: '0 6px 24px #000a, 0 0 14px #fbbf2433', whiteSpace: 'nowrap',
  },
  offlineOk: {
    padding: '3px 12px', borderRadius: 999, border: '1.5px solid #fbbf24', background: 'transparent',
    color: '#fbbf24', fontWeight: 800, fontSize: 12, cursor: 'pointer', font: 'inherit',
  },
}
