import { describe, it, expect, vi } from 'vitest';
import { autoRegisterGlossaryFromEdit } from '../glossary-auto';

const pair = (before: string, after: string) => ({ before, after });

describe('autoRegisterGlossaryFromEdit', () => {
  it('appends a new proper noun and returns it', async () => {
    const set = vi.fn(async (terms: string[]) => terms);
    const added = await autoRegisterGlossaryFromEdit(
      [pair('アグリック', 'アグリテック')],
      { getGlossary: async () => [], setGlossary: set },
    );
    expect(added).toEqual(['アグリテック']);
    expect(set).toHaveBeenCalledWith(['アグリテック']);
  });

  it('no new proper noun → does NOT call setGlossary, returns []', async () => {
    const set = vi.fn(async (t: string[]) => t);
    const added = await autoRegisterGlossaryFromEdit(
      // 'テスト' is dropped in `after`, so no run appears that wasn't in `before`.
      [pair('これはマイクのテストです', 'これはマイクです')],
      { getGlossary: async () => [], setGlossary: set },
    );
    expect(added).toEqual([]);
    expect(set).not.toHaveBeenCalled();
  });

  it('already-glossed term is not re-added', async () => {
    const set = vi.fn(async (t: string[]) => t);
    const added = await autoRegisterGlossaryFromEdit(
      [pair('アグリック', 'アグリテック')],
      { getGlossary: async () => ['アグリテック'], setGlossary: set },
    );
    expect(added).toEqual([]);
    expect(set).not.toHaveBeenCalled();
  });

  it('returns only terms actually persisted (cap drops overflow)', async () => {
    const set = vi.fn(async () => ['iOS']); // setGlossary echoes only iOS (cap)
    const added = await autoRegisterGlossaryFromEdit(
      [pair('アイオーエス アンドロイド', 'iOS Android')],
      { getGlossary: async () => [], setGlossary: set },
    );
    expect(added).toEqual(['iOS']); // 'Android' extracted but not in saved list
  });

  it('setGlossary throws → returns [], no throw escapes', async () => {
    const added = await autoRegisterGlossaryFromEdit(
      [pair('アグリック', 'アグリテック')],
      {
        getGlossary: async () => [],
        setGlossary: async () => {
          throw new Error('disk');
        },
      },
    );
    expect(added).toEqual([]);
  });
});
