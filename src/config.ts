import * as dotenv from 'dotenv';
dotenv.config();

function optional(key: string, defaultValue: string = ''): string {
  return process.env[key] ?? defaultValue;
}

/**
 * Central config object — single source of truth for all env variables.
 * Always import from here, never read process.env directly in business logic.
 */
export const config = {
  app: {
    port: parseInt(optional('PORT', '3000'), 10),
    env: optional('NODE_ENV', 'development'),
    isDev: optional('NODE_ENV', 'development') === 'development',
  },
  llm: {
    geminiApiKey:  optional('GEMINI_API_KEY'),
    groqApiKey:    optional('GROQ_API_KEY'),
    ollamaHost:    optional('OLLAMA_HOST', 'http://localhost:11434'),
    ollamaModel:   optional('OLLAMA_MODEL', 'llama3'),
  },
  stt: {
    deepgramApiKey: optional('DEEPGRAM_API_KEY'),
    sarvamApiKey:   optional('SARVAM_API_KEY'),
  },
  tts: {
    sarvamApiKey: optional('SARVAM_API_KEY'),
  },
  livekit: {
    url:       optional('LIVEKIT_URL'),
    apiKey:    optional('LIVEKIT_API_KEY'),
    apiSecret: optional('LIVEKIT_API_SECRET'),
  },
  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },
  sms: {
    exotelSid:        optional('EXOTEL_SID'),
    exotelApiKey:     optional('EXOTEL_API_KEY'),
    exotelApiToken:   optional('EXOTEL_API_TOKEN'),
    exotelFromNumber: optional('EXOTEL_FROM_NUMBER'),
    exotelSubdomain:  optional('EXOTEL_SUBDOMAIN', 'api.exotel.com'),
  },
} as const;
