import QRCode from "qrcode";
import type { ApiEnvelope } from "@saydian/app-contracts";
import {
  downloadPlatforms,
  type DownloadPlatform,
  type DownloadReleaseContract,
} from "@saydian/app-contracts/download";
import { productManifestFromApiData, manifestFromApiData } from "./manifest";
import { detectVisitorPlatform, formatPackageSize } from "./platform";
import "./styles.css";

const labels: Record<DownloadPlatform, string> = {
  android: "Android",
  ios: "iPhone",
  harmonyos: "HarmonyOS",
};
const path = window.location.pathname.replace(/\/$/, "");
const product =
  ["/down2", "/say-ring"].includes(path)
    ? "ring"
    : path === "/down/legacy" ? "legacy" : "health";
const visiblePlatforms: readonly DownloadPlatform[] = product === "ring"
  ? downloadPlatforms.filter(platform => platform !== "harmonyos")
  : downloadPlatforms;
const pages = {
  health: {
    name: "SAYDIAN Health",
    path: "/global/down",
    query: "?product=saydian-global",
  },
  legacy: { name: "原赛电 App", path: "/down/legacy", query: "" },
  ring: { name: "Say Ring App", path: "/down2", query: "?product=say-ring" },
} as const;
const currentPage = pages[product];

configurePage();

const visitorPlatform = detectVisitorPlatform(
  navigator.userAgent,
  navigator.platform,
  navigator.maxTouchPoints,
);

highlightVisitorPlatform();
void renderQrCode();
void loadManifest();

