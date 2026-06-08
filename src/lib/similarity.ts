export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function keywordMatch(query: string, text: string, tags: string[]): number {
  const keywords = query.replace(/[？?！!。，,、]/g, " ").split(/\s+/).filter(Boolean);
  let score = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) score += 2;
    for (const tag of tags) {
      if (tag.includes(kw) || kw.includes(tag)) score += 3;
    }
  }
  return score;
}
