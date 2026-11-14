import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react"
import { artworks, type Artwork } from "./artworks"
import { ArtworkMedia } from "./ArtworkMedia"
import { getWorld } from "./vr/worlds"
import WorldMorph, { type ScreenShape } from "./WorldMorph"
import vrBackdrop from "./assets/vr-slide.jpg"
import vrBackdropSmall from "./assets/vr-slide-1200.jpg"
import nameLettering from "./assets/name-lettering.png"
import titleStephanie from "./assets/title-stephanie.png"
import titleYang from "./assets/title-yang.png"
import titleCreative from "./assets/title-creative.png"
import titlePortfolio from "./assets/title-portfolio.png"

// The 3D viewer (three.js + WebXR) is a separate download that only starts
// when someone hovers or opens a VR world, so the main page stays light.
const loadVRViewer = () => import("./vr/VRViewer")
// A live view for the VR slide's painted screen, used only when a world has
// no cover drawing or video (loads near that slide).
const WorldPreview = lazy(() => import("./vr/WorldPreview"))

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

// Resolves files in public/assets against Vite's base URL, so images load both
// at the site root (Figma Make, local dev) and under a subpath (GitHub Pages).
const asset = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`

// Placeholder art, shown for a gallery until src/artworks/<2d|3d> has images.
const galleryItems = {
  "2D": [1, 2, 3, 4, 5, 6],
  "3D": [1, 2, 3, 4, 5, 6],
}

// Each card's world lives in src/vr-worlds/<className>/ (cover, scene, settings).
const vrProjects = [
  { number: "01", className: "garden" },
  { number: "02", className: "clouds" },
  { number: "03", className: "moon" },
].map((project) => ({ ...project, world: getWorld(project.className) }))

// For now the VR slide shows one world (the first) inside its painted screen:
// its cover drawing (or cover video), and clicking it opens the 3D world in
// a big panel. The other cards' folders still work; they just aren't shown.
const featuredWorld = vrProjects[0]

// Start downloading the 3D viewer and this world's model ahead of the click.
const warmUpWorld = (project: (typeof vrProjects)[number]) => {
  if (!project.world.model) return
  void loadVRViewer().then((viewer) => viewer.preloadWorld(project.world))
}

type GalleryKind = keyof typeof galleryItems

// One card in the gallery strip: a real artwork, or a placeholder when
// `art` is missing.
type GalleryEntry = { kind: GalleryKind; index: number; art?: Artwork }

// A gallery's real artwork, or its placeholders while its folder is empty.
const entriesFor = (kind: GalleryKind): GalleryEntry[] =>
  artworks[kind].length > 0
    ? artworks[kind].map((art, index) => ({ kind, index, art }))
    : galleryItems[kind].map((_, index) => ({ kind, index }))

// The auto-scrolling showcase (before a 2D/3D goose is picked) shows 2D then
// 3D. Once any real artwork exists, placeholders are left out of it.
const realArtwork: GalleryEntry[] = (["2D", "3D"] as const).flatMap((kind) =>
  artworks[kind].map((art, index) => ({ kind, index, art })),
)
const showcaseEntries: GalleryEntry[] =
  realArtwork.length > 0
    ? realArtwork
    : [...entriesFor("2D"), ...entriesFor("3D")]

// The zoom into the VR slide's screen (and back out).
const ZOOM_TRANSITION =
  "opacity .75s ease, transform 1.4s cubic-bezier(.65, 0, .35, 1), filter .95s ease"
const ZOOM_SECONDS = 1.4
// The drawing flipping over to the 3D render (match .vr-flip in index.css).
const FLIP_SECONDS = 1.2

// How fast the showcase glides, in pixels per second.
const SHOWCASE_SPEED = 40

export default function App() {
  const [activeGallery, setActiveGallery] = useState<GalleryKind>("2D")
  // "showcase" auto-scrolls; "browse" is the scroll-it-yourself strip that
  // opens once a visitor presses the 2D or 3D goose.
  const [galleryMode, setGalleryMode] = useState<"showcase" | "browse">(
    "showcase",
  )
  // How many times the showcase list is repeated so one loop is at least as
  // wide as the card (matters when there are only a few artworks).
  const [showcaseRepeats, setShowcaseRepeats] = useState(1)
  const [selectedArtwork, setSelectedArtwork] = useState<{
    kind: GalleryKind
    index: number
  } | null>(null)
  const [selectedWorld, setSelectedWorld] =
    useState<typeof vrProjects[number] | null>(null)
  // The VR slide's screen: load its video (or live view) when the slide is
  // near, and only let it play while the slide is actually on screen.
  const [screenNear, setScreenNear] = useState(false)
  const [screenOnView, setScreenOnView] = useState(false)
  const [screenReady, setScreenReady] = useState(false)
  // Clicking the screen: "playing" shows the drawing's timelapse, then
  // "zoomed" zooms into the screen, and one more click steps inside.
  const [screenStep, setScreenStep] = useState<"idle" | "playing" | "zoomed">("idle")
  // Once zoomed in, the drawing flips over to show the 3D render.
  const [showRender, setShowRender] = useState(false)
  const [zoomStyle, setZoomStyle] = useState<CSSProperties>()
  const stageRef = useRef<HTMLDivElement>(null)
  const [edgeFade, setEdgeFade] = useState({ left: false, right: false })
  const galleryRef = useRef<HTMLElement>(null)
  const vrRef = useRef<HTMLElement>(null)
  const screenRef = useRef<HTMLButtonElement>(null)
  const coverVideoRef = useRef<HTMLVideoElement>(null)
  const markScreenReady = useCallback(() => setScreenReady(true), [])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startLeft: number
    moved: boolean
  } | null>(null)
  const justDraggedRef = useRef(false)

  const isShowcase = galleryMode === "showcase"
  // The showcase renders its list twice; sliding left by exactly one copy
  // and starting over makes a seamless loop.
  const stripEntries = isShowcase
    ? Array.from({ length: showcaseRepeats * 2 }, () => showcaseEntries).flat()
    : entriesFor(activeGallery)
  const selectedArt = selectedArtwork
    ? artworks[selectedArtwork.kind][selectedArtwork.index]
    : undefined

  // Fade the card's left/right edge only when there's more art that way.
  const updateEdgeFade = () => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const left = scroller.scrollLeft > 4
    const right =
      scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4
    setEdgeFade((prev) =>
      prev.left === left && prev.right === right ? prev : { left, right },
    )
  }

  useEffect(() => {
    scrollerRef.current?.scrollTo({ left: 0 })
    updateEdgeFade()
  }, [activeGallery, galleryMode])

  // Showcase: size the loop to the artwork and keep the glide speed steady
  // however many pieces there are. Re-measures as images load or the
  // window resizes.
  useEffect(() => {
    if (!isShowcase) return
    const track = trackRef.current
    const scroller = scrollerRef.current
    if (!track || !scroller) return

    const measure = () => {
      const loopWidth = track.scrollWidth / 2
      if (loopWidth <= 0) return
      const listWidth = loopWidth / showcaseRepeats
      const repeatsNeeded = Math.min(
        12,
        Math.max(1, Math.ceil(scroller.clientWidth / listWidth)),
      )
      if (repeatsNeeded !== showcaseRepeats) {
        setShowcaseRepeats(repeatsNeeded)
        return
      }
      track.style.setProperty(
        "--marquee-duration",
        `${loopWidth / SHOWCASE_SPEED}s`,
      )
    }

    const observer = new ResizeObserver(measure)
    observer.observe(track)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [isShowcase, showcaseRepeats])

  useEffect(() => {
    window.addEventListener("resize", updateEdgeFade)
    return () => window.removeEventListener("resize", updateEdgeFade)
  }, [])

  // Click-and-drag scrolling for mouse users. Touch and trackpads already
  // scroll natively.
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isShowcase) return
    if (event.pointerType !== "mouse" || event.button !== 0) return
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startLeft: event.currentTarget.scrollLeft,
      moved: false,
    }
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if ((event.buttons & 1) === 0) {
      dragRef.current = null
      return
    }
    const distance = event.clientX - drag.startX
    if (!drag.moved) {
      if (Math.abs(distance) < 6) return
      drag.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.classList.add("is-dragging")
    }
    event.currentTarget.scrollLeft = drag.startLeft - distance
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.classList.remove("is-dragging")
    if (drag.moved) {
      // A drag shouldn't also count as a click that opens the artwork.
      justDraggedRef.current = true
      window.setTimeout(() => {
        justDraggedRef.current = false
      }, 0)
    }
  }

  const ignoreClickAfterDrag = (event: ReactMouseEvent) => {
    if (!justDraggedRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  // Watch the VR slide's screen: start loading its video (or live view)
  // about a screen away, and play it only while it's visible.
  useEffect(() => {
    const screen = screenRef.current
    if (!screen) return
    const near = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setScreenNear(true)
          near.disconnect()
        }
      },
      { rootMargin: "100% 0px" },
    )
    const onView = new IntersectionObserver(
      ([entry]) => setScreenOnView(entry.isIntersecting),
      { threshold: 0.15 },
    )
    near.observe(screen)
    onView.observe(screen)
    return () => {
      near.disconnect()
      onView.disconnect()
    }
  }, [])

  // The move and scale that bring the screen to the middle of the slide,
  // nearly filling it. Measured with the zoom briefly switched off.
  const measureZoom = useCallback((): CSSProperties => {
    const stage = stageRef.current
    const screen = screenRef.current
    const section = vrRef.current
    if (!stage || !screen || !section) return {}
    const before = { transform: stage.style.transform, transition: stage.style.transition }
    stage.style.transition = "none"
    stage.style.transform = "none"
    const s = screen.getBoundingClientRect()
    const st = stage.getBoundingClientRect()
    const sec = section.getBoundingClientRect()
    stage.style.transform = before.transform
    void stage.offsetWidth // apply it before the transition comes back
    stage.style.transition = before.transition
    const scale = Math.min((sec.width * 0.92) / s.width, (sec.height * 0.8) / s.height)
    const dx = sec.left + sec.width / 2 - (s.left + s.width / 2)
    const dy = sec.top + sec.height * 0.45 - (s.top + s.height / 2)
    // Where the zoomed screen ends, so "Step inside" can sit just below it.
    const screenBottom = sec.height * 0.45 + (s.height * scale) / 2
    return {
      transformOrigin: `${s.left - st.left + s.width / 2}px ${s.top - st.top + s.height / 2}px`,
      transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
      ["--zoomed-screen-bottom" as string]: `${Math.round(screenBottom)}px`,
    }
  }, [])

  // Zoom in (and keep the zoom right if the window changes size)...
  useLayoutEffect(() => {
    if (screenStep !== "zoomed") return
    setZoomStyle({ ...measureZoom(), transition: ZOOM_TRANSITION })
    const onResize = () => setZoomStyle({ ...measureZoom(), transition: "none" })
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [screenStep, measureZoom])

  // ...and back out, then hand the slide back to its usual styles.
  useEffect(() => {
    if (screenStep !== "idle") return
    coverVideoRef.current?.pause()
    setShowRender(false) // flips back to the drawing as it zooms out
    setZoomStyle((zoom) =>
      zoom && {
        transformOrigin: zoom.transformOrigin,
        transform: "translate(0px, 0px) scale(1)",
        transition: ZOOM_TRANSITION,
      },
    )
    const timer = window.setTimeout(() => setZoomStyle(undefined), ZOOM_SECONDS * 1000)
    return () => window.clearTimeout(timer)
  }, [screenStep])

  // Scrolling away from the slide resets the screen.
  useEffect(() => {
    if (!screenOnView && !selectedWorld) setScreenStep("idle")
  }, [screenOnView, selectedWorld])

  useEffect(() => {
    const slides = document.querySelectorAll<HTMLElement>(".slide-section")
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          entry.target.classList.toggle("is-visible", entry.isIntersecting)
        })
      },
      { threshold: 0.24, rootMargin: "-8% 0px -8% 0px" },
    )

    slides.forEach((slide) => observer.observe(slide))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!selectedArtwork && !selectedWorld && screenStep === "idle") return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (selectedArtwork) setSelectedArtwork(null)
      else if (!selectedWorld) setScreenStep("idle") // the open world handles its own

    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [selectedArtwork, selectedWorld, screenStep])

  const scrollTo = (target: "gallery" | "vr") => {
    const ref = target === "gallery" ? galleryRef : vrRef
    ref.current?.scrollIntoView({ behavior: "smooth" })
  }

  const chooseGallery = (kind: GalleryKind) => {
    setActiveGallery(kind)
    setGalleryMode("browse")
    galleryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // Where the TV is on screen (zoomed or not), for the drawing-to-3D change.
  const screenShape = useCallback((): ScreenShape => {
    const rect = screenRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight, rx: 0, ry: 0 }
    // The TV's rounded corners (see .vr-screen in index.css).
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height, rx: rect.width * 0.056, ry: rect.height * 0.082 }
  }, [])

  // Clicks wait for the zoom or flip to finish, so everything lines up.
  const busyUntil = useRef(0)
  const openFeaturedWorld = () => {
    if (performance.now() < busyUntil.current) return
    warmUpWorld(featuredWorld)
    setScreenReady(false)
    setSelectedWorld(featuredWorld)
  }

  // Zoomed in: the first click flips the drawing over to the 3D render; the
  // next one steps into the live 3D world, from that same point of view.
  const nextFromZoom = () => {
    if (performance.now() < busyUntil.current) return
    if (featuredWorld.world.render && !showRender) {
      busyUntil.current = performance.now() + FLIP_SECONDS * 1000
      setShowRender(true)
    } else {
      openFeaturedWorld()
    }
  }

  const zoomIntoScreen = () => {
    busyUntil.current = performance.now() + ZOOM_SECONDS * 1000
    setScreenStep("zoomed")
    vrRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // Click 1 plays the timelapse (a click while it plays skips it), then the
  // slide zooms into the screen; click 2 flips the drawing to the 3D render;
  // click 3 steps into the 3D world. A world with no cover (a live view on
  // the screen) opens straight away.
  const clickScreen = () => {
    const { cover, coverVideo } = featuredWorld.world
    warmUpWorld(featuredWorld) // the 3D world downloads during the video
    if (!cover && !coverVideo) return openFeaturedWorld()
    if (screenStep === "zoomed") return nextFromZoom()
    const video = coverVideoRef.current
    if (screenStep === "playing" || !video) {
      video?.pause()
      return zoomIntoScreen()
    }
    video.currentTime = 0
    setScreenStep("playing")
    video.play().catch(zoomIntoScreen)
  }

  return (
    <main>
      <section className="hero slide-section" aria-labelledby="hero-title">
        <div className="hero-grain" />
        <button
          className="hero-click-target"
          onClick={() => scrollTo("gallery")}
          aria-label="Open portfolio"
        />

        <div className="hero-copy">
          {/* Hand-lettered, lifted from the landing mockup in .figma/attachments. */}
          <h1 id="hero-title">
            <span className="title-line title-stephanie">
              <img src={titleStephanie} alt="Stephanie" />
            </span>
            <span className="title-line title-yang">
              <img src={titleYang} alt="Yang" />
            </span>
            <span className="title-line title-creative">
              <img src={titleCreative} alt="Creative" />
            </span>
            <span className="title-line title-portfolio">
              <img src={titlePortfolio} alt="Portfolio" />
            </span>
          </h1>
        </div>

        <div className="hero-mark" aria-hidden="true">
          <img src={asset("tomato-mark.png")} alt="" />
        </div>

        <div className="goose-hop" aria-hidden="true">
          <img src={asset("goose-plain.png")} alt="" />
          <img src={asset("goose-plain.png")} alt="" />
          <img src={asset("goose-plain.png")} alt="" />
        </div>
      </section>

      <section
        className="gallery-section slide-section"
        ref={galleryRef}
        aria-labelledby="gallery-heading"
      >
        <header className="section-header">
          <div className="mini-brand">
            <img src={asset("tomato-mark.png")} alt="" />
            <img className="name-lettering" src={nameLettering} alt="Stephanie Yang" />
          </div>
        </header>

        <div className="gallery-layout">
          <div className="gallery-main">
            <h2 id="gallery-heading" className="sr-only">
              {isShowcase ? "All artwork" : activeGallery}
            </h2>
            <div
              className={`art-window${isShowcase ? " is-showcase" : ""}${
                !isShowcase && edgeFade.left ? " fade-left" : ""
              }${!isShowcase && edgeFade.right ? " fade-right" : ""}`}
              aria-live="polite"
            >
              <div
                className="art-scroller"
                ref={scrollerRef}
                onScroll={updateEdgeFade}
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClickCapture={ignoreClickAfterDrag}
              >
                <div
                  className="art-track"
                  ref={trackRef}
                  // A new key replays the fade-in when the strip switches.
                  key={isShowcase ? "showcase" : activeGallery}
                >
                  {stripEntries.map((entry, position) => {
                    const isRepeat = position >= showcaseEntries.length
                    const hidden = isShowcase && isRepeat
                    return (
                      <article
                        className={`art-card marquee-${entry.kind.toLowerCase()}${
                          entry.art ? " artwork" : ""
                        }`}
                        key={`${position}-${entry.kind}-${entry.index}`}
                        aria-hidden={hidden || undefined}
                      >
                        <button
                          className="art-open-button"
                          tabIndex={hidden ? -1 : undefined}
                          onClick={() =>
                            setSelectedArtwork({
                              kind: entry.kind,
                              index: entry.index,
                            })
                          }
                          aria-label={
                            entry.art
                              ? `Open ${entry.art.title}`
                              : `Open ${entry.kind} artwork ${entry.index + 1}`
                          }
                        >
                          {entry.art ? (
                            <ArtworkMedia
                              art={entry.art}
                              className="artwork-image"
                              onReady={updateEdgeFade}
                              lazy
                            />
                          ) : (
                            <span
                              className={`placeholder-art art-${entry.index + 1}`}
                            />
                          )}
                          <i className="open-corners" aria-hidden="true" />
                        </button>
                      </article>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          <aside className="goose-menu">
            <button
              className={!isShowcase && activeGallery === "2D" ? "active" : ""}
              onClick={() => chooseGallery("2D")}
              aria-label="2D"
              aria-pressed={!isShowcase && activeGallery === "2D"}
            >
              <img src={asset("goose-2d.png")} alt="" />
            </button>
            <button
              className={!isShowcase && activeGallery === "3D" ? "active" : ""}
              onClick={() => chooseGallery("3D")}
              aria-label="3D"
              aria-pressed={!isShowcase && activeGallery === "3D"}
            >
              <img src={asset("goose-3d.png")} alt="" />
            </button>
            <button onClick={() => scrollTo("vr")} aria-label="VR">
              <img src={asset("goose-vr.png")} alt="" />
            </button>
          </aside>
        </div>
      </section>

      <section
        className="vr-section has-backdrop slide-section"
        ref={vrRef}
        aria-labelledby="vr-heading"
        data-screen={screenStep}
        style={
          zoomStyle && {
            ["--zoomed-screen-bottom" as string]: (zoomStyle as Record<string, string>)[
              "--zoomed-screen-bottom"
            ],
          }
        }
      >
        <header className="vr-header">
          <div className="mini-brand vr-brand">
            <img src={asset("tomato-mark.png")} alt="" />
            {/* Hand-lettered, lifted from the gallery mockup in .figma/attachments. */}
            <h2 id="vr-heading">
              <img className="name-lettering" src={nameLettering} alt="Stephanie Yang" />
            </h2>
          </div>
        </header>

        {/* The painted slide; the world's cover sits inside its cream screen. */}
        <div className="vr-stage" ref={stageRef} style={zoomStyle}>
          <img
            className="vr-backdrop"
            src={vrBackdrop}
            srcSet={`${vrBackdropSmall} 1200w, ${vrBackdrop} 2000w`}
            sizes="min(170vw, 129.45svh)"
            alt=""
          />
          <button
            ref={screenRef}
            className="vr-screen"
            onClick={clickScreen}
            onPointerEnter={() => warmUpWorld(featuredWorld)}
            onFocus={() => warmUpWorld(featuredWorld)}
            aria-label={
              screenStep === "idle" && featuredWorld.world.coverVideo
                ? `Watch the ${featuredWorld.world.title} drawing come together`
                : screenStep === "playing"
                  ? "Skip the timelapse"
                  : featuredWorld.world.render && !showRender
                    ? `Flip the drawing over to the ${featuredWorld.world.title} in 3D`
                    : `Step inside the ${featuredWorld.world.title} world`
            }
          >
            {featuredWorld.world.cover || featuredWorld.world.coverVideo ? (
              <>
                {/* A card: the drawing (and its timelapse) on the front,
                    the 3D render on the back. */}
                <span className="vr-flip" data-flipped={showRender}>
                  <span className="vr-flip-face">
                    {featuredWorld.world.cover && (
                      <img className="vr-cover" src={featuredWorld.world.cover} alt="" />
                    )}
                    {featuredWorld.world.coverVideo && screenNear && (
                      <video
                        ref={coverVideoRef}
                        className="vr-cover vr-timelapse"
                        src={featuredWorld.world.coverVideo}
                        muted
                        playsInline
                        preload="auto"
                        onEnded={zoomIntoScreen}
                        aria-hidden="true"
                      />
                    )}
                  </span>
                  {featuredWorld.world.render && screenNear && (
                    <span className="vr-flip-face vr-flip-back">
                      <img className="vr-cover" src={featuredWorld.world.render} alt="" />
                    </span>
                  )}
                </span>
                {featuredWorld.world.coverVideo && screenStep !== "zoomed" && (
                  <span className="vr-screen-hint" aria-hidden="true">
                    {screenStep === "playing" ? "Skip ›" : "▶\uFE0E Watch"}
                  </span>
                )}
              </>
            ) : featuredWorld.world.model ? (
              <>
                {screenNear && !selectedWorld && (
                  <Suspense fallback={null}>
                    <WorldPreview
                      world={featuredWorld.world}
                      playing={screenOnView && !prefersReducedMotion()}
                      onReady={markScreenReady}
                    />
                  </Suspense>
                )}
                {!screenReady && (
                  <span className="vr-screen-status" aria-hidden="true">
                    Loading the {featuredWorld.world.title.toLowerCase()}…
                  </span>
                )}
              </>
            ) : null}
          </button>
        </div>

        {screenStep === "zoomed" && (
          <>
            {featuredWorld.world.render && !showRender ? (
              <button key="flip" className="enter-vr-button vr-step-inside" onClick={nextFromZoom}>
                <b className="flip-icon" aria-hidden="true">↻</b>
                See it in 3D
              </button>
            ) : (
              <button key="inside" className="enter-vr-button vr-step-inside" onClick={nextFromZoom}>
                <i aria-hidden="true" />
                Step inside
              </button>
            )}
            <button
              className="lightbox-close vr-zoom-back"
              onClick={() => setScreenStep("idle")}
              aria-label="Back"
            >
              <i aria-hidden="true" />
            </button>
          </>
        )}
      </section>

      {selectedArtwork && (
        <div
          className="art-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={selectedArt?.title ?? `${selectedArtwork.kind} artwork`}
          onClick={() => setSelectedArtwork(null)}
        >
          <div
            className={`lightbox-art marquee-${selectedArtwork.kind.toLowerCase()}${
              selectedArt ? " has-image" : ""
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            {selectedArt ? (
              <ArtworkMedia art={selectedArt} className="lightbox-image" />
            ) : (
              <div
                className={`placeholder-art art-${selectedArtwork.index + 1}`}
              />
            )}
            <button
              className="lightbox-close"
              onClick={() => setSelectedArtwork(null)}
              aria-label="Close"
            >
              <i aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {selectedWorld && (
        // The drawing turns into the 3D world (and back when closed).
        <WorldMorph
          world={selectedWorld.world}
          cover={
            showRender ? selectedWorld.world.render : selectedWorld.world.cover
          }
          screen={screenShape}
          onClosed={() => setSelectedWorld(null)}
        />
      )}
    </main>
  )
}
