const maplibregl = window.maplibregl;

export class MapController {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.isMapReady = false;
    this.config = {
      center: [12.4964, 41.9028],
      zoom: 6,
      minZoom: 2,
      maxZoom: 18,
    };

    this.customLayers = new Map();
    this.multiColorIconCache = new Map();
    this.onStyleReloadCallback = null;
    this.currentTracksData = null;
    this.previousLabelData = '';

    this.styleConfig = {
      standardTrack: {
        color: '#ffffff',
        strokeWidth: 2
      },
      speedLeader: {
        color: '#00ff00',
        width: 2
      },
      mapBackground: '#191a1a',
      ownShip: {
        color: '#00D4FF',
        strokeWidth: 3
      }
    };

    this.ownShipMmsi = null;
    this.standardTrackIconName = null;
    this.activeListFilter = null;
    this.hiddenShipTypes = new Set();
    this.filterOwnShipOnly = false;

    this.clusteringEnabled = true;
    this.clusterRadius = 50;
    this.clusterMaxZoom = 3;
  }

  setListFilter(listId) {
    this.activeListFilter = listId;
    console.log(`Map filter set to list: ${listId === null ? 'ALL' : listId}`);
  }

  passesListFilter(track) {
    if (this.activeListFilter === null) {
      return true;
    }

    if (!track.lists || track.lists.length === 0) {
      return false;
    }

    return track.lists.some(list => {
      const trackListId = parseInt(list.list_id || list.id);
      return trackListId === this.activeListFilter;
    });
  }

  setHiddenShipTypes(hiddenCategories) {
    this.hiddenShipTypes = hiddenCategories;
  }

  passesShipTypeFilter(track) {
    if (this.hiddenShipTypes.size === 0) {
      return true;
    }

    const categoryId = this.getShipTypeCategory(track.shiptype);
    return !this.hiddenShipTypes.has(categoryId);
  }

  setOwnShipOnlyFilter(enabled) {
    this.filterOwnShipOnly = enabled;
    console.log(`AIVDO-only filter ${enabled ? 'enabled' : 'disabled'}`);
  }

  passesOwnShipSourceFilter(track) {
    if (!this.filterOwnShipOnly) {
      return true;
    }

    return track.isOwnShip === true;
  }

  getShipTypeCategory(shiptype) {
    if (shiptype === null || shiptype === undefined) {
      return 'unknown';
    }

    if (shiptype === 30) return 'fishing';
    if (shiptype >= 31 && shiptype <= 32) return 'towing';
    if (shiptype === 33) return 'dredging';
    if (shiptype === 34) return 'diving';
    if (shiptype === 35) return 'military';
    if (shiptype === 36) return 'sailing';
    if (shiptype === 37) return 'pleasure';
    if (shiptype >= 40 && shiptype <= 49) return 'hsc';
    if (shiptype === 50) return 'pilot';
    if (shiptype === 51) return 'sar';
    if (shiptype === 52) return 'tug';
    if (shiptype === 53) return 'port';
    if (shiptype === 54) return 'antipollution';
    if (shiptype === 55) return 'lawenforcement';
    if (shiptype >= 56 && shiptype <= 57) return 'local';
    if (shiptype === 58) return 'medical';
    if (shiptype === 59) return 'noncombatant';
    if (shiptype >= 60 && shiptype <= 69) return 'passenger';
    if (shiptype >= 70 && shiptype <= 79) return 'cargo';
    if (shiptype >= 80 && shiptype <= 89) return 'tanker';
    if (shiptype >= 90 && shiptype <= 99) return 'other';

    return 'unknown';
  }

  initialize() {
    console.log('Initializing map...');

    this.map = new maplibregl.Map({
      container: this.containerId,
      style: this.getOSMStyle(),
      center: this.config.center,
      zoom: this.config.zoom,
      minZoom: this.config.minZoom,
      maxZoom: this.config.maxZoom,
    });

    this.map.addControl(new maplibregl.NavigationControl(), 'top-left');

    this.map.addControl(new maplibregl.ScaleControl({
      maxWidth: 100,
      unit: 'nautical',
    }), 'bottom-left');

    this.map.on('load', () => {
      console.log('Map loaded');
      this.onMapLoad();
      this.isMapReady = true;
    });

    this.map.on('error', (e) => {
      console.error('Map error:', e);
    });

    return this.map;
  }

  createDiamondIcon(colors, size = 28) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const centerX = size / 2;
    const centerY = size / 2;
    const halfSize = size / 2 - 2;

    const top = { x: centerX, y: centerY - halfSize };
    const right = { x: centerX + halfSize, y: centerY };
    const bottom = { x: centerX, y: centerY + halfSize };
    const left = { x: centerX - halfSize, y: centerY };

    if (colors.length === 1) {
      ctx.fillStyle = colors[0];
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(right.x, right.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.lineTo(left.x, left.y);
      ctx.closePath();
      ctx.fill();
    } else {
      const sliceWidth = (halfSize * 2) / colors.length;

      colors.forEach((color, index) => {
        ctx.save();

        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(right.x, right.y);
        ctx.lineTo(bottom.x, bottom.y);
        ctx.lineTo(left.x, left.y);
        ctx.closePath();
        ctx.clip();

        ctx.fillStyle = color;
        const sliceX = left.x + (index * sliceWidth);
        ctx.fillRect(sliceX, top.y, sliceWidth + 1, size);

        ctx.restore();
      });
    }

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(left.x, left.y);
    ctx.closePath();
    ctx.stroke();

    return canvas;
  }

  createStandardTrackIcon(size = 20, color = null, strokeWidth = null) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const centerX = size / 2;
    const centerY = size / 2;
    const actualStrokeWidth = strokeWidth || this.styleConfig.standardTrack.strokeWidth;
    const radius = size / 2 - actualStrokeWidth;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = color || this.styleConfig.standardTrack.color;
    ctx.lineWidth = actualStrokeWidth;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();

    return canvas;
  }

  createOwnShipIcon(size = 32, color = null) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const centerX = size / 2;
    const fillColor = color || this.styleConfig.ownShip.color;

    ctx.fillStyle = fillColor;
    ctx.beginPath();

    const tipY = size * 0.1;
    const baseY = size * 0.85;
    const notchY = size * 0.7;
    const halfWidth = size * 0.35;

    ctx.moveTo(centerX, tipY);
    ctx.lineTo(centerX + halfWidth, baseY);
    ctx.lineTo(centerX, notchY);
    ctx.lineTo(centerX - halfWidth, baseY);
    ctx.closePath();

    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    return canvas;
  }

  getOwnShipIconName(forceRegenerate = false) {
    const iconName = 'own-ship-icon';

    try {
      if (forceRegenerate && this.map.hasImage(iconName)) {
        this.map.removeImage(iconName);
      }

      if (!this.map.hasImage(iconName)) {
        const canvas = this.createOwnShipIcon(32);
        this.addImageFromCanvas(iconName, canvas);
      }
    } catch (e) {
      try {
        if (this.map.hasImage(iconName)) {
          this.map.removeImage(iconName);
        }
        const canvas = this.createOwnShipIcon(32);
        this.addImageFromCanvas(iconName, canvas);
      } catch (e2) {
      }
    }

    return iconName;
  }

  setOwnShipMmsi(mmsi) {
    this.ownShipMmsi = mmsi ? String(mmsi) : null;
    console.log(`🚢 Own ship MMSI set to: ${this.ownShipMmsi || 'none'}`);
  }

  isOwnShip(track) {
    if (track.isOwnShip === true) {
      return true;
    }
    if (this.ownShipMmsi && String(track.mmsi) === this.ownShipMmsi) {
      return true;
    }
    return false;
  }

  centerOnOwnShip(tracks, zoom = 12) {
    let ownShipTrack = tracks.find(t => t.isOwnShip === true);

    if (!ownShipTrack && this.ownShipMmsi) {
      ownShipTrack = tracks.find(t => String(t.mmsi) === this.ownShipMmsi);
    }

    if (ownShipTrack && ownShipTrack.position) {
      this.flyTo(ownShipTrack.position.lon, ownShipTrack.position.lat, zoom);
      console.log(`🎯 Centered on own ship: ${ownShipTrack.name || ownShipTrack.mmsi}`);
      return true;
    }

    console.warn('Own ship not found in tracks (no VDO detected and no manual MMSI configured)');
    return false;
  }

  createNrtIcon(size = 24, color = '#4a9eff') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const centerX = size / 2;
    const centerY = size / 2;
    const strokeWidth = 2;

    const outerRadius = size / 2 - strokeWidth;
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.arc(centerX, centerY, outerRadius, 0, 2 * Math.PI);
    ctx.stroke();

    const innerRadius = outerRadius / 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
    ctx.stroke();

    return canvas;
  }

  getNrtIconName(color = '#4a9eff') {
    const iconName = `nrt-track-icon-${color.replace('#', '')}`;

    try {
      if (!this.map.hasImage(iconName)) {
        const canvas = this.createNrtIcon(24, color);
        this.addImageFromCanvas(iconName, canvas);
      }
    } catch (e) {
      try {
        if (this.map.hasImage(iconName)) {
          this.map.removeImage(iconName);
        }
        const canvas = this.createNrtIcon(24, color);
        this.addImageFromCanvas(iconName, canvas);
      } catch (e2) {
      }
    }

    return iconName;
  }

  addImageFromCanvas(iconName, canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    this.map.addImage(iconName, {
      width: canvas.width,
      height: canvas.height,
      data: imageData.data
    });
  }

  getDiamondIconName(colors) {
    const colorKey = colors.join('-');
    const iconName = `diamond-icon-${colorKey}`;

    try {
      if (!this.map.hasImage(iconName)) {
        const canvas = this.createDiamondIcon(colors, 28);
        this.addImageFromCanvas(iconName, canvas);
      }
    } catch (e) {
      try {
        if (this.map.hasImage(iconName)) {
          this.map.removeImage(iconName);
        }
        const canvas = this.createDiamondIcon(colors, 28);
        this.addImageFromCanvas(iconName, canvas);
      } catch (e2) {
      }
    }

    return iconName;
  }

  getStandardTrackIconName(forceRegenerate = false) {
    const iconName = 'standard-track-icon';

    try {
      if (forceRegenerate && this.map.hasImage(iconName)) {
        this.map.removeImage(iconName);
      }

      if (!this.map.hasImage(iconName)) {
        const canvas = this.createStandardTrackIcon(20);
        this.addImageFromCanvas(iconName, canvas);
      }
    } catch (e) {
      try {
        if (this.map.hasImage(iconName)) {
          this.map.removeImage(iconName);
        }
        const canvas = this.createStandardTrackIcon(20);
        this.addImageFromCanvas(iconName, canvas);
      } catch (e2) {
      }
    }

    return iconName;
  }

  setStandardTrackStyle(color, strokeWidth) {
    this.styleConfig.standardTrack.color = color;
    this.styleConfig.standardTrack.strokeWidth = strokeWidth;

    this.getStandardTrackIconName(true);

    if (this.map) {
      this.map.triggerRepaint();
    }
  }

  setSpeedLeaderStyle(color, width) {
    this.styleConfig.speedLeader.color = color;
    this.styleConfig.speedLeader.width = width;

    if (this.map && this.map.getLayer('speed-leaders-layer')) {
      this.map.setPaintProperty('speed-leaders-layer', 'line-color', color);
      this.map.setPaintProperty('speed-leaders-layer', 'line-width', width);
    }
  }

  setMapBackgroundColor(color) {
    this.styleConfig.mapBackground = color;

    if (this.map) {
      if (this.map.getLayer('background')) {
        this.map.setPaintProperty('background', 'background-color', color);
      } else {
        const canvas = this.map.getCanvas();
        if (canvas) {
          canvas.style.backgroundColor = color;
        }
      }
    }
  }

  onMapLoad() {
    try {
      const standardCanvas = this.createStandardTrackIcon(20);
      this.addImageFromCanvas('standard-track-icon', standardCanvas);
    } catch (e) {
      console.warn('Failed to pre-create standard track icon:', e);
    }

    if (!this.map.getSource('ais-tracks')) {
      this.map.addSource('ais-tracks', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
        cluster: this.clusteringEnabled,
        clusterRadius: this.clusterRadius,
        clusterMaxZoom: this.clusterMaxZoom,
        clusterProperties: {
          sum: ['+', 1],
        },
      });
    }

    if (!this.map.getSource('speed-leaders')) {
      this.map.addSource('speed-leaders', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    if (!this.map.getSource('multi-list-tracks')) {
      this.map.addSource('multi-list-tracks', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    if (!this.map.getSource('track-labels')) {
      this.map.addSource('track-labels', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    if (!this.map.getSource('nrt-tracks')) {
      this.map.addSource('nrt-tracks', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    if (!this.map.getSource('own-ship')) {
      this.map.addSource('own-ship', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
    }

    if (!this.map.getLayer('clusters-layer')) {
      this.map.addLayer({
        id: 'clusters-layer',
        type: 'circle',
        source: 'ais-tracks',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#51bbd6',
            100,
            '#f1f075',
            750,
            '#f28cb1'
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            18,
            100,
            25,
            750,
            35
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    if (!this.map.getLayer('cluster-count-layer')) {
      this.map.addLayer({
        id: 'cluster-count-layer',
        type: 'symbol',
        source: 'ais-tracks',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 14,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#000000',
        },
      });
    }

    if (!this.map.getLayer('tracks-layer')) {
      this.map.addLayer({
        id: 'tracks-layer',
        type: 'symbol',
        source: 'ais-tracks',
        filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': ['get', 'iconName'],
          'icon-size': ['get', 'iconSize'],
          'icon-allow-overlap': true,
        },
      });
    }

    if (!this.map.getLayer('multi-list-layer')) {
      this.map.addLayer({
        id: 'multi-list-layer',
        type: 'symbol',
        source: 'multi-list-tracks',
        layout: {
          'icon-image': ['get', 'iconName'],
          'icon-size': ['get', 'iconSize'],
          'icon-allow-overlap': true,
        },
      });
    }

    if (!this.map.getLayer('nrt-tracks-layer')) {
      this.map.addLayer({
        id: 'nrt-tracks-layer',
        type: 'symbol',
        source: 'nrt-tracks',
        layout: {
          'icon-image': ['get', 'iconName'],
          'icon-size': ['get', 'iconSize'],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }

    if (!this.map.getLayer('speed-leaders-layer')) {
      this.map.addLayer({
        id: 'speed-leaders-layer',
        type: 'line',
        source: 'speed-leaders',
        paint: {
          'line-color': ['get', 'lineColor'],
          'line-width': ['get', 'lineWidth'],
          'line-opacity': 1,
        },
      });
    }

    if (!this.map.getLayer('track-labels-layer')) {
      this.map.addLayer({
        id: 'track-labels-layer',
        type: 'symbol',
        source: 'track-labels',
        minzoom: this.clusterMaxZoom,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-offset': [0, 1.5],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        },
      });
    }

    if (!this.map.getLayer('own-ship-layer')) {
      this.map.addLayer({
        id: 'own-ship-layer',
        type: 'symbol',
        source: 'own-ship',
        layout: {
          'icon-image': ['get', 'iconName'],
          'icon-size': ['get', 'iconSize'],
          'icon-rotate': ['get', 'rotation'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }

    this.map.on('click', 'clusters-layer', (e) => {
      const features = this.map.queryRenderedFeatures(e.point, {
        layers: ['clusters-layer']
      });
      if (!features.length) return;

      const clusterId = features[0].properties.cluster_id;
      const source = this.map.getSource('ais-tracks');

      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;

        this.map.easeTo({
          center: features[0].geometry.coordinates,
          zoom: zoom + 1,
          duration: 500,
        });
      });
    });

    this.map.on('mouseenter', 'clusters-layer', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', 'clusters-layer', () => {
      this.map.getCanvas().style.cursor = '';
    });

    this.map.on('click', 'tracks-layer', (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        this.onTrackClick(feature);
      }
    });

    this.map.on('click', 'multi-list-layer', (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        this.onTrackClick(feature);
      }
    });

    this.map.on('mouseenter', 'tracks-layer', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', 'tracks-layer', () => {
      this.map.getCanvas().style.cursor = '';
    });

    this.map.on('mouseenter', 'multi-list-layer', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', 'multi-list-layer', () => {
      this.map.getCanvas().style.cursor = '';
    });

    this.map.on('click', 'nrt-tracks-layer', (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        this.onTrackClick(feature);
      }
    });

    this.map.on('mouseenter', 'nrt-tracks-layer', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', 'nrt-tracks-layer', () => {
      this.map.getCanvas().style.cursor = '';
    });

    this.map.on('click', 'own-ship-layer', (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        this.onTrackClick(feature);
      }
    });

    this.map.on('mouseenter', 'own-ship-layer', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', 'own-ship-layer', () => {
      this.map.getCanvas().style.cursor = '';
    });

    this.map.on('mousemove', (e) => {
      this.onMouseMove(e.lngLat.lng, e.lngLat.lat);
    });

    console.log('Map layers added');
  }

  onMouseMove(/* lng, lat */) {
  }

  onTrackClick(/* feature */) {
  }

  isInViewport(lon, lat, bounds, margin = 0.5) {
    if (!bounds) return true;

    return lon >= bounds.getWest() - margin &&
           lon <= bounds.getEast() + margin &&
           lat >= bounds.getSouth() - margin &&
           lat <= bounds.getNorth() + margin;
  }

  setClusteringEnabled(enabled) {
    this.clusteringEnabled = enabled;
    console.log(`Clustering ${enabled ? 'enabled' : 'disabled'}`);
  }

  updateTracks(tracks) {
    this.currentTracksData = tracks;

    if (!this.map || !this.isMapReady || !this.map.getSource('ais-tracks')) {
      return;
    }

    const bounds = this.map.getBounds();
    const zoom = this.map.getZoom();

    const margin = zoom < 5 ? 2.0 : zoom < 10 ? 1.0 : 0.5;

    const standardTrackFeatures = [];
    const watchlistTrackFeatures = [];
    const nrtTrackFeatures = [];
    const ownShipFeatures = [];
    const labelFeatures = [];

    let culledCount = 0;

    const shouldCull = zoom > this.clusterMaxZoom;

    const isClusteringActive = zoom <= this.clusterMaxZoom;

    tracks.forEach(track => {
      if (!this.passesListFilter(track)) {
        return;
      }

      if (!this.passesShipTypeFilter(track)) {
        return;
      }

      if (!this.passesOwnShipSourceFilter(track)) {
        return;
      }

      const isWatchlist = track.symbol_type === 'watchlist' && track.lists && track.lists.length > 0;
      if (shouldCull && !isWatchlist && !this.isInViewport(track.position.lon, track.position.lat, bounds, margin)) {
        culledCount++;
        return;
      }

      const isNonRealtime = track.isNonRealtime === true;
      const isOwnShip = this.isOwnShip(track);
      const isInWatchlist = !isNonRealtime && !isOwnShip && track.symbol_type === 'watchlist' && track.lists && track.lists.length > 0;
      const listColors = isInWatchlist
        ? track.lists.map(l => l.color || '#ff0000')
        : [];

      const baseProperties = {
        mmsi: track.mmsi,
        name: track.name || 'Unknown',
      };

      if (!isClusteringActive || isInWatchlist || isNonRealtime || isOwnShip) {
        const timeLateLabel = isNonRealtime ? `NRT ${track.mmsi}` :
                             isOwnShip ? `OWN SHIP` :
                             `${track.time_late_seconds || 0}s`;
        labelFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [track.position.lon, track.position.lat],
          },
          properties: {
            label: timeLateLabel,
          },
        });
      }

      if (isOwnShip) {
        const iconName = this.getOwnShipIconName();
        const rotation = track.heading !== null && track.heading !== undefined
          ? track.heading
          : (track.cog !== null && track.cog !== undefined ? track.cog : 0);

        ownShipFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [track.position.lon, track.position.lat],
          },
          properties: {
            ...baseProperties,
            iconName,
            iconSize: 1.0,
            rotation,
          },
        });
      } else if (isNonRealtime) {
        const iconName = this.getNrtIconName();
        nrtTrackFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [track.position.lon, track.position.lat],
          },
          properties: {
            ...baseProperties,
            iconName,
            iconSize: track.highlighted ? 1.3 : 1.0,
          },
        });
      } else if (isInWatchlist) {
        const iconName = this.getDiamondIconName(listColors);
        watchlistTrackFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [track.position.lon, track.position.lat],
          },
          properties: {
            ...baseProperties,
            iconName,
            iconSize: track.highlighted ? 1.3 : 1.0,
          },
        });
      } else {
        const iconName = this.getStandardTrackIconName();
        standardTrackFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [track.position.lon, track.position.lat],
          },
          properties: {
            ...baseProperties,
            iconName,
            iconSize: track.highlighted ? 1.3 : 1.0,
          },
        });
      }
    });

    const totalRendered = standardTrackFeatures.length + watchlistTrackFeatures.length + nrtTrackFeatures.length + ownShipFeatures.length;
    if (culledCount > 0 && Math.random() < 0.01) {
      console.log(`🗺️ Viewport culling: ${totalRendered} rendered, ${culledCount} culled (${tracks.length} total)`);
    }

    this.map.getSource('ais-tracks').setData({
      type: 'FeatureCollection',
      features: standardTrackFeatures,
    });

    if (!this.map.getSource('multi-list-tracks')) {
      this.map.addSource('multi-list-tracks', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: watchlistTrackFeatures,
        },
      });
    } else {
      this.map.getSource('multi-list-tracks').setData({
        type: 'FeatureCollection',
        features: watchlistTrackFeatures,
      });
    }

    if (this.map.getSource('nrt-tracks')) {
      this.map.getSource('nrt-tracks').setData({
        type: 'FeatureCollection',
        features: nrtTrackFeatures,
      });
    }

    if (this.map.getSource('own-ship')) {
      this.map.getSource('own-ship').setData({
        type: 'FeatureCollection',
        features: ownShipFeatures,
      });
    }

    if (this.map.getSource('track-labels')) {
      this.map.getSource('track-labels').setData({
        type: 'FeatureCollection',
        features: labelFeatures,
      });
    }

    this.updateSpeedLeaders(tracks, isClusteringActive, bounds, margin);
  }

  updateSpeedLeaders(tracks, isClusteringActive = false, bounds = null, margin = 0.5) {
    if (!this.map || !this.isMapReady || !this.map.getSource('speed-leaders')) {
      return;
    }

    const features = [];

    for (const track of tracks) {
      if (track.cog === undefined || track.sog === undefined) {
        continue;
      }

      const isWatchlist = track.symbol_type === 'watchlist' && track.lists && track.lists.length > 0;
      const isOwnShip = this.isOwnShip(track);
      if (isClusteringActive && !isWatchlist && !isOwnShip) {
        continue;
      }

      if (bounds && !isWatchlist && !isOwnShip && !this.isInViewport(track.position.lon, track.position.lat, bounds, margin)) {
        continue;
      }

      const lengthDegrees = track.sog * 0.001;
      const courseRadians = (track.cog * Math.PI) / 180;

      const endLon = track.position.lon + lengthDegrees * Math.sin(courseRadians);
      const endLat = track.position.lat + lengthDegrees * Math.cos(courseRadians);

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [track.position.lon, track.position.lat],
            [endLon, endLat],
          ],
        },
        properties: {
          mmsi: track.mmsi,
          lineColor: isOwnShip ? this.styleConfig.ownShip.color : '#ffffff',
          lineWidth: isOwnShip ? 4 : (isWatchlist ? 3 : 2),
        },
      });
    }

    this.map.getSource('speed-leaders').setData({
      type: 'FeatureCollection',
      features,
    });
  }

  async loadGeoJSONFile(file, options = {}) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const geojson = JSON.parse(e.target.result);
          const layerId = this.addGeoJSONLayer(geojson, {
            name: options.name || file.name.replace('.geojson', '').replace('.json', ''),
            ...options
          });
          resolve(layerId);
        } catch (error) {
          reject(new Error(`Failed to parse GeoJSON: ${error.message}`));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  addGeoJSONLayer(geojson, options = {}) {
    const layerId = options.id || `custom-layer-${Date.now()}`;
    const sourceId = `${layerId}-source`;
    const name = options.name || layerId;

    const geometryType = this.detectGeometryType(geojson);

    this.map.addSource(sourceId, {
      type: 'geojson',
      data: geojson
    });

    const layers = [];
    const color = options.color || '#3388ff';
    const opacity = options.opacity !== undefined ? options.opacity : 0.6;

    const beforeLayerId = this.map.getLayer('clusters-layer') ? 'clusters-layer' :
                          this.map.getLayer('tracks-layer') ? 'tracks-layer' : undefined;

    if (geometryType === 'Point' || geometryType === 'MultiPoint') {
      const pointLayerId = `${layerId}-points`;
      this.map.addLayer({
        id: pointLayerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': options.radius || 6,
          'circle-color': color,
          'circle-opacity': opacity,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff'
        }
      }, beforeLayerId);
      layers.push(pointLayerId);
    }

    if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
      const lineLayerId = `${layerId}-lines`;
      this.map.addLayer({
        id: lineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': color,
          'line-width': options.lineWidth || 2,
          'line-opacity': opacity
        }
      }, beforeLayerId);
      layers.push(lineLayerId);
    }

    if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
      const fillLayerId = `${layerId}-fill`;
      this.map.addLayer({
        id: fillLayerId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': color,
          'fill-opacity': opacity * 0.5
        }
      }, beforeLayerId);
      layers.push(fillLayerId);

      const outlineLayerId = `${layerId}-outline`;
      this.map.addLayer({
        id: outlineLayerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': color,
          'line-width': 2,
          'line-opacity': opacity
        }
      }, beforeLayerId);
      layers.push(outlineLayerId);
    }

    const properties = this.extractGeoJSONProperties(geojson);

    this.customLayers.set(layerId, {
      sourceId,
      layers,
      name,
      visible: true,
      geojson,
      options,
      properties,
      labelConfig: null,
      labelLayerId: null
    });

    console.log(`Layer added: ${name} (${geometryType})`);
    return layerId;
  }

  detectGeometryType(geojson) {
    if (geojson.type === 'Feature') {
      return geojson.geometry?.type;
    }
    if (geojson.type === 'FeatureCollection' && geojson.features?.length > 0) {
      return geojson.features[0].geometry?.type;
    }
    if (geojson.type === 'GeometryCollection' && geojson.geometries?.length > 0) {
      return geojson.geometries[0].type;
    }
    return geojson.type;
  }

  extractGeoJSONProperties(geojson) {
    const properties = new Set();

    const extractFromFeature = (feature) => {
      if (feature.properties) {
        Object.keys(feature.properties).forEach(key => properties.add(key));
      }
    };

    if (geojson.type === 'Feature') {
      extractFromFeature(geojson);
    } else if (geojson.type === 'FeatureCollection' && geojson.features) {
      geojson.features.slice(0, 10).forEach(extractFromFeature);
    }

    return Array.from(properties).sort();
  }

  async loadShapefile(shpFile, dbfFile = null, options = {}) {
    if (typeof window.shapefile === 'undefined') {
      throw new Error('Shapefile library not loaded. Include shapefile.js in your project.');
    }

    try {
      const shpBuffer = await shpFile.arrayBuffer();
      const dbfBuffer = dbfFile ? await dbfFile.arrayBuffer() : null;

      const geojson = await window.shapefile.read(shpBuffer, dbfBuffer);

      const layerId = this.addGeoJSONLayer(geojson, {
        name: options.name || shpFile.name.replace('.shp', ''),
        ...options
      });

      return layerId;
    } catch (error) {
      throw new Error(`Failed to parse Shapefile: ${error.message}`);
    }
  }

  removeCustomLayer(layerId) {
    const layerInfo = this.customLayers.get(layerId);
    if (!layerInfo) {
      console.warn(`Layer not found: ${layerId}`);
      return;
    }

    for (const lid of layerInfo.layers) {
      if (this.map.getLayer(lid)) {
        this.map.removeLayer(lid);
      }
    }

    if (this.map.getSource(layerInfo.sourceId)) {
      this.map.removeSource(layerInfo.sourceId);
    }

    this.customLayers.delete(layerId);
    console.log(`Layer removed: ${layerInfo.name}`);
  }

  setLayerVisibility(layerId, visible) {
    const layerInfo = this.customLayers.get(layerId);
    if (!layerInfo) return;

    const visibility = visible ? 'visible' : 'none';

    for (const lid of layerInfo.layers) {
      if (this.map.getLayer(lid)) {
        this.map.setLayoutProperty(lid, 'visibility', visibility);
      }
    }

    layerInfo.visible = visible;
  }

  setLayerColor(layerId, color) {
    const layerInfo = this.customLayers.get(layerId);
    if (!layerInfo) {
      console.warn(`Layer not found: ${layerId}`);
      return;
    }

    if (!layerInfo.options) {
      layerInfo.options = {};
    }
    layerInfo.options.color = color;

    for (const lid of layerInfo.layers) {
      if (!this.map.getLayer(lid)) continue;

      if (lid.endsWith('-points')) {
        this.map.setPaintProperty(lid, 'circle-color', color);
      } else if (lid.endsWith('-lines')) {
        this.map.setPaintProperty(lid, 'line-color', color);
      } else if (lid.endsWith('-fill')) {
        this.map.setPaintProperty(lid, 'fill-color', color);
      } else if (lid.endsWith('-outline')) {
        this.map.setPaintProperty(lid, 'line-color', color);
      }
    }

    console.log(`Layer color updated: ${layerInfo.name} -> ${color}`);
  }

  setLayerOpacity(layerId, opacity) {
    const layerInfo = this.customLayers.get(layerId);
    if (!layerInfo) {
      console.warn(`Layer not found: ${layerId}`);
      return;
    }

    const clampedOpacity = Math.max(0, Math.min(1, opacity));

    if (!layerInfo.options) {
      layerInfo.options = {};
    }
    layerInfo.options.opacity = clampedOpacity;

    for (const lid of layerInfo.layers) {
      if (!this.map.getLayer(lid)) continue;

      if (lid.endsWith('-points')) {
        this.map.setPaintProperty(lid, 'circle-opacity', clampedOpacity);
      } else if (lid.endsWith('-lines')) {
        this.map.setPaintProperty(lid, 'line-opacity', clampedOpacity);
      } else if (lid.endsWith('-fill')) {
        this.map.setPaintProperty(lid, 'fill-opacity', clampedOpacity * 0.5);
      } else if (lid.endsWith('-outline')) {
        this.map.setPaintProperty(lid, 'line-opacity', clampedOpacity);
      }
    }

    console.log(`Layer opacity updated: ${layerInfo.name} -> ${clampedOpacity}`);
  }

  getCustomLayers() {
    const layers = [];
    for (const [id, info] of this.customLayers) {
      layers.push({
        id,
        name: info.name,
        visible: info.visible,
        color: info.options?.color || '#3388ff',
        opacity: info.options?.opacity !== undefined ? info.options.opacity : 0.6,
        type: info.options?.type || 'geojson',
        properties: info.properties || [],
        labelConfig: info.labelConfig || null
      });
    }
    return layers;
  }

  getLayerForPersistence(layerId) {
    const layerInfo = this.customLayers.get(layerId);
    if (!layerInfo) return null;

    return {
      id: layerId,
      name: layerInfo.name,
      type: layerInfo.options?.type || 'geojson',
      geojson: JSON.stringify(layerInfo.geojson),
      color: layerInfo.options?.color || '#3388ff',
      opacity: layerInfo.options?.opacity !== undefined ? layerInfo.options.opacity : 0.6,
      visible: layerInfo.visible,
      labelConfig: layerInfo.labelConfig ? JSON.stringify(layerInfo.labelConfig) : null
    };
  }

  getAllLayersForPersistence() {
    const layers = [];
    for (const [id] of this.customLayers) {
      const layerData = this.getLayerForPersistence(id);
      if (layerData) {
        layers.push(layerData);
      }
    }
    return layers;
  }

  restoreLayer(layerData) {
    try {
      const geojson = JSON.parse(layerData.geojson);
      const labelConfig = layerData.labelConfig ? JSON.parse(layerData.labelConfig) : null;

      const layerId = this.addGeoJSONLayer(geojson, {
        id: layerData.id,
        name: layerData.name,
        type: layerData.type,
        color: layerData.color,
        opacity: layerData.opacity
      });

      if (!layerData.visible) {
        this.setLayerVisibility(layerId, false);
      }

      if (labelConfig) {
        this.setLayerLabels(layerId, labelConfig);
      }

      console.log(`Layer restored from database: ${layerData.name}`);
      return layerId;
    } catch (error) {
      console.error(`Failed to restore layer ${layerData.name}:`, error);
      return null;
    }
  }

  restoreAllLayers(layersData) {
    if (!Array.isArray(layersData)) return;

    for (const layerData of layersData) {
      this.restoreLayer(layerData);
    }

    console.log(`Restored ${layersData.length} layers from database`);
  }

  setLayerLabels(layerId, config) {
    const layerInfo = this.customLayers.get(layerId);
    if (!layerInfo) {
      console.warn(`Layer not found: ${layerId}`);
      return;
    }

    this.removeLayerLabels(layerId);

    if (!config.field) return;

    const labelLayerId = `${layerId}-labels`;
    const sourceId = layerInfo.sourceId;

    const beforeLayerId = this.map.getLayer('clusters-layer') ? 'clusters-layer' :
                          this.map.getLayer('tracks-layer') ? 'tracks-layer' : undefined;

    this.map.addLayer({
      id: labelLayerId,
      type: 'symbol',
      source: sourceId,
      layout: {
        'text-field': ['get', config.field],
        'text-size': config.size || 12,
        'text-font': ['Noto Sans Regular'],
        'text-anchor': 'center',
        'text-offset': [0, 1.5],
        'text-allow-overlap': false,
        'text-optional': true
      },
      paint: {
        'text-color': config.color || '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1.5
      }
    }, beforeLayerId);

    layerInfo.labelLayerId = labelLayerId;
    layerInfo.labelConfig = config;

    console.log(`Labels added to layer: ${layerInfo.name} (field: ${config.field})`);
  }

  removeLayerLabels(layerId) {
    const layerInfo = this.customLayers.get(layerId);
    if (!layerInfo || !layerInfo.labelLayerId) return;

    if (this.map.getLayer(layerInfo.labelLayerId)) {
      this.map.removeLayer(layerInfo.labelLayerId);
    }

    layerInfo.labelLayerId = null;
    layerInfo.labelConfig = null;

    console.log(`Labels removed from layer: ${layerInfo.name}`);
  }

  readdCustomLayers() {
    if (this.customLayers.size === 0) {
      return;
    }

    console.log(`Restoring ${this.customLayers.size} custom layers after style change...`);

    const layersToRestore = [];
    for (const [layerId, info] of this.customLayers) {
      if (info.geojson) {
        layersToRestore.push({
          layerId,
          sourceId: info.sourceId,
          geojson: info.geojson,
          options: { ...info.options, name: info.name },
          labelConfig: info.labelConfig,
          visible: info.visible
        });
      }
    }

    this.customLayers.clear();

    for (const layerData of layersToRestore) {
      try {
        if (this.map.getSource(layerData.sourceId)) {
          const style = this.map.getStyle();
          if (style && style.layers) {
            for (const layer of style.layers) {
              if (layer.source === layerData.sourceId) {
                this.map.removeLayer(layer.id);
              }
            }
          }
          this.map.removeSource(layerData.sourceId);
        }

        const newLayerId = this.addGeoJSONLayer(layerData.geojson, {
          id: layerData.layerId,
          ...layerData.options
        });

        if (layerData.labelConfig) {
          this.setLayerLabels(newLayerId, layerData.labelConfig);
        }

        if (!layerData.visible) {
          this.setLayerVisibility(newLayerId, false);
        }

        console.log(`Custom layer restored: ${layerData.options.name || layerData.layerId}`);
      } catch (e) {
        console.error(`Failed to restore custom layer ${layerData.layerId}:`, e);
      }
    }
  }

  fitToLayer(layerId) {
    const layerInfo = this.customLayers.get(layerId);
    if (!layerInfo || !layerInfo.geojson) return;

    const bounds = this.getGeoJSONBounds(layerInfo.geojson);
    if (bounds) {
      this.map.fitBounds(bounds, { padding: 50 });
    }
  }

  getGeoJSONBounds(geojson) {
    let minLon = Infinity, minLat = Infinity;
    let maxLon = -Infinity, maxLat = -Infinity;

    const processCoords = (coords) => {
      if (typeof coords[0] === 'number') {
        minLon = Math.min(minLon, coords[0]);
        maxLon = Math.max(maxLon, coords[0]);
        minLat = Math.min(minLat, coords[1]);
        maxLat = Math.max(maxLat, coords[1]);
      } else {
        coords.forEach(processCoords);
      }
    };

    const processGeometry = (geometry) => {
      if (geometry.coordinates) {
        processCoords(geometry.coordinates);
      }
    };

    if (geojson.type === 'FeatureCollection') {
      geojson.features.forEach(f => processGeometry(f.geometry));
    } else if (geojson.type === 'Feature') {
      processGeometry(geojson.geometry);
    } else {
      processGeometry(geojson);
    }

    if (minLon === Infinity) return null;
    return [[minLon, minLat], [maxLon, maxLat]];
  }

  static GLYPHS_URL = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

  getBaseStyle() {
    return {
      version: 8,
      glyphs: MapController.GLYPHS_URL,
      sources: {},
      layers: []
    };
  }

  getOSMStyle() {
    return {
      version: 8,
      glyphs: MapController.GLYPHS_URL,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: [
            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm-layer',
          type: 'raster',
          source: 'osm-tiles',
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    };
  }

  getSatelliteStyle() {
    return {
      version: 8,
      glyphs: MapController.GLYPHS_URL,
      sources: {
        'satellite-tiles': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: 'Esri',
        },
      },
      layers: [
        {
          id: 'satellite-layer',
          type: 'raster',
          source: 'satellite-tiles',
        },
      ],
    };
  }

  getDarkStyle() {
    return {
      version: 8,
      glyphs: MapController.GLYPHS_URL,
      sources: {
        'dark-tiles': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© CARTO © OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'dark-layer',
          type: 'raster',
          source: 'dark-tiles',
        },
      ],
    };
  }

  getNauticalStyle() {
    return {
      version: 8,
      glyphs: MapController.GLYPHS_URL,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: [
            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
        'openseamap': {
          type: 'raster',
          tiles: [
            'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenSeaMap contributors',
        },
      },
      layers: [
        {
          id: 'osm-base',
          type: 'raster',
          source: 'osm-tiles',
        },
        {
          id: 'seamark-overlay',
          type: 'raster',
          source: 'openseamap',
        },
      ],
    };
  }

  getOfflineStyle() {
    return {
      version: 8,
      glyphs: MapController.GLYPHS_URL,
      sources: {},
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: {
            'background-color': '#1a1a2e'
          }
        }
      ]
    };
  }

  switchBaseMap(style) {
    let styleObj;
    switch (style) {
      case 'satellite':
        styleObj = this.getSatelliteStyle();
        break;
      case 'dark':
        styleObj = this.getDarkStyle();
        break;
      case 'nautical':
        styleObj = this.getNauticalStyle();
        break;
      case 'offline':
        styleObj = this.getOfflineStyle();
        break;
      default:
        styleObj = this.getOSMStyle();
    }

    this.isMapReady = false;

    const savedTracksData = this.currentTracksData;
    const savedCustomLayers = [];
    for (const [layerId, info] of this.customLayers) {
      if (info.geojson) {
        savedCustomLayers.push({
          layerId,
          sourceId: info.sourceId,
          geojson: info.geojson,
          options: { ...info.options, name: info.name },
          labelConfig: info.labelConfig,
          visible: info.visible
        });
      }
    }

    this.multiColorIconCache.clear();
    this.customLayers.clear();

    this.map.setStyle(styleObj);

    this.map.once('idle', () => {
      this.onStyleReloadWithData(savedTracksData, savedCustomLayers);
    });
  }

  onStyleReloadWithData(savedTracksData, savedCustomLayers) {
    try {
      const standardCanvas = this.createStandardTrackIcon(20);
      this.addImageFromCanvas('standard-track-icon', standardCanvas);
    } catch (e) {
      console.warn('Failed to pre-create standard track icon:', e);
    }

    this.map.addSource('ais-tracks', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      cluster: this.clusteringEnabled,
      clusterRadius: this.clusterRadius,
      clusterMaxZoom: this.clusterMaxZoom,
      clusterProperties: {
        sum: ['+', 1],
      },
    });

    this.map.addSource('speed-leaders', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addSource('multi-list-tracks', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addSource('track-labels', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addSource('nrt-tracks', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addSource('own-ship', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    this.map.addLayer({
      id: 'clusters-layer',
      type: 'circle',
      source: 'ais-tracks',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#51bbd6',
          100,
          '#f1f075',
          750,
          '#f28cb1'
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          18,
          100,
          25,
          750,
          35
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    this.map.addLayer({
      id: 'cluster-count-layer',
      type: 'symbol',
      source: 'ais-tracks',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 14,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#000000',
      },
    });

    this.map.addLayer({
      id: 'tracks-layer',
      type: 'symbol',
      source: 'ais-tracks',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['get', 'iconName'],
        'icon-size': ['get', 'iconSize'],
        'icon-allow-overlap': true,
      },
    });

    this.map.addLayer({
      id: 'multi-list-layer',
      type: 'symbol',
      source: 'multi-list-tracks',
      layout: {
        'icon-image': ['get', 'iconName'],
        'icon-size': ['get', 'iconSize'],
        'icon-allow-overlap': true,
      },
    });

    this.map.addLayer({
      id: 'nrt-tracks-layer',
      type: 'symbol',
      source: 'nrt-tracks',
      layout: {
        'icon-image': ['get', 'iconName'],
        'icon-size': ['get', 'iconSize'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    this.map.addLayer({
      id: 'speed-leaders-layer',
      type: 'line',
      source: 'speed-leaders',
      paint: {
        'line-color': ['get', 'lineColor'],
        'line-width': ['get', 'lineWidth'],
        'line-opacity': 1,
      },
    });

    for (const layerData of savedCustomLayers) {
      try {
        const newLayerId = this.addGeoJSONLayer(layerData.geojson, {
          id: layerData.layerId,
          ...layerData.options
        });

        if (layerData.labelConfig) {
          this.setLayerLabels(newLayerId, layerData.labelConfig);
        }

        if (!layerData.visible) {
          this.setLayerVisibility(newLayerId, false);
        }

        console.log(`Custom layer restored: ${layerData.options.name || layerData.layerId}`);
      } catch (e) {
        console.error(`Failed to restore custom layer ${layerData.layerId}:`, e);
      }
    }

    this.map.addLayer({
      id: 'track-labels-layer',
      type: 'symbol',
      source: 'track-labels',
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1.5,
      },
    });

    this.map.addLayer({
      id: 'own-ship-layer',
      type: 'symbol',
      source: 'own-ship',
      layout: {
        'icon-image': ['get', 'iconName'],
        'icon-size': ['get', 'iconSize'],
        'icon-rotate': ['get', 'rotation'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });

    this.isMapReady = true;

    if (savedTracksData && savedTracksData.length > 0) {
      console.log(`Restoring ${savedTracksData.length} tracks after style change...`);
      this.updateTracks(savedTracksData);
    }

    if (this.onStyleReloadCallback) {
      this.onStyleReloadCallback();
    }

    console.log('Map style reloaded, all data restored');
  }

  flyTo(lon, lat, zoom = 10) {
    this.map.flyTo({
      center: [lon, lat],
      zoom,
      duration: 2000,
    });
  }

  zoomIn() {
    this.map.zoomIn();
  }

  zoomOut() {
    this.map.zoomOut();
  }

  resetView() {
    this.map.flyTo({
      center: this.config.center,
      zoom: this.config.zoom,
      duration: 1500,
    });
  }

  getCenter() {
    if (!this.map) return null;
    const center = this.map.getCenter();
    return {
      lat: center.lat,
      lon: center.lng,
    };
  }

  getMap() {
    return this.map;
  }

  displayHistoryTracks(tracksData) {
    if (!this.map || !this.isMapReady) {
      console.warn('Map not ready for history tracks');
      return;
    }

    this.clearHistoryTracks();

    const mmsiList = Object.keys(tracksData);
    if (mmsiList.length === 0) return;

    const lineFeatures = [];
    const pointFeatures = [];
    const arrowFeatures = [];
    const interpolatedFeatures = [];

    const arrowInterval = 3;
    const interpolationIntervalMs = 10 * 60 * 1000;

    for (const mmsi of mmsiList) {
      const { color, positions } = tracksData[mmsi];
      if (!positions || positions.length === 0) continue;

      const coordinates = positions.map(p => [p.lon, p.lat]);
      lineFeatures.push({
        type: 'Feature',
        properties: { mmsi, color },
        geometry: {
          type: 'LineString',
          coordinates
        }
      });

      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        pointFeatures.push({
          type: 'Feature',
          properties: {
            mmsi,
            color,
            timestamp: pos.timestamp,
            lat: pos.lat,
            lon: pos.lon,
            cog: pos.cog,
            sog: pos.sog,
            heading: pos.heading
          },
          geometry: {
            type: 'Point',
            coordinates: [pos.lon, pos.lat]
          }
        });

        if (i < positions.length - 1) {
          const nextPos = positions[i + 1];
          const timeDiff = nextPos.timestamp - pos.timestamp;

          if (timeDiff > interpolationIntervalMs) {
            const numInterpolatedPoints = Math.floor(timeDiff / interpolationIntervalMs);

            for (let j = 1; j < numInterpolatedPoints; j++) {
              const fraction = j / numInterpolatedPoints;
              const interpTimestamp = pos.timestamp + (timeDiff * fraction);

              const interpLat = pos.lat + (nextPos.lat - pos.lat) * fraction;
              const interpLon = pos.lon + (nextPos.lon - pos.lon) * fraction;

              interpolatedFeatures.push({
                type: 'Feature',
                properties: {
                  mmsi,
                  color,
                  timestamp: interpTimestamp,
                  lat: interpLat,
                  lon: interpLon,
                  cog: pos.cog,
                  sog: pos.sog
                },
                geometry: {
                  type: 'Point',
                  coordinates: [interpLon, interpLat]
                }
              });
            }
          }
        }

        if (i > 0 && i < positions.length - 1 && i % arrowInterval === 0) {
          const prevPos = positions[i - 1];
          const bearing = this.calculateBearing(prevPos.lat, prevPos.lon, pos.lat, pos.lon);

          arrowFeatures.push({
            type: 'Feature',
            properties: {
              mmsi,
              color,
              bearing
            },
            geometry: {
              type: 'Point',
              coordinates: [pos.lon, pos.lat]
            }
          });
        }
      }
    }

    this.map.addSource('history-lines', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: lineFeatures
      }
    });

    this.map.addLayer({
      id: 'history-lines-layer',
      type: 'line',
      source: 'history-lines',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-opacity': 0.8
      }
    });

    this.map.addSource('history-points', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: pointFeatures
      }
    });

    this.map.addLayer({
      id: 'history-points-layer',
      type: 'circle',
      source: 'history-points',
      paint: {
        'circle-radius': 4,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
        'circle-opacity': 0.9
      }
    });

    this.map.addSource('history-interpolated', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: interpolatedFeatures
      }
    });

    this.map.addLayer({
      id: 'history-interpolated-layer',
      type: 'circle',
      source: 'history-interpolated',
      paint: {
        'circle-radius': 3,
        'circle-color': '#ffff00',
        'circle-stroke-color': '#000000',
        'circle-stroke-width': 0.5,
        'circle-opacity': 0.8
      }
    });

    this.map.addSource('history-arrows', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: arrowFeatures
      }
    });

    if (!this.map.hasImage('history-arrow')) {
      this.createHistoryArrowIcon();
    }

    this.map.addLayer({
      id: 'history-arrows-layer',
      type: 'symbol',
      source: 'history-arrows',
      layout: {
        'icon-image': 'history-arrow',
        'icon-size': 0.8,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      paint: {
        'icon-color': ['get', 'color'],
        'icon-opacity': 0.9
      }
    });

    this.map.on('click', 'history-points-layer', (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;
        const coords = feature.geometry.coordinates;

        const date = new Date(props.timestamp);
        const timeStr = date.toLocaleString('it-IT');

        const content = `
          <div class="history-popup">
            <div class="history-popup-header" style="border-left: 3px solid ${props.color};">
              <strong>MMSI: ${props.mmsi}</strong>
            </div>
            <div class="history-popup-body">
              <div><span class="label">Data/Ora:</span> ${timeStr}</div>
              <div><span class="label">Lat:</span> ${props.lat.toFixed(6)}°</div>
              <div><span class="label">Lon:</span> ${props.lon.toFixed(6)}°</div>
              <div><span class="label">COG:</span> ${props.cog.toFixed(1)}°</div>
              <div><span class="label">SOG:</span> ${props.sog.toFixed(1)} kn</div>
              ${props.heading !== null ? `<div><span class="label">HDG:</span> ${props.heading}°</div>` : ''}
            </div>
          </div>
        `;

        new maplibregl.Popup({ closeButton: true, maxWidth: '250px' })
          .setLngLat(coords)
          .setHTML(content)
          .addTo(this.map);
      }
    });

    this.map.on('mouseenter', 'history-points-layer', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', 'history-points-layer', () => {
      this.map.getCanvas().style.cursor = '';
    });

    let interpolatedPopup = null;

    this.map.on('mouseenter', 'history-interpolated-layer', (e) => {
      this.map.getCanvas().style.cursor = 'pointer';

      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;
        const coords = feature.geometry.coordinates;

        const date = new Date(props.timestamp);
        const timeStr = date.toLocaleString('it-IT');

        const content = `
          <div class="history-popup interpolated">
            <div class="history-popup-header" style="border-left: 3px solid ${props.color};">
              <strong>Posizione stimata</strong>
            </div>
            <div class="history-popup-body">
              <div><span class="label">Ora:</span> ${timeStr}</div>
              <div><span class="label">COG:</span> ${Number(props.cog).toFixed(1)}°</div>
              <div><span class="label">SOG:</span> ${Number(props.sog).toFixed(1)} kn</div>
            </div>
          </div>
        `;

        if (interpolatedPopup) {
          interpolatedPopup.remove();
        }

        interpolatedPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: '200px'
        })
          .setLngLat(coords)
          .setHTML(content)
          .addTo(this.map);
      }
    });

    this.map.on('mouseleave', 'history-interpolated-layer', () => {
      this.map.getCanvas().style.cursor = '';
      if (interpolatedPopup) {
        interpolatedPopup.remove();
        interpolatedPopup = null;
      }
    });

    console.log(`Displayed history tracks: ${lineFeatures.length} lines, ${pointFeatures.length} points, ${interpolatedFeatures.length} interpolated`);
  }

  clearHistoryTracks() {
    if (!this.map) return;

    if (this.map.getLayer('history-arrows-layer')) {
      this.map.removeLayer('history-arrows-layer');
    }
    if (this.map.getLayer('history-interpolated-layer')) {
      this.map.removeLayer('history-interpolated-layer');
    }
    if (this.map.getLayer('history-points-layer')) {
      this.map.removeLayer('history-points-layer');
    }
    if (this.map.getLayer('history-lines-layer')) {
      this.map.removeLayer('history-lines-layer');
    }

    if (this.map.getSource('history-arrows')) {
      this.map.removeSource('history-arrows');
    }
    if (this.map.getSource('history-interpolated')) {
      this.map.removeSource('history-interpolated');
    }
    if (this.map.getSource('history-points')) {
      this.map.removeSource('history-points');
    }
    if (this.map.getSource('history-lines')) {
      this.map.removeSource('history-lines');
    }

    console.log('History tracks cleared');
  }

  fitHistoryBounds(tracksData) {
    if (!this.map) return;

    const allCoords = [];
    for (const mmsi of Object.keys(tracksData)) {
      const { positions } = tracksData[mmsi];
      if (positions) {
        for (const pos of positions) {
          allCoords.push([pos.lon, pos.lat]);
        }
      }
    }

    if (allCoords.length === 0) return;

    const bounds = allCoords.reduce((bounds, coord) => {
      return bounds.extend(coord);
    }, new maplibregl.LngLatBounds(allCoords[0], allCoords[0]));

    this.map.fitBounds(bounds, {
      padding: 50,
      maxZoom: 14
    });
  }

  displayPredictionTracks(tracksData) {
    if (!this.map || !this.isMapReady) {
      console.warn('Map not ready for prediction tracks');
      return;
    }

    this.clearPredictionTracks();

    const mmsiList = Object.keys(tracksData);
    if (mmsiList.length === 0) return;

    const lineFeatures = [];
    const startPointFeatures = [];
    const interpolatedFeatures = [];
    const endPointFeatures = [];

    for (const mmsi of mmsiList) {
      const { color, positions } = tracksData[mmsi];
      if (!positions || positions.length === 0) continue;

      const coordinates = positions.map(p => [p.lon, p.lat]);
      lineFeatures.push({
        type: 'Feature',
        properties: { mmsi, color },
        geometry: {
          type: 'LineString',
          coordinates
        }
      });

      for (const pos of positions) {
        const feature = {
          type: 'Feature',
          properties: {
            mmsi,
            color,
            timestamp: pos.timestamp,
            lat: pos.lat,
            lon: pos.lon,
            cog: pos.cog,
            sog: pos.sog
          },
          geometry: {
            type: 'Point',
            coordinates: [pos.lon, pos.lat]
          }
        };

        if (pos.isStart) {
          startPointFeatures.push(feature);
        } else if (pos.isFinal) {
          endPointFeatures.push(feature);
        } else {
          interpolatedFeatures.push(feature);
        }
      }
    }

    this.map.addSource('prediction-lines', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: lineFeatures
      }
    });

    this.map.addLayer({
      id: 'prediction-lines-layer',
      type: 'line',
      source: 'prediction-lines',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-opacity': 0.8,
        'line-dasharray': [4, 3]
      }
    });

    this.map.addSource('prediction-interpolated', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: interpolatedFeatures
      }
    });

    this.map.addLayer({
      id: 'prediction-interpolated-layer',
      type: 'circle',
      source: 'prediction-interpolated',
      paint: {
        'circle-radius': 3,
        'circle-color': '#000000',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 0.5,
        'circle-opacity': 0.8
      }
    });

    this.map.addSource('prediction-endpoints', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: endPointFeatures
      }
    });

    this.map.addLayer({
      id: 'prediction-endpoints-layer',
      type: 'circle',
      source: 'prediction-endpoints',
      paint: {
        'circle-radius': 6,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.9
      }
    });

    let predictionPopup = null;

    this.map.on('mouseenter', 'prediction-interpolated-layer', (e) => {
      this.map.getCanvas().style.cursor = 'pointer';

      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;
        const coords = feature.geometry.coordinates;

        const date = new Date(props.timestamp);
        const timeStr = date.toLocaleString('it-IT');

        const content = `
          <div class="history-popup prediction">
            <div class="history-popup-header" style="border-left: 3px solid #000000;">
              <strong>Posizione prevista</strong>
            </div>
            <div class="history-popup-body">
              <div><span class="label">Ora:</span> ${timeStr}</div>
              <div><span class="label">COG:</span> ${Number(props.cog).toFixed(1)}°</div>
              <div><span class="label">SOG:</span> ${Number(props.sog).toFixed(1)} kn</div>
            </div>
          </div>
        `;

        if (predictionPopup) {
          predictionPopup.remove();
        }

        predictionPopup = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: '200px'
        })
          .setLngLat(coords)
          .setHTML(content)
          .addTo(this.map);
      }
    });

    this.map.on('mouseleave', 'prediction-interpolated-layer', () => {
      this.map.getCanvas().style.cursor = '';
      if (predictionPopup) {
        predictionPopup.remove();
        predictionPopup = null;
      }
    });

    this.map.on('click', 'prediction-endpoints-layer', (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;
        const coords = feature.geometry.coordinates;

        const date = new Date(props.timestamp);
        const timeStr = date.toLocaleString('it-IT');

        const content = `
          <div class="history-popup prediction-final">
            <div class="history-popup-header" style="border-left: 3px solid ${props.color};">
              <strong>MMSI: ${props.mmsi}</strong>
            </div>
            <div class="history-popup-body">
              <div><span class="label">Arrivo previsto:</span> ${timeStr}</div>
              <div><span class="label">Lat:</span> ${Number(props.lat).toFixed(6)}°</div>
              <div><span class="label">Lon:</span> ${Number(props.lon).toFixed(6)}°</div>
              <div><span class="label">COG:</span> ${Number(props.cog).toFixed(1)}°</div>
              <div><span class="label">SOG:</span> ${Number(props.sog).toFixed(1)} kn</div>
            </div>
          </div>
        `;

        new maplibregl.Popup({ closeButton: true, maxWidth: '250px' })
          .setLngLat(coords)
          .setHTML(content)
          .addTo(this.map);
      }
    });

    this.map.on('mouseenter', 'prediction-endpoints-layer', () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', 'prediction-endpoints-layer', () => {
      this.map.getCanvas().style.cursor = '';
    });

    console.log(`Displayed prediction tracks: ${lineFeatures.length} lines, ${interpolatedFeatures.length} interpolated, ${endPointFeatures.length} endpoints`);
  }

  clearPredictionTracks() {
    if (!this.map) return;

    if (this.map.getLayer('prediction-endpoints-layer')) {
      this.map.removeLayer('prediction-endpoints-layer');
    }
    if (this.map.getLayer('prediction-interpolated-layer')) {
      this.map.removeLayer('prediction-interpolated-layer');
    }
    if (this.map.getLayer('prediction-lines-layer')) {
      this.map.removeLayer('prediction-lines-layer');
    }

    if (this.map.getSource('prediction-endpoints')) {
      this.map.removeSource('prediction-endpoints');
    }
    if (this.map.getSource('prediction-interpolated')) {
      this.map.removeSource('prediction-interpolated');
    }
    if (this.map.getSource('prediction-lines')) {
      this.map.removeSource('prediction-lines');
    }

    console.log('Prediction tracks cleared');
  }

  calculateBearing(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => deg * Math.PI / 180;
    const toDeg = (rad) => rad * 180 / Math.PI;

    const dLon = toRad(lon2 - lon1);
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);

    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

    let bearing = toDeg(Math.atan2(y, x));
    bearing = (bearing + 360) % 360;

    return bearing;
  }

  createHistoryArrowIcon() {
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = '#ffffff';

    ctx.beginPath();
    ctx.moveTo(size / 2, 2);
    ctx.lineTo(size - 4, size - 4);
    ctx.lineTo(size / 2, size - 8);
    ctx.lineTo(4, size - 4);
    ctx.closePath();

    ctx.fill();

    const imageData = ctx.getImageData(0, 0, size, size);

    this.map.addImage('history-arrow', {
      width: size,
      height: size,
      data: imageData.data
    }, { sdf: true });
  }

  destroy() {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
