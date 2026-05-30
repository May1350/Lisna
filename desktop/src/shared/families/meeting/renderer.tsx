/**
 * Meeting family renderer (Plan 5 follow-up — app-design lane).
 *
 * Pure ({ note: MeetingNote }) => JSX. Mirrors LectureRenderer's shape
 * (zero React in main process; registered via registerFamilyRenderer at
 * module load). Meeting has no typed-extras `slots`, so the
 * `slotRenderers` field on the definition is omitted — the family's
 * top-level arrays (discussions, decisions, proposals, ...) drive the
 * layout directly.
 *
 * Provenance ※ marker emits on every `from === 'inferred'` leaf per
 * spec §3 provenance contract (key_terms-equivalent leaves: decisions,
 * proposals, open_questions, risks_or_concerns, next_steps,
 * conclusions). Discussion summaries / key_points are not currently
 * provenance-tagged in the schema, so they render without the marker.
 *
 * SpeakerRef rendering: bare integer index into the SessionTranscript's
 * `speakers[]`. The alpha meeting path runs with
 * `diarizationStatus: 'disabled'` (session-finalize.ts), so all
 * speakerRefs are 0 and showing "話者 0" everywhere reads as noise.
 * Render the speakerRef ONLY when > 0 (multi-speaker case) until Plan 4
 * Phase B wires native diarization through SessionContext.
 */
import type { ComponentType, ReactNode } from 'react';
import {
  registerFamilyRenderer,
  type FamilyRendererDefinition,
} from '@shared/families/renderer';
import type { MeetingNote } from './schema';

// ─── tiny ts helper (mm:ss) ─────────────────────────────────────────────────

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

/** Render speakerRef ONLY when non-zero — see file header for rationale.
 *  Prop is `speakerRef` not `ref` because React reserves `ref` as a special
 *  prop and strips it from function-component args. */
function SpeakerTag({ speakerRef, label }: { speakerRef: number | undefined; label: string }): ReactNode {
  if (speakerRef === undefined || speakerRef === 0) return null;
  return <span className="speaker-ref"> · {label}: 話者{speakerRef}</span>;
}

// ─── section blocks (one per top-level meeting field) ──────────────────────

function ExecutiveSummary({ note }: { note: MeetingNote }) {
  return (
    <section className="executive-summary">
      <h2>サマリー</h2>
      <p><strong>目的:</strong> {note.purpose}</p>
      <p>{note.executive_summary}</p>
      {note.atmosphere && (
        <p className="atmosphere">雰囲気: <em>{note.atmosphere}</em></p>
      )}
    </section>
  );
}

function Agenda({ items }: { items: ReadonlyArray<string> }) {
  if (items.length === 0) return null;
  return (
    <section className="agenda">
      <h2>アジェンダ</h2>
      <ol>{items.map((a, i) => <li key={i}>{a}</li>)}</ol>
    </section>
  );
}

