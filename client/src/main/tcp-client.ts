import * as net from 'net';
import { EventEmitter } from 'events';
import { AISParser, AISMessage } from './ais-parser';

export interface TCPConnectionConfig {
  host: string;
  port: number;
  enabled: boolean;
  reconnect: boolean;
  reconnectInterval: number;
  maxReconnectAttempts: number;
}

export interface ConnectionStatus {
  connected: boolean;
  host: string;
  port: number;
  messagesReceived: number;
  lastMessageTime: number | null;
  reconnectAttempts: number;
  error: string | null;
}

class TCPConnection extends EventEmitter {
  private socket: net.Socket | null = null;
  private config: TCPConnectionConfig;
  private parser: AISParser;
  private sourceId: string;
  private buffer: string = '';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private messagesReceived: number = 0;
  private lastMessageTime: number | null = null;
  private lastError: string | null = null;
  private intentionalDisconnect: boolean = false;

  constructor(sourceId: string, config: TCPConnectionConfig, parser: AISParser) {
    super();
    this.sourceId = sourceId;
    this.config = config;
    this.parser = parser;
  }

  connect(): void {
    if (this.socket) {
      this.disconnect();
    }

    this.intentionalDisconnect = false;
    console.log(`[${this.sourceId}] Connecting to ${this.config.host}:${this.config.port}...`);

    this.socket = new net.Socket();
    this.socket.setTimeout(10000);

    this.socket.on('connect', () => {
      console.log(`[${this.sourceId}] Connected to ${this.config.host}:${this.config.port}`);
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.emit('connected', this.getStatus());
    });

    this.socket.on('data', (data: Buffer) => {
      this.handleData(data);
    });

    this.socket.on('close', (hadError: boolean) => {
      console.log(`[${this.sourceId}] Connection closed${hadError ? ' with error' : ''}`);
      this.socket = null;
      this.emit('disconnected', this.getStatus());

      if (!this.intentionalDisconnect && this.config.reconnect) {
        this.scheduleReconnect();
      }
    });

    this.socket.on('error', (error: Error) => {
      console.error(`[${this.sourceId}] Connection error:`, error.message);
      this.lastError = error.message;
      this.emit('error', { source: this.sourceId, error: error.message });
    });

    this.socket.on('timeout', () => {
      console.warn(`[${this.sourceId}] Connection timeout`);
      this.lastError = 'Connection timeout';
      this.socket?.destroy();
    });

    this.socket.connect(this.config.port, this.config.host);
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.buffer = '';
    console.log(`[${this.sourceId}] Disconnected`);
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString('utf8');
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        this.processNMEA(trimmed);
      }
    }
  }

  private processNMEA(sentence: string): void {
    if (sentence.includes('VDO')) {
      console.log(`TCP [${this.sourceId}] VDO RAW: ${sentence}`);
    }

    const source = this.sourceId === 'local' ? 'local' : 'collector';
    const message = this.parser.parse(sentence, source as 'collector' | 'local');

    if (message) {
      this.messagesReceived++;
      this.lastMessageTime = Date.now();
      this.emit('message', message);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    if (this.config.maxReconnectAttempts > 0 &&
        this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.log(`[${this.sourceId}] Max reconnect attempts reached`);
      this.emit('maxReconnectReached', this.getStatus());
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1),
      30000
    );

    console.log(`[${this.sourceId}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  updateConfig(config: Partial<TCPConnectionConfig>): void {
    const wasConnected = this.isConnected();
    const hostChanged = config.host !== undefined && config.host !== this.config.host;
    const portChanged = config.port !== undefined && config.port !== this.config.port;

    this.config = { ...this.config, ...config };

    if (wasConnected && (hostChanged || portChanged)) {
      this.disconnect();
      this.connect();
    }
  }

  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  getStatus(): ConnectionStatus {
    return {
      connected: this.isConnected(),
      host: this.config.host,
      port: this.config.port,
      messagesReceived: this.messagesReceived,
      lastMessageTime: this.lastMessageTime,
      reconnectAttempts: this.reconnectAttempts,
      error: this.lastError,
    };
  }

  resetStats(): void {
    this.messagesReceived = 0;
    this.lastMessageTime = null;
    this.lastError = null;
    this.reconnectAttempts = 0;
  }
}

export class TCPClientManager extends EventEmitter {
  private parser: AISParser;
  private collectorConnection: TCPConnection | null = null;
  private localConnection: TCPConnection | null = null;

  private collectorConfig: TCPConnectionConfig = {
    host: 'localhost',
    port: 5000,
    enabled: false,
    reconnect: true,
    reconnectInterval: 5000,
    maxReconnectAttempts: 0,
  };

  private localConfig: TCPConnectionConfig = {
    host: 'localhost',
    port: 10110,
    enabled: false,
    reconnect: true,
    reconnectInterval: 5000,
    maxReconnectAttempts: 0,
  };

  constructor() {
    super();
    this.parser = new AISParser();
  }

  initialize(): void {
    console.log('TCP Client Manager initialized');
  }

  configureCollector(config: Partial<TCPConnectionConfig>): void {
    this.collectorConfig = { ...this.collectorConfig, ...config };

    if (this.collectorConnection) {
      this.collectorConnection.updateConfig(this.collectorConfig);
    }
  }

  configureLocal(config: Partial<TCPConnectionConfig>): void {
    this.localConfig = { ...this.localConfig, ...config };

    if (this.localConnection) {
      this.localConnection.updateConfig(this.localConfig);
    }
  }

  connectCollector(): void {
    if (!this.collectorConfig.enabled) {
      console.log('Collector connection not enabled');
      return;
    }

    if (this.collectorConnection) {
      this.collectorConnection.disconnect();
    }

    this.collectorConnection = new TCPConnection('collector', this.collectorConfig, this.parser);
    this.setupConnectionListeners(this.collectorConnection, 'collector');
    this.collectorConnection.connect();
  }

  connectLocal(): void {
    if (!this.localConfig.enabled) {
      console.log('Local AIS connection not enabled');
      return;
    }

    if (this.localConnection) {
      this.localConnection.disconnect();
    }

    this.localConnection = new TCPConnection('local', this.localConfig, this.parser);
    this.setupConnectionListeners(this.localConnection, 'local');
    this.localConnection.connect();
  }

  disconnectCollector(): void {
    if (this.collectorConnection) {
      this.collectorConnection.disconnect();
      this.collectorConnection = null;
    }
  }

  disconnectLocal(): void {
    if (this.localConnection) {
      this.localConnection.disconnect();
      this.localConnection = null;
    }
  }

  disconnectAll(): void {
    this.disconnectCollector();
    this.disconnectLocal();
  }

  private setupConnectionListeners(connection: TCPConnection, source: string): void {
    connection.on('connected', (status) => {
      this.emit('connectionStatus', { source, status });
    });

    connection.on('disconnected', (status) => {
      this.emit('connectionStatus', { source, status });
    });

    connection.on('error', (data) => {
      this.emit('connectionError', data);
    });

    connection.on('message', (message: AISMessage) => {
      this.emit('aisMessage', message);
    });

    connection.on('maxReconnectReached', (status) => {
      this.emit('maxReconnectReached', { source, status });
    });
  }

  getCollectorStatus(): ConnectionStatus | null {
    return this.collectorConnection?.getStatus() || null;
  }

  getLocalStatus(): ConnectionStatus | null {
    return this.localConnection?.getStatus() || null;
  }

  getAllStatuses(): {
    collector: ConnectionStatus | null;
    local: ConnectionStatus | null;
    parser: ReturnType<AISParser['getStats']>;
  } {
    return {
      collector: this.getCollectorStatus(),
      local: this.getLocalStatus(),
      parser: this.parser.getStats(),
    };
  }

  getParserStats(): ReturnType<AISParser['getStats']> {
    return this.parser.getStats();
  }

  resetStats(): void {
    this.parser.resetStats();
    this.collectorConnection?.resetStats();
    this.localConnection?.resetStats();
  }

  destroy(): void {
    this.disconnectAll();
    this.removeAllListeners();
  }
}

let tcpClientManager: TCPClientManager | null = null;

export function getTCPClientManager(): TCPClientManager {
  if (!tcpClientManager) {
    tcpClientManager = new TCPClientManager();
  }
  return tcpClientManager;
}

export function destroyTCPClientManager(): void {
  if (tcpClientManager) {
    tcpClientManager.destroy();
    tcpClientManager = null;
  }
}
