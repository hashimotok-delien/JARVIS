const DEFAULT_WAKE_ALIASES = [
  "jarvis",
  "ジャービス",
  "ジャーヴィス",
  "ジャビス",
  "じゃあびす",
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

export function containsWakeWord(text: string, samples: string[] = []): boolean {
  const normalized = normalizeWakeText(text);
  return aliasesFor(samples).some((alias) =>
    normalized.includes(normalizeWakeText(alias)),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function removeWakeWord(
  text: string,
  samples: string[] = [],
): string | null {
  if (!containsWakeWord(text, samples)) return null;

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

  return remainder
    .replace(/[（）()[\]「」『』]/g, "")
    .replace(
      /^[\s、,。.!?！？]*(?:は)?(?:いるか|いますか|いるの)?[?？!！。、,]*\s*/i,
      "",
    )
    .trim();
}
