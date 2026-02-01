import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import * as database from './database';
import { getTCPClientManager, destroyTCPClientManager, TCPConnectionConfig } from './tcp-client';
import { getWSClientManager, destroyWSClientManager, WSConnectionConfig } from './ws-client';
import * as historyManager from './history-manager';
import * as secureStorage from './secure-storage';
import * as schemas from './ipc-schemas';

let mainWindow: BrowserWindow | null = null;

let aisBatchBuffer: unknown[] = [];
let aisBatchTimer: NodeJS.Timeout | null = null;
const AIS_BATCH_INTERVAL = 100;
const AIS_BATCH_MAX_SIZE = 50;

function safeSendToRenderer(channel: string, ...args: unknown[]): boolean {
  try {
    if (mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.webContents &&
        !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
      return true;
    }
  } catch (error) {
    console.warn('Failed to send to renderer:', (error as Error).message);
  }
  return false;
}

function flushAisBatch(): void {
  if (aisBatchBuffer.length > 0) {
    const batch = aisBatchBuffer;
    aisBatchBuffer = [];
    safeSendToRenderer('tcp:aisMessageBatch', batch);
  }
}

function queueAisMessage(message: unknown): void {
  aisBatchBuffer.push(message);

  if (aisBatchBuffer.length >= AIS_BATCH_MAX_SIZE) {
    if (aisBatchTimer) {
      clearTimeout(aisBatchTimer);
      aisBatchTimer = null;
    }
    flushAisBatch();
  } else if (!aisBatchTimer) {
    aisBatchTimer = setTimeout(() => {
      aisBatchTimer = null;
      flushAisBatch();
    }, AIS_BATCH_INTERVAL);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    title: 'COI FINDER - Maritime AIS Tracking',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
      devTools: process.env.NODE_ENV === 'development',
    },
    backgroundColor: '#1a1a1a',
    show: false,
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));

    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') {
        event.preventDefault();
      }
      if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault();
      }
      if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'j') {
        event.preventDefault();
      }
    });

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://api.maptiler.com https://*.basemaps.cartocdn.com",
              "font-src 'self'",
              "connect-src 'self' ws://localhost:* wss://localhost:* ws://127.0.0.1:* wss://127.0.0.1:* wss://*",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'self'"
            ].join('; ')
          ]
        }
      });
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await database.initDatabase();
  await historyManager.initHistoryManager();
  initTCPClientManager();
  initWSClientManager();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

function initTCPClientManager() {
  const tcpManager = getTCPClientManager();
  tcpManager.initialize();

  tcpManager.on('aisMessage', (message) => {
    historyManager.processAISMessage(message);
    queueAisMessage(message);
  });

  tcpManager.on('connectionStatus', (data) => {
    safeSendToRenderer('tcp:connectionStatus', data);
  });

  tcpManager.on('connectionError', (data) => {
    safeSendToRenderer('tcp:connectionError', data);
  });

  tcpManager.on('maxReconnectReached', (data) => {
    safeSendToRenderer('tcp:maxReconnectReached', data);
  });

  console.log('TCP Client Manager initialized');
}

function initWSClientManager() {
  const wsManager = getWSClientManager();

  wsManager.on('trackUpdate', (message) => {
    safeSendToRenderer('ws:trackUpdate', message);
  });

  wsManager.on('connected', () => {
    safeSendToRenderer('ws:connected');
  });

  wsManager.on('disconnected', () => {
    safeSendToRenderer('ws:disconnected');
  });

  wsManager.on('error', (error: Error) => {
    safeSendToRenderer('ws:error', { message: error.message });
  });

  wsManager.on('maxReconnectReached', (status) => {
    safeSendToRenderer('ws:maxReconnectReached', status);
  });

  wsManager.on('watchlistSync', (message) => {
    safeSendToRenderer('ws:watchlistSync', message);
  });

  console.log('WebSocket Client Manager initialized');
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  destroyTCPClientManager();
  destroyWSClientManager();
  historyManager.closeAllHistoryDatabases();
  database.closeDatabase();
});

ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

const ALLOWED_PATHS = new Set(['userData', 'logs', 'temp']);

ipcMain.handle('app:getPath', (_event, name: string) => {
  if (!ALLOWED_PATHS.has(name)) {
    console.warn(`[IPC] app:getPath blocked for: ${name}`);
    throw new Error(`Path '${name}' not allowed`);
  }
  return app.getPath(name as 'userData' | 'logs' | 'temp');
});

