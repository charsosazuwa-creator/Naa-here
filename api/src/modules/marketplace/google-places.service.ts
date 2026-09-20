import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';

export interface GooglePlaceResult {
  source: 'google';
  placeId: string;
  name: string;
  category: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  openNow: boolean | null;
  rating: number | null;
}

interface PlacesApiPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  currentOpeningHours?: { openNow?: boolean };
  rating?: number;
  primaryTypeDisplayName?: { text?: string };
}

/**
 * US-005: "Search for businesses using Google". Calls the Places API
 * (New) Text Search endpoint with a server-side-only key (AC "Google
 * API credentials must remain server-side or be restricted
 * appropriately") to supplement platform listings with nearby
 * Google-sourced businesses. A Google result is never written into
 * the `listing` table or treated as a verified platform provider (AC
 * "A Google result must not automatically become a verified platform
 * provider") — it's returned to the frontend as its own, clearly
 * labeled result set (see listing-ui.js's "source: google" badge).
 *
 * Optional integration: isConfigured() is false until
 * GOOGLE_PLACES_API_KEY is set (see configuration.ts/render.yaml), and
 * search() itself degrades to an empty result list on any network
 * failure, non-2xx response or quota error rather than throwing — the
 * rest of the search page keeps working with platform listings alone
 * (AC "if the Google service is unavailable... display a clear
 * fallback message", which the controller/frontend supply from the
 * `available` flag this service's caller checks via isConfigured()).
 */
@Injectable()
export class GooglePlacesService {
  private readonly logger = new Logger(GooglePlacesService.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  isConfigured(): boolean {
    return this.config.get('googlePlaces', { infer: true }).apiKey.length > 0;
  }

  async search(params: { query?: string; lat?: number; lng?: number; radiusKm?: number }): Promise<GooglePlaceResult[]> {
    const apiKey = this.config.get('googlePlaces', { infer: true }).apiKey;
    if (!apiKey) {
      return [];
    }

    const body: Record<string, unknown> = {
      textQuery: params.query && params.query.trim().length > 0 ? params.query : 'local services',
    };
    if (params.lat !== undefined && params.lng !== undefined) {
      body.locationBias = {
        circle: {
          center: { latitude: params.lat, longitude: params.lng },
          // Places API caps circle radius at 50km; floor at 1km so a
          // tiny/zero radiusKm doesn't produce a degenerate bias.
          radius: Math.min(50000, Math.max(1000, (params.radiusKm ?? 20) * 1000)),
        },
      };
    }

    let response: Response;
    try {
      response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.location,places.currentOpeningHours.openNow,places.rating,places.primaryTypeDisplayName',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.warn(`Google Places request failed: ${(err as Error).message}`);
      return [];
    }

    if (!response.ok) {
      this.logger.warn(`Google Places responded ${response.status}`);
      return [];
    }

    const data = (await response.json()) as { places?: PlacesApiPlace[] };
    return (data.places ?? []).slice(0, 20).map((place) => ({
      source: 'google' as const,
      placeId: place.id,
      name: place.displayName?.text ?? 'Unnamed business',
      category: place.primaryTypeDisplayName?.text ?? null,
      address: place.formattedAddress ?? null,
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      openNow: place.currentOpeningHours?.openNow ?? null,
      rating: place.rating ?? null,
    }));
  }
}
