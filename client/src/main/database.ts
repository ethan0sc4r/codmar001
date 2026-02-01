import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

export interface CustomLayer {
  id: string;
  name: string;
  type: 'geojson' | 'shapefile';
  geojson: string;
  color: string;
  opacity: number;
  visible: boolean;
  labelConfig: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeofenceZone {
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
  createdAt: string;
  updatedAt: string;
}

export interface TrackRange {
  id: string;
  mmsi: string;
  radiusNm: number;
  color: string;
  alertEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NonRealtimeTrack {
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
  createdAt: string;
  updatedAt: string;
}

export interface LocalWatchlistVessel {
  id: string;
  mmsi: string | null;
  imo: string | null;
  name: string | null;
  callsign: string | null;
  color: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

let db: SqlJsDatabase | null = null;
let dbPath: string = '';
let saveTimer: NodeJS.Timeout | null = null;

function getDatabasePath(): string {
  const userDataPath = app.getPath('userData');
  const dataDir = join(userDataPath, 'data');

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  return join(dataDir, 'darkfleet-client.db');
}

function scheduleSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveDatabase();
  }, 1000);
}

function saveDatabase(): void {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  }
}

export async function initDatabase(): Promise<void> {
  if (db) {
    return;
  }

  dbPath = getDatabasePath();

  if (process.env.NODE_ENV === 'development') {
    console.log(`[DB] Initializing database at: ${dbPath}`);
  } else {
    console.log('[DB] Initializing database...');
  }

  const SQL = await initSqlJs();

  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    console.log('[DB] Existing database loaded');
  } else {
    db = new SQL.Database();
    console.log('[DB] New database created');
  }

  createTables();
  console.log('[DB] Database initialized successfully');
}

export function initDatabaseSync(): void {
}

function createTables(): void {
  if (!db) throw new Error('Database not initialized');

  db.run(`
    CREATE TABLE IF NOT EXISTS custom_layers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'geojson',
      geojson TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3388ff',
      opacity REAL NOT NULL DEFAULT 0.6,
      visible INTEGER NOT NULL DEFAULT 1,
      label_config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS geofence_zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      geometry TEXT NOT NULL,
      center_lat REAL,
      center_lon REAL,
      radius_nm REAL,
      color TEXT NOT NULL DEFAULT '#ff6600',
      alert_on_enter INTEGER NOT NULL DEFAULT 1,
      alert_on_exit INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS track_ranges (
      id TEXT PRIMARY KEY,
      mmsi TEXT NOT NULL,
      radius_nm REAL NOT NULL,
      color TEXT NOT NULL DEFAULT '#00ff00',
      alert_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS nonrealtime_tracks (
      id TEXT PRIMARY KEY,
      mmsi TEXT NOT NULL UNIQUE,
      name TEXT,
      imo TEXT,
      callsign TEXT,
      shiptype INTEGER,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      cog REAL NOT NULL DEFAULT 0,
      sog REAL NOT NULL DEFAULT 0,
      heading REAL,
      is_realtime INTEGER NOT NULL DEFAULT 0,
      activated_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS local_watchlist (
      id TEXT PRIMARY KEY,
      mmsi TEXT,
      imo TEXT,
      name TEXT,
      callsign TEXT,
      color TEXT NOT NULL DEFAULT '#ff0000',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_layers_name ON custom_layers(name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_zones_type ON geofence_zones(type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ranges_mmsi ON track_ranges(mmsi)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_nrt_mmsi ON nonrealtime_tracks(mmsi)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_nrt_realtime ON nonrealtime_tracks(is_realtime)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_local_watchlist_mmsi ON local_watchlist(mmsi)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_local_watchlist_imo ON local_watchlist(imo)`);

  scheduleSave();
}

export function closeDatabase(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    console.log('Database closed');
  }
}

function queryAll<T>(sql: string, params: any[] = []): T[] {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

function queryOne<T>(sql: string, params: any[] = []): T | undefined {
  const results = queryAll<T>(sql, params);
  return results[0];
}

function run(sql: string, params: any[] = []): void {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params);
  scheduleSave();
}

export function getAllLayers(): CustomLayer[] {
  return queryAll<any>(`
    SELECT id, name, type, geojson, color, opacity, visible,
           label_config as labelConfig, created_at as createdAt, updated_at as updatedAt
    FROM custom_layers ORDER BY created_at DESC
  `).map(row => ({ ...row, visible: Boolean(row.visible) }));
}

