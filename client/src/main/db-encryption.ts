import { safeStorage } from 'electron';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';

function getKeyPath(): string {
  const userDataPath = app.getPath('userData');
  const secureDir = join(userDataPath, 'secure');

  if (!existsSync(secureDir)) {
    mkdirSync(secureDir, { recursive: true });
  }

  return join(secureDir, 'db.key');
}

function generateKey(): string {
  return randomBytes(32).toString('hex');
}

export function getDatabaseKey(): string | null {
  try {
    const keyPath = getKeyPath();

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[DB-Encryption] System encryption not available');
      console.warn('[DB-Encryption] Database will NOT be encrypted');
      return null;
    }

    if (existsSync(keyPath)) {
      const encrypted = readFileSync(keyPath);
      const key = safeStorage.decryptString(encrypted);
      console.log('[DB-Encryption] Database key loaded');
      return key;
    }

    const newKey = generateKey();
    const encrypted = safeStorage.encryptString(newKey);
    writeFileSync(keyPath, encrypted);
    console.log('[DB-Encryption] New database key generated and saved');

    return newKey;
  } catch (error) {
    console.error('[DB-Encryption] Failed to get/create database key:', error);
    return null;
  }
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function clearDatabaseKey(): boolean {
  try {
    const keyPath = getKeyPath();
    if (existsSync(keyPath)) {
      const { unlinkSync } = require('fs');
      unlinkSync(keyPath);
      console.log('[DB-Encryption] Database key deleted');
    }
    return true;
  } catch (error) {
    console.error('[DB-Encryption] Failed to delete database key:', error);
    return false;
  }
}
