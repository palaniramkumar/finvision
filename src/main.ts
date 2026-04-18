import './styles/app.css'
import { marked } from 'marked'
import {
  DEFAULT_MAX_CHARS,
  extractTextFromPdf,
  isPdfPasswordIncorrect,
  isPdfPasswordRequired,
  splitTextByPdfPageMarkers,
  type ExtractResult,
} from './pdf/extractText'
import { analyzeStatementText } from './llm/analyzeStatement'
import { friendlyInferenceError } from './llm/inferenceErrors'
import { getMaxStatementChars } from './llm/modelInputLimits'
import type { StructuredSpend } from './llm/parseStructuredSpend'
import { DEFAULT_MODEL_ID, isValidModelId, MODEL_CONFIG, type ModelId } from './llm/models'
import { loadModel, unloadSession, webgpuSupported, getLoadedModelId } from './llm/session'
import { initChatSession, sendChatMessage, resetChatSession } from './llm/chatSession'
import type { ProgressInfo } from './llm/types'
import * as archiveDb from './storage/archiveDb'
import type { ArchiveDocument } from './storage/archiveDb'
import { getAppShellHtml } from './ui/shellLayout'
import { renderWeeklyChartHtml } from './ui/renderWeeklyChart'

const PREFERRED_MODEL_STORAGE_KEY = 'finvision:preferredModel'
const PAGINATED_ANALYSIS_STORAGE_KEY = 'finvision:paginatedAnalysis'

const ANALYZE_FOR_INSIGHTS_HINT =
  ' Click Analyze to run the model — step 4 (Insights) appears in the Analysis section (between this card and the progress bar).'

let lastTextByPage: string[] | null = null
/** Archive ids from the most recent multi-PDF upload (primary Analyze runs all when length ≥ 2). */
let lastBatchArchiveIds: string[] = []

type Step = 'upload' | 'ready' | 'analyze' | 'results'
type AppView = 'dashboard' | 'archive'

let currentStep: Step = 'upload'
let extractedText = ''
let fileName = ''
let pendingPdfBuffer: ArrayBuffer | null = null
let currentArchiveId: string | null = null
let archiveSearchQuery = ''
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

function readStoredModelId(): ModelId {
  try {
    const raw = localStorage.getItem(PREFERRED_MODEL_STORAGE_KEY)
    if (raw && isValidModelId(raw)) return raw
  } catch {
    /* ignore */
  }
  return DEFAULT_MODEL_ID
}

let selectedModelId: ModelId = readStoredModelId()

const $ = (sel: string, root: ParentNode = document) => root.querySelector(sel) as HTMLElement

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function stripScripts(html: string): string {
  const d = document.createElement('div')
  d.innerHTML = html
  d.querySelectorAll('script, iframe, object, embed').forEach((el) => el.remove())
  d.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name)
    }
  })
  return d.innerHTML
}

function updateCharCapTip(): void {
  const el = document.getElementById('tips-char-cap')
  if (el) el.textContent = String(getMaxStatementChars(selectedModelId))
}

function clearResultsUi(): void {
  $('#results').hidden = true
  $('#results-body').textContent = ''

  const execSummary = document.getElementById('executive-summary')
  if (execSummary) execSummary.hidden = true
  const execContent = document.getElementById('executive-summary-content')
  if (execContent) execContent.textContent = ''

  const chatTool = document.getElementById('chat-tool-container')
  if (chatTool) chatTool.hidden = true

  // reset chat history to its default state
  const chatHistory = document.getElementById('chat-history')
  if (chatHistory) {
    chatHistory.innerHTML = `
      <div class="chat-message chat-message--bot">
          <div class="chat-message__avatar">
             <span class="material-symbols-outlined">smart_toy</span>
          </div>
          <div class="chat-message__bubble">
              I've analyzed your statement. You can ask me to list specific transactions, group them differently, or summarize any category. (e.g. "which transactions are related to Zerodha?")
          </div>
      </div>`
  }

  const chart = document.getElementById('weekly-chart-wrap')
  if (chart) chart.innerHTML = ''
}

function setDropzoneCompact(on: boolean): void {
  document.getElementById('dropzone')?.classList.toggle('dropzone--compact', on)
}

function scrollResultsIntoView(): void {
  const el = document.getElementById('results')
  if (!el || el.hidden) return
  queueMicrotask(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function parseArchivedStructuredSpend(raw: string | undefined): StructuredSpend | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return null
    const s = o as StructuredSpend
    if (!Array.isArray(s.weeklyExpenses)) return null
    return s
  } catch {
    return null
  }
}

/** Restore Analysis + chart from IndexedDB after the user clicks Open on an analyzed archive row. */
async function showArchivedAnalysisResults(doc: ArchiveDocument): Promise<void> {
  const md = doc.markdownPreview?.trim() ?? ''
  if (!md) return

  if (doc.modelId && isValidModelId(doc.modelId)) {
    selectedModelId = doc.modelId
    const sel = document.getElementById('model-select') as HTMLSelectElement | null
    if (sel) sel.value = selectedModelId
    updateCharCapTip()
  }

  const modelLabel =
    doc.modelId && isValidModelId(doc.modelId)
      ? MODEL_CONFIG[doc.modelId].progressLabel
      : doc.modelId
        ? escapeHtml(String(doc.modelId))
        : 'the saved model'

  const truncNote =
    md.length >= archiveDb.MAX_MARKDOWN_PREVIEW_CHARS
      ? ` Narrative was stored with a cap of <strong>${archiveDb.MAX_MARKDOWN_PREVIEW_CHARS.toLocaleString()}</strong> characters — the end may be cut off until you run <strong>Analyze</strong> again.`
      : ''

  const notice = `<p class="model-truncate-notice" role="status"><strong>Archive:</strong> Showing the last saved analysis for this file (${modelLabel}).${truncNote}</p>`

  const structured = parseArchivedStructuredSpend(doc.structuredJson)
  const body = $('#results-body')
  const chartWrap = document.getElementById('weekly-chart-wrap')
  const parsed = await marked.parse(md, { async: true })
  body.innerHTML = notice + stripScripts(parsed)
  if (chartWrap) chartWrap.innerHTML = renderWeeklyChartHtml(structured, null)
  $('#results').hidden = false

  // Initialize chat session for archived document
  await initChatSession(doc.extractedText ?? '', doc.id, doc.structuredJson)

  // Pre-emptively load the model for chat if it's different or not loaded
  if (webgpuSupported() && getLoadedModelId() !== selectedModelId) {
    void loadModel(selectedModelId).catch(err => console.warn('Background model load failed', err))
  }

  const chatTool = document.getElementById('chat-tool-container')
  if (chatTool) chatTool.hidden = false
  const chatSubmit = document.getElementById('chat-submit') as HTMLButtonElement | null
  if (chatSubmit) chatSubmit.disabled = false
}