export function getLayer(id: string): CustomLayer | undefined {
  const row = queryOne<any>(`
    SELECT id, name, type, geojson, color, opacity, visible,
           label_config as labelConfig, created_at as createdAt, updated_at as updatedAt
    FROM custom_layers WHERE id = ?
  `, [id]);
  return row ? { ...row, visible: Boolean(row.visible) } : undefined;
}

export function saveLayer(layer: Omit<CustomLayer, 'createdAt' | 'updatedAt'>): void {
  run(`
    INSERT OR REPLACE INTO custom_layers
    (id, name, type, geojson, color, opacity, visible, label_config, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [layer.id, layer.name, layer.type, layer.geojson, layer.color, layer.opacity, layer.visible ? 1 : 0, layer.labelConfig]);
}

export function updateLayerStyle(id: string, color: string, opacity: number): void {
  run(`UPDATE custom_layers SET color = ?, opacity = ?, updated_at = datetime('now') WHERE id = ?`, [color, opacity, id]);
}

export function updateLayerLabels(id: string, labelConfig: string | null): void {
  run(`UPDATE custom_layers SET label_config = ?, updated_at = datetime('now') WHERE id = ?`, [labelConfig, id]);
}

export function updateLayerVisibility(id: string, visible: boolean): void {
  run(`UPDATE custom_layers SET visible = ?, updated_at = datetime('now') WHERE id = ?`, [visible ? 1 : 0, id]);
}

export function deleteLayer(id: string): void {
  run('DELETE FROM custom_layers WHERE id = ?', [id]);
}

export function getAllZones(): GeofenceZone[] {
  return queryAll<any>(`
    SELECT id, name, type, geometry,
           center_lat as centerLat, center_lon as centerLon, radius_nm as radiusNm,
           color, alert_on_enter as alertOnEnter, alert_on_exit as alertOnExit,
           created_at as createdAt, updated_at as updatedAt
    FROM geofence_zones ORDER BY created_at DESC
  `).map(row => ({
    ...row,
    alertOnEnter: Boolean(row.alertOnEnter),
    alertOnExit: Boolean(row.alertOnExit)
  }));
}

export function getZone(id: string): GeofenceZone | undefined {
  const row = queryOne<any>(`
    SELECT id, name, type, geometry,
           center_lat as centerLat, center_lon as centerLon, radius_nm as radiusNm,
           color, alert_on_enter as alertOnEnter, alert_on_exit as alertOnExit,
           created_at as createdAt, updated_at as updatedAt
    FROM geofence_zones WHERE id = ?
  `, [id]);
  return row ? { ...row, alertOnEnter: Boolean(row.alertOnEnter), alertOnExit: Boolean(row.alertOnExit) } : undefined;
}

export function saveZone(zone: Omit<GeofenceZone, 'createdAt' | 'updatedAt'>): void {
  run(`
    INSERT OR REPLACE INTO geofence_zones
    (id, name, type, geometry, center_lat, center_lon, radius_nm, color, alert_on_enter, alert_on_exit, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [zone.id, zone.name, zone.type, zone.geometry, zone.centerLat, zone.centerLon, zone.radiusNm, zone.color, zone.alertOnEnter ? 1 : 0, zone.alertOnExit ? 1 : 0]);
}

export function updateZoneAlerts(id: string, alertOnEnter: boolean, alertOnExit: boolean): void {
  run(`UPDATE geofence_zones SET alert_on_enter = ?, alert_on_exit = ?, updated_at = datetime('now') WHERE id = ?`, [alertOnEnter ? 1 : 0, alertOnExit ? 1 : 0, id]);
}

export function deleteZone(id: string): void {
  run('DELETE FROM geofence_zones WHERE id = ?', [id]);
}

export function getAllRanges(): TrackRange[] {
  return queryAll<any>(`
    SELECT id, mmsi, radius_nm as radiusNm, color, alert_enabled as alertEnabled,
           created_at as createdAt, updated_at as updatedAt
    FROM track_ranges ORDER BY created_at DESC
  `).map(row => ({ ...row, alertEnabled: Boolean(row.alertEnabled) }));
}

export function getRange(id: string): TrackRange | undefined {
  const row = queryOne<any>(`
    SELECT id, mmsi, radius_nm as radiusNm, color, alert_enabled as alertEnabled,
           created_at as createdAt, updated_at as updatedAt
    FROM track_ranges WHERE id = ?
  `, [id]);
  return row ? { ...row, alertEnabled: Boolean(row.alertEnabled) } : undefined;
}

export function saveRange(range: Omit<TrackRange, 'createdAt' | 'updatedAt'>): void {
  run(`
    INSERT OR REPLACE INTO track_ranges (id, mmsi, radius_nm, color, alert_enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `, [range.id, range.mmsi, range.radiusNm, range.color, range.alertEnabled ? 1 : 0]);
}

export function updateRangeAlert(id: string, alertEnabled: boolean): void {
  run(`UPDATE track_ranges SET alert_enabled = ?, updated_at = datetime('now') WHERE id = ?`, [alertEnabled ? 1 : 0, id]);
}

export function deleteRange(id: string): void {
  run('DELETE FROM track_ranges WHERE id = ?', [id]);
}

export function clearAllData(): void {
  run('DELETE FROM custom_layers');
  run('DELETE FROM geofence_zones');
  run('DELETE FROM track_ranges');
}

export function getStats(): { layers: number; zones: number; ranges: number; nrtTracks: number; localWatchlist: number } {
  const layers = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM custom_layers')?.count || 0;
  const zones = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM geofence_zones')?.count || 0;
  const ranges = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM track_ranges')?.count || 0;
  const nrtTracks = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM nonrealtime_tracks')?.count || 0;
  const localWatchlist = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM local_watchlist')?.count || 0;

  return { layers, zones, ranges, nrtTracks, localWatchlist };
}

export function getAllNonRealtimeTracks(): NonRealtimeTrack[] {
  return queryAll<any>(`
    SELECT id, mmsi, name, imo, callsign, shiptype, lat, lon, cog, sog, heading,
           is_realtime as isRealtime, activated_at as activatedAt, notes,
           created_at as createdAt, updated_at as updatedAt
    FROM nonrealtime_tracks ORDER BY created_at DESC
  `).map(row => ({ ...row, isRealtime: Boolean(row.isRealtime) }));
}

export function getNonRealtimeTrack(id: string): NonRealtimeTrack | undefined {
  const row = queryOne<any>(`
    SELECT id, mmsi, name, imo, callsign, shiptype, lat, lon, cog, sog, heading,
           is_realtime as isRealtime, activated_at as activatedAt, notes,
           created_at as createdAt, updated_at as updatedAt
    FROM nonrealtime_tracks WHERE id = ?
  `, [id]);
  return row ? { ...row, isRealtime: Boolean(row.isRealtime) } : undefined;
}

export function getNonRealtimeTrackByMmsi(mmsi: string): NonRealtimeTrack | undefined {
  const row = queryOne<any>(`
    SELECT id, mmsi, name, imo, callsign, shiptype, lat, lon, cog, sog, heading,
           is_realtime as isRealtime, activated_at as activatedAt, notes,
           created_at as createdAt, updated_at as updatedAt
    FROM nonrealtime_tracks WHERE mmsi = ?
  `, [mmsi]);
  return row ? { ...row, isRealtime: Boolean(row.isRealtime) } : undefined;
}

export function saveNonRealtimeTrack(track: Omit<NonRealtimeTrack, 'createdAt' | 'updatedAt'>): void {
  run(`
    INSERT OR REPLACE INTO nonrealtime_tracks
    (id, mmsi, name, imo, callsign, shiptype, lat, lon, cog, sog, heading, is_realtime, activated_at, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [track.id, track.mmsi, track.name, track.imo, track.callsign, track.shiptype, track.lat, track.lon, track.cog, track.sog, track.heading, track.isRealtime ? 1 : 0, track.activatedAt, track.notes]);
}

export function updateNonRealtimeTrackPosition(id: string, lat: number, lon: number): void {
  run(`UPDATE nonrealtime_tracks SET lat = ?, lon = ?, updated_at = datetime('now') WHERE id = ?`, [lat, lon, id]);
}

export function updateNonRealtimeTrackCourse(id: string, cog: number, sog: number): void {
  run(`UPDATE nonrealtime_tracks SET cog = ?, sog = ?, updated_at = datetime('now') WHERE id = ?`, [cog, sog, id]);
}

export function updateNonRealtimeTrackData(
  id: string,
  data: { name?: string; imo?: string; callsign?: string; shiptype?: number; notes?: string }
): void {
  const updates: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
  if (data.imo !== undefined) { updates.push('imo = ?'); values.push(data.imo); }
  if (data.callsign !== undefined) { updates.push('callsign = ?'); values.push(data.callsign); }
  if (data.shiptype !== undefined) { updates.push('shiptype = ?'); values.push(data.shiptype); }
  if (data.notes !== undefined) { updates.push('notes = ?'); values.push(data.notes); }

  if (updates.length === 0) return;

  updates.push("updated_at = datetime('now')");
  values.push(id);

  run(`UPDATE nonrealtime_tracks SET ${updates.join(', ')} WHERE id = ?`, values);
}

export function activateNonRealtimeTrack(id: string): void {
  run(`UPDATE nonrealtime_tracks SET is_realtime = 1, activated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [id]);
}

export function activateNonRealtimeTrackByMmsi(mmsi: string): boolean {
  if (!db) throw new Error('Database not initialized');
  run(`UPDATE nonrealtime_tracks SET is_realtime = 1, activated_at = datetime('now'), updated_at = datetime('now') WHERE mmsi = ? AND is_realtime = 0`, [mmsi]);
  return db.getRowsModified() > 0;
}

export function deleteNonRealtimeTrack(id: string): void {
  run('DELETE FROM nonrealtime_tracks WHERE id = ?', [id]);
}

export function getActiveNonRealtimeTracks(): NonRealtimeTrack[] {
  return queryAll<any>(`
    SELECT id, mmsi, name, imo, callsign, shiptype, lat, lon, cog, sog, heading,
           is_realtime as isRealtime, activated_at as activatedAt, notes,
           created_at as createdAt, updated_at as updatedAt
    FROM nonrealtime_tracks WHERE is_realtime = 0 ORDER BY created_at DESC
  `).map(row => ({ ...row, isRealtime: Boolean(row.isRealtime) }));
}

export function getAllLocalWatchlist(): LocalWatchlistVessel[] {
  return queryAll<LocalWatchlistVessel>(`
    SELECT id, mmsi, imo, name, callsign, color, notes,
           created_at as createdAt, updated_at as updatedAt
    FROM local_watchlist ORDER BY created_at DESC
  `);
}

export function getLocalWatchlistVessel(id: string): LocalWatchlistVessel | undefined {
  return queryOne<LocalWatchlistVessel>(`
    SELECT id, mmsi, imo, name, callsign, color, notes,
           created_at as createdAt, updated_at as updatedAt
    FROM local_watchlist WHERE id = ?
  `, [id]);
}

export function saveLocalWatchlistVessel(vessel: Omit<LocalWatchlistVessel, 'createdAt' | 'updatedAt'>): void {
  run(`
    INSERT OR REPLACE INTO local_watchlist (id, mmsi, imo, name, callsign, color, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [vessel.id, vessel.mmsi, vessel.imo, vessel.name, vessel.callsign, vessel.color, vessel.notes]);
}

export function updateLocalWatchlistVessel(
  id: string,
  data: { mmsi?: string; imo?: string; name?: string; callsign?: string; color?: string; notes?: string }
): void {
  const updates: string[] = [];
  const values: any[] = [];

  if (data.mmsi !== undefined) { updates.push('mmsi = ?'); values.push(data.mmsi); }
  if (data.imo !== undefined) { updates.push('imo = ?'); values.push(data.imo); }
  if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
  if (data.callsign !== undefined) { updates.push('callsign = ?'); values.push(data.callsign); }
  if (data.color !== undefined) { updates.push('color = ?'); values.push(data.color); }
  if (data.notes !== undefined) { updates.push('notes = ?'); values.push(data.notes); }

  if (updates.length === 0) return;

  updates.push("updated_at = datetime('now')");
  values.push(id);

  run(`UPDATE local_watchlist SET ${updates.join(', ')} WHERE id = ?`, values);
}

export function deleteLocalWatchlistVessel(id: string): void {
  run('DELETE FROM local_watchlist WHERE id = ?', [id]);
}

export function clearLocalWatchlist(): void {
  run('DELETE FROM local_watchlist');
}

export function importLocalWatchlist(vessels: Omit<LocalWatchlistVessel, 'createdAt' | 'updatedAt'>[]): number {
  let count = 0;
  for (const vessel of vessels) {
    run(`
      INSERT OR REPLACE INTO local_watchlist (id, mmsi, imo, name, callsign, color, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `, [vessel.id, vessel.mmsi, vessel.imo, vessel.name, vessel.callsign, vessel.color, vessel.notes]);
    count++;
  }
  return count;
}
