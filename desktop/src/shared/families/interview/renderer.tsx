/**
 * Interview family renderer (Plan 6 — app-design lane).
 *
 * Pure ({ note: InterviewNote }) => JSX. Mirrors MeetingRenderer's shape
 * (zero React in main process; registered via registerFamilyRenderer at
 * module load). Interview has no typed-extras `slots`; top-level arrays
 * (qa_pairs, themes, quotable_lines, key_takeaways, ...) drive layout.
 *
 * Provenance ※ marker emits on every `from === 'inferred'` leaf per
 * spec §3 provenance contract — currently on qa_pairs[].from and
 * key_takeaways[].from. Themes / quotable_lines / participants are NOT
 * provenance-tagged in the schema, so they render without the marker.
 *
 * SpeakerRef rendering: bare integer index into the SessionTranscript's
 * `speakers[]`. The alpha interview path runs with
 * `diarizationStatus: 'disabled'` (session-finalize.ts) → all speakerRefs
 * collapse to 0, and showing "話者 0" everywhere reads as noise. Render
 * the speakerRef ONLY when > 0 (multi-speaker case) until Plan 4 Phase B
 * wires native diarization through SessionContext. Prop name is
 * `speakerRef` not `ref` (react-reserved-props pitfall, 2026-05-30).
 */
import type { ComponentType, ReactNode } from 'react';
import {
  registerFamilyRenderer,
  type FamilyRendererDefinition,
} from '@shared/families/renderer';
import type { InterviewNote } from './schema';

// ─── helpers (mm:ss, ※ marker, speakerRef tag) ───────────────────────────────

function fmtTs(ts: number): string {
  const m = Math.floor(ts / 60).toString().padStart(2, '0');
  const s = Math.floor(ts % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function Inferred({ from }: { from: 'transcript' | 'inferred' }): ReactNode {
  return from === 'inferred' ? (
    <span className="provenance-inferred" title="AI-inferred">※</span>
  ) : null;
}

function SpeakerTag({
  speakerRef,
  label,
}: {
  speakerRef: number | undefined;
  label: string;
}): ReactNode {
  if (speakerRef === undefined || speakerRef === 0) return null;
  return <span className="speaker-ref"> · {label}: 話者{speakerRef}</span>;
}

// ─── sections ───────────────────────────────────────────────────────────────

function SubjectSummary({ note }: { note: InterviewNote }) {
  return (
    <section className="subject-summary">
      <h2>概要</h2>
      <p>
        <strong>目的:</strong> {note.purpose}
      </p>
      <p>{note.subject_summary}</p>
    </section>
  );
}

function Participants({
  items,
}: {
  items: ReadonlyArray<{ speakerRef: number; role: 'interviewer' | 'interviewee' }>;
}) {
  if (items.length === 0) return null;
  return (
    <section className="participants">
      <h2>参加者</h2>
      <ul>
        {items.map((p, i) => (
          <li key={i}>
            話者{p.speakerRef} — {p.role}
          </li>
        ))}
      </ul>
    </section>
  );
}

function QAPairs({ items }: { items: InterviewNote['qa_pairs'] }) {
  if (items.length === 0) return null;
  return (
    <section className="qa-pairs">
      <h2>質問と回答</h2>
      {items.map((qa, i) => (
        <article key={i} className="qa-pair">
          <p className="question">
            <strong>Q:</strong> {qa.question}
            <span className="ts-anchor"> [{fmtTs(qa.ts)}]</span>
            <SpeakerTag speakerRef={qa.asked_by} label="質問者" />
          </p>
          <p className="answer">
            <strong>A:</strong> {qa.answer}
            <Inferred from={qa.from} />
            <SpeakerTag speakerRef={qa.answered_by} label="回答者" />
          </p>
          {qa.themes && qa.themes.length > 0 && (
            <div className="qa-themes">
              {qa.themes.map((t, j) => (
                <span key={j} className="theme-tag">
                  {t}
                </span>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function Themes({ items }: { items: InterviewNote['themes'] }) {
  if (items.length === 0) return null;
  return (
    <section className="themes">
      <h2>テーマ</h2>
      <ul>
        {items.map((t, i) => (
          <li key={i}>
            <strong>{t.name}</strong>
            {t.description && <> — {t.description}</>}
            {t.appears_at_ts.length > 0 && (
              <span className="ts-anchors"> ({t.appears_at_ts.map(fmtTs).join(', ')})</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuotableLines({ items }: { items: InterviewNote['quotable_lines'] }) {
  if (items.length === 0) return null;
  return (
    <section className="quotable-lines">
      <h2>印象的な発言</h2>
      <ul>
        {items.map((q, i) => (
          <li key={i}>
            <blockquote>「{q.text}」</blockquote>
            <SpeakerTag speakerRef={q.speakerRef} label="話者" />
            <span className="ts-anchor"> [{fmtTs(q.ts)}]</span>
            {q.why_notable && <div className="why-notable">{q.why_notable}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function KeyTakeaways({ items }: { items: InterviewNote['key_takeaways'] }) {
  if (items.length === 0) return null;
  return (
    <section className="key-takeaways">
      <h2>重要なポイント</h2>
      <ul>
        {items.map((k, i) => (
          <li key={i}>
            {k.text}
            <Inferred from={k.from} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── note ──────────────────────────────────────────────────────────────────

export const InterviewRenderer: ComponentType<{ note: InterviewNote }> = ({ note }) => (
  <article className="interview-note">
    <header>
      <h1>{note.title}</h1>
    </header>
    <SubjectSummary note={note} />
    {note.participants && <Participants items={note.participants} />}
    <QAPairs items={note.qa_pairs} />
    <Themes items={note.themes} />
    <QuotableLines items={note.quotable_lines} />
    <KeyTakeaways items={note.key_takeaways} />
    {note.validation_warnings && note.validation_warnings.length > 0 && (
      <aside className="validation-warnings">
        <p>AI cleanup notes:</p>
        <ul>
          {note.validation_warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </aside>
    )}
  </article>
);

// ─── registry registration ─────────────────────────────────────────────────

const interviewRendererDef: FamilyRendererDefinition<InterviewNote> = {
  id: 'interview',
  renderer: InterviewRenderer,
  // No `slotRenderers` — Interview has no typed slots. Top-level fields
  // drive the layout directly. (Lecture is the only family with slots.)
};

registerFamilyRenderer(interviewRendererDef);
