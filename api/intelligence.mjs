/**
 * Vercel Function: Boundry Ecosystem Intelligence (`/api/intelligence/v1/*`, routed here by `vercel.json`).
 * A thin adapter around `intelligence/src/http.mjs`. Configuration comes from the project's environment:
 *
 *   BOUNDRY_INTELLIGENCE_FELTDB_URL             the FeltDB authority URL (the existing control plane)
 *   BOUNDRY_INTELLIGENCE_FELTDB_TOKEN           data key of the Boundry intelligence FeltDB application
 *   BOUNDRY_INTELLIGENCE_FELTDB_APPLICATION_ID  that application's id
 *   BOUNDRY_OWNER_TOKEN_SHA256                  SHA-256 (hex) of the owner's bearer token; the token itself is never stored
 *   BOUNDRY_INTELLIGENCE_RETENTION_DAYS         optional, default 400
 *
 * Missing configuration fails closed (503); nothing falls back to local storage.
 */
import { API_PREFIX, createConfiguredHandler } from '../intelligence/src/index.mjs';

let handler;

function configured() {
  handler ??= createConfiguredHandler(process.env) ?? undefined;
  return handler ?? null;
}

async function route(request) {
  const handle = configured();
  if (!handle) return new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Intelligence is not configured' } }), { status: 503, headers: { 'content-type': 'application/json' } });
  return handle(publicRequest(request));
}

/** Behind the rewrite the sub-path may arrive as `__path`; rebuild the public URL either way. */
export function publicRequest(request) {
  const url = new URL(request.url);
  const sub = url.searchParams.get('__path');
  if (sub === null) return request;
  url.searchParams.delete('__path');
  if (!url.pathname.startsWith(API_PREFIX)) url.pathname = `${API_PREFIX}/${sub}`;
  return new Request(url, request);
}

export const GET = route;
export const POST = route;
