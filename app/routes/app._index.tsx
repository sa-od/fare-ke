import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "react-router";
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
  const { admin } = await authenticate.admin(request);

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

  return { products };
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
  const { products } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const numericId = (gid: string) => gid.split("/").pop();

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
          <s-section>
            <s-paragraph>
              Click <s-text type="strong">Edit colours</s-text> on a product to
              add or update the colours shown in its picker.
            </s-paragraph>
          </s-section>
          <s-section heading="Products with the picker" padding="none">
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
                      <s-stack direction="inline" gap="small">
                        <s-button
                          variant="secondary"
                          onClick={() =>
                            navigate(`/app/products/${numericId(product.id)}`)
                          }
                        >
                          Edit colours
                        </s-button>
                        <s-button
                          variant="tertiary"
                          onClick={() => removeProduct(product.id)}
                        >
                          Remove
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
