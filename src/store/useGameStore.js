import { create } from 'zustand'

export const STATES = {
  IDLE: 'IDLE',
  SPINNING: 'SPINNING',
  WIN: 'WIN',
  LOSE: 'LOSE',
}

const useGameStore = create((set, get) => ({
  phase: STATES.IDLE,
  isWin: false,
  showCutin: false,
  debugMode: false,

  startSpin() {
    if (get().phase === STATES.SPINNING) return

    const prob = get().debugMode ? 1 / 5 : 1 / 319
    const rand = Math.random()
    const isWin = rand < prob
    const showCutin = isWin ? Math.random() < 0.8 : Math.random() < 0.05

    console.log(
      `[抽選] rand=${rand.toFixed(4)}, prob=${prob.toFixed(4)}, ` +
      `isWin=${isWin}, showCutin=${showCutin}`
    )

    set({ phase: STATES.SPINNING, isWin, showCutin })

    setTimeout(() => {
      const nextPhase = isWin ? STATES.WIN : STATES.LOSE
      console.log(`[結果] phase → ${nextPhase}`)
      set({ phase: nextPhase })
    }, 3000)
  },

  // デバッグ用: 確率 1/5 のトグル
  toggleDebugMode() {
    const next = !get().debugMode
    set({ debugMode: next })
    console.log(`[DEBUG] debugMode: ${next ? 'ON (1/5)' : 'OFF (1/319)'}`)
  },

  // デバッグ用: 強制 WIN
  forceWin() {
    if (get().phase === STATES.SPINNING) return
    console.log('[DEBUG] 強制 WIN 発動')
    set({ phase: STATES.SPINNING, isWin: true, showCutin: true })
    setTimeout(() => {
      console.log('[結果] phase → WIN (forced)')
      set({ phase: STATES.WIN })
    }, 3000)
  },

  reset() {
    set({ phase: STATES.IDLE, isWin: false, showCutin: false })
  },
}))

export default useGameStore
