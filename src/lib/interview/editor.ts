export type SupportedEditorLanguage = "PYTHON" | "JAVASCRIPT" | "JAVA" | "C++";

type FunctionTemplate = {
  kind: "function";
  names: Record<SupportedEditorLanguage, string>;
  params: Record<SupportedEditorLanguage, string>;
  returns: Record<SupportedEditorLanguage, string>;
  defaults: Record<SupportedEditorLanguage, string>;
  samples: Record<SupportedEditorLanguage, string[]>;
  callArgs: Record<SupportedEditorLanguage, string>;
  helpers?: Partial<Record<SupportedEditorLanguage, string>>;
  print?: Partial<Record<SupportedEditorLanguage, string>>;
  comment: string;
};

type ClassTemplate = {
  kind: "class";
  bodies: Record<SupportedEditorLanguage, string>;
};

type ProblemTemplate = FunctionTemplate | ClassTemplate;

const LINKED_HELPERS = {
  PYTHON: `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
`,
  JAVASCRIPT: `class ListNode {
  constructor(val = 0, next = null) {
    this.val = val;
    this.next = next;
  }
}
`,
  JAVA: `  static class ListNode {
    int val;
    ListNode next;
    ListNode(int val) { this.val = val; }
  }
`,
  "C++": `struct ListNode {
  int val;
  ListNode* next;
  ListNode(int x) : val(x), next(nullptr) {}
};
`,
} as const;

const TREE_HELPERS = {
  PYTHON: `class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
`,
  JAVASCRIPT: `class TreeNode {
  constructor(val = 0, left = null, right = null) {
    this.val = val;
    this.left = left;
    this.right = right;
  }
}
`,
  JAVA: `  static class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode(int val) { this.val = val; }
  }
`,
  "C++": `struct TreeNode {
  int val;
  TreeNode* left;
  TreeNode* right;
  TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
};
`,
} as const;

const DEFAULT_PRINTS: Record<SupportedEditorLanguage, string> = {
  PYTHON: "print(result)",
  JAVASCRIPT: "console.log(JSON.stringify(result));",
  JAVA: "System.out.println(result);",
  "C++": "cout << result << endl;",
};

const TODO_BODIES: Record<SupportedEditorLanguage, string> = {
  PYTHON: 'raise NotImplementedError("TODO: implement this function")',
  JAVASCRIPT: 'throw new Error("TODO: implement this function");',
  JAVA: 'throw new UnsupportedOperationException("TODO: implement this function");',
  "C++": 'throw runtime_error("TODO: implement this function");',
};

const VECTOR_PRINT_CPP = `cout << "[";\n  for (size_t i = 0; i < result.size(); ++i) {\n    cout << result[i];\n    if (i + 1 < result.size()) cout << ", ";\n  }\n  cout << "]" << endl;`;
const VECTOR_VECTOR_PRINT_CPP = `cout << "[";\n  for (size_t i = 0; i < result.size(); ++i) {\n    cout << "[";\n    for (size_t j = 0; j < result[i].size(); ++j) {\n      cout << result[i][j];\n      if (j + 1 < result[i].size()) cout << ", ";\n    }\n    cout << "]";\n    if (i + 1 < result.size()) cout << ", ";\n  }\n  cout << "]" << endl;`;
const STRING_VECTOR_VECTOR_PRINT_CPP = `cout << "[";\n  for (size_t i = 0; i < result.size(); ++i) {\n    cout << "[";\n    for (size_t j = 0; j < result[i].size(); ++j) {\n      cout << "\\\"" << result[i][j] << "\\\"";\n      if (j + 1 < result[i].size()) cout << ", ";\n    }\n    cout << "]";\n    if (i + 1 < result.size()) cout << ", ";\n  }\n  cout << "]" << endl;`;

