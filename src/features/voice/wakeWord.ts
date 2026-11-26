const DEFAULT_WAKE_ALIASES = [
  "jarvis",
  "javis",
  "jervis",
  "jarbis",
  "ジャービス",
  "ジャーヴィス",
  "ジャビス",
  "ジャービズ",
  "ジャービーズ",
  "ジャーピス",
  "ジャーピース",
  "チャーピース",
  "チャービス",
  "さあびす",
  "じゃあびす",
  "じゃーびす",
];

const ENGLISH_WAKE_PATTERN =
  /j[\s.・]*a[\s.・]*r[\s.・]*v[\s.・]*i[\s.・]*s\.?/giu;
const JAPANESE_WAKE_PATTERN =
  /(?:ジャ[ーｰ]?(?:ヴ[ィイ]?|ビ)[ーｰ]?ス|じゃ[あーｰ]?びす)/giu;

export function normalizeWakeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ヴィ/g, "ビ")
    .replace(/[ーｰ]/g, "")
    .replace(/[\u30a1-\u30f6]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0x60),
    )
    .replace(/[\s.,!?。！？、・（）()「」『』]/g, "");
}

function aliasesFor(samples: string[]): string[] {
  return [...DEFAULT_WAKE_ALIASES, ...samples]
    .map((alias) => alias.trim())
    .filter(Boolean);
}

/**
 * Collapse the kana whisper habitually confuses (ぴ/び, じ/ぢ, す/ず/つ) so
 * "じゃーぴーっ" and "ジャービス" end up comparable.
 */
function skeletonize(value: string): string {
  return normalizeWakeText(value)
    .replace(/[ぴびゔぶ]/g, "び")
    .replace(/[ぢじ]/g, "じ")
    .replace(/[ずづつ]/g, "す")
    .replace(/ゃ/g, "や")
    .replace(/ゅ/g, "ゆ")
    .replace(/ょ/g, "よ")
    .replace(/[ぁぃぅぇぉっ]/g, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Only short utterances may fuzzy-trigger a wake, so ordinary sentences are
 * never mistaken for the wake word.
 */
const MAX_FUZZY_LENGTH = 16;

function fuzzyMatch(normalized: string, aliases: string[]): boolean {
  if (!normalized || normalized.length > MAX_FUZZY_LENGTH) return false;
  const text = skeletonize(normalized);
  // Only consider windows that cover a decent share of the utterance, so a
  // filler like "じゃあ、そうですね" cannot trip the wake word.
  const minWindow = Math.max(3, Math.ceil(text.length / 2));

  return aliases.some((alias) => {
    const target = skeletonize(alias);
    if (target.length < 4) return false;
    if (text.includes(target)) return true;

    for (
      let length = target.length - 1;
      length <= target.length + 1;
      length += 1
    ) {
      if (length < minWindow || length > text.length) continue;
      for (let start = 0; start + length <= text.length; start += 1) {
        const window = text.slice(start, start + length);
        if (levenshtein(window, target) <= 1) return true;
      }
    }
    return false;
  });
}

export function containsWakeWord(
  text: string,
  samples: string[] = [],
): boolean {
  const normalized = normalizeWakeText(text);
  if (!normalized) return false;
  const aliases = aliasesFor(samples);
  const exact = aliases.some((alias) =>
    normalized.includes(normalizeWakeText(alias)),
  );
  return exact || fuzzyMatch(normalized, aliases);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function removeWakeWord(
  text: string,
  samples: string[] = [],
): string | null {
  const aliases = aliasesFor(samples);
  const normalized = normalizeWakeText(text);
  const exact = aliases.some((alias) =>
    normalized.includes(normalizeWakeText(alias)),
  );
  if (!exact && !fuzzyMatch(normalized, aliases)) return null;

  // A fuzzy hit means the whole (short) utterance was just the wake word.
  if (!exact) return "";

  let remainder = text
    .replace(ENGLISH_WAKE_PATTERN, "")
    .replace(JAPANESE_WAKE_PATTERN, "");
  for (const sample of samples) {
    if (sample.trim()) {
      remainder = remainder.replace(
        new RegExp(escapeRegExp(sample.trim()), "giu"),
        "",
      );
    }
  }

  const trimmed = remainder
    .replace(/[（）()[\]「」『』]/g, "")
    .replace(
      /^[\s、,。.!?！？]*(?:は)?(?:いるか|いますか|いるの)?[?？!！。、,]*\s*/i,
      "",
    )
    .trim();

  // A misheard wake word alone ("じゃーぴーっ") leaves its text behind.
  // Drop it instead of sending gibberish to the model.
  const rest = normalizeWakeText(trimmed);
  if (rest && rest.length <= 8 && fuzzyMatch(rest, aliases)) {
    return "";
  }
  return trimmed;
}
