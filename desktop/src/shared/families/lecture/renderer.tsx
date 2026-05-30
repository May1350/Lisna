/**
 * Lecture family renderer (Plan 3 Task 11).
 *
 * Pure ({ note: LectureNote }) => JSX. Renders the structured note as
 * semantic HTML — title, optional course/lecturer, tldr, sections with
 * key_terms / examples / points / typed extras. Emits a ※ marker on
 * provenance='inferred' leaves per spec §3 provenance contract.
 *
 * Registers into `familyRendererRegistry` at module load via
 * `registerFamilyRenderer`. The renderer process side-effect-imports this
 * module from `renderer/main.tsx` so the registry is populated before any
 * UI lookup.
 *
 * Per the renderer-split decision memo
 * (`docs/superpowers/decisions/2026-05-28-family-definition-renderer-split.md`):
 *   - Signature is `{ note: LectureNote }` only — no transcript.
 *   - Slot dispatch keyed by `slot.type` (the discriminator), NOT `slot.kind`.
 *   - SlotRendererMap entries receive `items: ReadonlyArray<unknown>` per
 *     the loose registry contract; the implementations cast to their
 *     concrete slot type inside.
 *
 * Styling is intentionally minimal (semantic HTML + provenance-* class
 * hooks). The legal-pad treatment for app-internal note rendering is
 * deferred per `.claude/rules/web-design.md` (scope-boundary): dense WORK
 * surfaces share tokens, not decoration.
 */
import type { ComponentType, ReactNode } from 'react';
import { Fragment } from 'react';
import {
  registerFamilyRenderer,
  type FamilyRendererDefinition,
  type SlotRendererMap,
} from '@shared/families/renderer';
import type { LectureNote, LectureSection } from './schema';
import type { ProcedureSteps, ArgumentChain, Formula, Timeline } from './slots';

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

// ─── slot dispatchers ──────────────────────────────────────────────────────

const ProcedureStepsRenderer: ComponentType<{ items: ReadonlyArray<unknown> }> = ({ items }) => (
  <>
    {(items as ReadonlyArray<ProcedureSteps>).map((slot, slotIdx) => (
      <ol key={slotIdx} className="slot procedure-steps">
        {slot.steps.map((s, i) => (
          <li key={i} value={s.order}>
            {s.text} <span className="ts-anchor">[{fmtTs(s.ts)}]</span>
            <Inferred from={s.from} />
          </li>
        ))}
      </ol>
    ))}
  </>
);

const ArgumentChainRenderer: ComponentType<{ items: ReadonlyArray<unknown> }> = ({ items }) => (
  <>
    {(items as ReadonlyArray<ArgumentChain>).map((slot, slotIdx) => (
      <ol key={slotIdx} className="slot argument-chain">
        {slot.claims.map((c, i) => (
          <li key={i} value={c.order}>
            {c.text}
            {c.supports && c.supports.length > 0 && (
              <span className="supports"> ← {c.supports.join(', ')}</span>
            )}
            <Inferred from={c.from} />
          </li>
        ))}
      </ol>
    ))}
  </>
);

const FormulaRenderer: ComponentType<{ items: ReadonlyArray<unknown> }> = ({ items }) => (
  <>
    {(items as ReadonlyArray<Formula>).map((slot, i) => (
      <div key={i} className="slot formula">
        {slot.label && <strong>{slot.label}: </strong>}
        <code>{slot.expression}</code>
        <Inferred from={slot.from} />
        {slot.derivation_steps && slot.derivation_steps.length > 0 && (
          <ol className="derivation">
            {slot.derivation_steps.map((step, j) => <li key={j}>{step}</li>)}
          </ol>
        )}
      </div>
    ))}
  </>
);

const TimelineRenderer: ComponentType<{ items: ReadonlyArray<unknown> }> = ({ items }) => (
  <>
    {(items as ReadonlyArray<Timeline>).map((slot, slotIdx) => (
      <ul key={slotIdx} className="slot timeline">
        {slot.events.map((e, i) => (
          <li key={i}><strong>{e.when}:</strong> {e.text}</li>
        ))}
      </ul>
    ))}
  </>
);

const lectureSlotRenderers: SlotRendererMap = {
  procedure_steps: ProcedureStepsRenderer,
  argument_chain: ArgumentChainRenderer,
  formula: FormulaRenderer,
  timeline: TimelineRenderer,
};

// ─── section + note ────────────────────────────────────────────────────────

function Section({ section }: { section: LectureSection }): ReactNode {
  return (
    <section className="lecture-section">
      <h2>
        {section.heading}{' '}
        <span className="ts-anchor">[{fmtTs(section.ts)}]</span>
      </h2>
      {section.summary && <p className="summary">{section.summary}</p>}
      {section.takeaway && (
        <p className="takeaway"><strong>要点:</strong> {section.takeaway}</p>
      )}

      {section.key_terms.length > 0 && (
        <dl className="key-terms">
          {section.key_terms.map((kt, i) => (
            <Fragment key={i}>
              <dt>
                {kt.term}
                <Inferred from={kt.from} />
              </dt>
              <dd>
                {kt.definition} <span className="ts-anchor">[{fmtTs(kt.ts)}]</span>
              </dd>
            </Fragment>
          ))}
        </dl>
      )}

      {section.examples.length > 0 && (
        <ul className="examples">
          {section.examples.map((ex, i) => (
            <li key={i}>
              {ex.text}{' '}
              <Inferred from={ex.from} />
              <span className="ts-anchor">[{fmtTs(ex.ts)}]</span>
            </li>
          ))}
        </ul>
      )}

      {section.points.length > 0 && (
        <ul className="points">
          {section.points.map((p, i) => (
            <li key={i} className={p.important ? 'important' : ''}>
              {p.text}{' '}
              <Inferred from={p.from} />
              <span className="ts-anchor">[{fmtTs(p.ts)}]</span>
            </li>
          ))}
        </ul>
      )}

      {/* Extras: preserve in-source order; dispatch each slot through the
          SlotRendererMap so consumers can render the same data with a
          different theme by swapping the map entry. */}
      {section.extras?.map((slot, i) => {
        const Renderer = lectureSlotRenderers[slot.type];
        return Renderer ? <Renderer key={i} items={[slot]} /> : null;
      })}
    </section>
  );
}

export function LectureRenderer({ note }: { note: LectureNote }): ReactNode {
  return (
    <article className="lecture-note">
      <header>
        <h1>{note.title}</h1>
        {note.lecturer && <div className="lecturer">講師: {note.lecturer}</div>}
        {note.course && <div className="course">{note.course}</div>}
        {note.tldr && <div className="tldr">{note.tldr}</div>}
      </header>
      {note.sections.map((sec, i) => <Section key={i} section={sec} />)}
      {note.validation_warnings && note.validation_warnings.length > 0 && (
        <aside className="validation-warnings">
          <p>AI cleanup notes:</p>
          <ul>{note.validation_warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </aside>
      )}
    </article>
  );
}

// ─── registry registration ─────────────────────────────────────────────────

const lectureRendererDef: FamilyRendererDefinition<LectureNote> = {
  id: 'lecture',
  renderer: LectureRenderer,
  slotRenderers: lectureSlotRenderers,
};

registerFamilyRenderer(lectureRendererDef);
