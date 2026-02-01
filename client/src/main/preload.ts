import { contextBridge, ipcRenderer } from 'electron';

interface CustomLayerData {
  id: string;
  name: string;
  type: 'geojson' | 'shapefile';
  geojson: string;
  color: string;
  opacity: number;
  visible: boolean;
  labelConfig: string | null;
}

interface GeofenceZoneData {
  id: string;
  name: string;
  type: 'polygon' | 'circle';
  geometry: string;
  centerLat: number | null;
  centerLon: number | null;
  radiusNm: number | null;
  color: string;
  alertOnEnter: boolean;
  alertOnExit: boolean;
}

interface TrackRangeData {
  id: string;
  mmsi: string;
  radiusNm: number;
  color: string;
  alertEnabled: boolean;
}

interface TCPConnectionConfig {
  host: string;
  port: number;
  enabled: boolean;
  reconnect: boolean;
  reconnectInterval: number;
  maxReconnectAttempts: number;
}

interface TCPConnectionStatus {
  connected: boolean;
  host: string;
  port: number;
  messagesReceived: number;
  lastMessageTime: number | null;
  reconnectAttempts: number;
  error: string | null;
}

interface AISMessage {
  type: number;
  mmsi: string;
  lat?: number;
  lon?: number;
  speed?: number;
  course?: number;
  heading?: number;
  status?: number;
  name?: string;
  imo?: string;
  callsign?: string;
  shiptype?: number;
  length?: number;
  width?: number;
  destination?: string;
  draught?: number;
  timestamp?: number;
  source?: 'collector' | 'local';
}

interface ParserStats {
  totalParsed: number;
  totalErrors: number;
  byType: Record<number, number>;
  fragmentsBuffered: number;
  fragmentsAssembled: number;
  fragmentsExpired: number;
  invalidSentences: number;
  fragmentsInBuffer: number;
}

interface NonRealtimeTrackData {
  id: string;
  mmsi: string;
  name: string | null;
  imo: string | null;
  callsign: string | null;
  shiptype: number | null;
  lat: number;
  lon: number;
  cog: number;
  sog: number;
  heading: number | null;
  isRealtime: boolean;
  activatedAt: string | null;
  notes: string | null;
}

interface LocalWatchlistVesselData {
  id: string;
  mmsi: string | null;
  imo: string | null;
  name: string | null;
  callsign: string | null;
  color: string;
  notes: string | null;
}

interface HistoryPosition {
  id: number;
  timestamp: number;
  lat: number;
  lon: number;
  cog: number;
  sog: number;
  heading: number | null;
}

interface HistoryStats {
  enabled: boolean;
  totalVessels: number;
  totalPositions: number;
  totalSizeMB: number;
  oldestRecord: number | null;
  newestRecord: number | null;
}

