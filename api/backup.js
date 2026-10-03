// Sauvegardes des données (catalogue, ventes, bobines…) dans l'espace privé Vercel Blob.
// Automatique chaque lundi (tâche planifiée Vercel) ; liste et sauvegarde immédiate depuis l'outil.
import { put, list, del } from '@vercel/blob';
import { sql, schema, authed, sameOrigin, safeEq } from './_lib.js';

const KEEP = 12;
const isCron = req => !!process.env.CRON_SECRET && safeEq(req.headers.authorization || '', `Bearer ${process.env.CRON_SECRET}`);

async function backupNow(kind) {
  const [row] = await sql`select data, version, updated_at from pc_state where id = 1`;
  if (!row) return {ok: false, error: 'Aucune donnée à sauvegarder.'};
  const day = new Date().toISOString().slice(0, 10);
  const body = JSON.stringify({app: 'PrintCost 3D', kind, savedAt: new Date().toISOString(), version: row.version, data: row.data});
  const b = await put(`sauvegardes/${day}-${kind}.json`, body, {access: 'private', addRandomSuffix: true, contentType: 'application/json'});
  // on garde les 12 plus récentes
  const all = (await list({prefix: 'sauvegardes/'})).blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const old = all.slice(KEEP).map(x => x.url);
  if (old.length) await del(old);
  return {ok: true, url: b.url, size: body.length};
}

export default async function handler(req, res) {
  await schema();
  try {
    if (isCron(req)) return res.json(await backupNow('auto'));
    if (!authed(req)) return res.status(401).json({error: 'Connexion requise.'});
    if (req.method === 'GET') {
      const all = (await list({prefix: 'sauvegardes/'})).blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      return res.json({backups: all.map(x => ({url: x.url, at: x.uploadedAt, size: x.size, auto: /-auto-/.test(x.pathname)}))});
    }
    if (req.method === 'POST') {
      if (!sameOrigin(req)) return res.status(403).json({error: 'Origine refusée.'});
      return res.json(await backupNow('manuelle'));
    }
    res.status(405).json({error: 'Méthode non autorisée.'});
  } catch (e) {
    console.error('backup', e.message);
    res.status(500).json({error: 'Sauvegarde impossible.'});
  }
}
