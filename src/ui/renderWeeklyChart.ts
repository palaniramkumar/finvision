import type { ChartJsonDiagnostics } from '../llm/analyzeStatement'
import type { StructuredSpend } from '../llm/parseStructuredSpend'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatCurrency(amount: number, currencyCode: string | null): string {
  const code = currencyCode?.toUpperCase() || 'INR'
  const locale = code === 'INR' ? 'en-IN' : 'en-US'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${code} ${amount.toLocaleString()}`
  }
}

function diagnosticsBlock(d: ChartJsonDiagnostics | null | undefined): string {
  if (!d || d.kind === 'ok') return ''
  if (d.kind === 'generate_failed') {
    return `<p class="weekly-chart__diagnostics" role="status"><strong>Chart JSON step:</strong> ${escapeHtml(d.message)}</p>`
  }
  if (d.kind === 'parse_failed') {
    const pre = d.preview
      ? `<pre class="weekly-chart__raw-preview">${escapeHtml(d.preview)}</pre><p class="weekly-chart__preview-caption">Start of model output (trimmed).</p>`
      : ''
    return `<p class="weekly-chart__diagnostics" role="status"><strong>Chart JSON step:</strong> The model output was not valid structured JSON (expected an object with weeklyExpenses and ISO week dates).</p>${pre}`
  }
  if (d.kind === 'no_weekly_rows') {
    return `<p class="weekly-chart__diagnostics" role="status"><strong>Weekly chart:</strong> JSON parsed, but nothing could be drawn—<code>weeklyExpenses</code> was empty or every row failed validation (calendar dates as <code>YYYY-MM-DD</code> and amounts as numbers; comma-separated number strings are accepted).</p>`
  }
  return ''
}

export function renderWeeklyChartHtml(
  data: StructuredSpend | null,
  diagnostics?: ChartJsonDiagnostics | null,
): string {
  const hasData = (data?.transactions?.length ?? 0) > 0 || (data?.weeklyExpenses?.length ?? 0) > 0
  const diagHtml = hasData ? '' : diagnosticsBlock(diagnostics)

  if (!data || (data.weeklyExpenses.length === 0 && (data.transactions?.length ?? 0) === 0)) {
    const summary =
      diagnostics?.kind === 'no_weekly_rows'
        ? ''
        : diagnostics?.kind === 'generate_failed'
          ? 'Weekly chart was skipped because the structured JSON generation step did not complete successfully.'
          : diagnostics?.kind === 'parse_failed'
            ? 'Weekly chart was skipped because the model output could not be read as chart JSON.'
            : 'No chart data this run. The model may not have returned valid JSON, or the statement did not support weekly totals.'

    return `
      <div class="weekly-chart weekly-chart--empty" role="region" aria-label="Weekly spend chart">
        <h3 class="weekly-chart__title">Weekly spend (inferred)</h3>
        ${diagHtml}
        ${summary ? `<p class="weekly-chart__empty-msg">${escapeHtml(summary)}</p>` : ''}
        <p class="weekly-chart__disclaimer">Figures are model-inferred, not from a bank API—verify against your statement.</p>
      </div>
    `.trim()
  }

  const max = Math.max(...data.weeklyExpenses.map((w) => w.amount), 1)
  const cur = data.currency

  const kpis: string[] = []
  if (data.totalExpenses !== null && Number.isFinite(data.totalExpenses)) {
    kpis.push(
      `<div class="weekly-chart__kpi"><span class="weekly-chart__kpi-label">Total expenses (inferred)</span><span class="weekly-chart__kpi-value">${escapeHtml(formatMoney(data.totalExpenses, cur))}</span></div>`,
    )
  }
  if (data.totalIncome !== null && Number.isFinite(data.totalIncome)) {
    kpis.push(
      `<div class="weekly-chart__kpi"><span class="weekly-chart__kpi-label">Total income (inferred)</span><span class="weekly-chart__kpi-value">${escapeHtml(formatMoney(data.totalIncome, cur))}</span></div>`,
    )
  }

  const bars = data.weeklyExpenses
    .map((w) => {
      const pct = Math.round((w.amount / max) * 100)
      const label = `${w.weekStart} – ${w.weekEnd}`
      const tip = `${label}: ${formatMoney(w.amount, cur)}`
      return `
        <div class="weekly-chart__col" title="${escapeHtml(tip)}">
          <div class="weekly-chart__bar-wrap">
            <div class="weekly-chart__bar" style="height:${pct}%"></div>
          </div>
          <div class="weekly-chart__col-label">${escapeHtml(w.weekStart.slice(5))}</div>
        </div>
      `.trim()
    })
    .join('')

  const kpiRow = kpis.length ? `<div class="weekly-chart__kpis">${kpis.join('')}</div>` : ''

  return `
    <div class="weekly-chart" role="region" aria-label="Weekly spend chart">
      <h3 class="weekly-chart__title">Weekly spend (inferred)</h3>
      ${kpiRow}
      <div class="weekly-chart__plot" role="img" aria-label="Bar chart of weekly expense totals">
        ${bars}
      </div>
      <p class="weekly-chart__disclaimer">Figures are model-inferred, not from a bank API—verify against your statement.</p>
    </div>
  `.trim()
}
