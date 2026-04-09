const CODING_PROBLEM_DETAILS: Record<string, string> = {
  "Two Sum": `Given an integer array nums and an integer target, return the indices of two distinct values whose sum is exactly target.

You may assume there is exactly one valid answer. The same array element cannot be used twice, and the order of the returned indices does not matter.

Example 1:
nums = [2, 7, 11, 15], target = 9
Output: [0, 1]
Explanation: nums[0] + nums[1] = 9.

Example 2:
nums = [3, 2, 4], target = 6
Output: [1, 2]

Example 3:
nums = [3, 3], target = 6
Output: [0, 1]

Constraints:
- 2 <= nums.length <= 10^4
- -10^9 <= nums[i] <= 10^9
- -10^9 <= target <= 10^9
- Exactly one valid pair exists.`,
  "Merge Intervals": `Given a list of closed intervals, merge every overlapping interval and return a new list that covers the same ranges without overlap.

Two intervals overlap when the start of one falls inside the other interval's covered range. The output may be returned in ascending order of start time.

Example 1:
intervals = [[1,3],[2,6],[8,10],[15,18]]
Output: [[1,6],[8,10],[15,18]]

Example 2:
intervals = [[1,4],[4,5]]
Output: [[1,5]]
Explanation: touching endpoints should still merge into a single interval.

Constraints:
- 1 <= intervals.length <= 10^4
- intervals[i].length == 2
- 0 <= start_i <= end_i <= 10^4`,
  "Top K Frequent Elements": `Given an integer array nums and an integer k, return the k values that appear most often in the array.

The answer can be returned in any order. Your solution should be better than sorting the entire array by frequency when the input is large.

Example 1:
nums = [1,1,1,2,2,3], k = 2
Output: [1,2]

Example 2:
nums = [1], k = 1
Output: [1]

Example 3:
nums = [4,4,4,6,6,7,7,7,7], k = 2
Output: [7,4]

Constraints:
- 1 <= nums.length <= 10^5
- -10^4 <= nums[i] <= 10^4
- 1 <= k <= number of distinct values in nums
- The result is guaranteed to be unique.`,
};

const SYSTEM_DESIGN_DETAILS: Record<string, string> = {
  "Design URL Shortener": `Design a URL shortening service that can create short links and redirect visitors to the original destination at internet scale.

Your design should cover the major product requirements, the core APIs, data model, read and write path, scaling strategy, and reliability tradeoffs.

Discussion prompts:
- How do clients create a short URL and how do redirects work?
- What latency and availability targets matter most?
- How would you generate unique short codes safely at high write volume?
- How would you handle analytics, abuse prevention, and expired links?`,
};

export function getCanonicalProblemPrompt(title: string | null | undefined, fallback: string | null | undefined) {
  if (!title) {
    return fallback ?? "No question selected yet.";
  }

  return CODING_PROBLEM_DETAILS[title] ?? SYSTEM_DESIGN_DETAILS[title] ?? fallback ?? "No question selected yet.";
}
