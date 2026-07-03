// ── PALETTE DATA ──────────────────────────────────────────────────────────────
import { tierMapping } from "./color-picker-utils.js";

// Build marker — lets us confirm from the console whether the latest asset is the
// one the browser actually loaded (theme-editor/CDN caching can serve a stale one).
window.__cpHideVersion = 5;

// Shades are injected per product via Liquid (window.__paintData.shades). If the
// product has no colours yet, the picker renders with an empty palette — we never
// fall back to sample data, since that would show wrong colours on a live product.
const _injectedShades = window.__paintData?.shades;
const SHADES = Array.isArray(_injectedShades) ? _injectedShades : [];
const PALETTES = [...new Set(SHADES.map((s) => s.palette))];
const TONES_BY_PALETTE = SHADES.reduce((acc, s) => {
  (acc[s.palette] = acc[s.palette] || new Set()).add(s.tone);
  return acc;
}, {});

// ── STATE ─────────────────────────────────────────────────────────────────────
// window.__paintState = { shade, variantId } — or { white: true } on "White"
// click, so the base colour still reaches the cart as a line-item property.
// window.__paintData  = { variants, optionNames, shades, tierConfig } — from Liquid

const OVERLAY_ID = "shade-overlay";
let _resolvingVariant = false;

// Per-product tier/size mapping set in the admin (which option is the tier, which
// is the size, and each tier's actual option value). When absent we fall back to
// the legacy assumption: option1 = size, option2 = tier, values Base/Light/…/Dark.
const tierConfig = window.__paintData?.tierConfig || null;
const optionNames = window.__paintData?.optionNames || [];
const tierIndex = tierConfig ? optionNames.indexOf(tierConfig.tierOption) : -1;
const sizeIndex =
  tierConfig && tierConfig.sizeOption
    ? optionNames.indexOf(tierConfig.sizeOption)
    : -1;
const useConfig = !!tierConfig && tierIndex >= 0;

// ── VARIANT RESOLUTION ────────────────────────────────────────────────────────

// The variant the theme currently has selected (from ?variant= or the form's id).
function currentVariant() {
  const variants = window.__paintData?.variants || [];
  const urlId = parseInt(
    new URLSearchParams(window.location.search).get("variant"),
    10,
  );
  if (urlId) {
    const v = variants.find((v) => v.id === urlId);
    if (v) return v;
  }
  const hidden = document.querySelector(
    'form[action*="/cart/add"] input[name="id"]',
  );
  if (hidden?.value) {
    const v = variants.find((v) => v.id === parseInt(hidden.value, 10));
    if (v) return v;
  }
  return variants[0] || null;
}

// The selected size value — by option name when configured, else legacy option1.
function getSelectedSize() {
  const v = currentVariant();
  if (!v) return null;
  if (useConfig && sizeIndex >= 0) return v.options?.[sizeIndex] ?? null;
  return v.option1 ?? null;
}

function resolveVariant() {
  if (_resolvingVariant) return;

  const shade = window.__paintState?.shade;
  if (!shade) return;

  const tierValue = useConfig
    ? tierConfig.tierValues?.[shade.tier]
    : tierMapping[shade.tier];
  if (!tierValue) {
    window.__paintState.variantId = null;
    showError(`“${shade.code}” non ha una fascia di prezzo corrispondente per questo prodotto.`);
    return;
  }

  // Size only matters when the product actually has a size option.
  const hasSize = useConfig ? sizeIndex >= 0 : true;
  const size = hasSize ? getSelectedSize() : null;
  if (hasSize && !size) return;

  const variant = (window.__paintData?.variants || []).find((v) => {
    const tierOk = useConfig
      ? v.options?.[tierIndex] === tierValue
      : v.option2 === tierValue;
    const sizeOk = !hasSize
      ? true
      : useConfig
        ? v.options?.[sizeIndex] === size
        : v.option1 === size;
    return tierOk && sizeOk;
  });

  if (!variant) {
    // The colour's tier has no variant in the chosen size — tell the customer
    // instead of silently adding the wrong variant on submit.
    window.__paintState.variantId = null;
    showError(
      `“${shade.code}” non è disponibile nel formato selezionato. Scegli un altro formato o un altro colore.`,
    );
    return;
  }

  clearError();
  window.__paintState.variantId = variant.id;

  // Drive the theme's Tier picker so the price updates on the page. If the theme
  // uses a single combined variant <select>, fall back to selecting by id.
  if (!selectThemeOption(tierValue)) selectVariantById(variant.id);

  // Attach the colour to the cart form after the tier change above, in case the
  // theme re-rendered the form in response to it.
  syncCartProperties();
  updateColorButtons(shade);
}

