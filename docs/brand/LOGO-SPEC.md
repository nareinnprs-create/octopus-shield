# Logo Spec — Octopus Shield brand marks

Canonical source files: `docs/brand/logos/*.svg` (7 assets). This document records the rationale,
construction math, color tokens, usage rules, and the upstream integration map so a later pass can
rasterize and swap the packaged assets without re-deriving any of it.

It harmonizes with the renderer design system: token values are canonical in
`src/renderer/src/assets/main.css`; roles and rules are documented in `docs/STYLEGUIDE.md`. Per
STYLEGUIDE.md L24, no new palette values are introduced here — every hex below was extracted from the
existing SVGs and, where one already exists, mapped to its named CSS token.

---

## 1. Identity rationale — "Mantle Shield"

The mark is a **heater shield whose boss is an octopus**, fused so the viewer reads one form, not two.
The composition (per the `<desc>` in `mark.svg` L3: *"a heater shield crowned by an octopus mantle
dome, quartered by a beak line, marked with two sucker eyes"*):

| Octopus element | Reads as | Shield element it doubles as |
| --- | --- | --- |
| Upper arc of the mantle (circle r = 112, crown of the form) | Octopus mantle dome | The shield's **boss** — the raised brilliant every heater shield has |
| Vertical stem with rounded caps through the center | Octopus **beak** (the feed organ) | A **division line** quartering the escutcheon + a gladius (octopus vestige shield) |
| Two discs at cy = 176 | Octopus eyes | **Suckers** — paired disc studs, like the roundels of plate armor |
| Six half-opacity discs descending in two tapering columns outside the dome | A pair of trailing **arms** with suckers | Puncturing/eroding the shield edge from below — protection that *fishes* |

The reading order is deliberate: silhouette-first users see a shield (dome reads as boss, stem as the
escutcheon split); attention-first users see the anatomy (dome = mantle, stem = beak, discs = eyes and
suckers). The even-odd compound path (`mark.svg` L4) means the entire identity survives as **one
closed even-odd path** — see §4 degradation ladder.

The dome is *crowned* rather than contained: the octopus physically erupts above the shield's top
arc, which is the product thesis (the agent orchastration rises above the shield rather than hiding
behind it).

---

## 2. Construction grid

All geometry lives in the curves of `mark.svg` L4; every other asset reuses or restyles the same
subpaths. All icon assets share the **512×512** viewBox; only the wordmark differs.

### 2.1 `mark.svg` — viewBox `0 0 512 512` — monochrome, `fill="currentColor"`

One `<path>` (L4), 4 subpaths, `fill-rule: evenodd`:

1. **Plate** — `M256 96 A112 112 0 0 1 368 208 C384 240 392 268 392 296 C392 360 336 420 256 448
   C176 420 120 360 120 296 C120 268 128 240 144 208 A112 112 0 0 1 256 96 Z`
   - Dome: circle r=112 centered at **(256, 208)**, top at y=96.
   - Sides drop via cubic segments through **(392, 296)** / **(120, 296)** — the widest curfew of the
     heater shield is x ∈ [120, 392] (±136 of centerline).
   - and folds to the bottom point **(256, 448)** — a classic heater-shield cusp.
2. **Sucker-eye (left)** — two half-arcs forming circle r=18 centered at **(208, 176)**.
3. **Sucker-eye (right)** — same at **(304, 176)**. Both sit 48 px either side of the beak line, 32 px
   above the dome center — on the dome's lid, per octopus anatomy.
4. **Beak line** — `M248 120 Q…112 264 120 L264 408 Q264 416 256 416 Q248 416 248 408 Z`: a 16 px-wide
   vertical bar x ∈ [248, 264], y ∈ [112, 416], capped with q=8 rounded caps. It starts *inside* the
   dome crown (y=112, i.e. 16 px below the dome apex) and stops 32 px above the shield cusp — a
   "shark says quartered escutcheon" line that never touches either rim.

### 2.2 `mark-color.svg` — viewBox `0 0 512 512` — dark-surface colored variant

Same geometry decomposed into 11 primitives (L14–26):

| Element | Geometry | Fill / stroke | Source line |
| --- | --- | --- | --- |
| Plate | full outer subpath of §2.1(1) | `url(#gOSPlate)` (#262626 → #171717, y+) | L14, L5–8 |
| Ganglion glow | lower dome segment `M144 208 A112 112 … Z` | `url(#gOSGlow)` (#4493f8 → #8250df, y+) | L15, L9–12 |
| Beak | `M256 116 L256 408` | stroke `#0a0a0a`, width 16, round cap | L16 |
| Eyes ×2 | circles r=18 at (208,176), (304,176) | fill `#0a0a0a` | L17–18 |
| Suckers ×6 | circles r=12 at (168,264)(196,312)(228,352)(344,264)(316,312)(284,352) | fill `#40b0a6`, `opacity: 0.5` | L19–26 |

The suckers ride the outside of the plate: the left column starts at x=168 (48 px inside the left
curfew x=120) and steps inward+downward (Δ +28 x, +40/+48 y) — a C-shaped arm trail mirrored on the
right. Ensuing stops **(256, 190)**-centered scaling note: this file has no transform; full
512×512 bleed.

### 2.3 `favicon.svg` — viewBox `0 0 512 512`

Atom-identical compound path to `mark.svg` L4 (same 4 subpaths, same evenodd), single flat fill
`#4493f8` (L4). This is the **silhouette master** for screen legibility on both light and dark browser
chrome (desc, L3).

### 2.4 `tray.svg` — viewBox `0 0 512 512`, `aria-hidden`

One subpath only (L2): the plate outline of §2.1(1), **no** eye/beak/eye line. Solid tint shape
(`fill="currentColor"`) — beak/eyes are too fine at macOS menu-bar size, so this is the
**coarsest legible abstraction**.

### 2.5 `tray-inverted.svg` — viewBox `0 0 512 512`, `aria-hidden`

Same 4-subpath evenodd compound as `mark.svg`/`favicon.svg` (L2) under `fill="currentColor"` — the
**cut-out variant** for neuromorphic trays where the ink color sits on a light surface and the punched
eye/beak holes show through.

### 2.6 `wordmark.svg` — viewBox `0 0 512 128`

Live `<text>` (L4): centered x=256, baseline y=86, `font-size 40`, `font-weight 650`,
`letter-spacing 8`, family `'Geist','Segoe UI',system-ui,-apple-system,sans-serif` (the app font
stack), `fill="currentColor"`. **Not release-safe** — desc (L3) instructs: convert to paths before
public distribution since text requires the viewer to resolve the font.

### 2.7 `splash-motif.svg` — viewBox `0 0 512 512`

Lockup of mark-color plus ornaments (L14–33):

- Copy of the full mark-color decomposition wrapped in
  `transform="translate(256 190) scale(0.62) translate(-256 -208)"` (L14): the 512-grid scales to
  0.62 about the dome-center x=256, reanchoring to viewport y=190.
- **Ganglion glow arcs**: two concentric upper arcs, stroke `#ab7df8` @$5, round caps, `opacity 0.5`
  (L15–18): `M147.56 140 A128 128 0 0 1 364.44 140` and `M132.06 120 A152 152 0 0 1 379.94 120` —
  the arithmetic ring r=128/152 that sit *above* the dome crown as an aura.
- Wordmark `<text>`: x=256 baseline **y=428**, same 40/650/8 typology, fill `#fafafa` (L33).
  **Not release-safe** — same font-resolution hazard as §2.6: convert to
  paths before public distribution (release-hazard rule covers both
  `wordmark.svg` and `splash-motif.svg`).

---

## 3. Color tokens (extracted values, no new palette)

Every hex below was **extracted from the SVGs** (never invented), then mapped to the named token that
already carries the same value in `src/renderer/src/assets/main.css`. Canonical source per
`docs/STYLEGUIDE.md` L19.

| Value | Hex | Used in | main.css token alias |
| --- | --- | --- | --- |
| Shield Blue | `#4493f8` | favicon silhouette fill; `gOSGlow` stop 0 (mark-color L10, favicon L4) | `--callout-note` (dark scope), `main.css` L453 |
| Ganglion Violet | `#8250df` | `gOSGlow` stop 1 (mark-color L11, splash L11) | `--callout-important`, `main.css` L426 |
| Ganglion Glow (light) | `#ab7df8` | splash glow arcs stroke (splash L15) | dark-scope `--callout-important`, `main.css` L454 |
| Sucker Teal | `#40b0a6` | six sucker discs, rendered at 0.5 opacity (mark-color L19, splash L24) | `--git-graph-lane-4` (light & dark identical), `main.css` L284 / L399 |
| Plate Top | `#262626` | `gOSPlate` stop 0 (mark-color L6, splash L6) | dark-scope `--secondary` / `--muted`, `main.css` L307, L340 |
| Plate Base | `#171717` | `gOSPlate` stop 1 (mark-color L7, splash L7) | dark-scope `--card` `--primary`, `main.css` L301/L305/L334 |
| Abyss | `#0a0a0a` | beak stroke + eye discs in dark variant (mark-color L16–18) | dark-scope `--background`, `main.css` L299/L316 |
| Parchment | `#fafafa` | splash wordmark fill (splash L33) | light-scope `--primary-foreground`, dark-scope `--foreground`, `main.css` L187/L300/L318 |

### Dark / light rules

- **Dark surfaces are the native home.** The two-tone builds (`mark-color.svg`, `splash-motif.svg`)
  are tuned to the dark canvas per their `<desc>` — `gOSPlate` `#262626 → #171717` carries the plate
  against `#0a0a0a`, per mark-color L3 and main.css L299.
- **Light surfaces use the silhouette system.** `mark.svg` / `tray.svg` / `tray-inverted.svg` /
  `wordmark.svg` are all `fill="currentColor"` (inheriting light-scope `--foreground: #0a0a0a`,
  main.css L199); never hard-tint them. `favicon.svg` `#4493f8` is the only pre-tinted shape that is
  deliberately chromatic in both modes (desc, favicon L3: "legible on light and dark browser chrome").
- **The `#ab7df8` arc color must stay in the Splash lockup only** — on other dark surfaces it
  collides with `Ganglion Violet` `#8250df` at the same y-position of the glow gradient.
- Per STYLEGUIDE L24: never hardcode these hexes in component code — consume the tokens.

### Minimum-contrast note

Derived from the extracted values (WCAG 2.1 contrast formula; approximations):

- `#4493f8` on `#0a0a0a` ≈ **6.9 : 1** — passes AA for normal text on dark surfaces.
- `#4493f8` on white ≈ **2.9 : 1** — **fails** AA body-text (4.5:1) and treats itself against the 3:1
  *graphics* threshold on white; on light backgrounds Shield Blue is decorative/large-scale only
  (exactly how favicon/lockups use it) and never body copy.
- The half-opacity `#40b0a6` suckers (≈ 2.2 : 1 effective on both dark and light plates) are
  deliberately *atmosphere*, not information — they must never carry text. This mirrors the
  STYLEGUIDE.md L116 rule that anything readable must be contrast-mixed toward the foreground in
  both light and dark.

---

## 4. Usage rules

### Silhouette degradation ladder (from `mark.svg`)

Survivable detail collapses in altitude order — downscale through these, not ad-hoc redraws:

| Tier | Asset | Survives | Detail dropped |
| --- | --- | --- | --- |
| 5 (full) | `mark.svg` ≥ 64 px | plate + eyes + beak | none |
| 4 | `mark-color.svg` ≥ 64 px dark | plate + glow + beak-stroke + eyes + 6 suckers | even-odd holes replaced by painted discs |
| 3 | `favicon.svg` ≥ 32 px | full even-odd compound, one flat tint | color staging, sucker dots |
| 2 | `tray-inverted.svg` ≥ 24 px | compound silhouette w/ punched eyes + beak | gradient, all local filling |
| 1 | `tray.svg` 16–24 px | plate silhouette only | eyes + beak line entirely |

At < 16 px use `tray.svg` (plain shield pill); do not scale the full compound down — the 18 px eye
discs and 8 px cap radii gray out below that.

### Do

- Do keep all icon assets rooted in the **512×512** grid exactly as constructed in §2.
- Do tint `currentColor` assets from `--foreground` / `--primary-foreground` (per L214 of the
  STYLEGUIDE: don't re-tint SVGs a token the parent already owns).
- Do use `mark.svg` (mono) on application chrome and `mark-color.svg` only on security/trust and
  marketing surfaces **with dark backgrounds** (its gradient is dark-tuned, §3).
- Do prefer the **compound even-odd path** (mark.svg L4) for every new raster export — it is the
  single source of truth for the shield shape.

### Don't

- **Don't** redraw the *octopus* anatomy without shield semantics — the beak must be a straight
  quarters line, eyes must be on the dome, suckers must trail outside the plate (see §1 doubling).
- **Don't** place `mark-color.svg` / its gradients on light backgrounds — `gOSPlate` will crush
  against the light canvas (§3).
- **Don't** release `wordmark.svg` to public consumers while it still embeds live `<text>` (§2.6
  caveat quoted from its own `<desc>`): outline it first.
- **Don't** reuse the Suckers Teal `#40b0a6` for state indicators outside the mark — it is the git
  lane color in renderer (`--git-graph-lane-4`, main.css L284) and must not drift into product UI.
- **Don't** stretch, rotate, or bevel the mark; the heater-shield cusp and 90°-rooted stem geometry
  are the recognition anchor.

---

## 5. Integration map — which asset replaces which upstream file

Filesystem audit of the current packaged icons (2026-10-27): `resources/` contains the upstream icon
set this brand will supersede. **No upstream file has been — or should be — touched by the logo pass.**
The mapping below is a contract for the (future, out-of-scope) platform pass.

| Upstream asset (unmodified) | Current role | Purpose | Future replacement (from `docs/brand/logos/`) |
| --- | --- | --- | --- |
| `resources/icon.png` | root app icon | dev runtime icon | raster of `favicon.svg` (512 px) / `mark-color.svg` for marketing copies |
| `resources/icon-dev.png` | dev-only differentiation badge | dev runtime icon | derived dev tint of `favicon.svg` (build time, not a new palette) |
| `resources/build/icon.png` | packaged Linux/Windows app icon | installer packager | raster of `mark-color.svg` (dark-tuned, 512 px) |
| `resources/build/icon.ico` | Windows app/install icon (multi-size) | `resources/win32` + installer | multi-resolution `.ico` rendered from `favicon.svg` → tiers §4 |
| `resources/build/icon.icns` | macOS app bundle icon | app bundle | multi-resolution `.icns` rendered from `mark-color.svg` / `favicon.svg` tiers |
| `resources/logo.svg` | generic in-app logo source | orbit product logo points | replaced by `mark.svg` (mono chrome) or `mark-color.svg` (dark marketing) |
| `resources/icon-source/icon.icon` + `icon.json` + `Assets/logo.svg` + `generate.sh` | icon-authoring pipeline | raster generation of the icon set | retarget `generate.sh` to consume `docs/brand/logos/mark-color.svg` / `favicon.svg` |
| `resources/tray/shield-menu-barTemplate.png`, `…@2x.png` | macOS menu-bar template | tray icon | raster of `tray.svg` (1×/2×), keeping the `-Template` suffix/system convention |
| `resources/app-icons/shield-blue.png`, `shield-watercolor.png` | decorative/AI-generated app icons | prior ship option | retired by `favicon.svg` (Shield Blue variant) — watercolor is not in token language |

Windows packager (`resources/win32/bin/shield.cmd` scope) and Linux packager scripts
(`resources/linux/packaging/*.sh`) look up `resources/build/icon.*`; macOS needs `icon.icns` — any
future swap regenerates those three binaries from the SVG tier ladder in §4, not from screenshots.

---

### Citation index

- `docs/brand/logos/{mark,mark-color,wordmark,favicon,tray,tray-inverted,splash-motif}.svg` — all
  geometry, gradient stops, and hexes quoted above (relabeled with per-file line refs in §2).
- `src/renderer/src/assets/main.css` — token lines cited per §3 (e.g. L284, L299–318, L334–348,
  L425–426, L453–454).
- `docs/STYLEGUIDE.md` — L19 (tokens canonical in main.css), L24 (no hardcoded hex where a token
  exists), L116 (contrast-mix to foreground in both modes), L214 (don't re-tint SVGs whose colour the
  parent carries).
- `resources/` — directory listing (2026-10-27) for §5; files not opened, not modified.
