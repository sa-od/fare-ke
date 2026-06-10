import prisma from "../db.server";

export function getShades(shop) {
  return prisma.shade.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });
}

export function createShade(shop, { code, hex, palette, tone, tier }) {
  return prisma.shade.create({ data: { shop, code, hex, palette, tone, tier } });
}

export function deleteShade(id) {
  return prisma.shade.delete({ where: { id } });
}

export function bulkCreateShades(shop, shades) {
  return prisma.shade.createMany({
    data: shades.map(({ code, hex, palette, tone, tier }) => ({
      shop, code, hex, palette, tone, tier,
    })),
    skipDuplicates: true,
  });
}