const api = {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),

  secure: {
    isAvailable: (): Promise<boolean> =>
      ipcRenderer.invoke('secure:isAvailable'),

    saveToken: (token: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('secure:saveToken', token),

    loadToken: (): Promise<{ token: string | null }> =>
      ipcRenderer.invoke('secure:loadToken'),

    saveApiKey: (apiKey: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('secure:saveApiKey', apiKey),

    loadApiKey: (): Promise<{ apiKey: string | null }> =>
      ipcRenderer.invoke('secure:loadApiKey'),

    clearAll: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('secure:clearAll'),
  },

  db: {
    layers: {
      getAll: (): Promise<CustomLayerData[]> =>
        ipcRenderer.invoke('db:layers:getAll'),
      get: (id: string): Promise<CustomLayerData | undefined> =>
        ipcRenderer.invoke('db:layers:get', id),
      save: (layer: CustomLayerData): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:layers:save', layer),
      updateStyle: (id: string, color: string, opacity: number): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:layers:updateStyle', id, color, opacity),
      updateLabels: (id: string, labelConfig: string | null): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:layers:updateLabels', id, labelConfig),
      updateVisibility: (id: string, visible: boolean): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:layers:updateVisibility', id, visible),
      delete: (id: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:layers:delete', id),
    },

    zones: {
      getAll: (): Promise<GeofenceZoneData[]> =>
        ipcRenderer.invoke('db:zones:getAll'),
      get: (id: string): Promise<GeofenceZoneData | undefined> =>
        ipcRenderer.invoke('db:zones:get', id),
      save: (zone: GeofenceZoneData): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:zones:save', zone),
      updateAlerts: (id: string, alertOnEnter: boolean, alertOnExit: boolean): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:zones:updateAlerts', id, alertOnEnter, alertOnExit),
      delete: (id: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:zones:delete', id),
    },

    ranges: {
      getAll: (): Promise<TrackRangeData[]> =>
        ipcRenderer.invoke('db:ranges:getAll'),
      get: (id: string): Promise<TrackRangeData | undefined> =>
        ipcRenderer.invoke('db:ranges:get', id),
      save: (range: TrackRangeData): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:ranges:save', range),
      updateAlert: (id: string, alertEnabled: boolean): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:ranges:updateAlert', id, alertEnabled),
      delete: (id: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:ranges:delete', id),
    },

    nrt: {
      getAll: (): Promise<NonRealtimeTrackData[]> =>
        ipcRenderer.invoke('db:nrt:getAll'),
      getActive: (): Promise<NonRealtimeTrackData[]> =>
        ipcRenderer.invoke('db:nrt:getActive'),
      get: (id: string): Promise<NonRealtimeTrackData | undefined> =>
        ipcRenderer.invoke('db:nrt:get', id),
      getByMmsi: (mmsi: string): Promise<NonRealtimeTrackData | undefined> =>
        ipcRenderer.invoke('db:nrt:getByMmsi', mmsi),
      save: (track: NonRealtimeTrackData): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:nrt:save', track),
      updatePosition: (id: string, lat: number, lon: number): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:nrt:updatePosition', id, lat, lon),
      updateCourse: (id: string, cog: number, sog: number): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:nrt:updateCourse', id, cog, sog),
      updateData: (id: string, data: { name?: string; imo?: string; callsign?: string; shiptype?: number; notes?: string }): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:nrt:updateData', id, data),
      activate: (id: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:nrt:activate', id),
      activateByMmsi: (mmsi: string): Promise<{ success: boolean; activated: boolean }> =>
        ipcRenderer.invoke('db:nrt:activateByMmsi', mmsi),
      delete: (id: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:nrt:delete', id),
    },

    localWatchlist: {
      getAll: (): Promise<LocalWatchlistVesselData[]> =>
        ipcRenderer.invoke('db:localWatchlist:getAll'),
      get: (id: string): Promise<LocalWatchlistVesselData | undefined> =>
        ipcRenderer.invoke('db:localWatchlist:get', id),
      save: (vessel: LocalWatchlistVesselData): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:localWatchlist:save', vessel),
      update: (id: string, data: Partial<LocalWatchlistVesselData>): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:localWatchlist:update', id, data),
      delete: (id: string): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:localWatchlist:delete', id),
      clear: (): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('db:localWatchlist:clear'),
      import: (vessels: LocalWatchlistVesselData[]): Promise<{ success: boolean; count: number }> =>
        ipcRenderer.invoke('db:localWatchlist:import', vessels),
    },

    getStats: (): Promise<{ layers: number; zones: number; ranges: number; nrtTracks: number; localWatchlist: number }> =>
      ipcRenderer.invoke('db:stats'),
    clearAll: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('db:clearAll'),
  },

  history: {
    setEnabled: (enabled: boolean): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('history:setEnabled', enabled),

    isEnabled: (): Promise<boolean> =>
      ipcRenderer.invoke('history:isEnabled'),

    getStats: (): Promise<HistoryStats> =>
      ipcRenderer.invoke('history:getStats'),

    pruneOldRecords: (days: number): Promise<{ success: boolean; deletedRecords: number; deletedFiles: number }> =>
      ipcRenderer.invoke('history:pruneOldRecords', days),

    clearAll: (): Promise<{ success: boolean; deletedFiles: number }> =>
      ipcRenderer.invoke('history:clearAll'),

    getMMSIs: (): Promise<string[]> =>
      ipcRenderer.invoke('history:getMMSIs'),

    getHistory: (mmsi: string, fromTimestamp?: number, toTimestamp?: number): Promise<HistoryPosition[]> =>
      ipcRenderer.invoke('history:getHistory', mmsi, fromTimestamp, toTimestamp),
  },

  tcp: {
    collector: {
      configure: (config: Partial<TCPConnectionConfig>): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('tcp:collector:configure', config),
      connect: (): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('tcp:collector:connect'),
      disconnect: (): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('tcp:collector:disconnect'),
      getStatus: (): Promise<TCPConnectionStatus | null> =>
        ipcRenderer.invoke('tcp:collector:status'),
    },

    local: {
      configure: (config: Partial<TCPConnectionConfig>): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('tcp:local:configure', config),
      connect: (): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('tcp:local:connect'),
      disconnect: (): Promise<{ success: boolean }> =>
        ipcRenderer.invoke('tcp:local:disconnect'),
      getStatus: (): Promise<TCPConnectionStatus | null> =>
        ipcRenderer.invoke('tcp:local:status'),
    },

    getAllStatuses: (): Promise<{
      collector: TCPConnectionStatus | null;
      local: TCPConnectionStatus | null;
      parser: ParserStats;
    }> => ipcRenderer.invoke('tcp:status:all'),

    getParserStats: (): Promise<ParserStats> =>
      ipcRenderer.invoke('tcp:parser:stats'),

    resetStats: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('tcp:stats:reset'),

    onAISMessage: (callback: (message: AISMessage) => void): void => {
      ipcRenderer.on('tcp:aisMessage', (_event, message) => callback(message));
    },

    onAISMessageBatch: (callback: (messages: AISMessage[]) => void): void => {
      ipcRenderer.on('tcp:aisMessageBatch', (_event, messages) => callback(messages));
    },

    onConnectionStatus: (callback: (data: { source: string; status: TCPConnectionStatus }) => void): void => {
      ipcRenderer.on('tcp:connectionStatus', (_event, data) => callback(data));
    },

    onConnectionError: (callback: (data: { source: string; error: string }) => void): void => {
      ipcRenderer.on('tcp:connectionError', (_event, data) => callback(data));
    },

    onMaxReconnectReached: (callback: (data: { source: string; status: TCPConnectionStatus }) => void): void => {
      ipcRenderer.on('tcp:maxReconnectReached', (_event, data) => callback(data));
    },

    removeAllListeners: (): void => {
      ipcRenderer.removeAllListeners('tcp:aisMessage');
      ipcRenderer.removeAllListeners('tcp:aisMessageBatch');
      ipcRenderer.removeAllListeners('tcp:connectionStatus');
      ipcRenderer.removeAllListeners('tcp:connectionError');
      ipcRenderer.removeAllListeners('tcp:maxReconnectReached');
    },
  },

  ws: {
    configure: (config: { url?: string; token?: string; reconnect?: boolean; reconnectInterval?: number; maxReconnectAttempts?: number }): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('ws:configure', config),

    connect: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('ws:connect'),

    disconnect: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('ws:disconnect'),

    getStatus: (): Promise<{
      connected: boolean;
      url: string;
      messagesReceived: number;
      lastMessageTime: number | null;
      reconnectAttempts: number;
      error: string | null;
    }> => ipcRenderer.invoke('ws:status'),

    isConnected: (): Promise<boolean> =>
      ipcRenderer.invoke('ws:isConnected'),

    send: (message: unknown): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('ws:send', message),

    resetStats: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('ws:resetStats'),

    onTrackUpdate: (callback: (message: unknown) => void): void => {
      ipcRenderer.on('ws:trackUpdate', (_event, message) => callback(message));
    },

    onConnected: (callback: () => void): void => {
      ipcRenderer.on('ws:connected', () => callback());
    },

    onDisconnected: (callback: () => void): void => {
      ipcRenderer.on('ws:disconnected', () => callback());
    },

    onError: (callback: (error: { message: string }) => void): void => {
      ipcRenderer.on('ws:error', (_event, error) => callback(error));
    },

    onMaxReconnectReached: (callback: (status: unknown) => void): void => {
      ipcRenderer.on('ws:maxReconnectReached', (_event, status) => callback(status));
    },

    onWatchlistSync: (callback: (message: unknown) => void): void => {
      ipcRenderer.on('ws:watchlistSync', (_event, message) => callback(message));
    },

    removeAllListeners: (): void => {
      ipcRenderer.removeAllListeners('ws:trackUpdate');
      ipcRenderer.removeAllListeners('ws:connected');
      ipcRenderer.removeAllListeners('ws:disconnected');
      ipcRenderer.removeAllListeners('ws:error');
      ipcRenderer.removeAllListeners('ws:maxReconnectReached');
      ipcRenderer.removeAllListeners('ws:watchlistSync');
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
