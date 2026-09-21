import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { HttpAdapterHost } from '@nestjs/core';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { AppConfig } from '../../config/configuration';

interface AuthedSocket extends WebSocket {
  userId?: string;
  isAlive?: boolean;
}

/**
 * The one piece of real-time infrastructure this app has: everything
 * else (group chat, migration 017) gets by on client-side polling,
 * which is fine for a chat panel but not for something that's
 * supposed to feel like a phone ringing (User Story 1-3) or for a
 * direct message that should land instantly rather than up to a few
 * seconds late. A raw `ws` server rather than @nestjs/websockets +
 * socket.io, to match this codebase's existing preference for a thin
 * hand-rolled layer over a heavier framework (see: no ORM, hand-rolled
 * OAuth instead of Passport).
 *
 * This is a push channel ONLY -- it never carries data that isn't
 * also durably persisted via the normal REST endpoints first (a
 * direct message row, a call-signaling event). If a socket is closed
 * or the browser tab was never open, the recipient still sees
 * everything next time they load the page; nothing is lost, only
 * delayed to "the next fetch" instead of "instant".
 *
 * Auth: the browser's native WebSocket API can't set an Authorization
 * header, so the access token travels as a query parameter
 * (`/ws?token=...`) instead -- verified the same way JwtAuthGuard
 * verifies it for ordinary HTTP requests, just read from the
 * connection URL instead of a header.
 */
@Injectable()
export class RealtimeGateway implements OnModuleInit {
  private readonly logger = new Logger(RealtimeGateway.name);
  private wss?: WebSocketServer;
  private readonly socketsByUser = new Map<string, Set<AuthedSocket>>();
  private readonly inboundHandlers = new Map<string, Array<(userId: string, payload: unknown) => void>>();

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit(): void {
    const httpServer = this.httpAdapterHost.httpAdapter?.getHttpServer();
    if (!httpServer) {
      this.logger.warn('No underlying HTTP server available yet -- realtime channel not started.');
      return;
    }

    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (socket: AuthedSocket, request: IncomingMessage) => {
      this.authenticate(socket, request).catch(() => {
        socket.close(4001, 'Unauthorized');
      });
    });

    // Render's proxy (like most load balancers) can silently drop an
    // idle connection; a periodic ping keeps it alive and lets us
    // prune sockets whose other end vanished without a clean close.
    const heartbeat = setInterval(() => {
      this.wss?.clients.forEach((raw) => {
        const socket = raw as AuthedSocket;
        if (socket.isAlive === false) {
          socket.terminate();
          return;
        }
        socket.isAlive = false;
        socket.ping();
      });
    }, 30_000);
    this.wss.on('close', () => clearInterval(heartbeat));
  }

  private async authenticate(socket: AuthedSocket, request: IncomingMessage): Promise<void> {
    const url = new URL(request.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) {
      throw new Error('Missing token.');
    }

    const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
      secret: this.config.get('jwt', { infer: true }).secret,
    });

    socket.userId = payload.sub;
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    let sockets = this.socketsByUser.get(payload.sub);
    if (!sockets) {
      sockets = new Set();
      this.socketsByUser.set(payload.sub, sockets);
    }
    sockets.add(socket);

    socket.on('close', () => {
      sockets?.delete(socket);
      if (sockets && sockets.size === 0) {
        this.socketsByUser.delete(payload.sub);
      }
    });

    // Inbound messages: call signaling (Phase 2) registers handlers
    // via onInbound() below rather than this gateway knowing anything
    // about call semantics -- direct messaging never needed this
    // (push-only), calls do (relaying an SDP offer/answer/ICE
    // candidate is inherently bidirectional and doesn't need to be
    // durably persisted the way a message or call-status change does).
    socket.on('message', (raw: Buffer) => {
      let parsed: { event?: string; payload?: unknown };
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!parsed?.event || !socket.userId) return;
      const handlers = this.inboundHandlers.get(parsed.event);
      handlers?.forEach((handler) => handler(socket.userId as string, parsed.payload));
    });
  }

  isUserOnline(userId: string): boolean {
    const sockets = this.socketsByUser.get(userId);
    return Boolean(sockets && sockets.size > 0);
  }

  /**
   * Registers a handler for an inbound event name (e.g. 'call:signal').
   * Multiple handlers may register for the same event; each is called
   * with the AUTHENTICATED sender's userId (never trust a userId in
   * the payload itself) and the raw payload.
   */
  onInbound(event: string, handler: (userId: string, payload: unknown) => void): void {
    if (!this.inboundHandlers.has(event)) {
      this.inboundHandlers.set(event, []);
    }
    this.inboundHandlers.get(event)!.push(handler);
  }

  /** Best-effort push to every open connection a user has (any tab/device). Never throws -- a disconnected recipient just relies on their next fetch. */
  sendToUser(userId: string, event: string, payload: unknown): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets || sockets.size === 0) return;

    const message = JSON.stringify({ event, payload });
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  }
}
