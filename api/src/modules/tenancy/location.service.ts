import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateLocationDto } from './dto/location.dto';

export interface Location {
  id: string;
  label: string;
  addressLine: string;
  city: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
}

@Injectable()
export class LocationService {
  constructor(private readonly db: DatabaseService) {}

  async create(tenantId: string, dto: CreateLocationDto): Promise<Location> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO location (tenant_id, label, address_line, city, country_code, latitude, longitude, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, label, address_line, city, country_code, latitude, longitude, is_primary`,
        [
          tenantId,
          dto.label,
          dto.addressLine,
          dto.city,
          dto.countryCode,
          dto.latitude ?? null,
          dto.longitude ?? null,
          dto.isPrimary ?? false,
        ],
      );
      return toLocation(rows[0]);
    });
  }

  async listForTenant(tenantId: string): Promise<Location[]> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, label, address_line, city, country_code, latitude, longitude, is_primary
         FROM location WHERE tenant_id = $1 ORDER BY is_primary DESC, created_at ASC`,
        [tenantId],
      );
      return rows.map(toLocation);
    });
  }

  async findOne(tenantId: string, locationId: string): Promise<Location> {
    return this.db.withTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT id, label, address_line, city, country_code, latitude, longitude, is_primary
         FROM location WHERE tenant_id = $1 AND id = $2`,
        [tenantId, locationId],
      );
      if (rows.length === 0) {
        throw new NotFoundException('Location not found.');
      }
      return toLocation(rows[0]);
    });
  }
}

function toLocation(row: Record<string, unknown>): Location {
  return {
    id: row.id as string,
    label: row.label as string,
    addressLine: row.address_line as string,
    city: row.city as string,
    countryCode: row.country_code as string,
    latitude: (row.latitude as number) ?? null,
    longitude: (row.longitude as number) ?? null,
    isPrimary: row.is_primary as boolean,
  };
}
