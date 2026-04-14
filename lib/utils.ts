export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = bytes;
  let index = 0;

  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }

  return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function normalizeMagnet(infoHash?: string, title?: string): string | undefined {
  if (!infoHash) {
    return undefined;
  }

  const trimmed = infoHash.trim().toLowerCase();

  if (!/^[a-f0-9]{40}$/.test(trimmed)) {
    return undefined;
  }

  const displayName = title ? `&dn=${encodeURIComponent(title)}` : "";
  return `magnet:?xt=urn:btih:${trimmed}${displayName}`;
}

export function toIsoDate(value: string | number | Date | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

export function cleanKeyword(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}
