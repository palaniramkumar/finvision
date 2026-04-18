import type { Message } from '@huggingface/transformers'
import type { ModelId } from './models'

export type ProgressInfo = Record<string, unknown>

export type GenerateOptions = {
  maxNewTokens?: number
  onStreamChunk?: (text: string) => void
}

export interface ModelBackend {
  readonly modelId: ModelId
  load(onProgress?: (info: ProgressInfo) => void): Promise<void>
  generate(messages: Message[], options?: GenerateOptions): Promise<string>
  dispose(): Promise<void> | void
}
