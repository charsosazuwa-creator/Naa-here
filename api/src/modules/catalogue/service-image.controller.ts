import { Controller, Delete, HttpCode, HttpStatus, NotFoundException, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantRoleGuard } from '../../common/guards/tenant-role.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { DatabaseService } from '../../database/database.service';
import { ServiceImageService, UploadedServiceImage } from './service-image.service';

/**
 * Photo upload/removal for a service the caller's tenant owns -- split
 * from CatalogueController the same way ListingImageController is
 * split from ListingController, since this one route needs
 * FileInterceptor's multipart body parsing. Gated on the same
 * 'service.manage' permission CatalogueController already requires to
 * create or edit a service.
 */
@Controller('tenants/:tenantId/services/:serviceId/images')
@UseGuards(JwtAuthGuard, TenantRoleGuard)
export class ServiceImageController {
  constructor(
    private readonly db: DatabaseService,
    private readonly images: ServiceImageService,
  ) {}

  private async assertServiceInTenant(tenantId: string, serviceId: string): Promise<void> {
    const [row] = await this.db.query<{ id: string }>(`SELECT id FROM service WHERE id = $1 AND tenant_id = $2`, [serviceId, tenantId]);
    if (!row) {
      throw new NotFoundException('Service not found.');
    }
  }

  @Post()
  @RequirePermission('service.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async add(
    @CurrentUserId() userId: string,
    @Param('tenantId') tenantId: string,
    @Param('serviceId') serviceId: string,
    @UploadedFile() file: UploadedServiceImage | undefined,
  ) {
    await this.assertServiceInTenant(tenantId, serviceId);
    return this.images.add(userId, serviceId, file);
  }

  @Delete(':imageId')
  @RequirePermission('service.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUserId() userId: string,
    @Param('tenantId') tenantId: string,
    @Param('serviceId') serviceId: string,
    @Param('imageId') imageId: string,
  ) {
    await this.assertServiceInTenant(tenantId, serviceId);
    await this.images.remove(userId, serviceId, imageId);
  }
}
