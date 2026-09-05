import QRCode from "qrcode";
import type { ApiEnvelope } from "@saydian/app-contracts";
import {
  type DownloadManifestContract,
  type DownloadPlatform,
  type DownloadReleaseContract,
} from "@saydian/app-contracts/download";
import { manifestFromApiData } from "./manifest";
import { detectVisitorPlatform, formatPackageSize } from "./platform";
import "./styles.css";

const labels: Record<DownloadPlatform, string> = {
  android: "Android",
  ios: "iPhone",
  harmonyos: "HarmonyOS",
};

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
    const response = await fetch("/api/saydian-app/v2/support/app-update", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("暂未发布可用版本");
    const envelope = (await response.json()) as ApiEnvelope<unknown>;
    const manifest = manifestFromApiData(envelope.data);
    renderManifest(manifest);
    status.textContent = `发布于 ${formatPublishedAt(manifest.publishedAt)}`;
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "下载信息暂时不可用";
    status.classList.add("is-error");
    document.querySelectorAll<HTMLElement>(".status-badge").forEach((badge) => {
      badge.textContent = "暂不可用";
      badge.classList.add("status-badge--muted");
    });
  }
}

function renderManifest(manifest: DownloadManifestContract): void {
  for (const release of manifest.releases) renderRelease(release);
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
    badge.textContent = "待开放";
    badge.classList.add("status-badge--pending");
    action.textContent =
      release.platform === "ios" ? "TestFlight 待开放" : "暂未开放";
    action.removeAttribute("href");
    action.setAttribute("aria-disabled", "true");
    action.classList.add("is-disabled");
    return;
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

function highlightVisitorPlatform(): void {
  const notice = requiredElement<HTMLElement>("#device-notice");
  if (visitorPlatform === "desktop") {
    notice.textContent = "电脑访问：请使用手机扫码。";
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
    await QRCode.toCanvas(canvas, `${window.location.origin}/down`, {
      width: 184,
      margin: 1,
      color: { dark: "#17191f", light: "#ffffff" },
      errorCorrectionLevel: "M",
    });
  } catch {
    canvas.closest<HTMLElement>(".qr-panel")?.classList.add("is-hidden");
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
