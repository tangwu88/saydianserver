export type CatalogImageWidth = 160 | 480 | 960 | 1440;

/** No arbitrary image proxy, signed URL rewrite, avatar or private-file request. */
export function catalogImageSource(source: string, width: CatalogImageWidth): string {
  const match = /^(https:\/\/app\.saydian\.cn)?((?:\/global)?\/api\/saydian-app\/v2\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(source);
  return match ? `${match[1] || ""}${match[2]}/image?width=${width}` : source;
}

export function catalogImageSet(source: string): string | undefined {
  if (catalogImageSource(source, 480) === source) return undefined;
  return ([480, 960, 1440] as const).map(width => `${catalogImageSource(source, width)} ${width}w`).join(", ");
}