function Participants({ items }: { items: ReadonlyArray<{ speakerRef: number; role?: string }> }) {
  if (items.length === 0) return null;
  return (
    <section className="participants">
      <h2>参加者</h2>
      <ul>
        {items.map((p, i) => (
          <li key={i}>
            話者{p.speakerRef}
            {p.role && <> — {p.role}</>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TopicArc({ items }: { items: MeetingNote['topic_arc'] }) {
  if (items.length === 0) return null;
  return (
    <section className="topic-arc">
      <h2>論点の流れ</h2>
      <ol>
        {items.map((t, i) => (
          <li key={i}>
            {t.topic} <span className="ts-anchor">[{fmtTs(t.ts)}]</span>
            {t.speakers_involved.length > 0 && t.speakers_involved.some((s) => s > 0) && (
              <span className="speakers"> — 話者: {t.speakers_involved.join(', ')}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Discussions({ items }: { items: MeetingNote['discussions'] }) {
  if (items.length === 0) return null;
  return (
    <section className="discussions">
      <h2>議論</h2>
      {items.map((d, i) => (
        <article key={i} className="discussion">
          <h3>
            {d.topic} <span className="ts-anchor">[{fmtTs(d.ts_start)}]</span>
          </h3>
          <p>{d.summary}</p>
          {d.key_points && d.key_points.length > 0 && (
            <ul className="key-points">
              {d.key_points.map((kp, j) => <li key={j}>{kp}</li>)}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}

function Decisions({ items }: { items: MeetingNote['decisions'] }) {
  if (items.length === 0) return null;
  return (
    <section className="decisions">
      <h2>決定事項</h2>
      <ul>
        {items.map((d, i) => (
          <li key={i}>
            {d.text}
            <Inferred from={d.from} />
            <span className="ts-anchor"> [{fmtTs(d.ts)}]</span>
            <SpeakerTag speakerRef={d.made_by} label="決定者" />
            {d.rationale && <div className="rationale">理由: {d.rationale}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Proposals({ items }: { items: NonNullable<MeetingNote['proposals']> }) {
  if (items.length === 0) return null;
  return (
    <section className="proposals">
      <h2>提案</h2>
      <ul>
        {items.map((p, i) => (
          <li key={i} className={p.outcome ? `outcome-${p.outcome}` : undefined}>
            {p.text}
            <Inferred from={p.from} />
            <span className="ts-anchor"> [{fmtTs(p.ts)}]</span>
            <SpeakerTag speakerRef={p.proposed_by} label="提案者" />
            {p.outcome && <span className="outcome"> · {p.outcome}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpenQuestions({ items }: { items: MeetingNote['open_questions'] }) {
  if (items.length === 0) return null;
  return (
    <section className="open-questions">
      <h2>未解決の問い</h2>
      <ul>
        {items.map((q, i) => (
          <li key={i}>
            {q.text}
            <Inferred from={q.from} />
            <span className="ts-anchor"> [{fmtTs(q.ts)}]</span>
            <SpeakerTag speakerRef={q.asked_by} label="質問者" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Risks({ items }: { items: NonNullable<MeetingNote['risks_or_concerns']> }) {
  if (items.length === 0) return null;
  return (
    <section className="risks">
      <h2>懸念・リスク</h2>
      <ul>
        {items.map((r, i) => (
          <li key={i}>
            {r.text}
            <Inferred from={r.from} />
            <span className="ts-anchor"> [{fmtTs(r.ts)}]</span>
            <SpeakerTag speakerRef={r.raised_by} label="指摘者" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Conclusions({ items }: { items: NonNullable<MeetingNote['conclusions']> }) {
  if (items.length === 0) return null;
  return (
    <section className="conclusions">
      <h2>結論</h2>
      <ul>
        {items.map((c, i) => (
          <li key={i}>
            {c.text}
            <Inferred from={c.from} />
            {typeof c.ts === 'number' && (
              <span className="ts-anchor"> [{fmtTs(c.ts)}]</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function NextSteps({ items }: { items: NonNullable<MeetingNote['next_steps']> }) {
  if (items.length === 0) return null;
  return (
    <section className="next-steps">
      <h2>ネクストステップ</h2>
      <ul>
        {items.map((n, i) => (
          <li key={i}>
            {n.text}
            <Inferred from={n.from} />
            <span className="ts-anchor"> [{fmtTs(n.ts)}]</span>
            <SpeakerTag speakerRef={n.owner} label="担当" />
            {n.due && <span className="due"> · 期限: {n.due}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── note ──────────────────────────────────────────────────────────────────

export const MeetingRenderer: ComponentType<{ note: MeetingNote }> = ({ note }) => (
  <article className="meeting-note">
    <header>
      <h1>{note.title}</h1>
    </header>
    <ExecutiveSummary note={note} />
    {note.agenda && <Agenda items={note.agenda} />}
    {note.participants && <Participants items={note.participants} />}
    <TopicArc items={note.topic_arc} />
    <Discussions items={note.discussions} />
    <Decisions items={note.decisions} />
    {note.proposals && <Proposals items={note.proposals} />}
    <OpenQuestions items={note.open_questions} />
    {note.risks_or_concerns && <Risks items={note.risks_or_concerns} />}
    {note.conclusions && <Conclusions items={note.conclusions} />}
    {note.next_steps && <NextSteps items={note.next_steps} />}
    {note.validation_warnings && note.validation_warnings.length > 0 && (
      <aside className="validation-warnings">
        <p>AI cleanup notes:</p>
        <ul>{note.validation_warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </aside>
    )}
  </article>
);

// ─── registry registration ─────────────────────────────────────────────────

const meetingRendererDef: FamilyRendererDefinition<MeetingNote> = {
  id: 'meeting',
  renderer: MeetingRenderer,
  // No `slotRenderers` — Meeting has no typed slots. Top-level fields drive
  // the layout directly. Plan 6's Interview/Brainstorm also have no slots;
  // Lecture is the only family that does today.
};

registerFamilyRenderer(meetingRendererDef);
