import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const VISIBILITY = ['public', 'private', 'hidden'] as const;
const MEMBERSHIP_TYPE = ['open', 'request', 'invite_only'] as const;

export class CreateGroupDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  industryCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationText?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsIn(VISIBILITY)
  visibility?: (typeof VISIBILITY)[number];

  @IsOptional()
  @IsIn(MEMBERSHIP_TYPE)
  membershipType?: (typeof MEMBERSHIP_TYPE)[number];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rules?: string;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  industryCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationText?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsIn(VISIBILITY)
  visibility?: (typeof VISIBILITY)[number];

  @IsOptional()
  @IsIn(MEMBERSHIP_TYPE)
  membershipType?: (typeof MEMBERSHIP_TYPE)[number];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  rules?: string;
}

export class DiscoverGroupsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  location?: string;
}

export class InviteMemberDto {
  @IsString()
  email!: string;
}

export class ChangeRoleDto {
  @IsIn(['administrator', 'moderator', 'member'])
  role!: 'administrator' | 'moderator' | 'member';
}

const MODERATION_ACTIONS = ['warn', 'suspend', 'mute', 'remove'] as const;

export class ModerateMemberDto {
  @IsIn(MODERATION_ACTIONS)
  action!: (typeof MODERATION_ACTIONS)[number];

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}

export class TransferOwnershipDto {
  @IsUUID()
  newOwnerUserId!: string;
}
