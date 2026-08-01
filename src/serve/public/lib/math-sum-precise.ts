type MathWithSumPrecise = Math & {
  sumPrecise?: (values: Iterable<number>) => number;
};

/**
 * Compatibility for pdfjs-dist on browsers that predate Math.sumPrecise.
 * Neumaier compensation keeps mixed-magnitude page metrics stable enough for
 * the PDF.js call sites while native implementations remain preferred.
 */
export function installMathSumPrecise(): void {
  const math = Math as MathWithSumPrecise;
  if (typeof math.sumPrecise === "function") {
    return;
  }
  Object.defineProperty(math, "sumPrecise", {
    configurable: true,
    writable: true,
    value(values: Iterable<number>): number {
      let sum = 0;
      let compensation = 0;
      for (const value of values) {
        const next = sum + value;
        compensation +=
          Math.abs(sum) >= Math.abs(value)
            ? sum - next + value
            : value - next + sum;
        sum = next;
      }
      return sum + compensation;
    },
  });
}

installMathSumPrecise();
