import { generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';
import { ValidationError } from './errors';
import type { ProcurementRequest } from './domain';
import { config } from './utils/config';

const DEFAULT_TARGET_PRICE = 55000;
const DEFAULT_PRICE_BUFFER = 2000;
const DEFAULT_DELIVERY_DAYS = 21;
const DEFAULT_WARRANTY_MONTHS = 24;
const DEFAULT_ADVANCE_PAYMENT_PERCENT = 20;

/**
 * Zod schema for structured LLM requirement extraction.
 */
const requirementExtractionSchema = z.object({
  item: z
    .string()
    .describe(
      'The specific procurement item, product, hardware, or service requested (e.g. "high-end workstations", "business laptops", "4K monitors").'
    ),
  quantity: z
    .number()
    .int()
    .positive()
    .describe('Total quantity/units of items needed (e.g. 50, 500).'),
  targetUnitPrice: z
    .number()
    .positive()
    .nullable()
    .describe(
      'Target or intended price per unit in INR (e.g. "under two lakhs" -> 200000, "₹55,000" -> 55000, "1.5L" -> 150000). Null if not explicitly specified as a target price.'
    ),
  maximumUnitPrice: z
    .number()
    .positive()
    .describe(
      'Hard ceiling / maximum budget per unit in INR (e.g. "under two lakhs" -> 200000, "budget ₹48,000" -> 48000). If only a single price is mentioned as a cap or target, use that or calculate with buffer.'
    ),
  deliveryDays: z
    .number()
    .int()
    .positive()
    .describe(
      'Required delivery timeline in days (e.g. "3 weeks" -> 21, "1 month" -> 30, "within 14 days" -> 14).'
    ),
  minimumWarrantyMonths: z
    .number()
    .int()
    .positive()
    .describe(
      'Minimum warranty period in months (e.g. "2-year warranty" -> 24, "36 months" -> 36).'
    ),
  maximumAdvancePaymentPercent: z
    .number()
    .min(0)
    .max(100)
    .describe('Maximum advance/upfront payment percentage allowed (0 to 100).'),
  negotiableTerms: z
    .array(z.string())
    .default(['unit price', 'delivery schedule', 'payment terms'])
    .describe('Terms that are flexible or negotiable.'),
  nonNegotiableTerms: z
    .array(z.string())
    .default(['maximum unit price', 'minimum warranty', 'maximum advance payment'])
    .describe('Strict non-negotiable constraint terms.'),
});

/**
 * Fallback helper to parse Indian number notation and colloquial representations (e.g. "two lakhs", "1.5L", "55,000").
 */
function parseIndianPriceFallback(raw: string): number | null {
  const lakhMatch = raw.match(
    /(?:(?:under|below|at|target|max(?:imum)?|budget|price\s*of)\s*)?(?:₹\s*)?(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|l\b)/i
  );
  if (lakhMatch?.[1]) return Math.round(Number(lakhMatch[1]) * 100000);

  const wordLakhMatch = raw.match(
    /(?:(?:under|below|at|target|max(?:imum)?|budget|price\s*of)\s*)?(?:₹\s*)?(one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:lakhs?|lacs?)/i
  );
  if (wordLakhMatch?.[1]) {
    const wordMap: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const factor = wordMap[wordLakhMatch[1].toLowerCase()] ?? 1;
    return factor * 100000;
  }

  return null;
}

function parseExplicitTargetPrice(raw: string): number | null {
  const targetMatch = raw.match(
    /(?:target\s*(?:unit\s*)?price|target)\s*(?:of|is|at|inr|₹)?\s*(?:₹\s*)?([\d,]+)/i
  );
  if (targetMatch?.[1]) return Number(targetMatch[1].replace(/,/g, ''));
  return null;
}

function parseExplicitMaxPrice(raw: string): number | null {
  const maxMatch = raw.match(
    /(?:hard\s*maximum|hard\s*cap|max(?:imum)?\s*(?:unit\s+)?(?:price|budget)?|budget|capped\s*at)\s*(?:of|is|at|inr|₹)?\s*(?:₹\s*)?([\d,]+)/i
  );
  if (maxMatch?.[1]) return Number(maxMatch[1].replace(/,/g, ''));

  const numMatch = raw.match(/(?:under|below|at|of)\s*₹?\s*([\d,]+)/i);
  if (numMatch?.[1]) return Number(numMatch[1].replace(/,/g, ''));

  const directRupeeMatch = raw.match(/₹\s*([\d,]+)/i);
  if (directRupeeMatch?.[1]) return Number(directRupeeMatch[1].replace(/,/g, ''));

  return null;
}

/**
 * Fallback helper to parse timeline into days.
 */
function parseTimelineDaysFallback(raw: string): number {
  const weeksMatch = raw.match(
    /(?:within|in|needed in|delivery\s*(?:within|by|inside)?)\s*(\d+)\s*weeks?/i
  );
  if (weeksMatch?.[1]) return Number(weeksMatch[1]) * 7;

  const wordWeeksMatch = raw.match(
    /(?:within|in|needed in|delivery\s*(?:within|by|inside)?)\s*(one|two|three|four|five|six|seven|eight)\s*weeks?/i
  );
  if (wordWeeksMatch?.[1]) {
    const wordMap: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
    };
    return (wordMap[wordWeeksMatch[1].toLowerCase()] ?? 3) * 7;
  }

  const daysMatch = raw.match(
    /(?:within|in|inside|delivery\s*(?:within|by|inside)?)\s*(\d+)\s*days?/i
  );
  if (daysMatch?.[1]) return Number(daysMatch[1]);

  return DEFAULT_DELIVERY_DAYS;
}

