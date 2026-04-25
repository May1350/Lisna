import PDFDocument from 'pdfkit'
import { formatTimestamp } from './llm.js'

export interface PdfInput {
  title: string
  notes: { ts: number; text: string; important: boolean }[]
  slides: { ts: number; data: Buffer }[]
}

export async function buildPdf(input: PdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  doc.fontSize(20).text(input.title, { align: 'center' })
  doc.moveDown()

  for (const n of input.notes) {
    const tsStr = `[${formatTimestamp(n.ts)}]`
    if (n.important) doc.fontSize(12).fillColor('red').text(`⭐ ${tsStr} ${n.text}`)
    else doc.fontSize(11).fillColor('black').text(`${tsStr} ${n.text}`)
    doc.moveDown(0.3)
  }

  for (const s of input.slides) {
    doc.addPage()
    doc.fontSize(10).fillColor('gray').text(`スライド @ ${formatTimestamp(s.ts)}`)
    doc.image(s.data, { fit: [500, 300], align: 'center' })
  }

  doc.end()
  return await done
}
