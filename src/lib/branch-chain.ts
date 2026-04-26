// Renders a line's node chain for a given branch ("A → B → C") or a
// direct-exit marker when the branch has no relay/exit rows ("A (direct)").
// Used by filter pages to surface each branch's topology next to its name.

export type LineNodeRole = "entry" | "relay" | "exit";

// `branchId` is null only for the entry-role row; relay/exit rows always
// carry the branch they belong to.
export type LineNode = {
  hopOrder: number;
  role: LineNodeRole;
  nodeName: string;
  branchId: number | null;
};

export function buildBranchChain(
  nodes: LineNode[] | undefined,
  branchId: number,
  directExitLabel: string,
): string {
  if (!nodes || nodes.length === 0) return "?";
  const entry = nodes.find((n) => n.role === "entry" && n.branchId === null);
  const entryName = entry?.nodeName ?? "?";
  const branchNodes = nodes
    .filter((n) => n.branchId === branchId)
    .sort((a, b) => a.hopOrder - b.hopOrder);
  if (branchNodes.length === 0) {
    return `${entryName} (${directExitLabel})`;
  }
  return [entryName, ...branchNodes.map((n) => n.nodeName)].join(" → ");
}
