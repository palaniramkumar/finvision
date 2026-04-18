import type { Message } from '@huggingface/transformers'
import { generateFromLoadedModel } from './session'
import { getTransactionsByDocId } from '../storage/archiveDb'

/** Safe limit to prevent WebGPU OOM / OrtRun crashes in browser models. */
const MAX_CHAT_CONTEXT_CHARS = 8000

const CHAT_SYSTEM_PROMPT = `You are a helpful financial assistant directly answering questions about a banking or credit card statement. You have the extracted statement text (and sometimes structured data) as context.

Rules:
- Be concise, direct, and conversational.
- Answer queries about transactions, groups, patterns, and totals by strictly referring to the provided statement text.
- If asked to 'group', 'list', or 'categorize', use Markdown tables or bullet lists.
- If the requested information is NOT in the context, say so clearly. Do not invent transactions.
- You can treat certain transactions as requested by the user's prompt (e.g. if the user says "Any Zerodha transaction is an investment", acknowledge this and categorize it as such in your responses).
- Format currency and numbers clearly.`

let chatHistory: Message[] = []
let baseContext = ''
let activeDocId: string | undefined = undefined
let uniqueMerchants: string[] = []
let uniqueCategories: string[] = []

/**
 * Initializes the chat session with the full statement context and stored transactions.
 */
export async function initChatSession(
  statementText: string,
  docId?: string,
  structuredJson?: string
): Promise<void> {
  activeDocId = docId
  uniqueMerchants = []
  uniqueCategories = []

  let metadataSummary = ''
  if (docId) {
    try {
      const txs = await getTransactionsByDocId(docId)
      if (txs && txs.length > 0) {
        // Build a unique "Menu" of categories and merchants to help the model know what exists
        const merchants = new Set<string>()
        const categories = new Set<string>()
        txs.forEach(t => {
          if (t.category) categories.add(t.category)
          // Simple normalized merchant name (top 3 words)
          const cleanDesc = (t.description || '').split(/\s+/).slice(0, 3).join(' ').trim().toUpperCase()
          if (cleanDesc && cleanDesc.length > 2) merchants.add(cleanDesc)
        })
        uniqueMerchants = Array.from(merchants).slice(0, 100) // limit summary size
        uniqueCategories = Array.from(categories)

        metadataSummary = `\n<<<SUMMARY_MENU>>>\nUnique Categories: ${uniqueCategories.join(', ')}\nUnique Merchants found in text: ${uniqueMerchants.join(', ')}\n`
      }
    } catch (e) {
      console.warn('Failed to load transactions for chat context', e)
    }
  }

  // Combine components into baseContext
  const contextParts = [
    '<<<STATEMENT_DATA>>>',
    statementText,
    structuredJson ? `\n<<<STRUCTURED_DATA_JSON>>>\n${structuredJson}` : '',
    metadataSummary,
    '<<<END_DATA>>>'
  ]
  
  baseContext = contextParts.join('\n')
  
  // Clip to safe limit to prevent OrtRun crashes
  if (baseContext.length > MAX_CHAT_CONTEXT_CHARS) {
    baseContext = baseContext.slice(0, MAX_CHAT_CONTEXT_CHARS) + 
      '\n\n[... Context clipped for model safety. If you need details on a specific merchant, please ask by name ...]'
  }
  
  chatHistory = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT }
  ]
}

/**
 * Clears chat history.
 */
export function resetChatSession(): void {
  chatHistory = []
  baseContext = ''
  activeDocId = undefined
  uniqueMerchants = []
  uniqueCategories = []
}

export async function sendChatMessage(
  userMessage: string,
  onStreamChunk?: (chunk: string) => void,
  onToolUse?: (toolName: string) => void
): Promise<string> {
  // If no history, re-init with empty context (fallback)
  if (chatHistory.length === 0) {
    chatHistory = [{ role: 'system', content: CHAT_SYSTEM_PROMPT }]
  }

  let finalUserContent = userMessage

  // Inject context only into the first user message to save tokens on subsequent turns
  if (chatHistory.length === 1) {
    let dynamicTransactions = ''
    
    // SMART DYNAMIC RETRIEVAL:
    // If query mentions known merchants or categories, inject specific matching rows
    if (activeDocId && (uniqueMerchants.length > 0 || uniqueCategories.length > 0)) {
      const qUpper = userMessage.toUpperCase()
      const matchedM = uniqueMerchants.filter(m => qUpper.includes(m))
      const matchedC = uniqueCategories.filter(c => qUpper.includes(c.toUpperCase()))
      
      if (matchedM.length > 0 || matchedC.length > 0) {
        onToolUse?.(`Searching database for: ${[...matchedM, ...matchedC].join(', ')}...`)
        try {
          const all = await getTransactionsByDocId(activeDocId)
          const filtered = all.filter(t => {
            const d = (t.description || '').toUpperCase()
            const c = (t.category || '').toUpperCase()
            return matchedM.some(m => d.includes(m)) || matchedC.some(cat => c === cat)
          })
          
          if (filtered.length > 0) {
            dynamicTransactions = '\n<<<RELEVANT_TRANSACTIONS>>>\n' + 
              filtered.map(t => `${t.date}: ${t.description} | ${t.amount} [${t.category || ''}]`).join('\n')
          }
        } catch (e) {
          console.warn('Smart filter failed', e)
        }
      }
    }

    finalUserContent = `${baseContext}\n${dynamicTransactions}\n\nUser query: ${userMessage}`
  }

  const newMessage: Message = { role: 'user', content: finalUserContent }
  const messagesToSend = [...chatHistory, newMessage]

  const responseText = await generateFromLoadedModel(messagesToSend, {
    maxNewTokens: 800,
    onStreamChunk
  })

  // Append original short message to history to keep subsequent steps lean
  chatHistory.push({ role: 'user', content: userMessage })
  chatHistory.push({ role: 'assistant', content: responseText })

  return responseText
}
