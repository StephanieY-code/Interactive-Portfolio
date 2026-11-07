import { useEffect, useRef, useState } from "react"

// Resolves files in public/assets against Vite's base URL, so images load both
// at the site root (Figma Make, local dev) and under a subpath (GitHub Pages).
const asset = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`

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
  const galleryRef = useRef<HTMLElement>(null)
  const vrRef = useRef<HTMLElement>(null)

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
            <div className="art-window" aria-live="polite">
              <div
                className={`marquee-track marquee-${activeGallery.toLowerCase()}`}
              >
                {[
                  ...galleryItems[activeGallery],
                  ...galleryItems[activeGallery],
                ].map((item, index) => (
                  <article
                    className="art-card"
                    key={`${item}-${index}`}
                    aria-hidden={index >= galleryItems[activeGallery].length}
                  >
                    <button
                      className="art-open-button"
                      tabIndex={
                        index >= galleryItems[activeGallery].length ? -1 : 0
                      }
                      onClick={() =>
                        setSelectedArtwork({
                          kind: activeGallery,
                          index: index % 6,
                        })
                      }
                      aria-label={`Open ${activeGallery} artwork ${(index % 6) + 1}`}
                    >
                      <span
                        className={`placeholder-art art-${(index % 6) + 1}`}
                      />
                      <i className="open-corners" aria-hidden="true" />
                    </button>
                  </article>
                ))}
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
          aria-label={`${selectedArtwork.kind} artwork`}
          onClick={() => setSelectedArtwork(null)}
        >
          <div
            className={`lightbox-art marquee-${selectedArtwork.kind.toLowerCase()}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className={`placeholder-art art-${selectedArtwork.index + 1}`}
            />
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
