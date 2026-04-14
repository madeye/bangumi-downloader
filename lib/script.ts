import { Converter } from "opencc-js";

// Simplified / Traditional Chinese helpers. Used to fold S/T variants into a
// single dedupe/group bucket, and to score the user's preferred script during
// per-episode pruning. Conversions run server-side only — opencc-js ships
// large dictionaries that we don't want in the client bundle.

export type ScriptVariant = "simplified" | "traditional";

const toSimplifiedFn = Converter({ from: "tw", to: "cn" });
const toTraditionalFn = Converter({ from: "cn", to: "tw" });

export function toSimplified(text: string): string {
  return toSimplifiedFn(text);
}

// detectScript returns which script the text is written in, or undefined when
// the text has no CJK differences (pure ASCII / Japanese / already identical
// under both conversions).
export function detectScript(text: string): ScriptVariant | undefined {
  if (!text) return undefined;
  const asSimp = toSimplifiedFn(text);
  const asTrad = toTraditionalFn(text);
  const isTrad = asSimp !== text;
  const isSimp = asTrad !== text;
  if (isTrad && !isSimp) return "traditional";
  if (isSimp && !isTrad) return "simplified";
  return undefined;
}
