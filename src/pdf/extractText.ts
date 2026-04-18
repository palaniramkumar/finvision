import * as pdfjs from 'pdfjs-dist'

/** Default cap — keeps browser + model memory predictable (plan: context limits). */
export const DEFAULT_MAX_CHARS = 28_000

/** pdf.js `PasswordException` codes (see pdfjs-dist PasswordResponses). */
export const PDF_PASSWORD_NEED = 1
export const PDF_PASSWORD_INCORRECT = 2

export function isPdfPasswordRequired(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'PasswordException' &&
    (err as { code?: number }).code === PDF_PASSWORD_NEED
  )
}

export function isPdfPasswordIncorrect(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'PasswordException' &&
    (err as { code?: number }).code === PDF_PASSWORD_INCORRECT
  )
}

export type ExtractResult = {
  text: string
  /** Plain text per PDF page (index 0 = page 1). Same order as pdf.js pages. */
  textByPage: string[]
  pages: number
  truncated: boolean
  charCount: number
  charCap: number
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function configurePdfWorker(): void {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
}

/**
 * Extract plain text from a PDF ArrayBuffer. DOM-free — safe to reuse from native wrappers later.
 * @param password Optional owner/user password for encrypted PDFs (pdf.js `getDocument` option).
 */
export async function extractTextFromPdf(
  data: ArrayBuffer,
  maxChars: number = DEFAULT_MAX_CHARS,
  password?: string,
): Promise<ExtractResult> {
  configurePdfWorker()
  const src = new Uint8Array(data)
  const opts: Parameters<typeof pdfjs.getDocument>[0] = { data: src }
  if (password !== undefined && password.length > 0) {
    opts.password = password
  }
  const doc = await pdfjs.getDocument(opts).promise
  const pages = doc.numPages
  const parts: string[] = []
  const textByPage: string[] = []
  let total = 0
  let truncated = false

  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    const chunk = normalizeWhitespace(pageText)
    textByPage.push(chunk)
    if (!chunk) continue
    const header = `\n\n--- Page ${p} ---\n`
    const add = header + chunk
    if (total + add.length > maxChars) {
      const rest = maxChars - total - header.length
      if (rest > 80) {
        parts.push(header + chunk.slice(0, rest) + '\n[…truncated]')
        total = maxChars
      }
      truncated = true
      break
    }
    parts.push(add)
    total += add.length
  }

  return {
    text: normalizeWhitespace(parts.join('')),
    textByPage,
    pages,
    truncated,
    charCount: total,
    charCap: maxChars,
  }
}

const PAGE_MARKER_SPLIT = /\n\n--- Page \d+ ---\n/

/**
 * Recover per-page segments from stored extract text that includes `--- Page N ---` markers.
 * Returns null if no markers (legacy or non-paged extract).
 */
export function splitTextByPdfPageMarkers(fullText: string): string[] | null {
  if (!fullText.includes('--- Page ') || !/--- Page \d+ ---/.test(fullText)) return null
  const bits = fullText.split(PAGE_MARKER_SPLIT).map((s) => normalizeWhitespace(s))
  const pages = bits.filter((s) => s.length > 0)
  return pages.length > 0 ? pages : null
}
