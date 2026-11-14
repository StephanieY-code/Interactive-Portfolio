// The VR slide's cover picture (the 3D render, or the drawing) turning into
// the live 3D world, and back.
//
// The 3D world loads behind the picture, lined up with it inside the TV.
// Then the picture dissolves from the middle outward, the camera turns the
// flat view into 3D depth, and the view grows from the TV into a big framed
// window. Closing plays it in reverse, ending on the picture again.
// The timing lives in src/vr/morph.ts.

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  MORPH_CLOSE_MS,
  MORPH_OPEN_MS,
  MORPH_TIMELINE,
  easeInOut,
  phase,
  type Morph,
  type ViewRect,
} from "./vr/morph"
import type { VRWorld } from "./vr/worlds"

const VRViewer = lazy(() => import("./vr/VRViewer"))

/** Where the drawing is on screen, and how round its corners are. */
export type ScreenShape = ViewRect & { rx: number; ry: number }

const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export default function WorldMorph({
  world,
  cover,
  screen,
  onClosed,
}: {
  world: VRWorld
  /** The cover drawing that turns into the world (optional). */
  cover?: string
  /** Where the TV with the drawing is on screen right now. */
  screen: () => ScreenShape
  onClosed: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const coverRef = useRef<HTMLImageElement>(null)
  const animation = useRef(0)
  const pressedBackdrop = useRef(false)
  // Kept in a ref so a new function from the page doesn't restart anything.
  const screenShape = useRef(screen)
  screenShape.current = screen
  const morph = useMemo<Morph>(
    () => ({ progress: 0, settled: false, frame: screen() }),
    // Only the starting frame is needed here; paint() keeps it up to date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [state, setState] = useState<"loading" | "opening" | "open" | "closing">("loading")
  const [slow, setSlow] = useState(false) // still loading after a moment

  // Draws one moment of the change (0 = drawing, 1 = open world).
  const paint = useCallback(
    (progress: number) => {
      const root = rootRef.current
      const view = viewRef.current
      if (!root || !view) return
      const width = root.clientWidth
      const height = root.clientHeight
      const pad = document.fullscreenElement ? 0 : Math.min(64, Math.max(24, width * 0.05))
      const from = screenShape.current()
      const to = { x: pad, y: pad, w: width - 2 * pad, h: height - 2 * pad }
      const grow = easeInOut(phase(progress, MORPH_TIMELINE.frame))
      const rect = {
        x: lerp(from.x, to.x, grow),
        y: lerp(from.y, to.y, grow),
        w: lerp(from.w, to.w, grow),
        h: lerp(from.h, to.h, grow),
      }
      const rx = lerp(from.rx, 4, grow)
      const ry = lerp(from.ry, 4, grow)
      morph.progress = progress
      morph.frame = rect

      view.style.clipPath = `inset(${rect.y}px ${width - rect.x - rect.w}px ${
        height - rect.y - rect.h
      }px ${rect.x}px round ${rx}px / ${ry}px)`
      root.style.setProperty("--pad", `${pad}px`)
      root.style.setProperty("--reveal", phase(progress, MORPH_TIMELINE.reveal).toFixed(4))
      root.style.setProperty(
        "--backdrop",
        easeInOut(phase(progress, MORPH_TIMELINE.backdrop)).toFixed(4),
      )
      root.style.setProperty("--border", phase(progress, MORPH_TIMELINE.border).toFixed(4))
      const frame = frameRef.current
      if (frame) {
        frame.style.left = `${rect.x - 10}px`
        frame.style.top = `${rect.y - 10}px`
        frame.style.width = `${rect.w + 20}px`
        frame.style.height = `${rect.h + 20}px`
      }
      const drawing = coverRef.current
      if (drawing) {
        drawing.style.left = `${from.x}px`
        drawing.style.top = `${from.y}px`
        drawing.style.width = `${from.w}px`
        drawing.style.height = `${from.h}px`
        drawing.style.borderRadius = `${from.rx}px / ${from.ry}px`
      }
    },
    [morph],
  )

  // Moves the progress to 0 or 1 over time.
  const run = useCallback(
    (to: 0 | 1, fullMs: number, done: () => void) => {
      cancelAnimationFrame(animation.current)
      const from = morph.progress
      const ms = (reducedMotion() ? 300 : fullMs) * Math.abs(to - from)
      const start = performance.now()
      const tick = (now: number) => {
        const t = ms ? Math.min(1, (now - start) / ms) : 1
        paint(lerp(from, to, t))
        if (t < 1) animation.current = requestAnimationFrame(tick)
        else done()
      }
      animation.current = requestAnimationFrame(tick)
    },
    [morph, paint],
  )

  // Start: everything sits exactly on the drawing; the page can't scroll.
  useEffect(() => {
    paint(0)
    const html = document.documentElement
    const overflow = html.style.overflow
    html.style.overflow = "hidden"
    const timer = window.setTimeout(() => setSlow(true), 500)
    return () => {
      cancelAnimationFrame(animation.current)
      window.clearTimeout(timer)
      html.style.overflow = overflow
    }
  }, [paint])

  // The 3D world is ready: wait two frames (so it's drawn), then open.
  const begin = useCallback(() => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setState((now) => (now === "loading" ? "opening" : now))
        run(1, MORPH_OPEN_MS, () => {
          morph.settled = true
          setState((now) => (now === "opening" ? "open" : now))
        })
      }),
    )
  }, [morph, run])

  // A world with no 3D model just opens.
  useEffect(() => {
    if (!world.model) begin()
  }, [world.model, begin])

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.()
    if (state === "loading") return onClosed()
    morph.settled = false
    setState("closing")
    run(0, MORPH_CLOSE_MS, onClosed)
  }, [morph, onClosed, run, state])

  // Escape closes; a new window size (or fullscreen) redraws the frame.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state !== "closing") close()
    }
    const onResize = () => paint(morph.progress)
    window.addEventListener("keydown", onKey)
    window.addEventListener("resize", onResize)
    document.addEventListener("fullscreenchange", onResize)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", onResize)
      document.removeEventListener("fullscreenchange", onResize)
    }
  }, [close, morph, paint, state])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.()
    else void rootRef.current?.requestFullscreen?.()
  }

  return (
    <div
      ref={rootRef}
      className={`world-morph is-${state}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${world.title} world`}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        // Only a click that starts and ends on the dark backdrop closes, so
        // dragging to look around and letting go outside doesn't.
        if (state === "open" && event.target === event.currentTarget && pressedBackdrop.current) {
          close()
        }
      }}
    >
      <div className="world-morph-backdrop" aria-hidden="true" />

      <div ref={viewRef} className="world-morph-view">
        <div className={`immersive-world${world.model ? " has-model" : ""}`}>
          {world.model ? (
            <Suspense fallback={null}>
              <VRViewer world={world} morph={morph} onReady={begin} />
            </Suspense>
          ) : (
            <>
              <div className="world-sky">
                <span className="world-moon" />
                <span className="world-star star-1" />
                <span className="world-star star-2" />
                <span className="world-star star-3" />
              </div>
              <div className="world-hill hill-back" />
              <div className="world-hill hill-front" />
            </>
          )}
        </div>
      </div>

      <div ref={frameRef} className="world-morph-frame" aria-hidden="true" />

      {cover && <img ref={coverRef} className="world-morph-cover" src={cover} alt="" />}

      {state === "loading" && slow && (
        <p className="world-morph-status" role="status">
          Bringing it to life…
        </p>
      )}

      <div className="world-morph-controls">
        {document.fullscreenEnabled && (
          <button className="world-morph-fullscreen" onClick={toggleFullscreen} aria-label="Fullscreen">
            <i aria-hidden="true" />
          </button>
        )}
        <button className="lightbox-close world-morph-close" onClick={close} aria-label="Close">
          <i aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
