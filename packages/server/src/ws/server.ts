import { WebSocketServer, type WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { createEnvelope } from '../../../shared/src/protocol.js';
import { wsEnvelopeSchema } from '../../../shared/src/validation.js';
import type { JwtPayload } from '../auth/middleware.js';
import type { AgentRegistry } from '../agent/registry.js';
import type { TaskDispatcher } from '../task/dispatcher.js';
import type { WsHandlers } from './handlers.js';
import type { WsEnvelope } from '../../../shared/src/protocol.js';
import type { AgentId, Sender } from '../../../shared/src/types.js';

interface AuthenticatedClient {
  ws: WebSocket;
  auth: JwtPayload;
}

export class BoardroomWsServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<AuthenticatedClient>();

  constructor(
    private registry: AgentRegistry,
    private dispatcher: TaskDispatcher,
    private handlers: WsHandlers,
  ) {}

  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, 'Missing token');
        return;
      }

      let auth: JwtPayload;
      try {
        auth = jwt.verify(token, config.jwtSecret) as JwtPayload;
      } catch {
        ws.close(4001, 'Invalid token');
        return;
      }

      const client: AuthenticatedClient = { ws, auth };
      this.clients.add(client);

      console.log(`[ws] Client connected: ${auth.sender} (type: ${auth.type})`);

      // Register agent if it is one
      if (auth.agentId) {
        this.registry.register(auth.agentId, ws);

        // Broadcast agent join
        const joinEnvelope = createEnvelope('agent.join', {
          agent: { id: auth.agentId, name: auth.agentId.toUpperCase(), role: '' },
        }, 'system');
        this.broadcast(joinEnvelope, ws);

        // Dispatch any pending tasks
        this.dispatcher.dispatchPending(auth.agentId);
      }

      ws.on('message', (data) => {
        try {
          const raw = JSON.parse(data.toString());
          const parsed = wsEnvelopeSchema.safeParse(raw);

          if (!parsed.success) {
            console.warn(`[ws] Invalid envelope from ${auth.sender}:`, parsed.error.issues);
            return;
          }

          this.handlers.handle(ws, auth.sender, raw as WsEnvelope);
        } catch (err) {
          console.error(`[ws] Failed to parse message from ${auth.sender}:`, err);
        }
      });

      ws.on('close', () => {
        this.clients.delete(client);
        console.log(`[ws] Client disconnected: ${auth.sender}`);

        if (auth.agentId) {
          this.registry.unregister(auth.agentId);

          const leaveEnvelope = createEnvelope('agent.leave', {
            agentId: auth.agentId,
          }, 'system');
          this.broadcast(leaveEnvelope);
        }
      });

      ws.on('error', (err) => {
        console.error(`[ws] Error from ${auth.sender}:`, err.message);
      });
    });

    console.log('[ws] WebSocket server attached');
  }

  broadcast(envelope: WsEnvelope, exclude?: WebSocket): void {
    const data = JSON.stringify(envelope);
    for (const client of this.clients) {
      if (client.ws !== exclude && client.ws.readyState === 1) {
        client.ws.send(data);
      }
    }
  }
}
