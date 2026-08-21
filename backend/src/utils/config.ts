import dotenv from 'dotenv';

dotenv.config();

export const config = {
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 3001),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:3000',
  googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  primaryModel: process.env.PRIMARY_MODEL ?? 'gemini-3.7-flash',
  criticModel: process.env.CRITIC_MODEL ?? 'gemini-3.1-flash-lite',
  fallbackModel: process.env.FALLBACK_MODEL ?? 'deepseek/deepseek-v3.2',
  maxRounds: Number(process.env.MAX_NEGOTIATION_ROUNDS ?? 5),
};
