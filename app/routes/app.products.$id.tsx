import { useEffect, useRef, useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import { useLoaderData, useActionData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

type Shade = {
  code: string;
  hex: string;
  palette: string;
  tone: string;
  tier: string;
};

const VALID_TIERS = ["base", "white", "light", "medium", "dark"];
const gidFor = (id: string) => `gid://shopify/Product/${id}`;

// ── CSV PARSING (client-side, lenient) ─────────────────────────────────────────

const HEADER_ALIASES: Record<string, string[]> = {
  code: ["code", "colour", "color", "name"],
  hex: ["hex", "hexcode", "hex code", "colour code", "color code"],
  palette: ["palette", "catalog", "catalogue", "collection"],
  tone: ["tone", "shade", "group", "tonalita", "tonalità"],
  tier: ["tier", "level", "price tier", "pricetier"],
};

// Accepts English/Italian words and 1–4 so merchant exports map cleanly.
const TIER_ALIASES: Record<string, string> = {
  base: "base", white: "base", bianco: "base", "1": "base",
  light: "light", chiaro: "light", "2": "light",
  medium: "medium", medio: "medium", "3": "medium",
  dark: "dark", scuro: "dark", "4": "dark",
};

function detectDelimiter(headerLine: string): string {
  const ranked = [",", ";", "\t"]
    .map((d) => ({ d, n: headerLine.split(d).length }))
    .sort((a, b) => b.n - a.n);
  return ranked[0].n > 1 ? ranked[0].d : ",";
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeHex(raw: string): string | null {
  let h = (raw || "").trim().replace(/^["']|["']$/g, "");
  if (!h) return null;
  if (h[0] !== "#") h = `#${h}`;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = `#${h.slice(1).split("").map((c) => c + c).join("")}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : null;
}

function parseCsv(text: string): { rows: Shade[]; errors: string[] } {
  const rows: Shade[] = [];
  const errors: string[] = [];
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== "");

  if (lines.length < 2) {
    return { rows, errors: ["The file has a header but no colour rows."] };
  }

  const delim = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const colIndex: Record<string, number> = {};
  for (const field of Object.keys(HEADER_ALIASES)) {
    colIndex[field] = headers.findIndex((h) => HEADER_ALIASES[field].includes(h));
  }

  const missing = Object.keys(colIndex).filter((f) => colIndex[f] === -1);
  if (missing.length > 0) {
    return {
      rows,
      errors: [
        `Missing column(s): ${missing.join(", ")}. Expected headers: code, hex, palette, tone, tier.`,
      ],
    };
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const get = (f: string) => (cells[colIndex[f]] || "").trim();
    const code = get("code");
    const hex = normalizeHex(get("hex"));
    const palette = get("palette");
    const tone = get("tone");
    const tier = TIER_ALIASES[get("tier").toLowerCase()];

    if (!code || !hex || !palette || !tone || !tier) {
      const bad: string[] = [];
      if (!code) bad.push("code");
      if (!hex) bad.push("valid hex");
      if (!palette) bad.push("palette");
      if (!tone) bad.push("tone");
      if (!tier) bad.push("tier (base/light/medium/dark)");
      errors.push(`Row ${i + 1}: missing/invalid ${bad.join(", ")}.`);
      continue;
    }
    rows.push({ code, hex, palette, tone, tier });
  }

  return { rows, errors };
}

function validateShades(shades: unknown): shades is Shade[] {
  if (!Array.isArray(shades)) return false;
  return shades.every((s) => {
    const shade = (s || {}) as Record<string, string>;
    return (
      shade.code &&
      /^#[0-9a-fA-F]{6}$/.test(shade.hex || "") &&
      VALID_TIERS.includes((shade.tier || "").toLowerCase()) &&
      shade.palette &&
      shade.tone
    );
  });
}

function shadeFromForm(form: FormData): Shade {
  return {
    code: ((form.get("code") as string) || "").trim(),
    hex: ((form.get("hex") as string) || "").trim().toLowerCase(),
    palette: ((form.get("palette") as string) || "").trim(),
    tone: ((form.get("tone") as string) || "").trim(),
    tier: ((form.get("tier") as string) || "").trim().toLowerCase(),
  };
}

// ── DATA ───────────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query ProductPalette($id: ID!) {
        product(id: $id) {
          id
          title
          palette: metafield(namespace: "$app", key: "palette") { jsonValue }
        }
      }
    `,
    { variables: { id: gidFor(params.id as string) } },
  );

  const body = await response.json();
  const product = body?.data?.product;
  const palette: Shade[] = Array.isArray(product?.palette?.jsonValue)
    ? product.palette.jsonValue
    : [];

  return { title: product?.title ?? "Product", palette };
};

async function readExistingPalette(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  ownerId: string,
): Promise<Shade[]> {
  const response = await admin.graphql(
    `#graphql
      query ExistingPalette($id: ID!) {
        product(id: $id) {
          palette: metafield(namespace: "$app", key: "palette") { jsonValue }
        }
      }
    `,
    { variables: { id: ownerId } },
  );
  const body = await response.json();
  const value = body?.data?.product?.palette?.jsonValue;
  return Array.isArray(value) ? value : [];
}

async function writePalette(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  ownerId: string,
  shades: Shade[],
) {
  const response = await admin.graphql(
    `#graphql
      mutation SavePalette($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: "$app",
            key: "palette",
            type: "json",
            value: JSON.stringify(shades),
          },
          {
            ownerId,
            namespace: "$app",
            key: "enabled",
            type: "boolean",
            value: "true",
          },
        ],
      },
    },
  );
  const body = await response.json();
  const userErrors = body?.data?.metafieldsSet?.userErrors ?? [];
  return userErrors.map((e: { message: string }) => e.message).join(" ");
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = (form.get("intent") as string) || "import";
  const ownerId = gidFor(params.id as string);

  // ── Edit a single colour ──────────────────────────────────────────────────
  if (intent === "update") {
    const originalCode = (form.get("originalCode") as string) || "";
    const shade = shadeFromForm(form);

    if (!validateShades([shade])) {
      return { error: "That colour is missing or has an invalid field." };
    }

    const existing = await readExistingPalette(admin, ownerId);
    const idx = existing.findIndex((s) => s.code === originalCode);
    if (idx === -1) {
      return { error: "That colour no longer exists — reload and try again." };
    }
    if (
      shade.code !== originalCode &&
      existing.some((s, i) => i !== idx && s.code === shade.code)
    ) {
      return { error: `Another colour already uses the code "${shade.code}".` };
    }

    existing[idx] = shade;
    const err = await writePalette(admin, ownerId, existing);
    if (err) return { error: err };
    return { ok: true, count: existing.length };
  }

  // ── Add a single colour ───────────────────────────────────────────────────
  if (intent === "add") {
    const shade = shadeFromForm(form);
    if (!validateShades([shade])) {
      return { error: "The colour is missing or has an invalid field." };
    }
    const existing = await readExistingPalette(admin, ownerId);
    if (existing.some((s) => s.code === shade.code)) {
      return { error: `A colour with the code "${shade.code}" already exists.` };
    }
    existing.push(shade);
    const err = await writePalette(admin, ownerId, existing);
    if (err) return { error: err };
    return { ok: true, count: existing.length };
  }

  // ── Delete a single colour ────────────────────────────────────────────────
  if (intent === "delete") {
    const code = (form.get("code") as string) || "";
    const existing = await readExistingPalette(admin, ownerId);
    const next = existing.filter((s) => s.code !== code);
    const err = await writePalette(admin, ownerId, next);
    if (err) return { error: err };
    return { ok: true, count: next.length };
  }

  // ── Import (replace / append) ─────────────────────────────────────────────
  const mode = (form.get("mode") as string) === "append" ? "append" : "replace";

  let incoming: unknown;
  try {
    incoming = JSON.parse((form.get("shades") as string) || "[]");
  } catch {
    return { error: "Couldn't read the imported colours." };
  }
  if (!validateShades(incoming)) {
    return { error: "Some imported colours are invalid and weren't saved." };
  }

  let finalShades: Shade[] = incoming;
  if (mode === "append") {
    const existing = await readExistingPalette(admin, ownerId);
    const byCode = new Map<string, Shade>();
    for (const shade of existing) byCode.set(shade.code, shade);
    for (const shade of incoming) byCode.set(shade.code, shade); // new wins
    finalShades = [...byCode.values()];
  }

  const err = await writePalette(admin, ownerId, finalShades);
  if (err) return { error: err };
  return { ok: true, count: finalShades.length };
};

// ── UI ──────────────────────────────────────────────────────────────────────────

export default function ProductColours() {
  const { title, palette } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const saving = navigation.state === "submitting";

  const dropRef = useRef<any>(null);
  const modeRef = useRef<any>(null);
  const searchRef = useRef<any>(null);
  const codeRef = useRef<any>(null);
  const hexRef = useRef<any>(null);
  const paletteRef = useRef<any>(null);
  const toneRef = useRef<any>(null);
  const tierRef = useRef<any>(null);

  const [preview, setPreview] = useState<{
    rows: Shade[];
    errors: string[];
    fileName: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<
    (Shade & { originalCode: string; mode: "add" | "edit" }) | null
  >(null);
  const [deleting, setDeleting] = useState<Shade | null>(null);

  // Drop-zone "change" isn't a React synthetic event on custom elements.
  useEffect(() => {
    const dz = dropRef.current;
    if (!dz) return;
    const onChange = async (event: Event) => {
      const files = (event.currentTarget as { files?: File[] }).files || [];
      const file = files[0];
      if (!file) return;
      const text = await file.text();
      setPreview({ ...parseCsv(text), fileName: file.name });
      dz.value = "";
    };
    dz.addEventListener("change", onChange);
    return () => dz.removeEventListener("change", onChange);
  }, []);

  // Clear the preview once a save succeeds.
  useEffect(() => {
    if (actionData && "ok" in actionData && actionData.ok) setPreview(null);
  }, [actionData]);

  // Search field input → filter the current colours table. Re-runs when the
  // table appears (palette goes from empty to populated) so the listener attaches.
  useEffect(() => {
    const el = searchRef.current;
    if (!el) return;
    const onInput = (event: Event) =>
      setQuery((event.currentTarget as { value?: string }).value || "");
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
  }, [palette.length]);

  function saveImport() {
    if (!preview || preview.rows.length === 0) return;
    const mode = modeRef.current?.values?.[0] || "replace";
    submit(
      { intent: "import", shades: JSON.stringify(preview.rows), mode },
      { method: "post" },
    );
  }

  function openEdit(shade: Shade) {
    setEditing({ mode: "edit", originalCode: shade.code, ...shade });
  }

  function openAdd() {
    setEditing({
      mode: "add",
      originalCode: "",
      code: "",
      hex: "#000000",
      palette: "",
      tone: "",
      tier: "light",
    });
  }

  function saveEdit() {
    if (!editing) return;
    submit(
      {
        intent: editing.mode === "add" ? "add" : "update",
        originalCode: editing.originalCode,
        code: codeRef.current?.value ?? "",
        hex: hexRef.current?.value ?? "",
        palette: paletteRef.current?.value ?? "",
        tone: toneRef.current?.value ?? "",
        tier: tierRef.current?.value ?? "",
      },
      { method: "post" },
    );
  }

  function confirmDelete() {
    if (!deleting) return;
    submit({ intent: "delete", code: deleting.code }, { method: "post" });
  }

  const q = query.trim().toLowerCase();
  const visibleColours = q
    ? palette.filter((s) =>
        [s.code, s.palette, s.tone].some((v) => (v || "").toLowerCase().includes(q)),
      )
    : palette;

  return (
    <s-page heading={title}>
      <s-link slot="breadcrumb-actions" href="/app">
        Paint products
      </s-link>

      {actionData && "error" in actionData && actionData.error ? (
        <s-banner tone="critical" heading="Couldn't save colours">
          {actionData.error}
        </s-banner>
      ) : null}

      {actionData && "ok" in actionData && actionData.ok ? (
        <s-banner tone="success" heading="Colours saved">
          {`${actionData.count} colours are now live on this product.`}
        </s-banner>
      ) : null}

      <s-section heading="Import from CSV">
        <s-stack gap="base">
          <s-paragraph>
            Upload a CSV with the columns{" "}
            <s-text type="strong">code, hex, palette, tone, tier</s-text>. Comma
            and semicolon files are both accepted.
          </s-paragraph>

          <s-drop-zone
            ref={dropRef}
            label="Upload CSV"
            accept=".csv,text/csv"
          ></s-drop-zone>

          {preview ? (
            <s-stack gap="base">
              {preview.rows.length > 0 ? (
                <s-banner tone="success" heading={preview.fileName}>
                  {`${preview.rows.length} colours ready to import` +
                    (preview.errors.length > 0
                      ? `, ${preview.errors.length} row(s) skipped.`
                      : ".")}
                </s-banner>
              ) : (
                <s-banner tone="critical" heading={preview.fileName}>
                  No valid colours found in this file.
                </s-banner>
              )}

              {preview.errors.length > 0 ? (
                <s-banner tone="warning" heading="Some rows were skipped">
                  <s-unordered-list>
                    {preview.errors.slice(0, 8).map((message, i) => (
                      <s-list-item key={i}>{message}</s-list-item>
                    ))}
                  </s-unordered-list>
                </s-banner>
              ) : null}

              {preview.rows.length > 0 ? (
                <s-choice-list label="When importing" ref={modeRef}>
                  <s-choice value="replace" selected>
                    Replace all current colours
                  </s-choice>
                  <s-choice value="append">
                    Add to the current colours
                  </s-choice>
                </s-choice-list>
              ) : null}

              {preview.rows.length > 0 ? (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Code</s-table-header>
                    <s-table-header>Hex</s-table-header>
                    <s-table-header>Palette</s-table-header>
                    <s-table-header>Tone</s-table-header>
                    <s-table-header>Tier</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {preview.rows.slice(0, 100).map((shade, i) => (
                      <s-table-row key={`${shade.code}-${i}`}>
                        <s-table-cell>{shade.code}</s-table-cell>
                        <s-table-cell>{shade.hex}</s-table-cell>
                        <s-table-cell>{shade.palette}</s-table-cell>
                        <s-table-cell>{shade.tone}</s-table-cell>
                        <s-table-cell>{shade.tier}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              ) : null}

              <s-stack direction="inline" gap="base">
                <s-button
                  variant="primary"
                  loading={saving}
                  disabled={preview.rows.length === 0}
                  onClick={saveImport}
                >
                  Save import
                </s-button>
                <s-button variant="tertiary" onClick={() => setPreview(null)}>
                  Cancel
                </s-button>
              </s-stack>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Current colours" padding="none">
        <s-box padding="base">
          <s-stack gap="base">
            <s-button
              variant="secondary"
              icon="plus"
              commandFor="edit-colour-modal"
              command="--show"
              onClick={openAdd}
            >
              Add colour
            </s-button>
            {palette.length > 0 ? (
              <s-search-field
                ref={searchRef}
                label="Search colours"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search by code, palette or tone"
              ></s-search-field>
            ) : null}
          </s-stack>
        </s-box>

        {palette.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>
              No colours yet. Add one above, or upload a CSV.
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Code</s-table-header>
              <s-table-header>Hex</s-table-header>
              <s-table-header>Palette</s-table-header>
              <s-table-header>Tone</s-table-header>
              <s-table-header>Tier</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {visibleColours.slice(0, 200).map((shade, i) => (
                <s-table-row key={`${shade.code}-${i}`}>
                  <s-table-cell>{shade.code}</s-table-cell>
                  <s-table-cell>{shade.hex}</s-table-cell>
                  <s-table-cell>{shade.palette}</s-table-cell>
                  <s-table-cell>{shade.tone}</s-table-cell>
                  <s-table-cell>{shade.tier}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-button
                        icon="edit"
                        variant="tertiary"
                        accessibilityLabel={`Edit ${shade.code}`}
                        commandFor="edit-colour-modal"
                        command="--show"
                        onClick={() => openEdit(shade)}
                      ></s-button>
                      <s-button
                        icon="delete"
                        variant="tertiary"
                        tone="critical"
                        accessibilityLabel={`Remove ${shade.code}`}
                        commandFor="delete-colour-modal"
                        command="--show"
                        onClick={() => setDeleting(shade)}
                      ></s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-modal
        id="edit-colour-modal"
        heading={editing?.mode === "add" ? "Add colour" : "Edit colour"}
      >
        <s-stack gap="base">
          <s-text-field
            label="Code"
            ref={codeRef}
            value={editing?.code || ""}
          ></s-text-field>
          <s-color-field
            label="Hex"
            ref={hexRef}
            value={editing?.hex || ""}
          ></s-color-field>
          <s-text-field
            label="Palette"
            ref={paletteRef}
            value={editing?.palette || ""}
          ></s-text-field>
          <s-text-field
            label="Tone"
            ref={toneRef}
            value={editing?.tone || ""}
          ></s-text-field>
          <s-select label="Tier" ref={tierRef} value={editing?.tier || "light"}>
            <s-option value="base">Base</s-option>
            <s-option value="light">Light</s-option>
            <s-option value="medium">Medium</s-option>
            <s-option value="dark">Dark</s-option>
          </s-select>
        </s-stack>
        <s-button
          slot="secondary-actions"
          commandFor="edit-colour-modal"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          commandFor="edit-colour-modal"
          command="--hide"
          onClick={saveEdit}
        >
          {editing?.mode === "add" ? "Add colour" : "Save changes"}
        </s-button>
      </s-modal>

      <s-modal id="delete-colour-modal" heading="Remove colour?">
        <s-paragraph>
          {deleting
            ? `Remove "${deleting.code}" from this product? This can't be undone.`
            : ""}
        </s-paragraph>
        <s-button
          slot="secondary-actions"
          commandFor="delete-colour-modal"
          command="--hide"
        >
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          commandFor="delete-colour-modal"
          command="--hide"
          onClick={confirmDelete}
        >
          Remove
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
