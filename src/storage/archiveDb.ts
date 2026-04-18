const DB_NAME = 'finvision-archive'
const DB_VERSION = 2
const STORE = 'documents'
const TRANSACTION_STORE = 'transactions'
const SCHEMA_VERSION = 1 as const

/** Avoid blowing IndexedDB quota on huge PDFs */
export const MAX_STORED_EXTRACTED_CHARS = 200_000
/** Stored narrative cap (full markdown is not kept to save IndexedDB space). */
export const MAX_MARKDOWN_PREVIEW_CHARS = 8_000
const MAX_STRUCTURED_JSON_CHARS = 32_000
const MAX_ERROR_MESSAGE_CHARS = 600
const MAX_RECORDS = 25

export type ArchiveStatus = 'extracted' | 'analyzed' | 'error'

export type ArchiveDocument = {
  schemaVersion: typeof SCHEMA_VERSION
  id: string
  fileName: string
  createdAt: number
  updatedAt: number
  pages: number
  charCount: number
  status: ArchiveStatus
  modelId?: string
  extractedText?: string
  markdownPreview?: string
  structuredJson?: string
  /** Last analyze failure (shown on archive cards). Cleared on successful analyze. */
  errorMessage?: string
  errorAt?: number
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('byUpdated', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(TRANSACTION_STORE)) {
        const os = db.createObjectStore(TRANSACTION_STORE, { keyPath: 'id', autoIncrement: true })
        os.createIndex('byDocId', 'docId')
      }
    }
  })
}

async function enforceMaxRecords(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    const r = os.getAll()
    r.onerror = () => reject(r.error)
    r.onsuccess = () => {
      const all = r.result as ArchiveDocument[]
      if (all.length <= MAX_RECORDS) return
      all.sort((a, b) => a.updatedAt - b.updatedAt)
      for (let i = 0; i < all.length - MAX_RECORDS; i++) {
        os.delete(all[i].id)
      }
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** New row after successful PDF text extract. Returns new document id. */
export async function insertAfterExtract(params: {
  fileName: string
  pages: number
  charCount: number
  extractedText: string
}): Promise<string> {
  const id = crypto.randomUUID()
  const now = Date.now()
  const extractedText = clip(params.extractedText, MAX_STORED_EXTRACTED_CHARS)
  const doc: ArchiveDocument = {
    schemaVersion: SCHEMA_VERSION,
    id,
    fileName: params.fileName,
    createdAt: now,
    updatedAt: now,
    pages: params.pages,
    charCount: params.charCount,
    status: 'extracted',
    extractedText,
  }

  const db = await openDb()
  const tryPut = (d: ArchiveDocument) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE).put(d)
    })

  try {
    await tryPut(doc)
  } catch {
    const fallback: ArchiveDocument = { ...doc, extractedText: undefined }
    await tryPut(fallback)
  }

  await enforceMaxRecords(db)
  return id
}

export async function updateAfterAnalyze(
  id: string,
  patch: {
    modelId: string
    markdown: string
    structured: unknown | null
  },
): Promise<void> {
  const existing = await getById(id)
  if (!existing) return

  let structuredJson: string | undefined
  if (patch.structured != null) {
    const s = JSON.stringify(patch.structured)
    if (s.length <= MAX_STRUCTURED_JSON_CHARS) structuredJson = s
  }

  const updated: ArchiveDocument = {
    ...existing,
    updatedAt: Date.now(),
    status: 'analyzed',
    modelId: patch.modelId,
    markdownPreview: clip(patch.markdown, MAX_MARKDOWN_PREVIEW_CHARS),
    structuredJson,
    errorMessage: undefined,
    errorAt: undefined,
  }

  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, TRANSACTION_STORE], 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)

    // Update document
    tx.objectStore(STORE).put(updated)

    // Update transactions
    if (patch.structured && typeof patch.structured === 'object') {
      const s = patch.structured as any
      if (Array.isArray(s.transactions)) {
        const os = tx.objectStore(TRANSACTION_STORE)
        for (const t of s.transactions) {
          os.add({ ...t, docId: id })
        }
      }
    }
  })
}

export async function updateStatus(
  id: string,
  status: ArchiveStatus,
  opts?: { errorMessage?: string; modelId?: string },
): Promise<void> {
  const existing = await getById(id)
  if (!existing) return
  const now = Date.now()
  const err =
    status === 'error' && opts?.errorMessage
      ? clip(opts.errorMessage, MAX_ERROR_MESSAGE_CHARS)
      : undefined
  const updated: ArchiveDocument = {
    ...existing,
    status,
    updatedAt: now,
    ...(status === 'error' && opts?.modelId ? { modelId: opts.modelId } : {}),
    ...(status === 'error' && err
      ? { errorMessage: err, errorAt: now }
      : status !== 'error'
        ? { errorMessage: undefined, errorAt: undefined }
        : {}),
  }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put(updated)
  })
}

export async function getById(id: string): Promise<ArchiveDocument | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(id)
    r.onerror = () => reject(r.error)
    r.onsuccess = () => resolve(r.result as ArchiveDocument | undefined)
  })
}

export async function deleteById(id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).delete(id)
  })
}

/** Most recently updated first */
export async function listRecent(limit = 50): Promise<ArchiveDocument[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).getAll()
    r.onerror = () => reject(r.error)
    r.onsuccess = () => {
      const all = (r.result as ArchiveDocument[]).sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(all.slice(0, limit))
    }
  })
}

export async function searchByFileName(query: string, limit = 50): Promise<ArchiveDocument[]> {
  const all = await listRecent(500)
  const q = query.trim().toLowerCase()
  if (!q) return all.slice(0, limit)
  return all.filter((d) => d.fileName.toLowerCase().includes(q)).slice(0, limit)
}

export async function getTransactionsByDocId(docId: string): Promise<any[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRANSACTION_STORE, 'readonly')
    const os = tx.objectStore(TRANSACTION_STORE)
    const idx = os.index('byDocId')
    const r = idx.getAll(docId)
    r.onerror = () => reject(r.error)
    r.onsuccess = () => resolve(r.result)
  })
}
