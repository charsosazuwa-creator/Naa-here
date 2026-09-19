import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';

class UpdateMeDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsIn(['en', 'sw'])
  preferredLanguage?: string;
}

/** GET/PATCH /v1/me — mounted at root (not under /auth) to match the design's route list exactly. */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me(@CurrentUserId() userId: string) {
    return this.auth.me(userId);
  }

  @Patch()
  updateMe(@CurrentUserId() userId: string, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(userId, dto);
  }
}
