# FinVision · Local statement insights

Browser demo: upload a PDF bank/credit-card statement, extract text locally, then run **Gemma 4 E2B**, **Phi-4 Mini instruct**, or **Llama 3.2 1B** with **WebGPU** via [Transformers.js](https://github.com/huggingface/transformers.js). You get a Markdown narrative plus an optional **weekly spend bar chart** driven by a second, JSON-only model pass. No backend; **only the model you select** is loaded into memory; switching models unloads the previous session. Weights load from Hugging Face once per model, then cache in the browser.

## Models

| Model | Hugging Face repo | Notes |
|--------|-------------------|--------|
| **Gemma 4 E2B** | [`onnx-community/gemma-4-E2B-it-ONNX`](https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX) | Multimodal stack (this demo uses text + `AutoProcessor` + `Gemma4ForConditionalGeneration`). |
| **Phi-4 Mini instruct** | [`onnx-community/Phi-4-mini-instruct-ONNX-MHA`](https://huggingface.co/onnx-community/Phi-4-mini-instruct-ONNX-MHA) | `text-generation` pipeline, `dtype: q4` (avoids ORT Web failures with the repo’s two-file `q4f16` external weights), WebGPU. |
| **Llama 3.2 1B Instruct** | [`onnx-community/Llama-3.2-1B-Instruct-ONNX`](https://huggingface.co/onnx-community/Llama-3.2-1B-Instruct-ONNX) | Lighter option: `text-generation`, `dtype: q4`, WebGPU; smaller than Gemma/Phi for memory and download. |

First analysis for **Gemma** or **Phi** may download on the order of **hundreds of MB**; **Llama 3.2 1B** is typically **smaller** but still a noticeable first download. Use a stable network; later visits reuse the cache per model.

**Chart disclaimer:** Weekly totals and KPI numbers are **model-inferred** from extracted text, not from a bank API or deterministic parser. Treat them as a visual hint only and verify everything against your PDF.

## Requirements

- **Node.js** 18+ (20+ recommended)
- **Chrome** or **Edge** with **WebGPU** for local inference
- A **digital PDF** (text selectable). Scanned image-only PDFs are not OCR’d in this demo.

## Development

From the project root:

```bash
cd /path/to/browser-ai
npm install
npm run dev
```

Open the URL Vite prints (default **http://localhost:5173**).

### If `npm install` fails on `sharp`

Some environments fail building native `sharp`. Install without lifecycle scripts:

```bash
npm install --ignore-scripts
```

## Using the app (dev)

1. Confirm the **WebGPU** pill in the top bar (or use Chrome/Edge on a supported GPU).
2. Choose **Model** in the top bar: Gemma, Phi-4 Mini, or Llama 3.2 1B (choice is saved in `localStorage` under `finvision:preferredModel`). Changing model **unloads** the in-memory session so the next analyze loads only the newly selected weights.
3. **Drop a PDF** or use **Select PDF** / **Upload PDF** in the sidebar. If the file is **password-protected**, a dialog asks for the PDF password (handled locally by pdf.js only).
4. When status shows **Ready**, click **Analyze statement**.
5. Wait for the progress bar on first load, then read the analysis and optional **Weekly spend (inferred)** chart.
6. Use **Archive** in the sidebar to see saved sessions. **Clear session** clears the current workspace only; it does **not** remove archive rows. **Open** restores stored extracted text so you can analyze again (if text was omitted due to storage limits, re-upload the PDF).

### Local archive (IndexedDB)

- After each successful extract, a row is saved in **IndexedDB** (`finvision-archive` database). **Analyze** updates that row with model id and a short markdown preview.
- **Retention:** at most **25** documents; extracted text is capped at **200,000** characters per row to reduce quota errors. Clearing **site data** for the origin removes the archive.
- Nothing is synced to a server; search filters file names **only in the browser**.

## Other scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Typecheck + production bundle to `dist/` |
| `npm run preview` | Serve the production build locally |

## Project layout (short)

- `src/main.ts` — UI shell, views, model dropdown, flow
- `src/ui/shellLayout.ts` — dashboard / archive layout markup (Stitch-inspired)
- `src/storage/archiveDb.ts` — IndexedDB archive CRUD and limits
- `src/pdf/extractText.ts` — PDF → text (`pdfjs-dist`)
- `src/llm/session.ts` — WebGPU check, load/unload, `generateFromLoadedModel`
- `src/llm/gemmaBackend.ts` / `src/llm/onnxChatPipelineBackend.ts` — Gemma vs shared ONNX `text-generation` path
- `src/llm/models.ts` — model ids and HF repo metadata
- `src/llm/analyzeStatement.ts` — narrative + structured JSON pass
- `src/llm/structuredExtractPrompt.ts` / `parseStructuredSpend.ts` — chart data
- `src/ui/renderWeeklyChart.ts` — chart HTML
- `src/styles/tokens.css` — design tokens (FinVision Precision)

## Troubleshooting

### `OrtRun` / `SafeIntOnOverflow` / “Integer overflow” during analysis

The browser ONNX runtime can overflow if the **tokenized prompt is too long** (very large PDFs). This app **clips** extracted text to a **per-model** safe character budget before calling the model (see `src/llm/modelInputLimits.ts`). If you still hit overflow, lower the caps for that model in that file and rebuild.

### Model download or GPU errors

Use an up-to-date **Chrome** or **Edge** with **WebGPU**, enough **VRAM/RAM**, and a stable network for the first model download.

## Disclaimer

This tool is **not** financial, legal, or tax advice. Verify all numbers against your original statement.
