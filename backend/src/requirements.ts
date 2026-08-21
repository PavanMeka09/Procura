import { ValidationError } from './errors';
import type { ProcurementRequest } from './domain';

const DEFAULT_TARGET_PRICE = 55000;
const DEFAULT_PRICE_BUFFER = 2000;
const DEFAULT_DELIVERY_DAYS = 21;
const DEFAULT_WARRANTY_MONTHS = 24;
const DEFAULT_ADVANCE_PAYMENT_PERCENT = 20;

/**
 * Helper to match first capturing group from an array of regex patterns and parse as a number.
 */
function extractNumberByPatterns(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return Number(match[1].replace(/,/g, ''));
    }
  }
  return null;
}

/**
 * Extracts structured procurement requirements from natural language purchase requests.
 */
export function extractRequirements(rawRequest: string): ProcurementRequest {
  const raw = rawRequest.trim();
  if (raw.length < 8) {
    throw new ValidationError('Purchase requirement is too short.');
  }

  // 1. Quantity extraction
  const quantity =
    extractNumberByPatterns(raw, [
      /([\d,]+)\s*(?:business\s+)?(?:laptops?|units?|pieces?)/i,
      /buy\s+([\d,]+)/i,
    ]) ?? 1;

  // 2. Price constraints
  const targetUnitPrice = extractNumberByPatterns(raw, [
    /(?:target|under|below|at|of)\s*₹?\s*([\d,]+)/i,
    /₹\s*([\d,]+)/i,
  ]);

  const explicitMaximumUnitPrice = extractNumberByPatterns(raw, [
    /(?:maximum|max(?:imum)?|up\s+to)\s*(?:unit\s+)?(?:price|budget)?\s*₹?\s*([\d,]+)/i,
  ]);

  const maximumUnitPrice =
    explicitMaximumUnitPrice ??
    ((targetUnitPrice ?? DEFAULT_TARGET_PRICE) + DEFAULT_PRICE_BUFFER);

  // 3. Delivery constraints
  const deliveryDays =
    extractNumberByPatterns(raw, [
      /(?:within|in|delivery\s*(?:within|by)?)\s*(\d+)\s*days?/i,
    ]) ?? DEFAULT_DELIVERY_DAYS;

  // 4. Warranty constraints
  const minimumWarrantyMonths = extractNumberByPatterns(raw, [
    /(?:at\s+least|minimum|min\.?|with)\s*(\d+)\s*(?:months?|month\s+warranty)/i,
    /(\d+)\s*(?:year|yr)s?\s+warranty/i,
  ]);

  const warranty =
    minimumWarrantyMonths ??
    (raw.match(/two-year|2-year|24-month/i)
      ? DEFAULT_WARRANTY_MONTHS
      : DEFAULT_WARRANTY_MONTHS);

  // 5. Advance payment constraints
  const maximumAdvancePaymentPercent =
    extractNumberByPatterns(raw, [
      /(?:no\s+more\s+than|max(?:imum)?|up\s+to)\s*(\d+)\s*%\s*(?:advance|upfront)/i,
      /(\d+)\s*%\s*advance/i,
    ]) ?? DEFAULT_ADVANCE_PAYMENT_PERCENT;

  // 6. Item name
  const itemMatch = raw.match(
    /(?:buy|purchase|source)\s+(?:\d+\s+)?(.+?)(?:\s+(?:under|below|within|with|at\s+least|and\s+no\s+more)|$)/i
  );
  const item = itemMatch?.[1]?.trim().replace(/[,.]$/, '') || 'business laptops';

  return {
    item,
    quantity,
    targetUnitPrice: targetUnitPrice ?? DEFAULT_TARGET_PRICE,
    maximumUnitPrice,
    deliveryDays,
    minimumWarrantyMonths: warranty,
    maximumAdvancePaymentPercent,
    negotiableTerms: ['unit price', 'delivery schedule', 'payment terms'],
    nonNegotiableTerms: [
      'maximum unit price',
      'minimum warranty',
      'maximum advance payment',
    ],
  };
}
