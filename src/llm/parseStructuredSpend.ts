export type WeeklyExpense = {
  weekStart: string
  weekEnd: string
  amount: number
}

export type Transaction = {
  date: string
  description: string
  amount: number
  type: 'credit' | 'debit'
  category?: string
}

export type StructuredSpend = {
  currency: string | null
  totalIncome: number | null
  totalExpenses: number | null
  weeklyExpenses: WeeklyExpense[]
  transactions: Transaction[]
}

function stripJsonFences(text: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fence?.[1]) return fence[1].trim()
  return text.trim()
}

function findJsonObject(text: string): string | null {
  const t = stripJsonFences(text)
  const start = t.indexOf('{')
  if (start < 0) return null
  
  // Try to find a balanced object
  let depth = 0
  for (let i = start; i < t.length; i++) {
    const c = t[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return t.slice(start, i + 1)
    }
  }

  // If we reach here, the JSON is likely truncated (depth > 0)
  return t.slice(start)
}

/**
 * Attempts to repair truncated JSON by closing unclosed strings, objects, and arrays.
 */
function repairJson(json: string): string {
  let repaired = json.trim()
  
  // 1. If currently inside a string, close it
  // Count unescaped double quotes
  let quoteCount = 0
  for (let i = 0; i < repaired.length; i++) {
    if (repaired[i] === '"' && (i === 0 || repaired[i-1] !== '\\')) {
      quoteCount++
    }
  }
  if (quoteCount % 2 !== 0) {
    repaired += '"'
  }

  // 2. Count braces and brackets to close them
  let openBraces = 0
  let openBrackets = 0
  
  // We use a simple count; this doesn't handle strings with { } inside, 
  // but for LLM output truncation it's usually enough.
  for (let i = 0; i < repaired.length; i++) {
    const c = repaired[i]
    // Only count if not in string (rough check)
    if (c === '{') openBraces++
    else if (c === '}') openBraces--
    else if (c === '[') openBrackets++
    else if (c === ']') openBrackets--
  }

  // Close from inside out (roughly)
  while (openBrackets > 0) {
    repaired += ']'
    openBrackets--
  }
  while (openBraces > 0) {
    repaired += '}'
    openBraces--
  }

  return repaired
}

function regexExtractTransactions(text: string): Transaction[] {
  const transactions: Transaction[] = []
  // Pull out objects roughly matching JSON structures
  // Note: we use [^{}]* to handle partial fields between braces
  const blockRegex = /\{[^{}]*?"date"\s*:\s*".*?"[^{}]*?\}/g
  const matches = text.match(blockRegex)
  if (!matches) return []

  for (const m of matches) {
    try {
      const dateMatch = /"date"\s*:\s*"([^"]+)"/.exec(m)
      const descMatch = /"description"\s*:\s*"([^"]+)"/.exec(m)
      const amtMatch = /"amount"\s*:\s*(-?[\d,.]+)/.exec(m)
      const typeMatch = /"type"\s*:\s*"([^"]+)"/.exec(m)

      if (dateMatch && amtMatch) {
        const rawDate = dateMatch[1]
        const cleanDate = normalizeIsoDate(rawDate) || ''
        const amount = parseFiniteAmount(amtMatch[1])
        const type = typeMatch?.[1] === 'credit' ? 'credit' : 'debit'
        const description = (descMatch?.[1] || 'Transaction').trim()

        if (amount !== null) {
          transactions.push({
            date: cleanDate,
            description,
            amount: Math.abs(amount),
            type,
            category: 'Other',
          })
        }
      }
    } catch {
      // Skip broken partial objects
    }
  }
  return transactions
}

function isIsoYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/** 
 * Hardened Date Normalization: Handles ISO-8601 plus common Indian banking formats 
 * like DD-MM-YYYY or DD/MM/YYYY.
 */
function normalizeIsoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (t === '') return null

  // 1. Strict ISO YYYY-MM-DD
  if (isIsoYmd(t.slice(0, 10))) return t.slice(0, 10)

  // 2. Handle YYYY/MM/DD or YYYY.MM.DD
  if (/^\d{4}[/.]\d{2}[/.]\d{2}/.test(t)) {
    return `${t.slice(0, 4)}-${t.slice(5, 7)}-${t.slice(8, 10)}`
  }

  // 3. Handle DD-MM-YYYY or DD/MM/YYYY (Common in Indian bank statements)
  const dmyMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t)
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0')
    const m = dmyMatch[2].padStart(2, '0')
    const y = dmyMatch[3]
    return `${y}-${m}-${d}`
  }

  return null
}

function parseFiniteAmount(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const t = raw.trim().replace(/,/g, '')
    if (t === '') return null
    const v = Number(t)
    return Number.isFinite(v) ? v : null
  }
  return null
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** Uppercase ISO 4217 letters only; otherwise null (caller may infer from statement text). */
export function normalizeCurrencyCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const t = String(raw).trim().toUpperCase().replace(/\s+/g, '')
  if (/^[A-Z]{3}$/.test(t)) return t
  return null
}

export function parseStructuredSpend(modelOutput: string): StructuredSpend | null {
  const rawJsonStr = findJsonObject(modelOutput)
  if (!rawJsonStr) return null

  let parsed: any = null
  let parseMethod: 'normal' | 'repaired' | 'fallback' = 'normal'

  // Attempt 1: Normal JSON parse
  try {
    parsed = JSON.parse(rawJsonStr)
  } catch {
    // Attempt 2: Repair truncated JSON
    try {
      const repaired = repairJson(rawJsonStr)
      parsed = JSON.parse(repaired)
      parseMethod = 'repaired'
    } catch {
      parseMethod = 'fallback'
    }
  }

  // If standard/repaired parsing failed, use Regex fallback to salvage transactions
  if (parseMethod === 'fallback') {
    const salvaged = regexExtractTransactions(modelOutput)
    if (salvaged.length === 0) return null
    return {
      currency: normalizeCurrencyCode(modelOutput.match(/"currency"\s*:\s*"([^"]+)"/)?.[1]),
      totalIncome: null,
      totalExpenses: null,
      weeklyExpenses: [],
      transactions: salvaged
    }
  }

  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>

  const currency = normalizeCurrencyCode(o.currency)
  const totalIncome =
    o.totalIncome === null || o.totalIncome === undefined
      ? null
      : isFiniteNumber(o.totalIncome)
        ? o.totalIncome
        : null
  const totalExpenses =
    o.totalExpenses === null || o.totalExpenses === undefined
      ? null
      : isFiniteNumber(o.totalExpenses)
        ? o.totalExpenses
        : null

  const rawWeeks = Array.isArray(o.weeklyExpenses) ? o.weeklyExpenses : []
  const weeklyExpenses: WeeklyExpense[] = []
  if (rawWeeks.length > 0) {
  for (const item of rawWeeks) {
    if (!item || typeof item !== 'object') continue
    const w = item as Record<string, unknown>
    const weekStart = normalizeIsoDate(w.weekStart)
    const weekEnd = normalizeIsoDate(w.weekEnd)
    if (!weekStart || !weekEnd) continue
    const amt = parseFiniteAmount(w.amount)
    if (amt === null) continue
    weeklyExpenses.push({
      weekStart,
      weekEnd,
      amount: Math.max(0, amt),
    })
  }
}

  const transactions: Transaction[] = []
  if (Array.isArray(o.transactions)) {
    for (const item of o.transactions) {
      if (!item || typeof item !== 'object') continue
      const t = item as Record<string, unknown>
      const date = normalizeIsoDate(t.date) || ''
      const description = String(t.description || '').trim()
      const amount = parseFiniteAmount(t.amount)
      if (amount === null) continue
      const type = t.type === 'credit' ? 'credit' : 'debit'

      transactions.push({
        date,
        description,
        amount: Math.abs(amount),
        type,
        category: typeof t.category === 'string' && t.category.trim() ? t.category.trim() : 'Other',
      })
    }
  }

  return {
    currency,
    totalIncome,
    totalExpenses,
    weeklyExpenses,
    transactions,
  }
}
