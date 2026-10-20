import { catalogImageSource } from "./catalog-image";

const imageTag = /<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
const attribute = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
const placeholder = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
type DeferredImage = { marker: string; source: string; original: string; alt: string };

/** Still rendered through Uni's rich-text allowlist, never v-html/innerHTML. */
export function prepareProductDescription(value: unknown): { html: string; images: DeferredImage[] } {
  const images: DeferredImage[] = [];
  if (typeof value !== "string") return { html: "", images };
  const html = value.replace(imageTag, tag => {
    let source = "", alt = "商品详情图", width = 0, height = 0;
    for (const match of tag.slice(4, -1).matchAll(attribute)) {
      const name = match[1]?.toLowerCase();
      const raw = match[2] || "", text = /^["']/.test(raw) ? raw.slice(1, -1) : raw;
      if (name === "src") source = text.replace(/&amp;/gi, "&");
      else if (name === "alt") alt = text;
      else if (name === "width" && /^\d{1,5}$/.test(text)) width = Number(text);
      else if (name === "height" && /^\d{1,5}$/.test(text)) height = Number(text);
    }
    // The existing Uni rich-text allowlist still sanitizes all rendered markup.
    if (!source || /[\u0000-\u0020<>"']/.test(source)) return "";
    if (source.startsWith("//")) source = "https:" + source;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(source)?.[1]?.toLowerCase();
    if (scheme && !["https", "http"].includes(scheme) &&
      !(source.length <= 2 * 1024 * 1024 && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(source))) return "";
    const ratio = width > 0 && height > 0 ? `aspect-ratio:${width}/${height};` : "";
    const marker = `catalog-deferred-image-${images.length}`;
    images.push({ marker, source: catalogImageSource(source, 960), original: source, alt });
    return `<img src="${placeholder}" alt="${marker}" style="display:block;width:100%;max-width:100%;height:auto;min-height:320px;margin:0 auto;box-sizing:border-box;${ratio}">`;
  });
  return { html, images };
}

export function attachDeferredProductImages(root: HTMLElement, descriptors: DeferredImage[]): () => void {
  const sources = new Map(descriptors.map(value => [value.marker, value]));
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img")).filter(image => sources.has(image.alt));
  let disposed = false;
  const cleanup: Array<() => void> = [];
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) start(entry.target as HTMLImageElement);
  }, { rootMargin: "320px 0px" });
  function start(image: HTMLImageElement) {
    if (disposed || image.getAttribute("src")) return;
    observer?.unobserve(image);
    image.setAttribute("src", image.dataset.productSrc || image.dataset.productOriginal || "");
  }
  for (const image of images) {
    const source = sources.get(image.alt)!;
    image.dataset.productSrc = catalogImageSource(source.original, root.clientWidth > 960 ? 1440 : 960); image.dataset.productOriginal = source.original;
    image.removeAttribute("src"); image.alt = source.alt;
    image.loading = "lazy"; image.decoding = "async";
    image.style.minHeight = image.style.aspectRatio ? "" : "320px";
    image.style.backgroundColor = "#f5f6f8";
    const loaded = () => { if (!disposed && image.getAttribute("src") && image.complete && image.naturalWidth > 0) { image.alt = source.alt; image.style.minHeight = ""; image.style.backgroundColor = ""; image.removeAttribute("data-image-failed"); image.removeAttribute("role"); image.removeAttribute("tabindex"); } };
    const failed = () => {
      if (disposed || !image.getAttribute("src")) return;
      if (image.getAttribute("src") !== image.dataset.productOriginal) {
        image.removeAttribute("srcset"); image.setAttribute("src", image.dataset.productOriginal || "");
      } else {
        image.alt = "图片未加载，点击重试"; image.setAttribute("data-image-failed", "true");
        image.setAttribute("role", "button"); image.tabIndex = 0;
      }
    };
    const retry = () => {
      if (!disposed && image.hasAttribute("data-image-failed")) { image.removeAttribute("data-image-failed"); image.removeAttribute("src"); start(image); }
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { if (image.hasAttribute("data-image-failed")) event.preventDefault(); retry(); } };
    image.addEventListener("load", loaded); image.addEventListener("error", failed);
    image.addEventListener("click", retry); image.addEventListener("keydown", keydown);
    cleanup.push(() => { image.removeEventListener("load", loaded); image.removeEventListener("error", failed); image.removeEventListener("click", retry); image.removeEventListener("keydown", keydown); });
    if (observer) observer.observe(image); else start(image);
  }
  return () => { disposed = true; observer?.disconnect(); cleanup.forEach(remove => remove()); };
}
