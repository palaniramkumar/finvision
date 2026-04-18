import type { Message } from '@huggingface/transformers'
import { mergeStructuredSpendParts } from './mergeStructuredSpend'
import { buildStructuredExtractMessages } from './structuredExtractPrompt'
import {
  chunkTextByCharBudget,
  clipStatementForModel,
  getMaxStatementChars,
} from './modelInputLimits'
import { inferCurrencyFromStatementText } from './inferCurrencyFromText'
import { friendlyInferenceError } from './inferenceErrors'
import { parseStructuredSpend, type StructuredSpend } from './parseStructuredSpend'
import {
  buildConsolidateAcrossPagesMessages,
  buildMessages,
  buildMessagesForStatementSegment,
} from './prompts'
import { generateFromLoadedModel } from './session'
import type { ModelId } from './models'
import { splitTextByPdfPageMarkers } from '../pdf/extractText'

export { buildMessages } from './prompts'
export { getMaxStatementChars, MAX_STATEMENT_CHARS_FOR_MODEL } from './modelInputLimits'
export type { StructuredSpend } from './parseStructuredSpend'

const CHART_JSON_PREVIEW_CHARS = 220

export type ChartJsonDiagnostics =
  | { kind: 'ok' }
  | { kind: 'generate_failed'; message: string }
  | { kind: 'parse_failed'; preview?: string }
  | { kind: 'no_weekly_rows' }

export type AnalysisMode = 'single' | 'paginated'

function clipDiagnosticPreview(s: string): string {
  const t = s.trim()
  if (t.length <= CHART_JSON_PREVIEW_CHARS) return t
  return `${t.slice(0, CHART_JSON_PREVIEW_CHARS)}…`
}

function withInferredCurrency(data: StructuredSpend, statementText: string): StructuredSpend {
  if (data.currency) return data
  const guess = inferCurrencyFromStatementText(statementText)
  if (!guess) return data
  return { ...data, currency: guess }
}

type AnalysisUnit = { text: string; label: string }

function buildAnalysisUnits(
  statementText: string,
  modelId: ModelId,
  paginated: boolean,
  textByPage?: string[] | null,
): { units: AnalysisUnit[]; extractedCharCount: number; anyCharChunkBeyondOne: boolean } {
  const extractedCharCount = statementText.length
  if (!paginated) {
    const c = clipStatementForModel(statementText, modelId)
    return {
      units: [{ text: c.text, label: '' }],
      extractedCharCount,
      anyCharChunkBeyondOne: false,
    }
  }

  const cap = getMaxStatementChars(modelId)
  let pages = textByPage
  if (!pages || pages.length === 0) {
    pages = splitTextByPdfPageMarkers(statementText) ?? null
  }

  const units: AnalysisUnit[] = []
  let anyCharChunkBeyondOne = false

  if (pages && pages.length > 0) {
    const totalP = pages.length
    let currentBatchText = ''
    let batchStartPage = 1

    for (let i = 0; i < pages.length; i++) {
      const pageText = pages[i] ?? ''
      const pageNum = i + 1

      // If a single page is ALREADY over the cap, it must be chunked alone.
      if (pageText.length > cap) {
        // Flush any existing batch first
        if (currentBatchText) {
          units.push({
            text: currentBatchText,
            label: `Statement segment: PDF pages ${batchStartPage}${i > batchStartPage - 1 ? `-${i}` : ''} of ${totalP}.`,
          })
          currentBatchText = ''
        }

        const chunks = chunkTextByCharBudget(pageText, modelId)
        if (chunks.length > 1) anyCharChunkBeyondOne = true
        const tp = chunks.length
        for (let j = 0; j < chunks.length; j++) {
          units.push({
            text: chunks[j]!,
            label: `Statement segment: PDF page ${pageNum} of ${totalP} (part ${j + 1}/${tp}; exceeds character budget).`,
          })
        }
        batchStartPage = i + 2
        continue
      }

      // If adding this page exceeds the cap, flush the current batch
      if (currentBatchText.length + pageText.length > cap && currentBatchText.length > 0) {
        units.push({
          text: currentBatchText,
          label: `Statement segment: PDF pages ${batchStartPage}${i > batchStartPage ? `-${i}` : ''} of ${totalP}.`,
        })
        currentBatchText = pageText
        batchStartPage = pageNum
      } else {
        // Otherwise, add to current batch
        if (currentBatchText) currentBatchText += '\n\n'
        currentBatchText += pageText
      }
    }

    // Flush final batch
    if (currentBatchText) {
      units.push({
        text: currentBatchText,
        label: `Statement segment: PDF pages ${batchStartPage}${pages.length > batchStartPage ? `-${pages.length}` : ''} of ${totalP}.`,
      })
    }
  } else {
    const chunks = chunkTextByCharBudget(statementText, modelId)
    if (chunks.length > 1) anyCharChunkBeyondOne = true
    const tc = chunks.length
    for (let j = 0; j < chunks.length; j++) {
      units.push({
        text: chunks[j]!,
        label: `Statement segment ${j + 1} of ${tc} (character-sized chunks; max ${cap.toLocaleString()} characters per pass).`,
      })
    }
  }

  return { units, extractedCharCount, anyCharChunkBeyondOne }
}

