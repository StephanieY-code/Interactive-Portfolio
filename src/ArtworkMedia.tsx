import { useEffect, useRef, useState } from "react"
import type { Artwork, VideoSource } from "./artworks"

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

type Props = {
  art: Artwork
  className: string
  /** Called once the picture (or the video's first frame) is ready. */
  onReady?: () => void
  lazy?: boolean
}

/** An artwork: images as <img>, videos (3D turntables) looping like a GIF. */
export function ArtworkMedia({ art, className, onReady, lazy = false }: Props) {
  if (art.media === "video") {
    return (
      <LoopingVideo
        sources={art.sources ?? [{ src: art.src, type: "video/mp4" }]}
        title={art.title}
        className={className}
        onReady={onReady}
      />
    )
  }
  return (
    <img
      className={className}
      src={art.src}
      alt={art.title}
      draggable={false}
      loading={lazy ? "lazy" : undefined}
      decoding="async"
      onLoad={onReady}
    />
  )
}

function LoopingVideo({
  sources,
  title,
  className,
  onReady,
}: {
  sources: VideoSource[]
  title: string
  className: string
  onReady?: () => void
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const still = reducedMotion()
  const sourceKey = sources.map((s) => s.src).join(" ")
  // Download only when the video is about to scroll or slide into view, so
  // videos never slow down the first page load.
  const [nearView, setNearView] = useState(false)

  useEffect(() => {
    const video = ref.current
    if (!video || nearView) return
    if (!("IntersectionObserver" in window)) {
      setNearView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearView(true)
          observer.disconnect()
        }
      },
      { rootMargin: "300px" },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [nearView])

  useEffect(() => {
    const video = ref.current
    if (!video || !nearView) return
    // React sets `muted` only as a property, but phones (iPhone especially)
    // autoplay a video only when the `muted` attribute is on the element.
    video.muted = true
    video.defaultMuted = true
    video.setAttribute("muted", "")
    if (!still) void video.play().catch(() => {})
  }, [sourceKey, still, nearView])

  return (
    // key: new files (or starting to load) need a fresh <video> to pick a source.
    <video
      key={nearView ? sourceKey : "waiting"}
      ref={ref}
      className={`${className} is-video`}
      aria-label={title}
      muted
      loop
      playsInline
      autoPlay={nearView && !still}
      preload={nearView ? "auto" : "none"}
      disablePictureInPicture
      draggable={false}
      onLoadedData={onReady}
    >
      {/* The browser plays the first one it supports. */}
      {nearView &&
        sources.map((source) => (
          <source key={source.src} src={source.src} type={source.type} />
        ))}
    </video>
  )
}
