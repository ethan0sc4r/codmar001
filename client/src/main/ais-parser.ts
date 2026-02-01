export type AISMessageType = 1 | 2 | 3 | 5 | 18 | 19 | 24;

export interface AISMessage {
  type: number;
  mmsi: string;
  lat?: number;
  lon?: number;
  speed?: number;
  course?: number;
  heading?: number;
  status?: number;
  name?: string;
  imo?: string;
  callsign?: string;
  shiptype?: number;
  length?: number;
  width?: number;
  destination?: string;
  draught?: number;
  timestamp?: number;
  source?: 'collector' | 'local';
  isOwnShip?: boolean;
}

interface FragmentEntry {
  fragments: Map<number, string>;
  timestamp: number;
  isOwnShip: boolean;
}

export interface ParserStats {
  totalParsed: number;
  totalErrors: number;
  byType: Record<number, number>;
  fragmentsBuffered: number;
  fragmentsAssembled: number;
  fragmentsExpired: number;
  invalidSentences: number;
  invalidChecksum: number;
  invalidMmsi: number;
  fragmentsInBuffer: number;
  fragmentsDropped: number;
}

function charToSixBit(char: string): number {
  const code = char.charCodeAt(0);
  if (code >= 48 && code <= 87) {
    return code - 48;
  } else if (code >= 96 && code <= 119) {
    return code - 56;
  }
  return 0;
}

function payloadToBinary(payload: string): string {
  let binary = '';
  for (const char of payload) {
    const value = charToSixBit(char);
    binary += value.toString(2).padStart(6, '0');
  }
  return binary;
}

function getUnsigned(binary: string, start: number, length: number): number {
  const bits = binary.substring(start, start + length);
  return parseInt(bits, 2);
}

function getSigned(binary: string, start: number, length: number): number {
  const bits = binary.substring(start, start + length);
  let value = parseInt(bits, 2);
  if (bits[0] === '1') {
    value = value - Math.pow(2, length);
  }
  return value;
}

function getString(binary: string, start: number, length: number): string {
  let result = '';
  for (let i = 0; i < length; i += 6) {
    const charCode = getUnsigned(binary, start + i, 6);
    if (charCode === 0) break;
    if (charCode < 32) {
      result += String.fromCharCode(charCode + 64);
    } else {
      result += String.fromCharCode(charCode);
    }
  }
  return result.trim().replace(/@+$/, '');
}

const MAX_FRAGMENT_BUFFER_SIZE = 1000;
const FRAGMENT_TIMEOUT_MS = 30000;

export class AISParser {
  private fragmentBuffer: Map<string, FragmentEntry> = new Map();
  private fragmentTimeout: number = FRAGMENT_TIMEOUT_MS;
  private stats: ParserStats = {
    totalParsed: 0,
    totalErrors: 0,
    byType: {},
    fragmentsBuffered: 0,
    fragmentsAssembled: 0,
    fragmentsExpired: 0,
    invalidSentences: 0,
    invalidChecksum: 0,
    invalidMmsi: 0,
    fragmentsInBuffer: 0,
    fragmentsDropped: 0,
  };

  constructor(fragmentTimeoutMs: number = 60000) {
    this.fragmentTimeout = fragmentTimeoutMs;
  }

  parse(sentence: string, source: 'collector' | 'local' = 'collector'): AISMessage | null {
    try {
      sentence = sentence.trim();

      if (sentence.includes('VDO')) {
        console.log(`VDO INCOMING [${source}]: ${sentence}`);
      }

      if (!this.isValidNMEA(sentence)) {
        this.stats.invalidSentences++;
        return null;
      }

      sentence = this.fixCorruptedPrefix(sentence);
      this.expireOldFragments();

      const fields = this.parseNMEAFields(sentence);
      if (!fields) {
        this.stats.invalidSentences++;
        return null;
      }

      const result = this.handleFragments(fields, sentence);
      if (!result) {
        return null;
      }

      const message = this.decodePayload(result.payload, fields.fillBits);
      if (message) {
        message.timestamp = Date.now();
        message.source = source;
        message.isOwnShip = result.isOwnShip;
        this.stats.totalParsed++;
        this.stats.byType[message.type] = (this.stats.byType[message.type] || 0) + 1;

        if (result.isOwnShip) {
          console.log(`VDO RAW: ${sentence}`);
          console.log(`VDO PARSED: MMSI=${message.mmsi}, Type=${message.type}, Lat=${message.lat}, Lon=${message.lon}`);
        }
      }

      return message;

    } catch (error) {
      this.stats.totalErrors++;
      console.error('AIS parse error:', error, sentence);
      return null;
    }
  }

