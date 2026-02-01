export class NonRealtimeTrackManager {
  constructor(trackManager, app) {
    this.trackManager = trackManager;
    this.app = app;

    this.tracks = new Map();

    this.updateInterval = 5000;
    this.updateTimer = null;

    this.lastUpdateTime = new Map();

    this.hasElectronAPI = this.checkElectronAPI();

    this.onTrackActivatedCallbacks = [];
  }

  checkElectronAPI() {
    const hasWindow = typeof window !== 'undefined';
    const hasElectronAPI = hasWindow && window.electronAPI;
    const hasDb = hasElectronAPI && window.electronAPI.db;
    const hasNrt = hasDb && window.electronAPI.db.nrt;

    console.log('checkElectronAPI:', { hasWindow, hasElectronAPI, hasDb, hasNrt });

    return hasNrt;
  }

  async initialize() {
    if (!this.hasElectronAPI) {
      console.warn('Electron API not available, NonRealtimeTrackManager disabled');
      return;
    }

    await this.loadTracks();

    this.startDeadReckoning();

    console.log('NonRealtimeTrackManager initialized');
  }

  async loadTracks() {
    if (!this.hasElectronAPI) return;

    try {
      const tracks = await window.electronAPI.db.nrt.getActive();

      for (const track of tracks) {
        this.tracks.set(track.id, track);
        this.lastUpdateTime.set(track.id, Date.now());

        this.addToTrackManager(track);
      }

      console.log(`Loaded ${tracks.length} non-realtime tracks`);
    } catch (error) {
      console.error('Failed to load non-realtime tracks:', error);
    }
  }

  addToTrackManager(track) {
    const trackData = {
      mmsi: track.mmsi,
      lat: track.lat,
      lon: track.lon,
      cog: track.cog,
      sog: track.sog,
      heading: track.heading,
      name: track.name,
      imo: track.imo,
      callsign: track.callsign,
      shiptype: track.shiptype,
      isNonRealtime: true,
      nrtId: track.id,
    };

    this.trackManager.updateTrack(trackData);
  }

  startDeadReckoning() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }

    this.updateTimer = setInterval(() => {
      this.updateAllPositions();
    }, this.updateInterval);
  }

  stopDeadReckoning() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  updateAllPositions() {
    const now = Date.now();

    for (const [id, track] of this.tracks) {
      if (track.isRealtime) continue;

      const lastTime = this.lastUpdateTime.get(id) || now;
      const deltaTime = (now - lastTime) / 1000;

      if (deltaTime < 1) continue;

      const newPosition = this.calculateNewPosition(
        track.lat,
        track.lon,
        track.cog,
        track.sog,
        deltaTime
      );

      track.lat = newPosition.lat;
      track.lon = newPosition.lon;
      this.lastUpdateTime.set(id, now);

      this.addToTrackManager(track);

      if (deltaTime > 30) {
        this.saveTrackPosition(id, newPosition.lat, newPosition.lon);
      }
    }
  }

  calculateNewPosition(lat, lon, cog, sog, deltaTimeSeconds) {
    const speedNmPerSecond = sog / 3600;
    const distanceNm = speedNmPerSecond * deltaTimeSeconds;

    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const cogRad = cog * Math.PI / 180;

    const R = 3440.065;

    const deltaLat = distanceNm * Math.cos(cogRad) / R;
    const newLatRad = latRad + deltaLat;

    const deltaLon = distanceNm * Math.sin(cogRad) / (R * Math.cos((latRad + newLatRad) / 2));
    const newLonRad = lonRad + deltaLon;

    return {
      lat: newLatRad * 180 / Math.PI,
      lon: newLonRad * 180 / Math.PI,
    };
  }

  async saveTrackPosition(id, lat, lon) {
    if (!this.hasElectronAPI) return;

    try {
      await window.electronAPI.db.nrt.updatePosition(id, lat, lon);
    } catch (error) {
      console.error('Failed to save track position:', error);
    }
  }

  async addTrack(trackData) {
    const apiAvailable = this.checkElectronAPI();
    console.log('addTrack called, hasElectronAPI:', this.hasElectronAPI, 'apiAvailable now:', apiAvailable);

    if (!apiAvailable) {
      console.error('Electron API not available for NRT');
      return null;
    }

    if (!this.hasElectronAPI && apiAvailable) {
      this.hasElectronAPI = true;
    }

    const id = `nrt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const track = {
      id,
      mmsi: trackData.mmsi,
      name: trackData.name || null,
      imo: trackData.imo || null,
      callsign: trackData.callsign || null,
      shiptype: trackData.shiptype || null,
      lat: trackData.lat,
      lon: trackData.lon,
      cog: trackData.cog || 0,
      sog: trackData.sog || 0,
      heading: trackData.heading || null,
      isRealtime: false,
      activatedAt: null,
      notes: trackData.notes || null,
    };

    try {
      console.log('Saving track to database:', track);
      await window.electronAPI.db.nrt.save(track);
      console.log('Track saved successfully');

      this.tracks.set(id, track);
      this.lastUpdateTime.set(id, Date.now());

      this.addToTrackManager(track);

      return track;
    } catch (error) {
      console.error('Failed to add non-realtime track:', error);
      console.error('Error details:', error.message, error.stack);
      return null;
    }
  }

  async updateTrackCourse(id, cog, sog) {
    if (!this.hasElectronAPI) return false;

    const track = this.tracks.get(id);
    if (!track) return false;

    try {
      await window.electronAPI.db.nrt.updateCourse(id, cog, sog);

      track.cog = cog;
      track.sog = sog;

      this.addToTrackManager(track);

      return true;
    } catch (error) {
      console.error('Failed to update track course:', error);
      return false;
    }
  }

  async updateTrackData(id, data) {
    if (!this.hasElectronAPI) return false;

    const track = this.tracks.get(id);
    if (!track) return false;

    try {
      await window.electronAPI.db.nrt.updateData(id, data);

      if (data.name !== undefined) track.name = data.name;
      if (data.imo !== undefined) track.imo = data.imo;
      if (data.callsign !== undefined) track.callsign = data.callsign;
      if (data.shiptype !== undefined) track.shiptype = data.shiptype;
      if (data.notes !== undefined) track.notes = data.notes;

      this.addToTrackManager(track);

      return true;
    } catch (error) {
      console.error('Failed to update track data:', error);
      return false;
    }
  }

  async updateTrackPosition(id, lat, lon) {
    if (!this.hasElectronAPI) return false;

    const track = this.tracks.get(id);
    if (!track) return false;

    try {
      await window.electronAPI.db.nrt.updatePosition(id, lat, lon);

      track.lat = lat;
      track.lon = lon;
      this.lastUpdateTime.set(id, Date.now());

      this.addToTrackManager(track);

      return true;
    } catch (error) {
      console.error('Failed to update track position:', error);
      return false;
    }
  }

  async deleteTrack(id) {
    if (!this.hasElectronAPI) return false;

    const track = this.tracks.get(id);
    if (!track) return false;

    try {
      await window.electronAPI.db.nrt.delete(id);

      this.tracks.delete(id);
      this.lastUpdateTime.delete(id);

      this.trackManager.removeTrack(track.mmsi);

      return true;
    } catch (error) {
      console.error('Failed to delete track:', error);
      return false;
    }
  }

  async duplicateTrack(id) {
    const track = this.tracks.get(id);
    if (!track) return null;

    const newTrack = await this.addTrack({
      mmsi: track.mmsi + '_copy',
      name: track.name ? `${track.name} (copia)` : null,
      imo: track.imo,
      callsign: track.callsign,
      shiptype: track.shiptype,
      lat: track.lat + 0.01,
      lon: track.lon + 0.01,
      cog: track.cog,
      sog: track.sog,
      heading: track.heading,
      notes: track.notes,
    });

    return newTrack;
  }

  async checkForActivation(mmsi) {
    if (!this.hasElectronAPI) return false;

    for (const [id, track] of this.tracks) {
      if (track.mmsi === mmsi && !track.isRealtime) {
        return await this.activateTrack(id);
      }
    }

    return false;
  }

  async activateTrack(id) {
    if (!this.hasElectronAPI) return false;

    const track = this.tracks.get(id);
    if (!track || track.isRealtime) return false;

    try {
      await window.electronAPI.db.nrt.activate(id);

      track.isRealtime = true;
      track.activatedAt = new Date().toISOString();

      const trackData = {
        mmsi: track.mmsi,
        isNonRealtime: false,
        nrtId: null,
      };
      this.trackManager.updateTrack(trackData);

      for (const callback of this.onTrackActivatedCallbacks) {
        try {
          callback(track);
        } catch (e) {
          console.error('Error in track activated callback:', e);
        }
      }

      console.log(`Non-realtime track activated: ${track.mmsi}`);
      return true;
    } catch (error) {
      console.error('Failed to activate track:', error);
      return false;
    }
  }

  onTrackActivated(callback) {
    this.onTrackActivatedCallbacks.push(callback);
  }

  getAllTracks() {
    return Array.from(this.tracks.values());
  }

  getActiveTracks() {
    return Array.from(this.tracks.values()).filter(t => !t.isRealtime);
  }

  getTrack(id) {
    return this.tracks.get(id);
  }

  getTrackByMmsi(mmsi) {
    for (const track of this.tracks.values()) {
      if (track.mmsi === mmsi) {
        return track;
      }
    }
    return null;
  }

  destroy() {
    this.stopDeadReckoning();
    this.tracks.clear();
    this.lastUpdateTime.clear();
    this.onTrackActivatedCallbacks = [];
  }
}
