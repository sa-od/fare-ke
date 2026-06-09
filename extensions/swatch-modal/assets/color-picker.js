import { palette, palettes, tonesByPalette } from "./ncs-palette.js";

const OVERLAY_ID = "shade-overlay";

// ── helpers ────────────────────────────────────────────────────
function formatMoney(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function getSelectedFormat() {
  // URL is updated synchronously by replaceState/pushState before the section
  // re-renders, so it's the most accurate signal at the moment resolveVariant fires.
  const urlId = parseInt(
    new URLSearchParams(window.location.search).get("variant"),
    10,
  );
  if (urlId) {
    const v = (window.__paintData?.variants || []).find((v) => v.id === urlId);
    if (v) return v.option1;
  }

  // Fallback: hidden input Ritual keeps in the product form (confirmed present
  // on live store via DevTools — value updates after section re-renders).
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

// ── build ──────────────────────────────────────────────────────
function buildModal() {
  if (document.getElementById(OVERLAY_ID)) return;

  const paletteOptions = palettes
    .map((p) => `<option value="${p}">${p}</option>`)
    .join("");

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div id="shade-modal" role="dialog" aria-modal="true" aria-label="Choose paint shade">
      <div class="shade-modal__header">
        <div class="shade-modal__title">
          <h2><span class="cp-blue">Choose the color</span> for your product!</h2>
          <p>Select the filters and click on a color to apply it</p>
        </div>
        <div class="shade-modal__controls">
          <div class="shade-modal__select-group">
            <label for="shade-palette-select">Palette</label>
            <select id="shade-palette-select">
              <option value="">Select palette</option>
              ${paletteOptions}
            </select>
          </div>
          <div class="shade-modal__select-group">
            <label for="shade-tone-select">Tone</label>
            <select id="shade-tone-select" disabled>
              <option value="">Select tone</option>
            </select>
          </div>
          <button id="shade-close" aria-label="Close modal">&#x2715;</button>
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
    .addEventListener("change", onToneChange);
}

// ── open / close ───────────────────────────────────────────────
function openModal() {
  document.getElementById(OVERLAY_ID).classList.add("is-open");
  document.body.style.overflow = "hidden";
  autoSelectDefaults();
}

function autoSelectDefaults() {
  const paletteSelect = document.getElementById("shade-palette-select");
  const toneSelect = document.getElementById("shade-tone-select");

  if (window.__paintState?.shade) return;

  // Pre-select first palette
  const firstPalette = palettes[0];
  paletteSelect.value = firstPalette;

  // Populate tones for this palette, but leave tone unselected
  const tones = Array.from(tonesByPalette[firstPalette] || []);
  toneSelect.innerHTML = '<option value="">All tones</option>';
  tones.forEach((tone) => {
    const opt = document.createElement("option");
    opt.value = tone;
    opt.textContent = tone;
    toneSelect.appendChild(opt);
  });
  toneSelect.disabled = false;
  toneSelect.value = "";

  // Show all shades in this palette across all tones
  renderGrid(palette.filter((s) => s.palette === firstPalette));
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

// ── button state ──────────────────────────────────────────────
function getContrastColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#111" : "#fff";
}

function updateColorButtons(shade) {
  const whiteBtn = document.getElementById("select-base-color");
  const customBtn = document.getElementById("open-shade-modal");
  if (!whiteBtn || !customBtn) return;

  if (shade) {
    whiteBtn.style.borderColor = "#d1d5db";
    customBtn.style.background = shade.hex;
    customBtn.style.color = getContrastColor(shade.hex);
    customBtn.style.borderColor = "#2563eb";
    customBtn.textContent = shade.code;
  } else {
    whiteBtn.style.borderColor = "#2563eb";
    customBtn.style.background = "#1a1a1a";
    customBtn.style.color = "#fff";
    customBtn.style.borderColor = "transparent";
    customBtn.textContent = customBtn.dataset.defaultLabel || "Custom Colors";
  }
}

// ── variant resolution ─────────────────────────────────────────
// Guard prevents our replaceState interceptor from re-triggering resolveVariant
// when Ritual updates the URL after we programmatically select the tier input.
let _resolvingVariant = false;

function resolveVariant() {
  if (_resolvingVariant) return;

  const shade = window.__paintState?.shade;
  const format = getSelectedFormat();
  const tier = shade ? capitalize(shade.tier) : null;
  console.log(
    "[paint-picker] resolveVariant → shade:",
    shade?.code,
    "| format:",
    format,
    "| tier:",
    tier,
  );

  if (!shade || !format) return;

  const variant = (window.__paintData?.variants || []).find(
    (v) => v.option1 === format && v.option2 === tier,
  );
  console.log(
    "[paint-picker] matched variant:",
    variant
      ? `${variant.id} (${variant.option1} / ${variant.option2})`
      : "none",
  );
  if (!variant) return;

  window.__paintState.variantId = variant.id;

  // Instead of scraping Ritual's price DOM (which is server-rendered and
  // varies by theme), trigger Ritual's own tier input. Ritual's variant-picker
  // then handles the URL update, section re-render and price display natively.
  const tierInput = document.querySelector(`input[value="${tier}"]`);
  if (tierInput && !tierInput.checked) {
    _resolvingVariant = true;
    tierInput.checked = true;
    tierInput.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => {
      _resolvingVariant = false;
    }, 800);
  }

  updateColorButtons(shade);
}

// ── listen for Format option changes ──────────────────────────
function listenFormatChange() {
  // Ritual uses replaceState (not pushState) to update ?variant= in the URL.
  // Intercept both to be safe across themes.
  function onHistoryChange() {
    resolveVariant();
  }

  const _replace = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    _replace(...args);
    onHistoryChange();
  };

  const _push = history.pushState.bind(history);
  history.pushState = function (...args) {
    _push(...args);
    onHistoryChange();
  };

  window.addEventListener("popstate", onHistoryChange);
}

