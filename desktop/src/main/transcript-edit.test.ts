import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { saveTranscriptEdit } from './transcript-edit';

let base: string;
const ID = '2026-06-27T10-00-00-000Z';

async function writeDump(segments: unknown[]): Promise<string> {
  const dir = path.join(base, ID);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'transcript.json');
  await fs.writeFile(file, JSON.stringify({
    sessionId: 'live', language: 'ja', llmModel: 'x',
    segmentCount: segments.length, durationSec: 12, segments,
  }), 'utf8');
  return file;
}

beforeEach(async () => { base = await fs.mkdtemp(path.join(os.tmpdir(), 'lisna-tx-')); });
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe('saveTranscriptEdit', () => {
  it('merges edited text by index, preserving passthrough fields + durationSec', async () => {
    const file = await writeDump([
      { startSec: 0, endSec: 2, text: 'あ', noSpeechProb: 0.01 },
      { startSec: 2, endSec: 4, text: 'い', noSpeechProb: 0.02 },
    ]);
    await saveTranscriptEdit(base, ID, [
      { startSec: 0, endSec: 2, text: '修正済み' },
      { startSec: 2, endSec: 4, text: 'い' },
    ]);
    const after = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(after.segments[0]).toEqual({ startSec: 0, endSec: 2, text: '修正済み', noSpeechProb: 0.01 });
    expect(after.segments[1].noSpeechProb).toBe(0.02); // untouched passthrough
    expect(after.durationSec).toBe(12); // preserved (timestamps never edited)
    expect(after.segmentCount).toBe(2);
  });

  it('rejects a traversal id', async () => {
    await expect(saveTranscriptEdit(base, '../../etc', [])).rejects.toThrow('INVALID_DUMP_ID');
  });

  it('throws DUMP_NOT_FOUND for a well-formed but absent id', async () => {
    await expect(saveTranscriptEdit(base, '2026-01-01T00-00-00-000Z', [])).rejects.toThrow('DUMP_NOT_FOUND');
  });
});
