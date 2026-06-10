import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  PaintBrushFlatIcon,
  ThemeIcon,
  ThemeEditIcon,
  ThemeTemplateIcon,
  LayoutBlockIcon,
} from "@shopify/polaris-icons";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

const STEPS = [
  {
    Icon: ThemeIcon,
    label: (
      <>
        Go to <strong>Online Store</strong> → <strong>Themes</strong>
      </>
    ),
  },
  {
    Icon: ThemeEditIcon,
    label: (
      <>
        Click <strong>Customize</strong> on your active theme
      </>
    ),
  },
  {
    Icon: ThemeTemplateIcon,
    label: (
      <>
        Open a <strong>product template</strong> from the dropdown
      </>
    ),
  },
  {
    Icon: LayoutBlockIcon,
    label: (
      <>
        Click <strong>Add block</strong> and select{" "}
        <strong>Paint Color Picker</strong>
      </>
    ),
  },
];

export default function Index() {
  const { shop } = useLoaderData<typeof loader>();
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?template=product`;

  return (
    <s-page heading="Paint Color Picker is ready">
      <s-section>
        <s-stack direction="block" gap="base">

          {/* Hero row */}
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-box background="subdued" padding="base" borderRadius="large">
              <PaintBrushFlatIcon width={24} height={24} />
            </s-box>
            <s-text>
              Add the block to your product pages in the theme editor to
              activate the color picker.
            </s-text>
          </s-stack>

          {/* Steps card */}
          <s-box
            borderWidth="small"
            borderStyle="solid"
            borderColor="base"
            borderRadius="large"
            overflow="hidden"
          >
            {STEPS.flatMap(({ Icon, label }, i) => [
              <s-stack
                key={`step-${i}`}
                direction="inline"
                gap="base"
                alignItems="center"
                padding="base"
              >
                <s-box background="subdued" padding="small" borderRadius="base">
                  <Icon width={20} height={20} />
                </s-box>
                <s-text>{label}</s-text>
              </s-stack>,
              ...(i < STEPS.length - 1 ? [<s-divider key={`div-${i}`} />] : []),
            ])}
          </s-box>

          {/* CTA */}
          <s-button
            variant="primary"
            onClick={() =>
              window.open(themeEditorUrl, "_blank", "noopener,noreferrer")
            }
          >
            Open Theme Editor
          </s-button>

        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
