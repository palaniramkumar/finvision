import type { Message } from '@huggingface/transformers'
import { MODEL_CONFIG } from './models'
import type { ModelId } from './models'
import type { GenerateOptions, ModelBackend, ProgressInfo } from './types'

type ProcessorCallable = {
  apply_chat_template: (messages: Message[], options?: Record<string, unknown>) => string
  batch_decode: (tensor: unknown, options: { skip_special_tokens: boolean }) => string[]
  tokenizer: unknown
  (text: string, images: null, audio: null, options: Record<string, unknown>): Promise<Record<string, unknown>>
}

type ModelGen = {
  generate: (kwargs: Record<string, unknown>) => Promise<unknown>
}

const MODEL_ID: ModelId = 'gemma-4-e2b'
const REPO = MODEL_CONFIG[MODEL_ID].repoId

export class GemmaBackend implements ModelBackend {
  readonly modelId = MODEL_ID
  private session: { processor: ProcessorCallable; model: ModelGen } | null = null

  async load(onProgress?: (info: ProgressInfo) => void): Promise<void> {
    if (this.session) return

    const { AutoProcessor, Gemma4ForConditionalGeneration } = await import('@huggingface/transformers')
    const loadOpts = { dtype: 'q4f16' as const, device: 'webgpu' as const, progress_callback: onProgress }

    const [processor, model] = await Promise.all([
      AutoProcessor.from_pretrained(REPO, { progress_callback: onProgress }),
      Gemma4ForConditionalGeneration.from_pretrained(REPO, loadOpts),
    ])

    this.session = { processor: processor as ProcessorCallable, model: model as ModelGen }
  }

  async dispose(): Promise<void> {
    const s = this.session
    this.session = null
    if (s) {
      // In Transformers.js, calling dispose() on the model and processor 
      // is critical for releasing WebGPU/WASM memory buffers.
      if (typeof (s.model as any).dispose === 'function') {
        await (s.model as any).dispose()
      }
      if (typeof (s.processor as any).dispose === 'function') {
        await (s.processor as any).dispose()
      }
    }
  }

  async generate(messages: Message[], options: GenerateOptions = {}): Promise<string> {
    if (!this.session) {
      throw new Error('Gemma model not loaded.')
    }

    const { processor, model } = this.session
    const maxNewTokens = options.maxNewTokens ?? 768

    const prompt = processor.apply_chat_template(messages, {
      enable_thinking: false,
      add_generation_prompt: true,
      tokenize: false,
    })

    const inputs = await processor(prompt, null, null, { add_special_tokens: false })

    if (options.onStreamChunk) {
      const { TextStreamer } = await import('@huggingface/transformers')
      let accumulated = ''
      const streamer = new TextStreamer(processor.tokenizer as never, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (chunk: string) => {
          accumulated += chunk
          options.onStreamChunk!(chunk)
        },
      })

      await model.generate({
        ...inputs,
        max_new_tokens: maxNewTokens,
        do_sample: false,
        repetition_penalty: 1.1,
        streamer,
      })
      return accumulated
    }

    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: maxNewTokens,
      do_sample: false,
      repetition_penalty: 1.1,
    })

    const inputIds = inputs.input_ids as { dims: { at: (i: number) => number } }
    const start = inputIds.dims.at(-1) ?? 0
    const outTensor = outputs as { slice: (a: null, b: [number, null]) => unknown }
    const decoded = processor.batch_decode(outTensor.slice(null, [start, null]), {
      skip_special_tokens: true,
    })
    return decoded[0] ?? ''
  }
}
