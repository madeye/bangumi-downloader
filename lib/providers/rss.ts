// Tiny RSS <item> parser shared by acg.rip / dmhy / nyaa providers. Each of
// those feeds is well-formed and predictable; full XML parsing would add a
// dependency and buy us nothing.

export function parseRssItems(xml: string): string[] {
  const blocks: string[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

export function getText(block: string, tag: string): string | undefined {
  // Escape ':' safely for namespaced tags like nyaa:seeders.
  const safe = tag.replace(/[:]/g, "\\$&");
  const re = new RegExp(`<${safe}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${safe}>`);
  const m = block.match(re);
  if (!m) return undefined;
  return decodeEntities(stripCdata(m[1])).trim() || undefined;
}

export function getAttr(block: string, tag: string, attr: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`);
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : undefined;
}

function stripCdata(s: string): string {
  return s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
