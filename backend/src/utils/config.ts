import dotenv from 'dotenv';

dotenv.config();

const parsePricing = () => {
  if (!process.env.MODEL_PRICING_JSON) return null;
  try { return JSON.parse(process.env.MODEL_PRICING_JSON) as Record<string, { inputPerMillion?: number; outputPerMillion?: number }>; } catch { return null; }
};

export const config = {
  databaseUrl: process.env.DATABASE_URL,
  apiKey: process.env.PROCURA_API_KEY,
  port: Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 3001),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:3000',
  googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  primaryModel: process.env.PRIMARY_MODEL ?? 'gemini-3.7-flash',
  criticModel: process.env.CRITIC_MODEL ?? 'gemini-3.1-flash-lite',
  fallbackModel: process.env.FALLBACK_MODEL ?? 'deepseek/deepseek-v3.2',
  maxRounds: Number(process.env.MAX_NEGOTIATION_ROUNDS ?? 5),
  embeddingModel: process.env.EMBEDDING_MODEL ?? 'text-embedding-004',
  modelPricing: parsePricing(),
};

export function assertProductionConfig() {
  const missing = ['DATABASE_URL', 'GOOGLE_GENERATIVE_AI_API_KEY', 'OPENROUTER_API_KEY', 'PROCURA_API_KEY'].filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
}

export function assertSeedConfig() {
  const missing = ['DATABASE_URL', 'GOOGLE_GENERATIVE_AI_API_KEY'].filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required seed configuration: ${missing.join(', ')}`);
}
