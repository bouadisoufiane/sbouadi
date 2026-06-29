/* ============================================================
   SOUFIANE — scroll-driven video site
   three.js (video texture) + Lenis (smooth scroll) + GSAP ScrollTrigger
   ------------------------------------------------------------
   The video is SCRUBBED, not autoplayed: overall page scroll
   progress (0 → 1) maps directly to video.currentTime (0 → duration).
   Scroll down = forward, scroll up = reverse. A render loop lerps
   the playhead toward the scroll target for buttery scrubbing.
============================================================ */

import * as THREE from "three";

/* ===========================================================
   ⚙️  EDIT ME — swap your media here
=========================================================== */
const VIDEO_SRC = "assets/hero.mp4"; // ← replace with your video path
const GRAYSCALE_AMOUNT = 0.9; // 0 = full color · 1 = pure B&W
const CONTRAST = 1.08; // cinematic contrast boost
/* =========================================================== */

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;
const isTouch = window.matchMedia("(pointer: coarse)").matches;

/* ============================================================
   1. VIDEO ELEMENT (decoded source for the texture / fallback)
============================================================ */
const video = document.createElement("video");
video.src = VIDEO_SRC;
video.muted = true;
video.defaultMuted = true;
video.loop = false;
video.playsInline = true;
video.setAttribute("playsinline", "");
video.setAttribute("webkit-playsinline", "");
video.preload = "auto";
// NOTE: only enable crossOrigin if you host the video on a DIFFERENT origin
// (e.g. a CDN) that sends `Access-Control-Allow-Origin`. For a same-origin
// file in assets/, setting it taints the WebGL texture and breaks rendering.
// video.crossOrigin = "anonymous";
// Keep it in the DOM (off-screen) — some mobile browsers refuse to
// decode / seek a fully detached video element.
Object.assign(video.style, {
  position: "fixed",
  top: "0",
  left: "0",
  width: "1px",
  height: "1px",
  opacity: "0",
  pointerEvents: "none",
  zIndex: "-1",
});
document.body.appendChild(video);

let videoDuration = 23; // sensible default until metadata loads
let videoReady = false;

/* Playhead state — target driven by scroll, current is lerped */
let targetTime = 0;
let currentTime = 0;

/* On mobile, seeking every frame is expensive; we throttle how
   often we actually assign currentTime to keep things smooth. */
let lastSeek = 0;
const SEEK_INTERVAL = isTouch ? 0.04 : 0; // seconds between seeks

video.addEventListener("loadedmetadata", () => {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    videoDuration = video.duration;
  }
});
video.addEventListener("canplay", () => {
  videoReady = true;
  document.body.classList.add("video-ready");
});

// Resilient loading: transient network / decode hiccups (flaky CDNs,
// aborted range requests) can fire an error before the media settles.
// Retry a few times with backoff before giving up.
let loadAttempts = 0;
video.addEventListener("error", () => {
  if (loadAttempts++ < 5) {
    setTimeout(() => {
      video.load();
    }, 350 * loadAttempts);
  }
});

/* Mobile autoplay/scrub unlock: a muted play()+pause() on first
   user gesture grants permission to set currentTime freely. */
function unlockVideo() {
  const p = video.play();
  if (p && p.then) {
    p.then(() => {
      video.pause();
      videoReady = true;
    }).catch(() => {
      /* Autoplay blocked — texture will still update once the user
         interacts; nothing else to do. */
    });
  } else {
    video.pause();
  }
  window.removeEventListener("touchstart", unlockVideo);
  window.removeEventListener("click", unlockVideo);
  window.removeEventListener("scroll", unlockVideo);
}
window.addEventListener("touchstart", unlockVideo, { once: true, passive: true });
window.addEventListener("click", unlockVideo, { once: true });
window.addEventListener("scroll", unlockVideo, { once: true, passive: true });
// Also try immediately (desktop / already-permitted contexts)
unlockVideo();

/* ============================================================
   2. THREE.JS — video on a fullscreen plane with a B&W /
   contrast / vignette shader. Falls back to a plain fixed
   <video> background if WebGL is unavailable.
============================================================ */
let renderer, scene, camera, mesh, videoTexture, uniforms;
let webglOK = true;

