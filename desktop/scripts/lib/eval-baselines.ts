/**
 * Eval baselines registry — slugs of files under
 * `desktop/tests/fixtures/baselines/<slug>.baseline.json`.
 *
 * Plan 7 Task 23 (eval harness) will validate at startup that each slug
 * has a corresponding baseline file on disk. Plan 3 Task 14 seeds the
 * first entry (Lecture v0) so Plan 7 has a known artifact to lift.
 *
 * Adding an entry here:
 *   1. Create the baseline file at the path above.
 *   2. Append the slug to this array.
 *   3. The next eval CLI run picks it up.
 */
export const evalBaselines: ReadonlyArray<string> = [
  'lecture/spike-0.2-v0',
];
