import { palette, palettes, tonesByPalette } from './ncs-palette.js';

const OVERLAY_ID = 'shade-overlay';

// ── build ──────────────────────────────────────────────────────
function buildModal() {
  if (document.getElementById(OVERLAY_ID)) return;

  const paletteOptions = palettes
    .map((p) => `<option value="${p}">${p}</option>`)
    .join('');

  const overlay = document.createElement('div');
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

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal({ clearState: true });
  });

  document.getElementById('shade-close').addEventListener('click', () =>
    closeModal({ clearState: true })
  );

  document.getElementById('shade-palette-select').addEventListener('change', onPaletteChange);
  document.getElementById('shade-tone-select').addEventListener('change', onToneChange);
}

// ── open / close ───────────────────────────────────────────────
function openModal() {
  document.getElementById(OVERLAY_ID).classList.add('is-open');
  document.body.style.overflow = 'hidden';
  autoSelectDefaults();
}

function autoSelectDefaults() {
  const paletteSelect = document.getElementById('shade-palette-select');
  if (paletteSelect.value) return; // already selected — preserve state

  const firstPalette = palettes[0];
  paletteSelect.value = firstPalette;

  const toneSelect = document.getElementById('shade-tone-select');
  toneSelect.innerHTML = '<option value="">Select tone</option>';
  const tones = Array.from(tonesByPalette[firstPalette] || []);
  tones.forEach((tone) => {
    const opt = document.createElement('option');
    opt.value = tone;
    opt.textContent = tone;
    toneSelect.appendChild(opt);
  });
  toneSelect.disabled = false;

  const firstTone = tones[0];
  if (!firstTone) return;
  toneSelect.value = firstTone;

  renderGrid(palette.filter((s) => s.palette === firstPalette && s.tone === firstTone));
}

function closeModal({ clearState = false } = {}) {
  document.getElementById(OVERLAY_ID).classList.remove('is-open');
  document.body.style.overflow = '';

  if (clearState) {
    window.__paintState = null;
    document.getElementById('shade-footer').innerHTML =
      '<span class="shade-no-selection">No shade selected</span>';
    document.querySelectorAll('.shade-chip--active').forEach((c) =>
      c.classList.remove('shade-chip--active')
    );
  }
}

// ── dropdown handlers ──────────────────────────────────────────
function onPaletteChange(e) {
  const selected = e.target.value;
  const toneSelect = document.getElementById('shade-tone-select');

  toneSelect.innerHTML = '<option value="">Select tone</option>';

  if (!selected || !tonesByPalette[selected]) {
    toneSelect.disabled = true;
    document.getElementById('shade-grid').innerHTML = '';
    return;
  }

  const tones = Array.from(tonesByPalette[selected]);
  tones.forEach((tone) => {
    const opt = document.createElement('option');
    opt.value = tone;
    opt.textContent = tone;
    toneSelect.appendChild(opt);
  });
  toneSelect.disabled = false;

  // Auto-select first tone and render grid immediately
  toneSelect.value = tones[0];
  renderGrid(palette.filter((s) => s.palette === selected && s.tone === tones[0]));
}

function onToneChange(e) {
  const paletteVal = document.getElementById('shade-palette-select').value;
  const toneVal = e.target.value;

  if (!paletteVal || !toneVal) {
    document.getElementById('shade-grid').innerHTML = '';
    return;
  }

  const filtered = palette.filter(
    (s) => s.palette === paletteVal && s.tone === toneVal
  );
  renderGrid(filtered);
}

// ── grid ───────────────────────────────────────────────────────
function renderGrid(shades) {
  const grid = document.getElementById('shade-grid');
  grid.innerHTML = '';

  shades.forEach((shade) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'shade-chip';
    chip.setAttribute('role', 'option');
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
    chip.addEventListener('click', () => selectShade(shade));
    grid.appendChild(chip);
  });
}

// ── selection ──────────────────────────────────────────────────
function selectShade(shade) {
  document.querySelectorAll('.shade-chip').forEach((c) =>
    c.classList.remove('shade-chip--active')
  );

  const activeChip = document.querySelector(
    `.shade-chip[data-code="${CSS.escape(shade.code)}"]`
  );
  if (activeChip) activeChip.classList.add('shade-chip--active');

  document.getElementById('shade-footer').innerHTML = `
    <div class="shade-swatch-circle" style="background:${shade.hex}"></div>
    <span class="shade-selected-code">${shade.code} &mdash; ${shade.hex}</span>
  `;

  window.__paintState = { shade };

  setTimeout(() => closeModal({ clearState: false }), 300);
}

// ── boot ───────────────────────────────────────────────────────
// Module scripts are deferred — DOM is already parsed here, no event needed.
buildModal();
const btn = document.getElementById('open-shade-modal');
if (btn) btn.addEventListener('click', openModal);
