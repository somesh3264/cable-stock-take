import { timingSafeEqual } from 'node:crypto';
import { dbConfigured } from './db.js';

export function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export const bad = (res, message) => send(res, 400, { error: 'bad_request', message });

function pinOk(req) {
  const pin = process.env.COUNT_PIN || '';
  if (!pin) return true;
  const got = String(req.headers['x-count-pin'] || '');
  const a = Buffer.from(got), b = Buffer.from(pin);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Shared wrapper: database present, PIN accepted, errors reported as JSON. */
export async function guard(req, res, fn) {
  try {
    if (!dbConfigured()) {
      return send(res, 503, { error: 'no_db', message: 'The database is not connected yet. Connect a Neon database to this project in Vercel, then redeploy.' });
    }
    if (!pinOk(req)) return send(res, 401, { error: 'pin', message: 'Team PIN not accepted.' });
    await fn();
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'server', message: 'Something went wrong on the server. Try again in a moment.' });
  }
}

export const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