function setView(view: AppView): void {
  const dash = document.getElementById('view-dashboard')
  const arch = document.getElementById('view-archive')
  const navDash = document.getElementById('nav-dashboard')
  const navArch = document.getElementById('nav-archive')
  if (dash) dash.hidden = view !== 'dashboard'
  if (arch) arch.hidden = view !== 'archive'
  navDash?.classList.toggle('app-sidenav__link--active', view === 'dashboard')
  navArch?.classList.toggle('app-sidenav__link--active', view === 'archive')
  if (view === 'archive') void refreshArchiveLists()
}

function formatArchiveWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return String(ts)
  }
}

function statusChip(doc: ArchiveDocument): { cls: string; label: string } {
  if (doc.status === 'analyzed') return { cls: 'extraction-card__chip extraction-card__chip--ok', label: 'Analyzed' }
  if (doc.status === 'error') return { cls: 'extraction-card__chip extraction-card__chip--err', label: 'Error' }
  return { cls: 'extraction-card__chip', label: 'Extracted' }
}

function archiveCardHtml(doc: ArchiveDocument, fullActions: boolean): string {
  const chip = statusChip(doc)
  const iconClass =
    doc.status === 'error'
      ? 'extraction-card__icon extraction-card__icon--error'
      : doc.status === 'analyzed'
        ? 'extraction-card__icon extraction-card__icon--analyzed'
        : 'extraction-card__icon'
  const errNote =
    doc.status === 'error' && doc.errorMessage
      ? `<p class="extraction-card__err-note">${escapeHtml(doc.errorMessage.length > MAX_ARCHIVE_CARD_ERROR_CHARS ? `${doc.errorMessage.slice(0, MAX_ARCHIVE_CARD_ERROR_CHARS)}…` : doc.errorMessage)}</p>`
      : ''
  const delBtn = fullActions
    ? `<button type="button" class="btn-ghost btn-ghost-danger" data-archive-action="delete" data-archive-id="${escapeHtml(doc.id)}">Delete</button>`
    : ''
  return `
    <article class="extraction-card">
      <div class="extraction-card__main">
        <div class="${iconClass}" aria-hidden="true">
          <span class="material-symbols-outlined">description</span>
        </div>
        <div>
          <h3 class="extraction-card__name">${escapeHtml(doc.fileName)}</h3>
          <p class="extraction-card__meta">${doc.pages} page(s) · ${doc.charCount.toLocaleString()} chars · ${formatArchiveWhen(doc.updatedAt)}${doc.modelId ? ` · ${escapeHtml(String(doc.modelId))}` : ''}</p>
          ${errNote}
        </div>
      </div>
      <div class="extraction-card__actions">
        <span class="${chip.cls}">${chip.label}</span>
        <button type="button" class="btn-ghost" data-archive-action="open" data-archive-id="${escapeHtml(doc.id)}">Open</button>
        ${delBtn}
      </div>
    </article>
  `.trim()
}

function filterDocs(docs: ArchiveDocument[]): ArchiveDocument[] {
  const q = archiveSearchQuery.trim().toLowerCase()
  if (!q) return docs
  return docs.filter((d) => d.fileName.toLowerCase().includes(q))
}

async function refreshArchiveLists(): Promise<void> {
  const all = await archiveDb.listRecent(100)
  const filtered = filterDocs(all)

  const dashList = document.getElementById('dashboard-recent-list')
  const dashEmpty = document.getElementById('dashboard-recent-empty')
  if (dashList && dashEmpty) {
    const dashDocs = filtered.slice(0, 6)
    dashList.innerHTML = dashDocs.map((d) => archiveCardHtml(d, false)).join('')
    dashEmpty.hidden = dashDocs.length > 0
  }

  const archList = document.getElementById('archive-full-list')
  const archEmpty = document.getElementById('archive-empty')
  if (archList && archEmpty) {
    archList.innerHTML = filtered.map((d) => archiveCardHtml(d, true)).join('')
    archEmpty.hidden = filtered.length > 0
  }
}

function renderShell(): void {
  const app = $('#app')
  app.innerHTML = getAppShellHtml()

  const sel = document.getElementById('model-select') as HTMLSelectElement
  sel.value = selectedModelId
  updateCharCapTip()
}

function setWebGpuPill(): void {
  const el = document.getElementById('webgpu-pill')
  if (!el) return
  if (webgpuSupported()) {
    el.className = 'webgpu-pill ok'
    el.textContent = 'WebGPU available — local ONNX inference enabled for this session.'
  } else {
    el.className = 'webgpu-pill warn'
    el.textContent =
      'WebGPU not detected. Local Gemma/Phi/Llama inference will not run. Try Chrome or Edge on desktop with GPU support.'
  }
}

function updateSteps(): void {
  document.querySelectorAll('.steps [data-step]').forEach((n) => {
    const step = n.getAttribute('data-step') as Step
    n.classList.toggle('active', step === currentStep)
  })
}

