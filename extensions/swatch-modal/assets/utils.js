export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Maps NCS palette tier names to Shopify variant option values.
export const tierMapping = {
  light:  "Light",
  medium: "Medium",
  dark:   "Dark",
  base:   "Base",
};