// Selects a variant option value in the theme's own picker so the theme re-prices
// and tracks the right variant. Handles all three picker styles: radio/pill
// inputs, <select> dropdowns, and clickable button/label pills. Returns true once
// a matching control is found. Searches the cart form first, then the whole page.
function selectThemeOption(value) {
  if (!value) return false;
  const form = document.querySelector('form[action*="/cart/add"]');
  return selectThemeOptionIn(form, value) || selectThemeOptionIn(document, value);
}

function selectThemeOptionIn(scope, value) {
  if (!scope) return false;

  // Run the interaction inside the re-entrancy guard so the theme's own variant
  // handler (which updates history) doesn't loop back into resolveVariant.
  const guarded = (fn) => {
    _resolvingVariant = true;
    fn();
    setTimeout(() => { _resolvingVariant = false; }, 800);
  };

  // 1. Radio / pill input.
  const input = scope.querySelector(`input[value="${CSS.escape(value)}"]`);
  if (input) {
    if (!input.checked) {
      guarded(() => {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    return true;
  }

  // 2. <select> dropdown.
  for (const select of scope.querySelectorAll("select")) {
    const option = Array.from(select.options).find(
      (o) => o.value === value || o.textContent.trim() === value,
    );
    if (option) {
      if (select.value !== option.value) {
        guarded(() => {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
      return true;
    }
  }

  // 3. Clickable button / label / swatch pill — click the control that matches by
  //    visible text or a value/label attribute (covers image swatches with no
  //    text). Skip our own picker UI so we never click the White/Colored buttons.
  const matchesValue = (el) =>
    [
      el.getAttribute("data-value"),
      el.getAttribute("data-option-value"),
      el.getAttribute("value"),
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.textContent,
    ].some((candidate) => candidate && candidate.trim() === value);

  for (const el of scope.querySelectorAll(
    'button, label, [role="radio"], [role="button"], a[href]',
  )) {
    if (el.closest("#shade-overlay, .cp-picker")) continue;
    if (matchesValue(el)) {
      guarded(() => el.click());
      return true;
    }
  }

  return false;
}

// Fallback for themes with a single combined variant dropdown (<select name="id">
// whose options are whole variants): select the resolved variant by its id so the
// theme re-prices on the page. The cart is already covered by the fetch id force.
function selectVariantById(variantId) {
  if (!variantId) return false;
  const form = document.querySelector('form[action*="/cart/add"]');
  const select = (form || document).querySelector('select[name="id"]');
  if (!select) return false;

  const option = Array.from(select.options).find(
    (o) => String(o.value) === String(variantId),
  );
  if (option && select.value !== option.value) {
    _resolvingVariant = true;
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => { _resolvingVariant = false; }, 800);
  }
  return !!option;
}

const _norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

// The readable text a control/pill represents (covers <select>, radios, and the
// button/label/anchor swatch pills custom themes use).
const _controlText = (el) =>
  _norm(
    el.value ||
      el.getAttribute?.("data-value") ||
      el.getAttribute?.("aria-label") ||
      el.textContent,
  );

// An element's own direct text only (ignores text inside descendants), so a big
// wrapper that merely *contains* the word "Tier" deep down doesn't match.
const _ownText = (el) =>
  _norm(
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(" "),
  );

// Hide the theme's tier selector from customers (it's driven by the picker). We
// still programmatically click it, which works on hidden elements. Themes vary a
// lot in how they mark up variant options — labels vs legends vs plain divs,
// selects vs radios vs custom button pills — so we match by several signals,
// strongest first, and hide the smallest group that wraps just that one option.
function hideTierOption() {
  // Works with or without a saved tier mapping. With a mapping we know exactly
  // which option is the tier; without one we use the same legacy assumption the
  // rest of the picker relies on — the 2nd option is the tier, the 1st the size.
  const tierName = useConfig ? tierConfig.tierOption : optionNames[1];
  if (!tierName) return;
  const sIdx = useConfig ? sizeIndex : optionNames.length > 1 ? 0 : -1;

  const form = document.querySelector('form[action*="/cart/add"]');
  const scope = form || document;
  const name = _norm(tierName);

  // The tier option's possible values (Base/Light/Medium/Dark). Used to
  // recognise the option's group on themes with no helpful markup.
  const tierValues = (
    useConfig
      ? Object.values(tierConfig.tierValues || {})
      : Object.values(tierMapping)
  )
    .filter(Boolean)
    .map(_norm);

  // The size option's values — so we can refuse to hide a container that also
  // holds the size selector (hiding the size option would break purchasing; a
  // still-visible tier is the safer failure).
  const sizeValues =
    sIdx >= 0
      ? [
          ...new Set(
            (window.__paintData?.variants || [])
              .map((v) => _norm(v.options?.[sIdx]))
              .filter(Boolean),
          ),
        ]
      : [];

  const holdsAny = (root, values) => {
    if (!values.length) return false;
    let found = false;
    root
      .querySelectorAll("button, label, [role='radio'], [role='button'], input, a, option")
      .forEach((c) => {
        if (values.includes(_controlText(c))) found = true;
      });
    return found;
  };

  // Containers common themes use to wrap a single variant option.
  const CONTAINERS =
    "fieldset, .product-form__input, .product-form__option, .product-options," +
    " .variant-input-wrap, .selector-wrapper, [data-option-index], [data-option-name]";

  // The option name as a leading whole word: "Tier", "Tier: Light", "Tier Light"
  // match; "Tiers" / "Material" don't.
  const labelMatches = (text) => {
    const t = _norm(text);
    return t === name || (t.startsWith(name) && /[\s:]/.test(t[name.length] || ""));
  };

  // Does this subtree hold at least two distinct tier values? (Distinguishes the
  // tier group from the size group, whose values are different.)
  const holdsTierValues = (root) => {
    if (tierValues.length < 2) return false;
    const seen = new Set();
    root
      .querySelectorAll("button, label, [role='radio'], [role='button'], input, a, option")
      .forEach((c) => {
        const t = _controlText(c);
        if (tierValues.includes(t)) seen.add(t);
      });
    return seen.size >= 2;
  };

  // Hide the nearest sensible wrapper around `el`. Prefer a known container class;
  // otherwise climb to the smallest ancestor that holds the tier values, never
  // reaching the whole form. Refuse to hide anything that also holds the size
  // values, so the size selector is never collateral damage.
  const hideGroup = (el) => {
    let box = el.closest(CONTAINERS);
    if (!box) {
      // Climb from el to the smallest ancestor that holds the tier values — stop
      // as soon as the current node already contains them (don't overshoot).
      box = el;
      let guard = 0;
      while (
        !holdsTierValues(box) &&
        box.parentElement &&
        box.parentElement !== form &&
        box.parentElement !== document.body &&
        guard++ < 8
      ) {
        box = box.parentElement;
      }
    }
    if (!box || box === form || box === document.body) return false;
    if (holdsAny(box, sizeValues)) return false;
    box.style.display = "none";
    return true;
  };

  // 1) Strongest: a control named options[Tier] or carrying data-option-name.
  let hidden = false;
  scope
    .querySelectorAll("select, input[type='radio'], [data-option-name]")
    .forEach((ctrl) => {
      const nm = (ctrl.getAttribute("name") || "").toLowerCase();
      const dn = _norm(ctrl.getAttribute("data-option-name"));
      if ((nm.includes(`[${name}]`) || dn === name) && hideGroup(ctrl)) {
        hidden = true;
      }
    });

  // 2) Any element whose own text is the option name — covers themes that render
  //    the option heading as a plain div/span/legend above custom button pills.
  if (!hidden) {
    scope
      .querySelectorAll("legend, label, .form__label, span, div, p, h2, h3, h4")
      .forEach((el) => {
        if (labelMatches(_ownText(el)) && hideGroup(el)) {
          hidden = true;
        }
      });
  }
}

// Themes often render the variant picker after our module runs, and re-render it
// on variant change. Run the hide now, again on a few short delays, and once more
// whenever the cart form's subtree mutates — so the tier option stays hidden.
let _tierHideObserver = null;
function keepTierHidden() {
  hideTierOption();
  [150, 500, 1200].forEach((ms) => setTimeout(hideTierOption, ms));

  if (_tierHideObserver || typeof MutationObserver === "undefined") return;
  const target =
    document.querySelector('form[action*="/cart/add"]') || document.body;
  if (!target) return;
  let scheduled = false;
  _tierHideObserver = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      hideTierOption();
    });
  });
  _tierHideObserver.observe(target, { childList: true, subtree: true });
}

// Re-resolves the variant whenever the customer changes the size through the
// theme's own variant picker (which updates the URL / browser history).
function listenSizeChange() {
  const onThemeUpdate = () => {
    resolveVariant();
    hideTierOption();
  };

  const _replace = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    _replace(...args);
    onThemeUpdate();
  };

  const _push = history.pushState.bind(history);
  history.pushState = function (...args) {
    _push(...args);
    onThemeUpdate();
  };

  window.addEventListener("popstate", onThemeUpdate);
}

