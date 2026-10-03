// Données de l'outil (catalogue, ventes, bobines…) : un seul document versionné
import { sql, schema, requireAuth, sameOrigin } from './_lib.js';

export default async function handler(req, res) {
  await schema();
  if (!requireAuth(req, res)) return;

  if (req.method === 'GET') {
    const [row] = await sql`select data, version from pc_state where id = 1`;
    return res.json(row ? {data: row.data, version: row.version} : {data: null, version: 0});
  }

  if (req.method === 'PUT') {
    if (!sameOrigin(req)) return res.status(403).json({error: 'Origine refusée.'});
    const {data, baseVersion} = req.body || {};
    if (!data || typeof data !== 'object' || !Number.isInteger(baseVersion)) return res.status(400).json({error: 'Données invalides.'});
    const json = JSON.stringify(data);
    // N'écrit que si personne n'a modifié entre-temps (sinon l'appareil fusionne et renvoie)
    const up = await sql`update pc_state set data = ${json}::jsonb, version = version + 1, updated_at = now()
                         where id = 1 and version = ${baseVersion} returning version`;
    if (up.length) return res.json({version: up[0].version});
    if (baseVersion === 0) {
      const ins = await sql`insert into pc_state (id, data, version) values (1, ${json}::jsonb, 1) on conflict (id) do nothing returning version`;
      if (ins.length) return res.json({version: 1});
    }
    const [cur] = await sql`select data, version from pc_state where id = 1`;
    return res.status(409).json({data: cur?.data ?? null, version: cur?.version ?? 0});
  }
  res.status(405).json({error: 'Méthode non autorisée.'});
}
