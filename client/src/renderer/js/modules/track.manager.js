export class TrackManager {
  constructor(options = {}) {
    this.tracks = new Map();
    this.updateCallbacks = [];
    this.newTrackCallbacks = [];
    this.imoReceivedCallbacks = [];
    this.removalTimers = new Map();

    this.standardTrackTimeout = options.standardTrackTimeout || 180;
    this.watchlistTrackTimeout = options.watchlistTrackTimeout || 180;

    this.watchlistVessels = [];
    this.watchlistLists = [];
    this.watchlistByMmsi = new Map();
    this.watchlistByImo = new Map();
    this.watchlistListsById = new Map();

    this.pendingUpdate = false;
    this.updateThrottleMs = 100;
    this.lastUpdateTime = 0;

    this.testMode = false;
    this.testList = {
      list_id: 1,
      list_name: 'Test List',
      color: '#ff0000'
    };

    this.startUpdateLoop();
  }

  setWatchlistData(vessels, lists) {
    this.watchlistVessels = vessels || [];
    this.watchlistLists = lists || [];

    this.watchlistByMmsi.clear();
    this.watchlistByImo.clear();
    this.watchlistListsById.clear();

    for (const vessel of this.watchlistVessels) {
      if (vessel.mmsi) {
        const mmsiNum = parseInt(vessel.mmsi);
        if (!isNaN(mmsiNum)) {
          if (!this.watchlistByMmsi.has(mmsiNum)) {
            this.watchlistByMmsi.set(mmsiNum, []);
          }
          this.watchlistByMmsi.get(mmsiNum).push(vessel);
        }
      }
      if (vessel.imo) {
        const imoNum = parseInt(vessel.imo);
        if (!isNaN(imoNum)) {
          if (!this.watchlistByImo.has(imoNum)) {
            this.watchlistByImo.set(imoNum, []);
          }
          this.watchlistByImo.get(imoNum).push(vessel);
        }
      }
    }

    for (const list of this.watchlistLists) {
      const listId = list.list_id || list.id;
      if (listId !== undefined) {
        this.watchlistListsById.set(String(listId), list);
      }
    }

    console.log(`📊 Watchlist data updated: ${this.watchlistVessels.length} vessels, ${this.watchlistLists.length} lists`);
    console.log(`   Indexed: ${this.watchlistByMmsi.size} unique MMSIs, ${this.watchlistByImo.size} unique IMOs`);
    if (this.watchlistVessels.length > 0) {
      console.log(`   Sample vessels:`, this.watchlistVessels.slice(0, 3).map(v => `MMSI:${v.mmsi} IMO:${v.imo}`));
    }
    if (this.watchlistLists.length > 0) {
      console.log(`   Lists:`, this.watchlistLists.map(l => `${l.list_name} (${l.color})`));
    }

    this.updateTracksWithWatchlistData();
  }

  updateTracksWithWatchlistData() {
    let updatedCount = 0;
    for (const track of this.tracks.values()) {
      const lists = this.getListsForVessel(track.mmsi, track.imo);
      if (lists.length > 0) {
        track.lists = lists;
        track.symbol_type = 'watchlist';
        updatedCount++;
        console.log(`🔄 Updated track ${track.mmsi} to watchlist type with ${lists.length} lists`);
      }
    }
    console.log(`🔄 Total tracks updated to watchlist: ${updatedCount}`);
    this.scheduleUpdate();
  }

  getListsForVessel(mmsi, imo) {
    if (this.testMode) {
      return [this.testList];
    }

    if (!this.watchlistVessels || !this.watchlistLists) {
      return [];
    }

    const mmsiNum = mmsi ? parseInt(mmsi) : null;
    const imoNum = imo ? parseInt(imo) : null;

    const matchingVessels = [];

    if (mmsiNum && !isNaN(mmsiNum) && this.watchlistByMmsi.has(mmsiNum)) {
      matchingVessels.push(...this.watchlistByMmsi.get(mmsiNum));
    }

    if (imoNum && !isNaN(imoNum) && this.watchlistByImo.has(imoNum)) {
      for (const vessel of this.watchlistByImo.get(imoNum)) {
        if (!matchingVessels.includes(vessel)) {
          matchingVessels.push(vessel);
        }
      }
    }

    if (matchingVessels.length === 0) {
      return [];
    }

    const seenListIds = new Set();
    const result = [];

    for (const vessel of matchingVessels) {
      const listIdStr = String(vessel.list_id);
      if (!seenListIds.has(listIdStr)) {
        seenListIds.add(listIdStr);
        const list = this.watchlistListsById.get(listIdStr);
        if (list) {
          result.push({
            list_id: list.list_id || list.id,
            list_name: list.list_name || list.name,
            color: list.color || '#ff0000'
          });
        }
      }
    }

    return result;
  }

  updateTrack(data) {
    if (!data || !data.mmsi) {
      console.warn('Track update received without MMSI:', data);
      return;
    }

    const mmsi = data.mmsi;
    const now = Date.now();

    const serverWatchlistMatch = data.watchlist;

    let position = null;

    if (data.position && data.position.lat && data.position.lon) {
      position = data.position;
    } else if (data.lat !== undefined && data.lon !== undefined) {
      position = { lat: data.lat, lon: data.lon };
    } else if (data.latitude !== undefined && data.longitude !== undefined) {
      position = { lat: data.latitude, lon: data.longitude };
    } else if (data.Latitude !== undefined && data.Longitude !== undefined) {
      position = { lat: data.Latitude, lon: data.Longitude };
    } else if (data.LAT !== undefined && data.LON !== undefined) {
      position = { lat: data.LAT, lon: data.LON };
    }

    const hasStaticData = data.name || data.imo || data.callsign || data.shiptype !== undefined;
    const existingTrack = this.tracks.get(mmsi);

    if (!position || !position.lat || !position.lon) {
      if (!existingTrack) {
        return;
      }
      this._mergeStaticData(existingTrack, data, now);
      return;
    }

    const sog = data.sog !== undefined ? data.sog : data.speed;
    const cog = data.cog !== undefined ? data.cog : data.course;

    let track = this.tracks.get(mmsi);
    const isNewTrack = !track;
    let imoJustReceived = false;
    const wasInWatchlist = track ? (track.lists && track.lists.length > 0) : false;

    if (!track) {
      track = {
        mmsi,
        imo: data.imo || null,
        name: data.name || null,
        callsign: data.callsign || null,
        shiptype: data.shiptype || null,
        position,
        cog: cog !== undefined ? cog : null,
        sog: sog !== undefined ? sog : null,
        heading: data.heading !== undefined ? data.heading : null,
        lists: [],
        symbol_type: 'standard',
        last_update: now,
        time_late_seconds: 0,
        blinking: false,
        highlighted: false,
        created_at: now,
        isNonRealtime: data.isNonRealtime || false,
        nrtId: data.nrtId || null,
        isOwnShip: data.isOwnShip || false,
      };

      if (data.isOwnShip) {
        console.log(`🚢 Own ship track created: ${track.name || mmsi}`);
      }

      this.tracks.set(mmsi, track);
    } else {
      track.position = position;

      if (cog !== undefined && cog !== null) {
        track.cog = cog;
      }
      if (sog !== undefined && sog !== null) {
        track.sog = sog;
      }
      if (data.heading !== undefined && data.heading !== null) {
        track.heading = data.heading;
      }
      if (data.name) {
        track.name = data.name;
      }
      if (data.callsign) {
        track.callsign = data.callsign;
      }
      if (data.shiptype !== undefined && data.shiptype !== null) {
        track.shiptype = data.shiptype;
      }

      if (data.imo && !track.imo) {
        imoJustReceived = true;
        track.highlighted = true;
      }
      if (data.imo) {
        track.imo = data.imo;
      }

      if (data.isNonRealtime !== undefined) {
        track.isNonRealtime = data.isNonRealtime;
      }
      if (data.nrtId !== undefined) {
        track.nrtId = data.nrtId;
      }

      if (data.isOwnShip && !track.isOwnShip) {
        track.isOwnShip = true;
        console.log(`🚢 Own ship detected via VDO: ${track.name || mmsi}`);
      }

      track.last_update = now;
      track.time_late_seconds = 0;
      track.blinking = false;
    }

    let lists = [];

    if (serverWatchlistMatch) {
      const localLists = this.getListsForVessel(mmsi, track.imo);
      if (localLists.length > 0) {
        lists = localLists;
      } else {
        lists = [{
          list_id: serverWatchlistMatch.list_id,
          list_name: serverWatchlistMatch.list_name || 'Watchlist',
          color: serverWatchlistMatch.color || '#ff0000'
        }];
      }
    } else {
      lists = this.getListsForVessel(mmsi, track.imo);
    }

    track.lists = lists;
    track.symbol_type = lists.length > 0 ? 'watchlist' : 'standard';

    this.resetRemovalTimer(mmsi);

    const isNowInWatchlist = track.lists.length > 0;
    const justBecameWatchlist = isNowInWatchlist && !wasInWatchlist;

    if (isNewTrack && isNowInWatchlist) {
      console.log(`🔔 New watchlist track: ${track.mmsi} (${track.name || 'Unknown'}) - Lists: ${track.lists.map(l => l.list_name).join(', ')}`);
      this.notifyNewTrack(track);
    } else if (!isNewTrack && justBecameWatchlist) {
      console.log(`🔔 Track became watchlist: ${track.mmsi} (${track.name || 'Unknown'}) - Lists: ${track.lists.map(l => l.list_name).join(', ')}`);
      this.notifyNewTrack(track);
    }

    if (imoJustReceived) {
      if (track.lists.length > 0) {
        console.log(`📋 IMO received for watchlist track: ${track.mmsi} - IMO: ${track.imo}`);
        this.notifyImoReceived(track);
      }
    }

    this.scheduleUpdate();
  }

  _mergeStaticData(track, data, now) {
    let imoJustReceived = false;

    if (data.name) {
      track.name = data.name;
    }
    if (data.callsign) {
      track.callsign = data.callsign;
    }
    if (data.shiptype !== undefined && data.shiptype !== null) {
      track.shiptype = data.shiptype;
    }

    if (data.imo && !track.imo) {
      imoJustReceived = true;
      track.highlighted = true;
    }
    if (data.imo) {
      track.imo = data.imo;
    }

    let lists = [];
    if (data.watchlist) {
      lists = [{
        list_id: data.watchlist.list_id,
        list_name: data.watchlist.list_name || 'Watchlist',
        color: data.watchlist.color || '#ff0000'
      }];
    } else {
      lists = this.getListsForVessel(track.mmsi, track.imo);
    }
    track.lists = lists;
    track.symbol_type = lists.length > 0 ? 'watchlist' : 'standard';

    if (imoJustReceived) {
      if (track.lists.length > 0) {
        console.log(`📋 IMO received for watchlist track: ${track.mmsi} - IMO: ${track.imo}`);
        this.notifyImoReceived(track);
      }
    }

    this.scheduleUpdate();
  }

  scheduleUpdate() {
    if (this.pendingUpdate) {
      return;
    }

    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;

    if (timeSinceLastUpdate >= this.updateThrottleMs) {
      this.doUpdate();
    } else {
      this.pendingUpdate = true;
      setTimeout(() => {
        this.doUpdate();
      }, this.updateThrottleMs - timeSinceLastUpdate);
    }
  }

  doUpdate() {
    this.pendingUpdate = false;
    this.lastUpdateTime = Date.now();
    this.notifyUpdate();
  }

  resetRemovalTimer(mmsi) {
    if (this.removalTimers.has(mmsi)) {
      clearTimeout(this.removalTimers.get(mmsi));
    }

    const track = this.tracks.get(mmsi);
    if (!track) {
      return;
    }

    const isWatchlist = track.symbol_type === 'watchlist' || (track.lists && track.lists.length > 0);
    const timeoutSeconds = isWatchlist ? this.watchlistTrackTimeout : this.standardTrackTimeout;
    const timeoutMs = timeoutSeconds * 1000;

    const timer = setTimeout(() => {
      this.removeTrack(mmsi);
    }, timeoutMs);

    this.removalTimers.set(mmsi, timer);
  }

  removeTrack(mmsi) {
    if (this.tracks.has(mmsi)) {
      this.tracks.delete(mmsi);

      if (this.removalTimers.has(mmsi)) {
        clearTimeout(this.removalTimers.get(mmsi));
        this.removalTimers.delete(mmsi);
      }

      this.scheduleUpdate();
    }
  }

  getTrack(mmsi) {
    return this.tracks.get(mmsi);
  }

  getAllTracks() {
    return Array.from(this.tracks.values());
  }

  getTrackCount() {
    return this.tracks.size;
  }

  getWatchlistCount() {
    let count = 0;
    for (const track of this.tracks.values()) {
      if (track.symbol_type === 'watchlist') {
        count++;
      }
    }
    return count;
  }

  getOwnShip() {
    for (const track of this.tracks.values()) {
      if (track.isOwnShip) {
        return track;
      }
    }
    return null;
  }

  getOwnShipMmsi() {
    const ownShip = this.getOwnShip();
    return ownShip ? ownShip.mmsi : null;
  }

  clearHighlight(mmsi) {
    const track = this.tracks.get(mmsi);
    if (track) {
      track.highlighted = false;
      this.scheduleUpdate();
    }
  }

  clearAllHighlights() {
    for (const track of this.tracks.values()) {
      track.highlighted = false;
    }
    this.scheduleUpdate();
  }

  startUpdateLoop() {
    setInterval(() => {
      const now = Date.now();
      let updated = false;

      for (const track of this.tracks.values()) {
        const elapsedMs = now - track.last_update;
        const elapsedSec = Math.floor(elapsedMs / 1000);

        if (track.time_late_seconds !== elapsedSec) {
          track.time_late_seconds = elapsedSec;
          updated = true;
        }

        const shouldBlink = elapsedSec > 120;
        if (track.blinking !== shouldBlink) {
          track.blinking = shouldBlink;
          updated = true;
        }
      }

      if (updated) {
        this.scheduleUpdate();
      }
    }, 10000);
  }

  onUpdate(callback) {
    this.updateCallbacks.push(callback);
  }

  onNewTrack(callback) {
    this.newTrackCallbacks.push(callback);
  }

  onImoReceived(callback) {
    this.imoReceivedCallbacks.push(callback);
  }

  notifyUpdate() {
    const tracks = this.getAllTracks();
    for (const callback of this.updateCallbacks) {
      try {
        callback(tracks);
      } catch (e) {
        console.error('Error in update callback:', e);
      }
    }
  }

  notifyNewTrack(track) {
    for (const callback of this.newTrackCallbacks) {
      try {
        callback(track);
      } catch (e) {
        console.error('Error in new track callback:', e);
      }
    }
  }

  notifyImoReceived(track) {
    for (const callback of this.imoReceivedCallbacks) {
      try {
        callback(track);
      } catch (e) {
        console.error('Error in IMO received callback:', e);
      }
    }
  }

  clear() {
    for (const timer of this.removalTimers.values()) {
      clearTimeout(timer);
    }
    this.removalTimers.clear();

    this.tracks.clear();

    this.scheduleUpdate();
  }

  setTestMode(enabled, color = '#ff0000') {
    this.testMode = enabled;
    this.testList.color = color;
    this.updateTracksWithWatchlistData();
  }

  getStats() {
    return {
      total: this.getTrackCount(),
      watchlist: this.getWatchlistCount(),
      standard: this.getTrackCount() - this.getWatchlistCount(),
    };
  }

  setRemovalTimeouts(standardTimeout, watchlistTimeout) {
    this.standardTrackTimeout = standardTimeout;
    this.watchlistTrackTimeout = watchlistTimeout;
    console.log(`⏱️ Track removal timeouts updated: Standard=${standardTimeout}s, Watchlist=${watchlistTimeout}s`);

    for (const mmsi of this.tracks.keys()) {
      this.resetRemovalTimer(mmsi);
    }
  }
}