// ── MODAL UI ──────────────────────────────────────────────────────────────────

function buildModal() {
  if (document.getElementById(OVERLAY_ID)) return;

  const paletteOptions = PALETTES
    .map((p) => `<option value="${p}">${p}</option>`)
    .join("");

  const paletteCount = PALETTES.length;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div id="shade-modal" role="dialog" aria-modal="true" aria-label="Scegli la tonalità di vernice">
      <div class="shade-modal__header">
        <div class="shade-modal__title">
          <h2><span class="cp-blue">Scegli il colore</span> per il tuo prodotto!</h2>
          <p>Seleziona i filtri di cui hai bisogno dal menu a destra e clicca su un colore per applicarlo al tuo prodotto.</p>
        </div>
        <div class="shade-modal__controls" id="shade-filters">
          <div class="shade-modal__select-group">
            <label for="shade-palette-select">Palette (${paletteCount} disponibili)</label>
            <select id="shade-palette-select">
              <option value="">Seleziona palette</option>
              ${paletteOptions}
            </select>
          </div>
          <div class="shade-modal__select-group">
            <label for="shade-tone-select">Tonalità</label>
            <select id="shade-tone-select" disabled>
              <option value="">Seleziona tonalità</option>
            </select>
          </div>
          <button type="button" id="shade-near-btn" class="shade-near-btn">CERCA</button>
        </div>
        <button id="shade-close" aria-label="Chiudi finestra">&#x2715;</button>
      </div>
      <div class="shade-modal__search" id="shade-search-view" hidden>
        <button type="button" id="shade-back-btn" class="shade-back-btn">&larr; Torna ai filtri</button>
        <div class="shade-search-row">
          <input type="search" id="shade-search" placeholder="Cosa stai cercando?" autocomplete="off" />
          <button type="button" id="shade-search-start" class="shade-search-start">AVVIA</button>
        </div>
      </div>
      <div id="shade-grid" role="listbox" aria-label="Tonalità di colore"></div>
      <div class="shade-modal__footer" id="shade-footer">
        <span class="shade-no-selection">Nessuna tonalità selezionata</span>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal({ clearState: false });
  });

  document
    .getElementById("shade-close")
    .addEventListener("click", () => closeModal({ clearState: false }));

  document
    .getElementById("shade-palette-select")
    .addEventListener("change", onPaletteChange);
  document
    .getElementById("shade-tone-select")
    .addEventListener("change", applyFilters);

  document
    .getElementById("shade-near-btn")
    .addEventListener("click", () => setSearchMode(true));
  document
    .getElementById("shade-back-btn")
    .addEventListener("click", () => setSearchMode(false));

  const searchInput = document.getElementById("shade-search");
  searchInput.addEventListener("input", applyFilters);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyFilters();
    }
  });
  document
    .getElementById("shade-search-start")
    .addEventListener("click", applyFilters);
}

