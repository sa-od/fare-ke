// ── PALETTE DATA ──────────────────────────────────────────────────────────────
import { palette, palettes, tonesByPalette } from "./ncs-palette.js";
import { tierMapping } from "./utils.js";

// ── STATE ─────────────────────────────────────────────────────────────────────
// window.__paintState = { shade, variantId } — cleared on "White" click
// window.__paintData  = { variants, productPrice, … } — injected by Liquid

const OVERLAY_ID = "shade-overlay";
let _resolvingVariant = false;

// ── VARIANT RESOLUTION ────────────────────────────────────────────────────────

function getSelectedFormat() {
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

  const shade  = window.__paintState?.shade;
  const format = getSelectedFormat();
  const tier   = shade ? tierMapping[shade.tier] : null;

  if (!shade || !format) return;

  const variant = (window.__paintData?.variants || []).find(
    (v) => v.option1 === format && v.option2 === tier,
  );
  if (!variant) return;

  window.__paintState.variantId = variant.id;

  const tierInput = document.querySelector(`input[value="${tier}"]`);
  if (tierInput && !tierInput.checked) {
    _resolvingVariant = true;
    tierInput.checked = true;
    tierInput.dispatchEvent(new Event("change", { bubbles: true }));
    setTimeout(() => { _resolvingVariant = false; }, 800);
  }

  updateColorButtons(shade);
}

function listenFormatChange() {
  function onHistoryChange() {
    resolveVariant();
    const select = document.getElementById("pk-format-select");
    if (select) {
      const fmt = getSelectedFormat();
      if (fmt && select.value !== fmt) select.value = fmt;
    }
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

// ── MODAL UI ──────────────────────────────────────────────────────────────────

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

function openModal() {
  document.getElementById(OVERLAY_ID).classList.add("is-open");
  document.body.style.overflow = "hidden";
  autoSelectDefaults();
}

function autoSelectDefaults() {
  const paletteSelect = document.getElementById("shade-palette-select");
  const toneSelect    = document.getElementById("shade-tone-select");

  if (window.__paintState?.shade) return;

  const firstPalette = palettes[0];
  paletteSelect.value = firstPalette;

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

function onPaletteChange(e) {
  const selected  = e.target.value;
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

  renderGrid(palette.filter((s) => s.palette === selected));
}

function onToneChange(e) {
  const paletteVal = document.getElementById("shade-palette-select").value;
  const toneVal    = e.target.value;

  if (!paletteVal) { document.getElementById("shade-grid").innerHTML = ""; return; }

  renderGrid(
    toneVal
      ? palette.filter((s) => s.palette === paletteVal && s.tone === toneVal)
      : palette.filter((s) => s.palette === paletteVal),
  );
}

function renderGrid(shades) {
  const grid = document.getElementById("shade-grid");
  grid.innerHTML = "";

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
    whiteBtn.style.borderColor   = "#d1d5db";
    customBtn.style.background   = shade.hex;
    customBtn.style.color        = getContrastColor(shade.hex);
    customBtn.style.borderColor  = "#2563eb";
    customBtn.textContent        = shade.code;
  } else {
    whiteBtn.style.borderColor   = "#cccccc";
    customBtn.style.background   = "#1a6faf";
    customBtn.style.color        = "#fff";
    customBtn.style.borderColor  = "#1a6faf";
    customBtn.textContent        = customBtn.dataset.defaultLabel || "Custom Colors";
  }
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
buildModal();
listenFormatChange();

const openBtn = document.getElementById("open-shade-modal");
if (openBtn) openBtn.addEventListener("click", openModal);

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
    () => {
      if (!window.__paintState?.variantId) return;

      const idInput = form.querySelector('input[name="id"]');
      if (idInput) idInput.value = window.__paintState.variantId;

      if (window.__paintState.shade) {
        injectHiddenInput(form, "properties[Shade]", window.__paintState.shade.code);
        injectHiddenInput(form, "properties[_hex]",  window.__paintState.shade.hex);
      }
    },
    { capture: true },
  );
}