async function loadManifest(): Promise<void> {
  const status = requiredElement<HTMLElement>("#manifest-status");
  try {
    const response = await fetch(
      `/api/saydian-app/v2/support/app-update${currentPage.query}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) throw new Error("暂未发布可用版本");
    const envelope = (await response.json()) as ApiEnvelope<unknown>;
    const manifest =
      product === "legacy"
        ? manifestFromApiData(envelope.data)
        : productManifestFromApiData(envelope.data, product);
    for (const release of manifest.releases)
      if (visiblePlatforms.includes(release.platform)) renderRelease(release);
    status.textContent = `发布于 ${formatPublishedAt(manifest.publishedAt)}`;
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "下载信息暂时不可用";
    status.classList.add("is-error");
    for (const platform of visiblePlatforms) {
      const card = requiredElement<HTMLElement>(
        `[data-platform="${platform}"]`,
      );
      const badge = requiredChild<HTMLElement>(card, ".status-badge");
      badge.textContent = "暂不可用";
      badge.classList.add("status-badge--muted");
      const action = requiredChild<HTMLAnchorElement>(
        card,
        '[data-field="action"]',
      );
      disableAction(action, "暂不可用");
    }
  }
}

function renderRelease(release: DownloadReleaseContract): void {
  const card = requiredElement<HTMLElement>(
    `[data-platform="${release.platform}"]`,
  );
  requiredChild<HTMLElement>(card, '[data-field="version"]').textContent =
    `${release.versionName}（${release.buildNumber}）`;
  const badge = requiredChild<HTMLElement>(card, ".status-badge");
  const action = requiredChild<HTMLAnchorElement>(
    card,
    '[data-field="action"]',
  );
  if (release.status === "coming_soon" || !release.destination) {
    const awaitingReview = release.pendingReason === "review";
    badge.textContent = awaitingReview ? "等待审核" : "待开放";
    badge.classList.add("status-badge--pending");
    action.textContent =
      release.platform === "ios"
        ? awaitingReview
          ? "TestFlight 等待审核"
          : "TestFlight 待开放"
        : "暂未开放";
    if (release.platform === "ios")
      requiredElement<HTMLElement>("#ios-note").textContent = awaitingReview
        ? "外部测试等待审核，通过并核对后开放。"
        : "暂未开放安装。";
    disableAction(action, action.textContent ?? "暂未开放");
    return;
  }
  if (
    release.destination.kind === "market" &&
    ["baidu.com", "www.baidu.com"].includes(
      new URL(release.destination.url).hostname,
    )
  ) {
    badge.textContent = "安装地址待确认";
    badge.classList.add("status-badge--muted");
    disableAction(action, "暂不可用");
    return;
  }
  if (release.platform === "ios")
    requiredElement<HTMLElement>("#ios-note").textContent =
      release.destination.kind === "testflight"
        ? "通过 TestFlight 安装。"
        : "通过 App Store 安装。";
  if (
    product === "health" &&
    release.platform === "android" &&
    release.destination.kind === "direct" &&
    release.versionName === "1.0.0" &&
    release.buildNumber === 1012
  ) {
    requiredElement<HTMLElement>("#health-package-note").classList.remove(
      "is-hidden",
    );
    requiredElement<HTMLElement>("#health-signature-note").classList.remove(
      "is-hidden",
    );
  }
  badge.textContent = "可下载";
  badge.classList.add("status-badge--available");
  action.href = release.destination.url;
  action.textContent =
    release.platform === "ios"
      ? "前往安装"
      : `下载 ${labels[release.platform]} 版`;
  action.removeAttribute("aria-disabled");
  action.classList.remove("is-disabled");
  if (release.destination.kind === "direct")
    action.setAttribute("download", release.destination.fileName ?? "");
  const size = requiredChild<HTMLElement>(card, '[data-field="size"]');
  size.textContent =
    release.destination.kind === "direct"
      ? formatPackageSize(release.destination.sizeBytes)
      : labels[release.platform];
  if (release.destination.kind === "direct" && release.destination.sha256) {
    const hashBlock = requiredChild<HTMLElement>(
      card,
      '[data-field="hash-block"]',
    );
    const hash = requiredChild<HTMLElement>(card, '[data-field="hash"]');
    const copyButton = requiredChild<HTMLButtonElement>(
      card,
      '[data-field="copy-hash"]',
    );
    hash.textContent = release.destination.sha256;
    hashBlock.classList.remove("is-hidden");
    copyButton.addEventListener(
      "click",
      () => void copyHash(release.destination?.sha256 ?? "", copyButton),
    );
  }
}

function disableAction(action: HTMLAnchorElement, label: string): void {
  action.textContent = label;
  action.removeAttribute("href");
  action.setAttribute("aria-disabled", "true");
  action.classList.add("is-disabled");
}

function highlightVisitorPlatform(): void {
  const notice = requiredElement<HTMLElement>("#device-notice");
  if (visitorPlatform === "desktop") {
    notice.textContent = "电脑访问：请使用手机扫码。";
    return;
  }
  if (!visiblePlatforms.includes(visitorPlatform)) {
    notice.textContent = "本页仅提供 Android 和 iPhone 版本。";
    return;
  }
  notice.textContent = `已识别 ${labels[visitorPlatform]} 设备`;
  requiredElement<HTMLElement>(
    `[data-platform="${visitorPlatform}"]`,
  ).classList.add("is-recommended");
}

async function renderQrCode(): Promise<void> {
  const canvas = requiredElement<HTMLCanvasElement>("#page-qr");
  try {
    await QRCode.toCanvas(
      canvas,
      `${window.location.origin}${currentPage.path}`,
      {
        width: 184,
        margin: 1,
        color: { dark: "#17191f", light: "#ffffff" },
        errorCorrectionLevel: "M",
      },
    );
  } catch {
    canvas.closest<HTMLElement>(".qr-panel")?.classList.add("is-hidden");
  }
}

function configurePage(): void {
  document.title = `${currentPage.name} 下载`;
  requiredElement<HTMLElement>("#page-title").innerHTML =
    `下载 <strong>${currentPage.name}</strong>`;
  requiredElement<HTMLElement>("#page-description").textContent =
    product === "health"
      ? "健康设备配套 App"
      : product === "ring"
        ? "智能戒指配套 App"
        : "原赛电 App · 与 Health 安装包不同";
  requiredElement<HTMLImageElement>("#brand-lockup").alt = currentPage.name;
  requiredElement<HTMLLinkElement>("#canonical-url").href =
    `${window.location.origin}${currentPage.path}`;
  requiredElement<HTMLElement>(`#product-${product}`).setAttribute(
    "aria-current",
    "page",
  );
  if (product !== "health")
    requiredElement<HTMLElement>("#health-links").classList.add("is-hidden");
  if (product === "ring") {
    requiredElement<HTMLElement>("#product-nav").classList.add("is-hidden");
    requiredElement<HTMLElement>("#ring-links").classList.remove("is-hidden");
    requiredElement<HTMLElement>("#release-grid").classList.add("release-grid--two");
    requiredElement<HTMLElement>('[data-platform="harmonyos"]').setAttribute("hidden", "");
    requiredElement<HTMLElement>('[data-platform="harmonyos"]').classList.add("is-hidden");
  }
}

async function copyHash(
  hash: string,
  button: HTMLButtonElement,
): Promise<void> {
  if (!hash) return;
  try {
    await navigator.clipboard.writeText(hash);
    button.textContent = "已复制";
  } catch {
    button.textContent = "复制失败";
  }
  window.setTimeout(() => {
    button.textContent = "复制";
  }, 1800);
}

function formatPublishedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing page element: ${selector}`);
  return element;
}

function requiredChild<T extends Element>(
  parent: Element,
  selector: string,
): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing card element: ${selector}`);
  return element;
}
