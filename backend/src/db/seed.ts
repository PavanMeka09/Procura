import { evaluationCases } from '../evaluation/cases';
import { seededVendors } from '../vendors/simulator';
import { store } from '../store';
import { createId, now } from '../domain';

const requestId = createId();
store.requests.set(requestId, { id: requestId, rawRequest: 'Canonical seeded procurement request', item: 'business laptops', quantity: 500, targetUnitPrice: 55000, maximumUnitPrice: 57000, deliveryDays: 21, minimumWarrantyMonths: 24, maximumAdvancePaymentPercent: 20, negotiableTerms: ['unit price', 'delivery schedule', 'payment terms'], nonNegotiableTerms: ['maximum unit price', 'minimum warranty', 'maximum advance payment'], status: 'SEEDED', createdAt: now() });
console.log(JSON.stringify({ seeded: true, vendors: seededVendors(requestId).map((vendor) => vendor.name), evaluationCases: evaluationCases.length, requestId }, null, 2));
