/**
 * PachinkoCanvas.jsx
 *
 * 役割: PixiJS による描画と Matter.js 物理演算を「つなぐ」コーディネーター。
 *
 * 責務の分離（関心の分離）:
 *   PhysicsEngine.js  … Matter.js で位置・衝突を計算する（描画には触れない）
 *   PachinkoCanvas.jsx … PixiJS でレンダリング + Matter.js の Body 位置を Graphics に反映
 *   useGameStore.js   … ゲーム状態（フェーズ・玉数）を管理する
 *
 * なぜ PixiJS Ticker に一本化するのか:
 *   Matter.js の Runner（独自の RAF ループ）と PixiJS Ticker を両立すると
 *   「1 フレームに物理が 2 回進む」ような同期ズレが起きる。
 *   Ticker の中で physics.step() を呼ぶことで 1 RAF = 1 物理ステップに揃える。
 *
 * 毎フレームの処理順:
 *   1. physics.step()   … 物理を 1 フレーム進める（Body の位置が更新される）
 *   2. 玉の同期         … Matter.js Body.position → PixiJS Graphics の x/y に反映
 *   3. 玉の生成         … Space 押しっぱなし中に一定間隔で玉を生成
 *   4. 玉の削除         … 画面外に出た玉を除去（メモリリーク防止）
 *   5. UI 更新          … 持ち玉数テキストを最新値に更新
 */

// React の useEffect（副作用の登録）と useRef（再レンダリングを発生させない値の保持）をインポート
import { useEffect, useRef } from 'react'

// PixiJS から必要なクラスを名前付きインポート
// Application     … PixiJS のメインクラス。canvas・Ticker・Stage を管理する
// Container       … 複数の DisplayObject をグループ化する入れ物（描画レイヤーに使う）
// Graphics        … 図形（円・矩形など）を動的に描画するクラス（毎フレーム描き直し可能）
// Text            … テキストを描画するクラス
// TextStyle       … フォント・色・影などのスタイル定義オブジェクト
// TEXT_GRADIENT   … テキストグラデーションの方向定数（LINEAR_VERTICAL = 縦方向）
// ColorMatrixFilter … 色行列でフィルタリング（brightness などで輝度変換に使う）
import {
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
  TEXT_GRADIENT,
  ColorMatrixFilter,
} from 'pixi.js'

// Zustand ストアと状態定数をインポート
// useGameStore … React コンポーネント内でフック的に購読する
// STATES       … フェーズ名の定数（'IDLE' / 'SPINNING' / 'WIN' / 'LOSE'）
import useGameStore, { STATES } from '../store/useGameStore'

// 物理エンジン生成関数をインポート（PhysicsEngine.js が提供する純粋関数）
import { createPhysicsEngine } from './PhysicsEngine'

// ── モジュールレベル定数 ───────────────────────────────────────────────────────

// 玉の描画半径 (px)。PhysicsEngine 内の createBall の radius=7 と揃えること
// （描画と物理の大きさが一致しないと視覚的にズレる）
const BALL_RADIUS = 7

// 玉を生成するフレーム間隔（8 フレームに 1 個 ≒ 60fps で 7.5 個/秒）
// 小さくするほど速い連射になる。大きくするとゆっくりになる
const SPAWN_INTERVAL = 8

// ── コンポーネント ───────────────────────────────────────────────────────────

