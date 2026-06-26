import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
import { useState } from "react";
import { useLoaderData, useNavigate, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type PaintProduct = {
  id: string;
  title: string;
  colourCount: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(`#graphql
    query PaintProducts {
      products(first: 100, sortKey: TITLE) {
        nodes {
          id
          title
          enabled: metafield(namespace: "$app", key: "enabled") { value }
          palette: metafield(namespace: "$app", key: "palette") { jsonValue }
        }
      }
    }
  `);

  const body = await response.json();
  const products: PaintProduct[] = (body?.data?.products?.nodes ?? [])
    .filter((node: { enabled?: { value?: string } }) => node.enabled?.value === "true")
    .map((node: { id: string; title: string; palette?: { jsonValue?: unknown } }) => ({
      id: node.id,
      title: node.title,
      colourCount: Array.isArray(node.palette?.jsonValue)
        ? node.palette.jsonValue.length
        : 0,
    }));

  return { products, shop: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const ids = JSON.parse((form.get("ids") as string) || "[]") as string[];

  const metafields = ids.map((ownerId) => ({
    ownerId,
    namespace: "$app",
    key: "enabled",
    type: "boolean",
    value: intent === "enable" ? "true" : "false",
  }));

  if (metafields.length > 0) {
    await admin.graphql(
      `#graphql
        mutation SetEnabled($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }
      `,
      { variables: { metafields } },
    );
  }

  return { ok: true };
};

export default function Index() {
  const { products, shop } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [pendingRemove, setPendingRemove] = useState<PaintProduct | null>(null);

  const numericId = (gid: string) => gid.split("/").pop();
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?template=product`;

  function openThemeEditor() {
    window.open(themeEditorUrl, "_blank", "noopener,noreferrer");
  }

  async function addProducts() {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "add",
    });
    if (!selected || selected.length === 0) return;
    const ids = selected.map((product) => product.id);
    submit(
      { intent: "enable", ids: JSON.stringify(ids) },
      { method: "post" },
    );
  }

  function removeProduct(id: string) {
    submit(
      { intent: "disable", ids: JSON.stringify([id]) },
      { method: "post" },
    );
  }

  return (
    <s-page heading="Paint products">
      <s-button slot="primary-action" variant="primary" onClick={addProducts}>
        Add products
      </s-button>
      <s-button slot="secondary-actions" onClick={openThemeEditor}>
        Open theme editor
      </s-button>

      {products.length === 0 ? (
        <s-section accessibilityLabel="No products yet">
          <s-stack gap="base" alignItems="center">
            <s-heading>No products yet</s-heading>
            <s-paragraph>
              Add the products you want the paint colour picker to appear on,
              then give each one its colours.
            </s-paragraph>
            <s-button variant="primary" onClick={addProducts}>
              Add products
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <>
          <s-stack direction="block" gap="base">
            <s-heading>Products with the picker</s-heading>
            <s-section accessibilityLabel="Products with the picker" padding="none">
              <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header>Colours</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {products.map((product) => (
                  <s-table-row key={product.id}>
                    <s-table-cell>{product.title}</s-table-cell>
                    <s-table-cell>
                      {product.colourCount > 0 ? (
                        <s-badge tone="success">{`${product.colourCount} colours`}</s-badge>
                      ) : (
                        <s-badge tone="warning">No colours yet</s-badge>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <s-button
                        icon="menu-horizontal"
                        variant="tertiary"
                        accessibilityLabel="More actions"
                        commandFor={`actions-${numericId(product.id)}`}
                      ></s-button>
                      <s-menu
                        id={`actions-${numericId(product.id)}`}
                        accessibilityLabel="Product actions"
                      >
                        <s-button
                          icon="edit"
                          onClick={() =>
                            navigate(`/app/products/${numericId(product.id)}`)
                          }
                        >
                          Edit colours
                        </s-button>
                        <s-button
                          icon="delete"
                          tone="critical"
                          commandFor="remove-modal"
                          command="--show"
                          onClick={() => setPendingRemove(product)}
                        >
                          Remove
                        </s-button>
                      </s-menu>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            </s-section>
          </s-stack>

          <s-modal id="remove-modal" heading="Remove product?">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                This removes{" "}
                <s-text type="strong">{pendingRemove?.title}</s-text> from the
                colour picker. The product and its colours are kept — you can
                add it back anytime.
              </s-paragraph>
              <s-banner tone="warning">
                The colour picker will no longer appear on this product's page.
              </s-banner>
            </s-stack>
            <s-button
              slot="primary-action"
              variant="primary"
              tone="critical"
              commandFor="remove-modal"
              command="--hide"
              onClick={() => {
                if (pendingRemove) removeProduct(pendingRemove.id);
                setPendingRemove(null);
              }}
            >
              Remove
            </s-button>
            <s-button
              slot="secondary-actions"
              commandFor="remove-modal"
              command="--hide"
              onClick={() => setPendingRemove(null)}
            >
              Cancel
            </s-button>
          </s-modal>
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
