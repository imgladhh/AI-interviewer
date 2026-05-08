export function extractCandidateTerms(text: string) {
  const patterns = [
    /\b(hash map|hash table|dictionary|complement|two pointers|sliding window|binary search|dfs|bfs|heap|stack|queue|prefix sum|dynamic programming|memoization|sort|sorted input)\b/gi,
    /\b(cache|queue|shard|partition|replica|replication|fan-?out|load balancer|cdn|database|index|rate limit|multi-region|failover|leader election|message broker)\b/gi,
    /\b[a-zA-Z_][a-zA-Z0-9_]*(?:Map|Cache|Queue|Index|Pointer|Count|Table)\b/g,
  ];
  return [...new Set(patterns.flatMap((pattern) => text.match(pattern) ?? []).map((term) => term.trim().toLowerCase()))].slice(
    0,
    8,
  );
}

export function summarizeCandidateArgument(text: string, maxLength = 180) {
  const sentences = splitIntoSentences(text);
  const reasoningSentence = sentences.find((sentence) =>
    /\b(because|since|so that|which means|therefore|tradeoff|trade-off|rather than|instead of|compared to|versus|vs\.?)\b/i.test(
      sentence,
    ),
  );
  const bestSentence =
    reasoningSentence ??
    [...sentences].sort((left, right) => scoreSummarySentence(right) - scoreSummarySentence(left))[0] ??
    text;
  return truncateCandidateArgument(bestSentence, maxLength);
}

function splitIntoSentences(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }
  const matches = normalized.match(/[^.!?]+[.!?]?/g) ?? [normalized];
  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

function scoreSummarySentence(sentence: string) {
  const words = sentence.split(/\s+/).filter(Boolean).length;
  const specificityBonus = /\b(hash map|cache|queue|shard|replica|qps|latency|availability|because|tradeoff|bottleneck|spof)\b/i.test(
    sentence,
  )
    ? 8
    : 0;
  return words + specificityBonus;
}

function truncateCandidateArgument(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trim()}...`;
}
