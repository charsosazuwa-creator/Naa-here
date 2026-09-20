import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { DecideListingDto } from './dto/listing.dto';
import { ListingService } from './listing.service';

/**
 * The moderation queue for marketplace listings (AC14/AC24): every
 * listing an owner submits sits as 'pending_review' until a platform
 * admin approves or rejects it here. Reuses the 'listing.moderate'
 * permission migration 005 already granted to the administrator role
 * — that table (listing_moderation_action) turned out to be hardcoded
 * to the tenant `service` catalogue, so this feature has its own
 * listing_moderation_decision table (migration 012), but the
 * permission itself is exactly the one "moderating listings" already
 * means in this codebase's role model.
 *
 * Same two-controller split as verification: a platform-wide
 * GET .../pending queue here, deciding through this module's own
 * POST .../:id/decide (no tenant context needed, unlike
 * verification's tenant-scoped decide route, since a listing isn't
 * tenant-owned).
 */
@Controller('admin/listings')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
export class ListingAdminController {
  constructor(private readonly listings: ListingService) {}

  @Get('pending')
  @RequirePermission('listing.moderate')
  listPending() {
    return this.listings.listPendingReview();
  }

  @Post(':listingId/decide')
  @RequirePermission('listing.moderate')
  decide(@CurrentUserId() adminUserId: string, @Param('listingId') listingId: string, @Body() dto: DecideListingDto) {
    return this.listings.decide(adminUserId, listingId, dto);
  }
}
