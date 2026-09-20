import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditService } from '../audit/audit.service';
import { CreateListingDto, DecideListingDto, DiscoverListingsQueryDto, UpdateListingDto } from './dto/listing.dto';

// Default search radius (km) when the customer's position is known but
// they haven't picked a specific radius (US-004/US-009).
const DEFAULT_RADIUS_KM = 50;

type ListingRow = {
  id: string;
  owner_user_id: string;
  listing_type: string;
  title: string;
  category: string;
  description: string | null;
  price_minor_units: number | null;
  currency_code: string | null;
  price_type: string;
  country_code: string | null;
  location_text: string | null;
  contact_method: string;
  contact_value: string;
  status: string;
  rejection_reason: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
};

type ImageRow = {
  id: string;
  listing_id: string;
  storage_key: string;
  content_type: string;
  byte_size: number;
  position: number;
};

export interface ListingDetail {
  id: string;
  ownerUserId: string;
  listingType: string;
  title: string;
  category: string;
  description: string | null;
  priceMinorUnits: number | null;
  currencyCode: string | null;
  priceType: string;
  countryCode: string | null;
  locationText: string | null;
  contactMethod: string;
  contactValue: string;
  status: string;
  rejectionReason: string | null;
  latitude: number | null;
  longitude: number | null;
  // Only populated when a search was run with the customer's lat/lng
  // (see search() below) — absent from ordinary owner/admin reads.
  distanceKm?: number;
  createdAt: string;
  updatedAt: string;
  images: { id: string; url: string; position: number }[];
}

const EDITABLE_STATUSES = ['draft', 'pending_review', 'published', 'paused', 'rejected'];

/**
 * Owner-side lifecycle for a marketplace listing: draft → submit →
 * pending_review → (admin decides) → published/rejected, plus
 * pause/resume and archive. Ownership is checked here rather than by
 * RLS/a guard — `listing` isn't tenant-scoped (see migration 012's
 * comment), so there's no `app.tenant_id` for a policy to key off;
 * this mirrors how AuthService/BusinessService already guard
 * platform-level, non-tenant-scoped tables by comparing the row's
 * owner column to the signed-in user in plain application code.
 */
