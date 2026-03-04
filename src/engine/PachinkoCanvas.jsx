import { useEffect, useRef } from 'react'
import {
  Application,
  Graphics,
  Text,
  TextStyle,
  TEXT_GRADIENT,
  ColorMatrixFilter,
} from 'pixi.js'
import useGameStore, { STATES } from '../store/useGameStore'

export default function PachinkoCanvas() {
  const containerRef = useRef(null)
  const appRef = useRef(null)
  const sceneRef = useRef(null)
  const tickerFnRef = useRef(null)

  const phase = useGameStore((s) => s.phase)
  const showCutin = useGameStore((s) => s.showCutin)

  // ── PixiJS 初期化（マウント時のみ）────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    const W = window.innerWidth
    const H = window.innerHeight

    const app = new Application({
      width: W,
      height: H,
      backgroundColor: 0x000e1a,
      antialias: true,
    })
    container.appendChild(app.view)
    appRef.current = app

    // 背景リング
    const decor = new Graphics()
    decor.lineStyle(2, 0x112244, 0.7)
    decor.drawCircle(W / 2, H / 2, Math.min(W, H) * 0.38)
    decor.lineStyle(1, 0x112244, 0.35)
    decor.drawCircle(W / 2, H / 2, Math.min(W, H) * 0.44)
    app.stage.addChild(decor)

    // 図柄（3桁スロット）
    const digitStyle = new TextStyle({
      fontFamily: '"Courier New", monospace',
      fontSize: 96,
      fontWeight: 'bold',
      fill: '#c8d8ff',
      dropShadow: true,
      dropShadowColor: '#003399',
      dropShadowBlur: 16,
      dropShadowAngle: Math.PI / 2,
      dropShadowDistance: 0,
    })
    const digits = [-130, 0, 130].map((xOffset) => {
      const t = new Text('0', digitStyle.clone())
      t.anchor.set(0.5)
      t.x = W / 2 + xOffset
      t.y = H / 2 - 20
      app.stage.addChild(t)
      return t
    })

    // 図柄区切り線
    const dividers = new Graphics()
    dividers.lineStyle(1, 0x224466, 0.6)
    for (const dx of [-65, 65]) {
      dividers.moveTo(W / 2 + dx, H / 2 - 68)
      dividers.lineTo(W / 2 + dx, H / 2 + 48)
    }
    app.stage.addChild(dividers)

    // ステータステキスト
    const statusText = new Text('SPACE キーを押してください', new TextStyle({
      fontFamily: 'sans-serif',
      fontSize: 22,
      fill: '#6688aa',
      letterSpacing: 2,
    }))
    statusText.anchor.set(0.5)
    statusText.x = W / 2
    statusText.y = H / 2 + 110
    app.stage.addChild(statusText)

    // カットインバー
    const cutinBar = new Graphics()
    cutinBar.beginFill(0x000000, 0.8)
    cutinBar.drawRect(0, H / 2 - 250, W, 120)
    cutinBar.endFill()
    cutinBar.visible = false
    app.stage.addChild(cutinBar)

    // カットインテキスト（金グラデ）
    const cutinText = new Text('激アツ！', new TextStyle({
      fontFamily: 'sans-serif',
      fontSize: 72,
      fontWeight: 'bold',
      fill: ['#ffd700', '#ff8c00'],
      fillGradientType: TEXT_GRADIENT.LINEAR_VERTICAL,
      stroke: '#3a1f00',
      strokeThickness: 5,
      dropShadow: true,
      dropShadowColor: '#ffaa00',
      dropShadowBlur: 22,
      dropShadowDistance: 0,
    }))
    cutinText.anchor.set(0.5)
    cutinText.x = W / 2
    cutinText.y = H / 2 - 192
    cutinText.visible = false
    app.stage.addChild(cutinText)

    sceneRef.current = { digits, statusText, cutinBar, cutinText }

    return () => {
      if (tickerFnRef.current) {
        app.ticker.remove(tickerFnRef.current)
        tickerFnRef.current = null
      }
      app.destroy(true, { children: true })
      appRef.current = null
      sceneRef.current = null
    }
  }, [])

  // ── フェーズ変化に応じてシーン更新 ────────────────────────────────────
  useEffect(() => {
    const app = appRef.current
    const scene = sceneRef.current
    if (!app || !scene) return

    const { digits, statusText, cutinBar, cutinText } = scene

    // 前フェーズのティッカー・フィルタを解除
    if (tickerFnRef.current) {
      app.ticker.remove(tickerFnRef.current)
      tickerFnRef.current = null
    }
    app.stage.filters = null

    // カットインを非表示にするヘルパー
    const hideCutin = () => {
      cutinBar.visible = false
      cutinText.visible = false
    }

    if (phase === STATES.IDLE) {
      digits.forEach((d) => { d.text = '0'; d.style.fill = '#c8d8ff' })
      statusText.text = 'SPACE キーを押してください'
      statusText.style.fill = '#6688aa'
      hideCutin()
    }

    else if (phase === STATES.SPINNING) {
      statusText.text = '変動中...'
      statusText.style.fill = '#ffff66'
      digits.forEach((d) => { d.style.fill = '#c8d8ff' })

      if (showCutin) {
        cutinBar.visible = true
        cutinText.visible = true
        const cmf = new ColorMatrixFilter()
        cmf.brightness(1.28, false)
        app.stage.filters = [cmf]
      } else {
        hideCutin()
      }

      const spinFn = () => {
        digits.forEach((d) => { d.text = String(Math.floor(Math.random() * 10)) })
        if (showCutin) {
          const pulse = Math.sin(Date.now() / 220)
          cutinText.scale.set(1 + pulse * 0.06)
          cutinBar.alpha = 0.7 + Math.abs(pulse) * 0.3
        }
      }
      tickerFnRef.current = spinFn
      app.ticker.add(spinFn)
    }

    else if (phase === STATES.WIN) {
      hideCutin()
      // 揃い目をランダムに（毎回違う数字）
      const winNum = String(Math.floor(Math.random() * 10))
      digits.forEach((d) => { d.text = winNum; d.style.fill = '#ffd700' })
      statusText.text = '大当たり！！  ─  SPACE でリセット'
      statusText.style.fill = '#ffd700'
    }

    else if (phase === STATES.LOSE) {
      hideCutin()
      // 3桁をランダムに。全部揃うのを防ぐ（揃うと当たりに見えるため）
      const r = () => Math.floor(Math.random() * 10)
      let a = r(), b = r(), c = r()
      if (a === b && b === c) c = (c + 1) % 10
      digits[0].text = String(a)
      digits[1].text = String(b)
      digits[2].text = String(c)
      digits.forEach((d) => { d.style.fill = '#445566' })
      statusText.text = '外れ...  ─  SPACE でリセット'
      statusText.style.fill = '#445566'
    }
  }, [phase, showCutin])

  return (
    <div
      ref={containerRef}
      style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#000e1a' }}
    />
  )
}
