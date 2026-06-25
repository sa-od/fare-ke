import { useEffect, useRef, useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
} from "react-router";
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
  base: "base",
  white: "base",
  bianco: "base",
  "1": "base",
  light: "light",
  chiaro: "light",
  "2": "light",
  medium: "medium",
  medio: "medium",
  "3": "medium",
  dark: "dark",
  scuro: "dark",
  "4": "dark",
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
    h = `#${h
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("")}`;
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
    colIndex[field] = headers.findIndex((h) =>
      HEADER_ALIASES[field].includes(h),
    );
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

type OptionInfo = { name: string; values: string[] };
type VariantInfo = {
  id: string;
  price: string;
  options: Record<string, string>;
};
type VariantConfig = {
  tierOption: string;
  sizeOption: string | null;
  tierValues: { base: string; light: string; medium: string; dark: string };
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query ProductPalette($id: ID!) {
        product(id: $id) {
          id
          title
          options { name optionValues { name } }
          variants(first: 100) {
            nodes { id price selectedOptions { name value } }
          }
          palette: metafield(namespace: "$app", key: "palette") { jsonValue }
          config: metafield(namespace: "$app", key: "variant_config") { jsonValue }
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
  const options: OptionInfo[] = (product?.options ?? []).map(
    (o: { name: string; optionValues?: Array<{ name: string }> }) => ({
      name: o.name,
      values: (o.optionValues ?? []).map((v) => v.name),
    }),
  );
  const variants: VariantInfo[] = (product?.variants?.nodes ?? []).map(
    (v: {
      id: string;
      price: string;
      selectedOptions?: Array<{ name: string; value: string }>;
    }) => ({
      id: v.id,
      price: v.price,
      options: Object.fromEntries(
        (v.selectedOptions ?? []).map((o) => [o.name, o.value]),
      ),
    }),
  );
  const cfg = product?.config?.jsonValue;
  const config: VariantConfig | null =
    cfg && typeof cfg === "object" && cfg.tierOption
      ? (cfg as VariantConfig)
      : null;

  return {
    title: product?.title ?? "Product",
    palette,
    options,
    variants,
    config,
  };
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
      return {
        error: `A colour with the code "${shade.code}" already exists.`,
      };
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

  // ── Map existing variants to tiers ────────────────────────────────────────
  if (intent === "map") {
    const tierOption = ((form.get("tierOption") as string) || "").trim();
    const sizeOptionRaw = ((form.get("sizeOption") as string) || "").trim();
    const config = {
      tierOption,
      sizeOption: sizeOptionRaw || null,
      tierValues: {
        base: ((form.get("base") as string) || "").trim(),
        light: ((form.get("light") as string) || "").trim(),
        medium: ((form.get("medium") as string) || "").trim(),
        dark: ((form.get("dark") as string) || "").trim(),
      },
    };
    if (!config.tierOption || !config.tierValues.base) {
      return { error: "Pick the tier option and at least the Base value." };
    }
    const response = await admin.graphql(
      `#graphql
        mutation SaveConfig($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { userErrors { field message } }
        }
      `,
      {
        variables: {
          metafields: [
            {
              ownerId,
              namespace: "$app",
              key: "variant_config",
              type: "json",
              value: JSON.stringify(config),
            },
          ],
        },
      },
    );
    const body = await response.json();
    const errs = body?.data?.metafieldsSet?.userErrors ?? [];
    if (errs.length > 0)
      return {
        error: errs.map((e: { message: string }) => e.message).join(" "),
      };
    return { ok: true };
  }

  // ── Update tier variant prices ────────────────────────────────────────────
  if (intent === "prices") {
    let updates: Array<{ id: string; price: string }>;
    try {
      updates = JSON.parse((form.get("prices") as string) || "[]");
    } catch {
      return { error: "Couldn't read the prices." };
    }
    updates = updates.filter(
      (u) => u.id && u.price !== "" && !Number.isNaN(Number(u.price)),
    );
    if (updates.length === 0) return { error: "No valid prices to save." };

    const response = await admin.graphql(
      `#graphql
        mutation UpdateTierPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          productId: ownerId,
          variants: updates.map((u) => ({ id: u.id, price: String(u.price) })),
        },
      },
    );
    const body = await response.json();
    const errs = body?.data?.productVariantsBulkUpdate?.userErrors ?? [];
    if (errs.length > 0)
      return {
        error: errs.map((e: { message: string }) => e.message).join(" "),
      };
    return { ok: true, count: updates.length };
  }

  // ── Create tier variants (product has none) ───────────────────────────────
  if (intent === "create") {
    const sizeOption =
      ((form.get("sizeOption") as string) || "").trim() || null;
    const MULT: Record<string, number> = { light: 1.1, medium: 1.2, dark: 1.4 };
    const round2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

    // Read current options + variants (+ inventory to mirror).
    const setupRes = await admin.graphql(
      `#graphql
        query ProductSetup($id: ID!) {
          product(id: $id) {
            options { name }
            variants(first: 100) {
              nodes { id price selectedOptions { name value } inventoryPolicy inventoryItem { tracked } }
            }
          }
        }
      `,
      { variables: { id: ownerId } },
    );
    const product = (await setupRes.json())?.data?.product;
    const optionNames: string[] = (product?.options ?? []).map(
      (o: { name: string }) => o.name,
    );
    if (optionNames.includes("Tier")) {
      return {
        error: "This product already has a Tier option — use Map instead.",
      };
    }
    if (optionNames.length >= 3) {
      return {
        error:
          "This product already uses 3 options, so a Tier option can't be added. Remove one option first.",
      };
    }

    // 1. Add the Tier option; existing variants become "Base" (LEAVE_AS_IS).
    const addRes = await admin.graphql(
      `#graphql
        mutation AddTierOption($productId: ID!, $options: [OptionCreateInput!]!) {
          productOptionsCreate(productId: $productId, options: $options, variantStrategy: LEAVE_AS_IS) {
            userErrors { field message }
          }
        }
      `,
      {
        variables: {
          productId: ownerId,
          options: [
            {
              name: "Tier",
              values: [
                { name: "Base" },
                { name: "Light" },
                { name: "Medium" },
                { name: "Dark" },
              ],
            },
          ],
        },
      },
    );
    const addErr =
      (await addRes.json())?.data?.productOptionsCreate?.userErrors ?? [];
    if (addErr.length > 0)
      return {
        error: addErr.map((e: { message: string }) => e.message).join(" "),
      };

    // 2. Re-read the now-Base variants for ids, size, price, inventory to mirror.
    const baseRes = await admin.graphql(
      `#graphql
        query BaseVariants($id: ID!) {
          product(id: $id) {
            variants(first: 100) {
              nodes { id price selectedOptions { name value } inventoryPolicy inventoryItem { tracked } }
            }
          }
        }
      `,
      { variables: { id: ownerId } },
    );
    const baseVariants =
      (await baseRes.json())?.data?.product?.variants?.nodes ?? [];
    const optVal = (
      v: { selectedOptions: Array<{ name: string; value: string }> },
      name: string,
    ) => v.selectedOptions.find((o) => o.name === name)?.value;
    const tracked = baseVariants[0]?.inventoryItem?.tracked ?? false;
    const policy = baseVariants[0]?.inventoryPolicy ?? "DENY";

    // 3. Create Light/Medium/Dark per base variant, priced +10/+20/+40%, inventory mirrored.
    const TIER_LABEL: Record<string, string> = {
      light: "Light",
      medium: "Medium",
      dark: "Dark",
    };
    const newVariants: Array<Record<string, unknown>> = [];
    for (const bv of baseVariants) {
      const size = sizeOption ? optVal(bv, sizeOption) : null;
      for (const tier of ["light", "medium", "dark"]) {
        const optionValues: Array<{ optionName: string; name: string }> = [];
        if (sizeOption && size)
          optionValues.push({ optionName: sizeOption, name: size });
        optionValues.push({ optionName: "Tier", name: TIER_LABEL[tier] });
        newVariants.push({
          optionValues,
          price: round2(Number(bv.price) * MULT[tier]),
          inventoryPolicy: policy,
          inventoryItem: { tracked },
        });
      }
    }
    if (newVariants.length > 0) {
      const createRes = await admin.graphql(
        `#graphql
          mutation CreateTierVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkCreate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }
        `,
        { variables: { productId: ownerId, variants: newVariants } },
      );
      const createErr =
        (await createRes.json())?.data?.productVariantsBulkCreate?.userErrors ??
        [];
      if (createErr.length > 0)
        return {
          error: createErr.map((e: { message: string }) => e.message).join(" "),
        };
    }

    // 4. Save the mapping so the grid + storefront pick it up.
    const cfgRes = await admin.graphql(
      `#graphql
        mutation SaveConfig($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { userErrors { field message } }
        }
      `,
      {
        variables: {
          metafields: [
            {
              ownerId,
              namespace: "$app",
              key: "variant_config",
              type: "json",
              value: JSON.stringify({
                tierOption: "Tier",
                sizeOption,
                tierValues: {
                  base: "Base",
                  light: "Light",
                  medium: "Medium",
                  dark: "Dark",
                },
              }),
            },
          ],
        },
      },
    );
    const cfgErr = (await cfgRes.json())?.data?.metafieldsSet?.userErrors ?? [];
    if (cfgErr.length > 0)
      return {
        error: cfgErr.map((e: { message: string }) => e.message).join(" "),
      };
    return { ok: true };
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
  const { title, palette, options, variants, config } =
    useLoaderData<typeof loader>();
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
        [s.code, s.palette, s.tone].some((v) =>
          (v || "").toLowerCase().includes(q),
        ),
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
        <s-banner tone="success" heading="Saved">
          Your changes have been saved.
        </s-banner>
      ) : null}

      <TierPricing options={options} variants={variants} config={config} />

      <s-stack direction="block" gap="base">
        <s-heading>Import from CSV</s-heading>
        <s-section accessibilityLabel="Import from CSV">
          <s-stack gap="base">
            <s-paragraph>
              Upload a CSV with the columns{" "}
              <s-text type="strong">code, hex, palette, tone, tier</s-text>.
              Comma and semicolon files are both accepted.
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
      </s-stack>

      <s-stack direction="block" gap="base">
        <s-heading>Current colours</s-heading>
        <s-section accessibilityLabel="Current colours" padding="none">
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
      </s-stack>

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

// ── TIER MAPPING + PRICING ──────────────────────────────────────────────────────

const TIER_KEYS = ["base", "light", "medium", "dark"] as const;
const TIER_LABELS: Record<string, string> = {
  base: "Base (White)",
  light: "Light",
  medium: "Medium",
  dark: "Dark",
};
const SUGGEST_MULT: Record<string, number> = {
  base: 1,
  light: 1.1,
  medium: 1.2,
  dark: 1.4,
};
const TIER_GUESS: Record<string, string[]> = {
  base: ["base", "white", "bianco"],
  light: ["light", "chiaro"],
  medium: ["medium", "medio"],
  dark: ["dark", "scuro"],
};

function guessValue(values: string[], tier: string): string {
  const keywords = TIER_GUESS[tier];
  return (
    values.find((v) => keywords.some((k) => v.toLowerCase().includes(k))) || ""
  );
}

function TierPricing({
  options,
  variants,
  config,
}: {
  options: OptionInfo[];
  variants: VariantInfo[];
  config: VariantConfig | null;
}) {
  const submit = useSubmit();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  const tierOptRef = useRef<any>(null);
  const sizeOptRef = useRef<any>(null);
  const baseRef = useRef<any>(null);
  const lightRef = useRef<any>(null);
  const mediumRef = useRef<any>(null);
  const darkRef = useRef<any>(null);
  const valueRefs: Record<string, any> = {
    base: baseRef,
    light: lightRef,
    medium: mediumRef,
    dark: darkRef,
  };
  const priceRefs = useRef<Record<string, any>>({});

  const createSizeRef = useRef<any>(null);
  const [editingMap, setEditingMap] = useState(false);
  const [setupMode, setSetupMode] = useState<"map" | "create" | null>(null);
  const [tierOptionName, setTierOptionName] = useState(
    config?.tierOption || options[0]?.name || "",
  );

  // Tier-option select change → repopulate the value selects.
  useEffect(() => {
    const el = tierOptRef.current;
    if (!el) return;
    const onChange = (e: Event) =>
      setTierOptionName((e.currentTarget as { value?: string }).value || "");
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [editingMap, config]);

  const showMap = editingMap || !config;
  const tierOptionValues =
    options.find((o) => o.name === tierOptionName)?.values || [];

  function saveMapping() {
    submit(
      {
        intent: "map",
        tierOption: tierOptRef.current?.value || "",
        sizeOption: sizeOptRef.current?.value || "",
        base: baseRef.current?.value || "",
        light: lightRef.current?.value || "",
        medium: mediumRef.current?.value || "",
        dark: darkRef.current?.value || "",
      },
      { method: "post" },
    );
    setEditingMap(false);
  }

  function createTiers() {
    let sizeOption = "";
    if (options.length === 1) sizeOption = options[0].name;
    else if (options.length >= 2)
      sizeOption = createSizeRef.current?.value || options[0].name;
    submit({ intent: "create", sizeOption }, { method: "post" });
  }

  const mapForm = (
    <s-stack gap="base">
      <s-select label="Tier option" ref={tierOptRef} value={tierOptionName}>
        {options.map((o) => (
          <s-option key={o.name} value={o.name}>
            {o.name}
          </s-option>
        ))}
      </s-select>
      <s-select
        label="Size option (optional)"
        ref={sizeOptRef}
        value={config?.sizeOption || ""}
      >
        <s-option value="">None (single size)</s-option>
        {options.map((o) => (
          <s-option key={o.name} value={o.name}>
            {o.name}
          </s-option>
        ))}
      </s-select>
      {TIER_KEYS.map((tier) => (
        <s-select
          key={tier}
          label={`${TIER_LABELS[tier]} value`}
          ref={valueRefs[tier]}
          value={
            config?.tierValues?.[tier] || guessValue(tierOptionValues, tier)
          }
        >
          <s-option value="">—</s-option>
          {tierOptionValues.map((v) => (
            <s-option key={v} value={v}>
              {v}
            </s-option>
          ))}
        </s-select>
      ))}
      <s-stack direction="inline" gap="base">
        <s-button variant="primary" loading={busy} onClick={saveMapping}>
          Save mapping
        </s-button>
        {config ? (
          <s-button variant="tertiary" onClick={() => setEditingMap(false)}>
            Cancel
          </s-button>
        ) : null}
      </s-stack>
    </s-stack>
  );

  // Editing an existing mapping → show the map form directly.
  if (showMap && config) {
    return (
      <s-stack direction="block" gap="base">
        <s-heading>Pricing tiers</s-heading>
        <s-section accessibilityLabel="Pricing tiers">
          <s-stack gap="base">
            <s-paragraph>
              Match each tier to one of the tier option's values.
            </s-paragraph>
            {mapForm}
          </s-stack>
        </s-section>
      </s-stack>
    );
  }

  // Not set up yet → choose to map existing variants or create them.
  if (showMap) {
    return (
      <s-stack direction="block" gap="base">
        <s-heading>Pricing tiers</s-heading>
        <s-section accessibilityLabel="Pricing tiers">
          <s-stack gap="base">
            <s-paragraph>
              Set up the hidden price tiers for this product.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              {options.length > 0 ? (
                <s-button
                  variant={setupMode === "map" ? "primary" : "secondary"}
                  onClick={() => setSetupMode("map")}
                >
                  Map existing variants
                </s-button>
              ) : null}
              <s-button
                variant={setupMode === "create" ? "primary" : "secondary"}
                onClick={() => setSetupMode("create")}
              >
                Create tier variants
              </s-button>
            </s-stack>

            {setupMode === "map" && options.length > 0 ? mapForm : null}

            {setupMode === "create" ? (
              options.length >= 3 ? (
                <s-banner tone="warning" heading="Can't add a tier option">
                  This product already uses 3 options (Shopify's maximum).
                  Remove one option to add tiers, or map existing variants
                  instead.
                </s-banner>
              ) : (
                <s-stack gap="base">
                  <s-paragraph>
                    We'll add a <s-text type="strong">Tier</s-text> option (Base
                    / Light / Medium / Dark) and create variants priced +10% /
                    +20% / +40% over the base price. You can adjust prices
                    afterwards.
                  </s-paragraph>
                  {options.length >= 2 ? (
                    <s-select
                      label="Which option is the size?"
                      ref={createSizeRef}
                      value={options[0].name}
                    >
                      {options.map((o) => (
                        <s-option key={o.name} value={o.name}>
                          {o.name}
                        </s-option>
                      ))}
                    </s-select>
                  ) : options.length === 1 ? (
                    <s-paragraph>
                      Size option:{" "}
                      <s-text type="strong">{options[0].name}</s-text>
                    </s-paragraph>
                  ) : (
                    <s-paragraph>
                      This product has no size option — 4 tier variants will be
                      created.
                    </s-paragraph>
                  )}
                  <s-button
                    variant="primary"
                    loading={busy}
                    onClick={createTiers}
                  >
                    Create tier variants
                  </s-button>
                </s-stack>
              )
            ) : null}
          </s-stack>
        </s-section>
      </s-stack>
    );
  }

  // Mapped → price grid.
  const cfg = config as VariantConfig;
  const sizes: Array<string | null> = cfg.sizeOption
    ? [
        ...new Set(
          variants
            .map((v) => v.options[cfg.sizeOption as string])
            .filter(Boolean),
        ),
      ]
    : [null];

  const findVariant = (size: string | null, tier: string) =>
    variants.find(
      (v) =>
        v.options[cfg.tierOption] ===
          cfg.tierValues[tier as keyof VariantConfig["tierValues"]] &&
        (!cfg.sizeOption || v.options[cfg.sizeOption] === size),
    );

  const round2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  const basePriceFor = (size: string | null) => {
    const b = findVariant(size, "base");
    return b ? Number(b.price) : 0;
  };

  function savePrices() {
    const updates: Array<{ id: string; price: string }> = [];
    for (const [id, el] of Object.entries(priceRefs.current)) {
      if (el && el.value != null && el.value !== "") {
        updates.push({ id, price: String(el.value) });
      }
    }
    submit(
      { intent: "prices", prices: JSON.stringify(updates) },
      { method: "post" },
    );
  }

  function resetSuggested() {
    for (const size of sizes) {
      const base = basePriceFor(size);
      for (const tier of TIER_KEYS) {
        const v = findVariant(size, tier);
        if (!v) continue;
        const el = priceRefs.current[v.id];
        if (el) el.value = round2(base * SUGGEST_MULT[tier]);
      }
    }
  }

  return (
    <s-stack direction="block" gap="base">
      <s-heading>Pricing tiers</s-heading>
      <s-section accessibilityLabel="Pricing tiers">
        <s-stack gap="base">
          <s-paragraph>
            Tier option <s-text type="strong">{cfg.tierOption}</s-text>
            {cfg.sizeOption ? (
              <>
                {" · Size "}
                <s-text type="strong">{cfg.sizeOption}</s-text>
              </>
            ) : null}
            {". Suggested prices are +10% / +20% / +40% over Base."}
          </s-paragraph>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">
                {cfg.sizeOption || "Variant"}
              </s-table-header>
              <s-table-header>Base</s-table-header>
              <s-table-header>Light</s-table-header>
              <s-table-header>Medium</s-table-header>
              <s-table-header>Dark</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {sizes.map((size) => {
                const base = basePriceFor(size);
                return (
                  <s-table-row key={size || "single"}>
                    <s-table-cell>{size || "—"}</s-table-cell>
                    {TIER_KEYS.map((tier) => {
                      const v = findVariant(size, tier);
                      if (!v) {
                        return <s-table-cell key={tier}>—</s-table-cell>;
                      }
                      const initial =
                        tier === "base"
                          ? round2(base)
                          : round2(base * SUGGEST_MULT[tier]);
                      return (
                        <s-table-cell key={tier}>
                          <s-money-field
                            label={TIER_LABELS[tier]}
                            labelAccessibilityVisibility="exclusive"
                            ref={(el: any) => {
                              priceRefs.current[v.id] = el;
                            }}
                            value={initial}
                          ></s-money-field>
                        </s-table-cell>
                      );
                    })}
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" loading={busy} onClick={savePrices}>
              Save prices
            </s-button>
            <s-button variant="tertiary" onClick={resetSuggested}>
              Reset to suggested
            </s-button>
            <s-button variant="tertiary" onClick={() => setEditingMap(true)}>
              Edit mapping
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
