// Internal: not re-exported from the barrel. `CheckOptions` is re-exported from check.ts.
import { CheckMetricsSink } from './check.metrics.js';

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
  /**
   * Telemetry sink that receives one observation per Check. Defaults to
   * `noopMetricsSink`. `explain` ignores it; `lookupObjects` hands it to each
   * confirming Check.
   */
  sink?: CheckMetricsSink;
}

/**
 * Accept the options bag or, for callers written against 0.3.0, a bare sink in
 * the same position. A sink is recognised by its `record` method so a
 * structurally typed sink keeps working too.
 */
export const toCheckOptions = (arg: CheckOptions | CheckMetricsSink | undefined): CheckOptions => {
  if (arg === undefined) return {};
  if (arg instanceof CheckMetricsSink || typeof (arg as { record?: unknown }).record === 'function') return { sink: arg as CheckMetricsSink };
  return arg as CheckOptions;
};

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
