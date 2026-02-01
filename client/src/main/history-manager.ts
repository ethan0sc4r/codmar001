import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync, readFileSync, writeFileSync } from 'fs';

export interface HistoryPosition {
  id: number;
  timestamp: number;
  lat: number;
  lon: number;
  cog: number;
  sog: number;
  heading: number | null;
}

export interface AISMessageInput {
  mmsi: string;
  lat?: number;
  lon?: number;
  course?: number;
  speed?: number;
  heading?: number;
  timestamp?: number;
  source?: 'collector' | 'local';
}

export interface HistoryStats {
  enabled: boolean;
  totalVessels: number;
  totalPositions: number;
  totalSizeMB: number;
  oldestRecord: number | null;
  newestRecord: number | null;
}

interface LastSaved {
  timestamp: number;
  cog: number;
}

const PRUNE_TIME_MS = 10 * 60 * 1000;
const PRUNE_COG_DEGREES = 5;

let SQL: SqlJsStatic | null = null;
let historyEnabled = false;
let historyDir: string | null = null;
const openDatabases: Map<string, SqlJsDatabase> = new Map();
const lastSavedPositions: Map<string, LastSaved> = new Map();

function getHistoryDir(): string {
  if (historyDir) return historyDir;

  const userDataPath = app.getPath('userData');
  historyDir = join(userDataPath, 'data', 'history');

  if (!existsSync(historyDir)) {
    mkdirSync(historyDir, { recursive: true });
  }

  return historyDir;
}

function getDbPath(mmsi: string): string {
  return join(getHistoryDir(), `${mmsi}.db`);
}

function saveDb(mmsi: string): void {
  const db = openDatabases.get(mmsi);
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(getDbPath(mmsi), buffer);
  }
}