const TEMPLATES: Record<string, ProblemTemplate> = {
  "Two Sum": {
    kind: "function",
    names: { PYTHON: "two_sum", JAVASCRIPT: "twoSum", JAVA: "twoSum", "C++": "twoSum" },
    params: { PYTHON: "nums, target", JAVASCRIPT: "nums, target", JAVA: "int[] nums, int target", "C++": "vector<int> nums, int target" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int[] ", "C++": "vector<int> " },
    defaults: { PYTHON: "[]", JAVASCRIPT: "[]", JAVA: "new int[0]", "C++": "{}" },
    samples: {
      PYTHON: ["nums = [2, 7, 11, 15]", "target = 9"],
      JAVASCRIPT: ["const nums = [2, 7, 11, 15];", "const target = 9;"],
      JAVA: ["int[] nums = new int[]{2, 7, 11, 15};", "int target = 9;"],
      "C++": ["vector<int> nums{2, 7, 11, 15};", "int target = 9;"],
    },
    callArgs: { PYTHON: "nums, target", JAVASCRIPT: "nums, target", JAVA: "nums, target", "C++": "nums, target" },
    print: { JAVA: "System.out.println(Arrays.toString(result));", "C++": VECTOR_PRINT_CPP },
    comment: "Return the indices of the two values that sum to target.",
  },
  "Top K Frequent Elements": {
    kind: "function",
    names: { PYTHON: "top_k_frequent", JAVASCRIPT: "topKFrequent", JAVA: "topKFrequent", "C++": "topKFrequent" },
    params: { PYTHON: "nums, k", JAVASCRIPT: "nums, k", JAVA: "int[] nums, int k", "C++": "vector<int> nums, int k" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int[] ", "C++": "vector<int> " },
    defaults: { PYTHON: "[]", JAVASCRIPT: "[]", JAVA: "new int[0]", "C++": "{}" },
    samples: {
      PYTHON: ["nums = [1, 1, 1, 2, 2, 3]", "k = 2"],
      JAVASCRIPT: ["const nums = [1, 1, 1, 2, 2, 3];", "const k = 2;"],
      JAVA: ["int[] nums = new int[]{1, 1, 1, 2, 2, 3};", "int k = 2;"],
      "C++": ["vector<int> nums{1, 1, 1, 2, 2, 3};", "int k = 2;"],
    },
    callArgs: { PYTHON: "nums, k", JAVASCRIPT: "nums, k", JAVA: "nums, k", "C++": "nums, k" },
    print: { JAVA: "System.out.println(Arrays.toString(result));", "C++": VECTOR_PRINT_CPP },
    comment: "Return the k most frequent values.",
  },
  "Merge Intervals": {
    kind: "function",
    names: { PYTHON: "merge_intervals", JAVASCRIPT: "mergeIntervals", JAVA: "mergeIntervals", "C++": "mergeIntervals" },
    params: { PYTHON: "intervals", JAVASCRIPT: "intervals", JAVA: "int[][] intervals", "C++": "vector<vector<int>> intervals" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int[][] ", "C++": "vector<vector<int>> " },
    defaults: { PYTHON: "intervals", JAVASCRIPT: "intervals", JAVA: "intervals", "C++": "intervals" },
    samples: {
      PYTHON: ["intervals = [[1, 3], [2, 6], [8, 10], [15, 18]]"],
      JAVASCRIPT: ["const intervals = [[1, 3], [2, 6], [8, 10], [15, 18]];"],
      JAVA: ["int[][] intervals = new int[][]{{1, 3}, {2, 6}, {8, 10}, {15, 18}};"],
      "C++": ["vector<vector<int>> intervals{{1, 3}, {2, 6}, {8, 10}, {15, 18}};"],
    },
    callArgs: { PYTHON: "intervals", JAVASCRIPT: "intervals", JAVA: "intervals", "C++": "intervals" },
    print: { JAVA: "System.out.println(Arrays.deepToString(result));", "C++": VECTOR_VECTOR_PRINT_CPP },
    comment: "Merge all overlapping intervals.",
  },
  "Valid Parentheses": {
    kind: "function",
    names: { PYTHON: "is_valid", JAVASCRIPT: "isValid", JAVA: "isValid", "C++": "isValid" },
    params: { PYTHON: "s", JAVASCRIPT: "s", JAVA: "String s", "C++": "string s" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "boolean ", "C++": "bool " },
    defaults: { PYTHON: "False", JAVASCRIPT: "false", JAVA: "false", "C++": "false" },
    samples: {
      PYTHON: ['s = "()[]{}"'],
      JAVASCRIPT: ['const s = "()[]{}";'],
      JAVA: ['String s = "()[]{}";'],
      "C++": ['string s = "()[]{}";'],
    },
    callArgs: { PYTHON: "s", JAVASCRIPT: "s", JAVA: "s", "C++": "s" },
    print: { "C++": "cout << boolalpha << result << endl;" },
    comment: "Return true when every bracket is matched in order.",
  },
  "Design URL Shortener": {
    kind: "class",
    bodies: {
      PYTHON: `class URLShortener:
    def __init__(self):
        self.long_to_short = {}
        self.short_to_long = {}
        self.counter = 1

    def encode(self, long_url):
        # TODO: return a stable short key for this long URL
        raise NotImplementedError("TODO: implement this method")

    def decode(self, short_url):
        # TODO: return the original long URL for this short key
        raise NotImplementedError("TODO: implement this method")`,
      JAVASCRIPT: `class URLShortener {
  constructor() {
    this.longToShort = new Map();
    this.shortToLong = new Map();
    this.counter = 1;
  }

  encode(longUrl) {
    // TODO: return a stable short key for this long URL
    throw new Error("TODO: implement this method");
  }

  decode(shortUrl) {
    // TODO: return the original long URL for this short key
    throw new Error("TODO: implement this method");
  }
}`,
      JAVA: `import java.util.*;

public class Main {
  static class URLShortener {
    private final Map<String, String> longToShort = new HashMap<>();
    private final Map<String, String> shortToLong = new HashMap<>();
    private int counter = 1;

    String encode(String longUrl) {
      // TODO: return a stable short key for this long URL
      return "";
    }

    String decode(String shortUrl) {
      // TODO: return the original long URL for this short key
      return "";
    }
  }
}`,
      "C++": `#include <iostream>
#include <string>
#include <unordered_map>
using namespace std;

class URLShortener {
 public:
  string encode(const string& longUrl) {
    // TODO: return a stable short key for this long URL
    return "";
  }

  string decode(const string& shortUrl) {
    // TODO: return the original long URL for this short key
    return "";
  }

 private:
  unordered_map<string, string> longToShort;
  unordered_map<string, string> shortToLong;
  int counter = 1;
};`,
    },
  },
  "Best Time to Buy and Sell Stock": {
    kind: "function",
    names: { PYTHON: "max_profit", JAVASCRIPT: "maxProfit", JAVA: "maxProfit", "C++": "maxProfit" },
    params: { PYTHON: "prices", JAVASCRIPT: "prices", JAVA: "int[] prices", "C++": "vector<int> prices" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "0", JAVASCRIPT: "0", JAVA: "0", "C++": "0" },
    samples: {
      PYTHON: ["prices = [7, 1, 5, 3, 6, 4]"],
      JAVASCRIPT: ["const prices = [7, 1, 5, 3, 6, 4];"],
      JAVA: ["int[] prices = new int[]{7, 1, 5, 3, 6, 4};"],
      "C++": ["vector<int> prices{7, 1, 5, 3, 6, 4};"],
    },
    callArgs: { PYTHON: "prices", JAVASCRIPT: "prices", JAVA: "prices", "C++": "prices" },
    comment: "Return the best profit from one buy and one sell.",
  },
  "Contains Duplicate": {
    kind: "function",
    names: { PYTHON: "contains_duplicate", JAVASCRIPT: "containsDuplicate", JAVA: "containsDuplicate", "C++": "containsDuplicate" },
    params: { PYTHON: "nums", JAVASCRIPT: "nums", JAVA: "int[] nums", "C++": "vector<int> nums" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "boolean ", "C++": "bool " },
    defaults: { PYTHON: "False", JAVASCRIPT: "false", JAVA: "false", "C++": "false" },
    samples: {
      PYTHON: ["nums = [1, 2, 3, 1]"],
      JAVASCRIPT: ["const nums = [1, 2, 3, 1];"],
      JAVA: ["int[] nums = new int[]{1, 2, 3, 1};"],
      "C++": ["vector<int> nums{1, 2, 3, 1};"],
    },
    callArgs: { PYTHON: "nums", JAVASCRIPT: "nums", JAVA: "nums", "C++": "nums" },
    print: { "C++": "cout << boolalpha << result << endl;" },
    comment: "Return true if any value appears more than once.",
  },
  "Binary Search": {
    kind: "function",
    names: { PYTHON: "binary_search", JAVASCRIPT: "search", JAVA: "search", "C++": "search" },
    params: { PYTHON: "nums, target", JAVASCRIPT: "nums, target", JAVA: "int[] nums, int target", "C++": "vector<int> nums, int target" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "-1", JAVASCRIPT: "-1", JAVA: "-1", "C++": "-1" },
    samples: {
      PYTHON: ["nums = [-1, 0, 3, 5, 9, 12]", "target = 9"],
      JAVASCRIPT: ["const nums = [-1, 0, 3, 5, 9, 12];", "const target = 9;"],
      JAVA: ["int[] nums = new int[]{-1, 0, 3, 5, 9, 12};", "int target = 9;"],
      "C++": ["vector<int> nums{-1, 0, 3, 5, 9, 12};", "int target = 9;"],
    },
    callArgs: { PYTHON: "nums, target", JAVASCRIPT: "nums, target", JAVA: "nums, target", "C++": "nums, target" },
    comment: "Return the index of target in a sorted array, or -1.",
  },
  "Reverse Linked List": {
    kind: "function",
    names: { PYTHON: "reverse_list", JAVASCRIPT: "reverseList", JAVA: "reverseList", "C++": "reverseList" },
    params: { PYTHON: "head", JAVASCRIPT: "head", JAVA: "ListNode head", "C++": "ListNode* head" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "ListNode ", "C++": "ListNode* " },
    defaults: { PYTHON: "head", JAVASCRIPT: "head", JAVA: "head", "C++": "head" },
    helpers: LINKED_HELPERS,
    samples: {
      PYTHON: ["head = build_list([1, 2, 3, 4, 5])"],
      JAVASCRIPT: ["const head = buildList([1, 2, 3, 4, 5]);"],
      JAVA: ["ListNode head = buildList(new int[]{1, 2, 3, 4, 5});"],
      "C++": ["ListNode* head = buildList(vector<int>{1, 2, 3, 4, 5});"],
    },
    callArgs: { PYTHON: "head", JAVASCRIPT: "head", JAVA: "head", "C++": "head" },
    print: {
      PYTHON: "print(list_to_array(result))",
      JAVASCRIPT: "console.log(JSON.stringify(listToArray(result)));",
      JAVA: "System.out.println(listToString(result));",
      "C++": "cout << listToVector(result).size() << endl;",
    },
    comment: "Reverse the singly linked list and return the new head.",
  },
  "Maximum Depth of Binary Tree": {
    kind: "function",
    names: { PYTHON: "max_depth", JAVASCRIPT: "maxDepth", JAVA: "maxDepth", "C++": "maxDepth" },
    params: { PYTHON: "root", JAVASCRIPT: "root", JAVA: "TreeNode root", "C++": "TreeNode* root" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "0", JAVASCRIPT: "0", JAVA: "0", "C++": "0" },
    helpers: TREE_HELPERS,
    samples: {
      PYTHON: ["root = build_tree([3, 9, 20, None, None, 15, 7])"],
      JAVASCRIPT: ["const root = buildTree([3, 9, 20, null, null, 15, 7]);"],
      JAVA: ["TreeNode root = buildTree(new Integer[]{3, 9, 20, null, null, 15, 7});"],
      "C++": ["vector<int> values{3, 9, 20, 0, 0, 15, 7};", "vector<bool> present{true, true, true, false, false, true, true};", "TreeNode* root = buildTree(values, present);"],
    },
    callArgs: { PYTHON: "root", JAVASCRIPT: "root", JAVA: "root", "C++": "root" },
    comment: "Return the maximum depth of the binary tree.",
  },
  "Product of Array Except Self": {
    kind: "function",
    names: { PYTHON: "product_except_self", JAVASCRIPT: "productExceptSelf", JAVA: "productExceptSelf", "C++": "productExceptSelf" },
    params: { PYTHON: "nums", JAVASCRIPT: "nums", JAVA: "int[] nums", "C++": "vector<int> nums" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int[] ", "C++": "vector<int> " },
    defaults: { PYTHON: "nums", JAVASCRIPT: "nums", JAVA: "nums", "C++": "nums" },
    samples: {
      PYTHON: ["nums = [1, 2, 3, 4]"],
      JAVASCRIPT: ["const nums = [1, 2, 3, 4];"],
      JAVA: ["int[] nums = new int[]{1, 2, 3, 4};"],
      "C++": ["vector<int> nums{1, 2, 3, 4};"],
    },
    callArgs: { PYTHON: "nums", JAVASCRIPT: "nums", JAVA: "nums", "C++": "nums" },
    print: { JAVA: "System.out.println(Arrays.toString(result));", "C++": VECTOR_PRINT_CPP },
    comment: "Return the product of every value except the current index.",
  },
  "Longest Substring Without Repeating Characters": {
    kind: "function",
    names: { PYTHON: "length_of_longest_substring", JAVASCRIPT: "lengthOfLongestSubstring", JAVA: "lengthOfLongestSubstring", "C++": "lengthOfLongestSubstring" },
    params: { PYTHON: "s", JAVASCRIPT: "s", JAVA: "String s", "C++": "string s" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "0", JAVASCRIPT: "0", JAVA: "0", "C++": "0" },
    samples: {
      PYTHON: ['s = "abcabcbb"'],
      JAVASCRIPT: ['const s = "abcabcbb";'],
      JAVA: ['String s = "abcabcbb";'],
      "C++": ['string s = "abcabcbb";'],
    },
    callArgs: { PYTHON: "s", JAVASCRIPT: "s", JAVA: "s", "C++": "s" },
    comment: "Return the longest substring length with unique characters.",
  },
  "Group Anagrams": {
    kind: "function",
    names: { PYTHON: "group_anagrams", JAVASCRIPT: "groupAnagrams", JAVA: "groupAnagrams", "C++": "groupAnagrams" },
    params: { PYTHON: "strs", JAVASCRIPT: "strs", JAVA: "String[] strs", "C++": "vector<string> strs" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "List<List<String>> ", "C++": "vector<vector<string>> " },
    defaults: { PYTHON: "[]", JAVASCRIPT: "[]", JAVA: "new ArrayList<>()", "C++": "{}" },
    samples: {
      PYTHON: ['strs = ["eat", "tea", "tan", "ate", "nat", "bat"]'],
      JAVASCRIPT: ['const strs = ["eat", "tea", "tan", "ate", "nat", "bat"];'],
      JAVA: ['String[] strs = new String[]{"eat", "tea", "tan", "ate", "nat", "bat"};'],
      "C++": ['vector<string> strs{"eat", "tea", "tan", "ate", "nat", "bat"};'],
    },
    callArgs: { PYTHON: "strs", JAVASCRIPT: "strs", JAVA: "strs", "C++": "strs" },
    print: { "C++": STRING_VECTOR_VECTOR_PRINT_CPP },
    comment: "Group strings that are anagrams of one another.",
  },
  "3Sum": {
    kind: "function",
    names: { PYTHON: "three_sum", JAVASCRIPT: "threeSum", JAVA: "threeSum", "C++": "threeSum" },
    params: { PYTHON: "nums", JAVASCRIPT: "nums", JAVA: "int[] nums", "C++": "vector<int> nums" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "List<List<Integer>> ", "C++": "vector<vector<int>> " },
    defaults: { PYTHON: "[]", JAVASCRIPT: "[]", JAVA: "new ArrayList<>()", "C++": "{}" },
    samples: {
      PYTHON: ["nums = [-1, 0, 1, 2, -1, -4]"],
      JAVASCRIPT: ["const nums = [-1, 0, 1, 2, -1, -4];"],
      JAVA: ["int[] nums = new int[]{-1, 0, 1, 2, -1, -4};"],
      "C++": ["vector<int> nums{-1, 0, 1, 2, -1, -4};"],
    },
    callArgs: { PYTHON: "nums", JAVASCRIPT: "nums", JAVA: "nums", "C++": "nums" },
    print: { "C++": VECTOR_VECTOR_PRINT_CPP },
    comment: "Return all unique triplets that sum to zero.",
  },
  "Container With Most Water": {
    kind: "function",
    names: { PYTHON: "max_area", JAVASCRIPT: "maxArea", JAVA: "maxArea", "C++": "maxArea" },
    params: { PYTHON: "height", JAVASCRIPT: "height", JAVA: "int[] height", "C++": "vector<int> height" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "0", JAVASCRIPT: "0", JAVA: "0", "C++": "0" },
    samples: {
      PYTHON: ["height = [1, 8, 6, 2, 5, 4, 8, 3, 7]"],
      JAVASCRIPT: ["const height = [1, 8, 6, 2, 5, 4, 8, 3, 7];"],
      JAVA: ["int[] height = new int[]{1, 8, 6, 2, 5, 4, 8, 3, 7};"],
      "C++": ["vector<int> height{1, 8, 6, 2, 5, 4, 8, 3, 7};"],
    },
    callArgs: { PYTHON: "height", JAVASCRIPT: "height", JAVA: "height", "C++": "height" },
    comment: "Return the maximum area between two vertical lines.",
  },
  "Search in Rotated Sorted Array": {
    kind: "function",
    names: { PYTHON: "search_rotated", JAVASCRIPT: "search", JAVA: "search", "C++": "search" },
    params: { PYTHON: "nums, target", JAVASCRIPT: "nums, target", JAVA: "int[] nums, int target", "C++": "vector<int> nums, int target" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "-1", JAVASCRIPT: "-1", JAVA: "-1", "C++": "-1" },
    samples: {
      PYTHON: ["nums = [4, 5, 6, 7, 0, 1, 2]", "target = 0"],
      JAVASCRIPT: ["const nums = [4, 5, 6, 7, 0, 1, 2];", "const target = 0;"],
      JAVA: ["int[] nums = new int[]{4, 5, 6, 7, 0, 1, 2};", "int target = 0;"],
      "C++": ["vector<int> nums{4, 5, 6, 7, 0, 1, 2};", "int target = 0;"],
    },
    callArgs: { PYTHON: "nums, target", JAVASCRIPT: "nums, target", JAVA: "nums, target", "C++": "nums, target" },
    comment: "Search for target in a rotated sorted array.",
  },
  "Find Minimum in Rotated Sorted Array": {
    kind: "function",
    names: { PYTHON: "find_min", JAVASCRIPT: "findMin", JAVA: "findMin", "C++": "findMin" },
    params: { PYTHON: "nums", JAVASCRIPT: "nums", JAVA: "int[] nums", "C++": "vector<int> nums" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "0", JAVASCRIPT: "0", JAVA: "0", "C++": "0" },
    samples: {
      PYTHON: ["nums = [3, 4, 5, 1, 2]"],
      JAVASCRIPT: ["const nums = [3, 4, 5, 1, 2];"],
      JAVA: ["int[] nums = new int[]{3, 4, 5, 1, 2};"],
      "C++": ["vector<int> nums{3, 4, 5, 1, 2};"],
    },
    callArgs: { PYTHON: "nums", JAVASCRIPT: "nums", JAVA: "nums", "C++": "nums" },
    comment: "Return the minimum value in the rotated sorted array.",
  },
  "Insert Interval": {
    kind: "function",
    names: { PYTHON: "insert_interval", JAVASCRIPT: "insertInterval", JAVA: "insertInterval", "C++": "insertInterval" },
    params: { PYTHON: "intervals, new_interval", JAVASCRIPT: "intervals, newInterval", JAVA: "int[][] intervals, int[] newInterval", "C++": "vector<vector<int>> intervals, vector<int> newInterval" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int[][] ", "C++": "vector<vector<int>> " },
    defaults: { PYTHON: "intervals", JAVASCRIPT: "intervals", JAVA: "intervals", "C++": "intervals" },
    samples: {
      PYTHON: ["intervals = [[1, 3], [6, 9]]", "new_interval = [2, 5]"],
      JAVASCRIPT: ["const intervals = [[1, 3], [6, 9]];", "const newInterval = [2, 5];"],
      JAVA: ["int[][] intervals = new int[][]{{1, 3}, {6, 9}};", "int[] newInterval = new int[]{2, 5};"],
      "C++": ["vector<vector<int>> intervals{{1, 3}, {6, 9}};", "vector<int> newInterval{2, 5};"],
    },
    callArgs: { PYTHON: "intervals, new_interval", JAVASCRIPT: "intervals, newInterval", JAVA: "intervals, newInterval", "C++": "intervals, newInterval" },
    print: { JAVA: "System.out.println(Arrays.deepToString(result));", "C++": VECTOR_VECTOR_PRINT_CPP },
    comment: "Insert a new interval and merge overlaps.",
  },
  "Number of Islands": {
    kind: "function",
    names: { PYTHON: "num_islands", JAVASCRIPT: "numIslands", JAVA: "numIslands", "C++": "numIslands" },
    params: { PYTHON: "grid", JAVASCRIPT: "grid", JAVA: "char[][] grid", "C++": "vector<vector<char>> grid" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "0", JAVASCRIPT: "0", JAVA: "0", "C++": "0" },
    samples: {
      PYTHON: ['grid = [["1","1","0"],["1","0","0"],["0","0","1"]]'],
      JAVASCRIPT: ['const grid = [["1","1","0"],["1","0","0"],["0","0","1"]];'],
      JAVA: ['char[][] grid = new char[][]{{\'1\',\'1\',\'0\'},{\'1\',\'0\',\'0\'},{\'0\',\'0\',\'1\'}};'],
      "C++": ["vector<vector<char>> grid{{'1','1','0'},{'1','0','0'},{'0','0','1'}};"],
    },
    callArgs: { PYTHON: "grid", JAVASCRIPT: "grid", JAVA: "grid", "C++": "grid" },
    comment: "Count connected islands in the grid.",
  },
  "Clone Graph": {
    kind: "function",
    names: { PYTHON: "clone_graph", JAVASCRIPT: "cloneGraph", JAVA: "cloneGraph", "C++": "cloneGraph" },
    params: { PYTHON: "adjacency", JAVASCRIPT: "adjacency", JAVA: "int[][] adjacency", "C++": "vector<vector<int>> adjacency" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int[][] ", "C++": "vector<vector<int>> " },
    defaults: { PYTHON: "adjacency", JAVASCRIPT: "adjacency", JAVA: "adjacency", "C++": "adjacency" },
    samples: {
      PYTHON: ["adjacency = [[2, 4], [1, 3], [2, 4], [1, 3]]"],
      JAVASCRIPT: ["const adjacency = [[2, 4], [1, 3], [2, 4], [1, 3]];"],
      JAVA: ["int[][] adjacency = new int[][]{{2, 4}, {1, 3}, {2, 4}, {1, 3}};"],
      "C++": ["vector<vector<int>> adjacency{{2, 4}, {1, 3}, {2, 4}, {1, 3}};"],
    },
    callArgs: { PYTHON: "adjacency", JAVASCRIPT: "adjacency", JAVA: "adjacency", "C++": "adjacency" },
    print: { JAVA: "System.out.println(Arrays.deepToString(result));", "C++": VECTOR_VECTOR_PRINT_CPP },
    comment: "Return a deep-copied adjacency representation of the graph.",
  },
  "Course Schedule": {
    kind: "function",
    names: { PYTHON: "can_finish", JAVASCRIPT: "canFinish", JAVA: "canFinish", "C++": "canFinish" },
    params: { PYTHON: "num_courses, prerequisites", JAVASCRIPT: "numCourses, prerequisites", JAVA: "int numCourses, int[][] prerequisites", "C++": "int numCourses, vector<vector<int>> prerequisites" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "boolean ", "C++": "bool " },
    defaults: { PYTHON: "False", JAVASCRIPT: "false", JAVA: "false", "C++": "false" },
    samples: {
      PYTHON: ["num_courses = 2", "prerequisites = [[1, 0]]"],
      JAVASCRIPT: ["const numCourses = 2;", "const prerequisites = [[1, 0]];"],
      JAVA: ["int numCourses = 2;", "int[][] prerequisites = new int[][]{{1, 0}};"],
      "C++": ["int numCourses = 2;", "vector<vector<int>> prerequisites{{1, 0}};"],
    },
    callArgs: { PYTHON: "num_courses, prerequisites", JAVASCRIPT: "numCourses, prerequisites", JAVA: "numCourses, prerequisites", "C++": "numCourses, prerequisites" },
    print: { "C++": "cout << boolalpha << result << endl;" },
    comment: "Return true if all courses can be completed.",
  },
  "Kth Largest Element in an Array": {
    kind: "function",
    names: { PYTHON: "find_kth_largest", JAVASCRIPT: "findKthLargest", JAVA: "findKthLargest", "C++": "findKthLargest" },
    params: { PYTHON: "nums, k", JAVASCRIPT: "nums, k", JAVA: "int[] nums, int k", "C++": "vector<int> nums, int k" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "0", JAVASCRIPT: "0", JAVA: "0", "C++": "0" },
    samples: {
      PYTHON: ["nums = [3, 2, 1, 5, 6, 4]", "k = 2"],
      JAVASCRIPT: ["const nums = [3, 2, 1, 5, 6, 4];", "const k = 2;"],
      JAVA: ["int[] nums = new int[]{3, 2, 1, 5, 6, 4};", "int k = 2;"],
      "C++": ["vector<int> nums{3, 2, 1, 5, 6, 4};", "int k = 2;"],
    },
    callArgs: { PYTHON: "nums, k", JAVASCRIPT: "nums, k", JAVA: "nums, k", "C++": "nums, k" },
    comment: "Return the kth largest value in the array.",
  },
  "Meeting Rooms II": {
    kind: "function",
    names: { PYTHON: "min_meeting_rooms", JAVASCRIPT: "minMeetingRooms", JAVA: "minMeetingRooms", "C++": "minMeetingRooms" },
    params: { PYTHON: "intervals", JAVASCRIPT: "intervals", JAVA: "int[][] intervals", "C++": "vector<vector<int>> intervals" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "0", JAVASCRIPT: "0", JAVA: "0", "C++": "0" },
    samples: {
      PYTHON: ["intervals = [[0, 30], [5, 10], [15, 20]]"],
      JAVASCRIPT: ["const intervals = [[0, 30], [5, 10], [15, 20]];"],
      JAVA: ["int[][] intervals = new int[][]{{0, 30}, {5, 10}, {15, 20}};"],
      "C++": ["vector<vector<int>> intervals{{0, 30}, {5, 10}, {15, 20}};"],
    },
    callArgs: { PYTHON: "intervals", JAVASCRIPT: "intervals", JAVA: "intervals", "C++": "intervals" },
    comment: "Return the minimum number of rooms required.",
  },
  "Linked List Cycle": {
    kind: "function",
    names: { PYTHON: "has_cycle", JAVASCRIPT: "hasCycle", JAVA: "hasCycle", "C++": "hasCycle" },
    params: { PYTHON: "head", JAVASCRIPT: "head", JAVA: "ListNode head", "C++": "ListNode* head" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "boolean ", "C++": "bool " },
    defaults: { PYTHON: "False", JAVASCRIPT: "false", JAVA: "false", "C++": "false" },
    helpers: LINKED_HELPERS,
    samples: {
      PYTHON: ["head = build_list([3, 2, 0, -4])", "head = attach_cycle(head, 1)"],
      JAVASCRIPT: ["let head = buildList([3, 2, 0, -4]);", "head = attachCycle(head, 1);"],
      JAVA: ["ListNode head = buildList(new int[]{3, 2, 0, -4});", "head = attachCycle(head, 1);"],
      "C++": ["ListNode* head = buildList(vector<int>{3, 2, 0, -4});", "head = attachCycle(head, 1);"],
    },
    callArgs: { PYTHON: "head", JAVASCRIPT: "head", JAVA: "head", "C++": "head" },
    print: { "C++": "cout << boolalpha << result << endl;" },
    comment: "Return true if the linked list contains a cycle.",
  },
  "Remove Nth Node From End of List": {
    kind: "function",
    names: { PYTHON: "remove_nth_from_end", JAVASCRIPT: "removeNthFromEnd", JAVA: "removeNthFromEnd", "C++": "removeNthFromEnd" },
    params: { PYTHON: "head, n", JAVASCRIPT: "head, n", JAVA: "ListNode head, int n", "C++": "ListNode* head, int n" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "ListNode ", "C++": "ListNode* " },
    defaults: { PYTHON: "head", JAVASCRIPT: "head", JAVA: "head", "C++": "head" },
    helpers: LINKED_HELPERS,
    samples: {
      PYTHON: ["head = build_list([1, 2, 3, 4, 5])", "n = 2"],
      JAVASCRIPT: ["const head = buildList([1, 2, 3, 4, 5]);", "const n = 2;"],
      JAVA: ["ListNode head = buildList(new int[]{1, 2, 3, 4, 5});", "int n = 2;"],
      "C++": ["ListNode* head = buildList(vector<int>{1, 2, 3, 4, 5});", "int n = 2;"],
    },
    callArgs: { PYTHON: "head, n", JAVASCRIPT: "head, n", JAVA: "head, n", "C++": "head, n" },
    print: {
      PYTHON: "print(list_to_array(result))",
      JAVASCRIPT: "console.log(JSON.stringify(listToArray(result)));",
      JAVA: "System.out.println(listToString(result));",
      "C++": "cout << listToVector(result).size() << endl;",
    },
    comment: "Remove the nth node from the end of the list.",
  },
  "LRU Cache": {
    kind: "class",
    bodies: {
      PYTHON: `from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.cache = OrderedDict()

    def get(self, key):
        # TODO: return the cached value or -1 when missing
        return -1

    def put(self, key, value):
        # TODO: insert or update the value and evict the least recently used key
        pass`,
      JAVASCRIPT: `class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.cache = new Map();
  }

  get(key) {
    // TODO: return the cached value or -1 when missing
    return -1;
  }

  put(key, value) {
    // TODO: insert or update the value and evict the least recently used key
  }
}`,
      JAVA: `import java.util.*;

public class Main {
  static class LRUCache extends LinkedHashMap<Integer, Integer> {
    private final int capacity;

    LRUCache(int capacity) {
      super(capacity, 0.75f, true);
      this.capacity = capacity;
    }

    public int get(int key) {
      // TODO: return the cached value or -1 when missing
      return -1;
    }

    public void put(int key, int value) {
      // TODO: insert or update the value and evict the least recently used key
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<Integer, Integer> eldest) {
      return false;
    }
  }
}`,
      "C++": `#include <iostream>
#include <list>
#include <unordered_map>
using namespace std;

class LRUCache {
 public:
  explicit LRUCache(int capacity) : capacity_(capacity) {}

  int get(int key) {
    // TODO: return the cached value or -1 when missing
    return -1;
  }

  void put(int key, int value) {
    // TODO: insert or update the value and evict the least recently used key
  }

 private:
  void touch(int key) {
    // TODO: move the accessed key to the front of the usage order
  }

  int capacity_;
  list<int> order_;
  unordered_map<int, pair<int, list<int>::iterator>> cache_;
};`,
    },
  },
  "Binary Tree Level Order Traversal": {
    kind: "function",
    names: { PYTHON: "level_order", JAVASCRIPT: "levelOrder", JAVA: "levelOrder", "C++": "levelOrder" },
    params: { PYTHON: "root", JAVASCRIPT: "root", JAVA: "TreeNode root", "C++": "TreeNode* root" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "List<List<Integer>> ", "C++": "vector<vector<int>> " },
    defaults: { PYTHON: "[]", JAVASCRIPT: "[]", JAVA: "new ArrayList<>()", "C++": "{}" },
    helpers: TREE_HELPERS,
    samples: {
      PYTHON: ["root = build_tree([3, 9, 20, None, None, 15, 7])"],
      JAVASCRIPT: ["const root = buildTree([3, 9, 20, null, null, 15, 7]);"],
      JAVA: ["TreeNode root = buildTree(new Integer[]{3, 9, 20, null, null, 15, 7});"],
      "C++": ["vector<int> values{3, 9, 20, 0, 0, 15, 7};", "vector<bool> present{true, true, true, false, false, true, true};", "TreeNode* root = buildTree(values, present);"],
    },
    callArgs: { PYTHON: "root", JAVASCRIPT: "root", JAVA: "root", "C++": "root" },
    print: { "C++": VECTOR_VECTOR_PRINT_CPP },
    comment: "Return the tree values level by level.",
  },
  "Validate Binary Search Tree": {
    kind: "function",
    names: { PYTHON: "is_valid_bst", JAVASCRIPT: "isValidBST", JAVA: "isValidBST", "C++": "isValidBST" },
    params: { PYTHON: "root", JAVASCRIPT: "root", JAVA: "TreeNode root", "C++": "TreeNode* root" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "boolean ", "C++": "bool " },
    defaults: { PYTHON: "False", JAVASCRIPT: "false", JAVA: "false", "C++": "false" },
    helpers: TREE_HELPERS,
    samples: {
      PYTHON: ["root = build_tree([2, 1, 3])"],
      JAVASCRIPT: ["const root = buildTree([2, 1, 3]);"],
      JAVA: ["TreeNode root = buildTree(new Integer[]{2, 1, 3});"],
      "C++": ["vector<int> values{2, 1, 3};", "vector<bool> present{true, true, true};", "TreeNode* root = buildTree(values, present);"],
    },
    callArgs: { PYTHON: "root", JAVASCRIPT: "root", JAVA: "root", "C++": "root" },
    print: { "C++": "cout << boolalpha << result << endl;" },
    comment: "Return true if the tree is a valid BST.",
  },
  "Lowest Common Ancestor of a Binary Search Tree": {
    kind: "function",
    names: { PYTHON: "lowest_common_ancestor", JAVASCRIPT: "lowestCommonAncestor", JAVA: "lowestCommonAncestor", "C++": "lowestCommonAncestor" },
    params: { PYTHON: "root, p, q", JAVASCRIPT: "root, p, q", JAVA: "TreeNode root, TreeNode p, TreeNode q", "C++": "TreeNode* root, TreeNode* p, TreeNode* q" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "TreeNode ", "C++": "TreeNode* " },
    defaults: { PYTHON: "root", JAVASCRIPT: "root", JAVA: "root", "C++": "root" },
    helpers: TREE_HELPERS,
    samples: {
      PYTHON: ["root = build_tree([6, 2, 8, 0, 4, 7, 9, None, None, 3, 5])", "p = find_node(root, 2)", "q = find_node(root, 8)"],
      JAVASCRIPT: ["const root = buildTree([6, 2, 8, 0, 4, 7, 9, null, null, 3, 5]);", "const p = findNode(root, 2);", "const q = findNode(root, 8);"],
      JAVA: ["TreeNode root = buildTree(new Integer[]{6, 2, 8, 0, 4, 7, 9, null, null, 3, 5});", "TreeNode p = findNode(root, 2);", "TreeNode q = findNode(root, 8);"],
      "C++": ["vector<int> values{6, 2, 8, 0, 4, 7, 9, 0, 0, 3, 5};", "vector<bool> present{true, true, true, true, true, true, true, false, false, true, true};", "TreeNode* root = buildTree(values, present);", "TreeNode* p = findNode(root, 2);", "TreeNode* q = findNode(root, 8);"],
    },
    callArgs: { PYTHON: "root, p, q", JAVASCRIPT: "root, p, q", JAVA: "root, p, q", "C++": "root, p, q" },
    print: {
      PYTHON: "print(result.val if result else None)",
      JAVASCRIPT: "console.log(result ? result.val : null);",
      JAVA: "System.out.println(result != null ? result.val : null);",
      "C++": "cout << (result ? result->val : -1) << endl;",
    },
    comment: "Return the lowest common ancestor node in the BST.",
  },
  "Word Break": {
    kind: "function",
    names: { PYTHON: "word_break", JAVASCRIPT: "wordBreak", JAVA: "wordBreak", "C++": "wordBreak" },
    params: { PYTHON: "s, word_dict", JAVASCRIPT: "s, wordDict", JAVA: "String s, List<String> wordDict", "C++": "string s, vector<string> wordDict" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "boolean ", "C++": "bool " },
    defaults: { PYTHON: "False", JAVASCRIPT: "false", JAVA: "false", "C++": "false" },
    samples: {
      PYTHON: ['s = "leetcode"', 'word_dict = ["leet", "code"]'],
      JAVASCRIPT: ['const s = "leetcode";', 'const wordDict = ["leet", "code"];'],
      JAVA: ['String s = "leetcode";', 'List<String> wordDict = Arrays.asList("leet", "code");'],
      "C++": ['string s = "leetcode";', 'vector<string> wordDict{"leet", "code"};'],
    },
    callArgs: { PYTHON: "s, word_dict", JAVASCRIPT: "s, wordDict", JAVA: "s, wordDict", "C++": "s, wordDict" },
    print: { "C++": "cout << boolalpha << result << endl;" },
    comment: "Return true if the string can be segmented into dictionary words.",
  },
  "Coin Change": {
    kind: "function",
    names: { PYTHON: "coin_change", JAVASCRIPT: "coinChange", JAVA: "coinChange", "C++": "coinChange" },
    params: { PYTHON: "coins, amount", JAVASCRIPT: "coins, amount", JAVA: "int[] coins, int amount", "C++": "vector<int> coins, int amount" },
    returns: { PYTHON: "", JAVASCRIPT: "", JAVA: "int ", "C++": "int " },
    defaults: { PYTHON: "-1", JAVASCRIPT: "-1", JAVA: "-1", "C++": "-1" },
    samples: {
      PYTHON: ["coins = [1, 2, 5]", "amount = 11"],
      JAVASCRIPT: ["const coins = [1, 2, 5];", "const amount = 11;"],
      JAVA: ["int[] coins = new int[]{1, 2, 5};", "int amount = 11;"],
      "C++": ["vector<int> coins{1, 2, 5};", "int amount = 11;"],
    },
    callArgs: { PYTHON: "coins, amount", JAVASCRIPT: "coins, amount", JAVA: "coins, amount", "C++": "coins, amount" },
    comment: "Return the minimum number of coins needed to reach the amount.",
  },
};

function renderFunctionTemplate(language: SupportedEditorLanguage, template: FunctionTemplate) {
  const fnName = template.names[language];
  const params = template.params[language];
  const returnPrefix = template.returns[language];
  const helperBlock = template.helpers?.[language] ?? "";
  const todoBody = TODO_BODIES[language];

  if (language === "PYTHON") {
    return `${helperBlock}def ${fnName}(${params}):\n    # ${template.comment}\n    ${todoBody}`;
  }

  if (language === "JAVASCRIPT") {
    return `${helperBlock}function ${fnName}(${params}) {\n  // ${template.comment}\n  ${todoBody}\n}`;
  }

  if (language === "JAVA") {
    return `import java.util.*;\n\npublic class Main {\n${helperBlock}  public static ${returnPrefix}${fnName}(${params}) {\n    // ${template.comment}\n    ${todoBody}\n  }\n}`;
  }

  return `#include <iostream>\n#include <vector>\n#include <string>\n#include <queue>\n#include <unordered_map>\n#include <list>\n#include <stdexcept>\nusing namespace std;\n\n${helperBlock}${returnPrefix}${fnName}(${params}) {\n  // ${template.comment}\n  ${todoBody}\n}`;
}

export function getStarterCode(language: string | null | undefined, questionTitle: string) {
  const normalized = normalizeLanguage(language);
  const template = TEMPLATES[questionTitle];

  if (template?.kind === "class") {
    return template.bodies[normalized];
  }

  if (template?.kind === "function") {
    return renderFunctionTemplate(normalized, template);
  }

  switch (normalized) {
    case "JAVASCRIPT":
      return `function solve(input) {\n  // ${questionTitle}\n  throw new Error("TODO: implement this function");\n}`;
    case "JAVA":
      return `import java.util.*;\n\npublic class Main {\n  public static Object solve(Object input) {\n    // ${questionTitle}\n    throw new UnsupportedOperationException("TODO: implement this function");\n  }\n}`;
    case "C++":
      return `#include <iostream>\n#include <vector>\n#include <stdexcept>\nusing namespace std;\n\nvector<int> solve(vector<int> input) {\n  // ${questionTitle}\n  throw runtime_error("TODO: implement this function");\n}`;
    case "PYTHON":
    default:
      return `def solve(input):\n    # ${questionTitle}\n    raise NotImplementedError("TODO: implement this function")`;
  }
}

export function toMonacoLanguage(language: string | null | undefined) {
  switch (normalizeLanguage(language)) {
    case "JAVASCRIPT":
      return "javascript";
    case "JAVA":
      return "java";
    case "C++":
      return "cpp";
    case "PYTHON":
    default:
      return "python";
  }
}

export function normalizeLanguage(language: string | null | undefined): SupportedEditorLanguage {
  const normalized = (language ?? "PYTHON").trim().toUpperCase();
  if (normalized === "JAVASCRIPT") return "JAVASCRIPT";
  if (normalized === "JAVA") return "JAVA";
  if (normalized === "C++" || normalized === "CPP") return "C++";
  return "PYTHON";
}

export function isRunnableLanguage(language: string | null | undefined) {
  const normalized = normalizeLanguage(language);
  return normalized === "PYTHON" || normalized === "JAVASCRIPT" || normalized === "C++";
}

