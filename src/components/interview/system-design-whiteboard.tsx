"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef } from "react";
import { extractWhiteboardWeakSignals, type WhiteboardElementLike, type WhiteboardWeakSignals } from "@/lib/interview/whiteboard-signals";

const Excalidraw = dynamic(
  async () => {
    const mod = await import("@excalidraw/excalidraw");
    return mod.Excalidraw;
  },
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: 620,
          borderRadius: 18,
          border: "1px solid var(--border)",
          background: "var(--surface-alt)",
        }}
      />
    ),
  },
);

type SystemDesignWhiteboardProps = {
  onWeakSignalChange?: (signals: WhiteboardWeakSignals) => void;
};

export function SystemDesignWhiteboard({ onWeakSignalChange }: SystemDesignWhiteboardProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    },
    [],
  );
  const onChange = useMemo(
    () => (elements: unknown) => {
      if (!Array.isArray(elements)) {
        return;
      }
      const parsed = extractWhiteboardWeakSignals(elements as WhiteboardElementLike[]);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        onWeakSignalChange?.(parsed);
      }, 300);
    },
    [onWeakSignalChange],
  );

  return (
    <div
      style={{
        height: 620,
        borderRadius: 18,
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      <Excalidraw onChange={onChange} />
    </div>
  );
}
