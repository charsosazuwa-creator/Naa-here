import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformPermissionGuard } from '../../common/guards/platform-permission.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { DecideListingDto, UpdateListingDto } from './dto/listing.dto';
import { ListingService } from './listing.service';
import { ListingImageService } from './listing-image.service';
import { ModerationAssistService } from '../moderation-assist/moderation-assist.service';

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
 *
 * The PATCH and image-DELETE routes below let an admin fix a listing
 * up (typo in the title, wrong category, a photo that shouldn't be
 * there) before deciding it — see ListingService.adminUpdate()'s own
 * comment for why this is narrower than the owner's own PATCH/DELETE
 * routes on ListingController/ListingImageController.
 *
 * listPending() also attaches the reporting Agent's advisory review
 * to each listing (ModerationAssistService — see its own comment):
 * read-only, a recommendation plus reasons for a human to read before
 * deciding. The Agent never calls decide() itself.
 */
@Controller('admin/listings')
@UseGuards(JwtAuthGuard, PlatformPermissionGuard)
export class ListingAdminController {
  constructor(
    private readonly listings: ListingService,
    private readonly images: ListingImageService,
    private readonly moderationAssist: ModerationAssistService,
  ) {}

  @Get('pending')
  @RequirePermission('listing.moderate')
  async listPending() {
    const listings = await this.listings.listPendingReview();
    return listings.map((listing) => ({
      ...listing,
      agentReview: this.moderationAssist.reviewListing(listing),
    }));
  }

  @Patch(':listingId')
  @RequirePermission('listing.moderate')
  update(@CurrentUserId() adminUserId: string, @Param('listingId') listingId: string, @Body() dto: UpdateListingDto) {
    return this.listings.adminUpdate(adminUserId, listingId, dto);
  }

  @Delete(':listingId/images/:imageId')
  @RequirePermission('listing.moderate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeImage(
    @CurrentUserId() adminUserId: string,
    @Param('listingId') listingId: string,
    @Param('imageId') imageId: string,
  ) {
    await this.listings.assertAdminEditable(listingId);
    await this.images.remove(adminUserId, listingId, imageId);
  }

  @Post(':listingId/decide')
  @RequirePermission('listing.moderate')
  decide(@CurrentUserId() adminUserId: string, @Param('listingId') listingId: string, @Body() dto: DecideListingDto) {
    return this.listings.decide(adminUserId, listingId, dto);
  }
}
