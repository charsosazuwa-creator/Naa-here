import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendGroupMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class ListGroupMessagesQueryDto {
  // Poll for messages strictly after this one, instead of the initial
  // "last N" page -- keeps a chat window's repeated polling cheap and
  // avoids re-rendering messages the client already has.
  @IsOptional()
  @IsUUID()
  after?: string;
}
