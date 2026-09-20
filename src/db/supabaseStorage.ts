import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// Singleton client, same reasoning as db/prisma.ts. The secret key bypasses Storage
// RLS entirely (it is the service-role-equivalent credential in Supabase's newer key
// format) — this module is the ONLY place that key is used, and it never leaves the
// server (.claude/rules/security.md in incident-web: never VITE_*, never client-side).
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const bucket = env.SUPABASE_STORAGE_BUCKET;

export class StorageUploadError extends Error {}

/**
 * Uploads one incident photo and returns its Storage object key (NOT a URL — the
 * bucket is private, so every read mints its own short-lived signed URL via
 * getSignedIncidentImageUrl below rather than storing a link that would outlive it).
 */
export async function uploadIncidentImage(input: {
  incidentId: string;
  buffer: Buffer;
  mimetype: string;
  originalName: string;
}): Promise<string> {
  const extension = input.originalName.includes('.') ? input.originalName.split('.').pop() : undefined;
  const path = `incidents/${input.incidentId}${extension ? `.${extension}` : ''}`;

  const { error } = await supabase.storage.from(bucket).upload(path, input.buffer, {
    contentType: input.mimetype,
    upsert: false,
  });
  if (error) throw new StorageUploadError(error.message);

  return path;
}

/** Signed read URL, minted fresh on every incident-detail read; never persisted. */
export async function getSignedIncidentImageUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error || !data) return null;
  return data.signedUrl;
}