@Injectable()
export class ListingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private assertPricing(priceType: string, priceMinorUnits?: number, currencyCode?: string): void {
    const needsPrice = priceType === 'fixed' || priceType === 'starting_from';
    if (needsPrice && (priceMinorUnits === undefined || !currencyCode)) {
      throw new UnprocessableEntityException('A price and currency are required for this price type.');
    }
  }

  async create(ownerUserId: string, dto: CreateListingDto): Promise<ListingDetail> {
    this.assertPricing(dto.priceType, dto.priceMinorUnits, dto.currencyCode);

    const [row] = await this.db.query<ListingRow>(
      `INSERT INTO listing
         (owner_user_id, listing_type, title, category, description, price_minor_units, currency_code,
          price_type, country_code, location_text, latitude, longitude, contact_method, contact_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        ownerUserId,
        dto.listingType,
        dto.title,
        dto.category,
        dto.description ?? null,
        dto.priceMinorUnits ?? null,
        dto.currencyCode ?? null,
        dto.priceType,
        dto.countryCode ?? null,
        dto.locationText ?? null,
        dto.latitude ?? null,
        dto.longitude ?? null,
        dto.contactMethod,
        dto.contactValue,
      ],
    );

    await this.audit.record({ actorUserId: ownerUserId, action: 'listing.create', targetType: 'listing', targetId: row.id });
    return this.toDetail(row, []);
  }

  async update(ownerUserId: string, listingId: string, dto: UpdateListingDto): Promise<ListingDetail> {
    const existing = await this.mustOwn(ownerUserId, listingId);
    if (existing.status === 'archived') {
      throw new UnprocessableEntityException('An archived listing can no longer be edited.');
    }

    const priceType = dto.priceType ?? existing.price_type;
    const priceMinorUnits = dto.priceMinorUnits ?? existing.price_minor_units ?? undefined;
    const currencyCode = dto.currencyCode ?? existing.currency_code ?? undefined;
    this.assertPricing(priceType, priceMinorUnits, currencyCode);

    // Editing a listing that was already published/paused/rejected
    // changes what's being advertised, so it goes back through
    // moderation (AC20's "re-initiate moderation where required"); a
    // still-unsubmitted draft just stays a draft.
    const nextStatus = existing.status === 'draft' ? 'draft' : 'pending_review';

    const [row] = await this.db.query<ListingRow>(
      `UPDATE listing SET
         listing_type = $2, title = $3, category = $4, description = $5,
         price_minor_units = $6, currency_code = $7, price_type = $8,
         country_code = $9, location_text = $10, latitude = $11, longitude = $12,
         contact_method = $13, contact_value = $14,
         status = $15, rejection_reason = NULL, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        listingId,
        dto.listingType ?? existing.listing_type,
        dto.title ?? existing.title,
        dto.category ?? existing.category,
        dto.description ?? existing.description,
        priceMinorUnits ?? null,
        currencyCode ?? null,
        priceType,
        dto.countryCode ?? existing.country_code,
        dto.locationText ?? existing.location_text,
        dto.latitude ?? existing.latitude,
        dto.longitude ?? existing.longitude,
        dto.contactMethod ?? existing.contact_method,
        dto.contactValue ?? existing.contact_value,
        nextStatus,
      ],
    );

    await this.audit.record({ actorUserId: ownerUserId, action: 'listing.update', targetType: 'listing', targetId: listingId });
    return this.toDetail(row, await this.imagesFor(listingId));
  }

  async submit(ownerUserId: string, listingId: string): Promise<ListingDetail> {
    const existing = await this.mustOwn(ownerUserId, listingId);
    if (existing.status !== 'draft' && existing.status !== 'rejected') {
      throw new UnprocessableEntityException('Only a draft or previously rejected listing can be submitted for review.');
    }
    this.assertPricing(existing.price_type, existing.price_minor_units ?? undefined, existing.currency_code ?? undefined);

    const [row] = await this.db.query<ListingRow>(
      `UPDATE listing SET status = 'pending_review', rejection_reason = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [listingId],
    );
    await this.audit.record({ actorUserId: ownerUserId, action: 'listing.submit', targetType: 'listing', targetId: listingId });
    return this.toDetail(row, await this.imagesFor(listingId));
  }

  async pause(ownerUserId: string, listingId: string): Promise<ListingDetail> {
    const existing = await this.mustOwn(ownerUserId, listingId);
    if (existing.status !== 'published') {
      throw new UnprocessableEntityException('Only a published listing can be paused.');
    }
    const [row] = await this.db.query<ListingRow>(
      `UPDATE listing SET status = 'paused', updated_at = now() WHERE id = $1 RETURNING *`,
      [listingId],
    );
    await this.audit.record({ actorUserId: ownerUserId, action: 'listing.pause', targetType: 'listing', targetId: listingId });
    return this.toDetail(row, await this.imagesFor(listingId));
  }

  async resume(ownerUserId: string, listingId: string): Promise<ListingDetail> {
    const existing = await this.mustOwn(ownerUserId, listingId);
    if (existing.status !== 'paused') {
      throw new UnprocessableEntityException('Only a paused listing can be resumed.');
    }
    // No re-review needed: nothing about the listing changed since it
    // was last approved, only its visibility.
    const [row] = await this.db.query<ListingRow>(
      `UPDATE listing SET status = 'published', updated_at = now() WHERE id = $1 RETURNING *`,
      [listingId],
    );
    await this.audit.record({ actorUserId: ownerUserId, action: 'listing.resume', targetType: 'listing', targetId: listingId });
    return this.toDetail(row, await this.imagesFor(listingId));
  }

  async archive(ownerUserId: string, listingId: string): Promise<ListingDetail> {
    const existing = await this.mustOwn(ownerUserId, listingId);
    if (existing.status === 'archived') {
      throw new UnprocessableEntityException('This listing is already archived.');
    }
    const [row] = await this.db.query<ListingRow>(
      `UPDATE listing SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING *`,
      [listingId],
    );
    await this.audit.record({ actorUserId: ownerUserId, action: 'listing.archive', targetType: 'listing', targetId: listingId });
    return this.toDetail(row, await this.imagesFor(listingId));
  }

  async listMine(ownerUserId: string): Promise<ListingDetail[]> {
    const rows = await this.db.query<ListingRow>(
      `SELECT * FROM listing WHERE owner_user_id = $1 ORDER BY updated_at DESC`,
      [ownerUserId],
    );
    if (rows.length === 0) {
      return [];
    }
    const images = await this.db.query<ImageRow>(
      `SELECT * FROM listing_image WHERE listing_id = ANY($1::uuid[]) ORDER BY position ASC`,
      [rows.map((r) => r.id)],
    );
    return rows.map((row) => this.toDetail(row, images.filter((img) => img.listing_id === row.id)));
  }

  async getOwned(ownerUserId: string, listingId: string): Promise<ListingDetail> {
    const row = await this.mustOwn(ownerUserId, listingId);
    return this.toDetail(row, await this.imagesFor(listingId));
  }

  /** EDITABLE_STATUSES gate: whether images can still be added/removed from this listing. */
  assertImagesEditable(status: string): void {
    if (!EDITABLE_STATUSES.includes(status)) {
      throw new UnprocessableEntityException('Images cannot be changed on an archived listing.');
    }
  }

  async mustOwn(ownerUserId: string, listingId: string): Promise<ListingRow> {
    const [row] = await this.db.query<ListingRow>(`SELECT * FROM listing WHERE id = $1`, [listingId]);
    if (!row) {
      throw new NotFoundException('Listing not found.');
    }
    if (row.owner_user_id !== ownerUserId) {
      throw new ForbiddenException("You don't own this listing.");
    }
    return row;
  }

  // -- Public discovery (published only) --------------------------------

  /**
   * US-004 (nearby), US-008 (filter/sort), US-009 (map): a listing's
   * distance from the customer is computed with a plain haversine
   * formula (great-circle distance in km) rather than PostGIS/
   * earth_distance, since that needs a Postgres extension this
   * project doesn't otherwise require — see migration 013's comment.
   * lat/lng only take effect together; a listing with no
   * latitude/longitude of its own always computes a NULL distance, so
   * it's naturally excluded by a radius filter but still shows up
   * (with no distance) in an un-radius-limited, non-distance-sorted
   * search.
   */
  async search(query: DiscoverListingsQueryDto): Promise<ListingDetail[]> {
    const conditions: string[] = [`status = 'published'`];
    const params: unknown[] = [];

    if (query.listingType) {
      params.push(query.listingType);
      conditions.push(`listing_type = $${params.length}`);
    }
    if (query.category) {
      params.push(`%${query.category}%`);
      conditions.push(`category ILIKE $${params.length}`);
    }
    if (query.countryCode) {
      params.push(query.countryCode);
      conditions.push(`country_code = $${params.length}`);
    }
    if (query.location) {
      params.push(`%${query.location}%`);
      conditions.push(`location_text ILIKE $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search}%`);
      conditions.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length} OR category ILIKE $${params.length})`);
    }
    if (query.minPrice !== undefined) {
      params.push(query.minPrice);
      conditions.push(`(price_minor_units IS NOT NULL AND price_minor_units >= $${params.length})`);
    }
    if (query.maxPrice !== undefined) {
      params.push(query.maxPrice);
      conditions.push(`(price_minor_units IS NOT NULL AND price_minor_units <= $${params.length})`);
    }

    let distanceSelect = 'NULL::DOUBLE PRECISION AS distance_km';
    const hasPosition = query.lat !== undefined && query.lng !== undefined;
    let latIdx = 0;
    let lngIdx = 0;
    if (hasPosition) {
      params.push(query.lat);
      latIdx = params.length;
      params.push(query.lng);
      lngIdx = params.length;
      distanceSelect = `CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN
          6371 * acos(LEAST(1, GREATEST(-1,
            cos(radians($${latIdx})) * cos(radians(latitude)) * cos(radians(longitude) - radians($${lngIdx})) +
            sin(radians($${latIdx})) * sin(radians(latitude))
          )))
        ELSE NULL END AS distance_km`;
    }

    let radiusFilter = '';
    if (hasPosition) {
      params.push(query.radiusKm ?? DEFAULT_RADIUS_KM);
      radiusFilter = ` AND (sub.distance_km IS NULL OR sub.distance_km <= $${params.length})`;
    }

    let orderBy = 'sub.updated_at DESC';
    if (query.sort === 'distance' && hasPosition) {
      orderBy = 'sub.distance_km ASC NULLS LAST, sub.updated_at DESC';
    } else if (query.sort === 'price_asc') {
      orderBy = 'sub.price_minor_units ASC NULLS LAST, sub.updated_at DESC';
    } else if (query.sort === 'price_desc') {
      orderBy = 'sub.price_minor_units DESC NULLS LAST, sub.updated_at DESC';
    } else if (query.sort === 'newest') {
      orderBy = 'sub.updated_at DESC';
    }

    const rows = await this.db.query<ListingRow & { distance_km: number | null }>(
      `SELECT * FROM (
         SELECT *, ${distanceSelect}
         FROM listing
         WHERE ${conditions.join(' AND ')}
       ) sub
       WHERE true${radiusFilter}
       ORDER BY ${orderBy}
       LIMIT 100`,
      params,
    );
    if (rows.length === 0) {
      return [];
    }
    const images = await this.db.query<ImageRow>(
      `SELECT * FROM listing_image WHERE listing_id = ANY($1::uuid[]) ORDER BY position ASC`,
      [rows.map((r) => r.id)],
    );
    return rows.map((row) =>
      this.toDetail(row, images.filter((img) => img.listing_id === row.id), row.distance_km ?? undefined),
    );
  }

  async getPublished(listingId: string): Promise<ListingDetail> {
    const [row] = await this.db.query<ListingRow>(`SELECT * FROM listing WHERE id = $1 AND status = 'published'`, [listingId]);
    if (!row) {
      throw new NotFoundException('Listing not found.');
    }
    return this.toDetail(row, await this.imagesFor(listingId));
  }

  // -- Admin moderation ---------------------------------------------------

  async listPendingReview(): Promise<(ListingDetail & { ownerName: string })[]> {
    const rows = await this.db.query<ListingRow & { owner_name: string }>(
      `SELECT l.*, u.full_name AS owner_name
       FROM listing l
       JOIN app_user u ON u.id = l.owner_user_id
       WHERE l.status = 'pending_review'
       ORDER BY l.updated_at ASC`,
    );
    if (rows.length === 0) {
      return [];
    }
    const images = await this.db.query<ImageRow>(
      `SELECT * FROM listing_image WHERE listing_id = ANY($1::uuid[]) ORDER BY position ASC`,
      [rows.map((r) => r.id)],
    );
    return rows.map((row) => ({
      ...this.toDetail(row, images.filter((img) => img.listing_id === row.id)),
      ownerName: row.owner_name,
    }));
  }

  async decide(adminUserId: string, listingId: string, dto: DecideListingDto): Promise<ListingDetail> {
    const [existing] = await this.db.query<ListingRow>(`SELECT * FROM listing WHERE id = $1`, [listingId]);
    if (!existing) {
      throw new NotFoundException('Listing not found.');
    }
    if (existing.status !== 'pending_review') {
      throw new UnprocessableEntityException('Only a listing pending review can be decided.');
    }

    const nextStatus = dto.decision === 'approved' ? 'published' : 'rejected';
    const [row] = await this.db.query<ListingRow>(
      `UPDATE listing SET status = $2, rejection_reason = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [listingId, nextStatus, dto.decision === 'rejected' ? (dto.reason ?? null) : null],
    );

    await this.db.query(
      `INSERT INTO listing_moderation_decision (listing_id, decision, reason, actor_user_id) VALUES ($1, $2, $3, $4)`,
      [listingId, dto.decision, dto.reason ?? null, adminUserId],
    );
    await this.audit.record({
      actorUserId: adminUserId,
      action: `listing.${dto.decision}`,
      targetType: 'listing',
      targetId: listingId,
    });

    return this.toDetail(row, await this.imagesFor(listingId));
  }

  // -- Shared helpers -------------------------------------------------------

  private async imagesFor(listingId: string): Promise<ImageRow[]> {
    return this.db.query<ImageRow>(`SELECT * FROM listing_image WHERE listing_id = $1 ORDER BY position ASC`, [listingId]);
  }

  private toDetail(row: ListingRow, images: ImageRow[], distanceKm?: number): ListingDetail {
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      listingType: row.listing_type,
      title: row.title,
      category: row.category,
      description: row.description,
      priceMinorUnits: row.price_minor_units,
      currencyCode: row.currency_code,
      priceType: row.price_type,
      countryCode: row.country_code,
      locationText: row.location_text,
      latitude: row.latitude,
      longitude: row.longitude,
      distanceKm: distanceKm !== undefined ? Math.round(distanceKm * 10) / 10 : undefined,
      contactMethod: row.contact_method,
      contactValue: row.contact_value,
      status: row.status,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      images: images.map((img) => ({ id: img.id, url: `/uploads/${img.storage_key}`, position: img.position })),
    };
  }
}