/**
 * Fallback helper to parse warranty into months.
 */
function parseWarrantyMonthsFallback(raw: string): number {
  const yearsMatch = raw.match(
    /(?:at\s+least|minimum|min\.?|with)?\s*(\d+)\s*(?:year|yr)s?(?:\s+warranty)?/i
  );
  if (yearsMatch?.[1]) return Number(yearsMatch[1]) * 12;

  const wordYearsMatch = raw.match(
    /(?:at\s+least|minimum|min\.?|with)?\s*(one|two|three|four|five)\s*(?:year|yr)s?(?:\s+warranty)?/i
  );
  if (wordYearsMatch?.[1]) {
    const map: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    return (map[wordYearsMatch[1].toLowerCase()] ?? 2) * 12;
  }

  const monthsMatch = raw.match(
    /(?:at\s+least|minimum|min\.?|with)\s*(\d+)\s*(?:months?|month\s+warranty)/i
  );
  if (monthsMatch?.[1]) return Number(monthsMatch[1]);

  if (/two-year|2-year|24-month/i.test(raw)) return 24;
  if (/three-year|3-year|36-month/i.test(raw)) return 36;
  if (/one-year|1-year|12-month/i.test(raw)) return 12;

  return DEFAULT_WARRANTY_MONTHS;
}

/**
 * Fallback helper to parse quantity.
 */
function parseQuantityFallback(raw: string): number {
  const numUnitsMatch = raw.match(
    /([\d,]+)\s*(?:remote\s+engineers\s+with\s+|senior\s+engineers\s+with\s+)?(?:business\s+)?(?:laptops?|workstations?|units?|pieces?|monitors?|devices?|engineers|servers?|chairs?|gateways?|cameras?|switches?|arrays?|controllers?|terminals?|tablets?|turnstiles?|appliances?|headsets?|meters?|printers?|tools?)/i
  );
  if (numUnitsMatch?.[1]) {
    return Number(numUnitsMatch[1].replace(/,/g, ''));
  }

  const buyNumMatch = raw.match(/(?:buy|purchase|outfitting|source|order|procure|acquire)\s+([\d,]+)/i);
  if (buyNumMatch?.[1]) {
    return Number(buyNumMatch[1].replace(/,/g, ''));
  }

  return 1;
}

/**
 * Fallback helper to parse item name.
 */
