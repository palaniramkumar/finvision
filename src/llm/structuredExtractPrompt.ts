import type { Message } from '@huggingface/transformers'

const SYSTEM = `You extract structured financial summary data from bank or credit card statement text.

Rules:
- Reply with ONLY valid JSON (no markdown fences, no commentary).
- Schema exactly:
{"transactions":[{"date":"YYYY-MM-DD","description":"...","amount":0,"type":"credit|debit","category":"..."}],"currency":"USD","totalIncome":null,"totalExpenses":null,"weeklyExpenses":[{"weekStart":"YYYY-MM-DD","weekEnd":"YYYY-MM-DD","amount":0}]}
- currency: ISO 4217 code (e.g., "INR" for Rupees, "USD" for Dollars). Look for "INR", "Rs.", "₹", or "USD" in the text.
- Use ISO dates YYYY-MM-DD (e.g., "21-Jan-2026" or "21/01/26" MUST be converted to "2026-01-21").
- Use null for totalIncome or totalExpenses when unknown.
- weeklyExpenses: at most 12 objects; use empty array [] if you cannot infer weeks.
- transactions: extract ALL individual line items. 
- type: MUST be "credit" for money in (deposits, salary, refunds, column 'Credit') or "debit" for money out (UPI, payments, withdrawals, column 'Debit', or lead minus sign '-').
- amount: ALWAYS a positive JSON number (the direction is handled by the "type" field).
- description: clean name of the merchant or transaction type.
- category: mandatory short label (e.g. Cafe, Fuel, Food, Shopping, Transport, Rent, Investment, Income, Subscription, Utility, etc.). Always provide a category; use 'Other' only as a last resort.

Currency (ISO 4217, uppercase 3-letter string, or null only if truly absent):
- Read headers, footers, column labels, and transaction lines for currency clues.
- Explicit codes (INR, USD, EUR, GBP, CAD, AUD, SGD, AED, SAR, JPY, etc.) always win when they describe the statement amounts.
- Symbols: ₹ or "Rs"/"Re"/"INR" → INR; € → EUR; £ → GBP; ¥ with Japan context → JPY; ¥ or 元/CNY/RMB → CNY when clear.
- Dollar sign $: prefer USD/US$/text "USD"; use CAD/C$/ "Canadian dollar" for Canada; AUD/A$ for Australia; otherwise null if ambiguous.
- Phrases like "Amount in INR", "All figures in USD", "Currency: EUR" map directly.
- If multiple currencies appear (e.g. forex), pick the one that clearly labels the main balance and posted amounts; if still unclear, null.`

export function buildStructuredExtractMessages(statementText: string, segmentHint?: string): Message[] {
  const user = [
    segmentHint ? `${segmentHint}\n` : '',
    'From the following statement text only, produce the JSON object described in your system instructions.',
    '',
    '<<<STATEMENT_TEXT>>>',
    statementText,
    '<<<END_STATEMENT_TEXT>>>',
  ].join('\n')

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]
}