function clearProgressSegmentSub(): void {
  const el = document.getElementById('progress-segment-sub')
  if (!el) return
  el.textContent = ''
  el.hidden = true
}

function setProgress(percent: number, label: string, detail: string): void {
  clearProgressSegmentSub()
  const wrap = $('#progress-wrap')
  const fill = $('#progress-fill')
  const p = Math.max(0, Math.min(100, percent))
  fill.style.width = `${p}%`
  wrap.setAttribute('aria-valuenow', String(Math.round(p)))
  $('#progress-label').textContent = label
  $('#progress-detail').textContent = detail
}

/** Paginated runs: show PDF page, overall step count (incl. merge), and fill the bar by step/total. */
function describePaginatedSegmentProgress(
  label: string,
  step: number,
  totalSteps: number,
): { pct: number; headline: string; detail: string; segmentSub: string } {
  const pct = totalSteps > 0 ? Math.max(1, Math.min(100, Math.round((step / totalSteps) * 100))) : 1
  const merge = label.toLowerCase().includes('merging')
  const overall = `Overall progress: step ${step} of ${totalSteps} for this statement.`

  if (merge) {
    return {
      pct,
      headline: 'Final merge — all pages',
      detail: overall,
      segmentSub:
        'One last model pass combines every page into a single summary; streamed Markdown appears in Analysis when output starts.',
    }
  }

  const pdf = /PDF page (\d+) of (\d+)/i.exec(label)
  const chunkPart = /part (\d+)\/(\d+)/i.exec(label)
  if (pdf) {
    const p1 = pdf[1]
    const p2 = pdf[2]
    const chunkNote = chunkPart
      ? ` This page is split into ${chunkPart[2]} model pass(es) for the size cap; current pass ${chunkPart[1]} of ${chunkPart[2]}.`
      : ''
    return {
      pct,
      headline: `PDF page ${p1} of ${p2}`,
      detail: overall,
      segmentSub: `Processing PDF page ${p1} of ${p2}.${chunkNote} Each pass runs narrative analysis then chart JSON before continuing.`,
    }
  }

  const seg = /segment (\d+) of (\d+)/i.exec(label)
  if (seg) {
    return {
      pct,
      headline: `Statement segment ${seg[1]} of ${seg[2]}`,
      detail: overall,
      segmentSub: label,
    }
  }

  return {
    pct,
    headline: `Step ${step} of ${totalSteps}`,
    detail: overall,
    segmentSub: label,
  }
}

function setPaginatedSegmentProgressUi(label: string, step: number, totalSteps: number): void {
  const { pct, headline, detail, segmentSub } = describePaginatedSegmentProgress(label, step, totalSteps)
  const wrap = $('#progress-wrap')
  const fill = $('#progress-fill')
  fill.style.width = `${pct}%`
  wrap.setAttribute('aria-valuenow', String(pct))
  $('#progress-label').textContent = headline
  $('#progress-detail').textContent = detail
  const sub = document.getElementById('progress-segment-sub')
  if (sub) {
    sub.textContent = segmentSub
    sub.hidden = !segmentSub
  }
}

function mapLoadProgress(info: ProgressInfo): number {
  if (info.status === 'progress' && typeof info.progress === 'number') return info.progress
  if (info.status === 'progress_total' && typeof info.progress === 'number') return info.progress
  return -1
}

function setExtractError(message: string | null): void {
  const el = $('#extract-error')
  if (!message) {
    el.hidden = true
    el.textContent = ''
    return
  }
  el.hidden = false
  el.textContent = message
}

const MAX_ARCHIVE_CARD_ERROR_CHARS = 280

function setAnalyzeError(message: string | null): void {
  const el = document.getElementById('analyze-error')
  if (!el) return
  if (!message) {
    el.hidden = true
    el.textContent = ''
    return
  }
  el.hidden = false
  el.textContent = message
}

function setAnalysisResultsPlaceholder(paginated: boolean): void {
  const body = $('#results-body')
  const sub = paginated
    ? 'Each PDF page is analyzed separately, then we merge everything into one summary. This takes longer than a single pass—thanks for your patience.'
    : 'The model is working on your statement. This may take a little while on first run while weights load.'
  body.innerHTML = `
    <div class="analysis-placeholder" role="status">
      <p class="analysis-placeholder__title">Crafting your analysis</p>
      <p class="analysis-placeholder__text">${escapeHtml(sub)}</p>
      <p class="analysis-placeholder__detail" id="analysis-placeholder-detail"></p>
      <div class="analysis-placeholder__dots" aria-hidden="true"><span></span><span></span><span></span></div>
    </div>
  `.trim()
}

function showPdfPasswordModal(): void {
  const modal = $('#pdf-password-modal')
  modal.hidden = false
  const err = $('#pdf-password-error')
  err.hidden = true
  err.textContent = ''
  const input = document.getElementById('pdf-password-input') as HTMLInputElement
  input.value = ''
  queueMicrotask(() => input.focus())
}

function hidePdfPasswordModal(): void {
  $('#pdf-password-modal').hidden = true
  pendingPdfBuffer = null
  const input = document.getElementById('pdf-password-input') as HTMLInputElement
  input.value = ''
  $('#pdf-password-error').hidden = true
}

