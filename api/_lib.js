// Outils communs aux fonctions du serveur (base, session, chiffrement)
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

export const sql = neon(process.env.DATABASE_URL);

let ready;
export function schema() {
  return ready ||= (async () => {
    await sql`create table if not exists pc_user (id int primary key, password_hash text not null, created_at timestamptz not null default now())`;
    await sql`create table if not exists pc_state (id int primary key, data jsonb not null, version int not null, updated_at timestamptz not null default now())`;
    await sql`create table if not exists pc_bambu (id int primary key, account text, token_enc text, username text, expires_at timestamptz, snapshot jsonb, updated_at timestamptz not null default now())`;
    await sql`create table if not exists pc_login_fail (at timestamptz not null default now())`;
    await sql`create table if not exists pc_tasks (id text primary key, data jsonb not null, ended_at timestamptz)`;
  })().catch(e => { ready = null; throw e; });
}

/* Session : cookie signé (HMAC), valable 90 jours */
const COOKIE = 'pc3d_s';
const DAYS = 90;
function hmac(p) { return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(p).digest('base64url'); }
export function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function readCookie(req) {
  const c = (req.headers.cookie || '').split(/;\s*/).find(s => s.startsWith(COOKIE + '='));
  return c ? decodeURIComponent(c.slice(COOKIE.length + 1)) : null;
}
export function authed(req) {
  if (!process.env.SESSION_SECRET) return false;
  const tok = readCookie(req); if (!tok) return false;
  const [p, s] = tok.split('.');
  if (!p || !s || !safeEq(s, hmac(p))) return false;
  try { return JSON.parse(Buffer.from(p, 'base64url')).exp > Date.now(); } catch { return false; }
}
export function setSession(res) {
  const p = Buffer.from(JSON.stringify({exp: Date.now() + DAYS * 864e5})).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE}=${p}.${hmac(p)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DAYS * 86400}`);
}
export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
export function requireAuth(req, res) {
  if (authed(req)) return true;
  res.status(401).json({error: 'Connexion requise.'});
  return false;
}
// Les requêtes qui modifient quelque chose doivent venir de la page elle-même
export function sameOrigin(req) {
  const o = req.headers.origin;
  return !o || new URL(o).host === req.headers.host;
}

/* Mots de passe : scrypt */
export function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 64).toString('base64')}`;
}
export function checkPw(pw, stored) {
  const [, s, h] = String(stored).split('$');
  if (!s || !h) return false;
  const a = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64), b = Buffer.from(h, 'base64');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Chiffrement du jeton Bambu (AES-256-GCM) */
function key() {
  if (!process.env.BAMBU_KEY) throw new Error('BAMBU_KEY manquante');
  return crypto.createHash('sha256').update(process.env.BAMBU_KEY).digest();
}
export function encrypt(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const d = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), d].map(b => b.toString('base64')).join('.');
}
export function decrypt(s) {
  const [iv, tag, d] = s.split('.').map(x => Buffer.from(x, 'base64'));
  const c = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  c.setAuthTag(tag);
  return Buffer.concat([c.update(d), c.final()]).toString('utf8');
}

export async function tooManyFails() {
  const [{n}] = await sql`select count(*)::int as n from pc_login_fail where at > now() - interval '15 minutes'`;
  return n >= 10;
}
