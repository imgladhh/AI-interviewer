import { runPolicyRegressionLab } from "@/lib/assistant/policy-regression";

const results = runPolicyRegressionLab();

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  scenarios: results,
}, null, 2));
