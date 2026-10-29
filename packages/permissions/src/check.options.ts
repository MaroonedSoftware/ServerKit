// Internal: not re-exported from the barrel. `CheckOptions` is re-exported from check.ts.

/** Recursion cap used when {@link CheckOptions.maxDepth} is not set. */
export const DEFAULT_MAX_DEPTH = 32;

/**
 * Tuning knobs shared by `check`, `checkDetailed`, `explain`, and
 * `lookupObjects`.
 */
export interface CheckOptions {
  /**
   * Recursion cap for the evaluator. Each `computed` step, `tupleToUserset`
   * hop, and userset subject adds one level. Exceeding it yields an
   * inconclusive `false` (see `CheckResult.maxDepthExceeded`).
   * Defaults to 32. Raise it for models with long chains, such as a reporting
   * line walked through `manager->...`.
   */
  maxDepth?: number;
}

/**
 * Resolve {@link CheckOptions.maxDepth} to a number, rejecting values that would
 * make every Check inconclusive or unbounded.
 *
 * @throws {RangeError} When `maxDepth` is not a positive integer.
 */
export const resolveMaxDepth = (options: CheckOptions): number => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new RangeError(`maxDepth must be a positive integer, got ${maxDepth}`);
  }
  return maxDepth;
};
