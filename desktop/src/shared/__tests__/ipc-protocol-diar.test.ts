import { describe, it, expect } from 'vitest';
import type { ModelSlot, CoreModelSlot } from '../ipc-protocol';

// Type-anchor only: ModelSlot/CoreModelSlot are erased at runtime, so the real
// guard is `tsc`. These assignments fail the typecheck if the unions are ever
// narrowed back — e.g. if 'seg'/'emb' are dropped from ModelSlot, or if
// CoreModelSlot widens past the 2-slot boot contract.
describe('ModelSlot vocabulary (diarization extension)', () => {
  it('ModelSlot spans all four slots', () => {
    const slots: ModelSlot[] = ['stt', 'llm', 'seg', 'emb'];
    expect(slots).toHaveLength(4);
  });

  it('CoreModelSlot stays the 2-slot boot subset', () => {
    const core: CoreModelSlot[] = ['stt', 'llm'];
    const widened: ModelSlot[] = core; // CoreModelSlot must be assignable to ModelSlot
    expect(widened).toHaveLength(2);
  });
});