// Toggles between the filter view (Palette/Tone) and the NEAR search view.
// Leaving search clears the term so the grid returns to the dropdown filters.
function setSearchMode(on) {
  document.getElementById("shade-modal").classList.toggle("is-searching", on);
  document.getElementById("shade-filters").hidden = on;
  document.getElementById("shade-search-view").hidden = !on;
  const search = document.getElementById("shade-search");
  if (on) {
    search.focus();
  } else {
    search.value = "";
    applyFilters();
  }
}

function openModal() {
  document.getElementById(OVERLAY_ID).classList.add("is-open");
  document.body.style.overflow = "hidden";
  // Always open on the filter view.
  document.getElementById("shade-modal").classList.remove("is-searching");
  document.getElementById("shade-filters").hidden = false;
  document.getElementById("shade-search-view").hidden = true;
  document.getElementById("shade-search").value = "";
  autoSelectDefaults();
}

function autoSelectDefaults() {
  const paletteSelect = document.getElementById("shade-palette-select");

  if (window.__paintState?.shade) return;

  const firstPalette = PALETTES[0];
  paletteSelect.value = firstPalette;
  populateTones(firstPalette);

  applyFilters();
}

function closeModal({ clearState = false } = {}) {
  document.getElementById(OVERLAY_ID).classList.remove("is-open");
  document.body.style.overflow = "";

  if (clearState) {
    window.__paintState = null;
    document.getElementById("shade-footer").innerHTML =
      '<span class="shade-no-selection">Nessuna tonalità selezionata</span>';
    document
      .querySelectorAll(".shade-chip--active")
      .forEach((c) => c.classList.remove("shade-chip--active"));
    updateColorButtons(null);
  }
}

