import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { GroupPostService, UploadedGroupFile } from './group-post.service';
import { CreateCommentDto, CreatePostDto, UpdatePostDto } from './dto/group-post.dto';

/** Posts, comments, reactions, shares and attachments within a group. Same guard shape as GroupController: JwtAuthGuard only, membership/role checks in the service. */
@Controller('groups/:groupId/posts')
@UseGuards(JwtAuthGuard)
export class GroupPostController {
  constructor(private readonly posts: GroupPostService) {}

  @Post()
  create(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Body() dto: CreatePostDto) {
    return this.posts.createPost(groupId, userId, dto);
  }

  @Get()
  list(@CurrentUserId() userId: string, @Param('groupId') groupId: string) {
    return this.posts.listPosts(groupId, userId);
  }

  @Patch(':postId')
  update(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Param('postId') postId: string, @Body() dto: UpdatePostDto) {
    return this.posts.updatePost(groupId, postId, userId, dto);
  }

  @Delete(':postId')
  remove(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Param('postId') postId: string) {
    return this.posts.deletePost(groupId, postId, userId);
  }

  @Post(':postId/react')
  react(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Param('postId') postId: string) {
    return this.posts.react(groupId, postId, userId);
  }

  @Delete(':postId/react')
  unreact(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Param('postId') postId: string) {
    return this.posts.unreact(groupId, postId, userId);
  }

  @Post(':postId/share')
  share(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Param('postId') postId: string) {
    return this.posts.share(groupId, postId, userId);
  }

  @Post(':postId/comments')
  addComment(
    @CurrentUserId() userId: string,
    @Param('groupId') groupId: string,
    @Param('postId') postId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.posts.addComment(groupId, postId, userId, dto);
  }

  @Get(':postId/comments')
  listComments(@CurrentUserId() userId: string, @Param('groupId') groupId: string, @Param('postId') postId: string) {
    return this.posts.listComments(groupId, postId, userId);
  }

  @Delete(':postId/comments/:commentId')
  deleteComment(
    @CurrentUserId() userId: string,
    @Param('groupId') groupId: string,
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
  ) {
    return this.posts.deleteComment(groupId, postId, commentId, userId);
  }

  @Post(':postId/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async addAttachment(
    @CurrentUserId() userId: string,
    @Param('groupId') groupId: string,
    @Param('postId') postId: string,
    @UploadedFile() file: UploadedGroupFile | undefined,
  ) {
    await this.posts.addAttachment(groupId, postId, userId, file);
    return { added: true };
  }

  @Delete(':postId/attachments/:attachmentId')
  async removeAttachment(
    @CurrentUserId() userId: string,
    @Param('groupId') groupId: string,
    @Param('postId') postId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    await this.posts.removeAttachment(groupId, postId, attachmentId, userId);
  }
}
