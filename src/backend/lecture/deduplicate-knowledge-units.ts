import type { KnowledgeUnit } from "../schemas";

function normalizeKnowledgeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeKnowledgeText(value)
      .split(" ")
      .filter((token) => token.length > 1),
  );
}

function isSameMeaning(left: KnowledgeUnit, right: KnowledgeUnit): boolean {
  if (left.type !== right.type) return false;
  const normalizedLeft = normalizeKnowledgeText(left.text);
  const normalizedRight = normalizeKnowledgeText(right.text);
  if (normalizedLeft === normalizedRight) return true;
  if (
    normalizedLeft.length >= 12 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  ) return true;

  const leftTokens = tokenSet(left.text);
  const rightTokens = tokenSet(right.text);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.82;
}

function importanceRank(value: KnowledgeUnit["importance"]): number {
  return value === "exam" ? 2 : value === "important" ? 1 : 0;
}

export function strongerImportance(
  left: KnowledgeUnit["importance"],
  right: KnowledgeUnit["importance"],
): KnowledgeUnit["importance"] {
  return importanceRank(left) >= importanceRank(right) ? left : right;
}

export function deduplicateKnowledgeUnits(
  units: KnowledgeUnit[],
): KnowledgeUnit[] {
  const result: KnowledgeUnit[] = [];
  for (const unit of units) {
    const existingIndex = result.findIndex((candidate) =>
      isSameMeaning(candidate, unit)
    );
    if (existingIndex < 0) {
      result.push(unit);
      continue;
    }
    const existing = result[existingIndex];
    result[existingIndex] = {
      ...existing,
      importance: strongerImportance(existing.importance, unit.importance),
      sourceItemIds: Array.from(new Set([
        ...existing.sourceItemIds,
        ...unit.sourceItemIds,
      ])),
      sourcePages: Array.from(new Set([
        ...existing.sourcePages,
        ...unit.sourcePages,
      ])).sort((left, right) => left - right),
      order: existing.order ?? unit.order,
    };
  }
  return result;
}
