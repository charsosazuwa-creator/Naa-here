import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { MediaService } from './media.service';
import { UploadMetadataDto } from './dto/upload-metadata.dto';
import { PresignUploadDto } from './dto/presign-upload.dto';

/**
 * Upload flow: POST /media/presign-upload gets a short-lived direct-
 * to-bucket URL, the client PUTs the real file bytes to that URL
 * itself (this server never sees them), then POST /media records the
 * resulting metadata -- enough to back verification-document
 * submission and, later, service photos. A browsable per-tenant media
 * library is provider-portal UI work, out of scope for this milestone.
 *
 * GET /media/:id/download-url is this same tenant-membership-checked
 * path for viewing a file back. The platform-reviewer path (any
 * tenant's verification documents) goes through
 * VerificationService.getDocumentUrl() instead, which resolves the
 * right tenantId itself rather than trusting a caller-supplied one.
 */
@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('presign-upload')
  presignUpload(@CurrentUserId() userId: string, @Body() dto: PresignUploadDto) {
    return this.media.presignUpload(userId, dto);
  }

  @Post()
  upload(@CurrentUserId() userId: string, @Body() dto: UploadMetadataDto) {
    return this.media.recordUpload(userId, dto);
  }

  @Get(':id/download-url')
  getDownloadUrl(@Param('id') id: string, @CurrentUserId() userId: string, @Query('tenantId') tenantId?: string) {
    return this.media.getDownloadUrlForMember(userId, tenantId ?? null, id);
  }
}
