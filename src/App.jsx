/**
 * App.jsx
 *
 * 役割: アプリのルートコンポーネント。
 *       PixiJS の canvas（PachinkoCanvas）を配置しつつ、
 *       React の UI 要素（デバッグパネル）を CSS で重ねて表示する。
 *
 * なぜ PixiJS と React の UI を混在させるのか:
 *   PixiJS は canvas に描画するため、HTML ベースの UI（ボタン・テキスト）は
 *   canvas の外側に React で作った方が実装が簡単で、アクセシビリティも保てる。
 *   デバッグパネルはゲームの描画に無関係なため React に任せる（関心の分離）。
 *
 * 他ファイルとの関係:
 *   PachinkoCanvas.jsx … PixiJS の描画全体を担う。このファイルでマウントする
 *   useGameStore.js   … phase・debugMode などのゲーム状態を購読・操作する
 */

// useEffect: 副作用（イベントリスナーの登録・解除）を扱う React フック
import { useEffect } from 'react'

// PixiJS の canvas と Matter.js 物理を管理するコンポーネント
import PachinkoCanvas from './engine/PachinkoCanvas'

// Zustand ストアと状態定数をインポート
// useGameStore … フック形式で状態を購読し、変化したときに再レンダリングを受け取る
// STATES       … フェーズ名の定数（'IDLE' / 'SPINNING' / 'WIN' / 'LOSE'）
import useGameStore, { STATES } from './store/useGameStore'

// CSS リセット（box-sizing・margin・padding の初期化）を読み込む
import './App.css'

export default function App() {

  // ── ストアから必要な状態・操作を取り出す ────────────────────────────────
  // useGameStore(s => s.xxx) は「xxx が変化したときだけ再レンダリングする」セレクター
  // ※ 全状態を一括取得（useGameStore()）すると関係ない変化でも再レンダリングされるため、
  //   必要なものだけ個別に選ぶのが Zustand の推奨スタイル

  const phase       = useGameStore((s) => s.phase)           // 現在のゲームフェーズ
  const debugMode   = useGameStore((s) => s.debugMode)       // デバッグ確率 ON/OFF フラグ
  const reset       = useGameStore((s) => s.reset)           // IDLE に戻すリセット関数
  const toggleDebug = useGameStore((s) => s.toggleDebugMode) // 確率を 1/319 ↔ 1/5 で切り替える関数
  const forceWin    = useGameStore((s) => s.forceWin)        // 強制当たりを発動する関数（デバッグ用）

  // ── キーボードショートカットの登録 ──────────────────────────────────────
  // useEffect の中でリスナーを登録し、return でクリーンアップ（解除）する
  // ※ React コンポーネントの外で addEventListener を呼ぶとクリーンアップが難しくなる
  useEffect(() => {
    const onKey = (e) => {
      // D キー: デバッグモードのトグル（確率 1/319 ↔ 1/5 の切り替え）
      if (e.code === 'KeyD') { toggleDebug(); return }

      // Space 以外のキーは何もしない
      if (e.code !== 'Space') return

      // Space キーのデフォルト動作（ページスクロールなど）を抑制する
      e.preventDefault()

      // WIN または LOSE フェーズのときのみ Space でリセットする
      // ※ IDLE 時は PachinkoCanvas.jsx 側が Space を「玉の打ち込み」として使うため、
      //   ここでは処理しない（役割の分担・競合の回避）
      if (phase === STATES.WIN || phase === STATES.LOSE) reset()
    }

    window.addEventListener('keydown', onKey)

    // クリーンアップ: phase / toggleDebug が変化したら古いリスナーを解除して新しく登録し直す
    // ※ onKey はクロージャで phase をキャプチャしているため、
    //   phase が変わったら最新の値を持つ新しい onKey を登録する必要がある
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, reset, toggleDebug])  // これらが変化したときに useEffect を再実行する

  // SPINNING フェーズ中かどうか（ボタンの disabled・スタイル切り替えに使う）
  const isSpinning = phase === STATES.SPINNING

  return (
    <>
      {/* PixiJS の canvas 全体（画面いっぱいに広がる） */}
      <PachinkoCanvas />

      {/* ─── デバッグパネル（右上固定・PixiJS canvas の上に CSS で重ねる）─── */}
      {/* position: fixed + zIndex: 100 で PixiJS canvas（z-index デフォルト 0）の手前に表示 */}
      <div style={styles.panel}>

        {/* ラベル: パネルの説明（キーボードショートカットを案内） */}
        <span style={styles.label}>DEV  [ D ] でトグル</span>

        {/* 現在の抽選確率のバッジ表示（debugMode によって色とテキストが変わる） */}
        {/* スプレッド構文 {...styles.probBadge, background: ...} で基本スタイルに色を上書き */}
        <div style={{ ...styles.probBadge, background: debugMode ? '#7a3200' : '#0d1f2d' }}>
          {debugMode ? '確率  1 / 5' : '確率  1 / 319'}
        </div>

        {/* デバッグモード切り替えボタン */}
        <button
          // onMouseDown で preventDefault: クリック時にボタンがフォーカスを取得するのを防ぐ
          // ※ ボタンがフォーカスを持つと、次の Space キー押下がボタンの「クリック」として
          //   解釈される（ブラウザ標準動作）。これにより玉の打ち込みが止まるバグを防ぐ
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleDebug}  // クリックで確率をトグル
          style={{ ...styles.btn, background: debugMode ? '#b85400' : '#1e3040' }}
        >
          {/* debugMode の状態によってラベルを切り替える（三項演算子） */}
          {debugMode ? 'DEBUG ON ✓' : 'DEBUG OFF'}
        </button>

        {/* 強制 WIN ボタン（変動中は操作不可） */}
        <button
          onMouseDown={(e) => e.preventDefault()}  // 同上: フォーカス取得を防ぐ
          onClick={forceWin}         // クリックで強制当たりを発動
          disabled={isSpinning}      // 変動中は disabled（クリックできない・HTML 標準属性）
          style={{
            ...styles.btn,
            // 変動中はグレーアウト・カーソルを not-allowed に、通常時は緑・pointer に
            background: isSpinning ? '#1a1a1a' : '#006644',
            cursor:     isSpinning ? 'not-allowed' : 'pointer',
          }}
        >
          強制 WIN
        </button>
      </div>
    </>
  )
}

