import { describe, expect, test } from "bun:test";

import { installMathSumPrecise } from "../../../../src/serve/public/lib/math-sum-precise";

describe("Math.sumPrecise compatibility", () => {
  test("preserves an existing native implementation", () => {
    const math = Math as Math & {
      sumPrecise?: (values: Iterable<number>) => number;
    };
    const existing = math.sumPrecise;
    installMathSumPrecise();
    expect(math.sumPrecise).toBe(existing);
  });

  test("compensates mixed-magnitude cancellation", () => {
    const math = Math as Math & {
      sumPrecise: (values: Iterable<number>) => number;
    };
    expect(math.sumPrecise([1e16, 1, -1e16])).toBe(1);
  });
});