  private isValidNMEA(sentence: string): boolean {
    if (sentence.length < 15) return false;
    if (sentence.length > 256) return false;
    if (sentence[0] !== '!' && sentence[0] !== '$') return false;

    const validIds = ['AIVDM', 'ABVDM', 'AIVDO', 'ABVDO'];
    const hasValidId = validIds.some(id => sentence.includes(id));
    if (!hasValidId) return false;

    if (!sentence.includes('*')) return false;

    const checksumValid = this.verifyChecksum(sentence);
    if (!checksumValid) {
      this.stats.invalidChecksum++;
      return false;
    }

    return true;
  }

  private isValidMMSI(mmsi: string): boolean {
    if (!/^\d{9}$/.test(mmsi)) return false;
    const num = parseInt(mmsi, 10);
    if (num === 0 || num === 999999999) return false;
    return num >= 1 && num <= 999999999;
  }

  private verifyChecksum(sentence: string): boolean {
    const asteriskIndex = sentence.indexOf('*');
    if (asteriskIndex === -1 || asteriskIndex + 2 >= sentence.length) {
      return false;
    }

    const startIndex = sentence[0] === '!' || sentence[0] === '$' ? 1 : 0;
    const dataSection = sentence.substring(startIndex, asteriskIndex);

    let calculated = 0;
    for (let i = 0; i < dataSection.length; i++) {
      calculated ^= dataSection.charCodeAt(i);
    }

    const provided = parseInt(sentence.substring(asteriskIndex + 1, asteriskIndex + 3), 16);
    return calculated === provided;
  }

  private fixCorruptedPrefix(sentence: string): string {
    const patterns = [
      /^!AIV!AIVDM/,
      /^!ABV!ABVDM/,
      /^\$AIV\$AIVDM/,
    ];

    for (const pattern of patterns) {
      if (pattern.test(sentence)) {
        return sentence.replace(pattern, '!AIVDM');
      }
    }

    return sentence;
  }

  private parseNMEAFields(sentence: string): {
    fragmentCount: number;
    fragmentNum: number;
    seqId: string;
    channel: string;
    payload: string;
    fillBits: number;
    isOwnShip: boolean;
  } | null {
    try {
      const asteriskIndex = sentence.indexOf('*');
      const mainPart = asteriskIndex !== -1
        ? sentence.substring(0, asteriskIndex)
        : sentence;

      const parts = mainPart.split(',');
      if (parts.length < 7) return null;

      const isOwnShip = parts[0].includes('VDO');

      return {
        fragmentCount: parseInt(parts[1]) || 1,
        fragmentNum: parseInt(parts[2]) || 1,
        seqId: parts[3] || '',
        channel: parts[4] || 'A',
        payload: parts[5] || '',
        fillBits: parseInt(parts[6]) || 0,
        isOwnShip,
      };
    } catch {
      return null;
    }
  }

  private handleFragments(fields: {
    fragmentCount: number;
    fragmentNum: number;
    seqId: string;
    channel: string;
    payload: string;
    isOwnShip: boolean;
  }, _sentence: string): { payload: string; isOwnShip: boolean } | null {
    const { fragmentCount, fragmentNum, seqId, channel, payload, isOwnShip } = fields;

    if (fragmentCount === 1) {
      return { payload, isOwnShip };
    }

    if (this.fragmentBuffer.size >= MAX_FRAGMENT_BUFFER_SIZE) {
      this.expireOldestFragments(100);
      this.stats.fragmentsDropped++;

      if (this.fragmentBuffer.size >= MAX_FRAGMENT_BUFFER_SIZE) {
        console.warn('[AIS] Fragment buffer full, dropping fragment');
        this.stats.fragmentsDropped++;
        return null;
      }
    }

    const bufferKey = `${fragmentCount}-${seqId}-${channel}`;

    let entry = this.fragmentBuffer.get(bufferKey);
    if (!entry) {
      entry = {
        fragments: new Map(),
        timestamp: Date.now(),
        isOwnShip: isOwnShip,
      };
      this.fragmentBuffer.set(bufferKey, entry);
    } else if (isOwnShip) {
      entry.isOwnShip = true;
    }

    entry.fragments.set(fragmentNum, payload);
    entry.timestamp = Date.now();
    this.stats.fragmentsBuffered++;

    if (entry.fragments.size === fragmentCount) {
      let assembledPayload = '';
      for (let i = 1; i <= fragmentCount; i++) {
        const frag = entry.fragments.get(i);
        if (!frag) {
          return null;
        }
        assembledPayload += frag;
      }

      const wasOwnShip = entry.isOwnShip;
      this.fragmentBuffer.delete(bufferKey);
      this.stats.fragmentsAssembled++;

      return { payload: assembledPayload, isOwnShip: wasOwnShip };
    }

    this.stats.fragmentsInBuffer = this.fragmentBuffer.size;
    return null;
  }

