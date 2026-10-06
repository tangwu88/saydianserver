export async function uploadImageBatch(
  files: readonly File[],
  upload: (file: File) => Promise<string>,
  insert: (url: string, file: File) => void,
): Promise<{ uploaded: number; failures: string[] }> {
  let uploaded = 0;
  const failures: string[] = [];
  for (const file of files) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      failures.push(`${file.name}：请选择不超过10MB的 JPG、PNG 或 WebP 图片`);
      continue;
    }
    try {
      const url = await upload(file);
      if (!url) throw new Error("上传响应缺少图片地址");
      insert(url, file);
      uploaded++;
    } catch (error) {
      failures.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { uploaded, failures };
}