function getDatabase(mmsi: string): SqlJsDatabase | null {
  if (!SQL) return null;

  const existing = openDatabases.get(mmsi);
  if (existing) return existing;

  const dbPath = getDbPath(mmsi);
  let db: SqlJsDatabase;

  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      cog REAL NOT NULL,
      sog REAL NOT NULL,
      heading REAL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON positions(timestamp)`);

  openDatabases.set(mmsi, db);
  return db;
}

function closeDatabase(mmsi: string): void {
  const db = openDatabases.get(mmsi);
  if (db) {
    saveDb(mmsi);
    db.close();
    openDatabases.delete(mmsi);
  }
}

function angleDifference(a: number, b: number): number {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

function shouldSave(mmsi: string, timestamp: number, cog: number): boolean {
  const last = lastSavedPositions.get(mmsi);
  if (!last) return true;
  if (timestamp - last.timestamp >= PRUNE_TIME_MS) return true;
  if (angleDifference(cog, last.cog) >= PRUNE_COG_DEGREES) return true;
  return false;
}

export async function initHistoryManager(): Promise<void> {
  SQL = await initSqlJs();
  getHistoryDir();
  console.log(`History manager initialized. Directory: ${historyDir}`);
}

export function setHistoryEnabled(enabled: boolean): void {
  historyEnabled = enabled;
  console.log(`History recording ${enabled ? 'enabled' : 'disabled'}`);
}

export function isHistoryEnabled(): boolean {
  return historyEnabled;
}

export function processAISMessage(message: AISMessageInput): boolean {
  if (!historyEnabled) return false;
  if (!SQL) return false;
  if (message.source !== 'local') return false;
  if (message.lat === undefined || message.lon === undefined) return false;
  if (message.lat === 0 && message.lon === 0) return false;
  if (message.lat < -90 || message.lat > 90) return false;
  if (message.lon < -180 || message.lon > 180) return false;

  const mmsi = message.mmsi;
  const timestamp = message.timestamp || Date.now();
  const cog = message.course ?? 0;
  const sog = message.speed ?? 0;
  const heading = message.heading ?? null;

  if (!shouldSave(mmsi, timestamp, cog)) return false;

  try {
    const db = getDatabase(mmsi);
    if (!db) return false;

    db.run(
      `INSERT INTO positions (timestamp, lat, lon, cog, sog, heading) VALUES (?, ?, ?, ?, ?, ?)`,
      [timestamp, message.lat, message.lon, cog, sog, heading]
    );

    lastSavedPositions.set(mmsi, { timestamp, cog });
    saveDb(mmsi);

    return true;
  } catch (error) {
    console.error(`Failed to save history for MMSI ${mmsi}:`, error);
    return false;
  }
}

export function getHistory(mmsi: string, fromTimestamp?: number, toTimestamp?: number): HistoryPosition[] {
  if (!SQL) return [];
  const dbPath = getDbPath(mmsi);
  if (!existsSync(dbPath)) return [];

  try {
    const db = getDatabase(mmsi);
    if (!db) return [];

    let query = 'SELECT id, timestamp, lat, lon, cog, sog, heading FROM positions';
    const conditions: string[] = [];
    const params: number[] = [];

    if (fromTimestamp !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(fromTimestamp);
    }

    if (toTimestamp !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(toTimestamp);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY timestamp ASC';

    const stmt = db.prepare(query);
    stmt.bind(params);
    const results: HistoryPosition[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as HistoryPosition);
    }
    stmt.free();
    return results;
  } catch (error) {
    console.error(`Failed to get history for MMSI ${mmsi}:`, error);
    return [];
  }
}

export function pruneOldRecords(days: number): { deletedRecords: number; deletedFiles: number } {
  if (!SQL) return { deletedRecords: 0, deletedFiles: 0 };

  const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
  let deletedRecords = 0;
  let deletedFiles = 0;

  const dir = getHistoryDir();
  const files = readdirSync(dir).filter(f => f.endsWith('.db'));

  for (const file of files) {
    const mmsi = file.replace('.db', '');

    try {
      const db = getDatabase(mmsi);
      if (!db) continue;

      const countBefore = (db.exec('SELECT COUNT(*) FROM positions')[0]?.values[0]?.[0] as number) || 0;

      db.run('DELETE FROM positions WHERE timestamp < ?', [cutoffTime]);

      const countAfter = (db.exec('SELECT COUNT(*) FROM positions')[0]?.values[0]?.[0] as number) || 0;
      deletedRecords += countBefore - countAfter;

      if (countAfter === 0) {
        closeDatabase(mmsi);
        lastSavedPositions.delete(mmsi);

        const dbPath = getDbPath(mmsi);
        if (existsSync(dbPath)) {
          unlinkSync(dbPath);
          deletedFiles++;
        }
      } else {
        saveDb(mmsi);
      }
    } catch (error) {
      console.error(`Failed to prune history for MMSI ${mmsi}:`, error);
    }
  }

  console.log(`Pruned ${deletedRecords} records and ${deletedFiles} empty databases`);
  return { deletedRecords, deletedFiles };
}

export function clearAllHistory(): { deletedFiles: number } {
  let deletedFiles = 0;

  for (const [mmsi] of openDatabases) {
    const db = openDatabases.get(mmsi);
    if (db) db.close();
  }
  openDatabases.clear();
  lastSavedPositions.clear();

  const dir = getHistoryDir();
  const files = readdirSync(dir);

  for (const file of files) {
    try {
      const filePath = join(dir, file);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        if (file.endsWith('.db')) deletedFiles++;
      }
    } catch (error) {
      console.error(`Failed to delete file ${file}:`, error);
    }
  }

  console.log(`Cleared all history: ${deletedFiles} databases deleted`);
  return { deletedFiles };
}

export function getHistoryStats(): HistoryStats {
  const dir = getHistoryDir();
  const files = readdirSync(dir).filter(f => f.endsWith('.db'));

  let totalPositions = 0;
  let totalSizeBytes = 0;
  let oldestRecord: number | null = null;
  let newestRecord: number | null = null;

  for (const file of files) {
    const mmsi = file.replace('.db', '');
    const dbPath = getDbPath(mmsi);

    try {
      const stats = statSync(dbPath);
      totalSizeBytes += stats.size;

      if (!SQL) continue;

      const db = getDatabase(mmsi);
      if (!db) continue;

      const countResult = db.exec('SELECT COUNT(*) FROM positions');
      const count = (countResult[0]?.values[0]?.[0] as number) || 0;
      totalPositions += count;

      if (count > 0) {
        const minResult = db.exec('SELECT MIN(timestamp) FROM positions');
        const maxResult = db.exec('SELECT MAX(timestamp) FROM positions');

        const minTs = minResult[0]?.values[0]?.[0] as number;
        const maxTs = maxResult[0]?.values[0]?.[0] as number;

        if (oldestRecord === null || minTs < oldestRecord) {
          oldestRecord = minTs;
        }
        if (newestRecord === null || maxTs > newestRecord) {
          newestRecord = maxTs;
        }
      }
    } catch (error) {
      console.error(`Failed to get stats for MMSI ${mmsi}:`, error);
    }
  }

  return {
    enabled: historyEnabled,
    totalVessels: files.length,
    totalPositions,
    totalSizeMB: Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100,
    oldestRecord,
    newestRecord,
  };
}

export function getHistoryMMSIs(): string[] {
  const dir = getHistoryDir();
  return readdirSync(dir)
    .filter(f => f.endsWith('.db'))
    .map(f => f.replace('.db', ''));
}

export function closeAllHistoryDatabases(): void {
  for (const [mmsi] of openDatabases) {
    closeDatabase(mmsi);
  }
  console.log('All history databases closed');
}