// ── スタイル定義（CSS-in-JS 形式のオブジェクト）────────────────────────────
// なぜ CSS ファイルではなくオブジェクトで書くのか:
//   このコンポーネント専用の小さなスタイルであり、
//   外部 CSS だとクラス名の競合や管理コストが増える。
//   オブジェクト形式なら JS の変数（debugMode など）を直接スタイルに使える。
const styles = {
  panel: {
    position:      'fixed',            // 画面に対して固定（スクロールしても動かない）
    top:           12,                 // 上端から 12px
    right:         12,                 // 右端から 12px
    display:       'flex',             // Flexbox: 子要素を整列させる
    flexDirection: 'column',           // 縦方向（上から下）に並べる
    gap:           6,                  // 子要素間のすき間 6px
    zIndex:        100,                // 重なり順を高くして PixiJS canvas の手前に表示
    background:    'rgba(0,0,0,0.75)', // 半透明の黒背景（canvas が透けて見える）
    border:        '1px solid #334455', // 暗い青のボーダー（パネルの輪郭）
    borderRadius:  6,                  // 角を丸くする
    padding:       '10px 12px',        // 内側の余白（上下 10px・左右 12px）
  },
  label: {
    color:         '#446688',   // 灰青色（控えめな色）
    fontSize:      10,          // 小さめで目立ちすぎない
    fontFamily:    'monospace', // 等幅フォント（数字・記号が揃う）
    letterSpacing: 1,           // 文字間隔を少し広げる
    textAlign:     'center',    // 中央揃え
  },
  probBadge: {
    color:        '#ffffff',          // 白テキスト
    fontSize:     15,
    fontFamily:   'monospace',
    fontWeight:   'bold',
    textAlign:    'center',
    padding:      '4px 8px',          // 内側の余白
    borderRadius: 4,
    border:       '1px solid #ffffff22', // 非常に薄い白のボーダー（微妙な立体感）
    // background は JSX 側で動的に設定（debugMode によって変わるため）
  },
  btn: {
    color:        '#fff',                // 白テキスト
    border:       '1px solid #ffffff22', // 薄い白のボーダー
    borderRadius: 4,
    padding:      '5px 12px',            // 内側の余白
    cursor:       'pointer',             // ポインターカーソル（クリック可能を示す）
    fontSize:     13,
    fontFamily:   'monospace',
    minWidth:     120,                   // 最小幅を揃えてボタンサイズを統一する
    // background・cursor は JSX 側でボタンごとに動的に上書きする
  },
}
