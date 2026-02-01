export class AISSourceManager {
  constructor(trackManager) {
    this.trackManager = trackManager;

    this.collectorConnected = false;
    this.localConnected = false;

    this.stats = {
      collectorMessages: 0,
      localMessages: 0,
      mergedTracks: 0,
      lastCollectorMessage: null,
      lastLocalMessage: null,
    };

    this.trackSources = new Map();

    this.localPriorityWindow = 5000;

    this.connectionCallbacks = [];
    this.errorCallbacks = [];
    this.trackUpdateCallbacks = [];

    this.hasElectronAPI = this.checkElectronAPI();
  }

  checkElectronAPI() {
    return typeof window !== 'undefined' &&
           window.electronAPI &&
           window.electronAPI.tcp;
  }

  initialize() {
    if (!this.hasElectronAPI) {
      console.warn('Electron API not available, AIS source manager disabled');
      return;
    }

    window.electronAPI.tcp.onAISMessage((message) => {
      this.handleAISMessage(message);
    });

    if (window.electronAPI.tcp.onAISMessageBatch) {
      window.electronAPI.tcp.onAISMessageBatch((messages) => {
        this.handleAISMessageBatch(messages);
      });
    }

    window.electronAPI.tcp.onConnectionStatus((data) => {
      this.handleConnectionStatus(data);
    });

    window.electronAPI.tcp.onConnectionError((data) => {
      this.handleConnectionError(data);
    });

    window.electronAPI.tcp.onMaxReconnectReached((data) => {
      this.handleMaxReconnectReached(data);
    });

    console.log('AIS Source Manager initialized');
  }

  handleAISMessageBatch(messages) {
    if (!Array.isArray(messages)) return;

    for (const message of messages) {
      this.handleAISMessage(message);
    }
  }

  handleAISMessage(message) {
    if (!message || !message.mmsi) return;

    if (message.isOwnShip) {
      console.log(`🔵 AISSourceManager received VDO: MMSI=${message.mmsi}, Type=${message.type}, source=${message.source}`);
    }

    const source = message.source || 'collector';
    const now = Date.now();

    if (source === 'local') {
      this.stats.localMessages++;
      this.stats.lastLocalMessage = now;
    } else {
      this.stats.collectorMessages++;
      this.stats.lastCollectorMessage = now;
    }

    const existingSource = this.trackSources.get(message.mmsi);

    if (source === 'collector' && existingSource) {
      if (existingSource.source === 'local' &&
          (now - existingSource.timestamp) < this.localPriorityWindow) {
        return;
      }
    }

    this.trackSources.set(message.mmsi, {
      source,
      timestamp: now,
    });

    const trackData = this.convertToTrackData(message);

    for (const callback of this.trackUpdateCallbacks) {
      try {
        callback(trackData);
      } catch (e) {
        console.error('Error in track update callback:', e);
      }
    }

    this.trackManager.updateTrack(trackData);
  }

  convertToTrackData(message) {
    const trackData = {
      mmsi: message.mmsi,
      type: message.type,
    };

    if (message.lat !== undefined && message.lon !== undefined) {
      trackData.lat = message.lat;
      trackData.lon = message.lon;
    }

    if (message.speed !== undefined) {
      trackData.speed = message.speed;
      trackData.sog = message.speed;
    }
    if (message.course !== undefined) {
      trackData.course = message.course;
      trackData.cog = message.course;
    }
    if (message.heading !== undefined) {
      trackData.heading = message.heading;
    }

    if (message.name) trackData.name = message.name;
    if (message.imo) trackData.imo = message.imo;
    if (message.callsign) trackData.callsign = message.callsign;
    if (message.shiptype !== undefined) trackData.shiptype = message.shiptype;
    if (message.status !== undefined) trackData.status = message.status;

    if (message.length !== undefined) trackData.length = message.length;
    if (message.width !== undefined) trackData.width = message.width;
    if (message.destination) trackData.destination = message.destination;
    if (message.draught !== undefined) trackData.draught = message.draught;

    if (message.isOwnShip) {
      trackData.isOwnShip = true;
      console.log(`🚢 AISSourceManager: VDO message for MMSI ${message.mmsi}`);
    }

    return trackData;
  }

  handleConnectionStatus(data) {
    const { source, status } = data;

    if (source === 'collector') {
      this.collectorConnected = status.connected;
    } else if (source === 'local') {
      this.localConnected = status.connected;
    }

    for (const callback of this.connectionCallbacks) {
      try {
        callback(source, status);
      } catch (e) {
        console.error('Error in connection callback:', e);
      }
    }

    console.log(`[${source}] Connection status: ${status.connected ? 'Connected' : 'Disconnected'}`);
  }

  handleConnectionError(data) {
    const { source, error } = data;

    console.error(`[${source}] Connection error: ${error}`);

    for (const callback of this.errorCallbacks) {
      try {
        callback(source, error);
      } catch (e) {
        console.error('Error in error callback:', e);
      }
    }
  }

  handleMaxReconnectReached(data) {
    const { source, status } = data;

    console.warn(`[${source}] Max reconnect attempts reached`);

    for (const callback of this.errorCallbacks) {
      try {
        callback(source, 'Max reconnect attempts reached');
      } catch (e) {
        console.error('Error in error callback:', e);
      }
    }
  }

  async connectCollector(host, port, options = {}) {
    if (!this.hasElectronAPI) return;

    const config = {
      host,
      port,
      enabled: true,
      reconnect: options.reconnect ?? true,
      reconnectInterval: options.reconnectInterval ?? 5000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 0,
    };

    await window.electronAPI.tcp.collector.configure(config);
    await window.electronAPI.tcp.collector.connect();
  }

  async disconnectCollector() {
    if (!this.hasElectronAPI) return;
    await window.electronAPI.tcp.collector.disconnect();
  }

  async connectLocal(host, port, options = {}) {
    if (!this.hasElectronAPI) return;

    const config = {
      host,
      port,
      enabled: true,
      reconnect: options.reconnect ?? true,
      reconnectInterval: options.reconnectInterval ?? 5000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 0,
    };

    await window.electronAPI.tcp.local.configure(config);
    await window.electronAPI.tcp.local.connect();
  }

  async disconnectLocal() {
    if (!this.hasElectronAPI) return;
    await window.electronAPI.tcp.local.disconnect();
  }

  async getCollectorStatus() {
    if (!this.hasElectronAPI) return null;
    return await window.electronAPI.tcp.collector.getStatus();
  }

  async getLocalStatus() {
    if (!this.hasElectronAPI) return null;
    return await window.electronAPI.tcp.local.getStatus();
  }

  async getAllStatuses() {
    if (!this.hasElectronAPI) return null;
    return await window.electronAPI.tcp.getAllStatuses();
  }

  async getParserStats() {
    if (!this.hasElectronAPI) return null;
    return await window.electronAPI.tcp.getParserStats();
  }

  async resetStats() {
    if (!this.hasElectronAPI) return;

    this.stats = {
      collectorMessages: 0,
      localMessages: 0,
      mergedTracks: 0,
      lastCollectorMessage: null,
      lastLocalMessage: null,
    };

    this.trackSources.clear();
    await window.electronAPI.tcp.resetStats();
  }

  getStats() {
    return {
      ...this.stats,
      trackedMMSIs: this.trackSources.size,
      collectorConnected: this.collectorConnected,
      localConnected: this.localConnected,
    };
  }

  onConnectionChange(callback) {
    this.connectionCallbacks.push(callback);
  }

  onError(callback) {
    this.errorCallbacks.push(callback);
  }

  onTrackUpdate(callback) {
    this.trackUpdateCallbacks.push(callback);
  }

  isConnected() {
    return this.collectorConnected || this.localConnected;
  }

  getConnectionSummary() {
    const parts = [];
    if (this.collectorConnected) parts.push('Collector');
    if (this.localConnected) parts.push('AIS Locale');
    return parts.length > 0 ? parts.join(' + ') : 'Disconnesso';
  }

  destroy() {
    if (this.hasElectronAPI) {
      window.electronAPI.tcp.removeAllListeners();
    }
    this.connectionCallbacks = [];
    this.errorCallbacks = [];
    this.trackUpdateCallbacks = [];
    this.trackSources.clear();
  }
}
