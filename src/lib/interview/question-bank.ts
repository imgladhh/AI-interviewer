import { CompanyStyle, Difficulty, QuestionType, TargetLevel } from "@prisma/client";

type Example = {
  input: string;
  output: string;
  explanation?: string;
};

export type QuestionBankEntry = {
  type: QuestionType;
  title: string;
  slug: string;
  prompt: string;
  difficulty: Difficulty;
  companyStyle: CompanyStyle;
  levelTarget: TargetLevel;
  estimatedMinutes: number;
  topicTags: string[];
};

function buildCodingPrompt(description: string, examples: Example[], constraints: string[], notes?: string[]) {
  const exampleBlock = examples
    .map((example, index) => {
      const explanationLine = example.explanation ? `Explanation: ${example.explanation}\n` : "";
      return `Example ${index + 1}:\nInput: ${example.input}\nOutput: ${example.output}\n${explanationLine}`.trim();
    })
    .join("\n\n");

  const constraintsBlock = constraints.map((constraint) => `- ${constraint}`).join("\n");
  const notesBlock = notes && notes.length > 0 ? `\n\nNotes:\n${notes.map((note) => `- ${note}`).join("\n")}` : "";

  return `${description}\n\n${exampleBlock}\n\nConstraints:\n${constraintsBlock}${notesBlock}`;
}

const GENERIC = CompanyStyle.GENERIC;
const AMAZON = CompanyStyle.AMAZON;
const META = CompanyStyle.META;
const GOOGLE = CompanyStyle.GOOGLE;

const COMPANY_VARIANT_STYLES = [AMAZON, META, GOOGLE] as const;

const COMPANY_VARIANT_TITLES = new Set([
  "Two Sum",
  "Merge Intervals",
  "Top K Frequent Elements",
  "Valid Parentheses",
  "Best Time to Buy and Sell Stock",
  "Contains Duplicate",
  "Binary Search",
  "Reverse Linked List",
  "Maximum Depth of Binary Tree",
  "Product of Array Except Self",
  "Longest Substring Without Repeating Characters",
  "Group Anagrams",
  "3Sum",
  "Container With Most Water",
  "Search in Rotated Sorted Array",
  "Find Minimum in Rotated Sorted Array",
  "Insert Interval",
  "Number of Islands",
  "Clone Graph",
  "Course Schedule",
  "Kth Largest Element in an Array",
  "Meeting Rooms II",
  "LRU Cache",
]);

function companyLabel(companyStyle: CompanyStyle) {
  switch (companyStyle) {
    case CompanyStyle.AMAZON:
      return "Amazon";
    case CompanyStyle.META:
      return "Meta";
    case CompanyStyle.GOOGLE:
      return "Google";
    case CompanyStyle.STRIPE:
      return "Stripe";
    case CompanyStyle.GENERIC:
    default:
      return "Generic";
  }
}

function buildCompanyVariant(entry: QuestionBankEntry, companyStyle: CompanyStyle): QuestionBankEntry {
  const label = companyLabel(companyStyle);
  return {
    ...entry,
    slug: `${entry.slug}-${companyStyle.toLowerCase()}`,
    companyStyle,
    topicTags: Array.from(new Set([...(entry.topicTags ?? []), `company:${companyStyle.toLowerCase()}`, `${label.toLowerCase()}-high-frequency`])),
  };
}

