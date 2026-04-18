/**
 * Best-effort currency guess from raw statement text (symbols, ISO codes, common phrases).
 * Used when structured JSON has no currency or an invalid code — complements the LLM, not a source of truth.
 */

const ISO_CODES = [
  'AED',
  'ARS',
  'AUD',
  'BHD',
  'BRL',
  'CAD',
  'CHF',
  'CLP',
  'CNY',
  'COP',
  'CZK',
  'DKK',
  'EGP',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PKR',
  'PLN',
  'QAR',
  'RON',
  'SAR',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'TWD',
  'USD',
  'VND',
  'ZAR',
] as const

function firstIsoIn(s: string): string | null {
  const m = s.match(new RegExp(`\\b(${ISO_CODES.join('|')})\\b`, 'i'))
  return m?.[1] ? m[1].toUpperCase() : null
}

function dominantIsoIn(s: string, minCount = 2): string | null {
  const counts = new Map<string, number>()
  let m: RegExpExecArray | null
  const re = new RegExp(`\\b(${ISO_CODES.join('|')})\\b`, 'gi')
  while ((m = re.exec(s)) !== null) {
    const c = m[1].toUpperCase()
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best: string | null = null
  let n = 0
  for (const [code, k] of counts) {
    if (k > n) {
      n = k
      best = code
    }
  }
  return n >= minCount ? best : null
}

export function inferCurrencyFromStatementText(text: string): string | null {
  if (!text || text.length < 8) return null
  const head = text.slice(0, 4000)
  const sample = text.length > 24_000 ? `${text.slice(0, 12_000)}\n${text.slice(-12_000)}` : text

  // Strong symbols / phrases (header-weighted)
  if (/[\u20B9]|\bINR\b|\bRs\.?\s*[\d,]|\brupees?\b/i.test(head)) return 'INR'
  if (/[\u20AC]|\bEUR\b/i.test(head)) return 'EUR'
  if (/[\u00A3]|£\s*[\d,.]|\bGBP\b/i.test(head)) return 'GBP'
  if (/\bJPY\b|¥\s*[\d,]|\u00a5\s*[\d,]/i.test(head)) return 'JPY'
  if (/\bCNY\b|\bRMB\b|\u5143/i.test(head)) return 'CNY'
  if (/\bCHF\b|\bFr\.\s*[\d,]/i.test(head)) return 'CHF'

  if (/\bCAD\b|C\$/i.test(head)) return 'CAD'
  if (/\bAUD\b|A\$/i.test(head)) return 'AUD'
  if (/\bNZD\b|NZ\$/i.test(head)) return 'NZD'
  if (/\bSGD\b|S\$/i.test(head)) return 'SGD'
  if (/\bHKD\b|HK\$/i.test(head)) return 'HKD'
  if (/\bUSD\b|US\$/i.test(head)) return 'USD'
  if (/\$\s*[\d,]/.test(head) && !/\b(CAD|AUD|NZD|SGD|HKD)\b/i.test(head)) return 'USD'

  const headIso = firstIsoIn(head)
  if (headIso) return headIso

  const dom = dominantIsoIn(sample, 2)
  if (dom) return dom

  const any = firstIsoIn(sample)
  return any
}
