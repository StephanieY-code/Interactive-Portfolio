// The change from the 2D drawing into the 3D world (and back). The page
// (src/WorldMorph.tsx) and the 3D scene (WorldScene.tsx) both follow one
// shared progress value, so the drawing, the frame, and the camera move
// together. Nothing here loads three.js.

/** A rectangle on screen, in CSS pixels. */
export type ViewRect = { x: number; y: number; w: number; h: number }

export type Morph = {
  /** 0 = the drawing, 1 = the 3D world fully open. */
  progress: number
  /** True once fully open: the visitor controls the camera from here. */
  settled: boolean
  /** Where the 3D view is showing, in CSS pixels from the canvas's corner. */
  frame: ViewRect
}

/** When each part happens, as [start, end] along the progress (0 to 1). */
export const MORPH_TIMELINE = {
  reveal: [0, 0.36], // the drawing dissolves, from the middle outward
  camera: [0.08, 1], // the camera turns the flat view into 3D depth
  frame: [0.38, 0.86], // the view grows from the TV into the big window
  backdrop: [0.36, 0.8], // the page behind darkens
  border: [0.7, 0.92], // the paper frame appears
} as const

export const MORPH_OPEN_MS = 2800
export const MORPH_CLOSE_MS = 1600

/** Smooth start and stop. */
export const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** How far along one part of the timeline is (0 to 1). */
export const phase = (progress: number, [start, end]: readonly [number, number]) =>
  Math.min(1, Math.max(0, (progress - start) / (end - start)))