export type AnalyzeStatementResult = {
  markdown: string
  structured: StructuredSpend | null
  chartJsonDiagnostics: ChartJsonDiagnostics
  modelInputTruncated: boolean
  extractedCharCount: number
  sentCharCount: number
  analysisMode: AnalysisMode
  unitsProcessed: number
  /** True when multi-segment run was merged into one Markdown summary via a final model pass. */
  consolidatedAcrossPages: boolean
}

export async function analyzeStatementText(
  statementText: string,
  options: {
    modelId: ModelId
    maxNewTokens?: number
    onStreamChunk?: (chunk: string) => void
    paginated?: boolean
    textByPage?: string[] | null
    /** `stepIndex` is 1-based; `totalSteps` includes the final merge step when paginated (e.g. 5 pages → 6 steps). */
    onSegmentProgress?: (label: string, stepIndex: number, totalSteps: number) => void
  },
): Promise<AnalyzeStatementResult> {
  const maxPrimary = options.maxNewTokens ?? 512
  const paginated = Boolean(options.paginated)
  const { units, extractedCharCount, anyCharChunkBeyondOne } = buildAnalysisUnits(
    statementText,
    options.modelId,
    paginated,
    options.textByPage,
  )

  const sentCharCount = units.reduce((n, u) => n + u.text.length, 0)

  const clipOnce = clipStatementForModel(statementText, options.modelId)
  const modelInputTruncated = paginated
    ? units.length > 1 || anyCharChunkBeyondOne
    : clipOnce.wasTruncated

  if (units.length === 0) {
    return {
      markdown: '',
      structured: null,
      chartJsonDiagnostics: { kind: 'generate_failed', message: 'No statement text to analyze.' },
      modelInputTruncated,
      extractedCharCount,
      sentCharCount: 0,
      analysisMode: 'single',
      unitsProcessed: 0,
      consolidatedAcrossPages: false,
    }
  }

  if (!paginated || units.length === 1) {
    const u = units[0]!
    const messages: Message[] =
      u.label.length > 0
        ? buildMessagesForStatementSegment(u.label, u.text)
        : buildMessages(u.text)
    const markdown = await generateFromLoadedModel(messages, {
      maxNewTokens: maxPrimary,
      onStreamChunk: options.onStreamChunk,
    })

    let structured: StructuredSpend | null = null
    let chartJsonDiagnostics: ChartJsonDiagnostics = { kind: 'ok' }

    try {
      const extractMessages = buildStructuredExtractMessages(u.text, u.label || undefined)
      const rawJson = await generateFromLoadedModel(extractMessages, {
        maxNewTokens: 5120,
      })
      const trimmed = typeof rawJson === 'string' ? rawJson.trim() : ''
      if (!trimmed) {
        structured = null
        chartJsonDiagnostics = {
          kind: 'generate_failed',
          message: 'The model returned no text for the chart JSON pass.',
        }
      } else {
        structured = parseStructuredSpend(rawJson)
        if (!structured) {
          chartJsonDiagnostics = { kind: 'parse_failed', preview: clipDiagnosticPreview(trimmed) }
        } else {
          structured = withInferredCurrency(structured, statementText)
          if (structured.weeklyExpenses.length === 0) {
            chartJsonDiagnostics = { kind: 'no_weekly_rows' }
          } else {
            chartJsonDiagnostics = { kind: 'ok' }
          }
        }
      }
    } catch (e) {
      structured = null
      const raw = e instanceof Error ? e.message : String(e)
      chartJsonDiagnostics = {
        kind: 'generate_failed',
        message: friendlyInferenceError(raw),
      }
    }

    return {
      markdown,
      structured,
      chartJsonDiagnostics,
      modelInputTruncated,
      extractedCharCount,
      sentCharCount,
      analysisMode: options.paginated ? 'paginated' : 'single',
      unitsProcessed: 1,
      consolidatedAcrossPages: false,
    }
  }

  const mdParts: string[] = []
  const jsonParts: StructuredSpend[] = []
  let chartJsonDiagnostics: ChartJsonDiagnostics = { kind: 'ok' }
  const total = units.length
  const totalSteps = total + 1

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!
    options.onSegmentProgress?.(u.label, i + 1, totalSteps)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const messages = buildMessagesForStatementSegment(u.label, u.text)
    const md = await generateFromLoadedModel(messages, {
      maxNewTokens: maxPrimary,
    })
    mdParts.push(`## ${u.label.replace(/^Statement segment:\s*/i, '').trim() || `Segment ${i + 1}`}\n\n${md}`)

    try {
      const extractMessages = buildStructuredExtractMessages(u.text, u.label)
      const rawJson = await generateFromLoadedModel(extractMessages, {
        maxNewTokens: 5120,
      })
      const trimmed = typeof rawJson === 'string' ? rawJson.trim() : ''
      if (!trimmed) {
        chartJsonDiagnostics = {
          kind: 'generate_failed',
          message: `Chart JSON pass returned empty text on segment ${i + 1} of ${total}.`,
        }
        break
      } else {
        const parsed = parseStructuredSpend(rawJson)
        if (!parsed) {
          chartJsonDiagnostics = {
            kind: 'parse_failed',
            preview: clipDiagnosticPreview(trimmed),
          }
          break
        } else {
          jsonParts.push(parsed)
        }
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      chartJsonDiagnostics = {
        kind: 'generate_failed',
        message: friendlyInferenceError(
          `Segment ${i + 1} of ${total}: ${raw}`,
        ),
      }
      break
    }
  }

  let structured: StructuredSpend | null =
    jsonParts.length > 0 ? mergeStructuredSpendParts(jsonParts) : null
  if (structured) {
    structured = withInferredCurrency(structured, statementText)
    if (chartJsonDiagnostics.kind === 'ok' && structured.weeklyExpenses.length === 0) {
      chartJsonDiagnostics = { kind: 'no_weekly_rows' }
    }
  }

  const combinedDraft = mdParts.join('\n\n---\n\n')
  const clipForConsolidate = clipStatementForModel(combinedDraft, options.modelId)
  let markdown = combinedDraft
  let consolidatedAcrossPages = false

  options.onSegmentProgress?.('Merging all pages into one summary…', totalSteps, totalSteps)
  await new Promise((resolve) => setTimeout(resolve, 50))

  try {
    const consolidateMessages = buildConsolidateAcrossPagesMessages(
      clipForConsolidate.text,
      units.length,
      clipForConsolidate.wasTruncated,
    )
    markdown = await generateFromLoadedModel(consolidateMessages, {
      maxNewTokens: 2048,
      onStreamChunk: options.onStreamChunk,
    })
    consolidatedAcrossPages = true
    if (clipForConsolidate.wasTruncated) {
      markdown =
        `> **Note:** The merge step saw only the first ${clipForConsolidate.sentCharCount.toLocaleString()} characters of combined page drafts (model input limit). Verify important totals against your PDF.\n\n` +
        markdown
    }
  } catch {
    markdown = `> **Note:** Could not run the final merge step; showing per-page analyses below.\n\n${combinedDraft}`
    consolidatedAcrossPages = false
  }

  return {
    markdown,
    structured,
    chartJsonDiagnostics,
    modelInputTruncated,
    extractedCharCount,
    sentCharCount,
    analysisMode: 'paginated',
    unitsProcessed: units.length,
    consolidatedAcrossPages,
  }
}
