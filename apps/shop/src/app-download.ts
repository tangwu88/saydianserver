import { defaultStoreDownload, parseStoreDownload, STORE_DOWNLOAD_KEY } from "@saydian/app-contracts";
export { defaultStoreDownload, STORE_DOWNLOAD_KEY };
export function storeDownloadConfig(configs: Record<string, any>) {
  const row = configs[STORE_DOWNLOAD_KEY];
  if (!row) return { ...defaultStoreDownload };
  if (row.enabled !== true) return null;
  try { return parseStoreDownload(row.value); } catch { return null; }
}