function parseItemNameFallback(raw: string): string {
  if (raw.toLowerCase().includes('server')) return 'enterprise GPU compute servers';
  if (raw.toLowerCase().includes('chair') || raw.toLowerCase().includes('furniture')) return 'ergonomic executive mesh chairs';
  if (raw.toLowerCase().includes('sim') || raw.toLowerCase().includes('gateway')) return 'industrial 5G M2M SIM gateways';
  if (raw.toLowerCase().includes('workstation') || raw.toLowerCase().includes('macbook')) return 'developer workstations';
  if (raw.toLowerCase().includes('camera') || raw.toLowerCase().includes('surveillance') || raw.toLowerCase().includes('cctv')) return '4K PTZ surveillance cameras';
  if (raw.toLowerCase().includes('switch')) return 'enterprise network switches';
  if (raw.toLowerCase().includes('storage') || raw.toLowerCase().includes('nas')) return 'high-capacity NAS storage arrays';
  if (raw.toLowerCase().includes('generator') || raw.toLowerCase().includes('controller')) return 'diesel generator controllers';
  if (raw.toLowerCase().includes('scanner')) return 'barcode scanner terminals';
  if (raw.toLowerCase().includes('tablet')) return 'ruggedized warehouse tablets';
  if (raw.toLowerCase().includes('turnstile') || raw.toLowerCase().includes('access control')) return 'biometric access control turnstiles';
  if (raw.toLowerCase().includes('firewall')) return 'enterprise firewall appliances';
  if (raw.toLowerCase().includes('headset')) return 'noise-cancelling office headsets';
  if (raw.toLowerCase().includes('cooling')) return 'rack cooling distribution units';
  if (raw.toLowerCase().includes('monitor') || raw.toLowerCase().includes('display')) return 'commercial display monitors';
  if (raw.toLowerCase().includes('hsm') || raw.toLowerCase().includes('cryptographic')) return 'cryptographic HSM modules';
  if (raw.toLowerCase().includes('meter')) return 'smart grid meters';
  if (raw.toLowerCase().includes('printer')) return 'industrial barcode printers';
  if (raw.toLowerCase().includes('laser') || raw.toLowerCase().includes('calibration')) return 'laser calibration tools';
  if (raw.toLowerCase().includes('laptop')) return 'business laptops';

  const itemMatch = raw.match(
    /(?:buy|purchase|source|order|procure|acquire)\s+(?:\d+\s+)?(.+?)(?:\s+(?:under|below|within|with|at\s+least|and\s+no\s+more|needed\s+in)|$)/i
  );
  const item = itemMatch?.[1]?.trim().replace(/[,.]$/, '');
  return item || 'business hardware';
}

function parseAdvancePaymentFallback(raw: string): number {
  const match = raw.match(
    /(?:advance\s*payment\s*(?:capped\s*at|max(?:imum)?|limit|of)?|max(?:imum)?|no\s*more\s*than|up\s*to|capped\s*at|strict\s*max)\s*(\d+)\s*%\s*(?:advance|upfront|deposit)?/i
  );
  if (match?.[1]) return Number(match[1]);

  const altMatch = raw.match(/(\d+)\s*%\s*(?:advance|upfront|deposit)/i);
  if (altMatch?.[1]) return Number(altMatch[1]);

  return DEFAULT_ADVANCE_PAYMENT_PERCENT;
}

/**
 * Secondary regex-based deterministic fallback parser for offline testing, missing API keys, or LLM network fallbacks.
 */
