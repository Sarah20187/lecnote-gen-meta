// Comparing two independent readings of a figure page (in-app generation, design §4.2 R2): each
// lists the diagram's edges, compared here after squashing their ends and labels. A page whose
// readings disagree goes to one zoomed reading; still disagreeing, its edges are no evidence.

import { squash } from "./squash";

/** An arrow of a diagram, as a reading writes it (schemas.ts `edge`); label "" when the arrow has none. */
export interface FigureEdge {
  from: string;
  to: string;
  label: string;
}

export interface EdgeComparison {
  /** Both readings have the same edges, with no label read differently. */
  agree: boolean;
  /** Edges both have, in A's order, with the label either reading gave. */
  common: FigureEdge[];
  onlyA: FigureEdge[];
  onlyB: FigureEdge[];
  /** The same edge, labelled differently by the two readings. */
  labels: { a: FigureEdge; b: FigureEdge }[];
}

const ends = (e: FigureEdge) => `${squash(e.from)}→${squash(e.to)}`;

/** A reading's edges by their squashed ends, the first of any repeated; edges missing an end are left out. */
function byEnds(edges: readonly FigureEdge[]): Map<string, FigureEdge> {
  const out = new Map<string, FigureEdge>();
  for (const e of edges) if (squash(e.from) && squash(e.to) && !out.has(ends(e))) out.set(ends(e), e);
  return out;
}

/**
 * Compares two readings of one figure. Edges are directed and matched on their squashed ends;
 * labels are compared squashed too, and only when both readings gave one.
 */
export function compareEdges(readingA: readonly FigureEdge[], readingB: readonly FigureEdge[]): EdgeComparison {
  const a = byEnds(readingA);
  const b = byEnds(readingB);
  const common: FigureEdge[] = [];
  const labels: EdgeComparison["labels"] = [];
  for (const [k, ea] of a) {
    const eb = b.get(k);
    if (!eb) continue;
    const [la, lb] = [squash(ea.label), squash(eb.label)];
    if (la && lb && la !== lb) labels.push({ a: ea, b: eb });
    else common.push({ ...ea, label: ea.label || eb.label });
  }
  const onlyA = [...a].filter(([k]) => !b.has(k)).map(([, e]) => e);
  const onlyB = [...b].filter(([k]) => !a.has(k)).map(([, e]) => e);
  return { agree: !onlyA.length && !onlyB.length && !labels.length, common, onlyA, onlyB, labels };
}
