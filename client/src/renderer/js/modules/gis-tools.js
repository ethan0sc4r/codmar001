export class GISTools {
  constructor(mapController, trackManager) {
    this.mapController = mapController;
    this.trackManager = trackManager;
    this.map = null;

    this.zones = new Map();
    this.zoneIdCounter = 1;
    this.tracksInZones = new Map();

    this.measurementActive = false;
    this.measurementPoints = [];
    this.measurementLineId = 'measurement-line';
    this.measurementPointsId = 'measurement-points';

    this.trackRanges = new Map();
    this.trackRangeIdCounter = 1;
    this.tracksInRanges = new Map();

    this.drawingMode = null;
    this.drawingPoints = [];
    this.drawingCircleCenter = null;

    this.audioContext = null;

    this.onZoneAlertCallbacks = [];
    this.onRangeAlertCallbacks = [];
    this.onMeasurementUpdateCallbacks = [];
    this.onZoneCreatedCallbacks = [];
    this.onRangeCreatedCallbacks = [];

    this.handleMapClick = this.handleMapClick.bind(this);
    this.handleMapMouseMove = this.handleMapMouseMove.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  initialize() {
    if (!this.mapController || !this.mapController.map) {
      console.error('GISTools: MapController not available');
      return;
    }

    this.map = this.mapController.map;

    const trySetupLayers = () => {
      if (this.map.isStyleLoaded()) {
        this.setupLayers();
      } else {
        this.map.once('styledata', () => {
          setTimeout(() => this.setupLayers(), 100);
        });
      }
    };

    trySetupLayers();

    this.setupAudio();

    this.startProximityCheckLoop();

    console.log('GIS Tools initialized');
  }

  isReady() {
    const mapOk = this.map !== null;
    const sourceOk = mapOk && this.map.getSource('gis-measurement') !== undefined;

    if (!mapOk) {
      console.log('GISTools.isReady: map is null');
    } else if (!sourceOk) {
      console.log('GISTools.isReady: gis-measurement source not found');
    }

    return mapOk && sourceOk;
  }

  setupAudio() {
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('AudioContext not available for GIS alerts');
    }
  }

  setupLayers() {
    console.log('GISTools: Setting up layers...');

    if (!this.map.getSource('gis-zones')) {
      this.map.addSource('gis-zones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (!this.map.getSource('gis-zones-fill')) {
      this.map.addSource('gis-zones-fill', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (!this.map.getSource('gis-measurement')) {
      this.map.addSource('gis-measurement', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (!this.map.getSource('gis-measurement-points')) {
      this.map.addSource('gis-measurement-points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (!this.map.getSource('gis-track-ranges')) {
      this.map.addSource('gis-track-ranges', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (!this.map.getSource('gis-drawing')) {
      this.map.addSource('gis-drawing', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (!this.map.getSource('gis-measurement-labels')) {
      this.map.addSource('gis-measurement-labels', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
    }

    if (!this.map.getLayer('gis-zones-fill-layer')) {
      this.map.addLayer({
        id: 'gis-zones-fill-layer',
        type: 'fill',
        source: 'gis-zones-fill',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.2
        }
      });
    }

    if (!this.map.getLayer('gis-zones-layer')) {
      this.map.addLayer({
        id: 'gis-zones-layer',
        type: 'line',
        source: 'gis-zones',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-dasharray': [3, 2]
        }
      });
    }

    if (!this.map.getLayer('gis-track-ranges-layer')) {
      this.map.addLayer({
        id: 'gis-track-ranges-layer',
        type: 'line',
        source: 'gis-track-ranges',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.8
        }
      });
    }

    if (!this.map.getLayer('gis-measurement-layer')) {
      this.map.addLayer({
        id: 'gis-measurement-layer',
        type: 'line',
        source: 'gis-measurement',
        paint: {
          'line-color': '#ffff00',
          'line-width': 2,
          'line-dasharray': [5, 3]
        }
      });
    }

    if (!this.map.getLayer('gis-measurement-points-layer')) {
      this.map.addLayer({
        id: 'gis-measurement-points-layer',
        type: 'circle',
        source: 'gis-measurement-points',
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffff00',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#000000'
        }
      });
    }

    if (!this.map.getLayer('gis-measurement-labels-layer')) {
      this.map.addLayer({
        id: 'gis-measurement-labels-layer',
        type: 'symbol',
        source: 'gis-measurement-labels',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 14,
          'text-font': ['Noto Sans Regular'],
          'text-anchor': 'center',
          'text-offset': [0, -1.5],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffff00',
          'text-halo-color': '#000000',
          'text-halo-width': 2
        }
      });
    }

    if (!this.map.getLayer('gis-drawing-layer')) {
      this.map.addLayer({
        id: 'gis-drawing-layer',
        type: 'line',
        source: 'gis-drawing',
        paint: {
          'line-color': '#00ffff',
          'line-width': 2,
          'line-dasharray': [2, 2]
        }
      });
    }

    console.log('GIS layers added');
  }

  startDrawPolygon() {
    if (!this.map) {
      console.error('GISTools: Map not initialized, cannot start polygon drawing');
      return;
    }

    this.cancelDrawing();
    this.drawingMode = 'polygon';
    this.drawingPoints = [];
    this.map.getCanvas().style.cursor = 'crosshair';

    this.map.on('click', this.handleMapClick);
    this.map.on('mousemove', this.handleMapMouseMove);
    document.addEventListener('keydown', this.handleKeyDown);

    console.log('Started polygon drawing mode. Click to add points, Enter to finish, Escape to cancel.');
  }

  startDrawCircle() {
    if (!this.map) {
      console.error('GISTools: Map not initialized, cannot start circle drawing');
      return;
    }

    this.cancelDrawing();
    this.drawingMode = 'circle';
    this.drawingCircleCenter = null;
    this.map.getCanvas().style.cursor = 'crosshair';

    this.map.on('click', this.handleMapClick);
    this.map.on('mousemove', this.handleMapMouseMove);
    document.addEventListener('keydown', this.handleKeyDown);

    console.log('Started circle drawing mode. Click for center, click again to set radius, Escape to cancel.');
  }

  handleMapClick(e) {
    const lngLat = e.lngLat;

    if (this.drawingMode === 'polygon') {
      this.drawingPoints.push([lngLat.lng, lngLat.lat]);
      this.updateDrawingPreview();

    } else if (this.drawingMode === 'circle') {
      if (!this.drawingCircleCenter) {
        this.drawingCircleCenter = [lngLat.lng, lngLat.lat];
        this.updateDrawingPreview();
      } else {
        const radiusNm = this.calculateDistanceNm(
          this.drawingCircleCenter[1], this.drawingCircleCenter[0],
          lngLat.lat, lngLat.lng
        );
        this.finishDrawCircle(radiusNm);
      }

    } else if (this.drawingMode === 'measurement') {
      this.measurementPoints.push([lngLat.lng, lngLat.lat]);
      this.updateMeasurementDisplay();
    }
  }

  handleMapMouseMove(e) {
    if (this.drawingMode === 'polygon' && this.drawingPoints.length > 0) {
      const previewPoints = [...this.drawingPoints, [e.lngLat.lng, e.lngLat.lat]];
      this.updateDrawingPreviewWithPoints(previewPoints);

    } else if (this.drawingMode === 'circle' && this.drawingCircleCenter) {
      const radiusNm = this.calculateDistanceNm(
        this.drawingCircleCenter[1], this.drawingCircleCenter[0],
        e.lngLat.lat, e.lngLat.lng
      );
      this.updateCirclePreview(this.drawingCircleCenter, radiusNm);

    } else if (this.drawingMode === 'measurement' && this.measurementPoints.length > 0) {
      const previewPoints = [...this.measurementPoints, [e.lngLat.lng, e.lngLat.lat]];
      this.updateMeasurementPreview(previewPoints);
    }
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.drawingMode === 'polygon' && this.drawingPoints.length >= 3) {
        this.finishDrawPolygon();
      } else if (this.drawingMode === 'measurement') {
        this.finishMeasurement();
      } else {
        this.cancelDrawing();
      }
    } else if (e.key === 'Enter') {
      if (this.drawingMode === 'polygon' && this.drawingPoints.length >= 3) {
        this.finishDrawPolygon();
      } else if (this.drawingMode === 'measurement') {
        this.finishMeasurement();
      }
    }
  }

  finishDrawPolygon() {
    if (this.drawingPoints.length < 3) {
      console.warn('Need at least 3 points for a polygon');
      return;
    }

    const coordinates = [...this.drawingPoints, this.drawingPoints[0]];

    const zoneId = `zone-${this.zoneIdCounter++}`;
    const zone = {
      id: zoneId,
      type: 'polygon',
      name: `Zone ${this.zoneIdCounter - 1}`,
      coordinates: [coordinates],
      color: '#ff6600',
      alertOnEnter: true,
      alertOnExit: true
    };

    this.zones.set(zoneId, zone);
    this.tracksInZones.set(zoneId, new Set());

    this.cancelDrawing();
    this.updateZonesDisplay();
    this.notifyZoneCreated(zone);

    console.log(`Created polygon zone: ${zoneId}`);
    return zone;
  }

  finishDrawCircle(radiusNm) {
    if (!this.drawingCircleCenter || radiusNm <= 0) {
      return;
    }

    const zoneId = `zone-${this.zoneIdCounter++}`;
    const zone = {
      id: zoneId,
      type: 'circle',
      name: `Zone ${this.zoneIdCounter - 1}`,
      center: this.drawingCircleCenter,
      radiusNm: radiusNm,
      color: '#ff6600',
      alertOnEnter: true,
      alertOnExit: true
    };

    this.zones.set(zoneId, zone);
    this.tracksInZones.set(zoneId, new Set());

    this.cancelDrawing();
    this.updateZonesDisplay();
    this.notifyZoneCreated(zone);

    console.log(`Created circle zone: ${zoneId}, radius: ${radiusNm.toFixed(2)} nm`);
    return zone;
  }

  createCircleZone(center, radiusNm, options = {}) {
    if (!center || center.length !== 2 || radiusNm <= 0) {
      console.error('Invalid parameters for createCircleZone');
      return null;
    }

    const zoneId = `zone-${this.zoneIdCounter++}`;
    const zone = {
      id: zoneId,
      type: 'circle',
      name: options.name || `Zone ${this.zoneIdCounter - 1}`,
      center: center,
      radiusNm: radiusNm,
      color: options.color || '#ff6600',
      alertOnEnter: options.alertOnEnter !== false,
      alertOnExit: options.alertOnExit !== false
    };

    this.zones.set(zoneId, zone);
    this.tracksInZones.set(zoneId, new Set());

    this.updateZonesDisplay();
    this.notifyZoneCreated(zone);

    console.log(`Created circle zone from coords: ${zoneId}, center: [${center}], radius: ${radiusNm} nm`);
    return zone;
  }

  createPolygonZone(coordinates, options = {}) {
    if (!coordinates || coordinates.length < 3) {
      console.error('Need at least 3 coordinates for createPolygonZone');
      return null;
    }

    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    const closedCoords = (first[0] === last[0] && first[1] === last[1])
      ? coordinates
      : [...coordinates, coordinates[0]];

    const zoneId = `zone-${this.zoneIdCounter++}`;
    const zone = {
      id: zoneId,
      type: 'polygon',
      name: options.name || `Zone ${this.zoneIdCounter - 1}`,
      coordinates: [closedCoords],
      color: options.color || '#ff6600',
      alertOnEnter: options.alertOnEnter !== false,
      alertOnExit: options.alertOnExit !== false
    };

    this.zones.set(zoneId, zone);
    this.tracksInZones.set(zoneId, new Set());

    this.updateZonesDisplay();
    this.notifyZoneCreated(zone);

    console.log(`Created polygon zone from coords: ${zoneId}, ${coordinates.length} vertices`);
    return zone;
  }

  cancelDrawing() {
    this.drawingMode = null;
    this.drawingPoints = [];
    this.drawingCircleCenter = null;

    this.map.getCanvas().style.cursor = '';
    this.map.off('click', this.handleMapClick);
    this.map.off('mousemove', this.handleMapMouseMove);
    document.removeEventListener('keydown', this.handleKeyDown);

    if (this.map.getSource('gis-drawing')) {
      this.map.getSource('gis-drawing').setData({
        type: 'FeatureCollection',
        features: []
      });
    }
  }

  updateDrawingPreview() {
    if (this.drawingMode === 'polygon') {
      this.updateDrawingPreviewWithPoints(this.drawingPoints);
    }
  }

  updateDrawingPreviewWithPoints(points) {
    if (points.length < 2) return;

    const feature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: points
      },
      properties: {}
    };

    if (this.map && this.map.getSource('gis-drawing')) {
      this.map.getSource('gis-drawing').setData({
        type: 'FeatureCollection',
        features: [feature]
      });
    }
  }

  updateCirclePreview(center, radiusNm) {
    const circleCoords = this.createCircleCoordinates(center, radiusNm);

    const feature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: circleCoords
      },
      properties: {}
    };

    if (this.map && this.map.getSource('gis-drawing')) {
      this.map.getSource('gis-drawing').setData({
        type: 'FeatureCollection',
        features: [feature]
      });
    }
  }

  createCircleCoordinates(center, radiusNm, points = 64) {
    const coordinates = [];
    const radiusKm = radiusNm * 1.852;

    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * 2 * Math.PI;
      const dx = radiusKm * Math.cos(angle);
      const dy = radiusKm * Math.sin(angle);

      const lat = center[1] + (dy / 111);
      const lng = center[0] + (dx / (111 * Math.cos(center[1] * Math.PI / 180)));

      coordinates.push([lng, lat]);
    }

    return coordinates;
  }

  updateZonesDisplay() {
    const lineFeatures = [];
    const fillFeatures = [];

    for (const zone of this.zones.values()) {
      if (zone.type === 'polygon') {
        const feature = {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: zone.coordinates
          },
          properties: {
            id: zone.id,
            name: zone.name,
            color: zone.color
          }
        };
        lineFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: zone.coordinates[0]
          },
          properties: { color: zone.color }
        });
        fillFeatures.push(feature);

      } else if (zone.type === 'circle') {
        const circleCoords = this.createCircleCoordinates(zone.center, zone.radiusNm);
        lineFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: circleCoords
          },
          properties: {
            id: zone.id,
            name: zone.name,
            color: zone.color
          }
        });
        fillFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [circleCoords]
          },
          properties: { color: zone.color }
        });
      }
    }

    if (this.map.getSource('gis-zones')) {
      this.map.getSource('gis-zones').setData({
        type: 'FeatureCollection',
        features: lineFeatures
      });
    }

    if (this.map.getSource('gis-zones-fill')) {
      this.map.getSource('gis-zones-fill').setData({
        type: 'FeatureCollection',
        features: fillFeatures
      });
    }
  }

  addZoneFromGeoJSON(geojson, options = {}) {
    const zoneId = `zone-${this.zoneIdCounter++}`;
    const zone = {
      id: zoneId,
      type: 'polygon',
      name: options.name || `Zone ${this.zoneIdCounter - 1}`,
      coordinates: geojson.coordinates || geojson.geometry?.coordinates,
      color: options.color || '#ff6600',
      alertOnEnter: options.alertOnEnter !== false,
      alertOnExit: options.alertOnExit !== false
    };

    this.zones.set(zoneId, zone);
    this.tracksInZones.set(zoneId, new Set());
    this.updateZonesDisplay();

    return zone;
  }

  removeZone(zoneId) {
    this.zones.delete(zoneId);
    this.tracksInZones.delete(zoneId);
    this.updateZonesDisplay();
  }

  updateZone(zoneId, updates) {
    const zone = this.zones.get(zoneId);
    if (zone) {
      Object.assign(zone, updates);
      this.updateZonesDisplay();
    }
  }

  getAllZones() {
    return Array.from(this.zones.values());
  }

  exportZonesToGeoJSON() {
    const features = [];

    for (const zone of this.zones.values()) {
      let geometry;

      if (zone.type === 'polygon') {
        geometry = {
          type: 'Polygon',
          coordinates: zone.coordinates
        };
      } else if (zone.type === 'circle') {
        geometry = {
          type: 'Polygon',
          coordinates: [this.createCircleCoordinates(zone.center, zone.radiusNm)]
        };
      }

      features.push({
        type: 'Feature',
        geometry,
        properties: {
          id: zone.id,
          name: zone.name,
          type: zone.type,
          color: zone.color,
          alertOnEnter: zone.alertOnEnter,
          alertOnExit: zone.alertOnExit,
          radiusNm: zone.radiusNm,
          center: zone.center
        }
      });
    }

    return {
      type: 'FeatureCollection',
      features
    };
  }

  importZonesFromGeoJSON(geojson) {
    if (!geojson || !geojson.features) return;

    for (const feature of geojson.features) {
      const props = feature.properties || {};

      if (props.type === 'circle' && props.center && props.radiusNm) {
        const zone = {
          id: `zone-${this.zoneIdCounter++}`,
          type: 'circle',
          name: props.name || `Zone ${this.zoneIdCounter - 1}`,
          center: props.center,
          radiusNm: props.radiusNm,
          color: props.color || '#ff6600',
          alertOnEnter: props.alertOnEnter !== false,
          alertOnExit: props.alertOnExit !== false
        };
        this.zones.set(zone.id, zone);
        this.tracksInZones.set(zone.id, new Set());
      } else if (feature.geometry?.type === 'Polygon') {
        const zone = {
          id: `zone-${this.zoneIdCounter++}`,
          type: 'polygon',
          name: props.name || `Zone ${this.zoneIdCounter - 1}`,
          coordinates: feature.geometry.coordinates,
          color: props.color || '#ff6600',
          alertOnEnter: props.alertOnEnter !== false,
          alertOnExit: props.alertOnExit !== false
        };
        this.zones.set(zone.id, zone);
        this.tracksInZones.set(zone.id, new Set());
      }
    }

    this.updateZonesDisplay();
  }

  startMeasurement() {
    if (!this.map) {
      console.error('GISTools: Map not initialized, cannot start measurement');
      return;
    }

    this.cancelDrawing();
    this.measurementActive = true;
    this.measurementPoints = [];
    this.drawingMode = 'measurement';
    this.map.getCanvas().style.cursor = 'crosshair';

    this.map.on('click', this.handleMapClick);
    this.map.on('mousemove', this.handleMapMouseMove);
    document.addEventListener('keydown', this.handleKeyDown);

    console.log('Started measurement mode. Click to add points, Enter to finish, Escape to cancel.');
  }

  finishMeasurement() {
    this.measurementActive = false;
    this.drawingMode = null;

    this.map.getCanvas().style.cursor = '';
    this.map.off('click', this.handleMapClick);
    this.map.off('mousemove', this.handleMapMouseMove);
    document.removeEventListener('keydown', this.handleKeyDown);

    const totalNm = this.calculateTotalDistance(this.measurementPoints);
    this.notifyMeasurementUpdate({
      points: this.measurementPoints,
      totalNm,
      segments: this.calculateSegmentDistances(this.measurementPoints)
    });

    console.log(`Measurement complete: ${totalNm.toFixed(2)} nm`);
  }

  clearMeasurement() {
    this.measurementPoints = [];
    this.measurementActive = false;

    if (this.map.getSource('gis-measurement')) {
      this.map.getSource('gis-measurement').setData({
        type: 'FeatureCollection',
        features: []
      });
    }

    if (this.map.getSource('gis-measurement-points')) {
      this.map.getSource('gis-measurement-points').setData({
        type: 'FeatureCollection',
        features: []
      });
    }

    if (this.map.getSource('gis-measurement-labels')) {
      this.map.getSource('gis-measurement-labels').setData({
        type: 'FeatureCollection',
        features: []
      });
    }
  }

  updateMeasurementDisplay() {
    this.updateMeasurementPreview(this.measurementPoints);
  }

  updateMeasurementPreview(points) {
    if (!this.map || !this.map.getSource('gis-measurement') || !this.map.getSource('gis-measurement-points')) {
      return;
    }

    if (points.length >= 2) {
      this.map.getSource('gis-measurement').setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: points
          },
          properties: {}
        }]
      });
    } else {
      this.map.getSource('gis-measurement').setData({
        type: 'FeatureCollection',
        features: []
      });
    }

    const pointFeatures = points.map((coord, index) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coord
      },
      properties: { index }
    }));

    this.map.getSource('gis-measurement-points').setData({
      type: 'FeatureCollection',
      features: pointFeatures
    });

    this.updateMeasurementLabels(points);

    const totalNm = this.calculateTotalDistance(points);
    this.notifyMeasurementUpdate({
      points,
      totalNm,
      segments: this.calculateSegmentDistances(points)
    });
  }

  updateMeasurementLabels(points) {
    if (!this.map.getSource('gis-measurement-labels')) {
      return;
    }

    const labelFeatures = [];

    for (let i = 1; i < points.length; i++) {
      const p1 = points[i - 1];
      const p2 = points[i];

      const midLng = (p1[0] + p2[0]) / 2;
      const midLat = (p1[1] + p2[1]) / 2;

      const distanceNm = this.calculateDistanceNm(p1[1], p1[0], p2[1], p2[0]);

      const bearing = this.calculateBearing(p1[1], p1[0], p2[1], p2[0]);
      const bearingFormatted = bearing.toFixed(0).padStart(3, '0') + '°';

      labelFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [midLng, midLat]
        },
        properties: {
          distance: `${distanceNm.toFixed(2)} nm`,
          bearing: bearingFormatted,
          label: `${distanceNm.toFixed(2)} nm\n${bearingFormatted}`,
          segmentIndex: i
        }
      });
    }

    this.map.getSource('gis-measurement-labels').setData({
      type: 'FeatureCollection',
      features: labelFeatures
    });
  }

  calculateTotalDistance(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += this.calculateDistanceNm(
        points[i - 1][1], points[i - 1][0],
        points[i][1], points[i][0]
      );
    }
    return total;
  }

  calculateSegmentDistances(points) {
    const segments = [];
    for (let i = 1; i < points.length; i++) {
      segments.push({
        from: points[i - 1],
        to: points[i],
        distanceNm: this.calculateDistanceNm(
          points[i - 1][1], points[i - 1][0],
          points[i][1], points[i][0]
        )
      });
    }
    return segments;
  }

  addTrackRange(mmsi, radiusNm, options = {}) {
    const rangeId = `range-${this.trackRangeIdCounter++}`;

    const range = {
      id: rangeId,
      mmsi: String(mmsi),
      radiusNm: radiusNm,
      color: options.color || '#00ff00',
      alertEnabled: options.alertEnabled !== false,
      name: options.name || `Range ${this.trackRangeIdCounter - 1}`
    };

    this.trackRanges.set(rangeId, range);
    this.tracksInRanges.set(rangeId, new Set());

    this.updateTrackRangesDisplay();
    this.notifyRangeCreated(range);

    console.log(`Added track range: ${rangeId} for MMSI ${mmsi}, radius ${radiusNm} nm`);
    return range;
  }

  removeTrackRange(rangeId) {
    this.trackRanges.delete(rangeId);
    this.tracksInRanges.delete(rangeId);
    this.updateTrackRangesDisplay();
  }

  updateTrackRange(rangeId, updates) {
    const range = this.trackRanges.get(rangeId);
    if (range) {
      Object.assign(range, updates);
      this.updateTrackRangesDisplay();
    }
  }

  getAllTrackRanges() {
    return Array.from(this.trackRanges.values());
  }

  updateTrackRangesDisplay() {
    const features = [];

    for (const range of this.trackRanges.values()) {
      const track = this.trackManager.getTrack(range.mmsi);

      if (!track || !track.position) {
        continue;
      }

      const center = [track.position.lon, track.position.lat];
      const circleCoords = this.createCircleCoordinates(center, range.radiusNm);

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: circleCoords
        },
        properties: {
          id: range.id,
          mmsi: range.mmsi,
          color: range.color,
          radiusNm: range.radiusNm
        }
      });
    }

    if (this.map && this.map.getSource('gis-track-ranges')) {
      this.map.getSource('gis-track-ranges').setData({
        type: 'FeatureCollection',
        features
      });
    }
  }

  startProximityCheckLoop() {
    setInterval(() => {
      this.checkAllProximities();
    }, 2000);
  }

  checkAllProximities() {
    const tracks = this.trackManager.getAllTracks();

    for (const zone of this.zones.values()) {
      this.checkZoneProximity(zone, tracks);
    }

    for (const range of this.trackRanges.values()) {
      this.checkRangeProximity(range, tracks);
    }

    this.updateTrackRangesDisplay();
  }

  checkZoneProximity(zone, tracks) {
    const currentTracksInZone = new Set();

    for (const track of tracks) {
      if (!track.position) continue;

      const isInside = this.isPointInZone(
        track.position.lon, track.position.lat,
        zone
      );

      if (isInside) {
        currentTracksInZone.add(track.mmsi);
      }
    }

    const previousTracksInZone = this.tracksInZones.get(zone.id) || new Set();

    for (const mmsi of currentTracksInZone) {
      if (!previousTracksInZone.has(mmsi)) {
        const track = this.trackManager.getTrack(mmsi);
        if (zone.alertOnEnter) {
          this.triggerZoneAlert(zone, track, 'enter');
        }
      }
    }

    for (const mmsi of previousTracksInZone) {
      if (!currentTracksInZone.has(mmsi)) {
        const track = this.trackManager.getTrack(mmsi);
        if (zone.alertOnExit && track) {
          this.triggerZoneAlert(zone, track, 'exit');
        }
      }
    }

    this.tracksInZones.set(zone.id, currentTracksInZone);
  }

  checkRangeProximity(range, tracks) {
    const anchorTrack = this.trackManager.getTrack(range.mmsi);
    if (!anchorTrack || !anchorTrack.position) {
      return;
    }

    const currentTracksInRange = new Set();

    for (const track of tracks) {
      if (!track.position) continue;
      if (String(track.mmsi) === range.mmsi) continue;

      const distance = this.calculateDistanceNm(
        anchorTrack.position.lat, anchorTrack.position.lon,
        track.position.lat, track.position.lon
      );

      if (distance <= range.radiusNm) {
        currentTracksInRange.add(track.mmsi);
      }
    }

    const previousTracksInRange = this.tracksInRanges.get(range.id) || new Set();

    for (const mmsi of currentTracksInRange) {
      if (!previousTracksInRange.has(mmsi)) {
        const track = this.trackManager.getTrack(mmsi);
        if (range.alertEnabled) {
          this.triggerRangeAlert(range, anchorTrack, track, 'enter');
        }
      }
    }

    for (const mmsi of previousTracksInRange) {
      if (!currentTracksInRange.has(mmsi)) {
        const track = this.trackManager.getTrack(mmsi);
        if (range.alertEnabled && track) {
          this.triggerRangeAlert(range, anchorTrack, track, 'exit');
        }
      }
    }

    this.tracksInRanges.set(range.id, currentTracksInRange);
  }

  isPointInZone(lon, lat, zone) {
    if (zone.type === 'circle') {
      const distance = this.calculateDistanceNm(
        zone.center[1], zone.center[0],
        lat, lon
      );
      return distance <= zone.radiusNm;

    } else if (zone.type === 'polygon') {
      return this.isPointInPolygon(lon, lat, zone.coordinates[0]);
    }

    return false;
  }

  isPointInPolygon(x, y, polygon) {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];

      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

      if (intersect) inside = !inside;
    }

    return inside;
  }

  triggerZoneAlert(zone, track, eventType) {
    console.log(`Zone Alert: Track ${track?.mmsi} (${track?.name || 'Unknown'}) ${eventType}ed zone "${zone.name}"`);

    this.playAlertSound(eventType);

    for (const callback of this.onZoneAlertCallbacks) {
      try {
        callback({
          type: 'zone',
          eventType,
          zone,
          track,
          timestamp: Date.now()
        });
      } catch (e) {
        console.error('Error in zone alert callback:', e);
      }
    }
  }

  triggerRangeAlert(range, anchorTrack, track, eventType) {
    const distance = this.calculateDistanceNm(
      anchorTrack.position.lat, anchorTrack.position.lon,
      track.position.lat, track.position.lon
    );

    console.log(`Range Alert: Track ${track?.mmsi} (${track?.name || 'Unknown'}) ${eventType}ed range of ${anchorTrack.mmsi} (${anchorTrack.name || 'Unknown'}) - Distance: ${distance.toFixed(2)} nm`);

    this.playAlertSound(eventType);

    for (const callback of this.onRangeAlertCallbacks) {
      try {
        callback({
          type: 'range',
          eventType,
          range,
          anchorTrack,
          track,
          distanceNm: distance,
          timestamp: Date.now()
        });
      } catch (e) {
        console.error('Error in range alert callback:', e);
      }
    }
  }

  playAlertSound(eventType) {
    if (!this.audioContext) return;

    try {
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      osc.connect(gain);
      gain.connect(this.audioContext.destination);

      if (eventType === 'enter') {
        osc.frequency.value = 880;
      } else {
        osc.frequency.value = 440;
      }

      osc.type = 'sine';

      const now = this.audioContext.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);

      osc.start(now);
      osc.stop(now + 0.3);

    } catch (e) {
      console.warn('Failed to play alert sound:', e);
    }
  }

  calculateDistanceNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065;

    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  toRadians(degrees) {
    return degrees * Math.PI / 180;
  }

  toDegrees(radians) {
    return radians * 180 / Math.PI;
  }

  calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = this.toRadians(lon2 - lon1);
    const lat1Rad = this.toRadians(lat1);
    const lat2Rad = this.toRadians(lat2);

    const x = Math.sin(dLon) * Math.cos(lat2Rad);
    const y = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

    let bearing = Math.atan2(x, y);
    bearing = this.toDegrees(bearing);
    bearing = (bearing + 360) % 360;

    return bearing;
  }

  onZoneAlert(callback) {
    this.onZoneAlertCallbacks.push(callback);
  }

  onRangeAlert(callback) {
    this.onRangeAlertCallbacks.push(callback);
  }

  onMeasurementUpdate(callback) {
    this.onMeasurementUpdateCallbacks.push(callback);
  }

  notifyMeasurementUpdate(data) {
    for (const callback of this.onMeasurementUpdateCallbacks) {
      try {
        callback(data);
      } catch (e) {
        console.error('Error in measurement callback:', e);
      }
    }
  }

  onZoneCreated(callback) {
    this.onZoneCreatedCallbacks.push(callback);
  }

  onRangeCreated(callback) {
    this.onRangeCreatedCallbacks.push(callback);
  }

  notifyZoneCreated(zone) {
    for (const callback of this.onZoneCreatedCallbacks) {
      try {
        callback(zone);
      } catch (e) {
        console.error('Error in zone created callback:', e);
      }
    }
  }

  notifyRangeCreated(range) {
    for (const callback of this.onRangeCreatedCallbacks) {
      try {
        callback(range);
      } catch (e) {
        console.error('Error in range created callback:', e);
      }
    }
  }

  getZoneForPersistence(zoneId) {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;

    let geometry;
    let centerLat = null;
    let centerLon = null;
    let radiusNm = null;

    if (zone.type === 'circle') {
      geometry = JSON.stringify(this.createCircleCoordinates(zone.center, zone.radiusNm));
      centerLat = zone.center[1];
      centerLon = zone.center[0];
      radiusNm = zone.radiusNm;
    } else {
      geometry = JSON.stringify(zone.coordinates);
    }

    return {
      id: zone.id,
      name: zone.name,
      type: zone.type,
      geometry: geometry,
      centerLat: centerLat,
      centerLon: centerLon,
      radiusNm: radiusNm,
      color: zone.color,
      alertOnEnter: zone.alertOnEnter,
      alertOnExit: zone.alertOnExit
    };
  }

  getAllZonesForPersistence() {
    const zones = [];
    for (const [id] of this.zones) {
      const zoneData = this.getZoneForPersistence(id);
      if (zoneData) {
        zones.push(zoneData);
      }
    }
    return zones;
  }

  restoreZone(zoneData) {
    try {
      let zone;

      if (zoneData.type === 'circle') {
        zone = {
          id: zoneData.id,
          type: 'circle',
          name: zoneData.name,
          center: [zoneData.centerLon, zoneData.centerLat],
          radiusNm: zoneData.radiusNm,
          color: zoneData.color,
          alertOnEnter: zoneData.alertOnEnter,
          alertOnExit: zoneData.alertOnExit
        };
      } else {
        zone = {
          id: zoneData.id,
          type: 'polygon',
          name: zoneData.name,
          coordinates: JSON.parse(zoneData.geometry),
          color: zoneData.color,
          alertOnEnter: zoneData.alertOnEnter,
          alertOnExit: zoneData.alertOnExit
        };
      }

      const idNum = parseInt(zone.id.replace('zone-', ''));
      if (!isNaN(idNum) && idNum >= this.zoneIdCounter) {
        this.zoneIdCounter = idNum + 1;
      }

      this.zones.set(zone.id, zone);
      this.tracksInZones.set(zone.id, new Set());

      console.log(`Zone restored from database: ${zone.name}`);
      return zone;
    } catch (error) {
      console.error(`Failed to restore zone ${zoneData.name}:`, error);
      return null;
    }
  }

  restoreAllZones(zonesData) {
    if (!Array.isArray(zonesData)) return;

    for (const zoneData of zonesData) {
      this.restoreZone(zoneData);
    }

    this.updateZonesDisplay();
    console.log(`Restored ${zonesData.length} zones from database`);
  }

  getRangeForPersistence(rangeId) {
    const range = this.trackRanges.get(rangeId);
    if (!range) return null;

    return {
      id: range.id,
      mmsi: range.mmsi,
      radiusNm: range.radiusNm,
      color: range.color,
      alertEnabled: range.alertEnabled
    };
  }

  getAllRangesForPersistence() {
    const ranges = [];
    for (const [id] of this.trackRanges) {
      const rangeData = this.getRangeForPersistence(id);
      if (rangeData) {
        ranges.push(rangeData);
      }
    }
    return ranges;
  }

  restoreRange(rangeData) {
    try {
      const range = {
        id: rangeData.id,
        mmsi: rangeData.mmsi,
        radiusNm: rangeData.radiusNm,
        color: rangeData.color,
        alertEnabled: rangeData.alertEnabled,
        name: `Range for ${rangeData.mmsi}`
      };

      const idNum = parseInt(range.id.replace('range-', ''));
      if (!isNaN(idNum) && idNum >= this.trackRangeIdCounter) {
        this.trackRangeIdCounter = idNum + 1;
      }

      this.trackRanges.set(range.id, range);
      this.tracksInRanges.set(range.id, new Set());

      console.log(`Range restored from database: ${range.mmsi}`);
      return range;
    } catch (error) {
      console.error(`Failed to restore range ${rangeData.mmsi}:`, error);
      return null;
    }
  }

  restoreAllRanges(rangesData) {
    if (!Array.isArray(rangesData)) return;

    for (const rangeData of rangesData) {
      this.restoreRange(rangeData);
    }

    this.updateTrackRangesDisplay();
    console.log(`Restored ${rangesData.length} ranges from database`);
  }

  destroy() {
    this.cancelDrawing();
    this.clearMeasurement();
    this.zones.clear();
    this.trackRanges.clear();
  }
}
