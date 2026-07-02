import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';

// Side-effect import — registers Lecture's FamilyRendererDefinition into
// `familyRendererRegistry` so NoteView's dispatch (`registry[note.family]`)
// resolves. Each family that ships a renderer gets one line here. The main
// process registers FamilyCoreDefinitions separately (no React imports
// cross the main/renderer boundary; see
// docs/superpowers/decisions/2026-05-28-family-definition-renderer-split.md).
import '@shared/families/lecture/renderer';
import '@shared/families/meeting/renderer';
import '@shared/families/interview/renderer';
import '@shared/families/brainstorm/renderer';

createRoot(document.getElementById('root')!).render(<App />);

// Overlay-scrollbar auto-hide + top-fade driver. `scroll` does NOT bubble, so a
// single capture-phase, passive listener catches every [data-lz-scroll] element
// (the page scroller + the nested transcript boxes), including ones mounted later
// on route changes — zero per-component wiring.
//   • data-scrolled  → scroll-gated top fade turns on (scrollTop > 0)
//   • data-scrolling → the (otherwise transparent) scrollbar thumb paints;
//                       removed 700ms after the last scroll so it fades to none.
// Per-element timer (WeakMap) so two scrollers hide independently. Works under
// both macOS "Show scroll bars" settings (Always / When scrolling).
const scrollIdleTimers = new WeakMap<Element, number>();
document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target as HTMLElement;
    if (!(el instanceof HTMLElement) || !('lzScroll' in el.dataset)) return;
    el.toggleAttribute('data-scrolled', el.scrollTop > 0);
    el.setAttribute('data-scrolling', '');
    const prev = scrollIdleTimers.get(el);
    if (prev) window.clearTimeout(prev);
    scrollIdleTimers.set(
      el,
      window.setTimeout(() => el.removeAttribute('data-scrolling'), 700),
    );
  },
  { capture: true, passive: true },
);
