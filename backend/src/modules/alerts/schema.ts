import { z } from 'zod';
import { ALERT_TYPES } from '../../domain/permissions.js';

export const alertParams = z.object({ alertId: z.string().min(1).max(64) });

export const createAlertBody = z.object({
  alertType: z.enum(ALERT_TYPES).optional(),
  channelId: z.string().min(1).max(64).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  message: z.string().trim().max(500).optional().nullable(),
});

export const listAlertsQuery = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const resolveAlertBody = z.object({
  message: z.string().trim().max(500).optional().nullable(),
});
