/**
 * Post-ASR fixes for words whisper reliably mishears.
 *
 * Deliberately small and exact-token based: only common Windows app names and
 * the wake word, so ordinary conversation is never rewritten.
 */

const CORRECTIONS: Array<[RegExp, string]> = [
  [
    /でんたこ|でんたく|全卓|電宅|電タフ|ペンタコ|伝託|デンタク|けいさんき/g,
    "電卓",
  ],
  [/めもちょう|メモチョウ|めも帳|メモ帳/g, "メモ帳"],
  [/ぶらうざ|ブラウザ/g, "ブラウザ"],
  [/えくすぷろーらー|エクスプローラ/g, "エクスプローラー"],
];

export function correctTranscript(text: string): string {
  let result = text;
  for (const [pattern, replacement] of CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