function initWebGL() {
  const canvas = document.getElementById("webgl");
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch (e) {
    webglOK = false;
    return fallbackToVideoEl();
  }

  renderer.setClearColor(0x060607, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  // Orthographic camera so a 2-unit plane fills the viewport exactly.
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  videoTexture = new THREE.VideoTexture(video);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.colorSpace = THREE.SRGBColorSpace;

  uniforms = {
    uTex: { value: videoTexture },
    uGray: { value: GRAYSCALE_AMOUNT },
    uContrast: { value: CONTRAST },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uVideoAspect: { value: 16 / 9 },
    uVignette: { value: 1.0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTex;
      uniform float uGray;
      uniform float uContrast;
      uniform vec2 uResolution;
      uniform float uVideoAspect;
      uniform float uVignette;

      void main() {
        // --- object-fit: cover --------------------------------
        float screenAspect = uResolution.x / uResolution.y;
        vec2 uv = vUv;
        vec2 scale = vec2(1.0);
        if (screenAspect > uVideoAspect) {
          scale.y = uVideoAspect / screenAspect;
        } else {
          scale.x = screenAspect / uVideoAspect;
        }
        uv = (uv - 0.5) * scale + 0.5;

        vec3 col = texture2D(uTex, uv).rgb;

        // --- desaturate (B&W) ---------------------------------
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(l), uGray);

        // --- contrast -----------------------------------------
        col = (col - 0.5) * uContrast + 0.5;

        // --- vignette -----------------------------------------
        vec2 d = vUv - 0.5;
        float vig = smoothstep(0.95, 0.35, length(d) * 1.25);
        col *= mix(1.0, vig, 0.55 * uVignette);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  video.addEventListener("loadedmetadata", () => {
    if (video.videoWidth && video.videoHeight) {
      uniforms.uVideoAspect.value = video.videoWidth / video.videoHeight;
    }
  });

  onResize();
}

/* Fallback: plain fixed video element styled as the background.
   Used only when WebGL fails. Still scroll-scrubbed via currentTime. */
function fallbackToVideoEl() {
  document.getElementById("webgl").style.display = "none";
  Object.assign(video.style, {
    width: "100vw",
    height: "100vh",
    objectFit: "cover",
    opacity: "1",
    filter: `grayscale(${GRAYSCALE_AMOUNT}) contrast(${CONTRAST})`,
    zIndex: "0",
  });
}

function onResize() {
  if (!webglOK || !renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
  uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
}

initWebGL();
window.addEventListener("resize", onResize);

/* ============================================================
   3. SMOOTH SCROLL (Lenis) + GSAP ScrollTrigger
============================================================ */
gsap.registerPlugin(ScrollTrigger);

const lenis = new Lenis({
  duration: 1.15,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smoothWheel: true,
  syncTouch: false, // native momentum on touch — better for scrubbing
  touchMultiplier: 1.4,
});

// Expose for debugging (and programmatic scrolling).
window.lenis = lenis;

// Drive Lenis from GSAP's ticker and keep ScrollTrigger in sync.
lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

/* ----- Mobile hamburger menu ----- */
const navToggle = document.getElementById("navToggle");
const mobileMenu = document.getElementById("mobileMenu");

function setMenu(open) {
  navToggle.classList.toggle("is-open", open);
  mobileMenu.classList.toggle("is-open", open);
  navToggle.setAttribute("aria-expanded", String(open));
  mobileMenu.setAttribute("aria-hidden", String(!open));
  navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  // Lock page scroll while the overlay is open.
  open ? lenis.stop() : lenis.start();
}
navToggle.addEventListener("click", () =>
  setMenu(!mobileMenu.classList.contains("is-open"))
);
// Close on Escape.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setMenu(false);
});

/* ----- Anchor links scroll smoothly through Lenis ----- */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href");
    if (id.length < 2) return;
    const el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    // Close the mobile menu first (re-enables scroll), then glide there.
    if (mobileMenu.classList.contains("is-open")) setMenu(false);
    lenis.scrollTo(el, { offset: 0, duration: 1.3 });
  });
});

/* ============================================================
   4. CORE SCROLL MECHANIC — map page progress → video time
============================================================ */
const progressBar = document.getElementById("progressBar");

