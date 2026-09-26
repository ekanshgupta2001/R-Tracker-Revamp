# vendor/

Third-party code shipped with the site so that no page loads anything from another origin.
Each file was downloaded once, at implementation time, and committed. Nothing here is
fetched at runtime.

## three/ — three.js r128 (MIT)

| File | Source | SHA-256 |
|---|---|---|
| `three.min.js` | https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js | `9274bbcec8d96168626c732b5d31c775aa8cfb7eaa0599bec0c175908a2c1ce2` |
| `STLLoader.js` | https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/STLLoader.js | `c392b93d1331e64082cbd76deb850fe5de11385472a3f4c5b7fe82ba216cb49e` |
| `OrbitControls.js` | https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js | `02bb4ade710f3e607329e37a21f098bc3ac70eb6e33daf8a65e79f4db785e7b2` |

Verify with `shasum -a 256 -c vendor/three/SHA256SUMS` (run from `vendor/three/`).

Network note for the audit: `three.min.js` contains `XMLHttpRequest` (inside `FileLoader`) and
`STLLoader.js` has a `load(url)` method that uses it. Neither path is reachable in R-Tracker:
`js/teleop/view3d.js` reads the student's STL file with a `FileReader` and calls
`STLLoader.parse(arrayBuffer)` only, so a grep for network calls can exclude `vendor/`.

License: MIT — Copyright 2010-2021 Three.js Authors (header retained in `three.min.js`).

## gsap/ — GSAP 3.15.0 (GreenSock Standard "No Charge" License)

Loaded on the home page only (`index.html`, `defer`), by `js/home-motion.js`: the entrance
choreography, the SplitText headline reveal and the pointer parallax of the sky layers.

| File | Source | SHA-256 |
|---|---|---|
| `gsap.min.js` | https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js | `92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb` |
| `SplitText.min.js` | https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/SplitText.min.js | `419f7027a5f086a12cb7988736d8fdd3a6ed2200229661de25b6628ca7ced344` |

Verify with `shasum -a 256 -c vendor/gsap/SHA256SUMS` (run from `vendor/gsap/`).

Network note for the audit (checked by hand on 2026-09-26): neither file contains `fetch(`,
`XMLHttpRequest`, `WebSocket`, `sendBeacon`, `import(`, `eval(`, `new Function`, workers or any
storage/cookie access. The only URLs are the licence comment (`https://gsap.com…`) and the SVG /
XHTML namespace strings.

License: the GSAP Standard License (https://gsap.com/standard-license) — free for commercial and
non-commercial use, all plugins included, since Webflow's 2025 change; the licence header is
retained in both files.

## Fonts

Two variable fonts live in `assets/fonts/`, declared in `css/fonts.css`:

- **Geist** (the site's typeface) — `Geist-Variable.woff2` from
  https://cdn.jsdelivr.net/npm/geist@1.7.2/dist/fonts/geist-sans/Geist-Variable.woff2
  (SHA-256 `a369fcf5628ea2aa4e1b9e2ec6a5b3624e365bda588e1f0f2f12b564f728fbb8`), © 2023 Vercel with
  basement.studio, SIL Open Font License 1.1 — see `assets/fonts/Geist-OFL.txt`.
- **Inter** (fallback) — `InterVariable.woff2`, from https://github.com/rsms/inter, SIL Open Font
  License 1.1 — see `assets/fonts/OFL.txt`.