ipcMain.handle('db:layers:getAll', () => {
  return database.getAllLayers();
});

ipcMain.handle('db:layers:get', (_event, id: string) => {
  return database.getLayer(id);
});

ipcMain.handle('db:layers:save', (_event, layer: unknown) => {
  const validation = schemas.validateInput(schemas.CustomLayerSchema, layer);
  if (!validation.success) {
    console.warn('[IPC] db:layers:save validation failed:', validation.error);
    return { success: false, error: validation.error };
  }
  database.saveLayer(validation.data as Parameters<typeof database.saveLayer>[0]);
  return { success: true };
});

ipcMain.handle('db:layers:updateStyle', (_event, id: string, color: string, opacity: number) => {
  database.updateLayerStyle(id, color, opacity);
  return { success: true };
});

ipcMain.handle('db:layers:updateLabels', (_event, id: string, labelConfig: string | null) => {
  database.updateLayerLabels(id, labelConfig);
  return { success: true };
});

ipcMain.handle('db:layers:updateVisibility', (_event, id: string, visible: boolean) => {
  database.updateLayerVisibility(id, visible);
  return { success: true };
});

ipcMain.handle('db:layers:delete', (_event, id: string) => {
  database.deleteLayer(id);
  return { success: true };
});

ipcMain.handle('db:zones:getAll', () => {
  return database.getAllZones();
});

ipcMain.handle('db:zones:get', (_event, id: string) => {
  return database.getZone(id);
});

ipcMain.handle('db:zones:save', (_event, zone: unknown) => {
  const validation = schemas.validateInput(schemas.GeofenceZoneSchema, zone);
  if (!validation.success) {
    console.warn('[IPC] db:zones:save validation failed:', validation.error);
    return { success: false, error: validation.error };
  }
  database.saveZone(validation.data as Parameters<typeof database.saveZone>[0]);
  return { success: true };
});

ipcMain.handle('db:zones:updateAlerts', (_event, id: string, alertOnEnter: boolean, alertOnExit: boolean) => {
  database.updateZoneAlerts(id, alertOnEnter, alertOnExit);
  return { success: true };
});

ipcMain.handle('db:zones:delete', (_event, id: string) => {
  database.deleteZone(id);
  return { success: true };
});

ipcMain.handle('db:ranges:getAll', () => {
  return database.getAllRanges();
});

ipcMain.handle('db:ranges:get', (_event, id: string) => {
  return database.getRange(id);
});

ipcMain.handle('db:ranges:save', (_event, range: unknown) => {
  const validation = schemas.validateInput(schemas.TrackRangeSchema, range);
  if (!validation.success) {
    console.warn('[IPC] db:ranges:save validation failed:', validation.error);
    return { success: false, error: validation.error };
  }
  database.saveRange(validation.data as Parameters<typeof database.saveRange>[0]);
  return { success: true };
});

ipcMain.handle('db:ranges:updateAlert', (_event, id: string, alertEnabled: boolean) => {
  database.updateRangeAlert(id, alertEnabled);
  return { success: true };
});

ipcMain.handle('db:ranges:delete', (_event, id: string) => {
  database.deleteRange(id);
  return { success: true };
});

ipcMain.handle('db:stats', () => {
  return database.getStats();
});

ipcMain.handle('db:clearAll', () => {
  database.clearAllData();
  return { success: true };
});

ipcMain.handle('tcp:collector:configure', (_event, config: unknown) => {
  const validation = schemas.validateInput(schemas.TCPConfigSchema.partial(), config);
  if (!validation.success) {
    console.warn('[IPC] tcp:collector:configure validation failed:', validation.error);
    return { success: false, error: validation.error };
  }
  const tcpManager = getTCPClientManager();
  tcpManager.configureCollector(validation.data as Partial<TCPConnectionConfig>);
  return { success: true };
});

ipcMain.handle('tcp:collector:connect', () => {
  const tcpManager = getTCPClientManager();
  tcpManager.connectCollector();
  return { success: true };
});

ipcMain.handle('tcp:collector:disconnect', () => {
  const tcpManager = getTCPClientManager();
  tcpManager.disconnectCollector();
  return { success: true };
});

ipcMain.handle('tcp:collector:status', () => {
  const tcpManager = getTCPClientManager();
  return tcpManager.getCollectorStatus();
});

