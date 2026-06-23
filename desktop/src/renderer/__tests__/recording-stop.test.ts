import { describe, it, expect } from 'vitest';
import { isEmptyRecording, MIN_RECORDING_SEC } from '../App';

describe('isEmptyRecording (record-then-transcribe empty/too-short gate)', () => {
  it('treats a 0s and sub-threshold tap as empty', () => {
    expect(isEmptyRecording(0)).toBe(true);
    expect(isEmptyRecording(0.5)).toBe(true);
  });
  it('treats >= MIN_RECORDING_SEC as a real recording', () => {
    expect(isEmptyRecording(MIN_RECORDING_SEC)).toBe(false);
    expect(isEmptyRecording(120)).toBe(false);
  });
});
