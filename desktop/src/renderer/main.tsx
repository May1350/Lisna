import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

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
