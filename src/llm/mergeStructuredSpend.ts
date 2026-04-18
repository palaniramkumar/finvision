import type { StructuredSpend, WeeklyExpense } from './parseStructuredSpend'

/**
 * Merge structured JSON from multiple statement segments (e.g. PDF pages).
 *
 * CRITICAL UPDATE: Instead of trusting the model's summary calculations (which often fail or hallucinate),
 * we now compute Totals and Weekly Spending directly from the individual Transaction list.
 */
export function mergeStructuredSpendParts(parts: StructuredSpend[]): StructuredSpend | null {
  if (parts.length === 0) return null

  // 1. Merge all individual transactions
  const allTransactions = parts.flatMap((p) => p.transactions)
  if (allTransactions.length === 0) {
    // Fallback to basic merge if no transactions but parts exist (unlikely with deep extraction)
    return {
      currency: parts.find((p) => p.currency)?.currency ?? null,
      totalIncome: parts.find((p) => p.totalIncome != null)?.totalIncome ?? null,
      totalExpenses: parts.find((p) => p.totalExpenses != null)?.totalExpenses ?? null,
      weeklyExpenses: [],
      transactions: [],
    }
  }

  // 2. Calculate totals from transactions
  let calculatedIncome = 0
  let calculatedExpenses = 0
  allTransactions.forEach((t) => {
    if (t.type === 'credit') calculatedIncome += t.amount
    else calculatedExpenses += t.amount
  })

  // 3. Generate Weekly Buckets (7-day intervals)
  // Sort by date to find the range
  const sorted = [...allTransactions]
    .filter((t) => t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    .sort((a, b) => a.date.localeCompare(b.date))

  const weeklyExpenses: WeeklyExpense[] = []

  if (sorted.length > 0) {
    const firstDate = new Date(sorted[0].date)
    const lastDate = new Date(sorted[sorted.length - 1].date)

    let currentStart = new Date(firstDate)
    while (currentStart <= lastDate) {
      const currentEnd = new Date(currentStart)
      currentEnd.setDate(currentEnd.getDate() + 6)

      const startStr = currentStart.toISOString().split('T')[0]
      const endStr = currentEnd.toISOString().split('T')[0]

      const weekAmount = sorted
        .filter((t) => t.date >= startStr && t.date <= endStr && t.type === 'debit')
        .reduce((sum, t) => sum + t.amount, 0)

      weeklyExpenses.push({
        weekStart: startStr,
        weekEnd: endStr,
        amount: Math.round(weekAmount * 100) / 100,
      })

      currentStart.setDate(currentStart.getDate() + 7)
    }
  }

  return {
    currency: parts.find((p) => p.currency)?.currency ?? null,
    totalIncome: Math.round(calculatedIncome * 100) / 100,
    totalExpenses: Math.round(calculatedExpenses * 100) / 100,
    weeklyExpenses,
    transactions: allTransactions,
  }
}
