// ── PALETTE DATA ──────────────────────────────────────────────────────────────
import { palette, palettes, tonesByPalette } from "./ncs-palette.js";
import { tierMapping } from "./utils.js";

// ── STATE ─────────────────────────────────────────────────────────────────────
// window.__paintState = { shade, variantId } — cleared on "White" click
// window.__paintData  = { variants } — injected by Liquid

const OVERLAY_ID = "shade-overlay";
let _resolvingVariant = false;

// ── VARIANT RESOLUTION ────────────────────────────────────────────────────────

// Reads the size (option1) the customer has selected via the theme's own
// variant picker, so the colour resolves to the correctly-priced size × tier
// variant. Falls back to the first variant for single-size products.
function getSelectedSize() {
  const urlId = parseInt(
    new URLSearchParams(window.location.search).get("variant"),
    10,
  );
  if (urlId) {
    const v = (window.__paintData?.variants || []).find((v) => v.id === urlId);
    if (v) return v.option1;
  }

  const hidden = document.querySelector(
    'form[action*="/cart/add"] input[name="id"]',
  );
  if (hidden?.value) {
    const v = (window.__paintData?.variants || []).find(
      (v) => v.id === parseInt(hidden.value, 10),
    );
    if (v) return v.option1;
  }

  return window.__paintData?.variants?.[0]?.option1 ?? null;
}

function resolveVariant() {
  if (_resolvingVariant) return;

  const shade = window.__paintState?.shade;
  const size  = getSelectedSize();
  const tier  = shade ? tierMapping[shade.tier] : null;

  if (!shade || !size) return;

  const variant = (window.__paintData?.variants || []).find(
    (v) => v.option1 === size && v.option2 === tier,
  );

  if (!variant) {
    // The colour's tier has no variant in the chosen size — tell the customer
    // instead of silently adding the wrong variant on submit.
    window.__paintState.variantId = null;
    showError(
      `“${shade.code}” isn't available in the selected size. Pick another size or colour.`,
    );
    return;
  }

  clearError();
  window.__paintState.variantId = variant.id;

  const tierInput = findOptionInput(tier);
  if (tierInput && !tierInput.checked) {
    _resolvingVariant = true;
    tierInput.checked = true;
    tierInput.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => { _resolvingVariant = false; }, 800);
  }

  updateColorButtons(shade);
}

// Finds the theme's hidden variant-option radio/input for a given option value.
// Scoped to the cart form when possible to avoid colliding with unrelated inputs.
function findOptionInput(value) {
  if (!value) return null;
  const form = document.querySelector('form[action*="/cart/add"]');
  const scope = form || document;
  return scope.querySelector(`input[value="${CSS.escape(value)}"]`);
}

// Re-resolves the variant whenever the customer changes the size through the
// theme's own variant picker (which updates the URL / browser history).
function listenSizeChange() {
  const _replace = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    _replace(...args);
    resolveVariant();
  };

  const _push = history.pushState.bind(history);
  history.pushState = function (...args) {
    _push(...args);
    resolveVariant();
  };

  window.addEventListener("popstate", resolveVariant);
}

// ── MODAL UI ──────────────────────────────────────────────────────────────────

function buildModal() {
  if (document.getElementById(OVERLAY_ID)) return;

  const paletteOptions = palettes
    .map((p) => `<option value="${p}">${p}</option>`)
    .join("");

  const paletteCount = palettes.length;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div id="shade-modal" role="dialog" aria-modal="true" aria-label="Choose paint shade">
      <div class="shade-modal__header">
        <div class="shade-modal__title">
          <h2><span class="cp-blue">Choose the color</span> for your product!</h2>
          <p>Select the filters you need from the menu on the right and click on a color to apply it to your product.</p>
        </div>
        <div class="shade-modal__controls" id="shade-filters">
          <div class="shade-modal__select-group">
            <label for="shade-palette-select">Palette (${paletteCount} Available)</label>
            <select id="shade-palette-select">
              <option value="">Select palette</option>
              ${paletteOptions}
            </select>
          </div>
          <div class="shade-modal__select-group">
            <label for="shade-tone-select">Tone</label>
            <select id="shade-tone-select" disabled>
              <option value="">Select shade</option>
            </select>
          </div>
          <button type="button" id="shade-near-btn" class="shade-near-btn">NEAR</button>
        </div>
        <button id="shade-close" aria-label="Close modal">&#x2715;</button>
      </div>
      <div class="shade-modal__search" id="shade-search-view" hidden>
        <button type="button" id="shade-back-btn" class="shade-back-btn">&larr; Back to filters</button>
        <div class="shade-search-row">
          <input type="search" id="shade-search" placeholder="What are you looking for?" autocomplete="off" />
          <button type="button" id="shade-search-start" class="shade-search-start">START</button>
        </div>
      </div>
      <div id="shade-grid" role="listbox" aria-label="Color shades"></div>
      <div class="shade-modal__footer" id="shade-footer">
        <span class="shade-no-selection">No shade selected</span>
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
  const toneSelect    = document.getElementById("shade-tone-select");

  if (window.__paintState?.shade) return;

  const firstPalette = palettes[0];
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
      '<span class="shade-no-selection">No shade selected</span>';
    document
      .querySelectorAll(".shade-chip--active")
      .forEach((c) => c.classList.remove("shade-chip--active"));
    updateColorButtons(null);
  }
}