ipcMain.handle('tcp:local:configure', (_event, config: unknown) => {
  const validation = schemas.validateInput(schemas.TCPConfigSchema.partial(), config);
  if (!validation.success) {
    console.warn('[IPC] tcp:local:configure validation failed:', validation.error);
    return { success: false, error: validation.error };
  }
  const tcpManager = getTCPClientManager();
  tcpManager.configureLocal(validation.data as Partial<TCPConnectionConfig>);
  return { success: true };
});

ipcMain.handle('tcp:local:connect', () => {
  const tcpManager = getTCPClientManager();
  tcpManager.connectLocal();
  return { success: true };
});

ipcMain.handle('tcp:local:disconnect', () => {
  const tcpManager = getTCPClientManager();
  tcpManager.disconnectLocal();
  return { success: true };
});

ipcMain.handle('tcp:local:status', () => {
  const tcpManager = getTCPClientManager();
  return tcpManager.getLocalStatus();
});

ipcMain.handle('tcp:status:all', () => {
  const tcpManager = getTCPClientManager();
  return tcpManager.getAllStatuses();
});

ipcMain.handle('tcp:parser:stats', () => {
  const tcpManager = getTCPClientManager();
  return tcpManager.getParserStats();
});

ipcMain.handle('tcp:stats:reset', () => {
  const tcpManager = getTCPClientManager();
  tcpManager.resetStats();
  return { success: true };
});

ipcMain.handle('db:nrt:getAll', () => {
  return database.getAllNonRealtimeTracks();
});

ipcMain.handle('db:nrt:getActive', () => {
  return database.getActiveNonRealtimeTracks();
});

ipcMain.handle('db:nrt:get', (_event, id: string) => {
  return database.getNonRealtimeTrack(id);
});

ipcMain.handle('db:nrt:getByMmsi', (_event, mmsi: string) => {
  return database.getNonRealtimeTrackByMmsi(mmsi);
});

ipcMain.handle('db:nrt:save', (_event, track: unknown) => {
  const validation = schemas.validateInput(schemas.NonRealtimeTrackSchema, track);
  if (!validation.success) {
    console.warn('[IPC] db:nrt:save validation failed:', validation.error);
    return { success: false, error: validation.error };
  }
  database.saveNonRealtimeTrack(validation.data as Parameters<typeof database.saveNonRealtimeTrack>[0]);
  return { success: true };
});

ipcMain.handle('db:nrt:updatePosition', (_event, id: string, lat: number, lon: number) => {
  database.updateNonRealtimeTrackPosition(id, lat, lon);
  return { success: true };
});

ipcMain.handle('db:nrt:updateCourse', (_event, id: string, cog: number, sog: number) => {
  database.updateNonRealtimeTrackCourse(id, cog, sog);
  return { success: true };
});

ipcMain.handle('db:nrt:updateData', (_event, id: string, data: Parameters<typeof database.updateNonRealtimeTrackData>[1]) => {
  database.updateNonRealtimeTrackData(id, data);
  return { success: true };
});

ipcMain.handle('db:nrt:activate', (_event, id: string) => {
  database.activateNonRealtimeTrack(id);
  return { success: true };
});

ipcMain.handle('db:nrt:activateByMmsi', (_event, mmsi: string) => {
  const activated = database.activateNonRealtimeTrackByMmsi(mmsi);
  return { success: true, activated };
});

ipcMain.handle('db:nrt:delete', (_event, id: string) => {
  database.deleteNonRealtimeTrack(id);
  return { success: true };
});

ipcMain.handle('db:localWatchlist:getAll', () => {
  return database.getAllLocalWatchlist();
});

ipcMain.handle('db:localWatchlist:get', (_event, id: string) => {
  return database.getLocalWatchlistVessel(id);
});

ipcMain.handle('db:localWatchlist:save', (_event, vessel: unknown) => {
  const validation = schemas.validateInput(schemas.LocalWatchlistVesselSchema, vessel);
  if (!validation.success) {
    console.warn('[IPC] db:localWatchlist:save validation failed:', validation.error);
    return { success: false, error: validation.error };
  }
  database.saveLocalWatchlistVessel(validation.data as Parameters<typeof database.saveLocalWatchlistVessel>[0]);
  return { success: true };
});