  private expireOldFragments(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.fragmentBuffer) {
      if (now - entry.timestamp > this.fragmentTimeout) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.fragmentBuffer.delete(key);
      this.stats.fragmentsExpired++;
    }

    this.stats.fragmentsInBuffer = this.fragmentBuffer.size;
  }

  private expireOldestFragments(count: number): void {
    const entries = Array.from(this.fragmentBuffer.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, count);
    for (const [key] of toRemove) {
      this.fragmentBuffer.delete(key);
      this.stats.fragmentsExpired++;
    }

    this.stats.fragmentsInBuffer = this.fragmentBuffer.size;
  }

  private decodePayload(payload: string, _fillBits: number): AISMessage | null {
    if (!payload || payload.length < 1) return null;

    const binary = payloadToBinary(payload);
    if (binary.length < 38) return null;

    const messageType = getUnsigned(binary, 0, 6);
    const mmsi = getUnsigned(binary, 8, 30).toString().padStart(9, '0');

    if (!this.isValidMMSI(mmsi)) {
      this.stats.invalidMmsi++;
      return null;
    }

    switch (messageType) {
      case 1:
      case 2:
      case 3:
        return this.decodePositionReportClassA(binary, messageType, mmsi);
      case 5:
        return this.decodeStaticAndVoyageData(binary, mmsi);
      case 18:
        return this.decodePositionReportClassB(binary, mmsi);
      case 19:
        return this.decodeExtendedClassBPosition(binary, mmsi);
      case 24:
        return this.decodeStaticDataReport(binary, mmsi);
      default:
        return { type: messageType, mmsi };
    }
  }

  private decodePositionReportClassA(binary: string, type: number, mmsi: string): AISMessage {
    if (binary.length < 168) {
      return { type, mmsi };
    }

    const status = getUnsigned(binary, 38, 4);
    const rot = getSigned(binary, 42, 8);
    const speedRaw = getUnsigned(binary, 50, 10);
    const posAccuracy = getUnsigned(binary, 60, 1);
    const lonRaw = getSigned(binary, 61, 28);
    const latRaw = getSigned(binary, 89, 27);
    const courseRaw = getUnsigned(binary, 116, 12);
    const headingRaw = getUnsigned(binary, 128, 9);

    const lon = lonRaw / 600000.0;
    const lat = latRaw / 600000.0;
    const speed = speedRaw === 1023 ? undefined : speedRaw / 10.0;
    const course = courseRaw === 3600 ? undefined : courseRaw / 10.0;
    const heading = headingRaw === 511 ? undefined : headingRaw;

    const message: AISMessage = { type, mmsi, status };

    if (lat >= -90 && lat <= 90 && lat !== 91 && lon >= -180 && lon <= 180 && lon !== 181) {
      message.lat = lat;
      message.lon = lon;
    }

    if (speed !== undefined) message.speed = speed;
    if (course !== undefined) message.course = course;
    if (heading !== undefined) message.heading = heading;

    return message;
  }

  private decodeStaticAndVoyageData(binary: string, mmsi: string): AISMessage {
    if (binary.length < 424) {
      return { type: 5, mmsi };
    }

    const aisVersion = getUnsigned(binary, 38, 2);
    const imoRaw = getUnsigned(binary, 40, 30);
    const callsign = getString(binary, 70, 42);
    const name = getString(binary, 112, 120);
    const shiptype = getUnsigned(binary, 232, 8);
    const toBow = getUnsigned(binary, 240, 9);
    const toStern = getUnsigned(binary, 249, 9);
    const toPort = getUnsigned(binary, 258, 6);
    const toStarboard = getUnsigned(binary, 264, 6);
    const draughtRaw = getUnsigned(binary, 294, 8);
    const destination = getString(binary, 302, 120);

    const message: AISMessage = {
      type: 5,
      mmsi,
    };

    if (imoRaw > 0) message.imo = imoRaw.toString();
    if (callsign) message.callsign = callsign;
    if (name) message.name = name;
    if (shiptype > 0) message.shiptype = shiptype;
    if (toBow + toStern > 0) message.length = toBow + toStern;
    if (toPort + toStarboard > 0) message.width = toPort + toStarboard;
    if (draughtRaw > 0) message.draught = draughtRaw / 10.0;
    if (destination) message.destination = destination;

    return message;
  }

  private decodePositionReportClassB(binary: string, mmsi: string): AISMessage {
    if (binary.length < 168) {
      return { type: 18, mmsi };
    }

    const speedRaw = getUnsigned(binary, 46, 10);
    const lonRaw = getSigned(binary, 57, 28);
    const latRaw = getSigned(binary, 85, 27);
    const courseRaw = getUnsigned(binary, 112, 12);
    const headingRaw = getUnsigned(binary, 124, 9);

    const lon = lonRaw / 600000.0;
    const lat = latRaw / 600000.0;
    const speed = speedRaw === 1023 ? undefined : speedRaw / 10.0;
    const course = courseRaw === 3600 ? undefined : courseRaw / 10.0;
    const heading = headingRaw === 511 ? undefined : headingRaw;

    const message: AISMessage = { type: 18, mmsi };

    if (lat >= -90 && lat <= 90 && lat !== 91 && lon >= -180 && lon <= 180 && lon !== 181) {
      message.lat = lat;
      message.lon = lon;
    }

    if (speed !== undefined) message.speed = speed;
    if (course !== undefined) message.course = course;
    if (heading !== undefined) message.heading = heading;

    return message;
  }

  private decodeExtendedClassBPosition(binary: string, mmsi: string): AISMessage {
    if (binary.length < 312) {
      return { type: 19, mmsi };
    }

    const speedRaw = getUnsigned(binary, 46, 10);
    const lonRaw = getSigned(binary, 57, 28);
    const latRaw = getSigned(binary, 85, 27);
    const courseRaw = getUnsigned(binary, 112, 12);
    const headingRaw = getUnsigned(binary, 124, 9);
    const name = getString(binary, 143, 120);
    const shiptype = getUnsigned(binary, 263, 8);
    const toBow = getUnsigned(binary, 271, 9);
    const toStern = getUnsigned(binary, 280, 9);
    const toPort = getUnsigned(binary, 289, 6);
    const toStarboard = getUnsigned(binary, 295, 6);

    const lon = lonRaw / 600000.0;
    const lat = latRaw / 600000.0;
    const speed = speedRaw === 1023 ? undefined : speedRaw / 10.0;
    const course = courseRaw === 3600 ? undefined : courseRaw / 10.0;
    const heading = headingRaw === 511 ? undefined : headingRaw;

    const message: AISMessage = { type: 19, mmsi };

    if (lat >= -90 && lat <= 90 && lat !== 91 && lon >= -180 && lon <= 180 && lon !== 181) {
      message.lat = lat;
      message.lon = lon;
    }

    if (speed !== undefined) message.speed = speed;
    if (course !== undefined) message.course = course;
    if (heading !== undefined) message.heading = heading;
    if (name) message.name = name;
    if (shiptype > 0) message.shiptype = shiptype;
    if (toBow + toStern > 0) message.length = toBow + toStern;
    if (toPort + toStarboard > 0) message.width = toPort + toStarboard;

    return message;
  }

  private decodeStaticDataReport(binary: string, mmsi: string): AISMessage {
    if (binary.length < 160) {
      return { type: 24, mmsi };
    }

    const partNumber = getUnsigned(binary, 38, 2);

    const message: AISMessage = { type: 24, mmsi };

    if (partNumber === 0) {
      const name = getString(binary, 40, 120);
      if (name) message.name = name;
    } else if (partNumber === 1) {
      const shiptype = getUnsigned(binary, 40, 8);
      const vendorId = getString(binary, 48, 18);
      const callsign = getString(binary, 90, 42);
      const toBow = getUnsigned(binary, 132, 9);
      const toStern = getUnsigned(binary, 141, 9);
      const toPort = getUnsigned(binary, 150, 6);
      const toStarboard = getUnsigned(binary, 156, 6);

      if (shiptype > 0) message.shiptype = shiptype;
      if (callsign) message.callsign = callsign;
      if (toBow + toStern > 0) message.length = toBow + toStern;
      if (toPort + toStarboard > 0) message.width = toPort + toStarboard;
    }

    return message;
  }

  getStats(): ParserStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalParsed: 0,
      totalErrors: 0,
      byType: {},
      fragmentsBuffered: 0,
      fragmentsAssembled: 0,
      fragmentsExpired: 0,
      invalidSentences: 0,
      invalidChecksum: 0,
      invalidMmsi: 0,
      fragmentsInBuffer: 0,
      fragmentsDropped: 0,
    };
  }

  clearFragmentBuffer(): void {
    this.fragmentBuffer.clear();
    this.stats.fragmentsInBuffer = 0;
  }
}
