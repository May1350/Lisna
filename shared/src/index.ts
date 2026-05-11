// Shared API request/response schemas.
//
// Single source of truth for the wire shapes that backend handlers
// parse and extension callers send. The drift bug class this prevents:
// "backend renames `session_id` → `sessionId` (or adds a required
// field); extension still sends the old shape; runtime 400s instead
// of a compile error". By exporting zod schemas here and consuming
// `z.infer<typeof ...>` on the extension side, the type checker
// fails BEFORE the code ships.
//
// Naming convention:
//   `<endpoint>BodySchema`  — zod runtime schema (call `.parse()` on
//                              backend; `z.infer` for type on either side).
//   `<endpoint>Body`        — type alias inferred from the schema.
//
// Currently only request bodies are shared. Response shapes are
// deferred — backend constructs them as plain object literals
// without zod validation; sharing those would require both sides
// to migrate to zod-parse, which is a larger commit.

import { z } from 'zod'

// ── POST /v1/auth/google ─────────────────────────────────────────────
// Either id_token (legacy OAuth flow) or access_token (chrome.identity)
// is required — the refine asserts the disjunction.
export const authGoogleBodySchema = z.object({
  id_token: z.string().min(1).optional(),
  access_token: z.string().min(1).optional(),
  // When present, the response also hydrates the user's existing
  // session for that page (sessions table row) so the modal can
  // render notes/slides without an extra GET /v1/session round-trip.
  current_url: z.string().url().optional(),
}).refine((d) => !!d.id_token || !!d.access_token, {
  message: 'either id_token or access_token is required',
})
export type AuthGoogleBody = z.infer<typeof authGoogleBodySchema>

// ── POST /v1/feedback ────────────────────────────────────────────────
// User-submitted feedback from the side-panel form. category must
// match the schema CHECK constraint in migrations.
export const feedbackBodySchema = z.object({
  category: z.enum(['bug', 'feature_request', 'other']),
  // Trim + 1-2000 mirror the UI's maxLength AND the DB CHECK.
  message: z.string().trim().min(1).max(2000),
  // Extension passes the active page URL when available so we can
  // repro bug reports without playing 20-questions over email.
  context_url: z.string().url().optional(),
  ext_version: z.string().max(32).optional(),
  // The browser's UA string. Capped to avoid pathological inputs.
  user_agent: z.string().max(512).optional(),
})
export type FeedbackBody = z.infer<typeof feedbackBodySchema>

// ── POST /v1/session/curate ──────────────────────────────────────────
// On-demand curator trigger. session_id is the canonical id the
// backend assigned (NOT the client-generated one from the modal's
// optimistic UX).
export const sessionCurateBodySchema = z.object({
  session_id: z.string().uuid(),
  // When true, drop previousOutline entirely so the model gets a
  // fresh-perspective rebuild (the manual "regenerate" button).
  full_rewrite: z.boolean().optional(),
  // Output language. Mirrors the extension's "Note language" Options
  // control (NoteLanguageCode in shared/i18n/types.ts). When absent
  // or 'auto' the curator detects from the transcript. Older
  // extension builds that don't send this field still work — the
  // curator falls back to auto.
  note_lang: z.enum(['auto', 'ja', 'en', 'ko', 'zh']).optional(),
})
export type SessionCurateBody = z.infer<typeof sessionCurateBodySchema>

// ── POST /v1/stream/audio ────────────────────────────────────────────
// Per-chunk audio upload during a live capture.
export const streamAudioBodySchema = z.object({
  session_id: z.string().uuid(),
  url: z.string().url(),
  start_time_sec: z.number().nonnegative(),
  duration_sec: z.number().positive(),
  audio_b64: z.string().min(1),
  mime: z.string(),
})
export type StreamAudioBody = z.infer<typeof streamAudioBodySchema>

// ── POST /v1/stream/slide ────────────────────────────────────────────
// Per-detected-slide upload from the SlideDetector content module.
export const streamSlideBodySchema = z.object({
  session_id: z.string().uuid(),
  url: z.string().url(),
  ts: z.number().nonnegative(),
  image_b64: z.string().min(1),
  // JPEG only — the SlideDetector encodes via canvas toBlob('image/jpeg').
  mime: z.literal('image/jpeg'),
})
export type StreamSlideBody = z.infer<typeof streamSlideBodySchema>
