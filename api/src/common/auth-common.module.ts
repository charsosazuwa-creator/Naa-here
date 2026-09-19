import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TenantRoleGuard } from './guards/tenant-role.guard';
import { PlatformPermissionGuard } from './guards/platform-permission.guard';
import { AppConfig } from '../config/configuration';

/**
 * JwtModule plus the guards every module needs (JwtAuthGuard:
 * signed-in; TenantRoleGuard: tenant membership + role permission —
 * steps 1 to 3 of design section 10's authorization check;
 * PlatformPermissionGuard: the platform-wide equivalent for
 * administrators/finance administrators/support agents, phase 5's
 * fuller admin/permission model). Global so every feature module can
 * @UseGuards(...) with neither its own JwtModule registration nor a
 * repeated provider list.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('jwt', { infer: true }).secret,
      }),
    }),
  ],
  providers: [JwtAuthGuard, TenantRoleGuard, PlatformPermissionGuard],
  exports: [JwtModule, JwtAuthGuard, TenantRoleGuard, PlatformPermissionGuard],
})
export class AuthCommonModule {}
