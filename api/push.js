// Notifications sur le téléphone : abonnements, test, et vérification régulière des impressions Bambu
// (appelée toutes les ~5 min par GitHub Actions, et à chaque ouverture de l'app).
import { sql, schema, authed, sameOrigin, decrypt } from './_lib.js';
import { call, normTask, storeTasks } from './bambu.js';
import { newVapidKeys, sendPush } from './_webpush.js';

const SUBJECT = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'printcost3d-gamma.vercel.app'}`;

async function kvGet(k) { const [r] = await sql`select v from pc_kv where k = ${k}`; return r?.v ?? null; }
async function kvSet(k, v) { await sql`insert into pc_kv (k, v) values (${k}, ${JSON.stringify(v)}::jsonb) on conflict (k) do update set v = excluded.v`; }
async function vapid() {
  let v = await kvGet('vapid');
  if (!v) { v = await newVapidKeys(); await kvSet('vapid', v); }
  return v;
}
// Envoie à tous les appareils abonnés ; les abonnements expirés sont retirés
async function broadcast(message) {
  const subs = await sql`select endpoint, sub from pc_push`, v = await vapid();
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try {
      const code = await sendPush(s.sub, message, v, SUBJECT);
      if (code === 404 || code === 410) await sql`delete from pc_push where endpoint = ${s.endpoint}`;
      else if (code < 300) sent++;
      else console.error('push', code);
    } catch (e) { console.error('push', e.message); }
  }));
  return sent;
}

const dur = min => { const m = Math.round(min), h = Math.floor(m / 60); return h ? `${h} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
const spoolName = s => [s.colorName, s.material].filter(Boolean).join(' ') + (s.brand && !/bambu/i.test(s.brand) ? ` ${s.brand}` : '');

// Nouvelles impressions terminées / arrêtées depuis la dernière vérification → une notification chacune,
// avec ce qu'il reste sur les bobines utilisées.
async function check(force = false) {
  const [{n}] = await sql`select count(*)::int as n from pc_push`;
  if (!n) return {subs: 0};
  const kv = (await kvGet('notify')) || {seen: {}};
  if (!force && Date.now() - (kv.last || 0) < 120000) return {skipped: true};
  kv.last = Date.now();
  const [row] = await sql`select token_enc from pc_bambu where id = 1`;
  if (!row?.token_enc) { await kvSet('notify', kv); return {connected: false}; }
  const r = await call('/v1/user-service/my/tasks?limit=20&offset=0&status=0', {token: decrypt(row.token_enc)});
  if (r.status === 401 || r.status === 403) {
    if (!kv.expired) { kv.expired = true; await broadcast({title: '🔌 Connexion Bambu expirée', body: 'Reconnecte ton compte Bambu dans Filaments pour garder l’historique et les notifications.', tag: 'bambu-expired'}); }
    await kvSet('notify', kv); return {expired: true};
  }
  if (!r.ok) { await kvSet('notify', kv); return {error: r.status}; }
  kv.expired = false;
  const tasks = (r.data?.hits || []).map(normTask);
  await storeTasks(tasks);

  const first = !kv.init; kv.init = true;
  const [st] = await sql`select data, updated_at from pc_state where id = 1`;
  const settings = st?.data?.settings || {}, prefs = {done: true, stop: true, ...(settings.notify || {})};
  const low = Number(settings.lowStock) || 150, spools = st?.data?.spools || [], stateAt = Date.parse(st?.updated_at || 0);
  const sent = [];
  for (const t of [...tasks].reverse()) {
    const prev = kv.seen[t.id]; kv.seen[t.id] = t.status;
    if (first || t.status === 1 || prev === t.status) continue;
    const end = Date.parse(t.end || ''), start = Date.parse(t.start || '');
    if (!end || Date.now() - end > 6 * 36e5) continue; // pas de rattrapage de vieilles impressions
    const real = (end - start) / 60000;
    let part = 1;
    if (t.status === 3 || t.status === 4) {
      if (!(real >= 2)) continue; // arrêt immédiat (ou faux arrêt noté par Bambu) : rien à signaler
      part = t.minutes > 0 ? Math.min(1, real / t.minutes) : 1;
    }
    const ok = part >= .97;
    if (ok ? !prefs.done : !prefs.stop) continue;
    // bobines utilisées : restant connu de l'app, moins cette impression si l'app ne l'a pas encore comptée
    const lines = (t.ams || []).map(m => {
      const sp = spools.find(s => s.amsLoc === `${t.device}:${m.index}`); if (!sp) return '';
      const rem = Math.max(0, Math.round((Number(sp.remaining) || 0) - (end > stateAt ? m.weight * part : 0)));
      return `${spoolName(sp)} (${m.letter}) : ≈ ${rem} g${rem < low ? ' ⚠️ bientôt vide' : ''}`;
    }).filter(Boolean);
    const name = (t.title || 'Impression').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    sent.push(await broadcast({
      title: `${ok ? '✅' : '⚠️'} ${name}`,
      body: `${t.deviceName ? t.deviceName + ' · ' : ''}${ok ? 'terminée' : `arrêtée à ${Math.round(part * 100)} %`} · ${dur(real)} · ${Math.round(t.weight * part)} g${lines.length ? '\n' + lines.join('\n') : ''}`,
      tag: 'task-' + t.id}));
  }
  // on ne garde que les 200 dernières impressions vues
  const ids = Object.keys(kv.seen); if (ids.length > 200) for (const id of ids.slice(0, ids.length - 200)) delete kv.seen[id];
  await kvSet('notify', kv);
  return {checked: tasks.length, sent: sent.length};
}

export default async function handler(req, res) {
  await schema();
  try {
    // vérification planifiée : publique mais sans effet autre qu'envoyer les notifications dues (2 min minimum entre deux)
    if (req.query?.check) return res.json(await check());
    if (!authed(req)) return res.status(401).json({error: 'Connexion requise.'});
    if (req.method === 'GET') {
      const [{n}] = await sql`select count(*)::int as n from pc_push`;
      return res.json({key: (await vapid()).publicKey, devices: n});
    }
    if (req.method !== 'POST') return res.status(405).json({error: 'Méthode non autorisée.'});
    if (!sameOrigin(req)) return res.status(403).json({error: 'Origine refusée.'});
    const {action, sub, endpoint, name = ''} = req.body || {};
    if (action === 'subscribe') {
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth || !/^https:\/\//.test(sub.endpoint)) return res.status(400).json({error: 'Abonnement invalide.'});
      await sql`insert into pc_push (endpoint, sub, name) values (${sub.endpoint}, ${JSON.stringify(sub)}::jsonb, ${String(name).slice(0, 80)})
                on conflict (endpoint) do update set sub = excluded.sub, name = excluded.name`;
      return res.json({ok: true});
    }
    if (action === 'unsubscribe') { await sql`delete from pc_push where endpoint = ${String(endpoint || '')}`; return res.json({ok: true}); }
    if (action === 'test') {
      const sent = await broadcast({title: '🔔 PrintCost 3D', body: 'Les notifications marchent : tu seras prévenu à la fin de chaque impression.', tag: 'test'});
      return res.json({ok: sent > 0, sent});
    }
    res.status(400).json({error: 'Action inconnue.'});
  } catch (e) {
    console.error('push', e.message);
    res.status(500).json({error: 'Erreur du serveur (notifications).'});
  }
}
