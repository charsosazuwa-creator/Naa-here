import { Controller, Get, Param, Query } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { DiscoverServicesQueryDto } from './dto/discover.dto';
import { AvailabilitySlotsQueryDto } from './dto/availability-slots.dto';

/**
 * Deliberately unauthenticated (no @UseGuards) — this is the public
 * catalogue a customer browses before signing in, matching the design
 * package's "Search and location" phase and the comment left in
 * catalogue.controller.ts about why this was not built into that
 * tenant-scoped module. Booking itself still requires sign-in and is
 * handled by BookingController.
 */
@Controller('discover')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get('services')
  listServices(@Query() query: DiscoverServicesQueryDto) {
    return this.discovery.listServices(query);
  }

  @Get('services/:id')
  getService(@Param('id') id: string) {
    return this.discovery.getServiceDetail(id);
  }

  @Get('services/:id/availability-slots')
  getAvailableSlots(@Param('id') id: string, @Query() query: AvailabilitySlotsQueryDto) {
    return this.discovery.getAvailableSlots(id, query.days ?? 7);
  }
}