async function finishExtractSuccess(res: ExtractResult): Promise<void> {
  extractedText = res.text
  lastTextByPage = res.textByPage.length > 0 ? res.textByPage : splitTextByPdfPageMarkers(res.text) ?? null
  $('#meta-card').hidden = false
  $('#file-label').textContent = fileName
  $('#chip-status').className = 'chip chip-ready'
  $('#chip-status').textContent = 'Ready'
  const trunc = res.truncated ? ` Text truncated to ${res.charCap.toLocaleString()} characters.` : ''
  $('#meta-detail').textContent = `${res.pages} page(s) · ${res.charCount.toLocaleString()} characters extracted.${trunc}${ANALYZE_FOR_INSIGHTS_HINT}`

  const canAnalyze = webgpuSupported() && extractedText.length > 0
    ; (document.getElementById('btn-analyze') as HTMLButtonElement).disabled = !canAnalyze

  currentStep = 'ready'
  updateSteps()

  try {
    currentArchiveId = await archiveDb.insertAfterExtract({
      fileName,
      pages: res.pages,
      charCount: res.charCount,
      extractedText: res.text,
    })
  } catch (e) {
    currentArchiveId = null
    const msg = e instanceof Error ? e.message : String(e)
    setAnalyzeError(
      `Extracted successfully, but saving to the local archive failed (IndexedDB / quota). You can still click Analyze; after a full page reload you may need to upload again. ${msg}`,
    )
  }
  setAnalyzeError(null)
  updatePrimaryAnalyzeButtonLabel()
  setDropzoneCompact(true)
  queueMicrotask(() => $('#meta-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  await refreshArchiveLists()
}

function getPaginatedCheckbox(): HTMLInputElement | null {
  return document.getElementById('chk-paginated') as HTMLInputElement | null
}

/** One button: label reflects whether the last upload was multi-PDF (batch) or single. */
function updatePrimaryAnalyzeButtonLabel(): void {
  const btn = document.getElementById('btn-analyze') as HTMLButtonElement | null
  if (!btn) return
  const n = lastBatchArchiveIds.length
  btn.textContent = n >= 2 ? `Analyze all ${n} PDFs` : 'Analyze statement'
}

function readPaginatedPreferenceIntoCheckbox(): void {
  const el = getPaginatedCheckbox()
  if (!el) return
  try {
    el.checked = localStorage.getItem(PAGINATED_ANALYSIS_STORAGE_KEY) === '1'
  } catch {
    /* ignore */
  }
}

function isPaginatedAnalysisEnabled(): boolean {
  return Boolean(getPaginatedCheckbox()?.checked)
}

async function runAnalyzeBatch(): Promise<void> {
  const ids = [...lastBatchArchiveIds]
  if (ids.length < 2) return
  for (const id of ids) {
    const doc = await archiveDb.getById(id)
    const t = doc?.extractedText ?? ''
    if (!t) continue
    extractedText = t
    fileName = doc!.fileName
    currentArchiveId = id
    lastTextByPage = splitTextByPdfPageMarkers(t) ?? null
    await runAnalyze()
  }
}

async function runAnalyzeFromPrimaryButton(): Promise<void> {
  if (lastBatchArchiveIds.length >= 2) {
    await runAnalyzeBatch()
    return
  }
  await runAnalyze()
}

async function processSinglePdfUpload(file: File): Promise<void> {
  lastBatchArchiveIds = []
  updatePrimaryAnalyzeButtonLabel()
  setDropzoneCompact(false)
  fileName = file.name
  pendingPdfBuffer = null
  currentArchiveId = null
  currentStep = 'upload'
  updateSteps()
  setExtractError(null)
  setAnalyzeError(null)
  clearResultsUi()
  $('#meta-card').hidden = false
  $('#file-label').textContent = fileName
  $('#chip-status').className = 'chip chip-busy'
  $('#chip-status').innerHTML = '<span class="pulse" aria-hidden="true"></span> Extracting'
  $('#meta-detail').textContent = 'Reading PDF text in your browser…'

  const buf = await file.arrayBuffer()

  try {
    const res = await extractTextFromPdf(buf, DEFAULT_MAX_CHARS)
    await finishExtractSuccess(res)
  } catch (e) {
    if (isPdfPasswordRequired(e)) {
      pendingPdfBuffer = buf
      $('#chip-status').className = 'chip chip-busy'
      $('#chip-status').textContent = 'Needs password'
      $('#meta-card').hidden = false
      $('#file-label').textContent = fileName
      $('#meta-detail').textContent = 'This file is password-protected. Use the dialog to enter the PDF password.'
      showPdfPasswordModal()
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    setExtractError(`Could not read PDF: ${msg}`)
    $('#chip-status').className = 'chip chip-busy'
    $('#chip-status').textContent = 'Error'
      ; (document.getElementById('btn-analyze') as HTMLButtonElement).disabled = true
  }
}

async function handlePdfFiles(files: File[]): Promise<void> {
  const pdfs = files.filter((f) => f.type === 'application/pdf')
  if (pdfs.length === 0) {
    setExtractError('No PDF files selected.')
    return
  }
  if (pdfs.length === 1) {
    await processSinglePdfUpload(pdfs[0]!)
    return
  }

  lastBatchArchiveIds = []
  updatePrimaryAnalyzeButtonLabel()
  setDropzoneCompact(false)
  pendingPdfBuffer = null
  currentArchiveId = null
  currentStep = 'upload'
  updateSteps()
  setExtractError(null)
  setAnalyzeError(null)
  clearResultsUi()
  $('#meta-card').hidden = false
  $('#chip-status').className = 'chip chip-busy'
  $('#chip-status').innerHTML = '<span class="pulse" aria-hidden="true"></span> Extracting'

  const savedIds: string[] = []
  type OkRow = { fileName: string; res: ExtractResult }
  const ok: OkRow[] = []

  for (let i = 0; i < pdfs.length; i++) {
    const file = pdfs[i]!
    fileName = file.name
    $('#file-label').textContent = file.name
    $('#meta-detail').textContent = `Extracting file ${i + 1} of ${pdfs.length}…`

    const buf = await file.arrayBuffer()
    try {
      const res = await extractTextFromPdf(buf, DEFAULT_MAX_CHARS)
      const id = await archiveDb.insertAfterExtract({
        fileName: file.name,
        pages: res.pages,
        charCount: res.charCount,
        extractedText: res.text,
      })
      savedIds.push(id)
      ok.push({ fileName: file.name, res })
    } catch (e) {
      if (isPdfPasswordRequired(e)) {
        setExtractError(
          `"${file.name}" is password-protected. Upload that PDF alone to enter the password, then add other files.`,
        )
        $('#chip-status').className = 'chip chip-busy'
        $('#chip-status').textContent = 'Needs password'
        break
      }
      const msg = e instanceof Error ? e.message : String(e)
      setExtractError(`Could not read "${file.name}": ${msg}`)
      $('#chip-status').className = 'chip chip-busy'
      $('#chip-status').textContent = 'Error'
      break
    }
  }

  await refreshArchiveLists()

  if (ok.length === 0) {
    ; (document.getElementById('btn-analyze') as HTMLButtonElement).disabled = true
    return
  }

  const last = ok[ok.length - 1]!
  extractedText = last.res.text
  lastTextByPage =
    last.res.textByPage.length > 0 ? last.res.textByPage : splitTextByPdfPageMarkers(last.res.text) ?? null
  fileName = last.fileName
  currentArchiveId = savedIds[savedIds.length - 1] ?? null
  lastBatchArchiveIds = savedIds

  $('#meta-card').hidden = false
  $('#file-label').textContent = fileName
  const trunc = last.res.truncated ? ` Text truncated to ${last.res.charCap.toLocaleString()} characters at extract.` : ''
  $('#meta-detail').textContent =
    ok.length > 1
      ? `${last.res.pages} page(s) · ${last.res.charCount.toLocaleString()} characters on "${fileName}". ${ok.length} PDFs saved to archive — Analyze runs on all ${ok.length} in order (this card shows the last file).${trunc}${ANALYZE_FOR_INSIGHTS_HINT}`
      : `${last.res.pages} page(s) · ${last.res.charCount.toLocaleString()} characters extracted.${trunc}${ANALYZE_FOR_INSIGHTS_HINT}`

  $('#chip-status').className = 'chip chip-ready'
  $('#chip-status').textContent = 'Ready'
  const canAnalyze = webgpuSupported() && extractedText.length > 0
    ; (document.getElementById('btn-analyze') as HTMLButtonElement).disabled = !canAnalyze
  currentStep = 'ready'
  updateSteps()
  updatePrimaryAnalyzeButtonLabel()
  setDropzoneCompact(true)
  queueMicrotask(() => $('#meta-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}

async function tryUnlockPdfWithPassword(): Promise<void> {
  if (!pendingPdfBuffer) return
  const input = document.getElementById('pdf-password-input') as HTMLInputElement
  const pwd = input.value
  const errEl = $('#pdf-password-error')
  errEl.hidden = true
  errEl.textContent = ''

  if (!pwd) {
    errEl.hidden = false
    errEl.textContent = 'Enter the PDF password.'
    return
  }

  try {
    const res = await extractTextFromPdf(pendingPdfBuffer, DEFAULT_MAX_CHARS, pwd)
    hidePdfPasswordModal()
    setExtractError(null)
    setAnalyzeError(null)
    await finishExtractSuccess(res)
  } catch (e) {
    if (isPdfPasswordIncorrect(e)) {
      errEl.hidden = false
      errEl.textContent = 'Incorrect password. Try again.'
      input.select()
      return
    }
    errEl.hidden = false
    errEl.textContent = e instanceof Error ? e.message : String(e)
  }
}

async function openArchiveDocument(id: string): Promise<void> {
  const doc = await archiveDb.getById(id)
  if (!doc) return
  const text = doc.extractedText ?? ''
  if (!text) {
    setExtractError('This archive entry has no stored text (quota trim). Re-upload the PDF to analyze.')
    setAnalyzeError(null)
    setView('dashboard')
    return
  }
  setExtractError(null)
  $('#progress-card').hidden = true
  if (doc.status === 'error' && doc.errorMessage) {
    setAnalyzeError(`Last analyze failed: ${doc.errorMessage}`)
  } else {
    setAnalyzeError(null)
  }
  extractedText = text
  lastTextByPage = splitTextByPdfPageMarkers(text) ?? null
  fileName = doc.fileName
  currentArchiveId = doc.id
  lastBatchArchiveIds = []
  updatePrimaryAnalyzeButtonLabel()
  $('#meta-card').hidden = false
  $('#file-label').textContent = fileName
  $('#chip-status').className = 'chip chip-ready'
  $('#chip-status').textContent = 'Ready'
  const baseMeta = `${doc.pages} page(s) · ${doc.charCount.toLocaleString()} characters (from archive).`
  $('#meta-detail').textContent =
    doc.status === 'analyzed' ? baseMeta : `${baseMeta}${ANALYZE_FOR_INSIGHTS_HINT}`
  setDropzoneCompact(true)
  const canAnalyze = webgpuSupported() && extractedText.length > 0
    ; (document.getElementById('btn-analyze') as HTMLButtonElement).disabled = !canAnalyze

  if (doc.status === 'analyzed' && doc.markdownPreview && doc.markdownPreview.trim().length > 0) {
    await showArchivedAnalysisResults(doc)
    currentStep = 'results'
  } else {
    clearResultsUi()
    currentStep = 'ready'
  }
  updateSteps()
  queueMicrotask(() => {
    const resultsEl = document.getElementById('results')
    if (resultsEl && !resultsEl.hidden) {
      resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } else {
      $('#meta-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  })
  setView('dashboard')
}

async function onArchiveListClick(ev: MouseEvent): Promise<void> {
  const t = (ev.target as HTMLElement).closest('[data-archive-action]') as HTMLElement | null
  if (!t) return
  const action = t.getAttribute('data-archive-action')
  const id = t.getAttribute('data-archive-id')
  if (!id || !action) return
  if (action === 'open') {
    await openArchiveDocument(id)
    return
  }
  if (action === 'delete') {
    const doc = await archiveDb.getById(id)
    const label = doc?.fileName ?? 'this item'
    if (!confirm(`Remove “${label}” from archive?`)) return
    await archiveDb.deleteById(id)
    if (currentArchiveId === id) {
      currentArchiveId = null
      extractedText = ''
      fileName = ''
      lastTextByPage = null
      $('#meta-card').hidden = true
      clearResultsUi()
      setDropzoneCompact(false)
      currentStep = 'upload'
      updateSteps()
        ; (document.getElementById('btn-analyze') as HTMLButtonElement).disabled = true
    }
    await refreshArchiveLists()
  }
}

async function runAnalyze(): Promise<void> {
  if (!extractedText || !webgpuSupported()) return

  clearResultsUi()
  setAnalyzeError(null)
  currentStep = 'analyze'
  updateSteps()
  $('#progress-card').hidden = false
    ; (document.getElementById('btn-analyze') as HTMLButtonElement).disabled = true
  const cfg = MODEL_CONFIG[selectedModelId]
  setProgress(0, `Loading ${cfg.progressLabel}…`, `First visit may download ${cfg.approxSizeHint}; wait for the progress bar. Later visits reuse the cache.`)

  const onProgress = (info: ProgressInfo) => {
    const p = mapLoadProgress(info)
    if (p >= 0) setProgress(p, 'Loading model files…', String(info.file ?? ''))
    if (info.status === 'done') setProgress(100, 'Model weights loaded', 'Preparing analysis…')
  }

  try {
    await loadModel(selectedModelId, onProgress)

    const cap = getMaxStatementChars(selectedModelId)
    const paginated = isPaginatedAnalysisEnabled()
    const clipNote = paginated
      ? `Paginated mode: each PDF page (or sub-chunk) runs in its own pass — max ~${cap.toLocaleString()} characters per pass for ${MODEL_CONFIG[selectedModelId].progressLabel}.`
      : extractedText.length > cap
        ? `Single-pass mode: only the first ~${cap.toLocaleString()} characters of the extract go to the model (per-model WebGPU ONNX budget). Enable “paginate by PDF page” to cover the full text.`
        : 'Streaming narrative below; then a JSON pass for the chart.'
    setProgress(100, 'Generating analysis…', clipNote)

    const body = $('#results-body')
    body.textContent = ''
    const chartWrap = document.getElementById('weekly-chart-wrap')
    if (chartWrap) chartWrap.innerHTML = ''
    $('#results').hidden = false
    currentStep = 'results'
    updateSteps()
    setAnalysisResultsPlaceholder(paginated)
    scrollResultsIntoView()

    let streamStarted = false
    const { markdown, structured, chartJsonDiagnostics, modelInputTruncated, extractedCharCount, sentCharCount, analysisMode, unitsProcessed, consolidatedAcrossPages } =
      await analyzeStatementText(extractedText, {
        modelId: selectedModelId,
        maxNewTokens: 1024,
        paginated,
        textByPage: lastTextByPage,
        onStreamChunk: (chunk) => {
          if (!streamStarted) {
            streamStarted = true
            body.textContent = ''
          }
          body.textContent += chunk
        },
        onSegmentProgress: (label, step, totalSteps) => {
          setPaginatedSegmentProgressUi(label, step, totalSteps)
          const det = document.getElementById('analysis-placeholder-detail')
          if (det) {
            det.textContent = label.toLowerCase().includes('merging')
              ? 'Almost done — combining all pages into one report.'
              : `Step ${step} of ${totalSteps}: ${label.replace(/^Statement segment:\s*/i, '').trim()}`
          }
        },
      })

    let notice = ''
    if (analysisMode === 'paginated' && unitsProcessed > 1) {
      const mergeLine = consolidatedAcrossPages
        ? ' A <strong>final merge pass</strong> produced one combined summary below (not separate page-by-page sections).'
        : ''
      notice = `<p class="model-truncate-notice" role="status"><strong>Paginated analysis:</strong> Ran <strong>${unitsProcessed}</strong> model passes on your statement text and sent <strong>${sentCharCount.toLocaleString()}</strong> characters in total (full extract <strong>${extractedCharCount.toLocaleString()}</strong> characters). Each pass is capped at about <strong>${cap.toLocaleString()} characters</strong> for WebGPU ONNX stability — that limit applies only to inference, not PDF extraction.${mergeLine}</p>`
    } else if (modelInputTruncated && analysisMode === 'single') {
      notice = `<p class="model-truncate-notice" role="status"><strong>Note:</strong> In one pass, only the first <strong>${sentCharCount.toLocaleString()}</strong> characters of the <strong>${extractedCharCount.toLocaleString()}</strong>-character extract were sent to <strong>${MODEL_CONFIG[selectedModelId].progressLabel}</strong> (~${cap.toLocaleString()} character model-input budget). The PDF was still extracted in full; enable <strong>“Full statement: paginate by PDF page”</strong> to analyze long statements across multiple passes.</p>`
    }
    let execMd = ''
    let detailMd = markdown

    const splitRegex = /\\n##\\s+(Notable transactions|Risks or anomalies|Disclaimer)/i
    const match = markdown.match(splitRegex)
    if (match && match.index !== undefined) {
      execMd = markdown.slice(0, match.index).trim()
      detailMd = markdown.slice(match.index).trim()
    } else {
      execMd = ''
    }

    const parsedDetail = await marked.parse(detailMd, { async: true })
    body.innerHTML = notice + stripScripts(parsedDetail)

    const execSummary = document.getElementById('executive-summary')
    const execContent = document.getElementById('executive-summary-content')
    if (execSummary && execContent && execMd) {
      const parsedExec = await marked.parse(execMd, { async: true })
      execContent.innerHTML = stripScripts(parsedExec)
      execSummary.hidden = false
    }

    await initChatSession(extractedText, currentArchiveId || undefined, structured ? JSON.stringify(structured) : undefined)

    const chatTool = document.getElementById('chat-tool-container')
    if (chatTool) chatTool.hidden = false

    const chatInput = document.getElementById('chat-input') as HTMLInputElement | null
    const chatSubmit = document.getElementById('chat-submit') as HTMLButtonElement | null
    if (chatSubmit && chatInput) {
      chatSubmit.disabled = false
    }

    if (chartWrap) chartWrap.innerHTML = renderWeeklyChartHtml(structured, chartJsonDiagnostics)

    setAnalyzeError(null)
    scrollResultsIntoView()

    if (currentArchiveId) {
      try {
        await archiveDb.updateAfterAnalyze(currentArchiveId, {
          modelId: selectedModelId,
          markdown,
          structured,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setAnalyzeError(
          `Analysis finished, but saving to your local archive failed (IndexedDB). The list may still show “Extracted” after reload. ${msg}`,
        )
      }
      await refreshArchiveLists()
    }
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const msg = friendlyInferenceError(raw)
    $('#progress-label').textContent = 'Something went wrong'
    $('#progress-detail').textContent = msg
    setAnalyzeError(`Analyze failed (${MODEL_CONFIG[selectedModelId].progressLabel}): ${msg}`)
    $('#results').hidden = true
    $('#results-body').textContent = ''
    const chartErr = document.getElementById('weekly-chart-wrap')
    if (chartErr) chartErr.innerHTML = ''
      ; (document.getElementById('btn-analyze') as HTMLButtonElement).disabled = false
    currentStep = 'ready'
    updateSteps()
    if (currentArchiveId) {
      try {
        await archiveDb.updateStatus(currentArchiveId, 'error', {
          errorMessage: msg,
          modelId: selectedModelId,
        })
      } catch {
        /* ignore */
      }
      await refreshArchiveLists()
    }
  } finally {
    clearProgressSegmentSub()
    $('#progress-card').hidden = true
      ; (document.getElementById('btn-analyze') as HTMLButtonElement).disabled =
        !webgpuSupported() || !extractedText
  }
}

function onModelSelectChange(): void {
  const sel = document.getElementById('model-select') as HTMLSelectElement
  const next = sel.value
  if (!isValidModelId(next)) return
  selectedModelId = next
  try {
    localStorage.setItem(PREFERRED_MODEL_STORAGE_KEY, selectedModelId)
  } catch {
    /* ignore */
  }
  unloadSession()
  updateCharCapTip()
  clearResultsUi()
  const detail = $('#meta-detail')
  if (!$('#meta-card').hidden && extractedText) {
    detail.textContent = `Model changed to ${MODEL_CONFIG[selectedModelId].progressLabel}. The next Analyze will load that model (may download if not cached).`
  }
}

function scheduleSearchRefresh(): void {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null
    void refreshArchiveLists()
  }, 280)
}

function bind(): void {
  const drop = $('#dropzone')
  const input = $('#file-input') as HTMLInputElement

  $('#btn-pick').addEventListener('click', () => input.click())
  document.getElementById('btn-sidebar-upload')?.addEventListener('click', () => input.click())
  input.addEventListener('change', () => {
    const list = input.files
    if (!list?.length) return
    void handlePdfFiles(Array.from(list))
    input.value = ''
  })

    ;['dragenter', 'dragover'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault()
        drop.classList.add('dragover')
      })
    })
    ;['dragleave', 'drop'].forEach((ev) => {
      drop.addEventListener(ev, (e) => {
        e.preventDefault()
        drop.classList.remove('dragover')
      })
    })
  drop.addEventListener('drop', (e) => {
    const pdfs = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type === 'application/pdf')
    if (pdfs.length) void handlePdfFiles(pdfs)
  })
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      input.click()
    }
  })

  document.getElementById('nav-dashboard')?.addEventListener('click', () => setView('dashboard'))
  document.getElementById('nav-archive')?.addEventListener('click', () => setView('archive'))

  document.getElementById('archive-search')?.addEventListener('input', (ev) => {
    archiveSearchQuery = (ev.target as HTMLInputElement).value
    scheduleSearchRefresh()
  })

  document.getElementById('dashboard-recent-list')?.addEventListener('click', (e) => void onArchiveListClick(e as MouseEvent))
  document.getElementById('archive-full-list')?.addEventListener('click', (e) => void onArchiveListClick(e as MouseEvent))

  document.getElementById('model-select')?.addEventListener('change', onModelSelectChange)

  readPaginatedPreferenceIntoCheckbox()
  getPaginatedCheckbox()?.addEventListener('change', () => {
    try {
      localStorage.setItem(PAGINATED_ANALYSIS_STORAGE_KEY, getPaginatedCheckbox()?.checked ? '1' : '0')
    } catch {
      /* ignore */
    }
  })
  $('#btn-analyze').addEventListener('click', () => void runAnalyzeFromPrimaryButton())
  $('#btn-reset').addEventListener('click', () => {
    extractedText = ''
    fileName = ''
    lastTextByPage = null
    lastBatchArchiveIds = []
    updatePrimaryAnalyzeButtonLabel()
    setDropzoneCompact(false)
    pendingPdfBuffer = null
    currentArchiveId = null
    hidePdfPasswordModal()
    setExtractError(null)
    setAnalyzeError(null)
    currentStep = 'upload'
    updateSteps()
    $('#meta-card').hidden = true
    clearResultsUi()
    resetChatSession()
      ; (document.getElementById('btn-analyze') as HTMLButtonElement).disabled = true
  })

  $('#pdf-password-unlock').addEventListener('click', () => void tryUnlockPdfWithPassword())
  $('#pdf-password-cancel').addEventListener('click', () => {
    hidePdfPasswordModal()
    $('#meta-card').hidden = true
    setExtractError('Password entry cancelled. Choose another PDF or try again.')
    $('#chip-status').className = 'chip chip-busy'
    $('#chip-status').textContent = 'Cancelled'
  })
  const pwdInput = document.getElementById('pdf-password-input')
  pwdInput?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      void tryUnlockPdfWithPassword()
    }
  })
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return
    const modal = document.getElementById('pdf-password-modal')
    if (modal && !modal.hidden) {
      ; (document.getElementById('pdf-password-cancel') as HTMLButtonElement).click()
    }
  })

  // Chat tool logic
  document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const input = document.getElementById('chat-input') as HTMLInputElement
    const submitBtn = document.getElementById('chat-submit') as HTMLButtonElement
    const chatHistory = document.getElementById('chat-history')
    if (!input || !submitBtn || !chatHistory) return

    const userMessage = input.value.trim()
    if (!userMessage) return

    // Add user message to UI
    const userBubble = document.createElement('div')
    userBubble.className = 'chat-message chat-message--user'
    userBubble.innerHTML = `
      <div class="chat-message__avatar"><span class="material-symbols-outlined">person</span></div>
      <div class="chat-message__bubble">${escapeHtml(userMessage)}</div>
    `
    chatHistory.appendChild(userBubble)
    input.value = ''
    input.disabled = true
    submitBtn.disabled = true
    chatHistory.scrollTop = chatHistory.scrollHeight

    // Add empty bot structure
    const botBubble = document.createElement('div')
    botBubble.className = 'chat-message chat-message--bot'
    const botAvatar = document.createElement('div')
    botAvatar.className = 'chat-message__avatar'
    botAvatar.innerHTML = '<span class="material-symbols-outlined">smart_toy</span>'
    const botText = document.createElement('div')
    botText.className = 'chat-message__bubble'
    botText.innerHTML = '<span class="analysis-placeholder__dots inline-block ml-1"><span></span><span></span><span></span></span>' // typing indicator

    botBubble.appendChild(botAvatar)
    botBubble.appendChild(botText)
    chatHistory.appendChild(botBubble)
    chatHistory.scrollTop = chatHistory.scrollHeight

    let streamedContent = ''
    try {
      // Ensure the model is loaded before sending the first message
      if (getLoadedModelId() !== selectedModelId) {
        botText.innerHTML = `<span class="text-sm opacity-70">Loading ${MODEL_CONFIG[selectedModelId].progressLabel}...</span>`
        await loadModel(selectedModelId)
      }

      await sendChatMessage(
        userMessage,
        async (chunk) => {
          streamedContent += chunk
          // use marked for fast parsing of streamed chunk
          const parsed = await marked.parse(streamedContent, { async: true })
          botText.innerHTML = stripScripts(parsed)
          chatHistory.scrollTop = chatHistory.scrollHeight
        },
        (toolInfo) => {
          // Show tool interaction status
          botText.innerHTML = `<div class="chat-tool-status"><span class="material-symbols-outlined spin mr-1">search</span>${escapeHtml(toolInfo)}</div>`
          chatHistory.scrollTop = chatHistory.scrollHeight
        }
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      botText.innerHTML = `<span class="text-error">Error: ${escapeHtml(msg)}</span>`
    } finally {
      input.disabled = false
      submitBtn.disabled = false
      input.focus()
      chatHistory.scrollTop = chatHistory.scrollHeight
    }
  })
}

