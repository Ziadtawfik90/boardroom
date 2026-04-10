import { EventEmitter } from 'node:events';
import type { WsEnvelope, WsMessageType } from '@boardroom/shared';
export interface ConnectionEvents {
    message: [envelope: WsEnvelope];
    connected: [];
    disconnected: [];
}
export declare class Connection extends EventEmitter<ConnectionEvents> {
    private ws;
    private backoffMs;
    private reconnectTimer;
    private intentionalClose;
    connect(): void;
    disconnect(): void;
    send<T>(type: WsMessageType, payload: T): void;
    get isConnected(): boolean;
    private obtainToken;
    private establishConnection;
    private scheduleReconnect;
}
//# sourceMappingURL=connection.d.ts.map