// ── dropdown handlers ──────────────────────────────────────────
function onPaletteChange(e) {
  const selected = e.target.value;
  const toneSelect = document.getElementById("shade-tone-select");

  toneSelect.innerHTML = '<option value="">All tones</option>';

  if (!selected) {
    toneSelect.disabled = true;
    document.getElementById("shade-grid").innerHTML = "";
    return;
  }

  const tones = Array.from(tonesByPalette[selected] || []);
  tones.forEach((tone) => {
    const opt = document.createElement("option");
    opt.value = tone;
    opt.textContent = tone;
    toneSelect.appendChild(opt);
  });
  toneSelect.disabled = false;
  toneSelect.value = "";

  // Show all shades in this palette (no tone filter)
  renderGrid(palette.filter((s) => s.palette === selected));
}

function onToneChange(e) {
  const paletteVal = document.getElementById("shade-palette-select").value;
  const toneVal = e.target.value;

  if (!paletteVal) { document.getElementById("shade-grid").innerHTML = ""; return; }

  renderGrid(
    toneVal
      ? palette.filter((s) => s.palette === paletteVal && s.tone === toneVal)
      : palette.filter((s) => s.palette === paletteVal),
  );
}

// ── grid ───────────────────────────────────────────────────────
function renderGrid(shades) {
  const grid = document.getElementById("shade-grid");
  grid.innerHTML = "";

  shades.forEach((shade) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "shade-chip";
    chip.setAttribute("role", "option");
    chip.dataset.code = shade.code;
    chip.dataset.hex = shade.hex;
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

// ── selection ──────────────────────────────────────────────────
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
  console.log(
    "[paint-picker] shade set →",
    shade.code,
    "| tier:",
    shade.tier,
    "| state:",
    window.__paintState,
  );
  updateColorButtons(shade);

  setTimeout(() => {
    closeModal({ clearState: false });
    resolveVariant();
  }, 300);
}

// ── boot ───────────────────────────────────────────────────────
buildModal();
listenFormatChange();

const btn = document.getElementById("open-shade-modal");
if (btn) btn.addEventListener("click", openModal);

const whiteBtn = document.getElementById("select-base-color");
if (whiteBtn) {
  whiteBtn.addEventListener("click", () => {
    if (_resolvingVariant) return;
    window.__paintState = null;
    document.getElementById("shade-footer").innerHTML =
      '<span class="shade-no-selection">No shade selected</span>';
    document
      .querySelectorAll(".shade-chip--active")
      .forEach((c) => c.classList.remove("shade-chip--active"));
    const baseInput = document.querySelector('input[value="Base"]');
    if (baseInput && !baseInput.checked) {
      _resolvingVariant = true;
      baseInput.checked = true;
      baseInput.dispatchEvent(new Event("change", { bubbles: true }));
      setTimeout(() => {
        _resolvingVariant = false;
      }, 800);
    }
    updateColorButtons(null);
  });
}

// Set initial active state: White is default
updateColorButtons(null);

// ── cart form intercept ────────────────────────────────────────
function injectHiddenInput(form, name, value) {
  // Quoted attribute value selector — brackets in value need no escaping
  let input = form.querySelector(`input[name="${name}"]`);
  if (!input) {
    input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    form.appendChild(input);
  }
  input.value = value;
}

// Patch form inputs in capture phase before Ritual reads new FormData(form)
// in its bubble-phase handler. No stopPropagation — Ritual handles the cart add
// exactly once, with our variant ID and properties already in the form.
const form = document.querySelector('form[action*="/cart/add"]');
if (form) {
  form.addEventListener(
    "submit",
    () => {
      if (!window.__paintState?.variantId) return;

      const idInput = form.querySelector('input[name="id"]');
      if (idInput) idInput.value = window.__paintState.variantId;

      if (window.__paintState.shade) {
        injectHiddenInput(
          form,
          "properties[Shade]",
          window.__paintState.shade.code,
        );
        injectHiddenInput(
          form,
          "properties[_hex]",
          window.__paintState.shade.hex,
        );
      }
    },
    { capture: true },
  );
}
