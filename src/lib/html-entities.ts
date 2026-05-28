const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "...",
  ldquo: "\"",
  lsquo: "'",
  lt: "<",
  mdash: "-",
  nbsp: " ",
  ndash: "-",
  quot: "\"",
  rdquo: "\"",
  rsquo: "'"
};

export function decodeHtmlEntities(value: unknown) {
  const text = String(value ?? "");

  if (!text.includes("&")) {
    return text;
  }

  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const normalizedEntity = entity.toLowerCase();

    if (normalizedEntity.startsWith("#x")) {
      const codePoint = Number.parseInt(normalizedEntity.slice(2), 16);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }

    if (normalizedEntity.startsWith("#")) {
      const codePoint = Number.parseInt(normalizedEntity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }

    return NAMED_ENTITIES[normalizedEntity] ?? match;
  });
}
