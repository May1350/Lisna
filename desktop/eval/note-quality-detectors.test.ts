import { describe, it, expect } from 'vitest';
import { noteQualityDetectors } from './note-quality-detectors';

const segs = ['はい、完成です!', 'めちゃくちゃ楽しみにしてるから', 'プロプランの価格を見直す'];

describe('noteQualityDetectors', () => {
  it('flags the real failure signatures (markers / garble / placeholder / copy)', () => {
    const badNote = {
      family: 'meeting',
      model: 'llama-3.2-3b', // system key — must be ignored
      decisions: [
        { text: '[0] [話者0] はい、完成です!' },          // marker + verbatim copy
        { text: 'めちゃくちゃ楽しみにしてるから' },        // verbatim copy
      ],
      next_steps: [{ text: 'ビジョン、ミッ션、バリュール' }], // mixed-script garble
      open_questions: [{ text: 'この会議で何が話されましたか?' }], // placeholder
      risks_or_concerns: [{ text: 'この会議でどのようなリスクが生じるか?' }], // placeholder
    };
    const d = noteQualityDetectors(badNote, segs);
    expect(d.leakedMarkerCount).toBe(1);
    expect(d.mixedScriptCount).toBe(1);
    expect(d.placeholderCount).toBe(2);
    expect(d.contentAtoms).toBe(5); // decisions 2 + next_steps 1 + open_questions 1 + risks 1
    expect(d.copyRate).toBeGreaterThan(0); // 2 verbatim copies / 5 atoms
  });

  it('reports all-clean on an abstracted, grounded note', () => {
    const goodNote = {
      family: 'meeting',
      decisions: [{ text: '価格改定を決定' }, { text: '採用を確定' }],
      next_steps: [{ text: '来週までに見積もりを作成', owner: 0 }],
      open_questions: [{ text: '誰が承認するか?' }],
    };
    const d = noteQualityDetectors(goodNote, segs);
    expect(d).toMatchObject({ leakedMarkerCount: 0, mixedScriptCount: 0, placeholderCount: 0, copyRate: 0 });
    expect(d.contentAtoms).toBe(4);
  });

  it('copyRate is 0/contentAtoms 0 on an empty note (no divide-by-zero)', () => {
    expect(noteQualityDetectors({ family: 'meeting' }, segs)).toMatchObject({ copyRate: 0, contentAtoms: 0 });
  });
});
