/**
 * Brainstorm family renderer (Plan 6 — app-design lane).
 *
 * Pure ({ note: BrainstormNote }) => JSX. Mirrors MeetingRenderer's shape
 * (zero React in main process; registered via registerFamilyRenderer at
 * module load). Brainstorm has no typed-extras `slots`; `idea_clusters[]`
 * + optional `parking_lot[]` drive layout.
 *
 * Provenance ※ marker emits on every `from === 'inferred'` leaf —
 * currently on `idea_clusters[].ideas[].from` and `parking_lot[].from`.
 *
 * SpeakerRef rendering: bare integer index into the SessionTranscript's
 * `speakers[]`. `contributed_by` is OPTIONAL on brainstorm ideas
 * (brainstorm has `requiresDiarization: false`); render the tag only when
 * the value is BOTH defined AND > 0, mirroring the meeting/interview
 * "alpha runs single-speaker" rationale. Prop name is `speakerRef` not
 * `ref` (react-reserved-props pitfall, 2026-05-30).
 */
import type { ComponentType, ReactNode } from 'react';
import {
  registerFamilyRenderer,
  type FamilyRendererDefinition,
} from '@shared/families/renderer';
import type { BrainstormNote } from './schema';

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

function PurposeBlock({ note }: { note: BrainstormNote }) {
  return (
    <section className="purpose">
      <h2>目的</h2>
      <p>{note.purpose}</p>
      {note.atmosphere && (
        <p className="atmosphere">
          雰囲気: <em>{note.atmosphere}</em>
        </p>
      )}
    </section>
  );
}

function IdeaClusters({ items }: { items: BrainstormNote['idea_clusters'] }) {
  if (items.length === 0) return null;
  return (
    <section className="idea-clusters">
      <h2>アイデア</h2>
      {items.map((c, i) => (
        <article key={i} className="idea-cluster">
          <h3>{c.theme}</h3>
          <ul>
            {c.ideas.map((idea, j) => (
              <li key={idea.id ?? j}>
                {idea.text}
                <Inferred from={idea.from} />
                <span className="ts-anchor"> [{fmtTs(idea.ts)}]</span>
                <SpeakerTag speakerRef={idea.contributed_by} label="提案者" />
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function ParkingLot({ items }: { items: NonNullable<BrainstormNote['parking_lot']> }) {
  if (items.length === 0) return null;
  return (
    <section className="parking-lot">
      <h2>パーキングロット</h2>
      <ul>
        {items.map((p, i) => (
          <li key={i}>
            {p.text}
            <Inferred from={p.from} />
            <span className="ts-anchor"> [{fmtTs(p.ts)}]</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── note ──────────────────────────────────────────────────────────────────

export const BrainstormRenderer: ComponentType<{ note: BrainstormNote }> = ({ note }) => (
  <article className="brainstorm-note">
    <header>
      <h1>{note.title}</h1>
    </header>
    <PurposeBlock note={note} />
    <IdeaClusters items={note.idea_clusters} />
    {note.parking_lot && <ParkingLot items={note.parking_lot} />}
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

const brainstormRendererDef: FamilyRendererDefinition<BrainstormNote> = {
  id: 'brainstorm',
  renderer: BrainstormRenderer,
  // No `slotRenderers` — Brainstorm has no typed slots.
};

registerFamilyRenderer(brainstormRendererDef);
