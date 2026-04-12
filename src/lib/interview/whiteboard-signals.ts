export type WhiteboardElementLike = {
  type?: string;
  isDeleted?: boolean;
};

export type WhiteboardWeakSignals = {
  componentCount: number;
  connectionCount: number;
  elementCount: number;
};

const CONNECTION_TYPES = new Set(["arrow", "line"]);

export function extractWhiteboardWeakSignals(
  elements: WhiteboardElementLike[],
): WhiteboardWeakSignals {
  const activeElements = elements.filter((element) => !element?.isDeleted);
  const connectionCount = activeElements.filter((element) =>
    CONNECTION_TYPES.has(String(element?.type ?? "")),
  ).length;
  const elementCount = activeElements.length;
  const componentCount = Math.max(0, elementCount - connectionCount);

  return {
    componentCount,
    connectionCount,
    elementCount,
  };
}
