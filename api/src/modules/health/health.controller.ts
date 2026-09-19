import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  /** Process is up. Used by the load balancer / orchestrator liveness probe. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Process is up AND its dependencies (the database) are reachable. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok' | 'degraded'; database: 'ok' | 'unreachable' }> {
    try {
      await this.db.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      return { status: 'degraded', database: 'unreachable' };
    }
  }
}
