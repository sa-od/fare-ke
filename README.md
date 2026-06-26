# Paint Picker

Shopify app that lets customers pick a paint shade (NCS, RAL, Caparol) on the product page. The app automatically finds the right priced variant based on the color's tier and attaches the shade code to the cart item.

## What it does

- **Color picker modal** — browse 100+ shades filtered by palette and tone
- **Auto-pricing** — picking a color silently selects the correct price tier (Light / Medium / Dark) variant
- **Format dropdown** — clean volume selector (1L, 2.5L, 5L…) replacing the theme's default pills
- **IVA toggle** — switch price display between VAT excluded and included
- **Delivery estimate** — shows expected delivery window in business days
- **Cart properties** — shade code and hex saved as line item properties on every order

## Stack

React Router v7 · Shopify App React Router · Polaris Web Components · Prisma + SQLite · Vanilla JS theme extension

## Setup

```sh
npm install
cp .env.example .env        # fill in API key + secret from Partner Dashboard
npm run setup               # prisma generate + migrate
npm run dev                 # starts the app + tunnel
```

Then in your store: **Online Store → Themes → Customize → Product template → Add block → Paint Shade Picker**.

## Project layout

```
app/
  models/shade.server.js    # DB queries (getShades, createShade, …)
  routes/app._index.tsx     # Admin home page
  shopify.server.ts         # Auth + app config

extensions/swatch-modal/
  assets/color-picker.js    # All storefront logic
  assets/ncs-palette.js     # Palette data
  assets/utils.js           # Shared helpers
  blocks/color-picker.liquid # Theme block entry point

prisma/schema.prisma        # Session + Shade models
```

## Deploy

```sh
npm run build
npm run deploy              # pushes extension + config to Shopify Partners
```

For production, swap SQLite for Postgres in `prisma/schema.prisma` and set `DATABASE_URL` on your host.

---

See [docs/architecture.md](docs/architecture.md) for how the pricing logic works.
