// The shortest list of changes that turns one list into another (Myers' method), used to compare
// two versions' pages, lines and words (stop 3c).

export type DiffOp =
  /** In both: `a` and `b` are its places in each list. */
  | { kind: 'same'; a: number; b: number }
  /** Only in the first list, at `a`. */
  | { kind: 'removed'; a: number }
  /** Only in the second list, at `b`. */
  | { kind: 'added'; b: number };

/** More changes than this, and the middle is treated as all removed and all added (it keeps memory use small). */
const MAX_EDITS = 2000;

export function diff<T>(a: readonly T[], b: readonly T[], equal: (x: T, y: T) => boolean = (x, y) => x === y, maxEdits = MAX_EDITS): DiffOp[] {
  // What's the same at the start and the end needs no searching.
  let start = 0;
  while (start < a.length && start < b.length && equal(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && equal(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }
  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: 'same', a: i, b: i });
  ops.push(...middle(a, b, start, endA, start, endB, equal, maxEdits));
  for (let i = 0; endA + i < a.length; i++) ops.push({ kind: 'same', a: endA + i, b: endB + i });
  return ops;
}

function middle<T>(a: readonly T[], b: readonly T[], startA: number, endA: number, startB: number, endB: number, equal: (x: T, y: T) => boolean, maxEdits: number): DiffOp[] {
  const n = endA - startA;
  const m = endB - startB;
  const allChanged = (): DiffOp[] => [
    ...Array.from({ length: n }, (_, i): DiffOp => ({ kind: 'removed', a: startA + i })),
    ...Array.from({ length: m }, (_, i): DiffOp => ({ kind: 'added', b: startB + i })),
  ];
  if (n === 0 || m === 0) return allChanged();
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] holds v as it was before step d, for diagonals -d-1 to d+1 (index k + d + 1).
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    if (d > maxEdits) return allChanged();
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && equal(a[startA + x], b[startB + y])) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, startA, startB);
    }
  }
  return allChanged();
}

function backtrack(trace: Int32Array[], n: number, m: number, startA: number, startB: number): DiffOp[] {
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const at = (k: number) => v[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'same', a: startA + x - 1, b: startB + y - 1 });
      x--;
      y--;
    }
    if (d > 0) ops.push(x === prevX ? { kind: 'added', b: startB + prevY } : { kind: 'removed', a: startA + prevX });
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}
