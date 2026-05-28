/** Map a port base to its index on the stride grid, or -1 if off-grid. Pure. */
export function slotIndex(base: number, portBase: number, portStride: number): number {
  const delta = base - portBase;
  if (delta < 0 || delta % portStride !== 0) return -1;
  return delta / portStride;
}

/** Allocate the lowest free port base on the grid given the bases already in use. Pure. */
export function allocatePortBase(usedBases: number[], portBase: number, portStride: number): number {
  const usedIdx = new Set<number>();
  for (const b of usedBases) {
    const i = slotIndex(b, portBase, portStride);
    if (i >= 0) usedIdx.add(i);
  }
  let i = 0;
  while (usedIdx.has(i)) i++;
  return portBase + i * portStride;
}