// ── FILTERING ───────────────────────────────────────────────────────────────

function populateTones(paletteVal) {
  const toneSelect = document.getElementById("shade-tone-select");
  toneSelect.innerHTML = '<option value="">Tutte le tonalità</option>';

  if (!paletteVal) {
    toneSelect.disabled = true;
    return;
  }

  // Colour count per tone, shown in the dropdown as e.g. "Gialli (526)". The
  // option's value stays the raw tone name so filtering is unaffected.
  const counts = {};
  SHADES.forEach((s) => {
    if (s.palette === paletteVal) counts[s.tone] = (counts[s.tone] || 0) + 1;
  });

  const tones = Array.from(TONES_BY_PALETTE[paletteVal] || []);
  tones.forEach((tone) => {
    const opt = document.createElement("option");
    opt.value = tone;
    opt.textContent = `${tone} (${counts[tone] || 0})`;
    toneSelect.appendChild(opt);
  });
  toneSelect.disabled = false;
  toneSelect.value = "";
}

function onPaletteChange(e) {
  populateTones(e.target.value);
  applyFilters();
}

// Renders the grid for whichever view is active. When the NEAR search has a term
// it matches the colour code across the whole catalog; otherwise the Palette/Tone
// dropdowns drive the grid.
function applyFilters() {
  const term = (document.getElementById("shade-search")?.value || "")
    .trim()
    .toLowerCase();

  if (term) {
    renderGrid(SHADES.filter((s) => s.code.toLowerCase().includes(term)));
    return;
  }

  const paletteVal = document.getElementById("shade-palette-select").value;
  if (!paletteVal) {
    document.getElementById("shade-grid").innerHTML = "";
    return;
  }

  const toneVal = document.getElementById("shade-tone-select").value;
  renderGrid(
    SHADES.filter(
      (s) => s.palette === paletteVal && (!toneVal || s.tone === toneVal),
    ),
  );
}

function renderGrid(shades) {
  const grid = document.getElementById("shade-grid");
  grid.innerHTML = "";

  if (!shades.length) {
    grid.innerHTML =
      '<p class="shade-grid__empty">Nessun colore corrisponde alla tua ricerca.</p>';
    return;
  }

  shades.forEach((shade) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "shade-chip";
    chip.setAttribute("role", "option");
    chip.dataset.code = shade.code;
    chip.innerHTML = `
      <span class="shade-chip__swatch" style="background:${shade.hex}"></span>
      <span class="shade-chip__label">${shade.code}</span>
      <span class="shade-chip__check" aria-hidden="true"></span>
    `;
    chip.addEventListener("click", () => selectShade(shade));
    grid.appendChild(chip);
  });
}

