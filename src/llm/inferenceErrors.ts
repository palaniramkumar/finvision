/**
 * Map low-level ONNX / WebGPU / WASM errors to short, actionable copy for users.
 */
export function friendlyInferenceError(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes('unaligned access')) {
    return `${raw} — This often comes from the browser GPU stack (ONNX WebGPU). Try: update Chrome/Edge, update GPU drivers, reload the tab, or switch to another model (e.g. Llama 3.2 1B).`
  }
  if (s.includes('safeint') || s.includes('overflow') || s.includes('out of memory')) {
    return `${raw} — Try a shorter statement, enable paginated analysis for long PDFs, or pick a smaller model.`
  }
  if (s.includes('webgpu') && (s.includes('not supported') || s.includes('unavailable'))) {
    return `${raw} — WebGPU may be unavailable. Use a recent desktop Chrome or Edge with GPU enabled.`
  }
  if (s.includes('external data') && s.includes('could not be resolved')) {
    return `${raw} — ONNX Runtime Web could not attach split weight files to the model. Reload the tab, clear site data for this origin if weights were cached incompletely, or switch model (Phi-4 uses merged q4 weights in this app to avoid a known q4f16 two-shard issue).`
  }
  return raw
}
