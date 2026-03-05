/**
 * PhysicsEngine.js
 *
 * 役割: Matter.js を使った物理演算の「純粋なモジュール」。
 *       PixiJS（描画）には一切依存せず、位置計算と衝突検知だけを担う。
 *
 * なぜ Matter.js を使うのか:
 *   玉が釘に当たって跳ね返る挙動を自前で計算するのは非常に複雑。
 *   Matter.js は「剛体（かたい物体）」の物理演算ライブラリで、
 *   重力・衝突・摩擦などをフレームごとに自動計算してくれる。
 *   PixiJS は「どこに描くか」を担い、「どこにあるか」を Matter.js に任せることで
 *   役割を明確に分離できる（関心の分離）。
 *
 * 他ファイルとの関係:
 *   PachinkoCanvas.jsx … このモジュールを生成し、毎フレーム step() を呼んで
 *                        Body の位置を PixiJS の Graphics に反映させる
 *   useGameStore.js   … 直接の関係なし（衝突イベントは onHesoHit コールバックで外部に渡す）
 */

// Matter.js をインポート。Matter はすべての機能が入った名前空間オブジェクト
import Matter from 'matter-js'

// 必要なクラス・関数だけを分割代入で取り出す（毎回 Matter.Engine.xxx と書かなくて済む）
// Engine  … 物理シミュレーション全体を管理するコアオブジェクト
// World   … 物体（Body）を追加・削除する「世界（シーン）」
// Bodies  … 四角・円などの物体を生成するファクトリ関数群
// Body    … 個々の物体を操作する関数群（速度の設定など）
// Events  … 衝突などの物理イベントを購読するための関数群
const { Engine, World, Bodies, Body, Events } = Matter

/**
 * createPhysicsEngine(opts)
 *
 * 物理ワールドを初期化し、外部から使える API を返す。
 *
 * なぜクラスではなく関数で作るのか:
 *   クラスより関数の方が React との相性が良く、useEffect のクリーンアップ（destroy）が書きやすい。
 *   また、クロージャによって engine・world・hitIds などの内部変数を外部から隠蔽できる。
 *
 * @param {number}   opts.width      - 画面幅 (px)。壁・釘の配置計算に使う
 * @param {number}   opts.height     - 画面高さ (px)。床の配置計算に使う
 * @param {number}   opts.nailStartY - 釘の最上行の Y 座標（上部に液晶エリアの余白を確保するため）
 * @param {Function} opts.onHesoHit  - ヘソに玉が入ったときに呼ぶコールバック (ball: Matter.Body)
 */
