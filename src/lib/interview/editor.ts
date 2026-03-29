export type SupportedEditorLanguage = "PYTHON" | "JAVASCRIPT" | "JAVA" | "C++";

export function getStarterCode(language: string | null | undefined, questionTitle: string) {
  if (questionTitle === "Two Sum") {
    return getTwoSumStarterCode(language);
  }

  switch (normalizeLanguage(language)) {
    case "JAVASCRIPT":
      return `function solve(input) {
  // ${questionTitle}
  return input;
}

const sampleInput = [];
console.log(JSON.stringify(solve(sampleInput)));`;
    case "JAVA":
      return `import java.util.*;

public class Main {
  public static Object solve(Object input) {
    // ${questionTitle}
    return input;
  }

  public static void main(String[] args) {
    Object sampleInput = new ArrayList<>();
    System.out.println(solve(sampleInput));
  }
}`;
    case "C++":
      return `#include <iostream>
#include <vector>
using namespace std;

vector<int> solve(vector<int> input) {
  // ${questionTitle}
  return input;
}

int main() {
  vector<int> sampleInput{};
  auto result = solve(sampleInput);
  cout << result.size() << endl;
  return 0;
}`;
    case "PYTHON":
    default:
      return `def solve(input):
    # ${questionTitle}
    return input

if __name__ == "__main__":
    sample_input = []
    print(solve(sample_input))`;
  }
}

function getTwoSumStarterCode(language: string | null | undefined) {
  switch (normalizeLanguage(language)) {
    case "JAVASCRIPT":
      return `function twoSum(nums, target) {
  // Return the indices of the two numbers that add up to target.
  return [];
}

const nums = [2, 7, 11, 15];
const target = 9;
console.log(JSON.stringify(twoSum(nums, target)));`;
    case "JAVA":
      return `import java.util.*;

public class Main {
  public static int[] twoSum(int[] nums, int target) {
    // Return the indices of the two numbers that add up to target.
    return new int[0];
  }

  public static void main(String[] args) {
    int[] nums = {2, 7, 11, 15};
    int target = 9;
    System.out.println(Arrays.toString(twoSum(nums, target)));
  }
}`;
    case "C++":
      return `#include <iostream>
#include <vector>
using namespace std;

vector<int> twoSum(vector<int> nums, int target) {
  // Return the indices of the two numbers that add up to target.
  return {};
}

int main() {
  vector<int> nums{2, 7, 11, 15};
  int target = 9;
  auto result = twoSum(nums, target);
  cout << "[";
  for (size_t i = 0; i < result.size(); ++i) {
    cout << result[i];
    if (i + 1 < result.size()) cout << ", ";
  }
  cout << "]" << endl;
  return 0;
}`;
    case "PYTHON":
    default:
      return `def two_sum(nums, target):
    # Return the indices of the two numbers that add up to target.
    return []

if __name__ == "__main__":
    nums = [2, 7, 11, 15]
    target = 9
    print(two_sum(nums, target))`;
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
