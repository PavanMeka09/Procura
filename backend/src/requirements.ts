import { ValidationError } from './errors';
import type { ProcurementRequest } from './domain';

const numberAfter = (text: string, patterns: RegExp[]) => { for (const pattern of patterns) { const match = text.match(pattern); if (match?.[1]) return Number(match[1].replace(/,/g, '')); } return null; };

export function extractRequirements(rawRequest: string): ProcurementRequest {
  const raw = rawRequest.trim();
  if (raw.length < 8) throw new ValidationError('Purchase requirement is too short.');
  const quantity = numberAfter(raw, [/([\d,]+)\s*(?:business\s+)?(?:laptops?|units?|pieces?)/i, /buy\s+([\d,]+)/i]) ?? 1;
  const targetUnitPrice = numberAfter(raw, [/(?:target|under|below|at|of)\s*₹?\s*([\d,]+)/i, /₹\s*([\d,]+)/i]);
  const explicitMaximumUnitPrice = numberAfter(raw, [/(?:maximum|max(?:imum)?|up\s+to)\s*(?:unit\s+)?(?:price|budget)?\s*₹?\s*([\d,]+)/i]);
  const maximumUnitPrice = explicitMaximumUnitPrice ?? ((targetUnitPrice ?? 55000) + 2000);
  const deliveryDays = numberAfter(raw, [/(?:within|in|delivery\s*(?:within|by)?)\s*(\d+)\s*days?/i]) ?? 21;
  const minimumWarrantyMonths = numberAfter(raw, [/(?:at\s+least|minimum|min\.?|with)\s*(\d+)\s*(?:months?|month\s+warranty)/i, /(\d+)\s*(?:year|yr)s?\s+warranty/i]);
  const maximumAdvancePaymentPercent = numberAfter(raw, [/(?:no\s+more\s+than|max(?:imum)?|up\s+to)\s*(\d+)\s*%\s*(?:advance|upfront)/i, /(\d+)\s*%\s*advance/i]) ?? 20;
  const itemMatch = raw.match(/(?:buy|purchase|source)\s+(?:\d+\s+)?(.+?)(?:\s+(?:under|below|within|with|at\s+least|and\s+no\s+more)|$)/i);
  const item = itemMatch?.[1]?.trim().replace(/[,.]$/, '') || 'business laptops';
  const warranty = minimumWarrantyMonths ?? (raw.match(/two-year|2-year|24-month/i) ? 24 : 24);
  return { item, quantity, targetUnitPrice: targetUnitPrice ?? 55000, maximumUnitPrice, deliveryDays, minimumWarrantyMonths: warranty, maximumAdvancePaymentPercent, negotiableTerms: ['unit price', 'delivery schedule', 'payment terms'], nonNegotiableTerms: ['maximum unit price', 'minimum warranty', 'maximum advance payment'] };
}
