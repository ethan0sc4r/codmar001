import WebSocket from 'ws';
import { EventEmitter } from 'events';
import * as secureStorage from './secure-storage';

export interface WSConnectionConfig {
  url: string;
  token?: string;
  reconnect: boolean;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  preferSecure: boolean;
}

export interface WSConnectionStatus {
  connected: boolean;
  url: string;
  messagesReceived: number;
  lastMessageTime: number | null;
  reconnectAttempts: number;
  error: string | null;
}

export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

export class WSClientManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: WSConnectionConfig;
  private status: WSConnectionStatus;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect: boolean = false;
  private triedSecure: boolean = false;
  private originalUrl: string = '';

  constructor() {
    super();

    const savedToken = secureStorage.loadWSToken();

    this.config = {
      url: 'wss://localhost:8080/ws/watchlist',
      token: savedToken,
      reconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      preferSecure: true,
    };
    this.status = {
      connected: false,
      url: this.config.url,
      messagesReceived: 0,
      lastMessageTime: null,
      reconnectAttempts: 0,
      error: null,
    };
  }

  configure(config: Partial<WSConnectionConfig>): void {
    if (config.token) {
      const saved = secureStorage.saveWSToken(config.token);
      if (saved) {
        console.log('[WS] Token saved securely');
      } else {
        console.warn('[WS] Could not save token securely, using in-memory only');
      }
    }

    let url = config.url || this.config.url;
    if (this.config.preferSecure && url.startsWith('ws://')) {
      this.originalUrl = url;
      url = url.replace('ws://', 'wss://');
      console.log('[WS] Upgraded URL to secure:', url);
    }

    this.config = { ...this.config, ...config, url };
    this.status.url = this.config.url;
    this.triedSecure = false;

    console.log('[WS] Configuration updated:', {
      url: this.config.url,
      hasToken: !!this.config.token,
      reconnect: this.config.reconnect,
      preferSecure: this.config.preferSecure,
    });
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[WS] Already connected');
      return;
    }

    this.shouldReconnect = true;
    this.clearReconnectTimer();
    this.doConnect();
  }

  private doConnect(): void {
    try {
      const headers: Record<string, string> = {};
      if (this.config.token) {
        headers['Authorization'] = `Bearer ${this.config.token}`;
      }

      const isSecure = this.config.url.startsWith('wss://');
      console.log(`[WS] Connecting to: ${this.config.url} (${isSecure ? 'secure' : 'insecure'})`);

      this.ws = new WebSocket(this.config.url, {
        headers,
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      });

      this.ws.on('open', () => {
        this.triedSecure = false;
        this.onOpen();
      });
      this.ws.on('message', (data) => this.onMessage(data));
      this.ws.on('close', (code, reason) => this.onClose(code, reason.toString()));
      this.ws.on('error', (error) => this.onErrorWithFallback(error));

    } catch (error) {
      console.error('[WS] Connection error:', error);
      this.status.error = (error as Error).message;
      this.tryFallbackOrReconnect();
    }
  }

  private onErrorWithFallback(error: Error): void {
    console.error('[WS] Error:', error.message);
    this.status.error = error.message;

    const isSecure = this.config.url.startsWith('wss://');
    const canFallback = isSecure && this.originalUrl && !this.triedSecure;

    if (canFallback) {
      console.log('[WS] Secure connection failed, will try insecure fallback...');
      this.triedSecure = true;
    }

    this.emit('error', error);
  }

  private tryFallbackOrReconnect(): void {
    const isSecure = this.config.url.startsWith('wss://');
    const canFallback = isSecure && this.originalUrl && !this.triedSecure;

    if (canFallback) {
      console.log('[WS] Falling back to insecure connection:', this.originalUrl);
      this.triedSecure = true;
      this.config.url = this.originalUrl;
      this.status.url = this.originalUrl;

      setTimeout(() => this.doConnect(), 100);
    } else {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();

    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnect');
      } catch (error) {
        console.warn('[WS] Error closing connection:', error);
      }
      this.ws = null;
    }

    this.status.connected = false;
    this.emit('disconnected');
    console.log('[WS] Disconnected');
  }

  private onOpen(): void {
    console.log('[WS] Connected');
    this.status.connected = true;
    this.status.reconnectAttempts = 0;
    this.status.error = null;
    this.emit('connected');
    this.emit('statusChange', this.getStatus());
  }

  private onMessage(data: WebSocket.RawData): void {
    try {
      const message = JSON.parse(data.toString()) as WSMessage;
      this.status.messagesReceived++;
      this.status.lastMessageTime = Date.now();

      this.emit('message', message);

      if (message.type === 'track_update') {
        this.emit('trackUpdate', message);
      } else if (message.type === 'heartbeat' || message.type === 'pong') {
      } else if (message.type === 'connected') {
        console.log('[WS] Server welcome:', message.message);
      } else if (message.type === 'watchlist_sync') {
        this.emit('watchlistSync', message);
      }

    } catch (error) {
      console.error('[WS] Failed to parse message:', error);
    }
  }

  private onClose(code: number, reason: string): void {
    console.log('[WS] Connection closed:', code, reason);
    this.status.connected = false;
    this.ws = null;
    this.emit('disconnected');
    this.emit('statusChange', this.getStatus());

    if (this.shouldReconnect && this.config.reconnect) {
      this.tryFallbackOrReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || !this.config.reconnect) {
      return;
    }

    if (this.config.maxReconnectAttempts > 0 &&
        this.status.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      this.emit('maxReconnectReached', this.getStatus());
      return;
    }

    this.status.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(1.5, this.status.reconnectAttempts - 1),
      30000
    );

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.status.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  send(message: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot send: not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[WS] Send error:', error);
      return false;
    }
  }

  getStatus(): WSConnectionStatus {
    return { ...this.status };
  }

  isConnected(): boolean {
    return this.status.connected;
  }

  resetStats(): void {
    this.status.messagesReceived = 0;
    this.status.lastMessageTime = null;
  }

  destroy(): void {
    this.disconnect();
    this.removeAllListeners();
  }
}

let wsClientInstance: WSClientManager | null = null;

export function getWSClientManager(): WSClientManager {
  if (!wsClientInstance) {
    wsClientInstance = new WSClientManager();
  }
  return wsClientInstance;
}

export function destroyWSClientManager(): void {
  if (wsClientInstance) {
    wsClientInstance.destroy();
    wsClientInstance = null;
  }
}
