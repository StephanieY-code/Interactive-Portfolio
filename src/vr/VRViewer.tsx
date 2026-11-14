// The 3D world viewer. It's loaded only when a visitor opens a VR world, so
// the 3D code never slows down the rest of the portfolio.
//
// On a laptop or phone: drag to look around, scroll/pinch to zoom.
// On a Meta Quest (3, 3S, Pro) in the Quest browser: an "Enter VR" button
// starts WebXR. Visitors look around, point a controller (or pinch with
// their hands) to touch things, and push the thumbstick forward (or pinch
// and hold) to aim a teleport arc at the floor.

import { useProgress } from "@react-three/drei"
import { Canvas } from "@react-three/fiber"
import { XR, createXRStore, useXRSessionModeSupported } from "@react-three/xr"
import { Component, Suspense, useEffect, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import type { Morph } from "./morph"
import { WorldScene, preloadWorldModel } from "./WorldScene"
import type { VRWorld } from "./worlds"

// One WebXR connection for the whole site.
const xrStore = createXRStore({
  // Full VR (not passthrough mixed reality, which the library prefers).
  offerSession: false,
  // Controllers and hands get a laser pointer for touching things, plus a
  // teleport arc for moving around the floor.
  controller: { teleportPointer: true },
  hand: { teleportPointer: true },
  handTracking: true,
  // A VR world doesn't need to scan the visitor's room. Leaving these off
  // avoids the Quest's "allow access to spatial data?" popup.
  anchors: false,
  hitTest: false,
  planeDetection: false,
  meshDetection: false,
  depthSensing: false,
  bodyTracking: false,
  // 90 Hz on Quest: smooth, with headroom for lights and shadows.
  frameRate: "mid",
})

const subscribe = (onChange: () => void) => xrStore.subscribe(onChange)
const isInVR = () => xrStore.getState().session != null

export const preloadWorld = (world: VRWorld) => {
  if (world.model) preloadWorldModel(world.model)
}

class WorldErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <p className="vr-status">Sorry, this world couldn't load. Please try again.</p>
    ) : (
      this.props.children
    )
  }
}

function LoadingStatus({ title }: { title: string }) {
  const { active, progress } = useProgress()
  if (!active) return null
  return (
    <p className="vr-status" role="status">
      Loading {title}… {Math.round(progress)}%
    </p>
  )
}

/** Tells the page once the world has loaded and is about to be drawn. */
function Ready({ onReady }: { onReady?: () => void }) {
  useEffect(() => onReady?.(), [onReady])
  return null
}

export default function VRViewer({
  world,
  morph,
  onReady,
}: {
  world: VRWorld
  /** Opening from the cover drawing (see src/vr/morph.ts). */
  morph?: Morph
  onReady?: () => void
}) {
  const vrSupported = useXRSessionModeSupported("immersive-vr")
  const inVR = useSyncExternalStore(subscribe, isInVR)

  // Closing the world also leaves VR.
  useEffect(
    () => () => {
      void xrStore.getState().session?.end()
    },
    [],
  )

  return (
    <div className="vr-viewer">
      <WorldErrorBoundary>
        <Canvas
          className="vr-canvas"
          flat // no extra color look here; WorldScene matches Blender's (AgX or Standard)
          shadows="percentage"
          dpr={[1, 2]}
          // Measure the panel's real size, not its size mid pop-in animation.
          resize={{ offsetSize: true }}
          camera={{ fov: 50, near: 0.05, far: 500, position: [0, 1.6, 4] }}
          aria-label={`${world.title}: 3D world. Drag to look around.`}
        >
          <XR store={xrStore}>
            <Suspense fallback={null}>
              <WorldScene world={world} morph={morph} />
              <Ready onReady={onReady} />
            </Suspense>
          </XR>
        </Canvas>
        <LoadingStatus title={world.title} />
      </WorldErrorBoundary>

      {!inVR && (
        <div className="vr-viewer-bar">
          {vrSupported ? (
            <button
              className="enter-vr-button"
              onClick={() => void xrStore.enterVR()}
            >
              <i aria-hidden="true" />
              Enter VR
            </button>
          ) : vrSupported === false ? (
            <p className="vr-hint">
              Drag to look around · Open this page on a Meta Quest to step
              inside
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
