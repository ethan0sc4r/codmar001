
import { MapController } from './modules/map.controller.js';
import { TrackManager } from './modules/track.manager.js';
import { GISTools } from './modules/gis-tools.js';
import { AISSourceManager } from './modules/ais-source.manager.js';
import { NonRealtimeTrackManager } from './modules/nonrealtime-track.manager.js';
import { shipTypeFilter } from './modules/shiptype-filter.js';
import { nvgParser } from './modules/nvg-parser.js';

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  const htmlEntities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return str.replace(/[&<>"']/g, char => htmlEntities[char]);
}

class DarkFleetApp {
  constructor() {
    this.mapController = null;
    this.trackManager = null;
    this.wsClient = null;
    this.gisTools = null;
    this.aisSourceManager = null;
    this.nrtManager = null;  // Non-Realtime Track Manager
    this.localWatchlist = []; // Local watchlist vessels

    this.sidebarOpen = false;
    this.settingsOpen = false;
    this.selectedTrack = null;

    this.fps = 0;
    this.frameCount = 0;
    this.lastFpsUpdate = Date.now();

    this.lastTrackListUpdate = 0;
    this.trackListUpdateThrottle = 2000; // Update every 2 seconds max

    this.watchlistVessels = [];
    this.watchlistLists = [];
    this.lastWatchlistSync = null;
    this.activeListFilter = null; // Currently active list filter (null = show all)

    this.audioContext = null;
    this.newTrackSound = null;

    this.config = this.loadConfig();
  }

  async init() {
    console.log('Initializing DarkFleet client...');

    this.initMap();
    this.initTrackManager();
    this.initGISTools();
    this.initUI();
    this.initAISSource();
    this.initWebSocket();
    this.initNonRealtimeTracks();
    this.initLocalWatchlist();
    this.initAudio();

    this.startFPSCounter();

    this.startClock();

    if (this.config.watchlist?.autoSync && this.config.watchlist?.baseUrl) {
      console.log('Auto-syncing watchlist...');
      await this.syncWatchlist();
    }

    if (this.config.history?.enabled && window.electronAPI?.history) {
      try {
        await window.electronAPI.history.setEnabled(true);
        console.log('History recording enabled from config');
      } catch (error) {
        console.error('Failed to enable history recording:', error);
      }
    }

    console.log('✓ DarkFleet client initialized');
  }

  initMap() {
    this.mapController = new MapController('map');
    this.mapController.initialize();

    if (this.config.ownShip?.mmsi) {
      this.mapController.setOwnShipMmsi(this.config.ownShip.mmsi);
    }

    if (this.config.display?.filterOwnShipOnly) {
      this.mapController.setOwnShipOnlyFilter(true);
    }

    this.mapController.onTrackClick = (feature) => {
      this.showTrackPopup(feature);
    };

    this.mapController.onMouseMove = (lng, lat) => {
      this.updateMouseCoordinates(lng, lat);
    };

    this.mapController.map.on('load', () => {
      setTimeout(async () => {
        this.updateTimelateStyles();
        this.updateSpeedLeaderStyles();
        this.updateStandardTrackStyles();
        this.updateMapBackgroundColor();

        await this.restoreCustomLayers();
      }, 500); // Small delay to ensure layers are added
    });
  }

  initTrackManager() {
    this.trackManager = new TrackManager({
      standardTrackTimeout: this.config.display.standardTrackTimeout,
      watchlistTrackTimeout: this.config.display.watchlistTrackTimeout
    });

    this.trackManager.onUpdate((tracks) => {
      this.mapController.updateTracks(tracks);
      this.updateStatusBar();
      this.frameCount++; // Count frame for FPS
    });

    this.trackManager.onNewTrack((track) => {
      if (track.symbol_type === 'watchlist' || (track.lists && track.lists.length > 0)) {
        this.playWatchlistAlarmSound();
      } else {
        this.playNewTrackSound();
      }
    });

    this.trackManager.onImoReceived((track) => {
      this.playImoReceivedSound();

      setTimeout(() => {
        this.trackManager.clearHighlight(track.mmsi);
      }, 10000);
    });

    this.initShipTypeFilter();
  }

  initShipTypeFilter() {
    shipTypeFilter.onCategoryAdded((categoryId, category) => {
      this.addShipTypeCheckbox(categoryId, category);
      this.updateShipTypeStats();
    });

    shipTypeFilter.onFilterChanged((categories, hiddenCategories) => {
      this.mapController.setHiddenShipTypes(hiddenCategories);
      this.mapController.updateTracks(this.trackManager.tracks);
      this.updateShipTypeFilterUI(categories);
    });

    this.trackManager.onUpdate((tracks) => {
      for (const track of tracks.values()) {
        shipTypeFilter.processTrack(track);
      }
      shipTypeFilter.updateCounts(tracks);
    });
  }

  addShipTypeCheckbox(categoryId, category) {
    const container = document.getElementById('shiptype-filters-container');
    if (!container) return;

    const emptyState = document.getElementById('shiptype-empty');
    if (emptyState) {
      emptyState.style.display = 'none';
    }

    if (document.getElementById(`shiptype-${categoryId}`)) return;

    const div = document.createElement('div');
    div.className = 'checkbox-group shiptype-item';
    div.innerHTML = `
      <input type="checkbox" id="shiptype-${escapeHtml(categoryId)}" checked>
      <label for="shiptype-${escapeHtml(categoryId)}">
        <span class="shiptype-icon">${escapeHtml(category.icon)}</span>
        <span class="shiptype-name">${escapeHtml(category.name)}</span>
        <span class="shiptype-count" id="shiptype-count-${escapeHtml(categoryId)}">0</span>
      </label>
    `;

    container.appendChild(div);

    const checkbox = document.getElementById(`shiptype-${categoryId}`);
    checkbox.addEventListener('change', (e) => {
      shipTypeFilter.setCategoryVisible(categoryId, e.target.checked);
    });
  }

  updateShipTypeFilterUI(categories) {
    for (const cat of categories) {
      const countEl = document.getElementById(`shiptype-count-${cat.id}`);
      if (countEl) {
        countEl.textContent = cat.count;
      }
    }
  }

  updateShipTypeStats() {
    const countEl = document.getElementById('shiptype-count');
    if (countEl) {
      countEl.textContent = shipTypeFilter.getCategoryCount();
    }
  }

  initGISTools() {
    this.gisTools = new GISTools(this.mapController, this.trackManager);

    const completeGISInit = async () => {
      this.gisTools.initialize();

      this.gisTools.onZoneAlert((alert) => {
        this.handleGISAlert(alert);
      });

      this.gisTools.onRangeAlert((alert) => {
        this.handleGISAlert(alert);
      });

      this.gisTools.onMeasurementUpdate((data) => {
        this.updateMeasurementDisplay(data);
      });

      this.gisTools.onZoneCreated((zone) => {
        this.updateZonesList();
        document.getElementById('btn-draw-zone')?.classList.remove('active');
        this.showAlert(`Zona "${zone.name}" creata`, 'success');
        this.saveZoneToDatabase(zone);
      });

      this.gisTools.onRangeCreated((range) => {
        this.updateRangesList();
        this.saveRangeToDatabase(range);
      });

      await this.restoreGISData();

      this.mapController.onStyleReloadCallback = () => {
        console.log('Reinitializing GIS layers after style change...');
        this.gisTools.setupLayers();
        this.gisTools.updateZonesDisplay();
        this.gisTools.updateTrackRangesDisplay();
      };

      console.log('✓ GIS Tools fully initialized');
    };

    if (this.mapController.map.loaded()) {
      completeGISInit();
    } else {
      this.mapController.map.on('load', completeGISInit);
    }

    console.log('GIS Tools initialized');
  }

  handleGISAlert(alert) {
    const isEnter = alert.eventType === 'enter';
    const track = alert.track;
    const trackName = track?.name || `MMSI: ${track?.mmsi}`;

    let message = '';
    let zoneName = '';

    if (alert.type === 'zone') {
      zoneName = alert.zone.name;
      message = isEnter
        ? `${trackName} entrato in ${zoneName}`
        : `${trackName} uscito da ${zoneName}`;
    } else if (alert.type === 'range') {
      const anchorName = alert.anchorTrack?.name || `MMSI: ${alert.anchorTrack?.mmsi}`;
      zoneName = `range di ${anchorName}`;
      message = isEnter
        ? `${trackName} entrato nel ${zoneName} (${alert.distanceNm?.toFixed(2)} nm)`
        : `${trackName} uscito dal ${zoneName}`;
    }

    this.addGISAlertToLog(alert, message);

    this.showAlert(message, isEnter ? 'success' : 'warning');

    console.log(`GIS Alert: ${message}`);
  }

  addGISAlertToLog(alert, message) {
    const logContainer = document.getElementById('gis-alerts-log');
    if (!logContainer) return;

    const emptyState = logContainer.querySelector('.empty-state');
    if (emptyState) {
      emptyState.remove();
    }

    const alertItem = document.createElement('div');
    alertItem.className = `alert-item ${alert.eventType}`;

    const time = new Date(alert.timestamp).toLocaleTimeString('it-IT');
    const icon = alert.eventType === 'enter' ? '→' : '←';

    alertItem.innerHTML = `
      <span class="alert-icon">${escapeHtml(icon)}</span>
      <div class="alert-content">
        <div class="alert-message">${escapeHtml(message)}</div>
        <div class="alert-time">${escapeHtml(time)}</div>
      </div>
    `;

    logContainer.insertBefore(alertItem, logContainer.firstChild);

    while (logContainer.children.length > 50) {
      logContainer.removeChild(logContainer.lastChild);
    }
  }

  updateMeasurementDisplay(data) {
    const totalEl = document.getElementById('measurement-total');
    if (totalEl) {
      totalEl.textContent = data.totalNm.toFixed(2);
    }
  }

  initWebSocket() {
    const baseUrl = this.config.connection.websocket?.url || 'ws://localhost:8080';
    const endpoint = this.config.connection.websocket?.endpoint || '/ws/watchlist';
    const token = this.config.connection.websocket?.token || '';

    const wsUrl = baseUrl + endpoint;

    window.electronAPI.ws.configure({
      url: wsUrl,
      token: token || undefined,
      reconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
    });

    window.electronAPI.ws.onTrackUpdate((data) => {
      if (this.nrtManager && data.mmsi) {
        this.nrtManager.checkForActivation(data.mmsi);
      }
      this.trackManager.updateTrack(data);
    });

    window.electronAPI.ws.onConnected(() => {
      this.updateConnectionStatus('Connesso', 'success');
      this.updateCollectorStatusUI('connected');
    });

    window.electronAPI.ws.onDisconnected(() => {
      this.updateConnectionStatus('Disconnesso', 'danger');
      this.updateCollectorStatusUI('disconnected');
    });

    window.electronAPI.ws.onError((error) => {
      this.updateConnectionStatus('Errore', 'danger');
      this.updateCollectorStatusUI('disconnected');
      console.error('WebSocket error:', error.message);
    });

    window.electronAPI.ws.onWatchlistSync((message) => {
      console.log('Watchlist synced:', message.vessels, 'vessels,', message.lists, 'lists');
    });

    if (this.config.connection?.websocket?.enabled !== false) {
      window.electronAPI.ws.connect();
    }

    this.wsClient = {
      connect: () => window.electronAPI.ws.connect(),
      disconnect: () => window.electronAPI.ws.disconnect(),
      isConnected: () => window.electronAPI.ws.isConnected(),
    };
  }

  initAISSource() {
    this.aisSourceManager = new AISSourceManager(this.trackManager);
    this.aisSourceManager.initialize();

    this.aisSourceManager.onConnectionChange((source, status) => {
      this.updateTCPConnectionStatus(source, status);
    });

    this.aisSourceManager.onError((source, error) => {
      console.error(`[${source}] Error:`, error);
      this.showAlert(`Errore ${source}: ${error}`, 'danger');
    });

    this.aisSourceManager.onTrackUpdate((trackData) => {
      if (this.nrtManager && trackData.mmsi) {
        this.nrtManager.checkForActivation(trackData.mmsi);
      }
    });

    const collectorConfig = this.config.connection?.collector;
    if (collectorConfig?.enabled && collectorConfig?.host && collectorConfig?.port) {
      console.log('Auto-connecting to collector...');
      this.aisSourceManager.connectCollector(
        collectorConfig.host,
        collectorConfig.port,
        {
          reconnect: this.config.connection?.reconnect ?? true,
          reconnectInterval: this.config.connection?.reconnectInterval ?? 5000,
          maxReconnectAttempts: this.config.connection?.maxReconnectAttempts ?? 0,
        }
      );
    }

    const localConfig = this.config.connection?.local;
    if (localConfig?.enabled && localConfig?.host && localConfig?.port) {
      console.log('Auto-connecting to local AIS...');
      this.aisSourceManager.connectLocal(
        localConfig.host,
        localConfig.port,
        {
          reconnect: this.config.connection?.reconnect ?? true,
          reconnectInterval: this.config.connection?.reconnectInterval ?? 5000,
          maxReconnectAttempts: this.config.connection?.maxReconnectAttempts ?? 0,
        }
      );
    }

    console.log('AIS Source Manager initialized');
  }

  updateTCPConnectionStatus(source, status) {
    const statusEl = document.getElementById(`${source === 'local' ? 'local-ais' : source}-status`);
    if (!statusEl) return;

    const indicator = statusEl.querySelector('.status-indicator');
    const text = statusEl.querySelector('.status-text');
    const stats = statusEl.querySelector('.status-stats');

    if (indicator) {
      indicator.className = `status-indicator ${status.connected ? 'connected' : 'disconnected'}`;
    }

    if (text) {
      text.textContent = status.connected ? 'Connesso' : 'Disconnesso';
      if (status.error) {
        text.textContent += ` (${status.error})`;
      }
    }

    if (stats && status.connected) {
      stats.textContent = `${status.messagesReceived} msg`;
    } else if (stats) {
      stats.textContent = '';
    }

    this.updateConnectionStatus(
      this.aisSourceManager.getConnectionSummary(),
      this.aisSourceManager.isConnected() ? 'success' : 'danger'
    );
  }

  async initNonRealtimeTracks() {
    this.nrtManager = new NonRealtimeTrackManager(this.trackManager, this);
    await this.nrtManager.initialize();

    this.nrtManager.onTrackActivated((track) => {
      console.log(`Track activated: ${track.mmsi} - ${track.name || 'Unknown'}`);
      this.playNrtActivationSound();
      this.showAlert(`Traccia ${track.name || track.mmsi} attivata - segnale AIS ricevuto!`, 'success');
      this.updateNrtTrackList();
    });

    this.initNrtUI();

    this.updateNrtTrackList();

    console.log('Non-Realtime Track Manager initialized');
  }

  initNrtUI() {
    document.getElementById('btn-nrt-add')?.addEventListener('click', () => {
      this.addNrtTrack();
    });

    document.getElementById('btn-nrt-use-map')?.addEventListener('click', () => {
      this.useMapPositionForNrt();
    });

    this.updateNrtTrackList();
  }

  async initLocalWatchlist() {
    await this.loadLocalWatchlist();

    this.initLocalWatchlistUI();

    console.log('Local Watchlist initialized');
  }

  async loadLocalWatchlist() {
    if (!window.electronAPI?.db?.localWatchlist) {
      console.warn('Electron API not available for local watchlist');
      return;
    }

    try {
      this.localWatchlist = await window.electronAPI.db.localWatchlist.getAll();
      console.log(`Loaded ${this.localWatchlist.length} vessels from local watchlist`);

      this.updateTrackManagerWithLocalWatchlist();

      this.updateLocalWatchlistUI();
    } catch (error) {
      console.error('Failed to load local watchlist:', error);
    }
  }

  initLocalWatchlistUI() {
    document.getElementById('btn-local-add')?.addEventListener('click', () => {
      this.addLocalWatchlistVessel();
    });

    document.getElementById('btn-local-clear-form')?.addEventListener('click', () => {
      this.clearLocalWatchlistForm();
    });

    document.getElementById('local-list-search')?.addEventListener('input', (e) => {
      this.filterLocalWatchlist(e.target.value);
    });

    document.getElementById('btn-local-export')?.addEventListener('click', () => {
      this.exportLocalWatchlist();
    });

    document.getElementById('btn-local-import')?.addEventListener('click', () => {
      document.getElementById('local-import-file')?.click();
    });

    document.getElementById('local-import-file')?.addEventListener('change', (e) => {
      this.importLocalWatchlist(e.target.files[0]);
    });

    this.updateLocalWatchlistUI();
  }

  async addLocalWatchlistVessel() {
    const mmsi = document.getElementById('local-mmsi')?.value?.trim() || null;
    const name = document.getElementById('local-name')?.value?.trim() || null;
    const notes = document.getElementById('local-notes')?.value?.trim() || null;

    if (!mmsi) {
      this.showAlert('Inserisci il MMSI', 'danger');
      return;
    }

    if (!/^\d{9}$/.test(mmsi)) {
      this.showAlert('MMSI deve essere di 9 cifre', 'danger');
      return;
    }

    const existing = this.localWatchlist.find(v => v.mmsi === mmsi);
    if (existing) {
      this.showAlert('Questo MMSI è già presente nella Custom List', 'warning');
      return;
    }

    const vessel = {
      id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      mmsi,
      imo: null,
      name,
      callsign: null,
      color: '#ffffff', // Fixed white color
      notes
    };

    try {
      await window.electronAPI.db.localWatchlist.save(vessel);
      this.localWatchlist.push(vessel);

      this.updateTrackManagerWithLocalWatchlist();

      this.updateLocalWatchlistUI();
      this.clearLocalWatchlistForm();

      this.showAlert(`${name || mmsi} aggiunto alla Custom List`, 'success');
    } catch (error) {
      console.error('Failed to add vessel to custom list:', error);
      this.showAlert('Errore durante l\'aggiunta', 'danger');
    }
  }

  async deleteLocalWatchlistVessel(id) {
    try {
      await window.electronAPI.db.localWatchlist.delete(id);
      this.localWatchlist = this.localWatchlist.filter(v => v.id !== id);

      this.updateTrackManagerWithLocalWatchlist();

      this.updateLocalWatchlistUI();

      this.showAlert('Nave rimossa dalla lista locale', 'success');
    } catch (error) {
      console.error('Failed to delete vessel from local watchlist:', error);
      this.showAlert('Errore durante la rimozione', 'danger');
    }
  }

  editLocalWatchlistVessel(id) {
    const vessel = this.localWatchlist.find(v => v.id === id);
    if (!vessel) return;

    document.getElementById('local-mmsi').value = vessel.mmsi || '';
    document.getElementById('local-name').value = vessel.name || '';
    document.getElementById('local-notes').value = vessel.notes || '';

    this.deleteLocalWatchlistVessel(id);

    this.showAlert('Modifica i dati e clicca "Aggiungi" per salvare', 'warning');
  }

  clearLocalWatchlistForm() {
    document.getElementById('local-mmsi').value = '';
    document.getElementById('local-name').value = '';
    document.getElementById('local-notes').value = '';
  }

  filterLocalWatchlist(searchTerm) {
    this.updateLocalWatchlistUI(searchTerm);
  }

  updateLocalWatchlistUI(searchTerm = '') {
    const container = document.getElementById('local-list-container');
    const countEl = document.getElementById('local-list-count');

    if (!container) return;

    let vessels = this.localWatchlist;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      vessels = vessels.filter(v =>
        (v.mmsi && v.mmsi.toLowerCase().includes(term)) ||
        (v.name && v.name.toLowerCase().includes(term))
      );
    }

    if (countEl) countEl.textContent = this.localWatchlist.length;

    if (vessels.length === 0) {
      container.innerHTML = '<div class="empty-state">Nessun mercantile nella Custom List</div>';
      return;
    }

    container.innerHTML = vessels.map(vessel => `
      <div class="local-list-item" data-id="${escapeHtml(vessel.id)}">
        <div class="local-list-item-header">
          <span class="local-list-item-mmsi">${escapeHtml(vessel.mmsi)}</span>
          <span class="local-list-item-name">${escapeHtml(vessel.name || '')}</span>
        </div>
        <div class="local-list-item-actions">
          <button class="btn btn-small btn-secondary" onclick="window.app.editLocalWatchlistVessel('${escapeHtml(vessel.id)}')">Modifica</button>
          <button class="btn btn-small btn-danger" onclick="window.app.deleteLocalWatchlistVessel('${escapeHtml(vessel.id)}')">Elimina</button>
        </div>
      </div>
    `).join('');
  }

  exportLocalWatchlist() {
    if (this.localWatchlist.length === 0) {
      this.showAlert('Custom List vuota', 'warning');
      return;
    }

    const exportData = this.localWatchlist.map(v => ({
      mmsi: v.mmsi,
      name: v.name,
      notes: v.notes
    }));

    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `custom-list-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showAlert(`Esportati ${this.localWatchlist.length} MMSI`, 'success');
  }

  async importLocalWatchlist(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const vessels = JSON.parse(text);

      if (!Array.isArray(vessels)) {
        throw new Error('Invalid format');
      }

      const validVessels = vessels
        .filter(v => v.mmsi && /^\d{9}$/.test(v.mmsi))
        .map(v => ({
          id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          mmsi: v.mmsi,
          imo: null,
          name: v.name || null,
          callsign: null,
          color: '#ffffff', // Fixed white
          notes: v.notes || null
        }));

      if (validVessels.length === 0) {
        this.showAlert('Nessun MMSI valido nel file', 'warning');
        return;
      }

      const result = await window.electronAPI.db.localWatchlist.import(validVessels);

      await this.loadLocalWatchlist();

      this.showAlert(`Importati ${result.count} MMSI`, 'success');

      document.getElementById('local-import-file').value = '';
    } catch (error) {
      console.error('Failed to import custom list:', error);
      this.showAlert('Errore durante l\'importazione', 'danger');
    }
  }

  updateTrackManagerWithLocalWatchlist() {
    if (!this.trackManager) return;

    const localList = {
      list_id: 'local',
      list_name: 'Lista Locale',
      color: '#ff00ff' // Default color, will be overridden by vessel color
    };

    const localVessels = this.localWatchlist.map(v => ({
      mmsi: v.mmsi ? parseInt(v.mmsi) : null,
      imo: v.imo ? parseInt(v.imo) : null,
      list_id: 'local',
      color: v.color // Individual vessel color
    }));

    const allVessels = [...this.watchlistVessels, ...localVessels];
    const allLists = [...this.watchlistLists];

    if (!allLists.find(l => l.list_id === 'local') && localVessels.length > 0) {
      allLists.push(localList);
    }

    this.trackManager.setWatchlistData(allVessels, allLists);
  }

  async addNrtTrack() {
    console.log('addNrtTrack called');

    const mmsi = document.getElementById('nrt-mmsi')?.value?.trim();
    const name = document.getElementById('nrt-name')?.value?.trim() || null;
    const imo = document.getElementById('nrt-imo')?.value?.trim() || null;
    const callsign = document.getElementById('nrt-callsign')?.value?.trim() || null;
    const lat = parseFloat(document.getElementById('nrt-lat')?.value);
    const lon = parseFloat(document.getElementById('nrt-lon')?.value);
    const cog = parseFloat(document.getElementById('nrt-cog')?.value) || 0;
    const sog = parseFloat(document.getElementById('nrt-sog')?.value) || 0;
    const notes = document.getElementById('nrt-notes')?.value?.trim() || null;

    console.log('NRT form data:', { mmsi, name, lat, lon, cog, sog });

    if (!mmsi || mmsi.length < 9) {
      this.showAlert('MMSI deve essere di 9 cifre', 'danger');
      return;
    }
    if (isNaN(lat) || lat < -90 || lat > 90) {
      this.showAlert('Latitudine non valida (-90 a 90)', 'danger');
      return;
    }
    if (isNaN(lon) || lon < -180 || lon > 180) {
      this.showAlert('Longitudine non valida (-180 a 180)', 'danger');
      return;
    }

    const existing = this.nrtManager.getTrackByMmsi(mmsi);
    if (existing) {
      this.showAlert(`MMSI ${mmsi} già presente nelle tracce non real-time`, 'danger');
      return;
    }

    console.log('Calling nrtManager.addTrack...');
    const track = await this.nrtManager.addTrack({
      mmsi,
      name,
      imo,
      callsign,
      lat,
      lon,
      cog,
      sog,
      notes,
    });

    console.log('Track result:', track);

    if (track) {
      this.showAlert(`Traccia ${name || mmsi} aggiunta`, 'success');
      this.clearNrtForm();
      this.updateNrtTrackList();

      this.mapController.flyTo(lon, lat, 10);
    } else {
      this.showAlert('Errore durante l\'aggiunta della traccia', 'danger');
    }
  }

  clearNrtForm() {
    document.getElementById('nrt-mmsi').value = '';
    document.getElementById('nrt-name').value = '';
    document.getElementById('nrt-imo').value = '';
    document.getElementById('nrt-callsign').value = '';
    document.getElementById('nrt-lat').value = '';
    document.getElementById('nrt-lon').value = '';
    document.getElementById('nrt-cog').value = '';
    document.getElementById('nrt-sog').value = '';
    document.getElementById('nrt-notes').value = '';
  }

  useMapPositionForNrt() {
    const center = this.mapController.getCenter();
    if (center) {
      document.getElementById('nrt-lat').value = center.lat.toFixed(4);
      document.getElementById('nrt-lon').value = center.lon.toFixed(4);
      this.showAlert('Posizione mappa inserita', 'success');
    }
  }

  updateNrtTrackList() {
    const listEl = document.getElementById('nrt-track-list');
    const activeCountEl = document.getElementById('nrt-count-active');
    const realtimeCountEl = document.getElementById('nrt-count-realtime');

    if (!listEl || !this.nrtManager) return;

    const allTracks = this.nrtManager.getAllTracks();
    const activeTracks = allTracks.filter(t => !t.isRealtime);
    const realtimeTracks = allTracks.filter(t => t.isRealtime);

    if (activeCountEl) activeCountEl.textContent = activeTracks.length;
    if (realtimeCountEl) realtimeCountEl.textContent = realtimeTracks.length;

    if (activeTracks.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Nessuna traccia NRT</div>';
      return;
    }

    listEl.innerHTML = activeTracks.map(track => `
      <div class="nrt-track-item" data-id="${escapeHtml(track.id)}">
        <div class="nrt-track-header">
          <span class="nrt-track-mmsi">${escapeHtml(track.mmsi)}</span>
          <span class="nrt-track-name">${escapeHtml(track.name || 'Sconosciuta')}</span>
        </div>
        <div class="nrt-track-details">
          <span>Pos: ${track.lat.toFixed(4)}, ${track.lon.toFixed(4)}</span>
          <span>COG: ${track.cog.toFixed(1)}° | SOG: ${track.sog.toFixed(1)} kn</span>
        </div>
        <div class="nrt-track-actions">
          <button class="btn btn-small btn-secondary" onclick="window.app.editNrtTrack('${escapeHtml(track.id)}')">Modifica</button>
          <button class="btn btn-small btn-secondary" onclick="window.app.centerOnNrtTrack('${escapeHtml(track.id)}')">Centra</button>
          <button class="btn btn-small btn-secondary" onclick="window.app.duplicateNrtTrack('${escapeHtml(track.id)}')">Duplica</button>
          <button class="btn btn-small btn-danger" onclick="window.app.deleteNrtTrack('${escapeHtml(track.id)}')">Elimina</button>
        </div>
      </div>
    `).join('');
  }

  editNrtTrack(id) {
    const track = this.nrtManager.getTrack(id);
    if (!track) return;

    document.getElementById('nrt-mmsi').value = track.mmsi;
    document.getElementById('nrt-name').value = track.name || '';
    document.getElementById('nrt-imo').value = track.imo || '';
    document.getElementById('nrt-callsign').value = track.callsign || '';
    document.getElementById('nrt-lat').value = track.lat.toFixed(4);
    document.getElementById('nrt-lon').value = track.lon.toFixed(4);
    document.getElementById('nrt-cog').value = track.cog;
    document.getElementById('nrt-sog').value = track.sog;
    document.getElementById('nrt-notes').value = track.notes || '';

    this.nrtManager.deleteTrack(id);
    this.updateNrtTrackList();

    this.showAlert('Modifica i dati e clicca "Aggiungi Traccia" per salvare', 'warning');
  }

  centerOnNrtTrack(id) {
    const track = this.nrtManager.getTrack(id);
    if (!track) return;

    this.mapController.flyTo(track.lon, track.lat, 12);
  }

  async duplicateNrtTrack(id) {
    const newTrack = await this.nrtManager.duplicateTrack(id);
    if (newTrack) {
      this.showAlert(`Traccia duplicata: ${newTrack.mmsi}`, 'success');
      this.updateNrtTrackList();
    }
  }

  async deleteNrtTrack(id) {
    const track = this.nrtManager.getTrack(id);
    if (!track) return;

    if (confirm(`Eliminare la traccia ${track.name || track.mmsi}?`)) {
      const success = await this.nrtManager.deleteTrack(id);
      if (success) {
        this.showAlert('Traccia eliminata', 'success');
        this.updateNrtTrackList();
      }
    }
  }

  playNrtActivationSound() {
    if (!this.audioContext) return;

    try {
      const now = this.audioContext.currentTime;

      const osc1 = this.audioContext.createOscillator();
      const gain1 = this.audioContext.createGain();
      osc1.connect(gain1);
      gain1.connect(this.audioContext.destination);
      osc1.frequency.value = 880;
      osc1.type = 'sine';
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.linearRampToValueAtTime(0, now + 0.15);
      osc1.start(now);
      osc1.stop(now + 0.15);

      const osc2 = this.audioContext.createOscillator();
      const gain2 = this.audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(this.audioContext.destination);
      osc2.frequency.value = 1100;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0, now + 0.15);
      gain2.gain.linearRampToValueAtTime(0.2, now + 0.2);
      gain2.gain.linearRampToValueAtTime(0, now + 0.4);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.4);
    } catch (error) {
      console.warn('Failed to play activation sound:', error);
    }
  }

  initAudio() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('Audio context initialized');
    } catch (error) {
      console.warn('Audio context not available:', error);
    }

    const resumeAudio = () => {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().then(() => {
          console.log('Audio context resumed');
        });
      }
    };

    document.addEventListener('click', resumeAudio, { once: true });
    document.addEventListener('keydown', resumeAudio, { once: true });
  }

  playNewTrackSound() {
    if (!this.audioContext || !this.config.audio?.enableNewTrackSound) {
      return;
    }

    try {
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';

      const now = this.audioContext.currentTime;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.15, now + 0.01); // Fade in
      gainNode.gain.linearRampToValueAtTime(0, now + 0.15); // Fade out

      oscillator.start(now);
      oscillator.stop(now + 0.15);

    } catch (error) {
      console.warn('Failed to play notification sound:', error);
    }
  }

  playImoReceivedSound() {
    if (!this.audioContext || !this.config.audio?.enableNewTrackSound) {
      return;
    }

    try {
      const now = this.audioContext.currentTime;

      const osc1 = this.audioContext.createOscillator();
      const gain1 = this.audioContext.createGain();
      osc1.connect(gain1);
      gain1.connect(this.audioContext.destination);
      osc1.frequency.value = 600;
      osc1.type = 'sine';
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.15, now + 0.01);
      gain1.gain.linearRampToValueAtTime(0, now + 0.1);
      osc1.start(now);
      osc1.stop(now + 0.1);

      const osc2 = this.audioContext.createOscillator();
      const gain2 = this.audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(this.audioContext.destination);
      osc2.frequency.value = 900;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0, now + 0.1);
      gain2.gain.linearRampToValueAtTime(0.15, now + 0.11);
      gain2.gain.linearRampToValueAtTime(0, now + 0.25);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.25);

    } catch (error) {
      console.warn('Failed to play IMO notification sound:', error);
    }
  }

  playWatchlistAlarmSound() {
    if (!this.audioContext || !this.config.audio?.enableNewTrackSound) {
      return;
    }

    try {
      const now = this.audioContext.currentTime;

      const frequencies = [440, 660, 880]; // A4, E5, A5
      const duration = 0.12;
      const gap = 0.08;

      frequencies.forEach((freq, i) => {
        const startTime = now + i * (duration + gap);

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.connect(gain);
        gain.connect(this.audioContext.destination);

        osc.frequency.value = freq;
        osc.type = 'square'; // More "alarm-like" sound

        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.12, startTime + 0.01);
        gain.gain.linearRampToValueAtTime(0, startTime + duration);

        osc.start(startTime);
        osc.stop(startTime + duration);
      });

      const repeatStart = now + 3 * (duration + gap) + 0.1;
      frequencies.forEach((freq, i) => {
        const startTime = repeatStart + i * (duration + gap);

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.connect(gain);
        gain.connect(this.audioContext.destination);

        osc.frequency.value = freq;
        osc.type = 'square';

        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.12, startTime + 0.01);
        gain.gain.linearRampToValueAtTime(0, startTime + duration);

        osc.start(startTime);
        osc.stop(startTime + duration);
      });

    } catch (error) {
      console.warn('Failed to play watchlist alarm sound:', error);
    }
  }

  initUI() {
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      this.mapController.zoomIn();
    });

    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      this.mapController.zoomOut();
    });

    document.getElementById('btn-home').addEventListener('click', () => {
      this.mapController.resetView();
    });

    document.getElementById('btn-center-own-ship').addEventListener('click', () => {
      this.centerOnOwnShip();
    });

    document.getElementById('btn-layers').addEventListener('click', () => {
      this.toggleSidebar();
    });

    document.getElementById('btn-settings').addEventListener('click', () => {
      this.openSettings();
    });

    document.getElementById('btn-measure').addEventListener('click', () => {
      this.toggleMeasurementMode();
    });

    document.getElementById('btn-draw-zone').addEventListener('click', () => {
      this.showZoneDrawingOptions();
    });

    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const targetTab = e.target.dataset.tab;
        this.switchSidebarTab(targetTab);
      });
    });

    document.getElementById('track-search').addEventListener('input', (e) => {
      this.filterTrackList(e.target.value);
    });

    document.querySelectorAll('input[name="sidebar-basemap"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.mapController.switchBaseMap(e.target.value);
        document.querySelectorAll('.basemap-selector input[name="basemap"]').forEach(settingsRadio => {
          settingsRadio.checked = settingsRadio.value === e.target.value;
        });
      });
    });

    document.getElementById('btn-show-all-tracks').addEventListener('click', () => {
      this.fitToAllTracks();
    });

    document.getElementById('btn-clear-tracks').addEventListener('click', () => {
      this.clearAllTracks();
    });

    document.getElementById('filter-show-watchlist').addEventListener('change', (e) => {
      this.setLayerVisibility('multi-list-layer', e.target.checked);
    });

    document.getElementById('filter-show-standard').addEventListener('change', (e) => {
      this.setLayerVisibility('tracks-layer', e.target.checked);
    });

    document.getElementById('filter-show-labels').addEventListener('change', (e) => {
      this.setLayerVisibility('track-labels-layer', e.target.checked);
    });

    document.getElementById('filter-show-speed-leaders').addEventListener('change', (e) => {
      this.setLayerVisibility('speed-leaders-layer', e.target.checked);
    });

    document.getElementById('btn-close-popup').addEventListener('click', () => {
      this.hideTrackPopup();
    });

    this.initSettingsUI();

    this.initGISToolsUI();

    this.initReplayUI();

    console.log('UI initialized');
  }

  initGISToolsUI() {
    document.getElementById('btn-start-measure')?.addEventListener('click', () => {
      this.startMeasurement();
    });

    document.getElementById('btn-clear-measure')?.addEventListener('click', () => {
      this.clearMeasurement();
    });

    document.querySelectorAll('.zone-mode-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const mode = e.target.dataset.mode;
        document.querySelectorAll('.zone-mode-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        document.querySelectorAll('.zone-mode-panel').forEach(p => p.classList.remove('active'));
        document.querySelector(`.zone-mode-panel[data-panel="${mode}"]`)?.classList.add('active');
      });
    });

    document.getElementById('btn-draw-polygon')?.addEventListener('click', () => {
      this.startDrawPolygon();
    });

    document.getElementById('btn-draw-circle')?.addEventListener('click', () => {
      this.startDrawCircle();
    });

    document.getElementById('btn-create-circle-coord')?.addEventListener('click', () => {
      this.createCircleFromCoordinates();
    });

    document.getElementById('btn-create-polygon-coord')?.addEventListener('click', () => {
      this.createPolygonFromCoordinates();
    });

    document.getElementById('btn-export-zones')?.addEventListener('click', () => {
      this.exportZones();
    });

    document.getElementById('btn-import-zones')?.addEventListener('click', () => {
      document.getElementById('zones-file-input')?.click();
    });

    document.getElementById('zones-file-input')?.addEventListener('change', (e) => {
      this.importZones(e.target.files);
      e.target.value = '';
    });

    document.getElementById('btn-add-range')?.addEventListener('click', () => {
      this.addTrackRange();
    });

    document.getElementById('btn-clear-alerts')?.addEventListener('click', () => {
      this.clearGISAlerts();
    });
  }


  initReplayUI() {
    this.replayMmsiList = [];
    this.replayColors = [
      '#ff6384', '#36a2eb', '#ffce56', '#4bc0c0', '#9966ff',
      '#ff9f40', '#ff6384', '#c9cbcf', '#7cfc00', '#ff1493'
    ];
    this.replayColorIndex = 0;

    document.getElementById('btn-add-replay-mmsi')?.addEventListener('click', () => {
      this.addReplayMmsi();
    });

    document.getElementById('replay-mmsi-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.addReplayMmsi();
      }
    });

    document.getElementById('btn-load-replay')?.addEventListener('click', () => {
      this.loadReplayTracks();
    });

    document.getElementById('btn-clear-replay')?.addEventListener('click', () => {
      this.clearReplayTracks();
    });

    document.getElementById('btn-load-prediction')?.addEventListener('click', () => {
      this.loadPredictionTracks();
    });

    document.getElementById('btn-clear-prediction')?.addEventListener('click', () => {
      this.clearPredictionTracks();
    });

    this.setDefaultReplayDates();
  }

  setDefaultReplayDates() {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const formatDate = (d) => {
      const pad = (n) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const fromInput = document.getElementById('replay-date-from');
    const toInput = document.getElementById('replay-date-to');

    if (fromInput) fromInput.value = formatDate(yesterday);
    if (toInput) toInput.value = formatDate(now);
  }

  getNextReplayColor() {
    const color = this.replayColors[this.replayColorIndex % this.replayColors.length];
    this.replayColorIndex++;
    return color;
  }

  addReplayMmsi() {
    const input = document.getElementById('replay-mmsi-input');
    const mmsi = input?.value.trim();

    if (!mmsi) return;

    if (!/^\d{9}$/.test(mmsi)) {
      this.showAlert('MMSI deve essere di 9 cifre', 'warning');
      return;
    }

    if (this.replayMmsiList.some(item => item.mmsi === mmsi)) {
      this.showAlert('MMSI già presente nella lista', 'warning');
      return;
    }

    const color = this.getNextReplayColor();
    this.replayMmsiList.push({ mmsi, color });

    this.updateReplayMmsiListUI();

    input.value = '';
    input.focus();
  }

  removeReplayMmsi(mmsi) {
    this.replayMmsiList = this.replayMmsiList.filter(item => item.mmsi !== mmsi);
    this.updateReplayMmsiListUI();
  }

  updateReplayMmsiListUI() {
    const listEl = document.getElementById('replay-mmsi-list');
    if (!listEl) return;

    if (this.replayMmsiList.length === 0) {
      listEl.innerHTML = '';
      return;
    }

    listEl.innerHTML = this.replayMmsiList.map(item => `
      <div class="replay-mmsi-item">
        <span class="mmsi-color" style="background-color: ${item.color}"></span>
        <span class="mmsi-value">${item.mmsi}</span>
        <button class="btn-remove-mmsi" data-mmsi="${item.mmsi}">&times;</button>
      </div>
    `).join('');

    listEl.querySelectorAll('.btn-remove-mmsi').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mmsi = e.target.dataset.mmsi;
        this.removeReplayMmsi(mmsi);
      });
    });
  }

  async loadReplayTracks() {
    if (!window.electronAPI?.history) {
      this.showAlert('API storico non disponibile', 'error');
      return;
    }

    if (this.replayMmsiList.length === 0) {
      this.showAlert('Aggiungi almeno un MMSI', 'warning');
      return;
    }

    const fromInput = document.getElementById('replay-date-from');
    const toInput = document.getElementById('replay-date-to');

    const fromDate = fromInput?.value ? new Date(fromInput.value).getTime() : undefined;
    const toDate = toInput?.value ? new Date(toInput.value).getTime() : undefined;

    const now = Date.now();
    const thirtyMinutesMs = 30 * 60 * 1000;
    const shouldAppendLivePosition = !toDate || (now - toDate) <= thirtyMinutesMs;

    const tracksData = {};
    let totalPositions = 0;

    for (const item of this.replayMmsiList) {
      try {
        const positions = await window.electronAPI.history.getHistory(item.mmsi, fromDate, toDate);
        if (positions && positions.length > 0) {
          if (shouldAppendLivePosition && this.trackManager) {
            const liveTrack = this.trackManager.getTrack(item.mmsi);
            console.log(`[History] MMSI ${item.mmsi}: liveTrack exists=${!!liveTrack}, position=${liveTrack?.position ? JSON.stringify(liveTrack.position) : 'null'}`);

            if (liveTrack && liveTrack.position) {
              const lastHistoryPos = positions[positions.length - 1];
              const liveTimestamp = liveTrack.last_update || Date.now();

              console.log(`[History] Last DB point: lat=${lastHistoryPos.lat}, lon=${lastHistoryPos.lon}, ts=${lastHistoryPos.timestamp}`);
              console.log(`[History] Live position: lat=${liveTrack.position.lat}, lon=${liveTrack.position.lon}, ts=${liveTimestamp}`);
              console.log(`[History] Live is newer: ${liveTimestamp > lastHistoryPos.timestamp}`);

              if (liveTimestamp > lastHistoryPos.timestamp) {
                const livePos = {
                  timestamp: liveTimestamp,
                  lat: liveTrack.position.lat,
                  lon: liveTrack.position.lon,
                  cog: liveTrack.cog ?? 0,
                  sog: liveTrack.sog ?? 0,
                  heading: liveTrack.heading ?? null
                };
                positions.push(livePos);
                console.log(`[History] Added live position to history:`, livePos);
              }
            }
          }

          tracksData[item.mmsi] = {
            color: item.color,
            positions
          };
          totalPositions += positions.length;
        }
      } catch (error) {
        console.error(`Failed to load history for ${item.mmsi}:`, error);
      }
    }

    if (Object.keys(tracksData).length > 0) {
      console.log('History tracksData:', tracksData);
      console.log('Total positions:', totalPositions);
      try {
        this.mapController.displayHistoryTracks(tracksData);
        this.mapController.fitHistoryBounds(tracksData);
        this.updateReplayLegend(tracksData);
        this.updateReplayStats(totalPositions);
        this.showAlert(`Caricati ${totalPositions} posizioni`, 'success');
      } catch (error) {
        console.error('Error displaying history tracks:', error);
        this.showAlert(`Errore visualizzazione: ${error.message}`, 'error');
      }
    } else {
      console.log('No history data found. fromDate:', fromDate, 'toDate:', toDate);
      this.showAlert('Nessun dato trovato per il periodo selezionato', 'warning');
    }
  }

  clearReplayTracks() {
    this.mapController?.clearHistoryTracks();
    this.replayMmsiList = [];
    this.replayColorIndex = 0;
    this.updateReplayMmsiListUI();

    document.getElementById('replay-legend')?.classList.add('hidden');
    document.getElementById('replay-stats')?.classList.add('hidden');
  }

  updateReplayLegend(tracksData) {
    const legendEl = document.getElementById('replay-legend');
    const itemsEl = document.getElementById('replay-legend-items');

    if (!legendEl || !itemsEl) return;

    const mmsiList = Object.keys(tracksData);
    if (mmsiList.length === 0) {
      legendEl.classList.add('hidden');
      return;
    }

    itemsEl.innerHTML = mmsiList.map(mmsi => {
      const { color, positions } = tracksData[mmsi];
      return `
        <div class="legend-item">
          <span class="legend-color" style="background-color: ${color}"></span>
          <span class="legend-mmsi">${mmsi}</span>
          <span class="legend-count">${positions.length} pts</span>
        </div>
      `;
    }).join('');

    legendEl.classList.remove('hidden');
  }

  updateReplayStats(totalPositions) {
    const statsEl = document.getElementById('replay-stats');
    const textEl = document.getElementById('replay-stats-text');

    if (!statsEl || !textEl) return;

    textEl.textContent = `${totalPositions.toLocaleString()} posizioni caricate`;
    statsEl.classList.remove('hidden');
  }


  loadPredictionTracks() {
    if (this.replayMmsiList.length === 0) {
      this.showAlert('Aggiungi almeno un MMSI nella lista sopra', 'warning');
      return;
    }

    if (!this.trackManager) {
      this.showAlert('Track manager non disponibile', 'error');
      return;
    }

    const hoursInput = document.getElementById('prediction-hours');
    const minutesInput = document.getElementById('prediction-minutes');

    const hours = parseInt(hoursInput?.value) || 0;
    const minutes = parseInt(minutesInput?.value) || 0;

    const durationMs = (hours * 60 + minutes) * 60 * 1000;

    if (durationMs <= 0) {
      this.showAlert('Inserisci una durata valida', 'warning');
      return;
    }

    const tracksData = {};
    let tracksFound = 0;
    let notFoundCount = 0;
    let zeroSpeedCount = 0;

    const skippedMmsi = [];

    for (const item of this.replayMmsiList) {
      const track = this.trackManager.getTrack(item.mmsi);

      if (!track || !track.position) {
        console.warn(`Track not found or no position for MMSI ${item.mmsi} - nave non online`);
        skippedMmsi.push({ mmsi: item.mmsi, reason: 'non online' });
        notFoundCount++;
        continue;
      }

      const pos = track.position;
      const cog = track.cog ?? pos.cog ?? pos.course ?? 0;
      const sog = track.sog ?? pos.sog ?? pos.speed ?? 0;

      if (sog <= 0) {
        console.warn(`MMSI ${item.mmsi} has zero speed (sog=${sog}), skipping prediction`);
        skippedMmsi.push({ mmsi: item.mmsi, reason: `velocità ${sog} kn` });
        zeroSpeedCount++;
        continue;
      }

      const positions = this.calculatePredictionPositions(
        pos.lat,
        pos.lon,
        cog,
        sog,
        durationMs
      );

      if (positions.length > 0) {
        tracksData[item.mmsi] = {
          color: item.color,
          positions,
          cog,
          sog
        };
        tracksFound++;
      }
    }

    if (skippedMmsi.length > 0 && tracksFound > 0) {
      const skippedList = skippedMmsi.map(s => `${s.mmsi}: ${s.reason}`).join(', ');
      this.showAlert(`Alcune navi saltate: ${skippedList}`, 'warning');
    }

    if (tracksFound === 0) {
      let errorMsg = 'Nessuna predizione possibile. ';
      if (notFoundCount > 0) {
        errorMsg += `${notFoundCount} MMSI non sono online/visibili sulla mappa. `;
      }
      if (zeroSpeedCount > 0) {
        errorMsg += `${zeroSpeedCount} navi hanno velocità zero.`;
      }
      if (notFoundCount === 0 && zeroSpeedCount === 0) {
        errorMsg += 'Le navi devono essere visibili sulla mappa con velocità > 0.';
      }
      this.showAlert(errorMsg, 'warning');
      return;
    }

    this.mapController.displayPredictionTracks(tracksData);
    this.updatePredictionLegend(tracksData);
    this.showAlert(`Predizione calcolata per ${tracksFound} navi`, 'success');
  }

  calculatePredictionPositions(startLat, startLon, cog, sog, durationMs) {
    const positions = [];
    const intervalMs = 10 * 60 * 1000; // 10 minutes
    const now = Date.now();

    positions.push({
      timestamp: now,
      lat: startLat,
      lon: startLon,
      cog,
      sog,
      isStart: true
    });

    const numPoints = Math.ceil(durationMs / intervalMs);

    for (let i = 1; i <= numPoints; i++) {
      const elapsedMs = Math.min(i * intervalMs, durationMs);
      const elapsedHours = elapsedMs / (1000 * 60 * 60);

      const distanceNm = sog * elapsedHours;

      const newPos = this.calculateDestinationPoint(startLat, startLon, cog, distanceNm);

      positions.push({
        timestamp: now + elapsedMs,
        lat: newPos.lat,
        lon: newPos.lon,
        cog,
        sog,
        isInterpolated: i < numPoints,
        isFinal: elapsedMs >= durationMs
      });
    }

    return positions;
  }

  calculateDestinationPoint(lat, lon, bearing, distanceNm) {
    const R = 3440.065; // Earth radius in nautical miles
    const toRad = (deg) => deg * Math.PI / 180;
    const toDeg = (rad) => rad * 180 / Math.PI;

    const lat1 = toRad(lat);
    const lon1 = toRad(lon);
    const brng = toRad(bearing);
    const d = distanceNm / R; // Angular distance

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
    );

    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

    return {
      lat: toDeg(lat2),
      lon: toDeg(lon2)
    };
  }

  clearPredictionTracks() {
    this.mapController?.clearPredictionTracks();
    document.getElementById('prediction-legend')?.classList.add('hidden');
  }

  updatePredictionLegend(tracksData) {
    const legendEl = document.getElementById('prediction-legend');
    const itemsEl = document.getElementById('prediction-legend-items');

    if (!legendEl || !itemsEl) return;

    const mmsiList = Object.keys(tracksData);
    if (mmsiList.length === 0) {
      legendEl.classList.add('hidden');
      return;
    }

    itemsEl.innerHTML = mmsiList.map(mmsi => {
      const { color, sog, cog } = tracksData[mmsi];
      return `
        <div class="legend-item">
          <span class="legend-color" style="background-color: ${color}; border-style: dashed;"></span>
          <span class="legend-mmsi">${mmsi}</span>
          <span class="legend-count">${sog.toFixed(1)}kn ${cog.toFixed(0)}°</span>
        </div>
      `;
    }).join('');

    legendEl.classList.remove('hidden');
  }

  toggleMeasurementMode() {
    const btn = document.getElementById('btn-measure');

    if (btn.classList.contains('active')) {
      this.gisTools?.cancelDrawing();
      btn.classList.remove('active');
    } else {
      this.startMeasurement();
    }
  }

  startMeasurement() {
    if (!this.gisTools || !this.gisTools.isReady()) {
      console.warn('GIS Tools not ready yet');
      this.showAlert('Strumenti GIS non ancora pronti, riprova', 'warning');
      return;
    }

    this.gisTools.cancelDrawing();
    this.gisTools.startMeasurement();

    document.getElementById('btn-measure')?.classList.add('active');
    document.getElementById('btn-draw-zone')?.classList.remove('active');

    this.showAlert('Modalità misura attiva. Click per aggiungere punti.', 'success');
  }

  clearMeasurement() {
    if (!this.gisTools || !this.gisTools.isReady()) return;

    this.gisTools.clearMeasurement();
    document.getElementById('btn-measure')?.classList.remove('active');
    document.getElementById('measurement-total').textContent = '0.00';
  }

  showZoneDrawingOptions() {
    this.switchSidebarTab('gis');
  }

  startDrawPolygon() {
    if (!this.gisTools || !this.gisTools.isReady()) {
      console.warn('GIS Tools not ready yet');
      this.showAlert('Strumenti GIS non ancora pronti, riprova', 'warning');
      return;
    }

    this.gisTools.startDrawPolygon();
    document.getElementById('btn-measure')?.classList.remove('active');
    document.getElementById('btn-draw-zone')?.classList.add('active');

    this.showAlert('Disegna poligono. Click per aggiungere punti, Invio per terminare.', 'success');
  }

  startDrawCircle() {
    if (!this.gisTools || !this.gisTools.isReady()) {
      console.warn('GIS Tools not ready yet');
      this.showAlert('Strumenti GIS non ancora pronti, riprova', 'warning');
      return;
    }

    this.gisTools.startDrawCircle();
    document.getElementById('btn-measure')?.classList.remove('active');
    document.getElementById('btn-draw-zone')?.classList.add('active');

    this.showAlert('Disegna cerchio. Click per centro, click per raggio.', 'success');
  }

  createCircleFromCoordinates() {
    if (!this.gisTools || !this.gisTools.isReady()) {
      this.showAlert('Strumenti GIS non ancora pronti', 'warning');
      return;
    }

    const latInput = document.getElementById('circle-lat');
    const lngInput = document.getElementById('circle-lng');
    const radiusInput = document.getElementById('circle-radius-coord');
    const colorInput = document.getElementById('circle-color-coord');

    const lat = parseFloat(latInput?.value);
    const lng = parseFloat(lngInput?.value);
    const radius = parseFloat(radiusInput?.value);
    const color = colorInput?.value || '#ff6600';

    if (isNaN(lat) || lat < -90 || lat > 90) {
      this.showAlert('Latitudine non valida (-90 a 90)', 'warning');
      return;
    }
    if (isNaN(lng) || lng < -180 || lng > 180) {
      this.showAlert('Longitudine non valida (-180 a 180)', 'warning');
      return;
    }
    if (isNaN(radius) || radius <= 0) {
      this.showAlert('Raggio non valido', 'warning');
      return;
    }

    const zone = this.gisTools.createCircleZone([lng, lat], radius, { color });
    this.updateZonesList();

    latInput.value = '';
    lngInput.value = '';

    this.showAlert(`Zona cerchio creata: ${radius} nm`, 'success');

    this.mapController.map.flyTo({
      center: [lng, lat],
      zoom: 10
    });
  }

  createPolygonFromCoordinates() {
    if (!this.gisTools || !this.gisTools.isReady()) {
      this.showAlert('Strumenti GIS non ancora pronti', 'warning');
      return;
    }

    const coordsTextarea = document.getElementById('polygon-coords');
    const colorInput = document.getElementById('polygon-color-coord');

    const coordsText = coordsTextarea?.value?.trim();
    const color = colorInput?.value || '#ff6600';

    if (!coordsText) {
      this.showAlert('Inserisci le coordinate del poligono', 'warning');
      return;
    }

    const lines = coordsText.split('\n').filter(line => line.trim());
    const coordinates = [];

    for (const line of lines) {
      const parts = line.trim().split(/[,\s]+/);
      if (parts.length >= 2) {
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);

        if (isNaN(lat) || isNaN(lng)) {
          this.showAlert(`Coordinate non valide: ${line}`, 'warning');
          return;
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          this.showAlert(`Coordinate fuori range: ${line}`, 'warning');
          return;
        }

        coordinates.push([lng, lat]); // GeoJSON uses [lng, lat]
      }
    }

    if (coordinates.length < 3) {
      this.showAlert('Servono almeno 3 punti per un poligono', 'warning');
      return;
    }

    const zone = this.gisTools.createPolygonZone(coordinates, { color });
    this.updateZonesList();

    coordsTextarea.value = '';

    this.showAlert(`Zona poligono creata con ${coordinates.length} vertici`, 'success');

    const centerLat = coordinates.reduce((sum, c) => sum + c[1], 0) / coordinates.length;
    const centerLng = coordinates.reduce((sum, c) => sum + c[0], 0) / coordinates.length;
    this.mapController.map.flyTo({
      center: [centerLng, centerLat],
      zoom: 10
    });
  }

  addTrackRange() {
    if (!this.gisTools) return;

    const mmsiInput = document.getElementById('range-mmsi');
    const radiusInput = document.getElementById('range-radius');
    const colorInput = document.getElementById('range-color');

    const mmsi = mmsiInput?.value?.trim();
    const radius = parseFloat(radiusInput?.value);
    const color = colorInput?.value || '#00ff00';

    if (!mmsi) {
      this.showAlert('Inserisci un MMSI valido', 'warning');
      return;
    }

    if (!radius || radius <= 0) {
      this.showAlert('Inserisci un raggio valido', 'warning');
      return;
    }

    const track = this.trackManager.getTrack(mmsi);
    if (!track) {
      this.showAlert(`Traccia ${mmsi} non trovata. Assicurati che sia attiva.`, 'warning');
      return;
    }

    const range = this.gisTools.addTrackRange(mmsi, radius, { color });
    this.updateRangesList();

    mmsiInput.value = '';

    this.showAlert(`Range aggiunto per ${track.name || mmsi} (${radius} nm)`, 'success');
  }

  updateZonesList() {
    const container = document.getElementById('zones-list');
    if (!container || !this.gisTools) return;

    const zones = this.gisTools.getAllZones();

    if (zones.length === 0) {
      container.innerHTML = '<div class="empty-state">Nessuna zona definita</div>';
      return;
    }

    container.innerHTML = zones.map(zone => `
      <div class="zone-item" data-zone-id="${escapeHtml(zone.id)}">
        <div class="zone-color" style="background-color: ${escapeHtml(zone.color)}"></div>
        <div class="zone-info">
          <div class="zone-name">${escapeHtml(zone.name)}</div>
          <div class="zone-type">${zone.type === 'circle' ? `Cerchio ${zone.radiusNm?.toFixed(1)} nm` : 'Poligono'}</div>
        </div>
        <div class="zone-toggle ${zone.alertOnEnter ? 'active' : ''}" title="Alert attivo"></div>
        <div class="zone-actions">
          <button class="btn-icon-tiny btn-zoom-zone" title="Zoom">⊕</button>
          <button class="btn-icon-tiny btn-danger btn-remove-zone" title="Rimuovi">×</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.zone-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        const zoneId = e.target.closest('.zone-item').dataset.zoneId;
        const zone = this.gisTools.zones.get(zoneId);
        if (zone) {
          zone.alertOnEnter = !zone.alertOnEnter;
          zone.alertOnExit = zone.alertOnEnter;
          toggle.classList.toggle('active');
          this.updateZoneAlertsInDatabase(zoneId, zone.alertOnEnter, zone.alertOnExit);
        }
      });
    });

    container.querySelectorAll('.btn-remove-zone').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const zoneId = e.target.closest('.zone-item').dataset.zoneId;
        this.gisTools.removeZone(zoneId);
        this.updateZonesList();
        this.deleteZoneFromDatabase(zoneId);
      });
    });
  }

  updateRangesList() {
    const container = document.getElementById('ranges-list');
    if (!container || !this.gisTools) return;

    const ranges = this.gisTools.getAllTrackRanges();

    if (ranges.length === 0) {
      container.innerHTML = '<div class="empty-state">Nessun range attivo</div>';
      return;
    }

    container.innerHTML = ranges.map(range => {
      const track = this.trackManager.getTrack(range.mmsi);
      const trackName = track?.name || `MMSI: ${range.mmsi}`;

      return `
        <div class="range-item" data-range-id="${escapeHtml(range.id)}">
          <div class="range-color" style="background-color: ${escapeHtml(range.color)}"></div>
          <div class="range-info">
            <div class="range-name">${escapeHtml(trackName)}</div>
            <div class="range-mmsi">${range.radiusNm} nm</div>
          </div>
          <div class="range-toggle ${range.alertEnabled ? 'active' : ''}" title="Alert attivo"></div>
          <div class="range-actions">
            <button class="btn-icon-tiny btn-danger btn-remove-range" title="Rimuovi">×</button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.range-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        const rangeId = e.target.closest('.range-item').dataset.rangeId;
        const range = this.gisTools.trackRanges.get(rangeId);
        if (range) {
          range.alertEnabled = !range.alertEnabled;
          toggle.classList.toggle('active');
          this.updateRangeAlertInDatabase(rangeId, range.alertEnabled);
        }
      });
    });

    container.querySelectorAll('.btn-remove-range').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const rangeId = e.target.closest('.range-item').dataset.rangeId;
        this.gisTools.removeTrackRange(rangeId);
        this.updateRangesList();
        this.deleteRangeFromDatabase(rangeId);
      });
    });
  }

  exportZones() {
    if (!this.gisTools) return;

    const geojson = this.gisTools.exportZonesToGeoJSON();
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `darkfleet-zones-${Date.now()}.geojson`;
    a.click();

    URL.revokeObjectURL(url);
    this.showAlert('Zone esportate con successo', 'success');
  }

  async importZones(files) {
    if (!files || files.length === 0 || !this.gisTools) return;

    const file = files[0];

    try {
      const text = await file.text();
      const geojson = JSON.parse(text);
      this.gisTools.importZonesFromGeoJSON(geojson);
      this.updateZonesList();
      this.showAlert(`Zone importate da ${file.name}`, 'success');
    } catch (error) {
      this.showAlert(`Errore importazione: ${error.message}`, 'danger');
    }
  }

  clearGISAlerts() {
    const container = document.getElementById('gis-alerts-log');
    if (container) {
      container.innerHTML = '<div class="empty-state">Nessun alert recente</div>';
    }
  }

  initSettingsUI() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.target.dataset.tab;
        this.switchTab(tab);
      });
    });

    this.initOfflineLayersUI();

    document.getElementById('connection-type')?.addEventListener('change', (e) => {
      this.toggleConnectionOptions(e.target.value);
    });

    document.getElementById('btn-test-connection')?.addEventListener('click', () => {
      this.testConnection();
    });

    document.getElementById('btn-connect')?.addEventListener('click', () => {
      this.connectDataSource();
    });

    document.getElementById('btn-disconnect')?.addEventListener('click', () => {
      this.disconnectDataSource();
    });

    document.getElementById('btn-collector-connect')?.addEventListener('click', () => {
      this.connectCollector();
    });

    document.getElementById('btn-collector-disconnect')?.addEventListener('click', () => {
      this.disconnectCollector();
    });

    document.getElementById('btn-local-connect')?.addEventListener('click', () => {
      this.connectLocalAIS();
    });

    document.getElementById('btn-local-disconnect')?.addEventListener('click', () => {
      this.disconnectLocalAIS();
    });

    document.getElementById('btn-reset-parser-stats')?.addEventListener('click', () => {
      this.resetParserStats();
    });

    document.getElementById('btn-ws-connect')?.addEventListener('click', () => {
      this.connectWebSocket();
    });

    document.getElementById('btn-ws-disconnect')?.addEventListener('click', () => {
      this.disconnectWebSocket();
    });

    document.getElementById('btn-test-watchlist').addEventListener('click', () => {
      this.testWatchlistAPI();
    });

    document.getElementById('btn-sync-watchlist').addEventListener('click', () => {
      this.syncWatchlist();
    });

    document.getElementById('btn-save-settings').addEventListener('click', () => {
      this.saveSettings();
    });

    document.getElementById('btn-use-current-view').addEventListener('click', () => {
      this.useCurrentMapView();
    });

    document.getElementById('symbol-size').addEventListener('input', (e) => {
      document.getElementById('symbol-size-value').textContent = e.target.value;
    });

    document.getElementById('label-font-size').addEventListener('input', (e) => {
      document.getElementById('label-font-size-value').textContent = e.target.value;
    });

    document.getElementById('timelate-font-size').addEventListener('input', (e) => {
      document.getElementById('timelate-font-size-value').textContent = e.target.value;
      this.updateTimelateStyles();
    });

    document.getElementById('timelate-halo-width').addEventListener('input', (e) => {
      document.getElementById('timelate-halo-width-value').textContent = e.target.value;
      this.updateTimelateStyles();
    });

    document.getElementById('timelate-color').addEventListener('change', () => {
      this.updateTimelateStyles();
    });

    document.getElementById('timelate-halo-color').addEventListener('change', () => {
      this.updateTimelateStyles();
    });

    document.getElementById('speed-leader-color').addEventListener('change', () => {
      this.updateSpeedLeaderStyles();
    });

    document.getElementById('speed-leader-width').addEventListener('input', (e) => {
      document.getElementById('speed-leader-width-value').textContent = e.target.value;
      this.updateSpeedLeaderStyles();
    });

    document.getElementById('standard-track-color').addEventListener('change', () => {
      this.updateStandardTrackStyles();
    });

    document.getElementById('standard-track-stroke-width').addEventListener('input', (e) => {
      document.getElementById('standard-track-stroke-width-value').textContent = e.target.value;
      this.updateStandardTrackStyles();
    });

    document.getElementById('map-background-color').addEventListener('change', () => {
      this.updateMapBackgroundColor();
    });

    document.getElementById('initial-zoom').addEventListener('input', (e) => {
      document.getElementById('initial-zoom-value').textContent = e.target.value;
    });

    document.querySelectorAll('.basemap-selector input[name="basemap"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.mapController.switchBaseMap(e.target.value);
        document.querySelectorAll('input[name="sidebar-basemap"]').forEach(sidebarRadio => {
          sidebarRadio.checked = sidebarRadio.value === e.target.value;
        });
      });
    });

    document.getElementById('history-enabled')?.addEventListener('change', (e) => {
      this.setHistoryEnabled(e.target.checked);
    });

    document.getElementById('btn-refresh-history-stats')?.addEventListener('click', () => {
      this.refreshHistoryStats();
    });

    document.getElementById('btn-prune-history')?.addEventListener('click', () => {
      this.pruneHistory();
    });

    document.getElementById('btn-clear-all-history')?.addEventListener('click', () => {
      this.clearAllHistory();
    });

    this.populateSettingsForm();
  }

  initOfflineLayersUI() {
    const btnLoadGeojson = document.getElementById('btn-load-geojson');
    const geojsonFileInput = document.getElementById('geojson-file-input');

    if (btnLoadGeojson && geojsonFileInput) {
      btnLoadGeojson.addEventListener('click', () => {
        geojsonFileInput.click();
      });

      geojsonFileInput.addEventListener('change', (e) => {
        this.handleGeoJSONFileSelect(e.target.files);
        e.target.value = ''; // Reset for re-selection
      });
    }

    const btnLoadShapefile = document.getElementById('btn-load-shapefile');
    const shapefileInput = document.getElementById('shapefile-input');

    if (btnLoadShapefile && shapefileInput) {
      btnLoadShapefile.addEventListener('click', () => {
        shapefileInput.click();
      });

      shapefileInput.addEventListener('change', (e) => {
        this.handleShapefileSelect(e.target.files);
        e.target.value = ''; // Reset for re-selection
      });
    }

    const btnLoadNvg = document.getElementById('btn-load-nvg');
    const nvgFileInput = document.getElementById('nvg-file-input');

    if (btnLoadNvg && nvgFileInput) {
      btnLoadNvg.addEventListener('click', () => {
        nvgFileInput.click();
      });

      nvgFileInput.addEventListener('change', (e) => {
        this.handleNVGFileSelect(e.target.files);
        e.target.value = ''; // Reset for re-selection
      });
    }

    const fileUploadArea = document.getElementById('file-upload-area');
    if (fileUploadArea) {
      fileUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileUploadArea.classList.add('drag-over');
      });

      fileUploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        fileUploadArea.classList.remove('drag-over');
      });

      fileUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        fileUploadArea.classList.remove('drag-over');
        this.handleFileDrop(e.dataTransfer.files);
      });

      fileUploadArea.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.geojson,.json,.shp,.dbf,.nvg,.xml';
        input.multiple = true;
        input.addEventListener('change', (e) => {
          this.handleFileDrop(e.target.files);
        });
        input.click();
      });
    }

    this.updateCustomLayersList();
  }

  async handleGeoJSONFileSelect(files) {
    if (!files || files.length === 0) return;

    for (const file of files) {
      if (!file.name.endsWith('.geojson') && !file.name.endsWith('.json')) {
        this.showAlert(`File non valido: ${file.name}. Usa file .geojson o .json`, 'warning');
        continue;
      }

      try {
        const layerId = await this.mapController.loadGeoJSONFile(file, {
          name: file.name.replace(/\.(geojson|json)$/i, '')
        });
        this.showAlert(`Layer "${file.name}" caricato con successo`, 'success');
        this.updateCustomLayersList();
        await this.saveLayerToDatabase(layerId);
        console.log(`GeoJSON layer loaded: ${layerId}`);
      } catch (error) {
        this.showAlert(`Errore caricamento ${file.name}: ${error.message}`, 'danger');
        console.error('GeoJSON load error:', error);
      }
    }
  }

  async handleShapefileSelect(files) {
    if (!files || files.length === 0) return;

    let shpFile = null;
    let dbfFile = null;

    for (const file of files) {
      if (file.name.endsWith('.shp')) {
        shpFile = file;
      } else if (file.name.endsWith('.dbf')) {
        dbfFile = file;
      }
    }

    if (!shpFile) {
      this.showAlert('Seleziona un file .shp valido', 'warning');
      return;
    }

    try {
      const layerId = await this.mapController.loadShapefile(shpFile, dbfFile, {
        name: shpFile.name.replace(/\.shp$/i, '')
      });
      this.showAlert(`Shapefile "${shpFile.name}" caricato con successo`, 'success');
      this.updateCustomLayersList();
      await this.saveLayerToDatabase(layerId);
      console.log(`Shapefile layer loaded: ${layerId}`);
    } catch (error) {
      this.showAlert(`Errore caricamento shapefile: ${error.message}`, 'danger');
      console.error('Shapefile load error:', error);
    }
  }

  async handleNVGFileSelect(files) {
    if (!files || files.length === 0) return;

    for (const file of files) {
      try {
        const geojson = await nvgParser.parseFile(file);

        if (!geojson || !geojson.features || geojson.features.length === 0) {
          this.showAlert(`File NVG "${file.name}" vuoto o non valido`, 'warning');
          continue;
        }

        const layerId = this.mapController.addGeoJSONLayer(geojson, {
          name: file.name.replace(/\.(nvg|xml)$/i, ''),
          sourceType: 'nvg'
        });

        this.showAlert(`NVG "${file.name}" caricato (${geojson.features.length} elementi)`, 'success');
        this.updateCustomLayersList();
        await this.saveLayerToDatabase(layerId);
        console.log(`NVG layer loaded: ${layerId} with ${geojson.features.length} features`);
      } catch (error) {
        this.showAlert(`Errore caricamento NVG: ${error.message}`, 'danger');
        console.error('NVG load error:', error);
      }
    }
  }

  async handleFileDrop(files) {
    if (!files || files.length === 0) return;

    const geojsonFiles = [];
    const nvgFiles = [];
    let shpFile = null;
    let dbfFile = null;

    for (const file of files) {
      const name = file.name.toLowerCase();
      if (name.endsWith('.geojson') || name.endsWith('.json')) {
        geojsonFiles.push(file);
      } else if (name.endsWith('.shp')) {
        shpFile = file;
      } else if (name.endsWith('.dbf')) {
        dbfFile = file;
      } else if (name.endsWith('.nvg') || name.endsWith('.xml')) {
        nvgFiles.push(file);
      }
    }

    if (geojsonFiles.length > 0) {
      await this.handleGeoJSONFileSelect(geojsonFiles);
    }

    if (shpFile) {
      await this.handleShapefileSelect([shpFile, dbfFile].filter(Boolean));
    }

    if (nvgFiles.length > 0) {
      await this.handleNVGFileSelect(nvgFiles);
    }
  }

  updateCustomLayersList() {
    const layers = this.mapController ? this.mapController.getCustomLayers() : [];

    const sidebarList = document.getElementById('custom-layers-list');
    if (sidebarList) {
      if (layers.length === 0) {
        sidebarList.innerHTML = '<div class="empty-state">Nessun layer caricato</div>';
      } else {
        sidebarList.innerHTML = layers.map(layer => {
          const labelConfig = layer.labelConfig || {};
          const fieldOptions = layer.properties || [];

          return `
          <div class="custom-layer-item" data-layer-id="${layer.id}">
            <div class="layer-header">
              <input type="checkbox" class="layer-visibility" ${layer.visible ? 'checked' : ''}>
              <input type="color" class="layer-color-picker" value="${layer.color || '#3388ff'}" title="Cambia colore layer">
              <span class="layer-name">${layer.name}</span>
              <div class="layer-actions">
                <button class="btn-layer-action btn-toggle-label-config" title="Configura label">🏷</button>
                <button class="btn-layer-action btn-fit-layer" title="Zoom al layer">⊕</button>
                <button class="btn-layer-action btn-danger btn-remove-layer" title="Rimuovi layer">×</button>
              </div>
            </div>

            <div class="layer-opacity-row">
              <label class="opacity-label">Opacità:</label>
              <input type="range" class="layer-opacity-slider" min="0" max="100" value="${Math.round((layer.opacity || 0.6) * 100)}" title="Regola opacità">
              <span class="opacity-value">${Math.round((layer.opacity || 0.6) * 100)}%</span>
            </div>

            <div class="layer-label-config" style="display: none;">
              <div class="label-config-row">
                <label class="label-config-label">Campo:</label>
                <select class="label-field-select">
                  <option value="">Nessuna label</option>
                  ${fieldOptions.map(field =>
                    `<option value="${field}" ${labelConfig.field === field ? 'selected' : ''}>${field}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="label-config-row">
                <label class="label-config-label">Dimensione:</label>
                <input type="number" class="label-size-input" value="${labelConfig.size || 12}" min="8" max="24" step="1">
              </div>
              <div class="label-config-row">
                <label class="label-config-label">Colore:</label>
                <input type="color" class="label-color-input" value="${labelConfig.color || '#ffffff'}">
              </div>
              <button class="btn btn-small btn-primary btn-apply-label-config">Applica</button>
            </div>
          </div>
        `;
        }).join('');

        sidebarList.querySelectorAll('.layer-visibility').forEach(checkbox => {
          checkbox.addEventListener('change', (e) => {
            const layerId = e.target.closest('.custom-layer-item').dataset.layerId;
            this.mapController.setLayerVisibility(layerId, e.target.checked);
            this.updateLayerVisibilityInDatabase(layerId, e.target.checked);
          });
        });

        sidebarList.querySelectorAll('.layer-color-picker').forEach(colorPicker => {
          let colorDebounceTimer = null;
          colorPicker.addEventListener('input', (e) => {
            const layerId = e.target.closest('.custom-layer-item').dataset.layerId;
            const color = e.target.value;
            this.mapController.setLayerColor(layerId, color);
            clearTimeout(colorDebounceTimer);
            colorDebounceTimer = setTimeout(() => {
              const layerInfo = this.mapController.customLayers.get(layerId);
              const opacity = layerInfo?.options?.opacity ?? 0.6;
              this.updateLayerStyleInDatabase(layerId, color, opacity);
            }, 500);
          });
        });

        sidebarList.querySelectorAll('.layer-opacity-slider').forEach(slider => {
          let opacityDebounceTimer = null;
          slider.addEventListener('input', (e) => {
            const layerItem = e.target.closest('.custom-layer-item');
            const layerId = layerItem.dataset.layerId;
            const opacityValue = parseInt(e.target.value) / 100;
            this.mapController.setLayerOpacity(layerId, opacityValue);
            layerItem.querySelector('.opacity-value').textContent = `${e.target.value}%`;
            clearTimeout(opacityDebounceTimer);
            opacityDebounceTimer = setTimeout(() => {
              const layerInfo = this.mapController.customLayers.get(layerId);
              const color = layerInfo?.options?.color ?? '#3388ff';
              this.updateLayerStyleInDatabase(layerId, color, opacityValue);
            }, 500);
          });
        });

        sidebarList.querySelectorAll('.btn-toggle-label-config').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const layerItem = e.target.closest('.custom-layer-item');
            const configPanel = layerItem.querySelector('.layer-label-config');
            if (configPanel.style.display === 'none') {
              configPanel.style.display = 'block';
            } else {
              configPanel.style.display = 'none';
            }
          });
        });

        sidebarList.querySelectorAll('.btn-fit-layer').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const layerId = e.target.closest('.custom-layer-item').dataset.layerId;
            this.mapController.fitToLayer(layerId);
          });
        });

        sidebarList.querySelectorAll('.btn-remove-layer').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const layerId = e.target.closest('.custom-layer-item').dataset.layerId;
            this.removeCustomLayer(layerId);
          });
        });

        sidebarList.querySelectorAll('.btn-apply-label-config').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const layerItem = e.target.closest('.custom-layer-item');
            const layerId = layerItem.dataset.layerId;
            const field = layerItem.querySelector('.label-field-select').value;
            const size = parseInt(layerItem.querySelector('.label-size-input').value);
            const color = layerItem.querySelector('.label-color-input').value;

            this.applyLayerLabelConfig(layerId, { field, size, color });
          });
        });
      }
    }

    const settingsList = document.getElementById('loaded-layers-list');
    if (settingsList) {
      if (layers.length === 0) {
        settingsList.innerHTML = '<div class="empty-state">Nessun layer caricato</div>';
      } else {
        settingsList.innerHTML = layers.map(layer => `
          <div class="loaded-layer-item" data-layer-id="${layer.id}">
            <input type="color" class="layer-color-picker" value="${layer.color || '#3388ff'}" title="Cambia colore layer">
            <span class="layer-name">${layer.name}</span>
            <span class="layer-type">${layer.type || 'geojson'}</span>
            <div class="layer-opacity-control">
              <input type="range" class="layer-opacity-slider" min="0" max="100" value="${Math.round((layer.opacity || 0.6) * 100)}" title="Regola opacità">
              <span class="opacity-value">${Math.round((layer.opacity || 0.6) * 100)}%</span>
            </div>
            <button class="btn-layer-action btn-danger btn-remove-layer" title="Rimuovi">×</button>
          </div>
        `).join('');

        settingsList.querySelectorAll('.layer-color-picker').forEach(colorPicker => {
          colorPicker.addEventListener('input', (e) => {
            const layerId = e.target.closest('.loaded-layer-item').dataset.layerId;
            this.mapController.setLayerColor(layerId, e.target.value);
          });
        });

        settingsList.querySelectorAll('.layer-opacity-slider').forEach(slider => {
          slider.addEventListener('input', (e) => {
            const layerItem = e.target.closest('.loaded-layer-item');
            const layerId = layerItem.dataset.layerId;
            const opacityValue = parseInt(e.target.value) / 100;
            this.mapController.setLayerOpacity(layerId, opacityValue);
            layerItem.querySelector('.opacity-value').textContent = `${e.target.value}%`;
          });
        });

        settingsList.querySelectorAll('.btn-remove-layer').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const layerId = e.target.closest('.loaded-layer-item').dataset.layerId;
            this.removeCustomLayer(layerId);
          });
        });
      }
    }
  }

  removeCustomLayer(layerId) {
    if (this.mapController) {
      this.mapController.removeCustomLayer(layerId);
      this.updateCustomLayersList();
      this.deleteLayerFromDatabase(layerId);
      this.showAlert('Layer rimosso', 'success');
    }
  }

  applyLayerLabelConfig(layerId, config) {
    if (!this.mapController) return;

    if (!config.field) {
      this.mapController.removeLayerLabels(layerId);
      this.showAlert('Label rimosse dal layer', 'success');
      this.updateLayerLabelsInDatabase(layerId, null);
    } else {
      this.mapController.setLayerLabels(layerId, config);
      this.showAlert('Label applicate al layer', 'success');
      this.updateLayerLabelsInDatabase(layerId, config);
    }

    this.updateCustomLayersList();
  }

  toggleConnectionOptions(type) {
    const wsOptions = document.getElementById('websocket-options');
    const tcpOptions = document.getElementById('tcp-options');

    if (type === 'websocket') {
      wsOptions.classList.remove('hidden');
      tcpOptions.classList.add('hidden');
    } else {
      wsOptions.classList.add('hidden');
      tcpOptions.classList.remove('hidden');
    }
  }

  populateSettingsForm() {
    const config = this.config;

    document.getElementById('connection-type').value = config.connection.type || 'tcp';
    this.toggleConnectionOptions(config.connection.type || 'tcp');
    document.getElementById('ws-url').value = config.connection.websocket?.url || '';
    document.getElementById('ws-endpoint').value = config.connection.websocket?.endpoint || '/ws/watchlist';
    const wsTokenEl = document.getElementById('ws-token');
    if (wsTokenEl) wsTokenEl.value = config.connection.websocket?.token || '';
    document.getElementById('tcp-host').value = config.connection.tcp?.host || 'localhost';
    document.getElementById('tcp-port').value = config.connection.tcp?.port || 5000;
    document.getElementById('auto-reconnect').checked = config.connection.autoReconnect ?? true;
    document.getElementById('reconnect-interval').value = config.connection.reconnectInterval || 5000;
    document.getElementById('reconnect-attempts').value = config.connection.reconnectAttempts || 0;

    const collectorEnabledEl = document.getElementById('collector-enabled');
    if (collectorEnabledEl) collectorEnabledEl.checked = config.connection.websocket?.enabled ?? false;

    const localHostEl = document.getElementById('local-ais-host');
    const localPortEl = document.getElementById('local-ais-port');
    const localEnabledEl = document.getElementById('local-ais-enabled');
    if (localHostEl) localHostEl.value = config.connection.local?.host || 'localhost';
    if (localPortEl) localPortEl.value = config.connection.local?.port || 10110;
    if (localEnabledEl) localEnabledEl.checked = config.connection.local?.enabled ?? false;

    const ownShipMmsiEl = document.getElementById('own-ship-mmsi');
    if (ownShipMmsiEl) {
      ownShipMmsiEl.value = config.ownShip?.mmsi || '';
      this.updateOwnShipStatus();
    }

    document.getElementById('watchlist-base-url').value = config.watchlist.baseUrl;
    document.getElementById('watchlist-vessels-endpoint').value = config.watchlist.vesselsEndpoint;
    document.getElementById('watchlist-lists-endpoint').value = config.watchlist.listsEndpoint;
    document.getElementById('watchlist-auth-type').value = config.watchlist.authType;
    document.getElementById('watchlist-auto-sync').checked = config.watchlist.autoSync;
    document.getElementById('watchlist-sync-interval').value = config.watchlist.syncInterval;

    document.getElementById('show-speed-leader').checked = config.display.showSpeedLeader;
    document.getElementById('show-labels').checked = config.display.showLabels;
    document.getElementById('show-trails').checked = config.display.showTrails;
    document.getElementById('show-cog-line').checked = config.display.showCogLine;
    document.getElementById('filter-own-ship-only').checked = config.display.filterOwnShipOnly || false;
    document.getElementById('standard-track-timeout').value = config.display.standardTrackTimeout;
    document.getElementById('watchlist-track-timeout').value = config.display.watchlistTrackTimeout;
    document.getElementById('symbol-size').value = config.display.symbolSize;
    document.getElementById('symbol-size-value').textContent = config.display.symbolSize;
    document.getElementById('label-font-size').value = config.display.labelFontSize;
    document.getElementById('label-font-size-value').textContent = config.display.labelFontSize;

    document.getElementById('enable-new-track-sound').checked = config.audio?.enableNewTrackSound !== false;

    if (config.timelate) {
      document.getElementById('timelate-color').value = config.timelate.color || '#ffffff';
      document.getElementById('timelate-font-size').value = config.timelate.fontSize || 11;
      document.getElementById('timelate-font-size-value').textContent = config.timelate.fontSize || 11;
      document.getElementById('timelate-halo-color').value = config.timelate.haloColor || '#000000';
      document.getElementById('timelate-halo-width').value = config.timelate.haloWidth || 1.5;
      document.getElementById('timelate-halo-width-value').textContent = config.timelate.haloWidth || 1.5;
    }

    if (config.speedLeader) {
      document.getElementById('speed-leader-color').value = config.speedLeader.color || '#00ff00';
      document.getElementById('speed-leader-width').value = config.speedLeader.width || 2;
      document.getElementById('speed-leader-width-value').textContent = config.speedLeader.width || 2;
    }

    if (config.standardTrack) {
      document.getElementById('standard-track-color').value = config.standardTrack.color || '#ffffff';
      document.getElementById('standard-track-stroke-width').value = config.standardTrack.strokeWidth || 2;
      document.getElementById('standard-track-stroke-width-value').textContent = config.standardTrack.strokeWidth || 2;
    }

    if (config.mapBackground) {
      document.getElementById('map-background-color').value = config.mapBackground.color || '#191a1a';
    }

    const basemapRadios = document.querySelectorAll('.basemap-selector input[name="basemap"]');
    basemapRadios.forEach(radio => {
      radio.checked = radio.value === config.map.basemap;
    });
    document.getElementById('initial-lat').value = config.map.initialView.lat;
    document.getElementById('initial-lon').value = config.map.initialView.lon;
    document.getElementById('initial-zoom').value = config.map.initialView.zoom;
    document.getElementById('initial-zoom-value').textContent = config.map.initialView.zoom;

    this.updateWatchlistStats();

    this.loadHistorySettings();
  }

  collectSettingsFromForm() {
    return {
      connection: {
        type: document.getElementById('connection-type').value,
        websocket: {
          url: document.getElementById('ws-url')?.value || 'ws://localhost:8080',
          endpoint: document.getElementById('ws-endpoint')?.value || '/ws/watchlist',
          token: document.getElementById('ws-token')?.value || '',
          enabled: document.getElementById('collector-enabled')?.checked ?? false
        },
        tcp: {
          host: document.getElementById('tcp-host')?.value || 'localhost',
          port: parseInt(document.getElementById('tcp-port')?.value || '5000')
        },
        local: {
          host: document.getElementById('local-ais-host')?.value || 'localhost',
          port: parseInt(document.getElementById('local-ais-port')?.value || '10110'),
          enabled: document.getElementById('local-ais-enabled')?.checked ?? false
        },
        autoReconnect: document.getElementById('auto-reconnect').checked,
        reconnectInterval: parseInt(document.getElementById('reconnect-interval').value),
        reconnectAttempts: parseInt(document.getElementById('reconnect-attempts').value)
      },
      watchlist: {
        baseUrl: document.getElementById('watchlist-base-url').value,
        vesselsEndpoint: document.getElementById('watchlist-vessels-endpoint').value,
        listsEndpoint: document.getElementById('watchlist-lists-endpoint').value,
        authType: document.getElementById('watchlist-auth-type').value,
        token: document.getElementById('watchlist-token').value || this.config.watchlist.token,
        autoSync: document.getElementById('watchlist-auto-sync').checked,
        syncInterval: parseInt(document.getElementById('watchlist-sync-interval').value)
      },
      display: {
        showSpeedLeader: document.getElementById('show-speed-leader').checked,
        showLabels: document.getElementById('show-labels').checked,
        showTrails: document.getElementById('show-trails').checked,
        showCogLine: document.getElementById('show-cog-line').checked,
        filterOwnShipOnly: document.getElementById('filter-own-ship-only').checked,
        warningThreshold: this.config.display.warningThreshold || 120, // Keep for backward compatibility
        removalThreshold: this.config.display.removalThreshold || 180, // Keep for backward compatibility
        standardTrackTimeout: parseInt(document.getElementById('standard-track-timeout').value),
        watchlistTrackTimeout: parseInt(document.getElementById('watchlist-track-timeout').value),
        symbolSize: parseInt(document.getElementById('symbol-size').value),
        labelFontSize: parseInt(document.getElementById('label-font-size').value)
      },
      map: {
        basemap: document.querySelector('.basemap-selector input[name="basemap"]:checked').value,
        initialView: {
          lat: parseFloat(document.getElementById('initial-lat').value),
          lon: parseFloat(document.getElementById('initial-lon').value),
          zoom: parseInt(document.getElementById('initial-zoom').value)
        }
      },
      audio: {
        enableNewTrackSound: document.getElementById('enable-new-track-sound').checked
      },
      timelate: {
        color: document.getElementById('timelate-color').value,
        fontSize: parseInt(document.getElementById('timelate-font-size').value),
        haloColor: document.getElementById('timelate-halo-color').value,
        haloWidth: parseFloat(document.getElementById('timelate-halo-width').value)
      },
      speedLeader: {
        color: document.getElementById('speed-leader-color').value,
        width: parseFloat(document.getElementById('speed-leader-width').value)
      },
      standardTrack: {
        color: document.getElementById('standard-track-color').value,
        strokeWidth: parseFloat(document.getElementById('standard-track-stroke-width').value)
      },
      mapBackground: {
        color: document.getElementById('map-background-color').value
      },
      ownShip: {
        mmsi: document.getElementById('own-ship-mmsi')?.value?.trim() || ''
      }
    };
  }

  saveSettings() {
    const newConfig = this.collectSettingsFromForm();
    this.config = newConfig;
    this.saveConfig();

    if (this.trackManager) {
      this.trackManager.setRemovalTimeouts(
        newConfig.display.standardTrackTimeout,
        newConfig.display.watchlistTrackTimeout
      );
    }

    if (this.mapController) {
      this.mapController.setOwnShipMmsi(newConfig.ownShip?.mmsi);
      this.updateOwnShipStatus();

      this.mapController.setOwnShipOnlyFilter(newConfig.display.filterOwnShipOnly || false);

      const tracks = this.trackManager?.getAllTracks();
      if (tracks) {
        this.mapController.updateTracks(tracks);
      }
    }

    this.showAlert('Impostazioni salvate con successo!', 'success');
    this.updateSettingsStatus('Salvato', 'success');

    console.log('Settings saved:', newConfig);
  }


  async loadHistorySettings() {
    if (!window.electronAPI?.history) {
      console.warn('History API not available');
      return;
    }

    try {
      const enabled = await window.electronAPI.history.isEnabled();
      const checkbox = document.getElementById('history-enabled');
      if (checkbox) {
        checkbox.checked = enabled;
      }
      await this.refreshHistoryStats();
    } catch (error) {
      console.error('Failed to load history settings:', error);
    }
  }

  async setHistoryEnabled(enabled) {
    if (!window.electronAPI?.history) return;

    try {
      await window.electronAPI.history.setEnabled(enabled);

      this.config.history = this.config.history || {};
      this.config.history.enabled = enabled;
      this.saveConfig();

      console.log(`History recording ${enabled ? 'enabled' : 'disabled'}`);
      await this.refreshHistoryStats();
    } catch (error) {
      console.error('Failed to set history enabled:', error);
      this.showAlert('Errore nel modificare lo stato dello storico', 'error');
    }
  }

  async refreshHistoryStats() {
    if (!window.electronAPI?.history) return;

    try {
      const stats = await window.electronAPI.history.getStats();

      document.getElementById('history-vessels-count').textContent = stats.totalVessels.toLocaleString();
      document.getElementById('history-positions-count').textContent = stats.totalPositions.toLocaleString();
      document.getElementById('history-size').textContent = `${stats.totalSizeMB} MB`;

      if (stats.oldestRecord && stats.newestRecord) {
        const oldest = new Date(stats.oldestRecord).toLocaleDateString('it-IT');
        const newest = new Date(stats.newestRecord).toLocaleDateString('it-IT');
        document.getElementById('history-period').textContent = `${oldest} - ${newest}`;
      } else {
        document.getElementById('history-period').textContent = 'Nessun dato';
      }

      const checkbox = document.getElementById('history-enabled');
      if (checkbox) {
        checkbox.checked = stats.enabled;
      }
    } catch (error) {
      console.error('Failed to refresh history stats:', error);
    }
  }

  async pruneHistory() {
    if (!window.electronAPI?.history) return;

    const daysSelect = document.getElementById('history-prune-days');
    const days = parseInt(daysSelect.value, 10);
    const resultEl = document.getElementById('prune-result');

    try {
      const result = await window.electronAPI.history.pruneOldRecords(days);

      resultEl.style.display = 'block';
      resultEl.className = 'prune-result';
      resultEl.querySelector('.prune-result-text').textContent =
        `Eliminati ${result.deletedRecords.toLocaleString()} record e ${result.deletedFiles} database vuoti.`;

      await this.refreshHistoryStats();
    } catch (error) {
      console.error('Failed to prune history:', error);
      resultEl.style.display = 'block';
      resultEl.className = 'prune-result error';
      resultEl.querySelector('.prune-result-text').textContent = 'Errore durante la pulizia.';
    }
  }

  async clearAllHistory() {
    if (!window.electronAPI?.history) return;

    const confirmed = confirm('Sei sicuro di voler eliminare TUTTO lo storico?\n\nQuesta azione è irreversibile!');
    if (!confirmed) return;

    const resultEl = document.getElementById('prune-result');

    try {
      const result = await window.electronAPI.history.clearAll();

      resultEl.style.display = 'block';
      resultEl.className = 'prune-result';
      resultEl.querySelector('.prune-result-text').textContent =
        `Storico svuotato: ${result.deletedFiles} database eliminati.`;

      await this.refreshHistoryStats();
      this.showAlert('Storico svuotato con successo', 'success');
    } catch (error) {
      console.error('Failed to clear history:', error);
      resultEl.style.display = 'block';
      resultEl.className = 'prune-result error';
      resultEl.querySelector('.prune-result-text').textContent = 'Errore durante lo svuotamento.';
      this.showAlert('Errore durante lo svuotamento dello storico', 'error');
    }
  }

  async testConnection() {
    const resultEl = document.getElementById('connection-test-result');
    const type = document.getElementById('connection-type').value;

    resultEl.className = 'test-result loading';
    resultEl.textContent = 'Test in corso...';

    if (type === 'websocket') {
      const url = document.getElementById('ws-url').value;
      const endpoint = document.getElementById('ws-endpoint').value;
      const fullUrl = url + endpoint;

      try {
        const testWs = new WebSocket(fullUrl);

        await new Promise((resolve, reject) => {
          testWs.onopen = () => {
            testWs.close();
            resolve();
          };
          testWs.onerror = (err) => reject(err);
          setTimeout(() => reject(new Error('Timeout')), 5000);
        });

        resultEl.className = 'test-result success';
        resultEl.textContent = `Connessione riuscita a ${fullUrl}`;
      } catch (error) {
        resultEl.className = 'test-result error';
        resultEl.textContent = `Connessione fallita: ${error.message || 'Impossibile connettersi'}`;
      }
    } else {
      resultEl.className = 'test-result error';
      resultEl.textContent = 'Test TCP non ancora implementato';
    }
  }

  disconnectDataSource() {
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.updateConnectionStatus('Disconnesso', 'danger');
      this.showAlert('Disconnesso dal server', 'warning');
    }
  }

  connectCollector() {
    const wsUrl = document.getElementById('ws-url')?.value || 'ws://localhost:8080';
    const endpoint = document.getElementById('ws-endpoint')?.value || '/ws/watchlist';
    const token = document.getElementById('ws-token')?.value || '';

    this.config.connection.websocket = {
      url: wsUrl,
      endpoint: endpoint,
      token: token,
      enabled: true,
    };
    this.saveConfig();

    if (this.wsClient) {
      this.wsClient.disconnect();
    }

    this.initWebSocket();
    this.showAlert(`Connessione WebSocket a ${wsUrl}${endpoint}...`, 'warning');

    this.updateCollectorStatusUI('connecting');
  }

  disconnectCollector() {
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.config.connection.websocket = {
        ...this.config.connection.websocket,
        enabled: false,
      };
      this.saveConfig();
      this.showAlert('Disconnesso dal collettore', 'warning');
      this.updateCollectorStatusUI('disconnected');
    }
  }

  updateCollectorStatusUI(state) {
    const statusEl = document.getElementById('collector-status');
    if (!statusEl) return;

    const indicator = statusEl.querySelector('.status-indicator');
    const text = statusEl.querySelector('.status-text');

    if (indicator) {
      indicator.className = `status-indicator ${state === 'connected' ? 'connected' : 'disconnected'}`;
    }

    if (text) {
      if (state === 'connected') {
        text.textContent = 'Connesso';
      } else if (state === 'connecting') {
        text.textContent = 'Connessione...';
      } else {
        text.textContent = 'Disconnesso';
      }
    }
  }

  async connectLocalAIS() {
    const host = document.getElementById('local-ais-host')?.value || 'localhost';
    const port = parseInt(document.getElementById('local-ais-port')?.value || '10110');
    const reconnect = document.getElementById('auto-reconnect')?.checked ?? true;
    const reconnectInterval = parseInt(document.getElementById('reconnect-interval')?.value || '5000');
    const maxAttempts = parseInt(document.getElementById('reconnect-attempts')?.value || '0');

    this.config.connection.local = {
      host,
      port,
      enabled: true,
    };
    this.saveConfig();

    try {
      await this.aisSourceManager.connectLocal(host, port, {
        reconnect,
        reconnectInterval,
        maxReconnectAttempts: maxAttempts,
      });
      this.showAlert(`Connessione AIS locale ${host}:${port}...`, 'warning');
    } catch (error) {
      this.showAlert(`Errore connessione AIS locale: ${error.message}`, 'danger');
    }
  }

  async disconnectLocalAIS() {
    try {
      await this.aisSourceManager.disconnectLocal();
      this.config.connection.local = {
        ...this.config.connection.local,
        enabled: false,
      };
      this.saveConfig();
      this.showAlert('Disconnesso da AIS locale', 'warning');
    } catch (error) {
      this.showAlert(`Errore disconnessione: ${error.message}`, 'danger');
    }
  }

  connectWebSocket() {
    const url = document.getElementById('ws-url')?.value || 'ws://localhost:8080';
    const endpoint = document.getElementById('ws-endpoint')?.value || '/ws/watchlist';
    const token = document.getElementById('ws-token')?.value || '';

    this.config.connection.websocket = {
      url,
      endpoint,
      token,
      enabled: true,
    };
    this.saveConfig();

    if (this.wsClient) {
      this.wsClient.disconnect();
    }
    this.initWebSocket();
    this.showAlert(`Connessione WebSocket a ${url}${endpoint}...`, 'warning');
  }

  disconnectWebSocket() {
    if (this.wsClient) {
      this.wsClient.disconnect();
      this.config.connection.websocket = {
        ...this.config.connection.websocket,
        enabled: false,
      };
      this.saveConfig();
      this.showAlert('Disconnesso da WebSocket', 'warning');
    }
  }

  async resetParserStats() {
    try {
      await this.aisSourceManager.resetStats();
      this.updateParserStatsDisplay();
      this.showAlert('Statistiche parser resettate', 'success');
    } catch (error) {
      this.showAlert(`Errore reset statistiche: ${error.message}`, 'danger');
    }
  }

  async updateParserStatsDisplay() {
    try {
      const stats = await this.aisSourceManager.getParserStats();
      if (!stats) return;

      const totalParsed = document.getElementById('parser-total-parsed');
      const totalErrors = document.getElementById('parser-total-errors');
      const fragmentsAssembled = document.getElementById('parser-fragments-assembled');
      const fragmentsBuffer = document.getElementById('parser-fragments-buffer');

      if (totalParsed) totalParsed.textContent = stats.totalParsed || 0;
      if (totalErrors) totalErrors.textContent = stats.totalErrors || 0;
      if (fragmentsAssembled) fragmentsAssembled.textContent = stats.fragmentsAssembled || 0;
      if (fragmentsBuffer) fragmentsBuffer.textContent = stats.fragmentsInBuffer || 0;
    } catch (error) {
      console.error('Failed to update parser stats:', error);
    }
  }

  async testWatchlistAPI() {
    const resultEl = document.getElementById('watchlist-test-result');
    const baseUrl = document.getElementById('watchlist-base-url').value;
    const vesselsEndpoint = document.getElementById('watchlist-vessels-endpoint').value;
    const authType = document.getElementById('watchlist-auth-type').value;
    const token = document.getElementById('watchlist-token').value || this.config.watchlist.token;

    if (!baseUrl) {
      resultEl.className = 'test-result error';
      resultEl.textContent = 'Inserisci un Base URL valido';
      return;
    }

    resultEl.className = 'test-result loading';
    resultEl.textContent = 'Test API in corso...';

    try {
      const headers = {};
      if (authType === 'bearer' && token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else if (authType === 'apikey' && token) {
        headers['X-API-Key'] = token;
      }

      const response = await fetch(baseUrl + vesselsEndpoint, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const count = Array.isArray(data) ? data.length : 0;

      resultEl.className = 'test-result success';
      resultEl.textContent = `API raggiungibile! Trovati ${count} mercantili.`;
    } catch (error) {
      resultEl.className = 'test-result error';
      resultEl.textContent = `Errore API: ${error.message}`;
    }
  }

  updateWatchlistStats() {
    document.getElementById('watchlist-vessel-count').textContent = this.watchlistVessels.length;
    document.getElementById('watchlist-list-count').textContent = this.watchlistLists.length;
    document.getElementById('watchlist-last-sync').textContent =
      this.lastWatchlistSync
        ? this.lastWatchlistSync.toLocaleString('it-IT')
        : 'Mai';
  }

  useCurrentMapView() {
    if (this.mapController && this.mapController.map) {
      const center = this.mapController.map.getCenter();
      const zoom = Math.round(this.mapController.map.getZoom());

      document.getElementById('initial-lat').value = center.lat.toFixed(4);
      document.getElementById('initial-lon').value = center.lng.toFixed(4);
      document.getElementById('initial-zoom').value = zoom;
      document.getElementById('initial-zoom-value').textContent = zoom;

      this.showAlert('Vista corrente impostata come vista iniziale', 'success');
    }
  }

  showAlert(message, type) {
    const alertEl = document.getElementById('settings-alert');
    alertEl.className = `alert alert-${type}`;
    alertEl.textContent = message;

    setTimeout(() => {
      alertEl.classList.add('hidden');
    }, 5000);
  }

  updateSettingsStatus(text, type) {
    const indicator = document.getElementById('settings-status-indicator');
    const textEl = document.getElementById('settings-status-text');

    indicator.className = `status-indicator ${type}`;
    textEl.textContent = text;
  }

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.remove('collapsed');
    this.sidebarOpen = true;
  }

  centerOnOwnShip() {
    const tracks = this.trackManager.getAllTracks();

    const ownShipMmsi = this.trackManager.getOwnShipMmsi();
    const manualMmsi = this.config.ownShip?.mmsi;

    if (!ownShipMmsi && !manualMmsi) {
      this.showAlert('Nave non rilevata (nessun VDO ricevuto) e MMSI non configurato nelle Impostazioni.', 'warning');
      return;
    }

    const success = this.mapController.centerOnOwnShip(tracks);

    if (!success) {
      if (ownShipMmsi) {
        this.showAlert(`Nave VDO (MMSI: ${ownShipMmsi}) non trovata nelle tracce attive.`, 'warning');
      } else {
        this.showAlert(`Nave manuale (MMSI: ${manualMmsi}) non trovata nelle tracce attive.`, 'warning');
      }
    }
  }

  updateOwnShipStatus() {
    const statusEl = document.getElementById('own-ship-status');
    if (!statusEl) return;

    const indicator = statusEl.querySelector('.status-indicator');
    const textEl = statusEl.querySelector('.status-text');
    const manualMmsi = this.config.ownShip?.mmsi;

    const vdoMmsi = this.trackManager?.getOwnShipMmsi();

    if (vdoMmsi) {
      indicator.classList.add('configured');
      textEl.textContent = `MMSI: ${vdoMmsi} (auto-rilevato via VDO)`;
    } else if (manualMmsi) {
      indicator.classList.add('configured');
      textEl.textContent = `MMSI: ${manualMmsi} (configurato manualmente)`;
    } else {
      indicator.classList.remove('configured');
      textEl.textContent = 'Non configurato (inserisci MMSI o attendi rilevamento VDO)';
    }
  }

  openSettings() {
    document.getElementById('settings-modal').classList.remove('hidden');
    this.settingsOpen = true;
  }

  closeSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
    this.settingsOpen = false;
  }

  switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
  }

  connectDataSource() {
    const type = document.getElementById('connection-type').value;

    if (type === 'websocket') {
      const url = document.getElementById('ws-url').value;
      const endpoint = document.getElementById('ws-endpoint').value;
      const token = document.getElementById('ws-token')?.value || '';

      this.config.connection.type = 'websocket';
      this.config.connection.websocket.url = url;
      this.config.connection.websocket.endpoint = endpoint;
      this.config.connection.websocket.token = token;
      this.saveConfig();

      if (this.wsClient) {
        this.wsClient.disconnect();
      }
      this.initWebSocket();

      this.showAlert(`Connessione a ${url}${endpoint}...`, 'warning');
      console.log(`Connecting to WebSocket: ${url}${endpoint}`);
    } else if (type === 'tcp') {
      this.showAlert('Connessione TCP non ancora implementata', 'warning');
      console.log('TCP connection not yet implemented');
    }
  }

  async syncWatchlist() {
    const baseUrl = this.config.watchlist.baseUrl;
    const vesselsEndpoint = this.config.watchlist.vesselsEndpoint;
    const listsEndpoint = this.config.watchlist.listsEndpoint;
    const authType = this.config.watchlist.authType;
    const token = this.config.watchlist.token;

    if (!baseUrl) {
      this.showAlert('Configura prima il Base URL della watchlist', 'warning');
      return;
    }

    this.updateSettingsStatus('Sincronizzazione...', 'loading');

    try {
      const headers = {};
      if (authType === 'bearer' && token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else if (authType === 'apikey' && token) {
        headers['X-API-Key'] = token;
      }

      const vesselsResponse = await fetch(baseUrl + vesselsEndpoint, { headers });
      if (!vesselsResponse.ok) {
        throw new Error(`Vessels API: ${vesselsResponse.status}`);
      }
      this.watchlistVessels = await vesselsResponse.json();

      const listsResponse = await fetch(baseUrl + listsEndpoint, { headers });
      if (!listsResponse.ok) {
        throw new Error(`Lists API: ${listsResponse.status}`);
      }
      this.watchlistLists = await listsResponse.json();

      this.lastWatchlistSync = new Date();
      this.updateWatchlistStats();
      this.updateSettingsStatus('Sincronizzato', 'success');

      this.updateTrackManagerWithLocalWatchlist();

      this.updateWatchlistLegend();

      this.showAlert(`Sincronizzati ${this.watchlistVessels.length} mercantili e ${this.watchlistLists.length} liste`, 'success');

      console.log('Watchlist synced:', {
        vessels: this.watchlistVessels.length,
        lists: this.watchlistLists.length
      });
    } catch (error) {
      this.updateSettingsStatus('Errore sync', 'danger');
      this.showAlert(`Errore sincronizzazione: ${error.message}`, 'danger');
      console.error('Watchlist sync error:', error);
    }
  }

  getListsForVessel(mmsi, imo) {
    if (!this.watchlistVessels || !this.watchlistLists) {
      return [];
    }

    const matchingVessels = this.watchlistVessels.filter(v =>
      (mmsi && v.mmsi === mmsi) || (imo && v.imo === imo)
    );

    if (matchingVessels.length === 0) {
      return [];
    }

    const listIds = [...new Set(matchingVessels.map(v => v.list_id))];

    return this.watchlistLists
      .filter(list => listIds.includes(list.list_id))
      .map(list => ({
        list_id: list.list_id,
        list_name: list.list_name,
        color: list.color || '#ff0000'
      }));
  }

  showTrackPopup(feature) {
    const mmsi = feature.properties.mmsi;
    if (!mmsi) {
      console.warn('No MMSI in feature properties');
      return;
    }

    const trackData = this.trackManager.getTrack(mmsi);
    if (!trackData) {
      console.warn('Track not found for MMSI:', mmsi);
      return;
    }

    const popup = document.getElementById('track-popup');
    const content = document.getElementById('popup-content');

    const flagInfo = this.getFlagFromMMSI(trackData.mmsi);
    const flagHtml = flagInfo ? `<span class="fi fi-${flagInfo.code}" title="${flagInfo.country}"></span> ` : '';

    let html = '<dl>';
    html += `<dt>MMSI:</dt><dd>${flagHtml}${trackData.mmsi}</dd>`;
    if (trackData.imo) html += `<dt>IMO:</dt><dd>${trackData.imo}</dd>`;
    if (trackData.name) html += `<dt>Name:</dt><dd>${trackData.name}</dd>`;
    if (flagInfo) html += `<dt>Flag:</dt><dd>${flagHtml}${flagInfo.country}</dd>`;
    if (trackData.position) {
      const lat = Number(trackData.position.lat);
      const lon = Number(trackData.position.lon);
      const latDec = !isNaN(lat) ? lat.toFixed(6) : 'N/A';
      const lonDec = !isNaN(lon) ? lon.toFixed(6) : 'N/A';
      const latDMS = !isNaN(lat) ? this.decimalToDMS(lat, true) : 'N/A';
      const lonDMS = !isNaN(lon) ? this.decimalToDMS(lon, false) : 'N/A';
      html += `<dt>Pos. (Dec):</dt><dd>${latDec}°, ${lonDec}°</dd>`;
      html += `<dt>Pos. (DMS):</dt><dd>${latDMS}, ${lonDMS}</dd>`;
    }
    if (trackData.cog != null) html += `<dt>Course:</dt><dd>${trackData.cog.toFixed(1)}°</dd>`;
    if (trackData.sog != null) html += `<dt>Speed:</dt><dd>${trackData.sog.toFixed(1)} kts</dd>`;
    html += `<dt>Last Update:</dt><dd>${trackData.time_late_seconds || 0}s ago</dd>`;

    if (trackData.lists && trackData.lists.length > 0) {
      html += '<dt>Watchlists:</dt><dd>';
      trackData.lists.forEach(list => {
        html += `<span style="color: ${list.color}">● ${list.list_name}</span><br>`;
      });
      html += '</dd>';
    }

    html += '</dl>';

    html += '<div class="popup-actions">';
    html += `<button class="btn btn-small btn-danger" id="btn-delete-track" data-mmsi="${trackData.mmsi}">Elimina Traccia</button>`;
    html += '</div>';

    content.innerHTML = html;

    const deleteBtn = document.getElementById('btn-delete-track');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        this.deleteTrack(trackData.mmsi);
      });
    }

    popup.classList.remove('hidden');

    this.selectedTrack = trackData;
  }

  decimalToDMS(decimal, isLatitude) {
    if (decimal == null || isNaN(decimal)) {
      return 'N/A';
    }

    const absolute = Math.abs(decimal);
    const degrees = Math.floor(absolute);
    const minutesDecimal = (absolute - degrees) * 60;
    const minutes = Math.floor(minutesDecimal);
    const seconds = ((minutesDecimal - minutes) * 60).toFixed(2);

    let direction;
    if (isLatitude) {
      direction = decimal >= 0 ? 'N' : 'S';
    } else {
      direction = decimal >= 0 ? 'E' : 'W';
    }

    return `${degrees}°${minutes}'${seconds}"${direction}`;
  }

  getFlagFromMMSI(mmsi) {
    if (!mmsi || mmsi.length < 3) return null;

    const mid = mmsi.substring(0, 3);

    const midToCountry = {
      '201': { code: 'al', country: 'Albania' },
      '202': { code: 'ad', country: 'Andorra' },
      '203': { code: 'at', country: 'Austria' },
      '204': { code: 'pt', country: 'Azores' },
      '205': { code: 'be', country: 'Belgium' },
      '206': { code: 'by', country: 'Belarus' },
      '207': { code: 'bg', country: 'Bulgaria' },
      '208': { code: 'va', country: 'Vatican' },
      '209': { code: 'cy', country: 'Cyprus' },
      '210': { code: 'cy', country: 'Cyprus' },
      '211': { code: 'de', country: 'Germany' },
      '212': { code: 'cy', country: 'Cyprus' },
      '213': { code: 'ge', country: 'Georgia' },
      '214': { code: 'md', country: 'Moldova' },
      '215': { code: 'mt', country: 'Malta' },
      '216': { code: 'am', country: 'Armenia' },
      '218': { code: 'de', country: 'Germany' },
      '219': { code: 'dk', country: 'Denmark' },
      '220': { code: 'dk', country: 'Denmark' },
      '224': { code: 'es', country: 'Spain' },
      '225': { code: 'es', country: 'Spain' },
      '226': { code: 'fr', country: 'France' },
      '227': { code: 'fr', country: 'France' },
      '228': { code: 'fr', country: 'France' },
      '229': { code: 'mt', country: 'Malta' },
      '230': { code: 'fi', country: 'Finland' },
      '231': { code: 'fo', country: 'Faroe Islands' },
      '232': { code: 'gb', country: 'United Kingdom' },
      '233': { code: 'gb', country: 'United Kingdom' },
      '234': { code: 'gb', country: 'United Kingdom' },
      '235': { code: 'gb', country: 'United Kingdom' },
      '236': { code: 'gi', country: 'Gibraltar' },
      '237': { code: 'gr', country: 'Greece' },
      '238': { code: 'hr', country: 'Croatia' },
      '239': { code: 'gr', country: 'Greece' },
      '240': { code: 'gr', country: 'Greece' },
      '241': { code: 'gr', country: 'Greece' },
      '242': { code: 'ma', country: 'Morocco' },
      '243': { code: 'hu', country: 'Hungary' },
      '244': { code: 'nl', country: 'Netherlands' },
      '245': { code: 'nl', country: 'Netherlands' },
      '246': { code: 'nl', country: 'Netherlands' },
      '247': { code: 'it', country: 'Italy' },
      '248': { code: 'mt', country: 'Malta' },
      '249': { code: 'mt', country: 'Malta' },
      '250': { code: 'ie', country: 'Ireland' },
      '251': { code: 'is', country: 'Iceland' },
      '252': { code: 'li', country: 'Liechtenstein' },
      '253': { code: 'lu', country: 'Luxembourg' },
      '254': { code: 'mc', country: 'Monaco' },
      '255': { code: 'pt', country: 'Madeira' },
      '256': { code: 'mt', country: 'Malta' },
      '257': { code: 'no', country: 'Norway' },
      '258': { code: 'no', country: 'Norway' },
      '259': { code: 'no', country: 'Norway' },
      '261': { code: 'pl', country: 'Poland' },
      '262': { code: 'me', country: 'Montenegro' },
      '263': { code: 'pt', country: 'Portugal' },
      '264': { code: 'ro', country: 'Romania' },
      '265': { code: 'se', country: 'Sweden' },
      '266': { code: 'se', country: 'Sweden' },
      '267': { code: 'sk', country: 'Slovakia' },
      '268': { code: 'sm', country: 'San Marino' },
      '269': { code: 'ch', country: 'Switzerland' },
      '270': { code: 'cz', country: 'Czech Republic' },
      '271': { code: 'tr', country: 'Turkey' },
      '272': { code: 'ua', country: 'Ukraine' },
      '273': { code: 'ru', country: 'Russia' },
      '274': { code: 'mk', country: 'North Macedonia' },
      '275': { code: 'lv', country: 'Latvia' },
      '276': { code: 'ee', country: 'Estonia' },
      '277': { code: 'lt', country: 'Lithuania' },
      '278': { code: 'si', country: 'Slovenia' },
      '279': { code: 'rs', country: 'Serbia' },
      '301': { code: 'ai', country: 'Anguilla' },
      '303': { code: 'us', country: 'USA (Alaska)' },
      '304': { code: 'ag', country: 'Antigua and Barbuda' },
      '305': { code: 'ag', country: 'Antigua and Barbuda' },
      '306': { code: 'cw', country: 'Curaçao' },
      '307': { code: 'aw', country: 'Aruba' },
      '308': { code: 'bs', country: 'Bahamas' },
      '309': { code: 'bs', country: 'Bahamas' },
      '310': { code: 'bm', country: 'Bermuda' },
      '311': { code: 'bs', country: 'Bahamas' },
      '312': { code: 'bz', country: 'Belize' },
      '314': { code: 'bb', country: 'Barbados' },
      '316': { code: 'ca', country: 'Canada' },
      '319': { code: 'ky', country: 'Cayman Islands' },
      '321': { code: 'cr', country: 'Costa Rica' },
      '323': { code: 'cu', country: 'Cuba' },
      '325': { code: 'dm', country: 'Dominica' },
      '327': { code: 'do', country: 'Dominican Republic' },
      '329': { code: 'gp', country: 'Guadeloupe' },
      '330': { code: 'gd', country: 'Grenada' },
      '331': { code: 'gl', country: 'Greenland' },
      '332': { code: 'gt', country: 'Guatemala' },
      '334': { code: 'hn', country: 'Honduras' },
      '336': { code: 'ht', country: 'Haiti' },
      '338': { code: 'us', country: 'USA' },
      '339': { code: 'jm', country: 'Jamaica' },
      '341': { code: 'kn', country: 'Saint Kitts and Nevis' },
      '343': { code: 'lc', country: 'Saint Lucia' },
      '345': { code: 'mx', country: 'Mexico' },
      '347': { code: 'mq', country: 'Martinique' },
      '348': { code: 'ms', country: 'Montserrat' },
      '350': { code: 'ni', country: 'Nicaragua' },
      '351': { code: 'pa', country: 'Panama' },
      '352': { code: 'pa', country: 'Panama' },
      '353': { code: 'pa', country: 'Panama' },
      '354': { code: 'pa', country: 'Panama' },
      '355': { code: 'pa', country: 'Panama' },
      '356': { code: 'pa', country: 'Panama' },
      '357': { code: 'pa', country: 'Panama' },
      '358': { code: 'pr', country: 'Puerto Rico' },
      '359': { code: 'sv', country: 'El Salvador' },
      '361': { code: 'pm', country: 'Saint Pierre and Miquelon' },
      '362': { code: 'tt', country: 'Trinidad and Tobago' },
      '364': { code: 'tc', country: 'Turks and Caicos' },
      '366': { code: 'us', country: 'USA' },
      '367': { code: 'us', country: 'USA' },
      '368': { code: 'us', country: 'USA' },
      '369': { code: 'us', country: 'USA' },
      '370': { code: 'pa', country: 'Panama' },
      '371': { code: 'pa', country: 'Panama' },
      '372': { code: 'pa', country: 'Panama' },
      '373': { code: 'pa', country: 'Panama' },
      '374': { code: 'pa', country: 'Panama' },
      '375': { code: 'vc', country: 'Saint Vincent and Grenadines' },
      '376': { code: 'vc', country: 'Saint Vincent and Grenadines' },
      '377': { code: 'vc', country: 'Saint Vincent and Grenadines' },
      '378': { code: 'vg', country: 'British Virgin Islands' },
      '379': { code: 'vi', country: 'US Virgin Islands' },
      '401': { code: 'af', country: 'Afghanistan' },
      '403': { code: 'sa', country: 'Saudi Arabia' },
      '405': { code: 'bd', country: 'Bangladesh' },
      '408': { code: 'bh', country: 'Bahrain' },
      '410': { code: 'bt', country: 'Bhutan' },
      '412': { code: 'cn', country: 'China' },
      '413': { code: 'cn', country: 'China' },
      '414': { code: 'cn', country: 'China' },
      '416': { code: 'tw', country: 'Taiwan' },
      '417': { code: 'lk', country: 'Sri Lanka' },
      '419': { code: 'in', country: 'India' },
      '422': { code: 'ir', country: 'Iran' },
      '423': { code: 'az', country: 'Azerbaijan' },
      '425': { code: 'iq', country: 'Iraq' },
      '428': { code: 'il', country: 'Israel' },
      '431': { code: 'jp', country: 'Japan' },
      '432': { code: 'jp', country: 'Japan' },
      '434': { code: 'tm', country: 'Turkmenistan' },
      '436': { code: 'kz', country: 'Kazakhstan' },
      '437': { code: 'uz', country: 'Uzbekistan' },
      '438': { code: 'jo', country: 'Jordan' },
      '440': { code: 'kr', country: 'South Korea' },
      '441': { code: 'kr', country: 'South Korea' },
      '443': { code: 'ps', country: 'Palestine' },
      '445': { code: 'kp', country: 'North Korea' },
      '447': { code: 'kw', country: 'Kuwait' },
      '450': { code: 'lb', country: 'Lebanon' },
      '451': { code: 'kg', country: 'Kyrgyzstan' },
      '453': { code: 'mo', country: 'Macao' },
      '455': { code: 'mv', country: 'Maldives' },
      '457': { code: 'mn', country: 'Mongolia' },
      '459': { code: 'np', country: 'Nepal' },
      '461': { code: 'om', country: 'Oman' },
      '463': { code: 'pk', country: 'Pakistan' },
      '466': { code: 'qa', country: 'Qatar' },
      '468': { code: 'sy', country: 'Syria' },
      '470': { code: 'ae', country: 'United Arab Emirates' },
      '471': { code: 'ae', country: 'United Arab Emirates' },
      '472': { code: 'tj', country: 'Tajikistan' },
      '473': { code: 'ye', country: 'Yemen' },
      '475': { code: 'ye', country: 'Yemen' },
      '477': { code: 'hk', country: 'Hong Kong' },
      '478': { code: 'ba', country: 'Bosnia and Herzegovina' },
      '501': { code: 'fr', country: 'Adelie Land' },
      '503': { code: 'au', country: 'Australia' },
      '506': { code: 'mm', country: 'Myanmar' },
      '508': { code: 'bn', country: 'Brunei' },
      '510': { code: 'fm', country: 'Micronesia' },
      '511': { code: 'pw', country: 'Palau' },
      '512': { code: 'nz', country: 'New Zealand' },
      '514': { code: 'kh', country: 'Cambodia' },
      '515': { code: 'kh', country: 'Cambodia' },
      '516': { code: 'cx', country: 'Christmas Island' },
      '518': { code: 'ck', country: 'Cook Islands' },
      '520': { code: 'fj', country: 'Fiji' },
      '523': { code: 'cc', country: 'Cocos Islands' },
      '525': { code: 'id', country: 'Indonesia' },
      '529': { code: 'ki', country: 'Kiribati' },
      '531': { code: 'la', country: 'Laos' },
      '533': { code: 'my', country: 'Malaysia' },
      '536': { code: 'mp', country: 'Northern Mariana Islands' },
      '538': { code: 'mh', country: 'Marshall Islands' },
      '540': { code: 'nc', country: 'New Caledonia' },
      '542': { code: 'nu', country: 'Niue' },
      '544': { code: 'nr', country: 'Nauru' },
      '546': { code: 'pf', country: 'French Polynesia' },
      '548': { code: 'ph', country: 'Philippines' },
      '553': { code: 'pg', country: 'Papua New Guinea' },
      '555': { code: 'pn', country: 'Pitcairn Islands' },
      '557': { code: 'sb', country: 'Solomon Islands' },
      '559': { code: 'as', country: 'American Samoa' },
      '561': { code: 'ws', country: 'Samoa' },
      '563': { code: 'sg', country: 'Singapore' },
      '564': { code: 'sg', country: 'Singapore' },
      '565': { code: 'sg', country: 'Singapore' },
      '566': { code: 'sg', country: 'Singapore' },
      '567': { code: 'th', country: 'Thailand' },
      '570': { code: 'to', country: 'Tonga' },
      '572': { code: 'tv', country: 'Tuvalu' },
      '574': { code: 'vn', country: 'Vietnam' },
      '576': { code: 'vu', country: 'Vanuatu' },
      '577': { code: 'vu', country: 'Vanuatu' },
      '578': { code: 'wf', country: 'Wallis and Futuna' },
      '601': { code: 'za', country: 'South Africa' },
      '603': { code: 'ao', country: 'Angola' },
      '605': { code: 'dz', country: 'Algeria' },
      '607': { code: 'fr', country: 'Saint Paul and Amsterdam Islands' },
      '608': { code: 'io', country: 'British Indian Ocean Territory' },
      '609': { code: 'bi', country: 'Burundi' },
      '610': { code: 'bj', country: 'Benin' },
      '611': { code: 'bw', country: 'Botswana' },
      '612': { code: 'cf', country: 'Central African Republic' },
      '613': { code: 'cm', country: 'Cameroon' },
      '615': { code: 'cg', country: 'Congo' },
      '616': { code: 'km', country: 'Comoros' },
      '617': { code: 'cv', country: 'Cape Verde' },
      '618': { code: 'fr', country: 'Crozet Archipelago' },
      '619': { code: 'ci', country: 'Ivory Coast' },
      '620': { code: 'km', country: 'Comoros' },
      '621': { code: 'dj', country: 'Djibouti' },
      '622': { code: 'eg', country: 'Egypt' },
      '624': { code: 'et', country: 'Ethiopia' },
      '625': { code: 'er', country: 'Eritrea' },
      '626': { code: 'ga', country: 'Gabon' },
      '627': { code: 'gh', country: 'Ghana' },
      '629': { code: 'gm', country: 'Gambia' },
      '630': { code: 'gw', country: 'Guinea-Bissau' },
      '631': { code: 'gq', country: 'Equatorial Guinea' },
      '632': { code: 'gn', country: 'Guinea' },
      '633': { code: 'bf', country: 'Burkina Faso' },
      '634': { code: 'ke', country: 'Kenya' },
      '635': { code: 'fr', country: 'Kerguelen Islands' },
      '636': { code: 'lr', country: 'Liberia' },
      '637': { code: 'lr', country: 'Liberia' },
      '638': { code: 'ss', country: 'South Sudan' },
      '642': { code: 'ly', country: 'Libya' },
      '644': { code: 'ls', country: 'Lesotho' },
      '645': { code: 'mu', country: 'Mauritius' },
      '647': { code: 'mg', country: 'Madagascar' },
      '649': { code: 'ml', country: 'Mali' },
      '650': { code: 'mz', country: 'Mozambique' },
      '654': { code: 'mr', country: 'Mauritania' },
      '655': { code: 'mw', country: 'Malawi' },
      '656': { code: 'ne', country: 'Niger' },
      '657': { code: 'ng', country: 'Nigeria' },
      '659': { code: 'na', country: 'Namibia' },
      '660': { code: 're', country: 'Réunion' },
      '661': { code: 'rw', country: 'Rwanda' },
      '662': { code: 'sd', country: 'Sudan' },
      '663': { code: 'sn', country: 'Senegal' },
      '664': { code: 'sc', country: 'Seychelles' },
      '665': { code: 'sh', country: 'Saint Helena' },
      '666': { code: 'so', country: 'Somalia' },
      '667': { code: 'sl', country: 'Sierra Leone' },
      '668': { code: 'st', country: 'São Tomé and Príncipe' },
      '669': { code: 'sz', country: 'Eswatini' },
      '670': { code: 'td', country: 'Chad' },
      '671': { code: 'tg', country: 'Togo' },
      '672': { code: 'tn', country: 'Tunisia' },
      '674': { code: 'tz', country: 'Tanzania' },
      '675': { code: 'ug', country: 'Uganda' },
      '676': { code: 'cd', country: 'DR Congo' },
      '677': { code: 'tz', country: 'Tanzania' },
      '678': { code: 'zm', country: 'Zambia' },
      '679': { code: 'zw', country: 'Zimbabwe' },
      '701': { code: 'ar', country: 'Argentina' },
      '710': { code: 'br', country: 'Brazil' },
      '720': { code: 'bo', country: 'Bolivia' },
      '725': { code: 'cl', country: 'Chile' },
      '730': { code: 'co', country: 'Colombia' },
      '735': { code: 'ec', country: 'Ecuador' },
      '740': { code: 'fk', country: 'Falkland Islands' },
      '745': { code: 'gf', country: 'French Guiana' },
      '750': { code: 'gy', country: 'Guyana' },
      '755': { code: 'py', country: 'Paraguay' },
      '760': { code: 'pe', country: 'Peru' },
      '765': { code: 'sr', country: 'Suriname' },
      '770': { code: 'uy', country: 'Uruguay' },
      '775': { code: 've', country: 'Venezuela' },
    };

    return midToCountry[mid] || null;
  }

  hideTrackPopup() {
    document.getElementById('track-popup').classList.add('hidden');
    this.selectedTrack = null;
  }

  deleteTrack(mmsi) {
    const track = this.trackManager.getTrack(mmsi);
    if (!track) {
      console.warn('Track not found:', mmsi);
      return;
    }

    const trackName = track.name || `MMSI ${mmsi}`;
    const confirmed = confirm(`Sei sicuro di voler eliminare la traccia "${trackName}"?`);

    if (confirmed) {
      this.trackManager.removeTrack(mmsi);

      this.hideTrackPopup();

      console.log(`Track ${mmsi} deleted`);
    }
  }

  updateStatusBar() {
    const stats = this.trackManager.getStats();
    document.getElementById('status-tracks').textContent = stats.total;
    document.getElementById('status-watchlist').textContent = stats.watchlist;

    this.updateSidebarStats(stats);

    this.updateSidebarTrackList();
  }

  updateMouseCoordinates(lng, lat) {
    const decimalEl = document.getElementById('status-coords-decimal');
    const dmsEl = document.getElementById('status-coords-dms');

    if (!decimalEl || !dmsEl) return;

    const latSign = lat >= 0 ? 'N' : 'S';
    const lonSign = lng >= 0 ? 'E' : 'W';
    decimalEl.textContent = `${Math.abs(lat).toFixed(5)}°${latSign} ${Math.abs(lng).toFixed(5)}°${lonSign}`;

    const latDMS = this.decimalToDMSObject(Math.abs(lat));
    const lonDMS = this.decimalToDMSObject(Math.abs(lng));
    dmsEl.textContent = `${latDMS.d}°${latDMS.m}'${latDMS.s}"${latSign} ${lonDMS.d}°${lonDMS.m}'${lonDMS.s}"${lonSign}`;
  }

  decimalToDMSObject(decimal) {
    const d = Math.floor(decimal);
    const minFloat = (decimal - d) * 60;
    const m = Math.floor(minFloat);
    const s = ((minFloat - m) * 60).toFixed(1);
    return {
      d: d.toString().padStart(2, '0'),
      m: m.toString().padStart(2, '0'),
      s: parseFloat(s).toFixed(1).padStart(4, '0')
    };
  }

  updateSidebarStats(stats) {
    const totalEl = document.getElementById('sidebar-total-tracks');
    const watchlistEl = document.getElementById('sidebar-watchlist-tracks');
    const standardEl = document.getElementById('sidebar-standard-tracks');

    if (totalEl) totalEl.textContent = stats.total;
    if (watchlistEl) watchlistEl.textContent = stats.watchlist;
    if (standardEl) standardEl.textContent = stats.standard;
  }

  updateSidebarTrackList() {
    const now = Date.now();
    if (now - this.lastTrackListUpdate < this.trackListUpdateThrottle) {
      return; // Skip update to reduce flickering
    }
    this.lastTrackListUpdate = now;

    const container = document.getElementById('track-list-container');
    if (!container) return;

    const tracks = this.trackManager.getAllTracks();

    if (tracks.length === 0) {
      container.innerHTML = '<div class="empty-state">Nessuna traccia attiva</div>';
      return;
    }

    const sortedTracks = [...tracks].sort((a, b) => {
      if (a.symbol_type === 'watchlist' && b.symbol_type !== 'watchlist') return -1;
      if (a.symbol_type !== 'watchlist' && b.symbol_type === 'watchlist') return 1;
      return a.time_late_seconds - b.time_late_seconds;
    });

    const displayTracks = sortedTracks.slice(0, 50);

    const searchInput = document.getElementById('track-search');
    const currentSearch = searchInput ? searchInput.value.toLowerCase().trim() : '';

    container.innerHTML = displayTracks.map(track => {
      const isWatchlist = track.symbol_type === 'watchlist';
      const isStale = track.time_late_seconds > 120;
      const isMultiList = isWatchlist && track.lists?.length > 1;
      const iconClass = isWatchlist ? (isMultiList ? 'diamond bicolor' : 'diamond') : 'circle';

      let iconStyle = '';
      if (isWatchlist && track.lists?.length > 0) {
        if (isMultiList) {
          iconStyle = `--list-color-1: ${escapeHtml(track.lists[0].color)}; --list-color-2: ${escapeHtml(track.lists[1].color)}`;
        } else {
          iconStyle = `--list-color: ${escapeHtml(track.lists[0].color)}`;
        }
      }

      const mmsiStr = String(track.mmsi).toLowerCase();
      const nameStr = (track.name || '').toLowerCase();
      const imoStr = String(track.imo || '').toLowerCase();
      const callsignStr = (track.callsign || '').toLowerCase();
      const matchesSearch = !currentSearch ||
        mmsiStr.includes(currentSearch) ||
        nameStr.includes(currentSearch) ||
        imoStr.includes(currentSearch) ||
        callsignStr.includes(currentSearch);

      return `
        <div class="track-item track-list-item ${isWatchlist ? 'watchlist' : 'standard'}"
             data-mmsi="${escapeHtml(track.mmsi)}"
             data-track-data='${JSON.stringify(track).replace(/'/g, "&apos;")}'
             style="${matchesSearch ? '' : 'display: none;'}">
          <div class="track-icon ${iconClass}" style="${iconStyle}"></div>
          <div class="track-info">
            <div class="track-name">${escapeHtml(track.name || 'Unknown')}</div>
            <div class="track-mmsi">${escapeHtml(track.mmsi)}</div>
          </div>
          <div class="track-time ${isStale ? 'stale' : ''}">${track.time_late_seconds}s</div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.track-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const mmsi = item.dataset.mmsi;
        this.centerOnTrack(mmsi);
      });
    });
  }

  fitToAllTracks() {
    const tracks = this.trackManager.getAllTracks();
    if (tracks.length === 0) {
      this.showAlert('Nessuna traccia da visualizzare', 'warning');
      return;
    }

    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    tracks.forEach(track => {
      minLon = Math.min(minLon, track.position.lon);
      maxLon = Math.max(maxLon, track.position.lon);
      minLat = Math.min(minLat, track.position.lat);
      maxLat = Math.max(maxLat, track.position.lat);
    });

    if (this.mapController && this.mapController.map) {
      this.mapController.map.fitBounds(
        [[minLon, minLat], [maxLon, maxLat]],
        { padding: 50, duration: 1500 }
      );
    }
  }

  clearAllTracks() {
    if (this.trackManager) {
      this.trackManager.clear();
      this.showAlert('Tutte le tracce sono state rimosse', 'success');
    }
  }

  setLayerVisibility(layerId, visible) {
    if (this.mapController && this.mapController.map) {
      const map = this.mapController.map;
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    }
  }

  updateTimelateStyles() {
    if (!this.mapController || !this.mapController.map) return;

    const map = this.mapController.map;
    if (!map.getLayer('track-labels-layer')) return;

    const textColor = document.getElementById('timelate-color').value;
    const fontSize = parseInt(document.getElementById('timelate-font-size').value);
    const haloColor = document.getElementById('timelate-halo-color').value;
    const haloWidth = parseFloat(document.getElementById('timelate-halo-width').value);

    map.setPaintProperty('track-labels-layer', 'text-color', textColor);
    map.setPaintProperty('track-labels-layer', 'text-halo-color', haloColor);
    map.setPaintProperty('track-labels-layer', 'text-halo-width', haloWidth);

    map.setLayoutProperty('track-labels-layer', 'text-size', fontSize);
  }

  updateWatchlistLegend() {
    const container = document.getElementById('watchlist-legend');
    if (!container) return;

    if (!this.watchlistLists || this.watchlistLists.length === 0) {
      container.innerHTML = '<div class="empty-state">Nessuna lista caricata</div>';
      return;
    }

    const vesselCounts = {};
    if (this.watchlistVessels) {
      this.watchlistVessels.forEach(v => {
        const listId = v.list_id;
        vesselCounts[listId] = (vesselCounts[listId] || 0) + 1;
      });
    }

    const legendItems = this.watchlistLists.map(list => {
      const listId = list.list_id || list.id;
      const listName = list.list_name || list.name || 'Lista';
      const color = list.color || '#ff0000';
      const count = vesselCounts[listId] || 0;
      const numericListId = parseInt(listId);
      const isActive = this.activeListFilter === numericListId;

      return `
        <div class="watchlist-legend-item ${isActive ? 'active' : ''}" data-list-id="${escapeHtml(listId)}">
          <div class="legend-color" style="background-color: ${escapeHtml(color)}"></div>
          <span class="legend-name">${escapeHtml(listName)}</span>
          <span class="legend-count">${count}</span>
        </div>
      `;
    }).join('');

    const clearButton = this.activeListFilter !== null
      ? `<button class="btn btn-small btn-clear-filter" id="btn-clear-list-filter">
           Mostra Tutte
         </button>`
      : '';

    container.innerHTML = `
      <div class="legend-items-scroll">
        ${legendItems}
      </div>
      ${clearButton}
    `;

    container.querySelectorAll('.watchlist-legend-item').forEach(item => {
      item.addEventListener('click', () => {
        const listId = item.dataset.listId;
        this.toggleListFilter(listId);
      });
    });

    const clearBtn = container.querySelector('#btn-clear-list-filter');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearListFilter();
      });
    }
  }

  toggleListFilter(listId) {
    const numericListId = parseInt(listId);

    if (this.activeListFilter === numericListId) {
      this.clearListFilter();
      return;
    }

    this.activeListFilter = numericListId;
    console.log(`Filtering map by list ID: ${numericListId}`);

    if (this.mapController) {
      this.mapController.setListFilter(numericListId);
      const tracks = this.trackManager.getAllTracks();
      this.mapController.updateTracks(tracks);
    }

    this.updateWatchlistLegend();
  }

  clearListFilter() {
    this.activeListFilter = null;
    console.log('Filter cleared - showing all tracks on map');

    if (this.mapController) {
      this.mapController.setListFilter(null);
      const tracks = this.trackManager.getAllTracks();
      this.mapController.updateTracks(tracks);
    }

    this.updateWatchlistLegend();
  }

  updateSpeedLeaderStyles() {
    if (!this.mapController) return;

    const color = document.getElementById('speed-leader-color').value;
    const width = parseFloat(document.getElementById('speed-leader-width').value);

    this.mapController.setSpeedLeaderStyle(color, width);
  }

  updateStandardTrackStyles() {
    if (!this.mapController) return;

    const color = document.getElementById('standard-track-color').value;
    const strokeWidth = parseFloat(document.getElementById('standard-track-stroke-width').value);

    this.mapController.setStandardTrackStyle(color, strokeWidth);
  }

  updateMapBackgroundColor() {
    if (!this.mapController) return;

    const color = document.getElementById('map-background-color').value;
    this.mapController.setMapBackgroundColor(color);
  }

  updateConnectionStatus(text, type) {
    const elem = document.getElementById('status-source');
    elem.textContent = text;
    elem.className = `text-${type}`;
  }

  startFPSCounter() {
    setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.lastFpsUpdate) / 1000;
      this.fps = Math.round(this.frameCount / elapsed);
      this.frameCount = 0;
      this.lastFpsUpdate = now;

      document.getElementById('status-fps').textContent = this.fps;
    }, 1000);
  }

  startClock() {
    const updateClock = () => {
      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { hour12: false });
      document.getElementById('status-time').textContent = time;
    };

    updateClock();
    setInterval(updateClock, 1000);
  }

  loadConfig() {
    const defaultConfig = {
      connection: {
        type: 'websocket',
        websocket: {
          url: 'ws://localhost:8080',
          endpoint: '/ws/watchlist',
          token: ''
        },
        tcp: {
          host: 'localhost',
          port: 5000
        },
        autoReconnect: true,
        reconnectInterval: 5000,
        reconnectAttempts: 10
      },
      watchlist: {
        baseUrl: '',
        vesselsEndpoint: '/api/vessels',
        listsEndpoint: '/api/lists',
        authType: 'none',
        token: '',
        autoSync: true,
        syncInterval: 30
      },
      display: {
        showSpeedLeader: true,
        showLabels: true,
        showTrails: false,
        showCogLine: true,
        filterOwnShipOnly: false, // Show only tracks from local AIS receiver (AIVDO)
        warningThreshold: 120,
        removalThreshold: 180, // Deprecated - kept for compatibility
        standardTrackTimeout: 180, // Timeout in seconds for standard tracks
        watchlistTrackTimeout: 300, // Timeout in seconds for watchlist tracks
        symbolSize: 16,
        labelFontSize: 11
      },
      map: {
        basemap: 'osm',
        initialView: {
          lat: 41.9028,
          lon: 12.4964,
          zoom: 6
        }
      },
      audio: {
        enableNewTrackSound: true
      },
      timelate: {
        color: '#ffffff',
        fontSize: 11,
        haloColor: '#000000',
        haloWidth: 1.5
      },
      speedLeader: {
        color: '#00ff00',
        width: 2
      },
      standardTrack: {
        color: '#ffffff',
        strokeWidth: 2
      },
      mapBackground: {
        color: '#191a1a'
      },
      ownShip: {
        mmsi: '' // MMSI of user's own vessel
      },
      history: {
        enabled: false // Enable vessel position history recording
      }
    };

    try {
      const saved = localStorage.getItem('darkfleet-config');
      if (saved) {
        const parsed = JSON.parse(saved);
        return this.deepMerge(defaultConfig, parsed);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }

    return defaultConfig;
  }

  switchSidebarTab(tabName) {
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.panel === tabName);
    });
  }

  filterTrackList(query) {
    const searchTerm = query.toLowerCase().trim();
    const trackItems = document.querySelectorAll('.track-item');

    trackItems.forEach(item => {
      const mmsi = item.dataset.mmsi || '';
      const trackData = item.dataset.trackData;

      if (!trackData) {
        item.style.display = '';
        return;
      }

      try {
        const track = JSON.parse(trackData);
        const name = (track.name || '').toLowerCase();
        const imo = (track.imo || '').toLowerCase();
        const callsign = (track.callsign || '').toLowerCase();

        const matches = mmsi.includes(searchTerm) ||
                       name.includes(searchTerm) ||
                       imo.includes(searchTerm) ||
                       callsign.includes(searchTerm);

        item.style.display = matches ? '' : 'none';
      } catch (e) {
        item.style.display = '';
      }
    });
  }

  centerOnTrack(mmsi) {
    let track = this.trackManager.getTrack(mmsi);
    if (!track) {
      track = this.trackManager.getTrack(String(mmsi));
    }
    if (!track) {
      track = this.trackManager.getTrack(parseInt(mmsi));
    }

    if (track && track.position) {
      this.mapController.map.flyTo({
        center: [track.position.lon, track.position.lat],
        zoom: 12,
        duration: 1000
      });

      const feature = {
        properties: {
          mmsi: track.mmsi
        }
      };
      this.showTrackPopup(feature);
    } else {
      console.warn('Track not found for MMSI:', mmsi);
    }
  }

  deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  saveConfig() {
    try {
      localStorage.setItem('darkfleet-config', JSON.stringify(this.config));
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }


  hasElectronAPI() {
    return typeof window.electronAPI !== 'undefined' && window.electronAPI.db;
  }

  async restoreCustomLayers() {
    if (!this.hasElectronAPI()) {
      console.log('Electron API not available, skipping layer restore');
      return;
    }

    try {
      const layers = await window.electronAPI.db.layers.getAll();
      if (layers && layers.length > 0) {
        this.mapController.restoreAllLayers(layers);
        this.updateCustomLayersList();
        console.log(`Restored ${layers.length} custom layers from database`);
      }
    } catch (error) {
      console.error('Failed to restore custom layers:', error);
    }
  }

  async saveLayerToDatabase(layerId) {
    if (!this.hasElectronAPI()) return;

    try {
      const layerData = this.mapController.getLayerForPersistence(layerId);
      if (layerData) {
        await window.electronAPI.db.layers.save(layerData);
        console.log(`Layer saved to database: ${layerData.name}`);
      }
    } catch (error) {
      console.error('Failed to save layer to database:', error);
    }
  }

  async updateLayerStyleInDatabase(layerId, color, opacity) {
    if (!this.hasElectronAPI()) return;

    try {
      await window.electronAPI.db.layers.updateStyle(layerId, color, opacity);
    } catch (error) {
      console.error('Failed to update layer style in database:', error);
    }
  }

  async updateLayerLabelsInDatabase(layerId, labelConfig) {
    if (!this.hasElectronAPI()) return;

    try {
      const configStr = labelConfig ? JSON.stringify(labelConfig) : null;
      await window.electronAPI.db.layers.updateLabels(layerId, configStr);
    } catch (error) {
      console.error('Failed to update layer labels in database:', error);
    }
  }

  async updateLayerVisibilityInDatabase(layerId, visible) {
    if (!this.hasElectronAPI()) return;

    try {
      await window.electronAPI.db.layers.updateVisibility(layerId, visible);
    } catch (error) {
      console.error('Failed to update layer visibility in database:', error);
    }
  }

  async deleteLayerFromDatabase(layerId) {
    if (!this.hasElectronAPI()) return;

    try {
      await window.electronAPI.db.layers.delete(layerId);
      console.log(`Layer deleted from database: ${layerId}`);
    } catch (error) {
      console.error('Failed to delete layer from database:', error);
    }
  }

  async restoreGISData() {
    if (!this.hasElectronAPI()) {
      console.log('Electron API not available, skipping GIS data restore');
      return;
    }

    try {
      const zones = await window.electronAPI.db.zones.getAll();
      if (zones && zones.length > 0) {
        this.gisTools.restoreAllZones(zones);
        this.updateZonesList();
        console.log(`Restored ${zones.length} zones from database`);
      }

      const ranges = await window.electronAPI.db.ranges.getAll();
      if (ranges && ranges.length > 0) {
        this.gisTools.restoreAllRanges(ranges);
        this.updateRangesList();
        console.log(`Restored ${ranges.length} ranges from database`);
      }
    } catch (error) {
      console.error('Failed to restore GIS data:', error);
    }
  }

  async saveZoneToDatabase(zone) {
    if (!this.hasElectronAPI()) return;

    try {
      const zoneData = this.gisTools.getZoneForPersistence(zone.id);
      if (zoneData) {
        await window.electronAPI.db.zones.save(zoneData);
        console.log(`Zone saved to database: ${zone.name}`);
      }
    } catch (error) {
      console.error('Failed to save zone to database:', error);
    }
  }

  async updateZoneAlertsInDatabase(zoneId, alertOnEnter, alertOnExit) {
    if (!this.hasElectronAPI()) return;

    try {
      await window.electronAPI.db.zones.updateAlerts(zoneId, alertOnEnter, alertOnExit);
    } catch (error) {
      console.error('Failed to update zone alerts in database:', error);
    }
  }

  async deleteZoneFromDatabase(zoneId) {
    if (!this.hasElectronAPI()) return;

    try {
      await window.electronAPI.db.zones.delete(zoneId);
      console.log(`Zone deleted from database: ${zoneId}`);
    } catch (error) {
      console.error('Failed to delete zone from database:', error);
    }
  }

  async saveRangeToDatabase(range) {
    if (!this.hasElectronAPI()) return;

    try {
      const rangeData = this.gisTools.getRangeForPersistence(range.id);
      if (rangeData) {
        await window.electronAPI.db.ranges.save(rangeData);
        console.log(`Range saved to database: ${range.mmsi}`);
      }
    } catch (error) {
      console.error('Failed to save range to database:', error);
    }
  }

  async updateRangeAlertInDatabase(rangeId, alertEnabled) {
    if (!this.hasElectronAPI()) return;

    try {
      await window.electronAPI.db.ranges.updateAlert(rangeId, alertEnabled);
    } catch (error) {
      console.error('Failed to update range alert in database:', error);
    }
  }

  async deleteRangeFromDatabase(rangeId) {
    if (!this.hasElectronAPI()) return;

    try {
      await window.electronAPI.db.ranges.delete(rangeId);
      console.log(`Range deleted from database: ${rangeId}`);
    } catch (error) {
      console.error('Failed to delete range from database:', error);
    }
  }

  async getDatabaseStats() {
    if (!this.hasElectronAPI()) return null;

    try {
      return await window.electronAPI.db.getStats();
    } catch (error) {
      console.error('Failed to get database stats:', error);
      return null;
    }
  }
}


if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function initApp() {
  const app = new DarkFleetApp();
  app.init();

  window.darkfleetApp = app;
  window.app = app;  // Alias for NRT track buttons

  window.closeSettings = () => app.closeSettings();
}
