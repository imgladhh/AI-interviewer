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
