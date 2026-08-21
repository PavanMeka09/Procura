import { evaluationCases } from '../evaluation/cases';
import { embed } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { seededVendors } from '../vendors/simulator';
import { now } from '../domain';
import { assertProductionConfig, config } from '../utils/config';
import { persistEvaluationCase, persistKnowledgeChunk, persistKnowledgeDocument, persistPolicyRule, persistRequest, persistVendor } from './repository';

const canonicalRequest = { id: '00000000-0000-4000-8000-000000000001', rawRequest: 'Canonical seeded procurement request', item: 'business laptops', quantity: 500, targetUnitPrice: 55000, maximumUnitPrice: 57000, deliveryDays: 21, minimumWarrantyMonths: 24, maximumAdvancePaymentPercent: 20, status: 'SEEDED', createdAt: now() };
const documentId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const caseId = (index: number) => `00000000-0000-4000-8001-${String(index).padStart(12, '0')}`;
const knowledge = [
  { type: 'PROCUREMENT_POLICY', title: 'Business hardware payment policy', content: 'Business hardware purchases may not exceed 20% advance payment without human approval. Balance is due on delivery.', metadata: { category: 'Business hardware', source: 'Procurement policy v1' } },
  { type: 'PROCUREMENT_POLICY', title: 'Laptop quality policy', content: 'Laptop purchases require at least 24 months warranty and delivery within the approved request deadline.', metadata: { category: 'Business hardware', source: 'Procurement policy v1' } },
  { type: 'VENDOR_PROFILE', title: 'Approved vendor profiles', content: 'Apex Devices, Northstar IT, and Vertex Systems are approved business hardware vendors. Vendor identity is keyed by stable slug and UUID.', metadata: { category: 'Business hardware' } },
  { type: 'HISTORICAL_QUOTE', title: 'Historical laptop quotes', content: 'Comparable laptop quotes range from ₹55,500 to ₹62,000 per unit. Price is evaluated together with delivery, warranty, and payment terms.', metadata: { category: 'Business hardware' } },
  { type: 'HISTORICAL_NEGOTIATION', title: 'Vertex negotiation history', content: 'Vertex typically trades price improvement for firm payment terms and has a high on-time delivery rate.', metadata: { vendorSlug: 'vendor-c', category: 'Business hardware' } },
  { type: 'CONTRACT_TERM', title: 'Standard commercial terms', content: 'Standard terms require balance on delivery, a stated offer validity period, and no unapproved conditions.', metadata: { category: 'Business hardware' } },
  { type: 'PROCUREMENT_SOP', title: 'Negotiation stopping guidance', content: 'Stop after five rounds or when expected improvement is too small. Preserve the last compliant offer and escalate uncertainty.', metadata: { version: '1.0' } },
];
const rules = [
  { name: 'Maximum advance payment', field: 'advancePaymentPercent', operator: '<=', threshold: 20, severity: 'HARD', action: 'BLOCK', description: 'Advance payment cannot exceed the request limit.' },
  { name: 'Maximum unit price', field: 'unitPrice', operator: '<=', threshold: 57000, severity: 'HARD', action: 'BLOCK', description: 'Unit price cannot exceed the request maximum.' },
  { name: 'Minimum warranty', field: 'warrantyMonths', operator: '>=', threshold: 24, severity: 'HARD', action: 'BLOCK', description: 'Warranty must meet the minimum request term.' },
  { name: 'Delivery deadline', field: 'deliveryDays', operator: '<=', threshold: 21, severity: 'HARD', action: 'BLOCK', description: 'Delivery cannot exceed the request deadline.' },
];

async function seed() {
  assertProductionConfig();
  const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey! });
  await persistRequest(canonicalRequest);
  for (const vendor of seededVendors(canonicalRequest.id)) await persistVendor(vendor);
  for (const [index, document] of knowledge.entries()) {
    const id = documentId(index + 1);
    await persistKnowledgeDocument({ id, ...document });
    const { embedding } = await embed({ model: google.embeddingModel(config.embeddingModel), value: document.content });
    await persistKnowledgeChunk({ id: documentId(index + 20), documentId: id, content: document.content, embedding, metadata: document.metadata });
  }
  for (const [index, rule] of rules.entries()) await persistPolicyRule({ id: documentId(index + 40), ...rule });
  for (const [index, testCase] of evaluationCases.entries()) await persistEvaluationCase({ id: caseId(index + 1), name: testCase.name, input: testCase.input, scenarioConfig: testCase.scenarioConfig, expectedBehavior: testCase.expectedBehavior });
  console.log(JSON.stringify({ seeded: true, vendors: seededVendors(canonicalRequest.id).map((vendor) => ({ id: vendor.id, slug: vendor.slug, name: vendor.name })), knowledgeDocuments: knowledge.length, policyRules: rules.length, evaluationCases: evaluationCases.length, requestId: canonicalRequest.id }, null, 2));
}

await seed();
