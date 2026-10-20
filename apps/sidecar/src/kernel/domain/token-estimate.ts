/** Estimates Latin text at four characters per token and each CJK character as one. */
export function estimateTokens(text: string): number {
  if (!/[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{3134f}\u3040-\u30ff\uac00-\ud7af]/u.test(text)) {
    return Math.ceil(text.length / 4);
  }
  let latinCharacters = 0;
  let cjkCharacters = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && isCjk(codePoint)) cjkCharacters += 1;
    else latinCharacters += character.length;
  }
  return Math.ceil(latinCharacters / 4) + cjkCharacters;
}

function isCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3134f) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af)
  );
}
