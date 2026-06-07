// src/api/providers/index.ts - Provider factory and exports

import type { ProviderAdapter } from '../provider.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';

export type ProviderType = 'anthropic' | 'openai' | 'gemini' | 'auto';

export function createProvider(
  type: ProviderType,
  apiKey: string,
  baseUrl: string,
  model: string,
): ProviderAdapter {
  // Auto-detect from URL
  if (type === 'auto') {
    if (baseUrl.includes('openai.com') || baseUrl.includes('azure')) type = 'openai';
    else if (baseUrl.includes('google') || baseUrl.includes('gemini')) type = 'gemini';
    else type = 'anthropic';
  }

  switch (type) {
    case 'openai':
      return new OpenAIProvider(apiKey, baseUrl, model);
    case 'gemini':
      return new GeminiProvider(apiKey, baseUrl, model);
    case 'anthropic':
    default:
      return new AnthropicProvider(apiKey, baseUrl, model);
  }
}

export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export { GeminiProvider } from './gemini.js';
