import { MODEL_CONFIG, MODEL_IDS, type ModelId } from '../llm/models'

function modelOptionsHtml(): string {
  return MODEL_IDS.map(
    (id: ModelId) => `<option value="${id}">${MODEL_CONFIG[id].label}</option>`,
  ).join('')
}

/** Full app chrome: Stitch-style sidebar + main topbar + dashboard / archive views. */
export function getAppShellHtml(): string {
  const options = modelOptionsHtml()
  return `
<div class="app-root">
  <aside class="app-sidenav" aria-label="Primary">
    <div class="app-sidenav__brand">
      <div class="app-sidenav__logo" aria-hidden="true">
        <span class="material-symbols-outlined">account_balance</span>
      </div>
      <div>
        <div class="app-sidenav__title">FinVision</div>
        <div class="app-sidenav__subtitle">Local statement insights</div>
      </div>
    </div>
    <nav class="app-sidenav__nav" aria-label="Views">
      <button type="button" class="app-sidenav__link app-sidenav__link--active" data-nav="dashboard" id="nav-dashboard">
        <span class="material-symbols-outlined" aria-hidden="true">dashboard</span>
        <span>Dashboard</span>
      </button>
      <button type="button" class="app-sidenav__link" data-nav="archive" id="nav-archive">
        <span class="material-symbols-outlined" aria-hidden="true">inventory_2</span>
        <span>Archive</span>
      </button>
    </nav>
    <div class="app-sidenav__footer">
      <button type="button" class="btn btn-primary app-sidenav__upload" id="btn-sidebar-upload">
        <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
        <span>Upload PDF</span>
      </button>
    </div>
  </aside>

  <div class="app-main-wrap">
    <main class="app-main" id="app-main">
      <header class="app-topbar">
        <div class="app-topbar__search">
          <span class="material-symbols-outlined app-topbar__search-icon" aria-hidden="true">search</span>
          <input
            type="search"
            id="archive-search"
            class="app-topbar__search-input"
            placeholder="Search archived file names…"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <div class="app-topbar__actions">
          <span id="webgpu-pill" class="webgpu-pill" role="status"></span>
          <div class="header-model">
            <label for="model-select" class="model-select-label">Model</label>
            <select id="model-select" class="model-select" aria-label="Inference model">
              ${options}
            </select>
          </div>
        </div>
      </header>

      <div id="view-dashboard" class="app-view">
        <div class="app-dashboard-head">
          <h1 id="main-heading" class="app-headline app-dashboard-head__title">Statement analysis</h1>
          <p class="app-dashboard-head__lede">
            Upload a digital PDF. Text is extracted in your browser; pick a model and run locally via WebGPU.
            Only the selected model is loaded; switching unloads the previous one.
          </p>
        </div>

        <div class="app-dashboard-grid">
          <div class="app-dashboard-main">
            <nav class="steps" aria-label="Progress">
              <span data-step="upload"><strong>1</strong> Upload</span>
              <span data-step="ready"><strong>2</strong> Ready</span>
              <span data-step="analyze"><strong>3</strong> Analyze</span>
              <span data-step="results"><strong>4</strong> Insights <span class="steps__sub">(after Analyze)</span></span>
            </nav>

            <div id="dropzone" class="dropzone dropzone-hero" tabindex="0" role="button" aria-label="Upload PDF statements">
              <div class="dropzone-icon dropzone-hero__icon" aria-hidden="true">
                <span class="material-symbols-outlined dropzone-hero__glyph">cloud_upload</span>
              </div>
              <h2>Drop your financial statements here</h2>
              <p>Digital PDFs with selectable text work best. You can select or drop <strong>multiple PDFs</strong> at once — each is saved to the archive. Scanned pages are not OCR’d in this demo.</p>
              <button type="button" class="btn btn-secondary" id="btn-pick">Select PDF(s)</button>
              <input type="file" id="file-input" class="visually-hidden" accept="application/pdf" multiple />
            </div>

            <p id="extract-error" class="extract-error" role="alert" hidden></p>
            <p id="analyze-error" class="analyze-error" role="alert" hidden></p>

            <div id="meta-card" class="meta-card" hidden>
              <div class="meta-row">
                <span id="file-label" class="meta-file-label"></span>
                <span id="chip-status" class="chip chip-ready">Ready</span>
              </div>
              <p id="meta-detail" class="meta-detail"></p>
              <label class="meta-paginate">
                <input type="checkbox" id="chk-paginated" />
                <span>Full statement: analyze by <strong>PDF page</strong> (multiple model passes; slower, covers long statements)</span>
              </label>
              <div class="meta-actions">
                <button type="button" class="btn btn-primary" id="btn-analyze" disabled>Analyze statement</button>
                <button type="button" class="btn btn-secondary btn-reset" id="btn-reset" title="Clears the current session only; archive entries stay saved">Clear session</button>
              </div>
            </div>

            <div id="results" class="results" hidden>
              <!-- Executive Summary Card -->
              <div id="executive-summary" class="executive-summary" hidden>
                <div class="executive-summary__head">
                  <span class="material-symbols-outlined">auto_awesome</span>
                  <h3 class="app-headline executive-summary__title">Executive Summary</h3>
                </div>
                <div id="executive-summary-content" class="executive-summary__content analysis-prose"></div>
              </div>

              <h2 class="app-headline results__title">Detailed Analysis</h2>
              <div id="results-body" class="analysis-prose"></div>
              <div id="weekly-chart-wrap" class="weekly-chart-wrap"></div>
              
              <!-- Chat Prompt Tool -->
              <div class="chat-tool" id="chat-tool-container" hidden>
                 <div class="chat-tool__head">
                    <span class="material-symbols-outlined">chat</span>
                    <h3 class="app-headline chat-tool__title">Ask about your statement</h3>
                 </div>
                 <div id="chat-history" class="chat-history">
                    <div class="chat-message chat-message--bot">
                        <div class="chat-message__avatar">
                           <span class="material-symbols-outlined">smart_toy</span>
                        </div>
                        <div class="chat-message__bubble">
                            I've analyzed your statement. You can ask me to list specific transactions, group them differently, or summarize any category. (e.g. "which transactions are related to Zerodha?")
                        </div>
                    </div>
                 </div>
                 <div class="chat-tool__input-area">
                    <form id="chat-form" class="chat-form">
                        <input type="text" id="chat-input" class="chat-input" placeholder="e.g., Any Zerodha transaction is an investment..." autocomplete="off">
                        <button type="submit" id="chat-submit" class="chat-submit" disabled>
                            <span class="material-symbols-outlined">send</span>
                        </button>
                    </form>
                 </div>
              </div>
            </div>

            <div id="progress-card" class="progress-card" hidden>
              <p id="progress-label" class="progress-label">Preparing model…</p>
              <p id="progress-detail" class="progress-detail"></p>
              <p id="progress-segment-sub" class="progress-segment-sub" hidden></p>
              <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="progress-wrap">
                <div id="progress-fill"></div>
              </div>
            </div>

            <section class="dashboard-recent" aria-labelledby="recent-heading">
              <div class="dashboard-recent__head">
                <h2 id="recent-heading" class="dashboard-recent__title">Recent extractions</h2>
              </div>
              <div id="dashboard-recent-list" class="extraction-cards"></div>
              <p id="dashboard-recent-empty" class="dashboard-recent__empty">No saved extractions yet. Upload a PDF to build your local archive.</p>
            </section>
          </div>

          <aside class="app-dashboard-rail" aria-label="Tips">
            <div class="rail-card">
              <h3 class="rail-card__title">
                <span class="material-symbols-outlined rail-card__icon" aria-hidden="true">verified</span>
                Quick tips
              </h3>
              <ul class="rail-card__list">
                <li>Use Chrome or Edge with WebGPU for local inference.</li>
                <li>Password-protected PDFs stay local; the password is never uploaded.</li>
                <li>Nothing is sent to a backend; models cache in the browser after first download.</li>
              </ul>
            </div>
            <div class="rail-card rail-card--muted">
              <h3 class="rail-card__title">Input limit</h3>
              <p class="rail-card__text">
                Each model pass sends at most ~<span id="tips-char-cap"></span> characters of statement text (safe WebGPU ONNX budget). Longer extracts stay on disk; use <strong>paginate by PDF page</strong> in the meta card to analyze across multiple passes.
              </p>
            </div>
          </aside>
        </div>
      </div>

      <div id="view-archive" class="app-view app-view--archive" hidden>
        <h2 class="app-headline archive-page__title">Archive</h2>
        <p class="archive-page__lede">Saved in this browser only (IndexedDB). Clearing site data removes history.</p>
        <div id="archive-full-list" class="extraction-cards extraction-cards--full"></div>
        <p id="archive-empty" class="dashboard-recent__empty" hidden>No matching documents.</p>
      </div>

      <footer class="disclaimer">
        <strong>Disclaimer:</strong> This demo is not financial, legal, or tax advice. Language models can make mistakes.
        Always verify amounts and dates against your original statement. English-focused; other languages may vary.
      </footer>
    </main>
  </div>

  <div
    id="pdf-password-modal"
    class="pdf-password-modal"
    hidden
    role="dialog"
    aria-modal="true"
    aria-labelledby="pdf-password-title"
  >
    <div class="pdf-password-panel">
      <h2 id="pdf-password-title" class="app-headline pdf-password-title">Password required</h2>
      <p class="pdf-password-copy">
        This PDF is encrypted. Enter the document password to extract text locally in your browser. The password is not sent anywhere.
      </p>
      <label for="pdf-password-input" class="pdf-password-label">Password</label>
      <input
        type="password"
        id="pdf-password-input"
        class="pdf-password-input"
        autocomplete="current-password"
        spellcheck="false"
      />
      <p id="pdf-password-error" class="pdf-password-error" role="alert" hidden></p>
      <div class="pdf-password-actions">
        <button type="button" class="btn btn-primary" id="pdf-password-unlock">Unlock PDF</button>
        <button type="button" class="btn btn-secondary pdf-password-cancel" id="pdf-password-cancel">Cancel</button>
      </div>
    </div>
  </div>
</div>
`.trim()
}
