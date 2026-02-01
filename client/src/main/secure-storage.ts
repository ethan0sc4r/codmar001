import { safeStorage } from 'electron';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

function getSecureStoragePath(): string {
  const userDataPath = app.getPath('userData');
  const secureDir = join(userDataPath, 'secure');

  if (!existsSync(secureDir)) {
    mkdirSync(secureDir, { recursive: true });
  }

  return join(secureDir, 'credentials.enc');
}

interface SecureCredentials {
  wsToken?: string;
  apiKey?: string;
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function saveSecureCredentials(credentials: SecureCredentials): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[SecureStorage] Encryption not available on this system');
      return false;
    }

    const data = JSON.stringify(credentials);
    const encrypted = safeStorage.encryptString(data);

    const filePath = getSecureStoragePath();
    writeFileSync(filePath, encrypted);

    console.log('[SecureStorage] Credentials saved securely');
    return true;
  } catch (error) {
    console.error('[SecureStorage] Failed to save credentials:', error);
    return false;
  }
}

export function loadSecureCredentials(): SecureCredentials | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[SecureStorage] Encryption not available on this system');
      return null;
    }

    const filePath = getSecureStoragePath();

    if (!existsSync(filePath)) {
      return null;
    }

    const encrypted = readFileSync(filePath);
    const decrypted = safeStorage.decryptString(encrypted);

    return JSON.parse(decrypted) as SecureCredentials;
  } catch (error) {
    console.error('[SecureStorage] Failed to load credentials:', error);
    return null;
  }
}

export function saveWSToken(token: string): boolean {
  const credentials = loadSecureCredentials() || {};
  credentials.wsToken = token;
  return saveSecureCredentials(credentials);
}

export function loadWSToken(): string | undefined {
  const credentials = loadSecureCredentials();
  return credentials?.wsToken;
}

export function saveApiKey(apiKey: string): boolean {
  const credentials = loadSecureCredentials() || {};
  credentials.apiKey = apiKey;
  return saveSecureCredentials(credentials);
}

export function loadApiKey(): string | undefined {
  const credentials = loadSecureCredentials();
  return credentials?.apiKey;
}

export function clearSecureCredentials(): boolean {
  try {
    const filePath = getSecureStoragePath();

    if (existsSync(filePath)) {
      const { unlinkSync } = require('fs');
      unlinkSync(filePath);
    }

    console.log('[SecureStorage] Credentials cleared');
    return true;
  } catch (error) {
    console.error('[SecureStorage] Failed to clear credentials:', error);
    return false;
  }
}
