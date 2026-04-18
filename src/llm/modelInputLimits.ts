import type { ModelId } from './models'

/**
 * Browser ONNX + WebGPU builds use int32 shapes internally. Very long prompts can
 * make attention / buffer size calculations overflow ("SafeIntOnOverflow").
 * Keep the *statement* portion sent to the model well below theoretical context limits.
 *
 * Tune per model if you still see OrtRun overflow on huge PDFs.
 */
const MAX_STATEMENT_CHARS: Record<ModelId, number> = {
  'gemma-4-e2b': 7000,
  'phi-4-mini': 7000,
  'llama-3.2-1b': 7000,
}

/** @deprecated Prefer getMaxStatementChars(modelId) */
export const MAX_STATEMENT_CHARS_FOR_MODEL = MAX_STATEMENT_CHARS['gemma-4-e2b']

export function getMaxStatementChars(modelId: ModelId): number {
  return MAX_STATEMENT_CHARS[modelId]
}

export type ClipResult = {
  text: string
  wasTruncated: boolean
  extractedCharCount: number
  sentCharCount: number
}

export function clipStatementForModel(fullStatementText: string, modelId: ModelId): ClipResult {
  const cap = MAX_STATEMENT_CHARS[modelId]
  const extractedCharCount = fullStatementText.length
  if (extractedCharCount <= cap) {
    return {
      text: fullStatementText,
      wasTruncated: false,
      extractedCharCount,
      sentCharCount: extractedCharCount,
    }
  }
  const slice = fullStatementText.slice(0, cap)
  return {
    text:
      slice +
      '\n\n[… truncated before model: browser ONNX has a safe input size limit; see beginning of statement above …]',
    wasTruncated: true,
    extractedCharCount,
    sentCharCount: slice.length,
  }
}

/** Split long text into consecutive slices each at most `cap` chars (paginated / dense-page fallback). */
export function chunkTextByCharBudget(text: string, modelId: ModelId): string[] {
  const cap = MAX_STATEMENT_CHARS[modelId]
  const t = text.trim()
  if (t.length <= cap) return t ? [t] : []
  const out: string[] = []
  for (let i = 0; i < t.length; i += cap) {
    out.push(t.slice(i, i + cap))
  }
  return out
}
