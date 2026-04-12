import { describe, expect, it } from "vitest";
import { extractWhiteboardWeakSignals } from "@/lib/interview/whiteboard-signals";

describe("extractWhiteboardWeakSignals", () => {
  it("counts components and connections from active elements", () => {
    const signals = extractWhiteboardWeakSignals([
      { type: "rectangle" },
      { type: "text" },
      { type: "arrow" },
      { type: "line" },
    ]);

    expect(signals.elementCount).toBe(4);
    expect(signals.connectionCount).toBe(2);
    expect(signals.componentCount).toBe(2);
  });

  it("ignores deleted elements", () => {
    const signals = extractWhiteboardWeakSignals([
      { type: "rectangle", isDeleted: true },
      { type: "text" },
      { type: "arrow", isDeleted: true },
    ]);

    expect(signals.elementCount).toBe(1);
    expect(signals.connectionCount).toBe(0);
    expect(signals.componentCount).toBe(1);
  });
});
