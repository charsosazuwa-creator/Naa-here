import { Controller, Delete, HttpCode, HttpStatus, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { MessageAttachmentService, UploadedMessageFile } from './message-attachment.service';

/**
 * Multipart upload/removal for a file attached to an already-sent
 * direct message -- split from DirectMessageController the same way
 * ListingImageController is split from ListingController, since this
 * one route needs FileInterceptor's multipart body parsing that the
 * rest of that module's plain-JSON routes don't.
 */
@Controller('conversations/:conversationId/messages/:messageId/attachments')
@UseGuards(JwtAuthGuard)
export class MessageAttachmentController {
  constructor(private readonly attachments: MessageAttachmentService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  add(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @UploadedFile() file: UploadedMessageFile | undefined,
  ) {
    return this.attachments.add(conversationId, messageId, userId, file);
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUserId() userId: string,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    await this.attachments.remove(conversationId, messageId, attachmentId, userId);
  }
}
