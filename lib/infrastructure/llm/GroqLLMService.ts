/**
 * Groq LLM Service
 *
 * Centralised Groq client configuration. All use cases and route
 * handlers should import the client from here rather than calling
 * createGroq() inline, so that the API key and model name are
 * configured in one place.
 */
import { createGroq } from '@ai-sdk/groq';

export const groqClient = createGroq({
  apiKey: process.env.GROQ_API_KEY,
});

/** Default model used across all LLM calls in the application. */
export const LLM_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct' as const;
