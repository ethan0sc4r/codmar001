/**
 * DarkFleet Shared TypeScript Definitions
 * ========================================
 * Common types used by both server and client
 */

// ============================================================================
// AIS Data Types
// ============================================================================

/**
 * Position coordinates in decimal degrees
 */
export interface Position {
  lat: number;  // Latitude: -90 to +90
  lon: number;  // Longitude: -180 to +180
}

/**
 * Raw AIS message data parsed from NMEA sentence
 */
export interface AISMessage {
  mmsi: string;              // Maritime Mobile Service Identity (9 digits)
  type: number;              // AIS message type (1-27)
  timestamp: string;         // ISO 8601 timestamp
  position?: Position;       // Position (if available in message)
  cog?: number;             // Course Over Ground (degrees, 0-359.9)
  sog?: number;             // Speed Over Ground (knots)
  heading?: number;         // True heading (degrees, 0-359)
  name?: string;            // Vessel name (from type 5 static data)
  imo?: string;             // IMO number (7 digits, from type 5)
  callsign?: string;        // Callsign
  ship_type?: number;       // Ship type code
  draught?: number;         // Draught in meters
  destination?: string;     // Destination port
}

// ============================================================================
// Watchlist Types
// ============================================================================

/**
 * Watchlist metadata (from API /api/lists endpoint)
 */
export interface WatchlistMetadata {
  list_id: string;          // Unique list identifier
  list_name: string;        // Human-readable name
  color: string;            // Hex color code (e.g., "#FF0000")
}

/**
 * Vessel in watchlist (from API /api/vessels endpoint)
 */
export interface WatchlistVessel {
  mmsi: string;             // MMSI to match against
  imo?: string;             // IMO number (optional)
  list_id: string;          // Reference to watchlist
}

/**
 * Complete vessel with all associated lists
 */
export interface VesselWithLists {
  mmsi: string;
  imo?: string;
  lists: WatchlistMetadata[];  // Can be in multiple lists
}

// ============================================================================
// WebSocket Protocol Types
// ============================================================================

/**
 * WebSocket message types (server → client)
 */
export enum WSMessageType {
  TRACK_UPDATE = 'track_update',      // New/updated vessel position
  WATCHLIST_SYNC = 'watchlist_sync',  // Watchlist data update
  HEARTBEAT = 'heartbeat',            // Connection keepalive
  ERROR = 'error'                     // Error notification
}

/**
 * Track update message (sent when vessel in watchlist detected)
 */
export interface TrackUpdateMessage {
  type: WSMessageType.TRACK_UPDATE;
  data: {
    mmsi: string;
    imo?: string;
    name?: string;
    position: Position;
    cog: number;              // Course Over Ground
    sog: number;              // Speed Over Ground
    timestamp: string;        // ISO 8601
    lists: WatchlistMetadata[];  // All lists this vessel belongs to
  };
}

/**
 * Watchlist sync message (full or incremental update)
 */
export interface WatchlistSyncMessage {
  type: WSMessageType.WATCHLIST_SYNC;
  data: {
    vessels: WatchlistVessel[];
    lists: WatchlistMetadata[];
    full_sync: boolean;       // true = replace all, false = merge
    timestamp: string;
  };
}

/**
 * Heartbeat message
 */
export interface HeartbeatMessage {
  type: WSMessageType.HEARTBEAT;
  timestamp: string;
}

/**
 * Error message
 */
export interface ErrorMessage {
  type: WSMessageType.ERROR;
  error: {
    code: string;
    message: string;
  };
}

/**
 * Union type of all possible WebSocket messages
 */
export type WSMessage =
  | TrackUpdateMessage
  | WatchlistSyncMessage
  | HeartbeatMessage
  | ErrorMessage;

// ============================================================================
// Client Configuration Types
// ============================================================================

/**
 * Data source type for client
 */
export enum DataSourceType {
  WEBSOCKET = 'websocket',
  TCP = 'tcp',
  SERIAL = 'serial'
}

/**
 * WebSocket source configuration
 */
export interface WebSocketSourceConfig {
  type: DataSourceType.WEBSOCKET;
  url: string;
  auth_token?: string;
  reconnect: boolean;
}

/**
 * TCP source configuration
 */
export interface TCPSourceConfig {
  type: DataSourceType.TCP;
  host: string;
  port: number;
}

/**
 * Serial source configuration
 */
export interface SerialSourceConfig {
  type: DataSourceType.SERIAL;
  port: string;         // e.g., "COM3", "/dev/ttyUSB0"
  baud_rate: number;    // e.g., 38400
}

/**
 * Union type for data source config
 */
export type DataSourceConfig =
  | WebSocketSourceConfig
  | TCPSourceConfig
  | SerialSourceConfig;

// ============================================================================
// Track Display Types (Client)
// ============================================================================

/**
 * Track symbology type (NATO APP-6A style)
 */
export enum TrackSymbolType {
  STANDARD = 'standard',      // Wire circle (not in watchlist)
  WATCHLIST = 'watchlist'     // Diamond (in watchlist)
}

/**
 * Track display state
 */
export interface TrackDisplayState {
  mmsi: string;
  symbol_type: TrackSymbolType;
  position: Position;
  cog: number;
  sog: number;
  last_update: number;        // Timestamp (ms since epoch)
  time_late_seconds: number;  // Seconds since last update
  blinking: boolean;          // true if >120s without update
  lists: WatchlistMetadata[]; // Associated watchlists
  name?: string;
  imo?: string;
}

// ============================================================================
// Plugin System Types
// ============================================================================

/**
 * Plugin lifecycle events
 */
export enum PluginEvent {
  LOAD = 'load',
  UNLOAD = 'unload',
  STREAM_MESSAGE = 'stream_message',
  WATCHLIST_MATCH = 'watchlist_match',
  WS_CONNECT = 'ws_connect',
  WS_DISCONNECT = 'ws_disconnect',
  TRACK_CREATE = 'track_create',
  TRACK_UPDATE = 'track_update',
  TRACK_REMOVE = 'track_remove'
}

/**
 * Base plugin interface
 */
export interface Plugin {
  name: string;
  version: string;
  enabled: boolean;

  // Lifecycle hooks
  onLoad?(): Promise<void>;
  onUnload?(): Promise<void>;

  // Event handlers (implemented by server/client plugins)
  onEvent?(event: PluginEvent, data: any): Promise<void>;
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  name: string;
  enabled: boolean;
  path: string;
  config?: Record<string, any>;
}
