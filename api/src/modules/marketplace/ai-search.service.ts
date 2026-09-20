import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

export interface InterpretedSearch {
  listingType?: 'product' | 'service' | 'invention';
  category?: string;
  keywords?: string;
  location?: string;
  urgent: boolean;
}

const LISTING_TYPES = ['product', 'service', 'invention'];

const SYSTEM_PROMPT = `You turn a customer's plain-language request for a local service or product into structured search filters for a marketplace search. Respond with ONLY a JSON object, no other text, matching exactly this shape:
{"listingType": "product" | "service" | "invention" | null, "category": string | null, "keywords": string | null, "location": string | null, "urgent": boolean}
Rules:
- Never invent a business name, price, rating or availability - you are only extracting search filters, not answering the request or claiming any business exists.
- "category" should be a short, general category word (e.g. "barber", "electrician", "hotel"), not a full sentence.
- "keywords" should be a short phrase capturing anything else worth free-text matching against a listing's title or description, or null if the category already covers it.
- "location" should be a place name if one is mentioned (city, neighbourhood, landmark), else null.
- "urgent" is true only if the request explicitly signals urgency ("urgently", "right now", "emergency", "ASAP", "immediately").
- If nothing meaningful can be extracted, return all fields null and urgent false.`;

/**
 * US-006 ("Use natural-language AI search") / US-007 (AI-assisted
 * recommendations, insofar as the interpreted category/keywords feed
 * the same ranked search everyone else uses - see AC "AI results must
 * only include services supported by available data" and "AI must
 * not invent providers, prices, ratings or availability"). This
 * service ONLY extracts structured filters from free text; it never
 * returns or fabricates listings itself - the caller always runs the
 * interpreted filters through ListingService.search() against real
 * data (AC "availability and price must be verified through
 * authoritative application or provider data").
 *
 * Optional integration, same shape as GooglePlacesService: isConfigured()
 * is false until ANTHROPIC_API_KEY is set, and interpret() returns null
 * on any failure (network, non-2xx, unparseable output) so the caller
 * can fall back to a plain keyword search (AC "the system must provide
 * standard search when AI is unavailable").
 */
@Injectable()
export class AiSearchService {
  private readonly logger = new Logger(AiSearchService.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isConfigured(): boolean {
    return this.config.get('ai', { infer: true }).anthropicApiKey.length > 0;
  }

  async interpret(freeText: string): Promise<InterpretedSearch | null> {
    const { anthropicApiKey, model } = this.config.get('ai', { infer: true });
    if (!anthropicApiKey) {
      return null;
    }

    let response: Response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicApiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: freeText }],
        }),
      });
    } catch (err) {
      this.logger.warn(`AI search request failed: ${(err as Error).message}`);
      return null;
    }

    if (!response.ok) {
      this.logger.warn(`AI search responded ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      return null;
    }

    try {
      // Defensive extraction: the model is told to return bare JSON,
      // but strip any surrounding prose/code fence rather than trust
      // that strictly.
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        return null;
      }
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const listingType =
        typeof parsed.listingType === 'string' && LISTING_TYPES.includes(parsed.listingType)
          ? (parsed.listingType as InterpretedSearch['listingType'])
          : undefined;
      return {
        listingType,
        category: typeof parsed.category === 'string' && parsed.category.trim() ? parsed.category.trim() : undefined,
        keywords: typeof parsed.keywords === 'string' && parsed.keywords.trim() ? parsed.keywords.trim() : undefined,
        location: typeof parsed.location === 'string' && parsed.location.trim() ? parsed.location.trim() : undefined,
        urgent: parsed.urgent === true,
      };
    } catch (err) {
      this.logger.warn(`AI search returned unparseable output: ${(err as Error).message}`);
      return null;
    }
  }
}