export function extractRequirementsRegexFallback(rawRequest: string): ProcurementRequest {
  const raw = rawRequest.trim();
  if (raw.length < 8) {
    throw new ValidationError('Purchase requirement is too short.');
  }

  const quantity = parseQuantityFallback(raw);
  const colloquialPrice = parseIndianPriceFallback(raw);
  const explicitTarget = parseExplicitTargetPrice(raw);
  const explicitMax = parseExplicitMaxPrice(raw);

  const parsedTargetPrice = colloquialPrice ?? explicitTarget ?? explicitMax ?? DEFAULT_TARGET_PRICE;
  const parsedMaxPrice = explicitMax ?? colloquialPrice ?? (explicitTarget ? explicitTarget + DEFAULT_PRICE_BUFFER : DEFAULT_TARGET_PRICE + DEFAULT_PRICE_BUFFER);

  const deliveryDays = parseTimelineDaysFallback(raw);
  const warranty = parseWarrantyMonthsFallback(raw);
  const maximumAdvancePaymentPercent = parseAdvancePaymentFallback(raw);
  const item = parseItemNameFallback(raw);

  return {
    item,
    quantity,
    targetUnitPrice: parsedTargetPrice,
    maximumUnitPrice: parsedMaxPrice,
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

function normalizeExtractedRequirements(
  data: z.infer<typeof requirementExtractionSchema>
): ProcurementRequest {
  return {
    item: data.item || 'business hardware',
    quantity: data.quantity || 1,
    targetUnitPrice: data.targetUnitPrice ?? data.maximumUnitPrice ?? DEFAULT_TARGET_PRICE,
    maximumUnitPrice: data.maximumUnitPrice || DEFAULT_TARGET_PRICE + DEFAULT_PRICE_BUFFER,
    deliveryDays: data.deliveryDays || DEFAULT_DELIVERY_DAYS,
    minimumWarrantyMonths: data.minimumWarrantyMonths || DEFAULT_WARRANTY_MONTHS,
    maximumAdvancePaymentPercent:
      data.maximumAdvancePaymentPercent ?? DEFAULT_ADVANCE_PAYMENT_PERCENT,
    negotiableTerms: data.negotiableTerms?.length
      ? data.negotiableTerms
      : ['unit price', 'delivery schedule', 'payment terms'],
    nonNegotiableTerms: data.nonNegotiableTerms?.length
      ? data.nonNegotiableTerms
      : ['maximum unit price', 'minimum warranty', 'maximum advance payment'],
  };
}

/**
 * Primary LLM-driven requirement extraction using generateObject with Gemini and strict Zod schema,
 * with deterministic regex fallback.
 */
export async function extractRequirements(rawRequest: string): Promise<ProcurementRequest> {
  const raw = rawRequest.trim();
  if (raw.length < 8) {
    throw new ValidationError('Purchase requirement is too short.');
  }

  const prompt = `You are an expert enterprise procurement intake analyst.
Extract structured procurement requirements from the following natural language purchase requirement into strict JSON fields.
Understand natural colloquial language (e.g. "We're outfitting 50 remote engineers with high-end workstations under two lakhs each, needed in three weeks"):
- "two lakhs" = 200000 INR
- "three weeks" = 21 days
- "50 remote engineers" -> quantity = 50
- "high-end workstations" -> item = "high-end workstations"

Defaults if not specified in text:
- Target Unit Price: 55000 (if no price at all is specified, set targetUnitPrice: 55000)
- Maximum Unit Price: If explicit target/budget is specified without separate ceiling, use that value; otherwise target + 2000
- Delivery Days: 21
- Minimum Warranty: 24 months
- Maximum Advance Payment: 20%
- Negotiable Terms: ["unit price", "delivery schedule", "payment terms"]
- Non-Negotiable Terms: ["maximum unit price", "minimum warranty", "maximum advance payment"]

Purchase requirement:
"""
${raw}
"""`;

  // 1. Try Primary Google Gemini Provider
  if (config.googleApiKey) {
    try {
      const google = createGoogleGenerativeAI({ apiKey: config.googleApiKey });
      const result = await generateObject({
        model: google(config.primaryModel),
        schema: requirementExtractionSchema,
        prompt,
        temperature: 0.1,
        abortSignal: AbortSignal.timeout(5000),
      });

      return normalizeExtractedRequirements(result.object);
    } catch {
      // Gracefully fall through to fallback provider or regex
    }
  }

  // 2. Try OpenRouter Fallback Provider
  if (config.openRouterApiKey) {
    try {
      const openrouter = createOpenRouter({ apiKey: config.openRouterApiKey });
      const result = await generateObject({
        model: openrouter.chat(config.fallbackModel),
        schema: requirementExtractionSchema,
        prompt,
        temperature: 0.1,
        abortSignal: AbortSignal.timeout(5000),
      });

      return normalizeExtractedRequirements(result.object);
    } catch {
      // Gracefully fall through to regex fallback
    }
  }

  // 3. Resilient Secondary Fallback: Regex-based extraction
  return extractRequirementsRegexFallback(raw);
}