function selectShade(shade) {
  document
    .querySelectorAll(".shade-chip")
    .forEach((c) => c.classList.remove("shade-chip--active"));

  const activeChip = document.querySelector(
    `.shade-chip[data-code="${CSS.escape(shade.code)}"]`,
  );
  if (activeChip) activeChip.classList.add("shade-chip--active");

  document.getElementById("shade-footer").innerHTML = `
    <div class="shade-swatch-circle" style="background:${shade.hex}"></div>
    <span class="shade-selected-code">${shade.code} &mdash; ${shade.hex}</span>
  `;

  window.__paintState = { shade };
  updateColorButtons(shade);

  setTimeout(() => {
    closeModal({ clearState: false });
    resolveVariant();
  }, 300);
}

// ── ERROR FEEDBACK ────────────────────────────────────────────────────────────

function showError(message) {
  const el = document.getElementById("pk-error");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function clearError() {
  const el = document.getElementById("pk-error");
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}

// ── CART DISPLAY ─────────────────────────────────────────────────────────────

function getContrastColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#111" : "#fff";
}

function updateColorButtons(shade) {
  const whiteBtn  = document.getElementById("select-base-color");
  const customBtn = document.getElementById("open-shade-modal");
  if (!whiteBtn || !customBtn) return;

  if (shade) {
    // Preview the picked colour on the custom button.
    customBtn.style.background   = shade.hex;
    customBtn.style.color        = getContrastColor(shade.hex);
    customBtn.style.borderColor  = shade.hex;
    customBtn.textContent        = shade.code;
  } else {
    // Reset to the merchant-configured colours. Clearing the inline styles lets
    // the CSS (driven by the theme-editor variables) take over again.
    customBtn.style.background   = "";
    customBtn.style.color        = "";
    customBtn.style.borderColor  = "";
    customBtn.textContent        = customBtn.dataset.defaultLabel || "Colorato";
  }
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
buildModal();
listenSizeChange();
keepTierHidden();

const openBtn = document.getElementById("open-shade-modal");
if (openBtn) openBtn.addEventListener("click", openModal);

const whiteBtn = document.getElementById("select-base-color");
if (whiteBtn) {
  whiteBtn.addEventListener("click", () => {
    if (_resolvingVariant) return;
    window.__paintState = { white: true };
    clearError();
    syncCartProperties();
    document.getElementById("shade-footer").innerHTML =
      '<span class="shade-no-selection">Nessuna tonalità selezionata</span>';
    document
      .querySelectorAll(".shade-chip--active")
      .forEach((c) => c.classList.remove("shade-chip--active"));
    // Tier-1 is the configured base value, falling back to "White"/"Base".
    const baseValue = useConfig ? tierConfig.tierValues?.base : null;
    if (!(baseValue && selectThemeOption(baseValue))) {
      if (!selectThemeOption("White")) selectThemeOption("Base");
    }
    updateColorButtons(null);
  });
}

updateColorButtons(null);

// ── CART LINE-ITEM PROPERTIES ──────────────────────────────────────────────────
// The colour is written to the cart as line-item properties. To be reliable
// across every add path we attach it two ways:
//   1. Persisted as hidden inputs in the cart form (covers native POST and the
//      dynamic checkout / Buy-it-now buttons, which serialize the form).
//   2. Injected into the /cart/add request body (covers AJAX carts, immune to the
//      theme re-rendering the form on variant change).
// "Colore" has no leading underscore so it shows in cart, checkout and the order;
// "_hex" stays hidden for an optional swatch.

function getCartForm() {
  return document.querySelector('form[action*="/cart/add"]');
}

// The properties for the current selection, or null when nothing is chosen yet.
// The white value mirrors the button's visible label, so renaming the button in
// the snippet/settings renames the cart property value too.
function currentPaintProperties() {
  const state = window.__paintState;
  if (state?.shade) {
    return {
      Colore: `${state.shade.palette} — ${state.shade.code}`,
      _hex: state.shade.hex,
    };
  }
  if (state?.white) {
    const label = document
      .getElementById("select-base-color")
      ?.textContent.trim();
    return { Colore: label || "Bianco", _hex: "#FFFFFF" };
  }
  return null;
}

function injectHiddenInput(form, name, value) {
  let input = form.querySelector(`input[name="${name}"]`);
  if (!input) {
    input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    form.appendChild(input);
  }
  input.value = value;
}

function removeHiddenInput(form, name) {
  const input = form.querySelector(`input[name="${name}"]`);
  if (input) input.remove();
}

// Mirrors the current selection into the cart form's hidden inputs.
function syncCartProperties() {
  const form = getCartForm();
  if (!form) return;
  const props = currentPaintProperties();
  if (!props) {
    clearCartProperties();
    return;
  }
  Object.entries(props).forEach(([key, value]) =>
    injectHiddenInput(form, `properties[${key}]`, value),
  );
}

function clearCartProperties() {
  const form = getCartForm();
  if (!form) return;
  ["Colore", "_hex"].forEach((key) =>
    removeHiddenInput(form, `properties[${key}]`),
  );
}

// Merges the colour properties (and the resolved variant id) into an outgoing
// /cart/add request body, whatever shape the theme uses (FormData,
// URLSearchParams, JSON or url-encoded string). Forcing the id guarantees the
// correct tier is added even if the on-page variant picker couldn't be driven.
function mergeBodyProperties(body, props, variantId) {
  const fields = Object.entries(props).map(([k, v]) => [`properties[${k}]`, v]);
  if (variantId) fields.push(["id", String(variantId)]);

  if (body instanceof FormData || body instanceof URLSearchParams) {
    fields.forEach(([k, v]) => body.set(k, v));
    return body;
  }

  if (typeof body === "string") {
    try {
      const json = JSON.parse(body);
      // /cart/add.js accepts either a single item or an { items: [...] } batch.
      const target =
        Array.isArray(json.items) && json.items.length === 1
          ? json.items[0]
          : json;
      target.properties = { ...(target.properties || {}), ...props };
      if (variantId) target.id = variantId;
      return JSON.stringify(json);
    } catch {
      const params = new URLSearchParams(body);
      fields.forEach(([k, v]) => params.set(k, v));
      return params.toString();
    }
  }

  return body;
}

// Intercepts AJAX adds so the colour rides along even if the theme rebuilt the
// form (and thus dropped our hidden inputs) on the last variant change.
function interceptCartAdd() {
  const isCartAdd = (url) => /\/cart\/add(\.js)?(\?|$)/.test(String(url || ""));
  const _fetch = window.fetch;
  if (typeof _fetch !== "function") return;

  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url;
      const props = currentPaintProperties();
      // variantId is only set for shades; for White the theme's own picker
      // already tracks the right variant, so we merge the properties without
      // forcing an id.
      const variantId = window.__paintState?.variantId;
      if (props && isCartAdd(url) && init && init.body != null) {
        init = { ...init, body: mergeBodyProperties(init.body, props, variantId) };
      }
    } catch {
      /* never let our patch break the theme's add-to-cart */
    }
    return _fetch.call(this, input, init);
  };
}

// ── FORM INTERCEPT ────────────────────────────────────────────────────────────

interceptCartAdd();

const form = getCartForm();
if (form) {
  form.addEventListener(
    "submit",
    (e) => {
      const state = window.__paintState;
      if (!state) return;

      if (state.shade) {
        // A colour is chosen but no matching variant resolved — block the add
        // and surface the reason rather than adding the wrong-priced variant.
        if (!state.variantId) {
          e.preventDefault();
          e.stopImmediatePropagation();
          showError(
            "Questo colore non è disponibile nel formato selezionato. Scegline un altro.",
          );
          return;
        }

        const idInput = form.querySelector('input[name="id"]');
        if (idInput) idInput.value = state.variantId;
      }

      // Re-sync (covers White too) in case the form was re-rendered since the
      // selection was made.
      syncCartProperties();
    },
    { capture: true },
  );
}