export function createPhysicsEngine({ width, height, nailStartY, onHesoHit }) {

  // ── エンジンとワールドの初期化 ──────────────────────────────────────────

  // Engine.create() で物理シミュレーションのコアを生成する
  // gravity.y: 重力加速度（デフォルト 1.0。2.2 にすると玉が重く・速く落ちる）
  // gravity.x: 横方向の重力（0 = 横には引っ張られない）
  const engine = Engine.create({ gravity: { x: 0, y: 2.2 } })

  // engine.world: このエンジンに紐づく「物体置き場」
  // World.add() で物体を追加すると物理シミュレーションの対象になる
  const world = engine.world

  // ── 壁（床・左右）────────────────────────────────────────────────────────

  // 壁の共通プロパティをまとめておく（DRY: Don't Repeat Yourself）
  // isStatic: true … 動かない静止体（重力・衝突の影響を受けない）
  // restitution: 0.3 … 反発係数（0=まったく跳ねない、1=完全弾性）
  // friction: 0.5   … 摩擦係数（大きいほど滑りにくい）
  // label: 'wall'   … 衝突イベントでの識別用ラベル
  const wallOpts = { isStatic: true, restitution: 0.3, friction: 0.5, label: 'wall' }

  World.add(world, [
    // 床: 画面下端より少し外側（height + 30）に配置。幅は画面の 2 倍にして隙間をなくす
    Bodies.rectangle(width / 2,  height + 30,   width * 2, 60,  wallOpts),
    // 左壁: 画面左端より少し外側（-30）に配置。高さは画面の 2 倍
    Bodies.rectangle(-30,         height / 2,    60, height * 2,  wallOpts),
    // 右壁: 画面右端より少し外側（width + 30）に配置
    Bodies.rectangle(width + 30,  height / 2,    60, height * 2,  wallOpts),
  ])

  // ── 釘（三角形パターン）──────────────────────────────────────────────────
  // パチンコの釘配置: 行ごとに釘の数が 1 本ずつ増える「三角形（ギャラクシアン）配列」

  const NAIL_R  = 5    // 釘の半径 (px)。玉の半径 7px より小さい
  const ROWS    = 9    // 釘の行数（多いほど玉が複雑に跳ねる）

  // X 方向の釘間隔: 画面幅 85% を 10 分割した値と 55px の小さい方
  // ※ Math.min を使うことで画面が狭くても釘が密集しすぎないように上限を設ける
  const X_STEP  = Math.min(55, (width * 0.85) / 10)

  const Y_STEP  = 50       // Y 方向の釘間隔 (px)
  const cx      = width / 2  // 画面中央の X 座標（釘を左右対称に並べる基準点）

  // 釘のデータを配列に蓄積する
  // PixiJS 側がこの配列を参照して描画位置を決めるため、x・y・r を一緒に保存する
  const nailBodies = []

  for (let row = 0; row < ROWS; row++) {
    // 行番号 0 → 3 本、行番号 8 → 11 本（row + 3 本）
    const cols = row + 3
    // この行の釘全体の横幅（釘間隔 × （本数 - 1））
    const rowW = (cols - 1) * X_STEP

    for (let col = 0; col < cols; col++) {
      // X 座標: 行全体の中央を cx に揃えて左から配置
      const x = cx - rowW / 2 + col * X_STEP
      // Y 座標: 最上行の Y + 行番号 × 行間隔
      const y = nailStartY + row * Y_STEP

      // Bodies.circle(x, y, radius, options) で円形の静止体を生成
      const nail = Bodies.circle(x, y, NAIL_R, {
        isStatic:    true,   // 動かない釘
        restitution: 0.55,   // 反発係数（玉が釘に当たってある程度跳ねる）
        friction:    0.04,   // 摩擦は小さく（玉がスムーズに滑り落ちる）
        frictionAir: 0,      // 空気抵抗なし（釘は静止体なので不要）
        label:       'nail', // 衝突検知の識別ラベル
      })

      // PixiJS 描画のために位置情報を保存 / World にも追加
      nailBodies.push({ body: nail, x, y, r: NAIL_R })
      World.add(world, nail)
    }
  }

  // ── ヘソ（中央入賞口）センサー ────────────────────────────────────────────
  // ヘソは「入賞したことを検知するセンサー」。玉を止める壁ではなく通過させる

  const HESO_W = 44   // ヘソの横幅 (px)。玉の直径 14px よりやや広め
  const HESO_H = 14   // ヘソの縦幅 (px)
  const hesoX  = cx   // 画面中央に配置（釘と同じ cx を使う）
  // 釘エリアの最下行の Y + 行間隔 × 行数 + 少し余白
  const hesoY  = nailStartY + ROWS * Y_STEP + 24

  // isSensor: true … 衝突を検知するがめり込み処理は行わない（玉がすり抜ける）
  // ※ これにより玉は「ヘソを通過」し、衝突イベントだけが発火する
  const hesoBodies = Bodies.rectangle(hesoX, hesoY, HESO_W, HESO_H, {
    isStatic: true,    // 動かない
    isSensor: true,    // センサー（衝突反応なし・通過させる）
    label:    'heso',  // 衝突検知の識別ラベル
  })
  World.add(world, hesoBodies)

  // ── ヘソへの衝突検知 ──────────────────────────────────────────────────────

  // 同じ玉が複数フレームで連続ヒットしないよう、処理済みの玉 ID を記録するセット
  // ※ Set は配列より「要素の有無確認（has）」が高速（O(1) vs O(n)）
  const hitIds = new Set()

  // 'collisionStart' イベント: 2 つの物体が接触し始めた瞬間に発火する
  // ※ 'collisionActive' は接触中毎フレーム、'collisionEnd' は離れたとき
  Events.on(engine, 'collisionStart', ({ pairs }) => {
    // pairs: 今フレームで新たに衝突したペアの配列（複数の玉が同時に衝突することもある）
    for (const { bodyA, bodyB } of pairs) {
      // 衝突ペアのうちどちらかが 'heso' ラベルかチェック
      const isHeso = bodyA.label === 'heso' || bodyB.label === 'heso'
      if (!isHeso) continue  // ヘソ以外の衝突（釘同士など）は無視して次へ

      // 'ball' ラベルの方を取り出す（三項演算子の連鎖）
      const ball = bodyA.label === 'ball' ? bodyA
                 : bodyB.label === 'ball' ? bodyB
                 : null  // どちらも ball でない場合（通常は起こらない）

      // ball が存在し、かつ未処理（hitIds に含まれない）場合のみコールバックを呼ぶ
      if (ball && !hitIds.has(ball.id)) {
        hitIds.add(ball.id)  // 重複処理を防ぐため先に記録
        onHesoHit(ball)      // 外部（PachinkoCanvas）に「ヘソ入賞！」を通知
      }
    }
  })

  // ── 公開 API ─────────────────────────────────────────────────────────────
  // return で返すオブジェクトのみが外部から使える（カプセル化）
  // engine・world・hitIds は外部から直接触れない（クロージャで隠蔽）
  return {
    // 釘の位置情報配列。PixiJS で描画するために参照する（body, x, y, r）
    nailBodies,

    // ヘソの位置・サイズ。PixiJS で矩形を描画するために参照する
    heso: { x: hesoX, y: hesoY, w: HESO_W, h: HESO_H },

    /**
     * createBall(x, y)
     * 指定位置に玉（円形ボディ）を生成してワールドに追加する。
     * 呼び出し元: PachinkoCanvas.jsx のティッカー（Space 押しっぱなし時）
     */
    createBall(x, y) {
      // 半径 7 の円形ボディを生成
      const ball = Bodies.circle(x, y, 7, {
        restitution: 0.42,   // 反発係数（釘 0.55 より低く、ふんわり跳ねる）
        friction:    0.01,   // 摩擦小（転がりやすい）
        frictionAir: 0.004,  // 空気抵抗（大きくすると落下が遅くなる）
        density:     0.003,  // 密度（小さいほど軽く、釘に弾かれやすい）
        label:       'ball', // 衝突検知の識別ラベル
      })

      // 初速を与える: X はランダムに左右にぶれる、Y はわずかに下向き
      // ※ (Math.random() - 0.5) は -0.5 〜 +0.5 の値 → * 3 で -1.5 〜 +1.5
      Body.setVelocity(ball, { x: (Math.random() - 0.5) * 3, y: 2 })

      World.add(world, ball)  // ワールドに追加してシミュレーション開始

      return ball  // PachinkoCanvas 側で Matter.Body ↔ PixiJS.Graphics の対応に使う
    },

    /**
     * removeBall(ball)
     * 玉をワールドから削除する。
     * 呼び出し元: PachinkoCanvas.jsx のティッカー（画面外に出た / ヘソ入賞時）
     */
    removeBall(ball) {
      hitIds.delete(ball.id)  // ヒット記録から削除（メモリリーク防止）
      World.remove(world, ball)  // 物理ワールドから除外（以後シミュレーション対象外）
    },

    /**
     * step()
     * 物理シミュレーションを 1 フレーム分進める。
     * 呼び出し元: PachinkoCanvas.jsx の PixiJS ティッカー（毎フレーム呼ばれる）
     *
     * なぜ固定タイムステップ（1000/60 ms）にするのか:
     *   可変タイムステップ（実際の経過時間）だと、処理落ち時に物体が壁をすり抜けるなど
     *   予期しない挙動が起きやすい。固定にすることで物理演算が常に安定する。
     */
    step() {
      Engine.update(engine, 1000 / 60)  // 1000ms / 60fps ≒ 16.67ms を 1 フレームとして進める
    },

    /**
     * destroy()
     * エンジンを完全に破棄する。
     * 呼び出し元: PachinkoCanvas.jsx の useEffect クリーンアップ（コンポーネントのアンマウント時）
     *
     * なぜクリーンアップが必要か:
     *   React の開発モード（StrictMode）ではコンポーネントが 2 回マウントされることがある。
     *   古いエンジンをそのままにするとメモリリークやイベント二重登録が起きる。
     */
    destroy() {
      Events.off(engine)         // このエンジンの全イベントリスナーを解除
      World.clear(world, false)  // ワールド内の全物体を削除（false = 静止体も含めて全削除）
      Engine.clear(engine)       // エンジン自体のリソースを解放
    },
  }
}
