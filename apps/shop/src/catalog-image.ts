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

/** Cards start fetching only near the viewport; disposal also guards queued callbacks. */
export function observeCatalogImage(element: Element, activate: () => void): () => void {
  let disposed = false, started = false;
  if (typeof IntersectionObserver === "undefined") {
    activate();
    return () => { disposed = true; };
  }
  const observer = new IntersectionObserver(entries => {
    if (disposed || started || !entries.some(entry => entry.isIntersecting)) return;
    started = true;
    observer.disconnect();
    activate();
  }, { rootMargin: "160px 0px" });
  observer.observe(element);
  return () => { disposed = true; observer.disconnect(); };
}