const BASE_QUESTION_BANK: QuestionBankEntry[] = [
  {
    type: QuestionType.CODING,
    title: "Two Sum",
    slug: "two-sum",
    prompt: buildCodingPrompt(
      "Given an integer array nums and an integer target, return the indices of two distinct values whose sum is exactly target.",
      [
        { input: "nums = [2, 7, 11, 15], target = 9", output: "[0, 1]" },
        { input: "nums = [3, 2, 4], target = 6", output: "[1, 2]" },
        { input: "nums = [3, 3], target = 6", output: "[0, 1]" },
      ],
      [
        "2 <= nums.length <= 10^4",
        "-10^9 <= nums[i] <= 10^9",
        "-10^9 <= target <= 10^9",
        "Exactly one valid answer exists",
      ],
      ["The same element cannot be used twice.", "You may return the answer in any order."],
    ),
    difficulty: Difficulty.EASY,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 20,
    topicTags: ["array", "hash-map"],
  },
  {
    type: QuestionType.CODING,
    title: "Merge Intervals",
    slug: "merge-intervals",
    prompt: buildCodingPrompt(
      "Given a list of closed intervals, merge every overlapping interval and return a list of non-overlapping intervals that covers the same ranges.",
      [
        { input: "intervals = [[1,3],[2,6],[8,10],[15,18]]", output: "[[1,6],[8,10],[15,18]]" },
        { input: "intervals = [[1,4],[4,5]]", output: "[[1,5]]", explanation: "Touching endpoints still merge into one interval." },
      ],
      [
        "1 <= intervals.length <= 10^4",
        "intervals[i].length == 2",
        "0 <= start_i <= end_i <= 10^4",
      ],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 35,
    topicTags: ["intervals", "sorting"],
  },
  {
    type: QuestionType.CODING,
    title: "Top K Frequent Elements",
    slug: "top-k-frequent-elements",
    prompt: buildCodingPrompt(
      "Given an integer array nums and an integer k, return the k values that appear most often in the array.",
      [
        { input: "nums = [1,1,1,2,2,3], k = 2", output: "[1,2]" },
        { input: "nums = [1], k = 1", output: "[1]" },
        { input: "nums = [4,4,4,6,6,7,7,7,7], k = 2", output: "[7,4]" },
      ],
      [
        "1 <= nums.length <= 10^5",
        "-10^4 <= nums[i] <= 10^4",
        "1 <= k <= number of distinct values in nums",
        "The answer is unique",
      ],
      ["The result can be returned in any order."],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 35,
    topicTags: ["array", "hash-map", "heap", "bucket-sort"],
  },
  {
    type: QuestionType.CODING,
    title: "Design URL Shortener",
    slug: "design-url-shortener",
    prompt: buildCodingPrompt(
      "Implement a URL shortener service with two operations: encode(longUrl) should return a short string key, and decode(shortUrl) should recover the original long URL. Your design should use deterministic in-memory data structures for the interview version of the problem.",
      [
        {
          input: 'operations = [encode("https://example.com/a"), decode("short-1")]',
          output: '["short-1", "https://example.com/a"]',
        },
        {
          input: 'encode("https://example.com/a") twice',
          output: "The same long URL may map to the same short key if your implementation is deterministic",
        },
      ],
      [
        "1 <= number of operations <= 2 * 10^4",
        "1 <= URL length <= 2048",
        "All encode and decode operations must run in O(1) average time",
      ],
      [
        "You do not need to discuss distributed storage or internet-scale deployment in this coding version.",
        "Focus on the data structures and correctness of the encode/decode mapping.",
      ],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 30,
    topicTags: ["design", "hash-map", "string"],
  },
  {
    type: QuestionType.CODING,
    title: "Valid Parentheses",
    slug: "valid-parentheses",
    prompt: buildCodingPrompt(
      "Given a string consisting only of bracket characters, determine whether the brackets form a valid sequence.",
      [
        { input: 's = "()"', output: "true" },
        { input: 's = "()[]{}"', output: "true" },
        { input: 's = "(]"', output: "false" },
      ],
      ["1 <= s.length <= 10^4", "s contains only bracket characters"],
      ["A sequence is valid when every opening bracket is closed by the same type in the correct order."],
    ),
    difficulty: Difficulty.EASY,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.NEW_GRAD,
    estimatedMinutes: 15,
    topicTags: ["stack", "string"],
  },
  {
    type: QuestionType.CODING,
    title: "Best Time to Buy and Sell Stock",
    slug: "best-time-to-buy-and-sell-stock",
    prompt: buildCodingPrompt(
      "Given an array prices where prices[i] is the price of a stock on day i, return the maximum profit from one buy followed by one sell.",
      [
        { input: "prices = [7,1,5,3,6,4]", output: "5" },
        { input: "prices = [7,6,4,3,1]", output: "0" },
      ],
      ["1 <= prices.length <= 10^5", "0 <= prices[i] <= 10^4"],
      ["You must buy before you sell.", "If no profit is possible, return 0."],
    ),
    difficulty: Difficulty.EASY,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.NEW_GRAD,
    estimatedMinutes: 15,
    topicTags: ["array", "greedy"],
  },
  {
    type: QuestionType.CODING,
    title: "Contains Duplicate",
    slug: "contains-duplicate",
    prompt: buildCodingPrompt(
      "Given an integer array nums, return true if any value appears at least twice in the array. Otherwise return false.",
      [
        { input: "nums = [1,2,3,1]", output: "true" },
        { input: "nums = [1,2,3,4]", output: "false" },
      ],
      ["1 <= nums.length <= 10^5", "-10^9 <= nums[i] <= 10^9"],
    ),
    difficulty: Difficulty.EASY,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.NEW_GRAD,
    estimatedMinutes: 10,
    topicTags: ["array", "hash-set"],
  },
  {
    type: QuestionType.CODING,
    title: "Binary Search",
    slug: "binary-search",
    prompt: buildCodingPrompt(
      "Given a sorted array of integers nums and an integer target, return the index of target if it exists. Otherwise return -1.",
      [
        { input: "nums = [-1,0,3,5,9,12], target = 9", output: "4" },
        { input: "nums = [-1,0,3,5,9,12], target = 2", output: "-1" },
      ],
      ["1 <= nums.length <= 10^4", "-10^4 <= nums[i], target <= 10^4", "nums is sorted in increasing order"],
    ),
    difficulty: Difficulty.EASY,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.NEW_GRAD,
    estimatedMinutes: 15,
    topicTags: ["binary-search", "array"],
  },
  {
    type: QuestionType.CODING,
    title: "Reverse Linked List",
    slug: "reverse-linked-list",
    prompt: buildCodingPrompt(
      "Given the head of a singly linked list, reverse the list and return the new head.",
      [
        { input: "head = [1,2,3,4,5]", output: "[5,4,3,2,1]" },
        { input: "head = [1,2]", output: "[2,1]" },
      ],
      ["0 <= number of nodes <= 5000", "-5000 <= Node.val <= 5000"],
    ),
    difficulty: Difficulty.EASY,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.NEW_GRAD,
    estimatedMinutes: 15,
    topicTags: ["linked-list"],
  },
  {
    type: QuestionType.CODING,
    title: "Maximum Depth of Binary Tree",
    slug: "maximum-depth-of-binary-tree",
    prompt: buildCodingPrompt(
      "Given the root of a binary tree, return its maximum depth.",
      [
        { input: "root = [3,9,20,null,null,15,7]", output: "3" },
        { input: "root = [1,null,2]", output: "2" },
      ],
      ["0 <= number of nodes <= 10^4", "-100 <= Node.val <= 100"],
      ["Depth is the number of nodes on the longest root-to-leaf path."],
    ),
    difficulty: Difficulty.EASY,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.NEW_GRAD,
    estimatedMinutes: 15,
    topicTags: ["tree", "dfs", "bfs"],
  },
  {
    type: QuestionType.CODING,
    title: "Product of Array Except Self",
    slug: "product-of-array-except-self",
    prompt: buildCodingPrompt(
      "Given an integer array nums, return an array answer where answer[i] is the product of every value in nums except nums[i].",
      [
        { input: "nums = [1,2,3,4]", output: "[24,12,8,6]" },
        { input: "nums = [-1,1,0,-3,3]", output: "[0,0,9,0,0]" },
      ],
      ["2 <= nums.length <= 10^5", "-30 <= nums[i] <= 30", "Prefix and suffix products fit in a 32-bit integer"],
      ["Do not use division.", "Aim for O(n) time."],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 25,
    topicTags: ["array", "prefix-suffix"],
  },
  {
    type: QuestionType.CODING,
    title: "Longest Substring Without Repeating Characters",
    slug: "longest-substring-without-repeating-characters",
    prompt: buildCodingPrompt(
      "Given a string s, return the length of the longest substring that contains no repeated characters.",
      [
        { input: 's = "abcabcbb"', output: "3" },
        { input: 's = "bbbbb"', output: "1" },
        { input: 's = "pwwkew"', output: "3" },
      ],
      ["0 <= s.length <= 5 * 10^4", "s consists of English letters, digits, symbols, and spaces"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 25,
    topicTags: ["sliding-window", "string", "hash-map"],
  },
  {
    type: QuestionType.CODING,
    title: "Group Anagrams",
    slug: "group-anagrams",
    prompt: buildCodingPrompt(
      "Given an array of strings, group the strings that are anagrams of each other.",
      [
        { input: 'strs = ["eat","tea","tan","ate","nat","bat"]', output: '[["eat","tea","ate"],["tan","nat"],["bat"]]' },
        { input: 'strs = [""]', output: '[[""]]' },
      ],
      ["1 <= strs.length <= 10^4", "0 <= strs[i].length <= 100", "strs[i] consists of lowercase English letters"],
      ["The order of groups does not matter."],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 25,
    topicTags: ["hash-map", "string", "sorting"],
  },
  {
    type: QuestionType.CODING,
    title: "3Sum",
    slug: "3sum",
    prompt: buildCodingPrompt(
      "Given an integer array nums, return all unique triplets [nums[i], nums[j], nums[k]] such that i, j, and k are distinct and the three values sum to zero.",
      [
        { input: "nums = [-1,0,1,2,-1,-4]", output: "[[-1,-1,2],[-1,0,1]]" },
        { input: "nums = [0,1,1]", output: "[]" },
      ],
      ["3 <= nums.length <= 3000", "-10^5 <= nums[i] <= 10^5"],
      ["The order of triplets does not matter.", "Do not include duplicates."],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 30,
    topicTags: ["two-pointers", "sorting", "array"],
  },
  {
    type: QuestionType.CODING,
    title: "Container With Most Water",
    slug: "container-with-most-water",
    prompt: buildCodingPrompt(
      "You are given an array height where height[i] is the height of a vertical line. Choose two lines that together with the x-axis form a container with the largest possible area.",
      [
        { input: "height = [1,8,6,2,5,4,8,3,7]", output: "49" },
        { input: "height = [1,1]", output: "1" },
      ],
      ["2 <= height.length <= 10^5", "0 <= height[i] <= 10^4"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 20,
    topicTags: ["two-pointers", "greedy"],
  },
  {
    type: QuestionType.CODING,
    title: "Search in Rotated Sorted Array",
    slug: "search-in-rotated-sorted-array",
    prompt: buildCodingPrompt(
      "Given a sorted array that has been rotated at an unknown pivot, return the index of target if it exists, or -1 otherwise.",
      [
        { input: "nums = [4,5,6,7,0,1,2], target = 0", output: "4" },
        { input: "nums = [4,5,6,7,0,1,2], target = 3", output: "-1" },
      ],
      ["1 <= nums.length <= 5000", "-10^4 <= nums[i], target <= 10^4", "All values are unique"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 25,
    topicTags: ["binary-search", "array"],
  },
  {
    type: QuestionType.CODING,
    title: "Find Minimum in Rotated Sorted Array",
    slug: "find-minimum-in-rotated-sorted-array",
    prompt: buildCodingPrompt(
      "Given a sorted array that has been rotated between 1 and n times, return the minimum value in the array.",
      [
        { input: "nums = [3,4,5,1,2]", output: "1" },
        { input: "nums = [4,5,6,7,0,1,2]", output: "0" },
      ],
      ["1 <= nums.length <= 5000", "-5000 <= nums[i] <= 5000", "All values are unique"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 20,
    topicTags: ["binary-search", "array"],
  },
  {
    type: QuestionType.CODING,
    title: "Insert Interval",
    slug: "insert-interval",
    prompt: buildCodingPrompt(
      "You are given a sorted list of non-overlapping intervals and a newInterval. Insert newInterval into the list and merge if necessary.",
      [
        { input: "intervals = [[1,3],[6,9]], newInterval = [2,5]", output: "[[1,5],[6,9]]" },
        { input: "intervals = [[1,2],[3,5],[6,7],[8,10],[12,16]], newInterval = [4,8]", output: "[[1,2],[3,10],[12,16]]" },
      ],
      ["0 <= intervals.length <= 10^4", "intervals are sorted by start and do not overlap"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 25,
    topicTags: ["intervals", "array"],
  },
  {
    type: QuestionType.CODING,
    title: "Number of Islands",
    slug: "number-of-islands",
    prompt: buildCodingPrompt(
      "Given a 2D grid of '1's and '0's, return the number of islands. An island is formed by horizontally or vertically adjacent land cells.",
      [
        { input: 'grid = [["1","1","1","1","0"],["1","1","0","1","0"],["1","1","0","0","0"],["0","0","0","0","0"]]', output: "1" },
        { input: 'grid = [["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]', output: "3" },
      ],
      ["1 <= rows, cols <= 300", "grid[i][j] is either '0' or '1'"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 30,
    topicTags: ["graph", "dfs", "bfs", "matrix"],
  },
  {
    type: QuestionType.CODING,
    title: "Clone Graph",
    slug: "clone-graph",
    prompt: buildCodingPrompt(
      "Given a reference to a node in a connected undirected graph, return a deep copy of the graph.",
      [
        { input: "adjacency = [[2,4],[1,3],[2,4],[1,3]]", output: "A new graph with the same adjacency structure" },
        { input: "adjacency = [[]]", output: "A new single-node graph" },
      ],
      ["The graph has between 0 and 100 nodes", "1 <= Node.val <= 100"],
      ["Allocate new nodes. Do not reuse nodes from the input graph."],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 25,
    topicTags: ["graph", "dfs", "bfs", "hash-map"],
  },
  {
    type: QuestionType.CODING,
    title: "Course Schedule",
    slug: "course-schedule",
    prompt: buildCodingPrompt(
      "There are numCourses labeled from 0 to numCourses - 1. Given prerequisite pairs [a, b] meaning you must take course b before course a, return true if it is possible to finish all courses.",
      [
        { input: "numCourses = 2, prerequisites = [[1,0]]", output: "true" },
        { input: "numCourses = 2, prerequisites = [[1,0],[0,1]]", output: "false" },
      ],
      ["1 <= numCourses <= 2000", "0 <= prerequisites.length <= 5000"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 30,
    topicTags: ["graph", "topological-sort", "dfs"],
  },
  {
    type: QuestionType.CODING,
    title: "Kth Largest Element in an Array",
    slug: "kth-largest-element-in-an-array",
    prompt: buildCodingPrompt(
      "Given an integer array nums and an integer k, return the kth largest value in the array.",
      [
        { input: "nums = [3,2,1,5,6,4], k = 2", output: "5" },
        { input: "nums = [3,2,3,1,2,4,5,5,6], k = 4", output: "4" },
      ],
      ["1 <= k <= nums.length <= 10^5", "-10^4 <= nums[i] <= 10^4"],
      ["This is the kth largest in sorted order, not the kth distinct value."],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 25,
    topicTags: ["heap", "quickselect", "array"],
  },
  {
    type: QuestionType.CODING,
    title: "Meeting Rooms II",
    slug: "meeting-rooms-ii",
    prompt: buildCodingPrompt(
      "Given an array of meeting time intervals, return the minimum number of conference rooms required.",
      [
        { input: "intervals = [[0,30],[5,10],[15,20]]", output: "2" },
        { input: "intervals = [[7,10],[2,4]]", output: "1" },
      ],
      ["1 <= intervals.length <= 10^4", "0 <= start_i < end_i <= 10^6"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 25,
    topicTags: ["intervals", "heap", "sorting"],
  },
  {
    type: QuestionType.CODING,
    title: "Linked List Cycle",
    slug: "linked-list-cycle",
    prompt: buildCodingPrompt(
      "Given the head of a linked list, return true if the list contains a cycle, otherwise return false.",
      [
        { input: "head = [3,2,0,-4], pos = 1", output: "true" },
        { input: "head = [1], pos = -1", output: "false" },
      ],
      ["0 <= number of nodes <= 10^4", "-10^5 <= Node.val <= 10^5"],
      ["pos indicates the index the tail points to. It is not given directly to your function."],
    ),
    difficulty: Difficulty.EASY,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.NEW_GRAD,
    estimatedMinutes: 15,
    topicTags: ["linked-list", "two-pointers"],
  },
  {
    type: QuestionType.CODING,
    title: "Remove Nth Node From End of List",
    slug: "remove-nth-node-from-end-of-list",
    prompt: buildCodingPrompt(
      "Given the head of a linked list, remove the nth node from the end and return the updated head.",
      [
        { input: "head = [1,2,3,4,5], n = 2", output: "[1,2,3,5]" },
        { input: "head = [1], n = 1", output: "[]" },
      ],
      ["1 <= number of nodes <= 30", "1 <= n <= size of list"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 20,
    topicTags: ["linked-list", "two-pointers"],
  },
  {
    type: QuestionType.CODING,
    title: "LRU Cache",
    slug: "lru-cache",
    prompt: buildCodingPrompt(
      "Design a data structure that supports get(key) and put(key, value) for an LRU cache with fixed capacity. Both operations should run in O(1) average time.",
      [
        { input: "capacity = 2, operations = [put(1,1), put(2,2), get(1), put(3,3), get(2)]", output: "[null, null, 1, null, -1]" },
      ],
      ["1 <= capacity <= 3000", "0 <= key, value <= 10^4", "At most 2 * 10^5 operations"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SENIOR,
    estimatedMinutes: 35,
    topicTags: ["design", "hash-map", "linked-list"],
  },
  {
    type: QuestionType.CODING,
    title: "Binary Tree Level Order Traversal",
    slug: "binary-tree-level-order-traversal",
    prompt: buildCodingPrompt(
      "Given the root of a binary tree, return the values level by level from top to bottom.",
      [
        { input: "root = [3,9,20,null,null,15,7]", output: "[[3],[9,20],[15,7]]" },
        { input: "root = [1]", output: "[[1]]" },
      ],
      ["0 <= number of nodes <= 2000", "-1000 <= Node.val <= 1000"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 20,
    topicTags: ["tree", "bfs", "queue"],
  },
  {
    type: QuestionType.CODING,
    title: "Validate Binary Search Tree",
    slug: "validate-binary-search-tree",
    prompt: buildCodingPrompt(
      "Given the root of a binary tree, return true if it is a valid binary search tree, otherwise return false.",
      [
        { input: "root = [2,1,3]", output: "true" },
        { input: "root = [5,1,4,null,null,3,6]", output: "false" },
      ],
      ["1 <= number of nodes <= 10^4", "-2^31 <= Node.val <= 2^31 - 1"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 25,
    topicTags: ["tree", "dfs", "bst"],
  },
  {
    type: QuestionType.CODING,
    title: "Lowest Common Ancestor of a Binary Search Tree",
    slug: "lowest-common-ancestor-of-a-binary-search-tree",
    prompt: buildCodingPrompt(
      "Given the root of a binary search tree and two nodes p and q, return their lowest common ancestor.",
      [
        { input: "root = [6,2,8,0,4,7,9,null,null,3,5], p = 2, q = 8", output: "6" },
        { input: "root = [6,2,8,0,4,7,9,null,null,3,5], p = 2, q = 4", output: "2" },
      ],
      ["2 <= number of nodes <= 10^5", "-10^9 <= Node.val <= 10^9", "p and q both exist in the tree"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE1,
    estimatedMinutes: 20,
    topicTags: ["tree", "bst"],
  },
  {
    type: QuestionType.CODING,
    title: "Word Break",
    slug: "word-break",
    prompt: buildCodingPrompt(
      "Given a string s and a dictionary of words wordDict, return true if s can be segmented into a sequence of one or more dictionary words.",
      [
        { input: 's = "leetcode", wordDict = ["leet","code"]', output: "true" },
        { input: 's = "catsandog", wordDict = ["cats","dog","sand","and","cat"]', output: "false" },
      ],
      ["1 <= s.length <= 300", "1 <= wordDict.length <= 1000", "1 <= wordDict[i].length <= 20"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 25,
    topicTags: ["dp", "string", "hash-set"],
  },
  {
    type: QuestionType.CODING,
    title: "Coin Change",
    slug: "coin-change",
    prompt: buildCodingPrompt(
      "Given a list of coin denominations and a target amount, return the fewest number of coins needed to make the amount. Return -1 if it cannot be formed.",
      [
        { input: "coins = [1,2,5], amount = 11", output: "3" },
        { input: "coins = [2], amount = 3", output: "-1" },
      ],
      ["1 <= coins.length <= 12", "1 <= coins[i] <= 2^31 - 1", "0 <= amount <= 10^4"],
    ),
    difficulty: Difficulty.MEDIUM,
    companyStyle: GENERIC,
    levelTarget: TargetLevel.SDE2,
    estimatedMinutes: 25,
    topicTags: ["dp"],
  },
];

const COMPANY_VARIANTS = BASE_QUESTION_BANK.flatMap((entry) => {
  if (entry.type !== QuestionType.CODING || !COMPANY_VARIANT_TITLES.has(entry.title)) {
    return [];
  }

  return COMPANY_VARIANT_STYLES.map((companyStyle) => buildCompanyVariant(entry, companyStyle));
});

export const QUESTION_BANK: QuestionBankEntry[] = [...BASE_QUESTION_BANK, ...COMPANY_VARIANTS];

export function getQuestionPromptByTitle(title: string | null | undefined) {
  if (!title) {
    return null;
  }

  return QUESTION_BANK.find((question) => question.title === title)?.prompt ?? null;
}
