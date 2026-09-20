import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationAdminController } from './verification-admin.controller';
import { VerificationService } from './verification.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [VerificationController, VerificationAdminController],
  providers: [VerificationService],
})
export class VerificationModule {}