export default function PachinkoCanvas() {

  // ── Ref（フレームをまたいで値を保持するが、変化しても再レンダリングしない）──
  // なぜ useState ではなく useRef を使うのか:
  //   ティッカー（毎フレーム処理）内で使う値を useState にすると
  //   更新のたびに React が再レンダリングし、PixiJS の再初期化が起きてしまう。
  //   useRef は .current を更新しても再レンダリングが発生しない。

  const containerRef  = useRef(null)         // PixiJS canvas を挿入する DOM 要素
  const appRef        = useRef(null)         // PixiJS Application インスタンス
  const sceneRef      = useRef(null)         // フェーズ変化時に参照する PixiJS オブジェクト群
  const physicsRef    = useRef(null)         // PhysicsEngine インスタンス（クリーンアップで destroy）

  // Matter.Body → PixiJS.Graphics のマッピング
  // Map を使う理由: O(1) で「Body に対応する Graphics」を検索・削除できる
  // （配列の find は O(n) なので玉が多いと遅くなる）
  const ballsMapRef   = useRef(new Map())

  // フェーズごとのアニメーション用ティッカー関数
  // フェーズが変わるたびに前のものを remove して新しいものを add する
  const gameTickerRef = useRef(null)

  // Space キーが現在押しっぱなしかどうかのフラグ
  // useState にしない理由: 値が変わっても再レンダリング不要 + ティッカー内で参照するため
  const spaceHeldRef  = useRef(false)

  // 玉の生成タイマー（フレームカウンター）
  // SPAWN_INTERVAL フレームに達したら玉を 1 個生成してリセット
  const spawnTimerRef = useRef(0)

  // フェーズと showCutin を Zustand ストアから購読する
  // ※ これらの値が変化すると React がこのコンポーネントを再レンダリングし、
  //   下の useEffect([phase, showCutin]) が走って UI が更新される
  const phase     = useGameStore((s) => s.phase)
  const showCutin = useGameStore((s) => s.showCutin)

  // ────────────────────────────────────────────────────────────────────────
  // 初期化 useEffect（コンポーネントのマウント時に 1 回だけ実行）
  // 依存配列 [] = マウント後に 1 度だけ実行し、以降は実行しない
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current  // <div ref={containerRef}> の DOM 要素
    const W = window.innerWidth             // 画面幅（PixiJS はピクセル単位で指定）
    const H = window.innerHeight            // 画面高さ

    // ── PixiJS アプリケーションの初期化 ────────────────────────────────────
    // Application がやること: WebGL（または Canvas 2D）コンテキストの作成・管理、
    //   Stage（シーンのルート）の用意、Ticker（RAF ループ）の管理
    // PixiJS v7 は new Application({...}) で同期的に初期化できる（v8 では非同期になった）
    const app = new Application({
      width:           W,          // canvas の幅
      height:          H,          // canvas の高さ
      backgroundColor: 0x000e1a,   // 背景色（16 進数 RGB: 濃い紺色 = #000e1a）
      antialias:       true,       // アンチエイリアス（円や斜め線を滑らかに描く）
    })

    // app.view は PixiJS が生成した <canvas> 要素
    // React の JSX では直接 canvas を扱いにくいため、DOM 操作で div に挿入する
    container.appendChild(app.view)

    // Ref に保存: 他の useEffect やクリーンアップから参照できるようにする
    appRef.current = app

    // ── 物理エンジンの初期化 ────────────────────────────────────────────────
    // 釘の最上行の Y 座標: 画面高さの 20% の位置
    // ※ 上部 20% は液晶（図柄・カットイン）エリアとして確保する
    const NAIL_START_Y = H * 0.20

    const physics = createPhysicsEngine({
      width:      W,
      height:     H,
      nailStartY: NAIL_START_Y,

      // onHesoHit: PhysicsEngine.js から「ヘソに玉が入った！」と通知されるコールバック
      // ※ この関数は Matter.js の衝突イベント内から呼ばれる（React の外）
      onHesoHit: (ball) => {
        // React hooks の外なので useGameStore.getState() で同期的にストアにアクセスする
        // ※ hooks（useGameStore(s => s.xxx)）は React コンポーネント内でしか使えない
        const store = useGameStore.getState()
        store.addBalls(10)    // ヘソ入賞の賞球: 持ち玉 +10
        store.startSpin()     // 抽選を開始し、SPINNING フェーズへ移行

        // ヘソに入った玉と対応する PixiJS Graphics を即座に除去する
        // ※ Physics の World からも除去しないとシミュレーションが継続してしまう
        const gfx = ballsMapRef.current.get(ball)  // Map から対応 Graphics を取得
        if (gfx) {
          gfx.destroy()                      // PixiJS オブジェクトのメモリを解放
          ballsMapRef.current.delete(ball)   // Map から削除（GC が回収できるようにする）
        }
        physicsRef.current?.removeBall(ball) // 物理ワールドからも削除（?. = null なら無視）
      },
    })

    // Ref に保存: クリーンアップで physics.destroy() を呼ぶために必要
    physicsRef.current = physics

    // ── 背景装飾（大きな薄い円）────────────────────────────────────────────
    // Graphics は「命令型」で図形を描くクラス（beginFill → draw → endFill の順）
    // 静的な装飾なので一度だけ描いて以後更新しない
    const decor = new Graphics()
    decor.lineStyle(1, 0x112244, 0.45)  // 線の太さ・色（濃紺）・不透明度（0〜1）
    decor.drawCircle(W / 2, H / 2, Math.min(W, H) * 0.46)  // 画面中央に大きな円
    app.stage.addChild(decor)  // Stage に追加 = 描画対象になる（addChild の順が描画レイヤー順）

    // ── 釘の描画（静止体 → 一度だけ描画、毎フレーム更新不要）─────────────────
    // physics.nailBodies は PhysicsEngine が返す { body, x, y, r } の配列
    // ここではその x / y / r だけを PixiJS の描画に使う
    const nailGfx = new Graphics()
    physics.nailBodies.forEach(({ x, y, r }) => {
      // 釘本体: 暗いスレートブルー
      nailGfx.beginFill(0x4a6070)
      nailGfx.drawCircle(x, y, r)
      nailGfx.endFill()

      // 光沢ハイライト: 左上に小さい明るい円を重ねて立体感を出す
      nailGfx.beginFill(0x8aaabb, 0.6)              // 薄い水色・60% 不透明
      nailGfx.drawCircle(x - 1, y - 1, r * 0.45)   // 左上に 1px ずらして小さく描く
      nailGfx.endFill()
    })
    app.stage.addChild(nailGfx)

    // ── ヘソ（中央入賞口）の描画 ────────────────────────────────────────────
    // physics.heso = { x, y, w, h } — PhysicsEngine が計算した位置・サイズ
    // 分割代入で短い名前に別名をつける（hx / hy / hw / hh）
    const { x: hx, y: hy, w: hw, h: hh } = physics.heso

    const hesoGfx = new Graphics()
    // 赤い角丸矩形（drawRoundedRect: 引数 = 左上 x, 左上 y, 幅, 高さ, 角丸半径）
    // ※ PixiJS の座標は「左上原点」なので中心座標 hx/hy から hw/2・hh/2 引く
    hesoGfx.beginFill(0xcc2200)
    hesoGfx.drawRoundedRect(hx - hw / 2, hy - hh / 2, hw, hh, 4)
    hesoGfx.endFill()
    // 縁取り（赤みオレンジ、80% 不透明）
    hesoGfx.lineStyle(1, 0xff6644, 0.8)
    hesoGfx.drawRoundedRect(hx - hw / 2, hy - hh / 2, hw, hh, 4)

    // 「ヘソ」ラベルテキスト
    const hesoLabel = new Text('ヘソ', new TextStyle({
      fontFamily: 'sans-serif', fontSize: 9, fill: '#ffbbaa', fontWeight: 'bold',
    }))
    hesoLabel.anchor.set(0.5)  // anchor(0.5, 0.5) = テキストの中心を基準点にする（位置合わせが楽になる）
    hesoLabel.x = hx           // ヘソの中央 X に配置
    hesoLabel.y = hy           // ヘソの中央 Y に配置
    app.stage.addChild(hesoGfx)
    app.stage.addChild(hesoLabel)

    // ── 玉コンテナ（釘の上・UI テキストの下に位置する描画レイヤー）────────────
    // Container は複数の Graphics をグループ化する入れ物
    // addChild の順番が描画レイヤーの順番になる（後から追加 = 手前に表示）
    const ballContainer = new Container()
    app.stage.addChild(ballContainer)  // 釘の上、UI テキストの下のレイヤーに挿入

    // ── UI テキスト群（最前面 = addChild の最後に追加）──────────────────────

    // 図柄テキスト（3 桁）: 変動中はランダムな数字、当落時は固定値
    const digitStyle = new TextStyle({
      fontFamily:          '"Courier New", monospace',  // 等幅フォントで 3 桁の幅が揃う
      fontSize:            68,
      fontWeight:          'bold',
      fill:                '#c8d8ff',                   // 薄い青白色（通常時）
      dropShadow:          true,                        // ドロップシャドウを有効化
      dropShadowColor:     '#003399',                   // 影の色（濃い青）
      dropShadowBlur:      12,                          // 影のぼかし半径（大きいほどふんわり）
      dropShadowAngle:     Math.PI / 2,                 // 影の角度（π/2 = 真下）
      dropShadowDistance:  0,                           // 距離 0 = 影が背後に重なって光彩のように見える
    })

    // 中央から -96 / 0 / +96 の 3 か所に図柄テキストを配置する
    const digits = [-96, 0, 96].map((dx) => {
      const t = new Text('0', digitStyle.clone())  // clone() でスタイルを独立コピー（各桁で別管理）
      t.anchor.set(0.5)       // テキストの中心を基準点に（x/y で中央配置しやすくなる）
      t.x = W / 2 + dx        // 画面中央からのオフセット
      t.y = H * 0.075         // 画面上部 7.5% の位置
      app.stage.addChild(t)
      return t                // 後で digits[0] / digits[1] / digits[2] として参照する
    })

    // 図柄の区切り線（縦線 2 本: 左桁と中央桁の間、中央桁と右桁の間）
    const dividers = new Graphics()
    dividers.lineStyle(1, 0x224466, 0.5)  // 暗い青・50% 不透明
    for (const dx of [-48, 48]) {          // 左右対称の 2 本
      dividers.moveTo(W / 2 + dx, H * 0.035)  // 線の開始点（図柄エリアの上端）
      dividers.lineTo(W / 2 + dx, H * 0.115)  // 線の終点（図柄エリアの下端）
    }
    app.stage.addChild(dividers)

    // ステータステキスト（フェーズに応じて書き換える）
    const statusText = new Text('Space を押しっぱなしで玉を打ち込もう', new TextStyle({
      fontFamily:    'sans-serif',
      fontSize:      17,
      fill:          '#6688aa',  // 灰青色（待機中のガイドテキスト）
      letterSpacing: 1,          // 文字間隔を少し広げて読みやすくする
    }))
    statusText.anchor.set(0.5)   // 中央揃え
    statusText.x = W / 2         // 画面中央
    statusText.y = H * 0.145     // 図柄の少し下
    app.stage.addChild(statusText)

    // 持ち玉数テキスト（左上固定表示）
    // ※ React の state ではなく毎フレーム getState() で最新値を読んで書き換える
    //   → 理由: state にすると玉が増減するたびに React の再レンダリングが走り、
    //     PixiJS の初期化（[] の useEffect）が再実行される可能性があるため
    const ballCountText = new Text('玉: 100', new TextStyle({
      fontFamily: 'monospace', fontSize: 15, fill: '#88aacc',
    }))
    ballCountText.x = 14   // 左端から 14px
    ballCountText.y = 10   // 上端から 10px
    app.stage.addChild(ballCountText)

    // カットインバー（「激アツ！」テキストの背景になる黒帯）
    const cutinBar = new Graphics()
    cutinBar.beginFill(0x000000, 0.88)       // 黒・88% 不透明
    cutinBar.drawRect(0, H * 0.01, W, 80)   // 画面上部にほぼ全幅の帯（高さ 80px）
    cutinBar.endFill()
    cutinBar.visible = false  // 初期非表示（SPINNING + showCutin=true のときのみ表示）
    app.stage.addChild(cutinBar)

    // カットインテキスト「激アツ！」（金グラデーション）
    const cutinText = new Text('激アツ！', new TextStyle({
      fontFamily:          'sans-serif',
      fontSize:            54,
      fontWeight:          'bold',
      fill:                ['#ffd700', '#ff8c00'],       // 上が金色、下がオレンジのグラデーション
      fillGradientType:    TEXT_GRADIENT.LINEAR_VERTICAL, // 縦方向グラデーション
      stroke:              '#3a1f00',                    // 文字の縁取り色（焦げ茶）
      strokeThickness:     4,                            // 縁取りの太さ (px)
      dropShadow:          true,
      dropShadowColor:     '#ffaa00',                    // 影の色（金色の光彩）
      dropShadowBlur:      18,
      dropShadowDistance:  0,
    }))
    cutinText.anchor.set(0.5)   // テキスト中央を基準点に
    cutinText.x = W / 2         // 画面中央
    cutinText.y = H * 0.048     // カットインバーの中央付近
    cutinText.visible = false   // 初期非表示
    app.stage.addChild(cutinText)

    // 後から他の useEffect や physicsTicker で参照するために Ref にまとめて保存する
    sceneRef.current = { digits, statusText, ballContainer, ballCountText, cutinBar, cutinText }

    // ── 統合ティッカー（物理 + 描画同期を毎フレーム実行）─────────────────────
    // app.ticker.add() に登録した関数は毎フレーム（≒ 60fps）呼ばれる
    // ※ PixiJS Ticker は内部で requestAnimationFrame を使っている
    const ballsMap = ballsMapRef.current  // Map を変数に取り出す（.current を毎回辿らなくてよい）

    const physicsTicker = () => {

      // 1. 物理を 1 ステップ進める
      //    これにより Matter.js が全 Body の位置・速度を更新する（重力・衝突計算）
      physics.step()

      // 2. 玉の Graphics を Matter.js Body の位置に同期 / 画面外の玉を削除
      for (const [ball, gfx] of ballsMap) {
        if (ball.position.y > H + 60) {
          // 画面下端より 60px 以上外に出たら削除（+60 は余裕を持たせるため）
          gfx.destroy()                         // PixiJS オブジェクトのメモリを解放
          ballsMap.delete(ball)                 // Map から削除
          physicsRef.current?.removeBall(ball)  // 物理ワールドからも削除
        } else {
          // Matter.js Body の現在位置を PixiJS Graphics の x / y に反映する
          // ※ Graphics は (0,0) を中心に描かれているので、x/y の変更で位置が変わる
          gfx.x = ball.position.x
          gfx.y = ball.position.y
        }
      }

      // 3. Space 押しっぱなし → SPAWN_INTERVAL フレームごとに玉を 1 個生成する
      if (spaceHeldRef.current) {
        spawnTimerRef.current++  // フレームカウンターをインクリメント

        if (spawnTimerRef.current >= SPAWN_INTERVAL) {
          spawnTimerRef.current = 0  // カウンターリセット

          // Zustand から最新状態を同期取得（hooks ではなく getState() を使う）
          const store = useGameStore.getState()

          // consumeBall() が true を返した場合のみ玉を生成（玉切れガード）
          if (store.consumeBall()) {
            // 画面上部中央付近からランダムな X 位置で生成（90px 幅でばらつかせる）
            const spawnX = W / 2 + (Math.random() - 0.5) * 90
            const mBall  = physics.createBall(spawnX, 12)  // Matter.js の Body を生成・追加

            // 対応する PixiJS Graphics を生成する
            const gfx = new Graphics()
            // 玉本体: 薄い水色
            gfx.beginFill(0xddeeff)
            gfx.drawCircle(0, 0, BALL_RADIUS)  // 中心 (0,0) に描く（x/y で位置制御）
            gfx.endFill()
            // 光沢ハイライト（左上の小さい白い円で立体感を出す）
            gfx.beginFill(0xffffff, 0.55)       // 白・55% 不透明
            gfx.drawCircle(-2, -2, BALL_RADIUS * 0.38)  // 左上に 2px ずらして小さく
            gfx.endFill()

            ballContainer.addChild(gfx)    // 玉レイヤー（Container）に追加
            ballsMap.set(mBall, gfx)       // Matter.Body と PixiJS.Graphics を紐づけ
          }
        }
      } else {
        // Space が離されたらカウンターをリセット（次回押し始めから即座に生成できるよう）
        spawnTimerRef.current = 0
      }

      // 4. 持ち玉数テキストを毎フレーム最新値に更新する
      //    getState() は同期的に最新値を返すため React の re-render は発生しない
      const sc = sceneRef.current
      if (sc) {
        sc.ballCountText.text = `玉: ${useGameStore.getState().ballCount}`
      }
    }

    // ティッカーに登録（毎フレーム physicsTicker が呼ばれるようになる）
    app.ticker.add(physicsTicker)

    // ── Space キーの追跡（押しっぱなし検知）────────────────────────────────
    // keydown: キーが押された瞬間に発火（押しっぱなしでもリピートで発火し続ける場合あり）
    const onKeyDown = (e) => { if (e.code === 'Space') spaceHeldRef.current = true  }
    // keyup: キーが離された瞬間に発火
    const onKeyUp   = (e) => { if (e.code === 'Space') spaceHeldRef.current = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)

    // ── クリーンアップ（コンポーネントのアンマウント時に実行）──────────────────
    // useEffect が返す関数は React が自動的に「クリーンアップ関数」として呼ぶ
    // ※ イベントリスナーや外部リソースを解放しないとメモリリークや誤動作が起きる
    return () => {
      // Space キーのリスナーを解除（登録時と同じ関数参照を渡すことが重要）
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)

      // フェーズアニメーション用ティッカーが動いていれば停止する
      if (gameTickerRef.current) {
        app.ticker.remove(gameTickerRef.current)
        gameTickerRef.current = null
      }

      // 統合ティッカー（物理 + 同期）を停止する
      app.ticker.remove(physicsTicker)

      // 物理エンジンを完全に破棄する
      // （イベントリスナー解除 → ワールド内の全物体削除 → エンジン解放）
      physics.destroy()

      // Map を空にして GC がメモリを回収できるようにする
      ballsMap.clear()

      // PixiJS アプリを破棄する（canvas 削除・WebGL コンテキスト解放）
      // { children: true } で Stage 配下の全オブジェクトも合わせて破棄
      app.destroy(true, { children: true })

      // Ref をリセット（次回マウント時に古い参照が残らないようにする）
      appRef.current     = null
      sceneRef.current   = null
      physicsRef.current = null
    }
  }, [])  // 依存配列が空 [] = マウント時のみ実行

  // ────────────────────────────────────────────────────────────────────────
  // フェーズ変化 useEffect（phase または showCutin が変わるたびに実行）
  // ゲームの局面に応じて PixiJS の UI（図柄・テキスト・カットイン・フィルター）を切り替える
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const app   = appRef.current    // PixiJS Application（初期化 useEffect で設定）
    const scene = sceneRef.current  // 初期化時に作成した PixiJS オブジェクト群
    if (!app || !scene) return      // まだ初期化が完了していない場合は何もしない（ガード節）

    const { digits, statusText, cutinBar, cutinText } = scene

    // 前フェーズで動いていたアニメーション用ティッカーを停止する
    // ※ 停止しないと複数のティッカーが重複して動き続ける（メモリリーク・視覚バグ）
    if (gameTickerRef.current) {
      app.ticker.remove(gameTickerRef.current)
      gameTickerRef.current = null
    }

    // 前フェーズの ColorMatrixFilter（輝度変換）をリセットする
    // null を代入すると全フィルターが解除される
    app.stage.filters = null

    // カットインを非表示にするヘルパー関数（複数のフェーズで使うので共通化）
    const hideCutin = () => {
      cutinBar.visible  = false
      cutinText.visible = false
    }

    // ── フェーズごとの UI 処理 ────────────────────────────────────────────

    if (phase === STATES.IDLE) {
      // 待機中: 図柄を '0' にリセット・青白色、ガイドテキストを表示、カットイン非表示
      digits.forEach((d) => { d.text = '0'; d.style.fill = '#c8d8ff' })
      statusText.text       = 'Space を押しっぱなしで玉を打ち込もう'
      statusText.style.fill = '#6688aa'  // 灰青色（目立ちすぎない）
      hideCutin()
    }

    else if (phase === STATES.SPINNING) {
      // 変動中: ステータステキストを黄色に、図柄をランダムに回転させる
      statusText.text       = '変動中...'
      statusText.style.fill = '#ffff66'  // 黄色（注目を引く）
      digits.forEach((d) => { d.style.fill = '#c8d8ff' })

      if (showCutin) {
        // カットイン演出あり: バーとテキストを表示 + 画面全体を明るくする
        cutinBar.visible  = true
        cutinText.visible = true

        // ColorMatrixFilter で画面全体の輝度を上げる（Bloom 的な発光演出）
        // ※ ColorMatrixFilter は PixiJS 組み込み（pixi-filters パッケージ不要）
        const cmf = new ColorMatrixFilter()
        cmf.brightness(1.28, false)  // 1.0 = 変化なし、1.28 = 28% 明るく
        // false = 既存の行列に乗算せず新規に設定する
        app.stage.filters = [cmf]   // Stage 全体（すべての描画物）にフィルター適用
      } else {
        hideCutin()
      }

      // 変動アニメーション用ティッカー関数（フレームごとに図柄をランダムに変える）
      const spinFn = () => {
        // 各図柄を 0〜9 のランダムな数字に変える（高速スクロール感の演出）
        digits.forEach((d) => { d.text = String(Math.floor(Math.random() * 10)) })

        if (showCutin) {
          // カットインテキストをサインカーブでスケーリングして脈動させる
          // Math.sin(Date.now() / 220): 約 1.4 秒周期で -1〜+1 を行き来する値
          // Date.now() を使うことでフレームレートに依存しない時刻ベースのアニメーションになる
          const pulse = Math.sin(Date.now() / 220)
          cutinText.scale.set(1 + pulse * 0.06)      // スケールを ±6% 変動
          cutinBar.alpha = 0.7 + Math.abs(pulse) * 0.3  // 透明度を 0.7〜1.0 で変動
        }
      }

      gameTickerRef.current = spinFn  // クリーンアップ用に Ref に保存
      app.ticker.add(spinFn)          // ティッカーに登録して毎フレーム実行
    }

    else if (phase === STATES.WIN) {
      // 大当たり: 3 桁すべて同じ数字・金色、当たりテキストを表示
      hideCutin()  // カットインバーは非表示に（役目を終えた）

      // 3 桁を同じランダム数字にする（777・333 など「ゾロ目」の演出）
      const winNum = String(Math.floor(Math.random() * 10))
      digits.forEach((d) => { d.text = winNum; d.style.fill = '#ffd700' })  // 金色

      statusText.text       = '大当たり！！  ─  SPACE でリセット'
      statusText.style.fill = '#ffd700'  // 金色
    }

    else if (phase === STATES.LOSE) {
      // 外れ: 3 桁が「リーチならず」の組み合わせ、暗い色で「負けた感」を演出
      hideCutin()

      const r = () => Math.floor(Math.random() * 10)  // 0〜9 のランダム整数を返す関数
      let a = r(), b = r(), c = r()

      // 3 桁が偶然すべて同じになった場合は c を +1 して「ゾロ目」を避ける
      // ※ 外れなのに 777 が出てしまうと誤解を招くため
      // % 10 は「10 になったら 0 に折り返す」（剰余演算）
      if (a === b && b === c) c = (c + 1) % 10

      digits[0].text = String(a)
      digits[1].text = String(b)
      digits[2].text = String(c)
      digits.forEach((d) => { d.style.fill = '#445566' })  // 暗い灰青色（落胆感）

      statusText.text       = '外れ...  ─  SPACE でリセット'
      statusText.style.fill = '#445566'
    }
  }, [phase, showCutin])  // phase または showCutin が変わったときに実行

  // ── JSX レンダリング ───────────────────────────────────────────────────────
  // PixiJS は独自の canvas に描画するため、React のレンダリングは
  // 「canvas を挿入する空の div」だけを返す（React の仮想 DOM は最小限にとどめる）
  return (
    <div
      ref={containerRef}  // useEffect 内で container.appendChild(app.view) するための参照
      style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#000e1a' }}
    />
  )
}
