import { useEffect, useRef, useState } from "react"
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react"
import { artworks } from "./artworks"

// Resolves files in public/assets against Vite's base URL, so images load both
// at the site root (Figma Make, local dev) and under a subpath (GitHub Pages).
const asset = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`

// Placeholder art, shown for a gallery until src/artworks/<2d|3d> has images.
const galleryItems = {
  "2D": [1, 2, 3, 4, 5, 6],
  "3D": [1, 2, 3, 4, 5, 6],
}

const vrProjects = [
  { number: "01", className: "garden" },
  { number: "02", className: "clouds" },
  { number: "03", className: "moon" },
]

type GalleryKind = keyof typeof galleryItems

export default function App() {
  const [activeGallery, setActiveGallery] = useState<GalleryKind>("2D")
  const [selectedArtwork, setSelectedArtwork] = useState<{
    kind: GalleryKind
    index: number
  } | null>(null)
  const [selectedWorld, setSelectedWorld] =
    useState<typeof vrProjects[number] | null>(null)
  const [vrMode, setVrMode] = useState(false)
  const [edgeFade, setEdgeFade] = useState({ left: false, right: false })
  const galleryRef = useRef<HTMLElement>(null)
  const vrRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startLeft: number
    moved: boolean
  } | null>(null)
  const justDraggedRef = useRef(false)

  const activeArt = artworks[activeGallery]
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
  }, [activeGallery])

  useEffect(() => {
    window.addEventListener("resize", updateEdgeFade)
    return () => window.removeEventListener("resize", updateEdgeFade)
  }, [])

  // Click-and-drag scrolling for mouse users. Touch and trackpads already
  // scroll natively.
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
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

  useEffect(() => {
    if (!selectedWorld) return
    const timer = window.setTimeout(() => setVrMode(true), 900)
    return () => window.clearTimeout(timer)
  }, [selectedWorld])

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
    if (!selectedArtwork && !selectedWorld) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (selectedArtwork) setSelectedArtwork(null)
      else closeWorld()
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [selectedArtwork, selectedWorld])

  const scrollTo = (target: "gallery" | "vr") => {
    const ref = target === "gallery" ? galleryRef : vrRef
    ref.current?.scrollIntoView({ behavior: "smooth" })
  }

  const chooseGallery = (kind: GalleryKind) => {
    setActiveGallery(kind)
    galleryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const closeWorld = () => {
    if (document.fullscreenElement) document.exitFullscreen?.()
    setVrMode(false)
    setSelectedWorld(null)
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
          <h1 id="hero-title">
            <span>Stephanie</span>
            <span>Yang</span>
            <span>Creative</span>
            <span>Portfolio</span>
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
            <span>Stephanie Yang</span>
          </div>
        </header>

        <div className="gallery-layout">
          <div className="gallery-main">
            <h2 id="gallery-heading" className="sr-only">
              {activeGallery}
            </h2>
            <div
              className={`art-window${edgeFade.left ? " fade-left" : ""}${
                edgeFade.right ? " fade-right" : ""
              }`}
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
                  className={`art-track marquee-${activeGallery.toLowerCase()}`}
                >
                  {activeArt.length > 0
                    ? activeArt.map((art, index) => (
                        <article className="art-card artwork" key={art.src}>
                          <button
                            className="art-open-button"
                            onClick={() =>
                              setSelectedArtwork({ kind: activeGallery, index })
                            }
                            aria-label={`Open ${art.title}`}
                          >
                            <img
                              className="artwork-image"
                              src={art.src}
                              alt={art.title}
                              draggable={false}
                              loading="lazy"
                              decoding="async"
                              onLoad={updateEdgeFade}
                            />
                            <i className="open-corners" aria-hidden="true" />
                          </button>
                        </article>
                      ))
                    : galleryItems[activeGallery].map((item, index) => (
                        <article className="art-card" key={item}>
                          <button
                            className="art-open-button"
                            onClick={() =>
                              setSelectedArtwork({ kind: activeGallery, index })
                            }
                            aria-label={`Open ${activeGallery} artwork ${index + 1}`}
                          >
                            <span className={`placeholder-art art-${item}`} />
                            <i className="open-corners" aria-hidden="true" />
                          </button>
                        </article>
                      ))}
                </div>
              </div>
            </div>
          </div>

          <aside className="goose-menu">
            <button
              className={activeGallery === "2D" ? "active" : ""}
              onClick={() => chooseGallery("2D")}
              aria-label="2D"
              aria-pressed={activeGallery === "2D"}
            >
              <img src={asset("goose-2d.png")} alt="" />
            </button>
            <button
              className={activeGallery === "3D" ? "active" : ""}
              onClick={() => chooseGallery("3D")}
              aria-label="3D"
              aria-pressed={activeGallery === "3D"}
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
        className="vr-section slide-section"
        ref={vrRef}
        aria-labelledby="vr-heading"
      >
        <div className="vr-glow glow-one" />
        <div className="vr-glow glow-two" />
        <header className="vr-header">
          <div className="mini-brand vr-brand">
            <img src={asset("tomato-mark.png")} alt="" />
            <h2 id="vr-heading">Stephanie Yang</h2>
          </div>
        </header>

        <div className="vr-grid">
          {vrProjects.map((project) => (
            <button
              className={`vr-card ${project.className} ${
                selectedWorld?.number === project.number ? "is-opening" : ""
              }`}
              key={project.number}
              onClick={() => setSelectedWorld(project)}
              aria-label="VR"
            >
              <span className="vr-art" aria-hidden="true">
                <i className="shape shape-a" />
                <i className="shape shape-b" />
                <i className="shape shape-c" />
              </span>
            </button>
          ))}

          <div className="vr-invite">
            <img src={asset("goose-vr.png")} alt="" />
            <p>Travel Inside!</p>
          </div>
        </div>
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
              <img
                className="lightbox-image"
                src={selectedArt.src}
                alt={selectedArt.title}
              />
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
        <div
          className={`dream-transition ${vrMode ? "world-open" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="VR"
        >
          <div className="dream-cloud cloud-a" />
          <div className="dream-cloud cloud-b" />
          <div className="immersive-world">
            <div className="world-sky">
              <span className="world-moon" />
              <span className="world-star star-1" />
              <span className="world-star star-2" />
              <span className="world-star star-3" />
            </div>
            <div className="world-hill hill-back" />
            <div className="world-hill hill-front" />
            <div className="world-object object-one" />
            <div className="world-object object-two" />
            <div className="world-object object-three" />
            <div className="world-controls">
              <button
                className="fullscreen-button"
                onClick={() => document.documentElement.requestFullscreen?.()}
                aria-label="Fullscreen"
              >
                <i aria-hidden="true" />
              </button>
              <button
                className="close-button"
                onClick={closeWorld}
                aria-label="Close"
              >
                <i aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
