import { formatTimestamp } from './llm.js'

export interface MarkdownInput {
  title: string
  notes: { ts: number; text: string; important: boolean }[]
  slides: { ts: number; url: string }[]
}

export function buildMarkdown(input: MarkdownInput): Buffer {
  const lines: string[] = []
  lines.push(`# ${input.title}`)
  lines.push('')
  lines.push('## ノート')
  for (const n of input.notes) {
    const ts = formatTimestamp(n.ts)
    if (n.important) lines.push(`- **[${ts}]** ⭐ ${n.text}`)
    else lines.push(`- [${ts}] ${n.text}`)
  }
  lines.push('')
  lines.push('## スライド')
  for (const s of input.slides) {
    const ts = formatTimestamp(s.ts)
    lines.push(`![${ts}](${s.url})`)
  }
  lines.push('')
  return Buffer.from(lines.join('\n'), 'utf8')
}
