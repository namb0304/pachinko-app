/**
 * useGameStore.js
 *
 * 役割: アプリ全体の「ゲーム状態」を一元管理するストア。
 *
 * なぜ Zustand を使うのか:
 *   React の useState は「そのコンポーネント内だけ」の状態管理。
 *   複数コンポーネントをまたいで状態を共有する場合は
 *   Context API や外部ライブラリが必要になる。
 *   Zustand は Redux より API が少なくシンプル、かつ
 *   PixiJS のティッカー内など React の外側からも
 *   `useGameStore.getState()` で同期的に読み書きできるのが強み。
 *
 * 他ファイルとの関係:
 *   PachinkoCanvas.jsx … ティッカー（毎フレーム処理）内で getState() を使って直接読み書き
 *   App.jsx           … useGameStore(s => s.xxx) フックで購読し React UI を更新
 */

// Zustand の create 関数: この関数に「状態と操作の定義」を渡してストアを作る
import { create } from 'zustand'

/**
 * ゲームのフェーズ（局面）を文字列定数で管理する。
 *
 * なぜ定数にするのか:
 *   'IDLE' などの文字列を直接コード中に書くと typo バグが起きやすく、
 *   エディタの補完も効かない。定数にして export することで
 *   他ファイルが同じ値を確実に参照でき、リファクタリングも安全になる。
 *
 *   IDLE     … 待機中（玉を自由に打てる状態）
 *   SPINNING … 図柄が変動している抽選中（3秒間）
 *   WIN      … 大当たり確定（+300 玉）
 *   LOSE     … 外れ確定
 */
export const STATES = {
  IDLE:     'IDLE',
  SPINNING: 'SPINNING',
  WIN:      'WIN',
  LOSE:     'LOSE',
}

/**
 * create(callback) でストアを生成する。
 * callback の引数:
 *   set … 状態を更新する関数。呼ぶと購読中の React コンポーネントが再レンダリングされる
 *   get … 現在の状態を同期的に読む関数。React hooks に依存しないため外部から使える
 */
