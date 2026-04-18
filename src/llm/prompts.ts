import type { Message } from '@huggingface/transformers'

export const SYSTEM_PROMPT = `You are a careful assistant that reads bank or credit card statement text (extracted from a PDF) and explains it in plain language.

Rules:
- Output Markdown with these sections in order: ## Overview, ## Statement period (if inferable), ## Spending patterns, ## Notable transactions, ## Risks or anomalies, ## Disclaimer
- In ## Overview, state the statement currency when you can infer it (ISO 4217 code such as INR, USD, EUR, plus how you inferred it: header text, symbol, or explicit label). If currency is ambiguous (e.g. bare "$" with no region), say it is unclear and list possibilities briefly. If opening/closing balance or statement totals appear, mention them here with figures taken only from the text.
- Stay grounded in the pasted statement: if there are no posted debits/credits (e.g. the extract is a form, brochure, or questionnaire), say that clearly in Overview and keep other sections short—do not invent transactions or generic investment questionnaires.
- Use bullet lists where helpful. Do not invent account numbers; redact or omit if unclear.
- If the text is incomplete or ambiguous, say so briefly.
- The Disclaimer section must state that this is not financial or tax advice and figures must be verified against the original PDF.

For the **Spending patterns** section (be concrete, not generic):
- Describe **where money moved**: payee / narration / merchant strings as they appear, **amounts** from the lines when possible, and **rails** when visible (UPI, NEFT/RTGS/IMPS, card, ATM, cash deposit, ECS/NACH, fees, interest, forex, internal transfer).
- **Volume**: characterize activity (e.g. many small UPI debits vs a few large transfers); if approximate counts or density are inferable from the listing, state them; otherwise describe qualitatively without inventing counts.
- **Grouping**: cluster by **theme** from narration (e.g. investments/broker, loan/EMI/repayment, rent or P2P transfers, subscriptions, fuel/retail, government/tax, salary/credits). Call out **recurring counterparties** when the same name appears on multiple lines.
- If the statement shows totals (total debits/credits, summaries by type), repeat those figures and relate them to the line items you cite.

For the **Notable transactions** section:
- Highlight **named line items**: debit vs credit, amount, date if shown, counterparty/narration from the text—avoid vague phrases like "several UPI payments" with no names or amounts.
- For a long statement, aim for about **5–12** representative rows, mixing the **largest** amounts and **recurring** patterns (same payee or same narration prefix). For a short statement, list every material line you see.`

export function buildUserContent(statementText: string): string {
  return [
    'Analyze the following statement text. It is wrapped between delimiters; treat delimiter lines as boundaries, not as financial data.',
    'Ground spending and "notable transactions" in **specific lines**: payee/narration, amount, date if shown, and rail (UPI, NEFT, card, etc.). Avoid generic summaries when the text lists real debits and credits.',
    '',
    '<<<STATEMENT_TEXT>>>',
    statementText,
    '<<<END_STATEMENT_TEXT>>>',
  ].join('\n')
}

export function buildMessages(statementText: string): Message[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserContent(statementText) },
  ]
}

const SEGMENT_SYSTEM_ADDENDUM = `

When the user message starts with a "Statement segment" line, you are seeing only part of a longer PDF. Analyze only that segment; do not assume balances from missing pages. Mention partial coverage briefly in Overview if important.`

export function buildMessagesForStatementSegment(segmentTitle: string, statementText: string): Message[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT + SEGMENT_SYSTEM_ADDENDUM },
    {
      role: 'user',
      content: [
        segmentTitle,
        '',
        'Ground spending and notable rows in **specific lines** from this segment (payee/narration, amount, date, rail). Avoid generic wording when line items are present.',
        '',
        '<<<STATEMENT_TEXT>>>',
        statementText,
        '<<<END_STATEMENT_TEXT>>>',
      ].join('\n'),
    },
  ]
}

const CONSOLIDATE_SYSTEM = `You merge several Markdown analyses of the SAME bank or credit card statement. Each block was produced independently from one PDF page or text segment, so there is overlap and repeated section headers.

Your task: write ONE cohesive Markdown report for the reader using exactly these sections in this order:
## Overview
## Statement period
## Spending patterns
## Notable transactions
## Risks or anomalies
## Disclaimer

Rules:
- Synthesize across ALL segments; remove duplicate intros and repeated "this segment only" disclaimers where the unified story is clear.
- Reconcile currency and date range once in Overview / Statement period when evidence agrees; briefly note any ambiguity left after merging.
- Preserve **concrete** content from the drafts: payee names, narrations, rails (UPI/NEFT/etc.), amounts, and dates. **Spending patterns** should read like a real money story—group by category/theme and by channel, mention transaction **volume** (counts or density) when the drafts support it—not a generic essay.
- **Notable transactions**: merge into one prioritized list (largest + recurring first); **STRICTLY DEDUPE** the same transaction if it appeared on multiple pages or overlapping segments. **NEVER** repeat the exact same transaction text line multiple times in the final report.
- If the underlying text was clearly not a transaction statement (e.g. questionnaire only), say so once in Overview and avoid fabricated spending analysis.
- Do not structure the body as "page 1 / page 2"; this must read as a single document.
- Disclaimer must say this is not financial or tax advice and figures must be verified against the original PDF.`

export function buildConsolidateAcrossPagesMessages(
  combinedPageMarkdown: string,
  segmentCount: number,
  wasInputClipped: boolean,
): Message[] {
  const clipNote = wasInputClipped
    ? '\n(Note: the combined drafts below were truncated to fit this pass—merge what is present and mention that full drafts exist in the app if key totals are missing.)\n'
    : ''
  return [
    { role: 'system', content: CONSOLIDATE_SYSTEM },
    {
      role: 'user',
      content: [
        `There are ${segmentCount} segment-level Markdown drafts below.${clipNote}`,
        'Produce the single consolidated report as instructed.',
        '',
        '<<<COMBINED_PAGE_DRAFTS>>>',
        combinedPageMarkdown,
        '<<<END_COMBINED>>>',
      ].join('\n'),
    },
  ]
}
