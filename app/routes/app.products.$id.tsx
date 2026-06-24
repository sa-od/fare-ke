import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const VALID_TIERS = ["base", "white", "light", "medium", "dark"];
const gidFor = (id: string) => `gid://shopify/Product/${id}`;

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
  const palette = Array.isArray(product?.palette?.jsonValue)
    ? product.palette.jsonValue
    : [];

  return {
    title: product?.title ?? "Product",
    paletteText: JSON.stringify(palette, null, 2),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const raw = (form.get("palette") as string) || "";

  let shades: Array<Record<string, string>>;
  try {
    shades = JSON.parse(raw);
    if (!Array.isArray(shades)) throw new Error("Colours must be a JSON array.");
  } catch (error) {
    return { error: `Invalid JSON — ${(error as Error).message}` };
  }

  for (let i = 0; i < shades.length; i++) {
    const shade = shades[i] || {};
    const hexOk = /^#[0-9a-fA-F]{6}$/.test(shade.hex || "");
    const tierOk = VALID_TIERS.includes((shade.tier || "").toLowerCase());
    if (!shade.code || !hexOk || !tierOk || !shade.palette || !shade.tone) {
      return {
        error: `Row ${i + 1} is invalid. Each colour needs code, hex (#RRGGBB), palette, tone, and tier (base, light, medium, or dark).`,
      };
    }
  }

  const ownerId = gidFor(params.id as string);
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
  if (userErrors.length > 0) {
    return { error: userErrors.map((e: { message: string }) => e.message).join(" ") };
  }

  return { ok: true, count: shades.length };
};

export default function ProductColours() {
  const { title, paletteText } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

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

      <s-section heading="Colours">
        <Form method="post">
          <s-stack gap="base">
            <s-paragraph>
              Paste this product's colours as a JSON array. Each colour needs{" "}
              <s-text type="strong">code</s-text>,{" "}
              <s-text type="strong">hex</s-text> (#RRGGBB),{" "}
              <s-text type="strong">palette</s-text>,{" "}
              <s-text type="strong">tone</s-text>, and{" "}
              <s-text type="strong">tier</s-text> (base, light, medium, or dark).
            </s-paragraph>
            <s-text-area
              label="Colours (JSON)"
              name="palette"
              rows={16}
              value={paletteText}
            ></s-text-area>
            <s-stack direction="inline" gap="base">
              <s-button type="submit" variant="primary" loading={saving}>
                Save colours
              </s-button>
            </s-stack>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