const useGameStore = create((set, get) => ({

  // ── 初期状態（ストアが作られた時点の値）─────────────────────────────────

  phase:     STATES.IDLE,  // 現在のゲームフェーズ（上の STATES 定数から選ぶ）
  isWin:     false,        // 内部的な当落結果（抽選時に決定、UI は phase で判断）
  showCutin: false,        // 「激アツ！」カットインを表示するかどうかのフラグ
  debugMode: false,        // true なら確率を 1/5 に緩めるデバッグ専用フラグ
  ballCount: 100,          // 現在の持ち玉数。0 になると玉を打てなくなる

  // ── アクション（状態を変化させる関数群）───────────────────────────────────

  /**
   * startSpin()
   * ヘソに玉が入ったときに呼ばれる。抽選を行い、図柄変動演出を開始する。
   * 呼び出し元: PachinkoCanvas.jsx の onHesoHit コールバック
   */
  startSpin() {
    // 既に変動中なら二重抽選を防ぐ（ガード節: 早期 return で深いネストを避ける）
    if (get().phase === STATES.SPINNING) return

    // debugMode によって確率を切り替える
    // 通常: 1/319（実際のパチンコ確率）、デバッグ: 1/5（動作確認しやすいよう緩める）
    const prob = get().debugMode ? 1 / 5 : 1 / 319

    // Math.random() は 0.0 以上 1.0 未満の乱数を返す
    // prob より小さければ当たり（例: 1/319 = 約 0.00313 未満なら当たり）
    const rand  = Math.random()
    const isWin = rand < prob

    // カットイン演出フラグを決める
    // 当たりなら 80% でカットイン（当選の重みを演出）
    // 外れでも 5% でカットイン（釣り演出: 「激アツ！」を出してから外す）
    const showCutin = isWin
      ? Math.random() < 0.8
      : Math.random() < 0.05

    // 開発者向けに抽選の詳細をコンソールに表示（本番では削除してもよい）
    console.log(
      `[抽選] rand=${rand.toFixed(4)}, prob=${prob.toFixed(4)}, ` +
      `isWin=${isWin}, showCutin=${showCutin}`
    )

    // フェーズを SPINNING に移行し、抽選結果をストアに保存する
    // ※ 一度の set で複数プロパティをまとめて更新する（中間状態を作らず一貫性を保つ）
    set({ phase: STATES.SPINNING, isWin, showCutin })

    // 3 秒後に変動を終わらせて当落フェーズへ移行する
    // setTimeout: 指定ミリ秒後に非同期でコールバックを実行するブラウザ標準 API
    // ※ isWin は setTimeout のクロージャ（外側の変数を関数内に閉じ込める仕組み）でキャプチャされる
    setTimeout(() => {
      const nextPhase = isWin ? STATES.WIN : STATES.LOSE
      console.log(`[結果] phase → ${nextPhase}`)

      // 当たりなら持ち玉 +300 を反映する
      // set に「関数」を渡すことで最新の state(s) を受け取れる
      // ※ 直接 ballCount + 300 と書くと古い値を参照してしまう可能性があるため関数形式を使う
      set((s) => ({
        phase:     nextPhase,
        ballCount: isWin ? s.ballCount + 300 : s.ballCount,
      }))
    }, 3000) // 3000ms = 3秒後に実行
  },

  /**
   * consumeBall()
   * 玉を 1 個消費する。残 0 なら何もせず false を返す。
   * 呼び出し元: PachinkoCanvas.jsx のティッカー内（Space 押しっぱなし時）
   *
   * 返り値: boolean — 消費成功なら true、玉切れなら false
   */
  consumeBall() {
    // 玉が 0 以下なら消費できない → false を返して呼び出し元に「打てない」と伝える
    if (get().ballCount <= 0) return false

    // 関数形式の set で最新の ballCount から 1 引く
    set((s) => ({ ballCount: s.ballCount - 1 }))

    return true // 消費成功
  },

  /**
   * addBalls(n)
   * 持ち玉を n 個追加する。ヘソ入賞時の「賞球」として呼ばれる。
   * 呼び出し元: PachinkoCanvas.jsx の onHesoHit
   *
   * デフォルト引数 n=10: 引数を省略した場合に 10 が使われる（ES2015 の機能）
   */
  addBalls(n = 10) {
    // 現在の ballCount に n を足す（関数形式で最新値を参照）
    set((s) => ({ ballCount: s.ballCount + n }))
  },

  // ── デバッグ専用アクション ─────────────────────────────────────────────────

  /**
   * toggleDebugMode()
   * 抽選確率を 1/319 ↔ 1/5 でトグルする。
   * 呼び出し元: App.jsx（D キー または DEBUGボタン）
   */
  toggleDebugMode() {
    const next = !get().debugMode  // 現在値を反転（true → false, false → true）
    set({ debugMode: next })
    // コンソールに現在の状態を表示（確率が変わったことを視覚的に確認できる）
    console.log(`[DEBUG] debugMode: ${next ? 'ON (1/5)' : 'OFF (1/319)'}`)
  },

  /**
   * forceWin()
   * デバッグ用の強制当たり。変動を開始して 3 秒後に必ず WIN にする。
   * 呼び出し元: App.jsx の「強制 WIN」ボタン
   */
  forceWin() {
    // 変動中は多重実行を防ぐ
    if (get().phase === STATES.SPINNING) return

    console.log('[DEBUG] 強制 WIN 発動')

    // カットインあり・当たりフラグありで変動を開始
    set({ phase: STATES.SPINNING, isWin: true, showCutin: true })

    // 3 秒後に WIN フェーズへ移行し持ち玉 +300
    setTimeout(() => {
      console.log('[結果] phase → WIN (forced)')
      set((s) => ({ phase: STATES.WIN, ballCount: s.ballCount + 300 }))
    }, 3000)
  },

  /**
   * reset()
   * WIN または LOSE から IDLE（待機状態）に戻す。
   * 呼び出し元: App.jsx（Space キー、WIN・LOSE フェーズのときのみ）
   */
  reset() {
    // フェーズと演出フラグをリセット
    // ※ ballCount はリセットしない（獲得した持ち玉は引き継ぐ）
    set({ phase: STATES.IDLE, isWin: false, showCutin: false })
  },
}))

// デフォルトエクスポート: `import useGameStore from '...'` で使えるようにする
export default useGameStore
