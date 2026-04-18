import { DEFAULT_MAX_CHARS, extractTextFromPdf } from './pdf/extractText'

export interface ExtractedTransaction {
  date: string
  description: string
  amount: number
  rawText: string
}

/** Match currency amounts at end of a line (e.g. -12.99, ($45.00), 1,234.56) */
const AMOUNT_RE = /(?:\(?\$?\s*([\d,]+\.\d{2})\s*\)?|\(?\s*([\d,]+\.\d{2})\s*\)?)\s*$/i

/** Optional leading date MM/DD, MM/DD/YY, YYYY-MM-DD */
const DATE_PREFIX_RE = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})\b\s*/

function parseAmount(raw: string): number | null {
  const m = raw.replace(/,/g, '').match(/-?\d+\.\d{2}/)
  if (!m) return null
  const n = Number.parseFloat(m[0])
  return Number.isFinite(n) ? n : null
}

function linesToTransactions(fullText: string): ExtractedTransaction[] {
  const lines = fullText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3)
  const out: ExtractedTransaction[] = []

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ')
    const amtMatch = line.match(AMOUNT_RE)
    if (!amtMatch) continue
    const amountStr = (amtMatch[1] ?? amtMatch[2] ?? '').replace(/,/g, '')
    const amount = parseAmount(amountStr)
    if (amount === null) continue

    let rest = line.slice(0, amtMatch.index).trim()
    let date = ''
    const dm = rest.match(DATE_PREFIX_RE)
    if (dm) {
      date = dm[1] ?? ''
      rest = rest.slice(dm[0].length).trim()
    }
    const description = rest || 'Transaction'
    out.push({
      date,
      description,
      amount,
      rawText: line,
    })
  }

  return out
}

/**
 * Extract simple line-based transactions from a PDF for the Ledger / zero-shot demo.
 * Uses the same pdf.js path as `extractTextFromPdf`; heuristics are best-effort.
 */
export async function parsePdf(file: File): Promise<ExtractedTransaction[]> {
  const buf = await file.arrayBuffer()
  const { text } = await extractTextFromPdf(buf, DEFAULT_MAX_CHARS)
  const txs = linesToTransactions(text)
  return txs.length > 0 ? txs : [{ date: '', description: 'No line items parsed', amount: 0, rawText: text.slice(0, 500) }]
}