ipcMain.handle('db:localWatchlist:update', (_event, id: string, data: Parameters<typeof database.updateLocalWatchlistVessel>[1]) => {
  database.updateLocalWatchlistVessel(id, data);
  return { success: true };
});

ipcMain.handle('db:localWatchlist:delete', (_event, id: string) => {
  database.deleteLocalWatchlistVessel(id);
  return { success: true };
});

ipcMain.handle('db:localWatchlist:clear', () => {
  database.clearLocalWatchlist();
  return { success: true };
});

ipcMain.handle('db:localWatchlist:import', (_event, vessels: unknown) => {
  const validation = schemas.validateInput(schemas.LocalWatchlistImportSchema, vessels);
  if (!validation.success) {
    console.warn('[IPC] db:localWatchlist:import validation failed:', validation.error);
    return { success: false, error: validation.error };
  }
  const count = database.importLocalWatchlist(validation.data as Parameters<typeof database.importLocalWatchlist>[0]);
  return { success: true, count };
});

ipcMain.handle('history:setEnabled', (_event, enabled: boolean) => {
  historyManager.setHistoryEnabled(enabled);
  return { success: true };
});

ipcMain.handle('history:isEnabled', () => {
  return historyManager.isHistoryEnabled();
});

ipcMain.handle('history:getStats', () => {
  return historyManager.getHistoryStats();
});

ipcMain.handle('history:pruneOldRecords', (_event, days: unknown) => {
  const validation = schemas.validateInput(schemas.HistoryPruneSchema, { days });
  if (!validation.success) {
    console.warn('[IPC] history:pruneOldRecords validation failed:', validation.error);
    return { success: false, error: validation.error };
  }
  const result = historyManager.pruneOldRecords((validation.data as { days: number }).days);
  return { success: true, ...result };
});

ipcMain.handle('history:clearAll', () => {
  const result = historyManager.clearAllHistory();
  return { success: true, ...result };
});

ipcMain.handle('history:getMMSIs', () => {
  return historyManager.getHistoryMMSIs();
});

ipcMain.handle('history:getHistory', (_event, mmsi: string, fromTimestamp?: number, toTimestamp?: number) => {
  return historyManager.getHistory(mmsi, fromTimestamp, toTimestamp);
});

ipcMain.handle('ws:configure', (_event, config: unknown) => {
  const validation = schemas.validateInput(schemas.WSConfigSchema.partial(), config);
  if (!validation.success) {
    console.warn('[IPC] ws:configure validation failed:', validation.error);
    return { success: false, error: validation.error };
  }
  const wsManager = getWSClientManager();
  wsManager.configure(validation.data as Partial<WSConnectionConfig>);
  return { success: true };
});

ipcMain.handle('ws:connect', () => {
  const wsManager = getWSClientManager();
  wsManager.connect();
  return { success: true };
});

ipcMain.handle('ws:disconnect', () => {
  const wsManager = getWSClientManager();
  wsManager.disconnect();
  return { success: true };
});

ipcMain.handle('ws:status', () => {
  const wsManager = getWSClientManager();
  return wsManager.getStatus();
});

ipcMain.handle('ws:isConnected', () => {
  const wsManager = getWSClientManager();
  return wsManager.isConnected();
});

ipcMain.handle('ws:send', (_event, message: unknown) => {
  const wsManager = getWSClientManager();
  const sent = wsManager.send(message);
  return { success: sent };
});

ipcMain.handle('ws:resetStats', () => {
  const wsManager = getWSClientManager();
  wsManager.resetStats();
  return { success: true };
});

ipcMain.handle('secure:isAvailable', () => {
  return secureStorage.isEncryptionAvailable();
});

ipcMain.handle('secure:saveToken', (_event, token: string) => {
  const saved = secureStorage.saveWSToken(token);
  return { success: saved };
});

ipcMain.handle('secure:loadToken', () => {
  const token = secureStorage.loadWSToken();
  return { token: token || null };
});

ipcMain.handle('secure:saveApiKey', (_event, apiKey: string) => {
  const saved = secureStorage.saveApiKey(apiKey);
  return { success: saved };
});

ipcMain.handle('secure:loadApiKey', () => {
  const apiKey = secureStorage.loadApiKey();
  return { apiKey: apiKey || null };
});

ipcMain.handle('secure:clearAll', () => {
  const cleared = secureStorage.clearSecureCredentials();
  return { success: cleared };
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});
