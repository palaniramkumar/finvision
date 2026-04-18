import type { Message } from '@huggingface/transformers'
import { MODEL_CONFIG, type ModelId } from './models'
import { GemmaBackend } from './gemmaBackend'
import { OnnxChatPipelineBackend } from './onnxChatPipelineBackend'
import type { GenerateOptions, ModelBackend, ProgressInfo } from './types'

let backend: ModelBackend | null = null
let loadedModelId: ModelId | null = null

/** Unload weights from memory if there is no load/generate activity for this long. */
const MODEL_IDLE_UNLOAD_MS = 10 * 60 * 1000

let idleUnloadTimer: ReturnType<typeof setTimeout> | null = null

function clearIdleUnloadTimer(): void {
  if (idleUnloadTimer !== null) {
    clearTimeout(idleUnloadTimer)
    idleUnloadTimer = null
  }
}

function scheduleIdleUnload(): void {
  clearIdleUnloadTimer()
  idleUnloadTimer = setTimeout(() => {
    idleUnloadTimer = null
    unloadSession()
  }, MODEL_IDLE_UNLOAD_MS)
}

export function webgpuSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu)
}

function createBackend(modelId: ModelId): ModelBackend {
  switch (modelId) {
    case 'gemma-4-e2b':
      return new GemmaBackend()
    case 'phi-4-mini':
      // q4f16 uses two ONNX external data shards (…onnx_data + …onnx_data_1); ORT Web often fails to
      // resolve the second path in-browser ("model directory path could not be resolved"). q4 uses one shard.
      return new OnnxChatPipelineBackend(
        'phi-4-mini',
        MODEL_CONFIG['phi-4-mini'].repoId,
        'q4',
        'Phi-4 Mini',
      )
    case 'llama-3.2-1b':
      return new OnnxChatPipelineBackend(
        'llama-3.2-1b',
        MODEL_CONFIG['llama-3.2-1b'].repoId,
        'q4',
        'Llama 3.2 1B',
      )
    default: {
      const _exhaustive: never = modelId
      return _exhaustive
    }
  }
}

export function getLoadedModelId(): ModelId | null {
  return loadedModelId
}

export async function unloadSession(): Promise<void> {
  clearIdleUnloadTimer()
  if (backend) await backend.dispose()
  backend = null
  loadedModelId = null
}

export async function loadModel(
  modelId: ModelId,
  onProgress?: (info: ProgressInfo) => void,
): Promise<void> {
  if (loadedModelId === modelId && backend) return
  if (!webgpuSupported()) {
    throw new Error(
      'WebGPU is not available in this browser. Use a recent Chrome or Edge on a compatible device.',
    )
  }
  await unloadSession()
  backend = createBackend(modelId)
  await backend.load(onProgress)
  loadedModelId = modelId
  scheduleIdleUnload()
}

export async function forceReloadModel(onProgress?: (info: ProgressInfo) => void): Promise<void> {
  const mid = loadedModelId
  if (!mid) return
  unloadSession()
  await loadModel(mid, onProgress)
}

export async function generateFromLoadedModel(
  messages: Message[],
  options?: GenerateOptions,
): Promise<string> {
  if (!backend) {
    throw new Error('Model not loaded. Call loadModel() first.')
  }
  clearIdleUnloadTimer()
  try {
    return await backend.generate(messages, options)
  } finally {
    if (backend) scheduleIdleUnload()
  }
}
