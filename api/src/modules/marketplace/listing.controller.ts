import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { CreateListingDto, UpdateListingDto } from './dto/listing.dto';
import { ListingService } from './listing.service';

/**
 * Owner-side management of a marketplace listing (User Story 2):
 * create, edit, submit for review, pause/resume, archive, and list
 * "my listings". Every route is behind JwtAuthGuard only — no tenant
 * or platform-role guard, since any signed-in user (Customer or
 * Service Provider alike) can own a listing (see migration 012).
 * Public browsing of PUBLISHED listings lives in
 * marketplace-discovery.controller.ts instead, unauthenticated, the
 * same split DiscoveryModule already uses for the tenant `service`
 * catalogue.
 */
@Controller('listings')
@UseGuards(JwtAuthGuard)
export class ListingController {
  constructor(private readonly listings: ListingService) {}

  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: CreateListingDto) {
    return this.listings.create(userId, dto);
  }

  // Before ':listingId' so Nest/Express match this literal segment
  // first (same reasoning as TenancyController's 'mine' route).
  @Get('mine')
  listMine(@CurrentUserId() userId: string) {
    return this.listings.listMine(userId);
  }

  @Get(':listingId')
  getOne(@CurrentUserId() userId: string, @Param('listingId') listingId: string) {
    return this.listings.getOwned(userId, listingId);
  }

  @Patch(':listingId')
  update(@CurrentUserId() userId: string, @Param('listingId') listingId: string, @Body() dto: UpdateListingDto) {
    return this.listings.update(userId, listingId, dto);
  }

  @Post(':listingId/submit')
  submit(@CurrentUserId() userId: string, @Param('listingId') listingId: string) {
    return this.listings.submit(userId, listingId);
  }

  @Post(':listingId/pause')
  pause(@CurrentUserId() userId: string, @Param('listingId') listingId: string) {
    return this.listings.pause(userId, listingId);
  }

  @Post(':listingId/resume')
  resume(@CurrentUserId() userId: string, @Param('listingId') listingId: string) {
    return this.listings.resume(userId, listingId);
  }

  // Archive, not a hard DELETE, per AC22's "delete or archive
  // according to the approved retention rules" — matches this
  // codebase's existing pattern of never hard-deleting business data.
  @Delete(':listingId')
  archive(@CurrentUserId() userId: string, @Param('listingId') listingId: string) {
    return this.listings.archive(userId, listingId);
  }
}
