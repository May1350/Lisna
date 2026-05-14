/**
 * Compute how many milliseconds until the next phase change is "allowed",
 * given the minimum-display-time policy.
 *
 * **Why a pure fn**: Step 5 §3.4 requires a min-display-time for phase
 * indicators so the user can read each label before it flips (stt-unloading
 * is <1s in practice — a 1500ms floor keeps it on screen long enough to read).
 * Extracting the timing math into a pure function lets the spec-mandated
 * behavior be unit-tested without standing up @testing-library/react
 * (renderer-component unit tests are out-of-scope for Step 5 per spec §8).
 *
 * @param lastChangeAt timestamp (ms since epoch, or any monotonic source) of
 *   the LAST displayed phase change
 * @param now current timestamp in the same scale
 * @param minDisplayMs minimum window to keep the previous phase visible
 * @returns 0 if the window has already elapsed (caller may update display
 *   immediately); otherwise the remaining ms the caller should wait via
 *   `setTimeout` before applying the next phase
 */
export function computeMinDisplayDelay(
  lastChangeAt: number,
  now: number,
  minDisplayMs: number,
): number {
  if (minDisplayMs <= 0) return 0;
  const elapsed = now - lastChangeAt;
  if (elapsed < 0) return 0;  // clock skew defense — treat as "elapsed"
  if (elapsed >= minDisplayMs) return 0;
  return minDisplayMs - elapsed;
}

/**
 * Spec-mandated minimum-display window per phase (Step 5 §3.4).
 * 1500ms = "long enough to read a short label" without feeling laggy.
 * Re-exported so FinalizingView and any future phase-indicator UI share
 * the same calibration target.
 */
export const PHASE_MIN_DISPLAY_MS = 1500;