ScrollTrigger.create({
  trigger: document.documentElement,
  start: "top top",
  end: "bottom bottom",
  scrub: true,
  onUpdate: (self) => {
    targetTime = self.progress * videoDuration;
    progressBar.style.width = (self.progress * 100).toFixed(2) + "%";
  },
});

/* Nav background after leaving the hero */
const nav = document.getElementById("nav");
ScrollTrigger.create({
  start: "top -80",
  onUpdate: (self) => {
    nav.classList.toggle("is-scrolled", self.scroll() > 80);
  },
});

/* ============================================================
   5. RENDER LOOP — lerp playhead + draw the WebGL frame
============================================================ */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function tick() {
  // Ease the actual playhead toward the scroll-driven target.
  currentTime = lerp(currentTime, targetTime, 0.12);

  if (videoReady && videoDuration > 0) {
    const t = Math.max(0, Math.min(videoDuration - 0.05, currentTime));
    const now = performance.now() / 1000;
    if (
      Math.abs(t - video.currentTime) > 0.01 &&
      now - lastSeek >= SEEK_INTERVAL &&
      video.readyState >= 2
    ) {
      try {
        video.currentTime = t;
        lastSeek = now;
      } catch (_) {
        /* seek not ready yet */
      }
    }
  }

  if (webglOK && renderer) {
    if (videoTexture) videoTexture.needsUpdate = true;
    renderer.render(scene, camera);
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* ============================================================
   6. SECTION REVEALS — fade + slide, off the same scroll
============================================================ */
if (!prefersReducedMotion) {
  document.querySelectorAll("[data-reveal]").forEach((el) => {
    // Hero elements animate in on load (below), not on scroll.
    if (el.closest(".hero")) return;
    // Portfolio cards are revealed by their own batch (plays with show-more).
    if (el.classList.contains("work-card")) return;
    gsap.to(el, {
      opacity: 1,
      y: 0,
      duration: 0.55,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el,
        // Fire as soon as the element enters from the bottom, and only once.
        start: "top 92%",
        once: true,
      },
    });
  });

  // Hero lines: staggered, slightly slower for a cinematic entrance.
  gsap.to(".hero__title .line", {
    opacity: 1,
    y: 0,
    duration: 1.1,
    ease: "power4.out",
    stagger: 0.12,
    delay: 0.15,
  });
  // Hero subline + CTAs reveal on load too, so they're visible right away
  // (on mobile they sit lower and shouldn't wait for a scroll trigger).
  gsap.to(".hero__sub, .hero__actions", {
    opacity: 1,
    y: 0,
    duration: 0.9,
    ease: "power3.out",
    stagger: 0.12,
    delay: 0.5,
  });

  // Subtle headline parallax: as the hero scrolls away the title drifts
  // up a touch faster than the page and softens, while the eyebrow /
  // subline / buttons trail at a gentler rate for layered depth.
  // (yPercent composes with the entrance `y`, so they don't conflict.)
  gsap
    .timeline({
      scrollTrigger: {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: true,
      },
    })
    .to(".hero__title", { yPercent: -16, opacity: 0.5, ease: "none" }, 0)
    .to(".hero__sub, .hero__actions", { yPercent: -7, ease: "none" }, 0);
} else {
  // Reveal everything immediately.
  gsap.set("[data-reveal]", { opacity: 1, y: 0 });
}

/* ============================================================
   7. BRAND LOGO MARQUEE — auto-slide + manual arrows
   The track is duplicated so it loops seamlessly. Auto-scrolls
   left; hovering pauses it; the side arrows nudge it manually.
============================================================ */
(function initMarquee() {
  const track = document.getElementById("marqueeTrack");
  const viewport = document.getElementById("marqueeViewport");
  if (!track || !viewport) return;

  const originals = Array.from(track.children);
  const perSet = originals.length;
  originals.forEach((node) => track.appendChild(node.cloneNode(true)));

  const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
  // Width of one full (un-duplicated) set, incl. one trailing gap.
  let period = (track.scrollWidth + gap) / 2;
  let step = period / perSet; // ~one logo + gap per arrow click

  const remeasure = () => {
    period = (track.scrollWidth + gap) / 2;
    step = period / perSet;
  };
  window.addEventListener("resize", remeasure);
  window.addEventListener("load", remeasure); // once logo images have loaded

  const SPEED = 0.4; // px/frame (~24px/s) — auto-scroll speed
  let x = 0;
  let paused = prefersReducedMotion; // don't auto-move if reduced motion
  let manualTarget = null;

  function frame() {
    if (manualTarget !== null) {
      x += (manualTarget - x) * 0.1;
      if (Math.abs(manualTarget - x) < 0.5) {
        x = manualTarget;
        manualTarget = null;
      }
    } else if (!paused) {
      x += SPEED;
    }
    const wrapped = ((x % period) + period) % period;
    track.style.transform = `translate3d(${-wrapped}px,0,0)`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  viewport.addEventListener("mouseenter", () => (paused = true));
  viewport.addEventListener("mouseleave", () => {
    if (!prefersReducedMotion) paused = false;
  });

  const prev = document.querySelector(".marquee__arrow--prev");
  const next = document.querySelector(".marquee__arrow--next");
  if (prev) prev.addEventListener("click", () => { manualTarget = (manualTarget ?? x) - step; });
  if (next) next.addEventListener("click", () => { manualTarget = (manualTarget ?? x) + step; });
})();

/* ============================================================
   8. PORTFOLIO — reveal, show more/less, lightbox (click to play)
============================================================ */
(function initPortfolio() {
  const gallery = document.getElementById("gallery");
  const moreBtn = document.getElementById("workMore");
  const lb = document.getElementById("lightbox");
  const lbInner = document.getElementById("lightboxInner");
  const lbClose = document.getElementById("lightboxClose");
  if (!gallery) return;

  const hiddenCards = [...gallery.querySelectorAll(".work-card.is-hidden")];

  // Reveal visible cards on scroll (batched stagger, plays once).
  if (!prefersReducedMotion) {
    ScrollTrigger.batch(".work-card:not(.is-hidden)", {
      start: "top 95%",
      onEnter: (els) =>
        gsap.to(els, {
          opacity: 1,
          y: 0,
          duration: 0.5,
          stagger: 0.05,
          ease: "power2.out",
          overwrite: true,
        }),
    });
  } else {
    gsap.set(".work-card", { opacity: 1, y: 0 });
  }

  // Show more / less
  let expanded = false;
  if (!hiddenCards.length && moreBtn) moreBtn.style.display = "none";
  if (moreBtn)
    moreBtn.addEventListener("click", () => {
      expanded = !expanded;
      if (expanded) {
        hiddenCards.forEach((c) => c.classList.remove("is-hidden"));
        gsap.to(hiddenCards, {
          opacity: 1,
          y: 0,
          duration: 0.6,
          stagger: 0.03,
          ease: "power2.out",
          overwrite: true,
        });
        moreBtn.textContent = "Show less";
      } else {
        hiddenCards.forEach((c) => c.classList.add("is-hidden"));
        gsap.set(hiddenCards, { opacity: 0, y: 34 }); // reset for next expand
        moreBtn.textContent = "Show more";
        lenis.scrollTo("#work", { offset: -80 });
      }
      moreBtn.setAttribute("aria-expanded", String(expanded));
      ScrollTrigger.refresh();
    });

  // Lightbox — videos play, statics enlarge
  function open(card) {
    const type = card.dataset.type;
    const src = card.dataset.full;
    lbInner.innerHTML =
      type === "video"
        ? `<video src="${src}" controls autoplay playsinline></video>`
        : `<img src="${src}" alt="" />`;
    lb.classList.add("is-open");
    lb.setAttribute("aria-hidden", "false");
    lenis.stop();
  }
  function close() {
    lb.classList.remove("is-open");
    lb.setAttribute("aria-hidden", "true");
    lbInner.innerHTML = ""; // stops/unloads the video
    lenis.start();
  }
  gallery.addEventListener("click", (e) => {
    const card = e.target.closest(".work-card");
    if (card) open(card);
  });
  lbClose.addEventListener("click", close);
  lb.addEventListener("click", (e) => {
    if (e.target === lb) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lb.classList.contains("is-open")) close();
  });
})();

/* ============================================================
   9. MISC
   (The contact form is handled by a small inline classic script in
   index.html so it works even if this module fails to load.)
============================================================ */
document.getElementById("year").textContent = new Date().getFullYear();

// Refresh ScrollTrigger once fonts/layout settle.
window.addEventListener("load", () => ScrollTrigger.refresh());
