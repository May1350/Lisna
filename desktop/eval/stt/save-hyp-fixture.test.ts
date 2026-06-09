import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveHypAsLectureFixture } from './save-hyp-fixture';

describe('saveHypAsLectureFixture', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lisna-save-hyp-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes meta.json with lecture-family + ja + composed-gate tags', () => {
    const out = saveHypAsLectureFixture({
      fixtureId: 'ja-30s-realstt',
      hyp: 'kyou wa yoi tenki desu ne',
      reference: '今日は良い天気ですね',
      durationSec: 30,
      sttModelId: 'kotoba-whisper-v2.0-q5_0',
      fixturesRoot: root,
    });
    expect(out.dir).toBe(join(root, 'lecture', 'ja-30s-realstt'));
    const meta = JSON.parse(readFileSync(out.metaPath, 'utf8'));
    expect(meta.fixtureId).toBe('ja-30s-realstt');
    expect(meta.family).toBe('lecture');
    expect(meta.language).toBe('ja');
    expect(meta.durationSec).toBe(30);
    expect(meta.bucketSeconds).toBe(30);
    expect(meta.scenarioTags).toEqual(['realstt', 'composed-gate']);
    expect(meta.expectedSlots).toEqual([]);
    expect(meta.notes).toContain('kotoba-whisper-v2.0-q5_0');
  });

  it('writes transcript.json with a single utterance at ts=0', () => {
    const out = saveHypAsLectureFixture({
      fixtureId: 'ja-30s-realstt',
      hyp: 'kyou wa yoi tenki desu ne',
      reference: '今日は良い天気ですね',
      durationSec: 30,
      sttModelId: 'kotoba-whisper-v2.0-q5_0',
      fixturesRoot: root,
    });
    const transcript = JSON.parse(readFileSync(out.transcriptPath, 'utf8'));
    expect(transcript.sessionId).toBe('ja-30s-realstt');
    expect(transcript.speakers).toEqual([{ id: 0 }]);
    expect(transcript.bucket_seconds).toBe(30);
    expect(transcript.transcripts).toHaveLength(1);
    expect(transcript.transcripts[0]).toEqual({
      ts: 0,
      text: 'kyou wa yoi tenki desu ne',
      speakerId: 0,
    });
  });

  it('creates the fixture directory even when it does not exist', () => {
    const fresh = join(root, 'nested', 'tree');
    const out = saveHypAsLectureFixture({
      fixtureId: 'x',
      hyp: 'h',
      reference: 'r',
      durationSec: 10,
      sttModelId: 'm',
      fixturesRoot: fresh,
    });
    expect(out.dir).toBe(join(fresh, 'lecture', 'x'));
    // Reading would throw if mkdirSync recursive failed.
    expect(JSON.parse(readFileSync(out.metaPath, 'utf8')).fixtureId).toBe('x');
  });

  it('uses bucketSeconds = durationSec (single-bucket, no chunking)', () => {
    const out = saveHypAsLectureFixture({
      fixtureId: 'x',
      hyp: 'h',
      reference: 'r',
      durationSec: 45,
      sttModelId: 'm',
      fixturesRoot: root,
    });
    const meta = JSON.parse(readFileSync(out.metaPath, 'utf8'));
    const tx = JSON.parse(readFileSync(out.transcriptPath, 'utf8'));
    expect(meta.bucketSeconds).toBe(45);
    expect(tx.bucket_seconds).toBe(45);
  });
});
