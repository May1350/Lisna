// Regression coverage for useSession (Phase 5c step 3a). Phase 3b
// will add applyEvent + transport-listener coverage; for 3a the
// critical post-split contract is `hydrateFromLogin` — it replaces a
// previously inlined block at App.tsx LoginScreen.onSuccess that
// seeded sessionId / slides / outline / outlineUpdatedAt and pulled
// the curator-extracted title out of the session payload. A drift
// here would leave a logged-in user with an empty modal until the
// /v1/session GET fallback runs (~500 ms later) — visible as a
// blank flash.
import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { useSession } from '../src/side-panel/hooks/useSession'
import type { Outline } from '../src/side-panel/api-client'
import type { SlideItem } from '../src/shared/types'

const mockOutline: Outline = {
  title: '線形代数入門',
  sections: [{
    heading: 'Lecture overview', ts: 0, summary: 'intro',
    key_terms: [], examples: [], points: [],
  }],
}
const mockSlides: SlideItem[] = [
  { ts: 12, key: 's1', url: 'blob:s1' },
  { ts: 34, key: 's2', url: 'blob:s2' },
]

describe('useSession — hydrateFromLogin', () => {
  it('seeds sessionId / slides / outline / outlineUpdatedAt and returns the outline title', () => {
    // Use a wrapper component so we can build the exportCtxRef inside
    // the hook scope (not at module level — refs must come from
    // useRef per the rules of hooks).
    const { result } = renderHook(() => {
      const exportCtxRef = useRef({
        parentUrl: null, sessionId: null, title: '', slides: [],
      })
      // isEmbed:false skips the /v1/session GET effect (we don't
      // want the effect firing during the test — we're testing the
      // hydrateFromLogin path directly).
      return useSession({
        isEmbed: false,
        user: null,
        parentUrl: null,
        exportCtxRef,
        setTitle: vi.fn(),
        titleFallback: 'fallback',
      })
    })

    expect(result.current.sessionId).toBeNull()
    expect(result.current.slides).toEqual([])
    expect(result.current.outline).toBeNull()

    const updatedAtIso = '2026-05-10T12:34:00Z'
    let returned: { outlineTitle?: string } = {}
    act(() => {
      returned = result.current.hydrateFromLogin({
        id: 'sess-42',
        slides: mockSlides,
        outline: mockOutline,
        updated_at: updatedAtIso,
      })
    })

    expect(result.current.sessionId).toBe('sess-42')
    expect(result.current.slides).toEqual(mockSlides)
    expect(result.current.outline).toEqual(mockOutline)
    expect(result.current.outlineUpdatedAt).toBe(new Date(updatedAtIso).getTime())
    expect(returned.outlineTitle).toBe('線形代数入門')
  })

  it('omits outlineUpdatedAt when no outline is provided (DB-write-time semantics)', () => {
    const { result } = renderHook(() => {
      const exportCtxRef = useRef({
        parentUrl: null, sessionId: null, title: '', slides: [],
      })
      return useSession({
        isEmbed: false,
        user: null,
        parentUrl: null,
        exportCtxRef,
        setTitle: vi.fn(),
        titleFallback: 'fallback',
      })
    })

    let returned: { outlineTitle?: string } = {}
    act(() => {
      returned = result.current.hydrateFromLogin({
        id: 'sess-no-outline',
        slides: [],
        outline: null,
        // Provided but should NOT be applied — sessions.updated_at
        // also moves on every audio chunk write, so without the
        // outline-presence guard a captured-but-uncurated session
        // would inherit "now" as the indicator value and the first
        // curate's first-content-arrival branch would pick that
        // stale value.
        updated_at: '2026-05-10T12:34:00Z',
      })
    })

    expect(result.current.sessionId).toBe('sess-no-outline')
    expect(result.current.outline).toBeNull()
    expect(result.current.outlineUpdatedAt).toBeNull()
    expect(returned.outlineTitle).toBeUndefined()
  })
})
