/**
 * Tests for FirstRunAudioNotice (STT Phase 2 Group G1).
 *
 * Static structural assertions via react-dom/server — this project's vitest
 * config has NO DOM env (mirrors LevelMeter / TranscriptView / FamilyPickerStep
 * tests). Click→callback wiring (onAck) is verified via the live app per
 * CLAUDE.md UI guidance; here we assert the acknowledge button is rendered and
 * carries the onClick-bound testid so the wiring is structurally present.
 *
 * The notice is a once-only first-run disclosure shown BEFORE the first
 * recording (spec §5.7 / §13): recordings are saved on-device only, retained
 * until manually deleted, and deleting a recording removes its transcript while
 * the generated note remains. JA-locked copy per v2.0 concept-lock.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FirstRunAudioNotice } from '../FirstRunAudioNotice';
import { AUDIO_DISCLOSURE_JA } from '../../i18n/disclosure-strings';

describe('FirstRunAudioNotice', () => {
  it('renders the title', () => {
    const html = renderToStaticMarkup(<FirstRunAudioNotice onAck={() => {}} />);
    expect(html).toContain(AUDIO_DISCLOSURE_JA.title);
  });

  it('discloses that recordings are saved on this device only (never uploaded)', () => {
    const html = renderToStaticMarkup(<FirstRunAudioNotice onAck={() => {}} />);
    expect(html).toContain(AUDIO_DISCLOSURE_JA.deviceOnly);
  });

  it('discloses that recordings are retained until manually deleted (no auto-purge)', () => {
    const html = renderToStaticMarkup(<FirstRunAudioNotice onAck={() => {}} />);
    expect(html).toContain(AUDIO_DISCLOSURE_JA.retained);
  });

  it('discloses that deleting a recording removes its transcript but the note remains', () => {
    const html = renderToStaticMarkup(<FirstRunAudioNotice onAck={() => {}} />);
    expect(html).toContain(AUDIO_DISCLOSURE_JA.deleteScope);
  });

  it('renders an acknowledge button wired for the onAck callback', () => {
    const html = renderToStaticMarkup(<FirstRunAudioNotice onAck={() => {}} />);
    expect(html).toContain('data-testid="audio-notice-ack"');
    expect(html).toContain(AUDIO_DISCLOSURE_JA.ackButton);
  });

  it('exposes dialog semantics labelled by its heading', () => {
    const html = renderToStaticMarkup(<FirstRunAudioNotice onAck={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="audio-notice-title"');
  });
});
