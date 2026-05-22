import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { track, Events } from './plausible'

describe('track()', () => {
  beforeEach(() => {
    // Ensure a clean window.plausible state before each test
    delete (window as Window & { plausible?: unknown }).plausible
  })

  afterEach(() => {
    delete (window as Window & { plausible?: unknown }).plausible
  })

  it('is a no-op when window.plausible is undefined', () => {
    // Should not throw
    expect(() => track('download_click')).not.toThrow()
  })

  it('is a no-op when window.plausible is set to a non-function value', () => {
    // @ts-expect-error — simulating a misbehaving global (browser extension etc.)
    window.plausible = 'truthy-but-not-a-function'
    expect(() => track('download_click')).not.toThrow()
  })

  it('calls window.plausible with event name only when no props given', () => {
    const spy = vi.fn()
    window.plausible = spy
    track('download_click')
    expect(spy).toHaveBeenCalledOnce()
    expect(spy).toHaveBeenCalledWith('download_click', undefined)
  })

  it('calls window.plausible with event name and { props } when props given', () => {
    const spy = vi.fn()
    window.plausible = spy
    track('download_click', { source: 'hero' })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy).toHaveBeenCalledWith('download_click', { props: { source: 'hero' } })
  })
})

describe('Events constants', () => {
  it('has expected string values', () => {
    expect(Events.DownloadClick).toBe('download_click')
    expect(Events.SigninInitiated).toBe('signin_initiated')
    expect(Events.SigninCompleted).toBe('signin_completed')
    expect(Events.DiscordClick).toBe('discord_click')
  })
})
