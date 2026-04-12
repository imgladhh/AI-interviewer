"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const SYSTEM_DESIGN_LEVEL_OPTIONS = [
  { value: "NEW_GRAD", label: "New Grad" },
  { value: "SDE1", label: "SDE1" },
  { value: "SDE2", label: "SDE2" },
  { value: "SENIOR", label: "Senior" },
  { value: "STAFF", label: "Staff" },
] as const;

type TargetLevel = "NEW_GRAD" | "SDE1" | "SDE2" | "SENIOR" | "STAFF";

type QuestionLaunchButtonProps = {
  questionId: string;
  mode: "CODING" | "SYSTEM_DESIGN";
  targetLevel?: TargetLevel;
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
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [selectedSystemDesignLevel, setSelectedSystemDesignLevel] = useState<TargetLevel>("SDE2");

  async function createSessionAndLaunch(resolvedTargetLevel: TargetLevel) {
    setError(null);

    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId,
        mode,
        targetLevel: resolvedTargetLevel,
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

  function handlePrimaryClick() {
    if (mode === "SYSTEM_DESIGN") {
      setShowLevelPicker(true);
      return;
    }
    void createSessionAndLaunch(targetLevel ?? "SDE2");
  }

  function handleCancelLevelPicker() {
    setShowLevelPicker(false);
    setError(null);
  }

  async function handleConfirmSystemDesignLevel() {
    await createSessionAndLaunch(selectedSystemDesignLevel);
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button
        type="button"
        onClick={handlePrimaryClick}
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
      {showLevelPicker ? (
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "var(--surface)",
            padding: 10,
            display: "grid",
            gap: 8,
            minWidth: 280,
          }}
        >
          <strong style={{ fontSize: 13 }}>Select System Design Interview Level</strong>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SYSTEM_DESIGN_LEVEL_OPTIONS.map((option) => {
              const active = selectedSystemDesignLevel === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedSystemDesignLevel(option.value)}
                  style={{
                    border: active ? "1px solid var(--accent-strong)" : "1px solid var(--border)",
                    borderRadius: 999,
                    padding: "6px 10px",
                    background: active ? "var(--accent-muted)" : "var(--surface-alt)",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => void handleConfirmSystemDesignLevel()}
              disabled={isPending}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "6px 10px",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {isPending ? "Opening..." : "Start"}
            </button>
            <button
              type="button"
              onClick={handleCancelLevelPicker}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "6px 10px",
                background: "var(--surface-alt)",
                color: "var(--text)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? <span style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span> : null}
    </div>
  );
}
