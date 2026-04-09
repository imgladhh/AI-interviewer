"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type QuestionLaunchButtonProps = {
  questionId: string;
  mode: "CODING" | "SYSTEM_DESIGN";
  targetLevel: "NEW_GRAD" | "SDE1" | "SDE2" | "SENIOR" | "STAFF";
  companyStyle: "GENERIC" | "AMAZON" | "META" | "GOOGLE" | "STRIPE";
  variant?: "button" | "link";
  label?: string;
};

export function QuestionLaunchButton({
  questionId,
  mode,
  targetLevel,
  companyStyle,
  variant = "button",
  label,
}: QuestionLaunchButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleLaunch() {
    setError(null);

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId,
        mode,
        targetLevel,
        selectedLanguage: "PYTHON",
        companyStyle,
        voiceEnabled: true,
        lowCostMode: true,
        personaEnabled: false,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok || !payload?.data?.launch?.roomUrl) {
      setError(payload?.message ?? "Unable to launch this question.");
      return;
    }

    startTransition(() => {
      router.push(payload.data.launch.roomUrl);
    });
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button
        type="button"
        onClick={() => void handleLaunch()}
        disabled={isPending}
        style={{
          border: variant === "button" ? "1px solid var(--border)" : "none",
          borderRadius: variant === "button" ? 999 : 0,
          padding: variant === "button" ? "8px 12px" : 0,
          background: variant === "button" ? "var(--accent)" : "transparent",
          color: variant === "button" ? "#fff" : "var(--accent-strong)",
          fontWeight: 700,
          cursor: "pointer",
          textAlign: "left",
          textDecoration: variant === "link" ? "underline" : "none",
          fontSize: variant === "link" ? 16 : undefined,
        }}
      >
        {isPending ? "Opening..." : label ?? (variant === "link" ? "Open" : "Start Interview")}
      </button>
      {error ? <span style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span> : null}
    </div>
  );
}