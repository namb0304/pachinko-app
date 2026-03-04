import { useEffect } from 'react'
import PachinkoCanvas from './engine/PachinkoCanvas'
import useGameStore, { STATES } from './store/useGameStore'
import './App.css'

export default function App() {
  const phase       = useGameStore((s) => s.phase)
  const debugMode   = useGameStore((s) => s.debugMode)
  const startSpin   = useGameStore((s) => s.startSpin)
  const reset       = useGameStore((s) => s.reset)
  const toggleDebug = useGameStore((s) => s.toggleDebugMode)
  const forceWin    = useGameStore((s) => s.forceWin)

  useEffect(() => {
    const onKey = (e) => {
      // D キー: デバッグ確率トグル
      if (e.code === 'KeyD') {
        toggleDebug()
        return
      }
      // Space キー: 抽選 / リセット
      if (e.code !== 'Space') return
      e.preventDefault()
      if (phase === STATES.IDLE) startSpin()
      else if (phase === STATES.WIN || phase === STATES.LOSE) reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, startSpin, reset, toggleDebug])

  const isSpinning = phase === STATES.SPINNING

  return (
    <>
      <PachinkoCanvas />

      {/* ─── デバッグパネル ─── */}
      <div style={styles.panel}>
        <span style={styles.label}>DEV  [ D ] でトグル</span>

        {/* 現在の確率を大きく表示 */}
        <div style={{ ...styles.probBadge, background: debugMode ? '#7a3200' : '#0d1f2d' }}>
          {debugMode ? '確率  1 / 5' : '確率  1 / 319'}
        </div>

        <button
          onMouseDown={(e) => e.preventDefault()}   // フォーカス移動させない
          onClick={toggleDebug}
          style={{ ...styles.btn, background: debugMode ? '#b85400' : '#1e3040' }}
        >
          {debugMode ? 'DEBUG ON ✓' : 'DEBUG OFF'}
        </button>

        <button
          onMouseDown={(e) => e.preventDefault()}   // フォーカス移動させない
          onClick={forceWin}
          disabled={isSpinning}
          style={{
            ...styles.btn,
            background: isSpinning ? '#1a1a1a' : '#006644',
            cursor: isSpinning ? 'not-allowed' : 'pointer',
          }}
        >
          強制 WIN
        </button>
      </div>
    </>
  )
}

const styles = {
  panel: {
    position: 'fixed',
    top: 12,
    right: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    zIndex: 100,
    background: 'rgba(0,0,0,0.75)',
    border: '1px solid #334455',
    borderRadius: 6,
    padding: '10px 12px',
  },
  label: {
    color: '#446688',
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 1,
    textAlign: 'center',
  },
  probBadge: {
    color: '#ffffff',
    fontSize: 15,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    textAlign: 'center',
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid #ffffff22',
  },
  btn: {
    color: '#fff',
    border: '1px solid #ffffff22',
    borderRadius: 4,
    padding: '5px 12px',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'monospace',
    minWidth: 120,
  },
}
