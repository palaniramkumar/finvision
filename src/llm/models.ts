export const MODEL_IDS = ['gemma-4-e2b', 'phi-4-mini', 'llama-3.2-1b'] as const
export type ModelId = (typeof MODEL_IDS)[number]

export const DEFAULT_MODEL_ID: ModelId = 'gemma-4-e2b'

export function isValidModelId(value: string): value is ModelId {
  return (MODEL_IDS as readonly string[]).includes(value)
}

export const MODEL_CONFIG: Record<
  ModelId,
  { label: string; repoId: string; progressLabel: string; approxSizeHint: string }
> = {
  'gemma-4-e2b': {
    label: 'Gemma 4 E2B (multimodal ONNX)',
    repoId: 'onnx-community/gemma-4-E2B-it-ONNX',
    progressLabel: 'Gemma 4 E2B',
    approxSizeHint: 'on the order of hundreds of MB',
  },
  'phi-4-mini': {
    label: 'Phi-4 Mini instruct (text-generation ONNX)',
    repoId: 'onnx-community/Phi-4-mini-instruct-ONNX-MHA',
    progressLabel: 'Phi-4 Mini',
    approxSizeHint: 'on the order of hundreds of MB',
  },
  'llama-3.2-1b': {
    label: 'Llama 3.2 1B Instruct (light ONNX, q4)',
    repoId: 'onnx-community/Llama-3.2-1B-Instruct-ONNX',
    progressLabel: 'Llama 3.2 1B',
    approxSizeHint: 'smaller than Gemma/Phi (~1B params, q4); still a sizable first download',
  },
}
