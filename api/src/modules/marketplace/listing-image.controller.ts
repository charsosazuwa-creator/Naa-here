import { Controller, Delete, HttpCode, HttpStatus, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { ListingService } from './listing.service';
import { ListingImageService, UploadedListingImage } from './listing-image.service';

/**
 * Image upload/removal for a listing the caller owns. Split from
 * ListingController mainly because this one route needs
 * FileInterceptor's multipart body parsing, which the rest of the
 * module's plain-JSON routes don't. No `storage` option is passed to
 * FileInterceptor, so multer keeps the file in memory (its documented
 * default when neither `dest` nor `storage` is given) rather than
 * writing to a temp path first — ListingImageService writes the final
 * bytes straight from that buffer.
 */
@Controller('listings/:listingId/images')
@UseGuards(JwtAuthGuard)
export class ListingImageController {
  constructor(
    private readonly listings: ListingService,
    private readonly images: ListingImageService,
  ) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async add(
    @CurrentUserId() userId: string,
    @Param('listingId') listingId: string,
    @UploadedFile() file: UploadedListingImage | undefined,
  ) {
    const listing = await this.listings.mustOwn(userId, listingId);
    this.listings.assertImagesEditable(listing.status);
    return this.images.add(userId, listingId, file);
  }

  @Delete(':imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUserId() userId: string, @Param('listingId') listingId: string, @Param('imageId') imageId: string) {
    const listing = await this.listings.mustOwn(userId, listingId);
    this.listings.assertImagesEditable(listing.status);
    await this.images.remove(userId, listingId, imageId);
  }
}
