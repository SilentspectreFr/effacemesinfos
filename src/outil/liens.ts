const urls = new Set<string>();

export function temporaryUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  urls.add(url);
  return url;
}

export function revokeTemporaryUrls() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
}
