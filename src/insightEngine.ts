import { pipeline, env } from '@huggingface/transformers'
import type { ExtractedTransaction } from './pdfParser'

env.allowLocalModels = false
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1
}

export type { ExtractedTransaction } from './pdfParser'

export interface CategorizedTransaction extends ExtractedTransaction {
  category: string
}

export interface StatementSummary {
  totalIncome: number
  totalExpense: number
  netFlow: number
  transactions: CategorizedTransaction[]
  categoryDistribution: Record<string, number>
}

const KEYWORD_MAP: Record<string, string> = {
  amazon: 'Shopping',
  target: 'Shopping',
  walmart: 'Shopping',
  apple: 'Shopping',
  delta: 'Holidays',
  'american airlines': 'Holidays',
  hotel: 'Holidays',
  dividend: 'Dividend Income',
  vanguard: 'Dividend Income',
  fidelity: 'Dividend Income',
  'pg&e': 'Utilities',
  water: 'Utilities',
  electric: 'Utilities',
  salary: 'Salary',
  payroll: 'Salary',
  'uber eats': 'Food',
  doordash: 'Food',
  restaurant: 'Food',
}

export const CLASSIFIER_MODEL_OPTIONS = [
  { id: 'Xenova/mobilebert-uncased-mnli', label: 'MobileBERT MNLI (default)' },
  { id: 'Xenova/distilbert-base-uncased-mnli', label: 'DistilBERT MNLI' },
] as const

export type ClassifierModelId = (typeof CLASSIFIER_MODEL_OPTIONS)[number]['id']

let classifierPipeline: unknown = null
let classifierModelId: ClassifierModelId = CLASSIFIER_MODEL_OPTIONS[0].id

export function webgpuSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu)
}

export function getClassifierModelId(): ClassifierModelId {
  return classifierModelId
}

export function setClassifierModelId(modelId: string): void {
  const ok = CLASSIFIER_MODEL_OPTIONS.some((o) => o.id === modelId)
  classifierModelId = (ok ? modelId : CLASSIFIER_MODEL_OPTIONS[0].id) as ClassifierModelId
  disposeClassifier()
}

export function disposeClassifier(): void {
  const p = classifierPipeline as { dispose?: () => void | Promise<void> } | null
  classifierPipeline = null
  if (p && typeof p.dispose === 'function') void p.dispose()
}

export async function initAI(): Promise<void> {
  if (classifierPipeline) return
  console.log('Initializing zero-shot model:', classifierModelId)
  classifierPipeline = await pipeline('zero-shot-classification', classifierModelId)
  console.log('Model loaded successfully')
}

type ClassifierFn = (
  text: string,
  labels: string[],
  opts: { multi_label: boolean },
) => Promise<{ labels: string[]; scores: number[] }>

export async function processTransactions(transactions: ExtractedTransaction[]): Promise<StatementSummary> {
  const summary: StatementSummary = {
    totalIncome: 0,
    totalExpense: 0,
    netFlow: 0,
    transactions: [],
    categoryDistribution: {},
  }

  if (!classifierPipeline) {
    await initAI()
  }
  const classify = classifierPipeline as ClassifierFn

  for (const trx of transactions) {
    let category = 'Other'
    const descLower = trx.description.toLowerCase()

    for (const [kw, cat] of Object.entries(KEYWORD_MAP)) {
      if (descLower.includes(kw)) {
        category = cat
        break
      }
    }

    if (category === 'Other' && trx.description.length > 3) {
      try {
        const applicableCategories =
          trx.amount > 0
            ? ['Dividend Income', 'Salary', 'Refund']
            : ['Shopping', 'Holidays', 'Utilities', 'Food', 'Subscription']

        const result = await classify(trx.description, applicableCategories, {
          multi_label: false,
        })

        if (result.scores[0] > 0.3) {
          category = result.labels[0]
        }
      } catch (err) {
        console.error('AI Classification failed for:', trx.description, err)
      }
    }

    let normalizedAmount = trx.amount
    if (['Shopping', 'Holidays', 'Utilities', 'Food', 'Subscription'].includes(category)) {
      normalizedAmount = -Math.abs(trx.amount)
    } else if (['Salary', 'Dividend Income', 'Refund'].includes(category)) {
      normalizedAmount = Math.abs(trx.amount)
    }

    if (normalizedAmount >= 0) {
      summary.totalIncome += normalizedAmount
    } else {
      summary.totalExpense += Math.abs(normalizedAmount)
    }

    summary.netFlow += normalizedAmount

    summary.transactions.push({
      ...trx,
      amount: normalizedAmount,
      category,
    })

    if (!summary.categoryDistribution[category]) summary.categoryDistribution[category] = 0
    summary.categoryDistribution[category] += Math.abs(normalizedAmount)
  }

  return summary
}
