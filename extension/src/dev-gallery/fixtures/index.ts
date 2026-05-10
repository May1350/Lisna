// Aggregator. Each per-category fixture file exports a `fixtures` array
// (named export `xxxFixtures`); we concatenate them here.
//
// Adding a new fixture:
// 1. Open or create the appropriate category file in this directory.
// 2. Append a new GalleryFixture to its array.
// 3. Vite HMR picks the change up automatically — no edits needed here.

import type { GalleryFixture } from './types'
import { authFixtures } from './01-auth'
import { recordingFixtures } from './02-recording'
import { transcriptFixtures } from './03-transcript'
import { outlineFixtures } from './04-outline'
import { notesExportFixtures } from './05-notes-export'
import { quotaFixtures } from './06-quota'
import { errorFixtures } from './07-errors'
import { modalFixtures } from './08-modals'
import { optionsFixtures } from './09-options'
import { historyFixtures } from './10-history'

export const fixtures: GalleryFixture[] = [
  ...authFixtures,
  ...recordingFixtures,
  ...transcriptFixtures,
  ...outlineFixtures,
  ...notesExportFixtures,
  ...quotaFixtures,
  ...errorFixtures,
  ...modalFixtures,
  ...optionsFixtures,
  ...historyFixtures,
]
