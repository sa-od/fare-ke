# Architecture

## Pricing by color tier — the core mechanic

Each product has two Shopify variant options: **Format** (1L, 2.5L, 5L…) and **Tier** (Base, Light, Medium, Dark). This means the product has a full variant matrix — `1L/Light`, `2.5L/Dark`, etc. — each with its own price. That's how different colors cost different amounts for the same volume.

The problem: Shopify would normally show customers both dropdowns. That makes no sense for paint — customers pick a color code, not a "tier".

The fix: the tier selector is hidden with CSS, and the app handles it automatically:

1. The customer picks a shade (e.g. `RAL 3000`).
2. That shade has a `tier` field in the data — `"medium"` in this case.
3. The app maps `"medium"` → `"Medium"` and looks for the variant that matches the customer's chosen format + that tier (e.g. `2.5L / Medium`).
4. It programmatically clicks the hidden radio input for that tier — this triggers the theme's own JS to update the displayed price.
5. The customer sees the price change naturally, as if they had picked a variant themselves.

So the price the customer sees is always accurate for their chosen color, without them ever knowing tiers exist.

## Why no server calls

All the data needed is already on the page (injected by Liquid). No API calls, no latency, works on any Shopify plan.

## Why a theme extension

The palette is static, so there's nothing to fetch from a server. Assets load from Shopify's CDN — fast and always available.

## What happens on Add to Cart

1. Customer picks a shade → tier is derived → correct variant is found
2. Form submit is intercepted → variant ID is swapped in → shade code + hex attached as line properties
3. Shopify gets the right variant with the color info attached
