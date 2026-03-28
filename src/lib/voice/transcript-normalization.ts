const TECHNICAL_TERM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bhashmaps?\b/gi, "hash map"],
  [/\bhash\s?map\b/gi, "hash map"],
  [/\bhash\s?maps\b/gi, "hash maps"],
  [/\bhash table\b/gi, "hash table"],
  [/\bhash set\b/gi, "hash set"],
  [/\barray list\b/gi, "array list"],
  [/\blinked list\b/gi, "linked list"],
  [/\b2 pointers?\b/gi, "two pointers"],
  [/\btwo pointer\b/gi, "two pointers"],
  [/\bsliding window\b/gi, "sliding window"],
  [/\bprefix sum\b/gi, "prefix sum"],
  [/\bsuffix array\b/gi, "suffix array"],
  [/\bunion find\b/gi, "union find"],
  [/\bdisjoint set\b/gi, "disjoint set"],
  [/\bback tracking\b/gi, "backtracking"],
  [/\bdynamic programming\b/gi, "dynamic programming"],
  [/\bgreedy\b/gi, "greedy"],
  [/\btopological sort\b/gi, "topological sort"],
  [/\bdepth first search\b/gi, "DFS"],
  [/\bbreadth first search\b/gi, "BFS"],
  [/\bd f s\b/gi, "DFS"],
  [/\bb f s\b/gi, "BFS"],
  [/\bdeque\b/gi, "deque"],
  [/\bqueue\b/gi, "queue"],
  [/\bstack\b/gi, "stack"],
  [/\btrie\b/gi, "trie"],
  [/\bgraph\b/gi, "graph"],
  [/\btree\b/gi, "tree"],
  [/\bbinary tree\b/gi, "binary tree"],
  [/\bbinary search tree\b/gi, "binary search tree"],
  [/\bheap\b/gi, "heap"],
  [/\bmin heap\b/gi, "min heap"],
  [/\bmax heap\b/gi, "max heap"],
  [/\bbinary search\b/gi, "binary search"],
  [/\brecursion\b/gi, "recursion"],
  [/\biterative\b/gi, "iterative"],
  [/\binvariant\b/gi, "invariant"],
  [/\bamortized\b/gi, "amortized"],
  [/\btrade off\b/gi, "tradeoff"],
  [/\btrade offs\b/gi, "tradeoffs"],
  [/\bpointer\b/gi, "pointer"],
  [/\bpointers\b/gi, "pointers"],
  [/\bo of n\b/gi, "O(n)"],
  [/\bo of log n\b/gi, "O(log n)"],
  [/\bo of n log n\b/gi, "O(n log n)"],
  [/\bo of n squared\b/gi, "O(n^2)"],
  [/\bo of n square\b/gi, "O(n^2)"],
  [/\bo of log k\b/gi, "O(log k)"],
  [/\bo of one\b/gi, "O(1)"],
  [/\bo of k\b/gi, "O(k)"],
  [/\bo of v plus e\b/gi, "O(V + E)"],
  [/\bo open paren n close paren\b/gi, "O(n)"],
  [/\bo open paren one close paren\b/gi, "O(1)"],
  [/\bo open paren log n close paren\b/gi, "O(log n)"],
  [/\boffer by one\b/gi, "off by one"],
  [/\bedge cases\b/gi, "edge cases"],
  [/\bedge case\b/gi, "edge case"],
  [/\btime complexity\b/gi, "time complexity"],
  [/\bspace complexity\b/gi, "space complexity"],
  [/\bbig o\b/gi, "Big-O"],
  [/\bstdin\b/gi, "stdin"],
  [/\bstdout\b/gi, "stdout"],
  [/\bnull pointer\b/gi, "null pointer"],
  [/\bbase case\b/gi, "base case"],
  [/\btest case\b/gi, "test case"],
  [/\btest cases\b/gi, "test cases"],
];

export function normalizeTranscriptText(text: string) {
  let normalized = text.trim().replace(/\s+/g, " ");

  for (const [pattern, replacement] of TECHNICAL_TERM_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized.replace(/\bi\b/g, "I");
  return normalized.trim();
}

export function mergeTranscriptFragments(base: string, incoming: string) {
  const left = normalizeSpacing(base);
  const right = normalizeSpacing(incoming);

  if (!left) return right;
  if (!right) return left;
  if (left === right) return left;
  if (right.startsWith(left)) return right;
  if (left.startsWith(right)) return left;

  const lowerLeft = left.toLowerCase();
  const lowerRight = right.toLowerCase();
  const maxOverlap = Math.min(lowerLeft.length, lowerRight.length);

  for (let size = maxOverlap; size >= 10; size -= 1) {
    if (lowerLeft.slice(-size) === lowerRight.slice(0, size)) {
      return normalizeSpacing(`${left}${right.slice(size)}`);
    }
  }

  const leftWords = lowerLeft.split(" ");
  const rightWords = lowerRight.split(" ");
  for (let size = Math.min(leftWords.length, rightWords.length); size >= 2; size -= 1) {
    const leftTail = leftWords.slice(-size).join(" ");
    const rightHead = rightWords.slice(0, size).join(" ");
    if (leftTail === rightHead) {
      return normalizeSpacing(`${left} ${right.split(" ").slice(size).join(" ")}`);
    }
  }

  if (/[.!?]$/.test(left)) {
    return normalizeSpacing(`${left} ${right}`);
  }

  return normalizeSpacing(`${left} ${right}`);
}

function normalizeSpacing(text: string) {
  return text.trim().replace(/\s+/g, " ");
}