// ── FILTERING ───────────────────────────────────────────────────────────────

function populateTones(paletteVal) {
  const toneSelect = document.getElementById("shade-tone-select");
  toneSelect.innerHTML = '<option value="">All shades</option>';

  if (!paletteVal) {
    toneSelect.disabled = true;
    return;
  }

  const tones = Array.from(tonesByPalette[paletteVal] || []);
  tones.forEach((tone) => {
    const opt = document.createElement("option");
    opt.value = tone;
    opt.textContent = tone;
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
    renderGrid(palette.filter((s) => s.code.toLowerCase().includes(term)));
    return;
  }

  const paletteVal = document.getElementById("shade-palette-select").value;
  if (!paletteVal) {
    document.getElementById("shade-grid").innerHTML = "";
    return;
  }

  const toneVal = document.getElementById("shade-tone-select").value;
  renderGrid(
    palette.filter(
      (s) => s.palette === paletteVal && (!toneVal || s.tone === toneVal),
    ),
  );
}

function renderGrid(shades) {
  const grid = document.getElementById("shade-grid");
  grid.innerHTML = "";

  if (!shades.length) {
    grid.innerHTML =
      '<p class="shade-grid__empty">No colours match your search.</p>';
    return;
  }

  shades.forEach((shade) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "shade-chip";
    chip.setAttribute("role", "option");
    chip.dataset.code = shade.code;
    chip.dataset.hex  = shade.hex;
    chip.innerHTML = `
      <span class="shade-chip__swatch" style="background:${shade.hex}"></span>
      <span class="shade-chip__label">${shade.code}</span>
      <span class="shade-chip__check" aria-hidden="true">
        <svg width="10" height="8" viewBox="0 0 10 8" fill="none"
             stroke="#fff" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1,4 4,7 9,1"/>
        </svg>
      </span>
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
    customBtn.textContent        = customBtn.dataset.defaultLabel || "Colored";
  }
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
buildModal();
listenSizeChange();

const openBtn = document.getElementById("open-shade-modal");
if (openBtn) openBtn.addEventListener("click", openModal);

const whiteBtn = document.getElementById("select-base-color");
if (whiteBtn) {
  whiteBtn.addEventListener("click", () => {
    if (_resolvingVariant) return;
    window.__paintState = null;
    clearError();
    document.getElementById("shade-footer").innerHTML =
      '<span class="shade-no-selection">No shade selected</span>';
    document
      .querySelectorAll(".shade-chip--active")
      .forEach((c) => c.classList.remove("shade-chip--active"));
    // Tier-1 may be labelled "White" or "Base" depending on the product setup.
    const baseInput = findOptionInput("White") || findOptionInput("Base");
    if (baseInput && !baseInput.checked) {
      _resolvingVariant = true;
      baseInput.checked = true;
      baseInput.dispatchEvent(new Event("change", { bubbles: true }));
      setTimeout(() => { _resolvingVariant = false; }, 800);
    }
    updateColorButtons(null);
  });
}

updateColorButtons(null);

// ── FORM INTERCEPT ────────────────────────────────────────────────────────────

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

const form = document.querySelector('form[action*="/cart/add"]');
if (form) {
  form.addEventListener(
    "submit",
    (e) => {
      if (!window.__paintState?.shade) return;

      // A colour is chosen but no matching variant resolved — block the add and
      // surface the reason rather than adding the wrong-priced variant.
      if (!window.__paintState.variantId) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showError(
          "This colour isn't available in the selected size. Please choose another.",
        );
        return;
      }

      const idInput = form.querySelector('input[name="id"]');
      if (idInput) idInput.value = window.__paintState.variantId;

      const { shade } = window.__paintState;
      // Visible line-item properties (no leading underscore) so the colour shows
      // in cart, checkout and on the order for fulfilment. _hex stays hidden.
      injectHiddenInput(form, "properties[Color Code]", shade.code);
      injectHiddenInput(form, "properties[Palette]",    shade.palette);
      injectHiddenInput(form, "properties[_hex]",       shade.hex);
    },
    { capture: true },
  );
}
