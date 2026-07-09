/**
 * SDK client adapter for the cloud note path — split out of claude-notes.ts
 * to keep that file under the repo's 200-line review threshold. Wraps the
 * real `@anthropic-ai/sdk` client behind a minimal injectable interface so
 * tests can mock the streaming boundary without constructing a real
 * Anthropic client or every field of its response types.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CloudMessageResponse } from './claude-errors';

/** A started message stream — the injectable shape of what
 * `client.messages.stream(...)` returns (SDK: `MessageStream`, synchronous,
 * request runs in the background; `finalMessage()` resolves once the stream
 * completes or rejects with the original typed SDK error — verified against
 * the installed @anthropic-ai/sdk 0.91's `lib/MessageStream.js`:
 * `_handleError` re-emits AnthropicError subclasses as-is, and the 'error'
 * event rejects the same promise `finalMessage()` awaits). */
export interface CloudMessageStream {
  finalMessage(): Promise<CloudMessageResponse>;
}

/** Injectable client surface — decoupled from the full `Anthropic` class so
 * tests don't need a real client. The real `Anthropic` instance satisfies
 * this via the adapter in `defaultCreateClient` below.
 *
 * H1/H2/M14 — switched from `messages.create()` to `messages.stream()`:
 * `.create()`'s non-streaming call is bound by the SDK's own worst-case
 * generation budget (~10 min for max_tokens=16000, undocumented per-call but
 * inferred from the SDK's DEFAULT_TIMEOUT), and the prior 300_000ms client
 * timeout sat BELOW that, aborting slow-but-succeeding (and billed)
 * generations. Streaming removes that ceiling — progress arrives
 * incrementally, so the only remaining timeout is the explicit per-call
 * abort passed at the call site (claude-notes.ts's TIMEOUT_MS). */
export interface CloudMessages {
  messages: {
    stream(
      body: {
        model: string;
        max_tokens: number;
        system: string;
        messages: Array<{ role: 'user'; content: string }>;
      },
      options?: { timeout?: number },
    ): CloudMessageStream;
  };
}

export function defaultCreateClient(apiKey: string): CloudMessages {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  return {
    messages: {
      // Adapter cast: the real SDK's `MessageStream.finalMessage()` resolves
      // a `Message` whose `content` (a large ContentBlock union) and
      // `stop_reason` (StopReason|null) are a structural superset of
      // CloudMessageResponse — narrowing here at the one true integration
      // boundary keeps CloudMessages simple.
      stream: (body, options) => client.messages.stream(body, options) as unknown as CloudMessageStream,
    },
  };
}
