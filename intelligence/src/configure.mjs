/**
 * Builds the handler from deployment configuration. Lives in the package, not in the function adapter, so every
 * dependency (`@feltdb/core`) resolves from `intelligence/node_modules`. Returns null when configuration is
 * incomplete: callers answer 503 rather than fall back to any other storage.
 */
import { createFeltDB } from '@feltdb/core';

import { createHandler } from './http.mjs';
import { IntelligenceStore } from './store.mjs';

export const REQUIRED_ENVIRONMENT = Object.freeze(['BOUNDRY_INTELLIGENCE_FELTDB_URL', 'BOUNDRY_INTELLIGENCE_FELTDB_TOKEN', 'BOUNDRY_INTELLIGENCE_FELTDB_APPLICATION_ID', 'BOUNDRY_OWNER_TOKEN_SHA256']);

export function createConfiguredHandler(env = process.env, { createDb = createFeltDB, log = (entry) => console.error(JSON.stringify(entry)) } = {}) {
  if (REQUIRED_ENVIRONMENT.some((name) => !env[name])) return null;
  if (!/^[0-9a-f]{64}$/.test(env.BOUNDRY_OWNER_TOKEN_SHA256)) return null;
  const db = createDb({ server: { url: env.BOUNDRY_INTELLIGENCE_FELTDB_URL, token: env.BOUNDRY_INTELLIGENCE_FELTDB_TOKEN, applicationId: env.BOUNDRY_INTELLIGENCE_FELTDB_APPLICATION_ID } });
  const retentionDays = env.BOUNDRY_INTELLIGENCE_RETENTION_DAYS ? Number(env.BOUNDRY_INTELLIGENCE_RETENTION_DAYS) : 400;
  return createHandler({ store: new IntelligenceStore(db, { retentionDays }), ownerTokenSha256: env.BOUNDRY_OWNER_TOKEN_SHA256, log });
}
