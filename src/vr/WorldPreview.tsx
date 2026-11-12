// The live view of a VR world inside the painted screen on the VR slide.
// Loaded only when a visitor scrolls near that slide, and it only animates
// while the slide is on screen. Clicking the screen opens the full world.

import { Canvas } from "@react-three/fiber"
import { Suspense, useEffect } from "react"
import { WorldScene } from "./WorldScene"
import type { VRWorld } from "./worlds"

function Ready({ onReady }: { onReady?: () => void }) {
  useEffect(() => onReady?.(), [onReady])
  return null
}

export default function WorldPreview({
  world,
  playing,
  onReady,
}: {
  world: VRWorld
  /** false: hold still (slide off screen, or reduced motion). */
  playing: boolean
  onReady?: () => void
}) {
  return (
    <Canvas
      className="vr-preview-canvas"
      flat // colors like Blender's "Standard" view
      shadows="percentage"
      dpr={[1, 1.5]}
      frameloop={playing ? "always" : "demand"}
      camera={{ fov: 50, near: 0.05, far: 500 }}
      aria-hidden="true"
    >
      <Suspense fallback={null}>
        <WorldScene world={world} preview />
        <Ready onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}
