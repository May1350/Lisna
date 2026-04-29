// Quick preview tool: takes a baseline JSON (saved by eval-curator.ts)
// and renders the outline through the Obsidian markdown formatter, so
// we can eyeball what the .md export will look like before shipping.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outlineToObsidianMarkdown } from '../src/lib/markdown-obsidian.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const baselineName = process.argv[2] ?? 'v4-gpt5nano'
const sourceUrl = process.argv[3] ?? 'https://www.youtube.com/watch?v=JGXIB-dJCMM'

const baselinePath = join(__dirname, '..', 'tests', 'fixtures', 'baselines', `${baselineName}.json`)
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const outline = baseline.results[0].outline

const md = outlineToObsidianMarkdown(outline, {
  sourceUrl,
  sessionId: `preview-${baselineName}`,
  generatedAt: new Date(),
  lectureDate: new Date().toISOString().slice(0, 10),
})

const outPath = join(__dirname, '..', 'tests', 'fixtures', `preview-${baselineName}.md`)
writeFileSync(outPath, md)
console.log(`Wrote ${md.length} chars → ${outPath}`)
console.log('\n══════════════ FIRST 80 LINES ══════════════\n')
console.log(md.split('\n').slice(0, 80).join('\n'))
