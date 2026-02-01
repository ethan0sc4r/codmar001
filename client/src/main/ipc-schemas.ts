import { z } from 'zod';

const uuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  'Invalid UUID format'
);

const simpleIdSchema = z.string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid ID format');

const mmsiSchema = z.string()
  .length(9)
  .regex(/^\d{9}$/, 'MMSI must be 9 digits');

const imoSchema = z.string()
  .regex(/^\d{7}$/, 'IMO must be 7 digits')
  .optional()
  .nullable();

const colorSchema = z.string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color');

const latSchema = z.number().min(-90).max(90);

const lonSchema = z.number().min(-180).max(180);

const safeStringSchema = (maxLength: number = 1000) =>
  z.string()
    .max(maxLength)
    .refine(s => !/[\x00-\x1f]/.test(s), 'String contains control characters');

export const CustomLayerSchema = z.object({
  id: uuidSchema,
  name: safeStringSchema(100),
  type: z.enum(['geojson', 'shapefile']),
  geojson: z.string().max(10_000_000),
  color: colorSchema,
  opacity: z.number().min(0).max(1),
  visible: z.boolean(),
  labelConfig: z.string().max(10_000).nullable().optional(),
}).strict();

export const CustomLayerIdSchema = z.object({
  id: uuidSchema,
}).strict();

export const CustomLayerUpdateSchema = z.object({
  id: uuidSchema,
  updates: z.object({
    name: safeStringSchema(100).optional(),
    color: colorSchema.optional(),
    opacity: z.number().min(0).max(1).optional(),
    visible: z.boolean().optional(),
    labelConfig: z.string().max(10_000).nullable().optional(),
  }).strict(),
}).strict();

export const GeofenceZoneSchema = z.object({
  id: uuidSchema,
  name: safeStringSchema(100),
  type: z.enum(['polygon', 'circle']),
  geometry: z.string().max(1_000_000),
  centerLat: latSchema.nullable().optional(),
  centerLon: lonSchema.nullable().optional(),
  radiusNm: z.number().min(0).max(1000).nullable().optional(),
  color: colorSchema,
  alertOnEnter: z.boolean(),
  alertOnExit: z.boolean(),
}).strict();

export const GeofenceZoneIdSchema = z.object({
  id: uuidSchema,
}).strict();

export const TrackRangeSchema = z.object({
  id: uuidSchema,
  mmsi: mmsiSchema,
  radiusNm: z.number().min(0.1).max(500),
  color: colorSchema,
  alertEnabled: z.boolean(),
}).strict();

export const TrackRangeIdSchema = z.object({
  id: uuidSchema,
}).strict();

export const NonRealtimeTrackSchema = z.object({
  id: uuidSchema,
  mmsi: mmsiSchema,
  name: safeStringSchema(100).nullable().optional(),
  imo: imoSchema,
  callsign: safeStringSchema(20).nullable().optional(),
  shiptype: z.number().int().min(0).max(255).nullable().optional(),
  lat: latSchema,
  lon: lonSchema,
  cog: z.number().min(0).max(360),
  sog: z.number().min(0).max(100),
  heading: z.number().min(0).max(360).nullable().optional(),
  notes: safeStringSchema(5000).nullable().optional(),
}).strict();

export const NonRealtimeTrackIdSchema = z.object({
  id: uuidSchema,
}).strict();

export const NonRealtimeTrackUpdateSchema = z.object({
  id: uuidSchema,
  data: z.object({
    name: safeStringSchema(100).optional(),
    imo: imoSchema.optional(),
    callsign: safeStringSchema(20).optional(),
    shiptype: z.number().int().min(0).max(255).optional(),
    notes: safeStringSchema(5000).optional(),
  }).strict(),
}).strict();

export const NonRealtimeTrackPositionUpdateSchema = z.object({
  id: uuidSchema,
  lat: latSchema,
  lon: lonSchema,
  cog: z.number().min(0).max(360).optional(),
  sog: z.number().min(0).max(100).optional(),
}).strict();

export const LocalWatchlistVesselSchema = z.object({
  id: uuidSchema,
  mmsi: mmsiSchema.nullable().optional(),
  imo: imoSchema,
  name: safeStringSchema(100).nullable().optional(),
  callsign: safeStringSchema(20).nullable().optional(),
  color: colorSchema.optional().default('#ffffff'),
  notes: safeStringSchema(5000).nullable().optional(),
}).strict();

export const LocalWatchlistVesselIdSchema = z.object({
  id: uuidSchema,
}).strict();

export const LocalWatchlistVesselUpdateSchema = z.object({
  id: uuidSchema,
  data: z.object({
    mmsi: mmsiSchema.optional(),
    imo: imoSchema.optional(),
    name: safeStringSchema(100).optional(),
    callsign: safeStringSchema(20).optional(),
    color: colorSchema.optional(),
    notes: safeStringSchema(5000).optional(),
  }).strict(),
}).strict();

export const LocalWatchlistImportSchema = z.array(
  z.object({
    mmsi: mmsiSchema.nullable().optional(),
    imo: imoSchema,
    name: safeStringSchema(100).nullable().optional(),
    callsign: safeStringSchema(20).nullable().optional(),
    color: colorSchema.optional(),
    notes: safeStringSchema(5000).nullable().optional(),
  }).strict()
).max(10000);

export const TCPConfigSchema = z.object({
  host: z.string().max(255),
  port: z.number().int().min(1).max(65535),
  enabled: z.boolean().optional(),
  reconnect: z.boolean().optional(),
  reconnectInterval: z.number().int().min(1000).max(60000).optional(),
  maxReconnectAttempts: z.number().int().min(0).max(100).optional(),
}).strict();

export const WSConfigSchema = z.object({
  url: z.string().url().max(500),
  token: z.string().max(5000).optional(),
  reconnect: z.boolean().optional(),
  reconnectInterval: z.number().int().min(1000).max(60000).optional(),
  maxReconnectAttempts: z.number().int().min(0).max(100).optional(),
  preferSecure: z.boolean().optional(),
}).strict();

export const WSMessageSchema = z.object({
  type: safeStringSchema(50),
  payload: z.unknown(),
}).strict();

export const HistoryQuerySchema = z.object({
  mmsi: mmsiSchema,
  fromTimestamp: z.number().int().positive().optional(),
  toTimestamp: z.number().int().positive().optional(),
}).strict();

export const HistoryPruneSchema = z.object({
  days: z.number().int().min(1).max(3650),
}).strict();

export function validateInput<T>(
  schema: z.ZodSchema<T>,
  input: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.errors
    .map(e => `${e.path.join('.')}: ${e.message}`)
    .join('; ');

  return { success: false, error: `Validation failed: ${errors}` };
}

export function createValidatedHandler<T, R>(
  schema: z.ZodSchema<T>,
  handler: (data: T) => R
): (input: unknown) => { success: true; data: R } | { success: false; error: string } {
  return (input: unknown) => {
    const validation = validateInput(schema, input);

    if (!validation.success) {
      console.warn('[IPC] Validation failed:', validation.error);
      return { success: false, error: validation.error };
    }

    try {
      const result = handler(validation.data);
      return { success: true, data: result };
    } catch (error) {
      console.error('[IPC] Handler error:', error);
      return { success: false, error: (error as Error).message };
    }
  };
}