function checkSystemMemory(): { ok: boolean; ram?: number } {
  // navigator.deviceMemory returns approximate GiB (0.5, 1, 2, 4, 8...).
  // Note: Most browsers cap this at 8 to prevent fingerprinting.
  const ram = (navigator as any).deviceMemory
  if (ram !== undefined && ram < 16) {
    return { ok: false, ram }
  }
  return { ok: true, ram }
}

function applyMemoryRestriction(): void {
  const { ok, ram } = checkSystemMemory()
  if (ok) return

  // Disable upload buttons
  const btnPick = document.getElementById('btn-pick') as HTMLButtonElement | null
  const btnSidebar = document.getElementById('btn-sidebar-upload') as HTMLButtonElement | null
  const dropzone = document.getElementById('dropzone')

  if (btnPick) btnPick.disabled = true
  if (btnSidebar) btnSidebar.disabled = true

  // Show error in dropzone
  if (dropzone) {
    const originalContent = dropzone.innerHTML
    dropzone.classList.add('dropzone--error')
    dropzone.innerHTML = `
      <div class="dropzone-icon dropzone-hero__icon" aria-hidden="true">
        <span class="material-symbols-outlined dropzone-hero__glyph" style="color: var(--color-error)">memory</span>
      </div>
      <h2 style="color: var(--color-error)">High memory requirement</h2>
      <p>This local AI tool requires at least <strong>16GB of RAM</strong> to run models safely in your browser. Your device reports <strong>${ram}GB</strong>.</p>
      <p class="text-sm opacity-70">Note: Some browsers cap this report at 8GB for privacy. If you are certain you have 16GB+, you can bypass this check.</p>
      <button type="button" class="btn btn-ghost" id="btn-bypass-ram" style="margin-top: 1rem; text-decoration: underline;">Bypass check and enable upload</button>
    `

    document.getElementById('btn-bypass-ram')?.addEventListener('click', () => {
      dropzone.innerHTML = originalContent
      dropzone.classList.remove('dropzone--error')
      if (btnPick) btnPick.disabled = false
      if (btnSidebar) btnSidebar.disabled = false
      // Re-bind the pick button since we replaced the HTML
      document.getElementById('btn-pick')?.addEventListener('click', () => {
        document.getElementById('file-input')?.click()
      })
    })
  }
}

renderShell()
setWebGpuPill()
setView('dashboard')
updateSteps()
updatePrimaryAnalyzeButtonLabel()
bind()
applyMemoryRestriction()
void refreshArchiveLists()
