# Custom Liquid block (alternative to the section)

If you'd rather not add the `paint-picker` **section**, you can drop the picker
into a product page via a **Custom Liquid block** instead. This version reads the
metafields from the **`custom`** namespace (what Shopify uses when you create the
metafields by hand in the admin), and **hides the theme's tier selector with
server-rendered CSS** (driven by the product's real tier values, so there's no
flash before JS runs).

## Prerequisites
- Assets uploaded to the theme's `/assets`: `color-picker.js`, `color-picker.css`,
  `color-picker-utils.js`.
- Product metafields exist in the **`custom`** namespace: `palettes`
  (list → Paint palette), `enabled` (boolean), `variant_config` (JSON) — all with
  Storefront access ON.
- On the product: `custom.enabled` = true, `custom.palettes` linked, and
  `custom.variant_config` set (option names must match the product exactly), e.g.:
  ```json
  { "tierOption": "Tiers", "sizeOption": "OPZIONE",
    "tierValues": { "base": "Base", "light": "Light", "medium": "Medium", "dark": "Dark" } }
  ```
- Tier variants (Base/Light/Medium/Dark × sizes) created and **priced**
  (base, +10% / +20% / +40%).

## Steps
**Customizer → product template → Add block → Custom Liquid → paste the snippet:**

```liquid
{% if product.metafields.custom.enabled.value %}
  {{ 'color-picker.css' | asset_url | stylesheet_tag }}
  <style>
    :root {
      --pk-accent: #1a6faf;
      --pk-text: #333333;
      --pk-btn-white-bg: #ffffff;
      --pk-btn-custom-bg: #1a6faf;
    }
  </style>

  {%- liquid
    assign tier_cfg = product.metafields.custom.variant_config.value
    assign tier_name = tier_cfg.tierOption
    assign tier_opt = null
    if tier_name != blank
      for opt in product.options_with_values
        if opt.name == tier_name
          assign tier_opt = opt
          break
        endif
      endfor
    endif
    if tier_opt == null and product.options.size > 1
      assign tier_opt = product.options_with_values[1]
    endif
  -%}
  {%- if tier_opt and tier_opt.values.size > 0 -%}
  <style>
    {%- for v in tier_opt.values -%}
    {%- assign ev = v | strip | replace: '"', '\"' -%}
    :is(fieldset,.variant-option,.product-form__input,.product-form__input--pill,.product-form__option,.variant-input-wrap,.selector-wrapper,[data-option-index],[data-option-name],[data-fieldset-index]):has(:is([value="{{ ev }}"],[data-value="{{ ev }}"],[data-option-value="{{ ev }}"])){display:none!important;}
    {%- endfor -%}
  </style>
  {%- endif -%}

  {% assign packs = product.metafields.custom.palettes.value %}
  <script>
    window.__paintData = {
      variants:    {{ product.variants | json }},
      optionNames: {{ product.options | json }},
      tierConfig:  {{ product.metafields.custom.variant_config.value | json }},
      shades: [
        {% for pack in packs %}{{ pack.colours.value | json }}{% unless forloop.last %},{% endunless %}{% endfor %}
      ].flat()
    };
  </script>

  <div class="cp-picker">
    <span class="cp-picker__label">Clicca qui per scegliere il tuo colore personalizzato</span>
    <div class="cp-btn-row">
      <button type="button" id="select-base-color" class="cp-btn cp-btn--white">Bianco</button>
      <button type="button" id="open-shade-modal" class="cp-btn cp-btn--custom" data-default-label="Colorato">Colorato</button>
    </div>
    <p class="cp-error" id="pk-error" role="alert" hidden></p>
  </div>

  <script type="module" src="{{ 'color-picker.js' | asset_url }}"></script>
{% endif %}
```

## How the tier-hide works
The `{%- liquid -%}` block finds the **tier option** — by the name in
`variant_config.tierOption`, falling back to the 2nd option if the name doesn't
match. It then emits CSS that hides any common variant-picker wrapper that
`:has()` an input/element carrying one of the tier values (Base/Light/…). The
customer never sees the tier selector; the picker drives it behind the scenes.

## Notes
- Labels/colours are hardcoded here. For editable settings, use the
  `sections/paint-picker.liquid` section instead — it reads the same `custom`
  namespace and also includes the server-rendered tier hiding.
- Renders only when `custom.enabled` is true.
- `:has()` is supported in all current major browsers; very old browsers would
  just show the tier selector (the JS in `color-picker.js` also hides it as a
  fallback).
