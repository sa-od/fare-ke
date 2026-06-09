import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

// ── Inline SVG icons (Polaris Icons v9, confirmed paths) ──────────────────

const PaintBrushIcon = (size = 24) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width={size} height={size} fill="currentColor">
    <path fillRule="evenodd" d="M11.677 4.737a.25.25 0 0 0-.354 0L8.487 7.573a.25.25 0 0 0 0 .354l3.586 3.585a.25.25 0 0 0 .353.001l2.837-2.836a.25.25 0 0 0 0-.354l-1.763-1.762-.47.47a.75.75 0 0 1-1.06-1.061l.47-.47-.763-.763Zm-1.414-1.06-4.586 4.585a1.75 1.75 0 0 0 0 2.475l.262.263-1.97 1.97a2.164 2.164 0 0 0 3.061 3.06l1.97-1.97.263.263a1.75 1.75 0 0 0 2.474 0l4.586-4.586a1.75 1.75 0 0 0 0-2.475L10.737 3.677a1.75 1.75 0 0 0-2.474 0Zm-3.526 5.646.526-.525c.049.066.104.13.164.19l3.586 3.585c.06.06.123.115.189.164l-.525.525a.25.25 0 0 1-.354 0L6.737 9.677a.25.25 0 0 1 0-.354Zm.263 2.737-1.97 1.97a.664.664 0 1 0 .94.94l1.97-1.97-.94-.94Z" />
  </svg>
);

const ThemeIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width={20} height={20} fill="currentColor">
    <path fillRule="evenodd" d="M7.25 3.5a3.75 3.75 0 0 0-3.75 3.75v5.5a3.75 3.75 0 0 0 3.75 3.75h5.5a3.75 3.75 0 0 0 3.75-3.75v-5.5a3.75 3.75 0 0 0-3.75-3.75h-5.5Zm-2.25 3.75a2.25 2.25 0 0 1 2.25-2.25h3.25v3h-5.5v-.75Zm7-2.25h.75a2.25 2.25 0 0 1 2.25 2.25v3.75h-3v-6Zm0 7.5v2.5h.75a2.25 2.25 0 0 0 2.25-2.25v-.25h-3Zm-1.5-3v5.5h-3.25a2.25 2.25 0 0 1-2.25-2.25v-3.25h5.5Z" />
  </svg>
);

const ThemeEditIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width={20} height={20} fill="currentColor">
    <path fillRule="evenodd" d="M7.25 3.5a3.75 3.75 0 0 0-3.75 3.75v5.5a3.75 3.75 0 0 0 3.75 3.75h1a.75.75 0 0 0 0-1.5h-1a2.25 2.25 0 0 1-2.25-2.25v-3.25h5.5v2.75a.75.75 0 0 0 1.5 0v-7.25h.75a2.25 2.25 0 0 1 2.25 2.25v1a.75.75 0 0 0 1.5 0v-1a3.75 3.75 0 0 0-3.75-3.75h-5.5Zm3.25 1.5v3h-5.5v-.75a2.25 2.25 0 0 1 2.25-2.25h3.25Z" />
    <path d="M17.03 12.371a.5.5 0 0 0 0-.707l-1.06-1.06a.5.5 0 0 0-.708 0l-.957.957 1.768 1.767.957-.957Z" />
    <path d="m15.366 14.035-1.768-1.767-2.45 2.449a2 2 0 0 0-.585 1.407l-.002.698a.25.25 0 0 0 .25.25l.698-.002a2 2 0 0 0 1.408-.586l2.449-2.449Z" />
  </svg>
);

const ThemeTemplateIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width={20} height={20} fill="currentColor">
    <path fillRule="evenodd" d="M3.5 7.25a3.75 3.75 0 0 1 3.75-3.75h5.5a3.75 3.75 0 0 1 3.75 3.75v5.5a3.75 3.75 0 0 1-3.75 3.75h-5.5a3.75 3.75 0 0 1-3.75-3.75v-5.5Zm3.75-2.25a2.25 2.25 0 0 0-2.25 2.25v.5h10v-.5a2.25 2.25 0 0 0-2.25-2.25h-5.5Zm3.75 4.25h-6v3.5a2.25 2.25 0 0 0 2.25 2.25h3.75v-5.75Zm1.5 5.75v-5.75h2.5v3.5a2.25 2.25 0 0 1-2.25 2.25h-.25Z" />
  </svg>
);

const LayoutBlockIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width={20} height={20} fill="currentColor">
    <path d="M5 6.25c0-.69.56-1.25 1.25-1.25h2a.75.75 0 0 0 0-1.5h-2A2.75 2.75 0 0 0 3.5 6.25v2a.75.75 0 0 0 1.5 0v-2Z" />
    <path d="M13.75 5c.69 0 1.25.56 1.25 1.25v2a.75.75 0 0 0 1.5 0v-2A2.75 2.75 0 0 0 13.75 3.5h-2a.75.75 0 0 0 0 1.5h2Z" />
    <path d="M13.75 15c.69 0 1.25-.56 1.25-1.25v-2a.75.75 0 0 1 1.5 0v2a2.75 2.75 0 0 1-2.75 2.75h-2a.75.75 0 0 1 0-1.5h2Z" />
    <path d="M6.25 15c-.69 0-1.25-.56-1.25-1.25v-2a.75.75 0 0 0-1.5 0v2a2.75 2.75 0 0 0 2.75 2.75h2a.75.75 0 0 0 0-1.5h-2Z" />
  </svg>
);

// ── Step data ──────────────────────────────────────────────────────────────

const STEPS = [
  {
    icon: ThemeIcon,
    label: (
      <>
        Go to <strong>Online Store</strong> → <strong>Themes</strong>
      </>
    ),
  },
  {
    icon: ThemeEditIcon,
    label: (
      <>
        Click <strong>Customize</strong> on your active theme
      </>
    ),
  },
  {
    icon: ThemeTemplateIcon,
    label: (
      <>
        Open a <strong>product template</strong> from the dropdown
      </>
    ),
  },
  {
    icon: LayoutBlockIcon,
    label: (
      <>
        Click <strong>Add block</strong> and select{" "}
        <strong>Paint Color Picker</strong>
      </>
    ),
  },
];

// ── Styles ─────────────────────────────────────────────────────────────────

const heroBox: React.CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: 14,
  background: "linear-gradient(135deg, #e3f1ec 0%, #d5eee2 100%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  color: "#008060",
};

const stepsCard: React.CSSProperties = {
  border: "1px solid #e1e3e5",
  borderRadius: 12,
  overflow: "hidden",
};

const stepRow = (last: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "14px 16px",
  background: "#ffffff",
  borderBottom: last ? "none" : "1px solid #f1f2f3",
});

const stepIconBox: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  background: "#f1f8f5",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  color: "#008060",
};

const stepText: React.CSSProperties = {
  fontSize: 14,
  color: "#202223",
  lineHeight: "20px",
};

// ── Page ───────────────────────────────────────────────────────────────────

export default function Index() {
  const { shop } = useLoaderData<typeof loader>();
  const themeEditorUrl = `https://${shop}/admin/themes/current/editor?template=product`;

  return (
    <s-page heading="Paint Color Picker is ready">
      <s-section>
        <s-stack direction="block" gap="base">

          {/* ── Hero row ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={heroBox}>{PaintBrushIcon(24)}</div>
            <s-text tone="subdued">
              Add the block to your product pages in the theme editor to
              activate the color picker.
            </s-text>
          </div>

          {/* ── Steps ── */}
          <div style={stepsCard}>
            {STEPS.map((step, i) => (
              <div key={i} style={stepRow(i === STEPS.length - 1)}>
                <div style={stepIconBox}>{step.icon}</div>
                <span style={stepText}>{step.label}</span>
              </div>
            ))}
          </div>

          {/* ── CTA ── */}
          <div>
            <s-button
              variant="primary"
              onClick={() =>
                window.open(themeEditorUrl, "_blank", "noopener,noreferrer")
              }
            >
              Open Theme Editor
            </s-button>
          </div>

        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
