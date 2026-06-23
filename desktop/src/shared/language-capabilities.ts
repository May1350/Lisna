import type { Language } from './types';

/** What a language is allowed to produce. Phase 1: ko = transcription only;
 *  flipping ko.notes to true is the entire Phase-2 enablement once 3B Korean
 *  note quality is eval-proven. */
export interface LanguageCapabilities {
  transcript: boolean;
  notes: boolean;
}

const CAPABILITIES: Record<Language, LanguageCapabilities> = {
  ja: { transcript: true, notes: true },
  en: { transcript: true, notes: true },
  ko: { transcript: true, notes: false }, // Phase 1: transcription-only
  zh: { transcript: false, notes: false }, // valid type, unsupported
};

const NONE: LanguageCapabilities = { transcript: false, notes: false };

/** IPC payloads are un-typed JSON, so accept `string` and fall back to NONE
 *  for any unknown code (keeps the entry gate rejecting garbage). */
export function languageCapabilities(lang: string): LanguageCapabilities {
  return CAPABILITIES[lang as Language] ?? NONE;
}
