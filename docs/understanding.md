# Fare.ke — Current-State Understanding & Improvement Map

> Working analysis covering the three focus areas: **(1) Storefront picker UX**,
> **(2) Admin app**, **(3) Pricing / variant logic**. Captures how things work
> today, the gaps, and the risks — before any changes.

---

## 0. System shape (how the pieces connect)

```
                 ┌─────────────────────────────────────────────┐
   Merchant ───► │ Embedded Admin (React Router v7 + Polaris)   │
                 │   app/routes/app._index.tsx  (setup steps)   │
                 │   app/routes/app.additional.tsx (boilerplate)│
                 │   shopify.server.ts (auth, session storage)  │
                 │   Prisma: Session + Shade  (SQLite)          │
                 └─────────────────────────────────────────────┘
                                  │ (no live link today)
                                  ▼
                 ┌─────────────────────────────────────────────┐
   Customer ───► │ Theme App Extension  "swatch-modal"          │
                 │   blocks/color-picker.liquid  (entry + data) │
                 │   assets/color-picker.js      (all logic)    │
                 │   assets/ncs-palette.js       (STATIC data)  │
                 │   assets/utils.js  / color-picker.css        │
                 └─────────────────────────────────────────────┘
```

Key fact: **the storefront extension and the admin/DB are not connected.** The
palette is hard-coded in `ncs-palette.js`; the `Shade` DB table and
`shade.server.js` exist but nothing reads or writes them.

---

## 1. Storefront picker UX

**What exists**
- `color-picker.liquid` renders two buttons: **White** (`#select-base-color`)
  and **Custom Colors** (`#open-shade-modal`), plus injects
  `window.__paintData = { variants, productPrice }` from Liquid.
- `color-picker.js` builds a modal with **Palette** + **Tone** dropdowns and a
  swatch grid. Picking a chip sets `window.__paintState = { shade }`, shows a
  footer preview, recolors the Custom button, and resolves a variant.
- Block settings: button label + the two button colors.
- CSS is solid: responsive grid, mobile breakpoint, active-chip checkmark.

**Gaps vs. what the README/docs advertise**
- **Format dropdown** — README says a clean volume selector (`#pk-format-select`)
  replaces the theme's variant pills. The JS *references* `#pk-format-select`
  (in `listenFormatChange`) but **the liquid never renders it.** Half-wired.
- **IVA / VAT toggle** (price excl./incl.) — advertised, **not implemented.**
- **Delivery estimate** (business-day window) — advertised, **not implemented.**
- No **search box** in the modal (only palette+tone filtering); with 100+ shades
  that's slow to scan.
- No **"applied" confirmation / error state** when a color is picked but no
  matching variant exists (see §3) — the customer gets silent failure.
- Modal has `role="dialog"` but **no focus trap / Esc-to-close / focus return**.
- Naming inconsistency: block is **"Paint Shade Picker"**, admin calls it
  **"Paint Color Picker"**.

---

## 2. Admin app

**What exists**
- `app._index.tsx` — a static "you're ready, add the block" checklist + a button
  that opens the theme editor. No real functionality.
- `app.additional.tsx` — **untouched template boilerplate** ("Additional page").
- `app.tsx` — `AppProvider` wrapper. **No `ui-nav-menu`**, so there is no real
  navigation between pages.
- Prisma `Shade` model + `shade.server.js` (`getShades`, `createShade`,
  `deleteShade`, `bulkCreateShades`) — **fully unused.**

**Gaps**
- No UI to **manage shades** (the whole reason the `Shade` table exists).
- No **settings page** (button labels/colors live only as block settings).
- No way to push merchant-managed data to the storefront extension (would need an
  **app proxy**, **theme/metafield injection**, or **metaobjects** — none wired).
- Scopes in `shopify.app.toml` (`write_metaobject_definitions`,
  `write_metaobjects`, `write_products`) suggest metaobject-driven data was
  intended but never built.

---

## 3. Pricing / variant logic

**The mechanic (from `docs/architecture.md`)**
Products carry two variant options: **Format** (option1: 1L/2.5L/5L…) and
**Tier** (option2: Base/Light/Medium/Dark). Each shade has a static `tier`.
Flow: pick shade → map `shade.tier` via `tierMapping` → find the variant whose
`option1===format && option2===tier` → tick the hidden tier radio so the theme
re-prices → on submit, swap `input[name="id"]` to that variant and attach
`properties[Shade]` + `properties[_hex]`.

**Fragilities / risks**
- **Hard-coded option positions**: assumes Format is always `option1` and Tier is
  always `option2`. Any product set up differently silently breaks.
- **Silent failure**: if no matching variant is found, `resolveVariant` just
  `return`s — the shade looks selected but the price/variant never updates, and
  Add-to-Cart can submit the wrong variant. No user-facing warning.
- **Race window**: `_resolvingVariant` guard relies on an 800 ms `setTimeout`
  around the synthetic `change` event; fragile against slow theme JS.
- **Tier is authored data, not derived** from real variant prices — if the store
  re-tiers a color, the palette file must be hand-edited.
- **"White"/Base** assumes a literal `Base` tier option value exists.
- Selectors like `input[value="${tier}"]` are global — could collide with other
  radios on the page that share those values.

---

## 4. Cross-cutting production risks (found while reading; not in the 1–3 ask
but they will bite)

- **`shopify.server.ts` uses an in-memory `MemorySessionStorage`.** On Vercel
  (serverless/Fluid Compute) sessions don't survive cold starts or span
  instances → intermittent auth failures. The Prisma `Session` model exists but
  isn't wired (`@shopify/shopify-app-session-storage-prisma` not in use).
- **SQLite (`file:dev.sqlite`) on Vercel** — ephemeral/read-only filesystem;
  won't persist. README itself says swap to Postgres for prod.

These two mean the admin/DB layer isn't production-safe yet, which also blocks
any DB-driven shade management (§2).

---

## 5. Confirmed against the client spec (factual record)

Source: client spec "Paint Colour Picker with Shade-Based Pricing", reference
store **fareke.com** (e.g. *Caparol CapaWeiss Ultra*).

**The core mechanic matches the spec.** 4 hidden tier variants
(White/Light/Medium/Dark), native Shopify variant pricing (no scripts), pick
colour → auto-select variant → colour saved on line item. Tier surcharges
(White base / Light +10% / Medium +20% / Dark +40%) are how the **merchant
prices the variants** — the app only selects the right variant, it does not
compute prices.

**Decisions confirmed with the client (2026-06-23):**
- **Sizes = YES** → variant model is **Size × Tier**; size comes from the theme's
  own native picker.
- **Colour data** → the existing dummy `ncs-palette.js` is the current source;
  real Fareke data is a later pass.
- **NEAR** → a search input that filters swatches by colour **code**.
- **Line-item properties** must be **visible** in cart/checkout/order.

**Still open (facts, not yet decided):**
- Tier classification source for the real Fareke data.
- Final product list + who creates the tier variants on products.
