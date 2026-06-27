# Paint Picker — no-app theme pack

A hosting-free version of the picker. All data lives in **metaobjects +
metafields** (managed in Shopify's native admin); the storefront is a **theme
section + assets**. Nothing is hosted.

## What's in here
- `setup/definitions.graphql` — one-time mutations to create the metaobject +
  product metafield definitions.
- `sections/paint-picker.liquid` — the theme section that reads the data and
  renders the picker.
- Reused assets (copy from the existing extension into the theme's `/assets`):
  - `color-picker.js` — picker logic (reads `window.__paintData`)
  - `color-picker-utils.js` — `tierMapping` helper
  - `color-picker.css` — styles

## Data model
- **Metaobject `paint_palette`** (a "pack" — only a few of these): `name` +
  `colours` (JSON array of `{ code, hex, palette, tone, tier }`).
- **Product metafields** (`paint` namespace): `palettes` (list → `paint_palette`),
  `enabled` (boolean), `variant_config` (JSON: which option is Tier/Size + value
  map). All storefront-readable.

> Colours are a **JSON field inside the pack**, never one metaobject per colour —
> that's what keeps Liquid under its ~50-per-loop metaobject limit.

## Setup (per store, once)
1. Run `setup/definitions.graphql` against the Admin API (throwaway custom-app
   token or Shopify CLI). After mutation 1, paste the returned
   MetaobjectDefinition id into mutation 2's `metaobject_definition_id`.
2. Create the few **palette packs** (Settings → Custom data → Paint palette).
   Paste each pack's colours into the `colours` JSON field, e.g.:
   ```json
   [
     { "code": "S 0500-N", "hex": "#f3f3f3", "palette": "NCS 2050", "tone": "Grays", "tier": "light" },
     { "code": "RAL 3000", "hex": "#ab2524", "palette": "RAL CLASSIC", "tone": "Reds", "tier": "medium" }
   ]
   ```
3. Copy `color-picker.js`, `color-picker-utils.js`, `color-picker.css` into the
   theme's `/assets`.
4. Add the **Paint Picker** section to the product template (theme editor).
5. On each in-scope product set: `paint.palettes` (the packs it offers),
   `paint.enabled` = true, and `paint.variant_config`, e.g.:
   ```json
   { "tierOption": "Tier", "sizeOption": "Format",
     "tierValues": { "base": "Base", "light": "Light", "medium": "Medium", "dark": "Dark" } }
   ```

## Trade-offs vs the hosted app
- ✅ No hosting / DB / sessions / app review.
- ❌ No CSV import / search / CRUD UI (use Shopify's native editors or a bulk
  import tool).
- ❌ No auto-creating tier variants — set up Base/Light/Medium/Dark variants
  manually per product.
- ❌ Updates are per-theme (re-paste the section/assets); no central push.
