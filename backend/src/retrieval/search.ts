import { embed } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import db from '../db';
import { knowledgeChunks, knowledgeDocuments } from '../db/schema';
import { config } from '../utils/config';

export type KnowledgeItem = { id: string; type: 'PROCUREMENT_POLICY' | 'VENDOR_PROFILE' | 'HISTORICAL_QUOTE' | 'HISTORICAL_NEGOTIATION' | 'CONTRACT_TERM' | 'PROCUREMENT_SOP'; title: string; content: string; metadata?: Record<string, unknown> };
export type RetrievalResult = { items: KnowledgeItem[]; mode: 'pgvector' | 'lexical' };
const localKnowledge: KnowledgeItem[] = [
  { id: 'policy-advance', type: 'PROCUREMENT_POLICY', title: 'Business hardware payment policy', content: 'Business hardware purchases may not exceed 20% advance payment without human approval. Balance is due on delivery.', metadata: { category: 'Business hardware' } },
  { id: 'policy-quality', type: 'PROCUREMENT_POLICY', title: 'Laptop quality policy', content: 'Laptop purchases require at least 24 months warranty and delivery within the approved request deadline.', metadata: { category: 'Business hardware' } },
  { id: 'sop-stop', type: 'PROCUREMENT_SOP', title: 'Negotiation stopping guidance', content: 'Stop after five rounds or when expected improvement is too small. Preserve the last compliant offer and escalate uncertainty.', metadata: { version: '1.0' } },
  { id: 'history-vertex', type: 'HISTORICAL_NEGOTIATION', title: 'Vertex Systems history', content: 'Vertex typically trades price improvement for firm payment terms and has a high on-time delivery rate.', metadata: { vendorSlug: 'vendor-c' } },
];

const lexical = (items: KnowledgeItem[], query: string, filters?: Partial<Pick<KnowledgeItem, 'type'>> & { category?: string }) => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => (!filters?.type || item.type === filters.type) && (!filters?.category || item.metadata?.category === filters.category)).map((item) => ({ item, score: terms.reduce((score, term) => score + (item.title.toLowerCase().includes(term) || item.content.toLowerCase().includes(term) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score).slice(0, 5).map(({ item }) => item);
};

export const searchKnowledge = (query: string, filters?: Partial<Pick<KnowledgeItem, 'type'>> & { category?: string }) => lexical(localKnowledge, query, filters);

export async function retrieveKnowledge(query: string, filters?: Partial<Pick<KnowledgeItem, 'type'>> & { category?: string }): Promise<RetrievalResult> {
  if (!db) return { items: searchKnowledge(query, filters), mode: 'lexical' };
  try {
    if (config.googleApiKey) {
      const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey });
      const { embedding } = await embed({ model: google.embeddingModel(config.embeddingModel), value: query });
      const typeFilter = filters?.type ? sql`AND d.type = ${filters.type}` : sql.empty();
      const categoryFilter = filters?.category ? sql`AND COALESCE(c.metadata->>'category', d.metadata->>'category') = ${filters.category}` : sql.empty();
      const rows = await db.execute(sql`SELECT c.id, d.type, d.title, c.content, c.metadata FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id WHERE c.embedding IS NOT NULL ${typeFilter} ${categoryFilter} ORDER BY c.embedding <=> ${JSON.stringify(embedding)}::vector LIMIT 5`);
      const items = (rows as unknown as Array<{ id: string; type: KnowledgeItem['type']; title: string; content: string; metadata?: Record<string, unknown> }>).map((row) => ({ id: row.id, type: row.type, title: row.title, content: row.content, metadata: row.metadata }));
      if (items.length) return { items, mode: 'pgvector' };
    }
    const rows = await db.select({ id: knowledgeChunks.id, type: knowledgeDocuments.type, title: knowledgeDocuments.title, content: knowledgeChunks.content, metadata: knowledgeChunks.metadata }).from(knowledgeChunks).innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id)).where(filters?.type ? eq(knowledgeDocuments.type, filters.type) : undefined).limit(200);
    const items = lexical(rows.map((row) => ({ id: row.id, type: row.type as KnowledgeItem['type'], title: row.title, content: row.content, metadata: row.metadata as Record<string, unknown> | undefined })), query, filters);
    return { items, mode: 'lexical' };
  } catch {
    return { items: searchKnowledge(query, filters), mode: 'lexical' };
  }
}
