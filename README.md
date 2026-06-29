# Soufiane — AI Creative Strategist

A single-page, scroll-driven site. The hero video is **scrubbed by scroll**
(scroll down = play forward, scroll up = reverse) and stays pinned as a
full-screen cinematic background while the content sections fade and slide in
over it. Built with **three.js** (video-as-texture on a fullscreen plane with a
black-&-white / contrast / vignette shader), **Lenis** (smooth scroll) and
**GSAP ScrollTrigger** (drives both the video scrub and the section reveals off
a single scroll timeline).

## Run it locally

ES modules + the video texture can't run from `file://`, so serve over http:

```bash
python3 serve.py        # then open http://localhost:8000
```

(`serve.py` supports HTTP Range requests, which keeps the video scrubbing
smooth. Plain `python3 -m http.server` works too but seeking will be choppier.)

## Deploy

Drop the whole folder onto any static host — **Netlify, Vercel, GitHub Pages,
Cloudflare Pages**. No build step, no backend.

## File map

```
index.html      — markup + all copy (edit text here)
css/styles.css   — all styling / design tokens (top of file)
js/main.js       — scroll mechanic, three.js, reveals
assets/
  hero.mp4              — the scroll-scrubbed background video
  logo-white-icon.png  — white logo (nav + footer)
serve.py        — local preview server
```

## Customise

**Swap the video** — replace `assets/hero.mp4`, or change the constant at the
top of `js/main.js`:

```js
const VIDEO_SRC = "assets/hero.mp4";   // ← your video
const GRAYSCALE_AMOUNT = 0.9;           // 0 = full color · 1 = pure B&W
const CONTRAST = 1.08;                   // cinematic contrast
```

> The video should be **H.264 MP4 with "faststart"** (moov atom at the front)
> for smooth seeking. The included file is already encoded this way. If you
> export a new one, a lower resolution (720p) scrubs faster than 1080p.
> If you host the video on a **different domain (CDN)**, uncomment the
> `video.crossOrigin` line in `main.js` and make sure that host sends an
> `Access-Control-Allow-Origin` header — otherwise WebGL can't use it.

**Edit copy** — it's all plain text in `index.html`, section by section
(Hero → About → Services → Proof → Work → Consulting → Contact → Footer).

**Proof numbers** — search `index.html` for `(placeholder)` and drop in real
metrics. Replace the `Brand` cells in `.logo-wall` with `<img>` logos.

**Portfolio** — each gallery item is a `<a class="tile">`. Replace the empty
`<div class="tile__media"></div>` with your own `<img>` or `<video>`:

```html
<a class="tile tile--tall" href="https://...">
  <img class="tile__media" src="assets/work/project-01.jpg" alt="" />
  <div class="tile__meta"><span>Project 01</span><em>Creative Strategy</em></div>
</a>
```

Tile sizes: add `tile--tall` (2 rows) or `tile--wide` (2 columns).

**Booking link** — in the Contact section, replace the Calendly URL
(`https://calendly.com/your-handle`). The contact form is a front-end stub —
wire it to [Formspree](https://formspree.io), [Basin](https://usebasin.com), or
your own endpoint by setting the `<form>`'s `action`/`method`.

**Social links** — update the `#` hrefs in the footer.

## Fonts

Display: **Clash Display** · Body: **Satoshi** (both via Fontshare CDN). Swap
them in the `<link>` in `index.html` and the `--font-display` / `--font-body`
variables in `css/styles.css`.

## Notes

- Fully responsive; nav collapses and the gallery restacks on small screens.
- Respects `prefers-reduced-motion` (reveals show instantly, no scrub flourish).
- Falls back to a plain fixed `<video>` background if WebGL is unavailable.
