import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/**
 * @Global like AuditModule/NotificationsModule: any feature module
 * that needs to push a real-time nudge (direct messages now, call
 * signaling in a later phase) injects RealtimeGateway directly rather
 * than each re-declaring its own WebSocket server.
 */
@Global()
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
