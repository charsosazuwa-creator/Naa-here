import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { MediaService } from './media.service';
import { UploadMetadataDto } from './dto/upload-metadata.dto';

/**
 * A single upload-metadata endpoint for this milestone: enough to back
 * verification-document submission and, later, service photos. A
 * browsable per-tenant media library is provider-portal UI work, out
 * of scope for this API-only milestone.
 */
@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  upload(@CurrentUserId() userId: string, @Body() dto: UploadMetadataDto) {
    return this.media.recordUpload(userId, dto);
  }
}
