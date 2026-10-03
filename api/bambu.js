// Compte Bambu Lab (cloud, accès non officiel) : connexion, imprimantes, AMS et historique des impressions.
// Le mot de passe Bambu n'est jamais enregistré : seul le jeton renvoyé par Bambu est gardé, chiffré.
import crypto from 'node:crypto';
import mqtt from 'mqtt';
import { sql, schema, requireAuth, sameOrigin, encrypt, decrypt } from './_lib.js';

const API = 'https://api.bambulab.com';
const MQTT_HOST = 'mqtts://us.mqtt.bambulab.com:8883';
const HEADERS = {
  'User-Agent': 'bambu_network_agent/01.09.05.01',
  'X-BBL-Client-Name': 'OrcaSlicer', 'X-BBL-Client-Type': 'slicer', 'X-BBL-Client-Version': '01.09.05.51',
  'X-BBL-Language': 'fr-FR', 'X-BBL-OS-Type': 'linux', 'X-BBL-OS-Version': '6.2.0',
  'X-BBL-Agent-Version': '01.09.05.01', 'X-BBL-Executable-info': '{}', 'X-BBL-Agent-OS-Type': 'linux',
  'Accept': 'application/json', 'Content-Type': 'application/json',
};

async function call(url, {method = 'GET', body, token} = {}) {
  const r = await fetch(url.startsWith('http') ? url : API + url, {
    method, headers: {...HEADERS, ...(token ? {Authorization: `Bearer ${token}`} : {})},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return {status: r.status, ok: r.ok, data, text: text.slice(0, 200), headers: r.headers};
}

// Nom d'utilisateur MQTT : dans le jeton (JWT) ou via le profil
async function mqttUser(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    if (p.username) return p.username;
  } catch {}
  const r = await call('/v1/design-user-service/my/preference', {token});
  return r.data?.uid ? `u_${r.data.uid}` : null;
}

async function saveToken(account, token, expiresIn) {
  const username = await mqttUser(token);
  const exp = new Date(Date.now() + (Number(expiresIn) || 90 * 86400) * 1000);
  await sql`insert into pc_bambu (id, account, token_enc, username, expires_at, updated_at)
            values (1, ${account}, ${encrypt(token)}, ${username}, ${exp}, now())
            on conflict (id) do update set account = excluded.account, token_enc = excluded.token_enc,
              username = excluded.username, expires_at = excluded.expires_at, updated_at = now()`;
}

function loginError(r) {
  const msg = r.data?.message || r.data?.error;
  if (msg) return `Bambu a refusé la connexion : ${msg}`;
  if (r.status === 403 || /cloudflare|<html/i.test(r.text)) return 'Bambu bloque les connexions depuis ce serveur (protection anti-robots).';
  return `Réponse inattendue de Bambu (code ${r.status}).`;
}

/* AMS : on demande l'état complet (« pushall ») à chaque imprimante en ligne, par le MQTT du cloud */
async function amsSnapshot(username, token, ids) {
  if (!ids.length || !username) return {};
  const client = await mqtt.connectAsync(MQTT_HOST, {
    username, password: token, clientId: `pc3d_${crypto.randomBytes(5).toString('hex')}`,
    connectTimeout: 8000, reconnectPeriod: 0,
  });
  const out = {};
  try {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 9000);
      client.on('message', (topic, buf) => {
        try {
          const p = JSON.parse(buf.toString()).print;
          const id = topic.split('/')[1];
          if (p && (p.ams || p.vt_tray || p.vir_slot)) {
            out[id] = {...(out[id] || {}), ...p};
            if (ids.every(x => out[x]?.ams || out[x]?.vt_tray || out[x]?.vir_slot)) { clearTimeout(timer); resolve(); }
          }
        } catch {}
      });
      (async () => {
        for (const id of ids) {
          await client.subscribeAsync(`device/${id}/report`);
          await client.publishAsync(`device/${id}/request`, JSON.stringify({pushing: {sequence_id: '0', command: 'pushall', version: 1, push_target: 1}}));
        }
      })().catch(() => resolve());
    });
  } finally { await client.endAsync(true).catch(() => {}); }
  return out;
}

const hex = c => c ? '#' + String(c).slice(0, 6) : '';
const ZERO = /^0+$/;
// Emplacement : AMS « A, B, C… » et numéro 1 à 4, comme dans Bambu Studio
function tray(t, amsId, nozzle) {
  const uuid = t.tray_uuid && !ZERO.test(t.tray_uuid) ? t.tray_uuid : '';
  const weight = Number(t.tray_weight) || 0, remain = t.remain == null ? -1 : Number(t.remain);
  const grams = Number(t.remain_g) >= 0 && t.remain_g != null ? Number(t.remain_g) : (remain >= 0 && weight ? Math.round(remain * weight / 100) : null);
  return {ams: amsId, slot: Number(t.id) + 1, index: amsId == null ? null : amsId * 4 + Number(t.id), nozzle,
    type: t.tray_type || '', brand: t.tray_sub_brands || '', color: hex(t.tray_color), remain, grams, weight,
    rfid: !!uuid, uuid, empty: !t.tray_type, filaId: t.tray_info_idx || '', code: t.tray_id_name || ''};
}
const nozzleOf = info => { const n = (parseInt(info, 16) >> 8) & 0xF; return Number.isFinite(n) ? n : null; };
export function normPrinter(p = {}) {
  const units = (p.ams?.ams || []).map(u => {
    const id = Number(u.id), nozzle = nozzleOf(u.info);
    return {id, letter: String.fromCharCode(65 + id), nozzle, humidity: u.humidity_raw != null && u.humidity_raw !== '' ? Number(u.humidity_raw) : null,
      temp: u.temp != null ? Number(u.temp) : null, trays: (u.tray || []).map(t => tray(t, id, nozzle))};
  });
  const ext = [p.vt_tray, ...(Array.isArray(p.vir_slot) ? p.vir_slot : [])].filter(t => t && t.tray_type).map(t => ({...tray(t, null, null), ext: true}));
  const now = Number(p.ams?.tray_now);
  return {units, ext, active: Number.isFinite(now) && now < 254 ? now : null, nozzles: (p.device?.extruder?.info || []).length || 1,
    state: p.gcode_state || '', progress: p.mc_percent ?? null, job: p.subtask_name || ''};
}

// Impression de l'historique Bambu, en version courte
function normTask(t) {
  return {
    id: String(t.id), title: t.title || t.designTitle || '', device: t.deviceId, deviceName: t.deviceName || '',
    status: t.status, start: t.startTime || null, end: t.endTime || null, weight: Number(t.weight) || 0, minutes: Math.round((Number(t.costTime) || 0) / 60),
    plate: t.plateIndex ?? null, cover: t.cover || '', photo: t.snapShot || '',
    // « ams » = numéro global de l'emplacement (AMS × 4 + emplacement) ; targetColor = couleur de la bobine utilisée
    ams: (t.amsDetailMapping || []).map(m => ({type: m.filamentType || m.targetFilamentType || '', color: hex(m.targetColor || m.sourceColor),
      weight: Number(m.weight) || 0, index: m.ams ?? null, letter: m.ams != null && m.ams < 64 ? String.fromCharCode(65 + Math.floor(m.ams / 4)) + (m.ams % 4 + 1) : '', nozzle: m.nozzleId ?? null})),
  };
}
// L'historique est gardé dans la base : il s'accumule au fil des lectures
async function storeTasks(tasks) {
  if (!tasks.length) return;
  await sql`insert into pc_tasks (id, data, ended_at)
            select x->>'id', x, nullif(x->>'end', '')::timestamptz from jsonb_array_elements(${JSON.stringify(tasks)}::jsonb) as x
            on conflict (id) do update set data = excluded.data, ended_at = excluded.ended_at`;
}
async function history(full) {
  let fetched = 0;
  if (full) {
    const [row] = await sql`select token_enc from pc_bambu where id = 1`;
    if (!row?.token_enc) return {connected: false};
    const token = decrypt(row.token_enc), seen = new Set();
    let after = null;
    for (let page = 0; page < 25; page++) {
      const r = await call(`/v1/user-service/my/tasks?limit=100${after ? `&after=${after}` : ''}`, {token});
      if (r.status === 401 || r.status === 403) return {connected: false, expired: true};
      const hits = (r.data?.hits || []).filter(t => !seen.has(String(t.id)));
      if (!hits.length) break;
      hits.forEach(t => seen.add(String(t.id)));
      await storeTasks(hits.map(normTask));
      fetched += hits.length;
      after = hits[hits.length - 1].id;
      if ((r.data?.hits || []).length < 100) break;
    }
  }
  const rows = await sql`select data from pc_tasks order by ended_at desc nulls last`;
  const [b] = await sql`select snapshot from pc_bambu where id = 1`;
  const devices = (b?.snapshot?.devices || []).map(d => ({id: d.dev_id, name: d.name, model: d.dev_product_name || d.dev_model_name || ''}));
  return {tasks: rows.map(r => r.data), devices, fetched};
}

async function status() {
  const [row] = await sql`select account, token_enc, username, expires_at from pc_bambu where id = 1`;
  if (!row?.token_enc) return {connected: false};
  const token = decrypt(row.token_enc);
  const bind = await call('/v1/iot-service/api/user/bind', {token});
  if (bind.status === 401 || bind.status === 403) return {connected: false, expired: true, account: row.account};
  if (!bind.ok) return {connected: true, account: row.account, error: loginError(bind)};
  const devices = (bind.data?.devices || []).map(d => ({id: d.dev_id, name: d.name, model: d.dev_product_name || d.dev_model_name || '', online: !!d.online, status: d.print_status || ''}));

  const tasksR = await call('/v1/user-service/my/tasks?limit=30', {token});
  const hits = tasksR.data?.hits || [];
  const tasks = hits.map(normTask);
  await storeTasks(tasks);

  let raw = {}, amsError = null;
  try { raw = await amsSnapshot(row.username, token, devices.filter(d => d.online).map(d => d.id)); }
  catch (e) { amsError = String(e.message || e).slice(0, 200); }
  for (const d of devices) d.ams = raw[d.id] ? normPrinter(raw[d.id]) : null;

  // Instantané (sans jeton ni code d'accès) pour comprendre la forme réelle des données
  const snap = {at: new Date().toISOString(), devices: (bind.data?.devices || []).map(({dev_access_code, ...d}) => d),
    tasks: hits.slice(0, 5).map(({cover, ...t}) => t), amsRaw: raw, amsError, tasksStatus: tasksR.status};
  await sql`update pc_bambu set snapshot = ${JSON.stringify(snap)}::jsonb where id = 1`;
  return {connected: true, account: row.account, expires: row.expires_at, devices, tasks, amsError};
}

export default async function handler(req, res) {
  await schema();
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === 'GET' && req.query?.info) {
      // état de la connexion sans appeler Bambu (pour prévenir avant l'expiration)
      const [row] = await sql`select account, expires_at, token_enc is not null as linked from pc_bambu where id = 1`;
      return res.json({connected: !!row?.linked, account: row?.account || '', expires: row?.expires_at || null});
    }
    if (req.method === 'GET') return res.json(req.query?.history ? await history(req.query.history === 'full') : await status());
    if (req.method !== 'POST') return res.status(405).json({error: 'Méthode non autorisée.'});
    if (!sameOrigin(req)) return res.status(403).json({error: 'Origine refusée.'});
    const {action, account = '', password = '', code = '', tfaKey = ''} = req.body || {};

    if (action === 'logout') { await sql`delete from pc_bambu where id = 1`; return res.json({ok: true}); }

    if (action === 'login') {
      const r = await call('/v1/user-service/user/login', {method: 'POST', body: {account, password, apiError: ''}});
      if (r.data?.accessToken) { await saveToken(account, r.data.accessToken, r.data.expiresIn); return res.json({ok: true}); }
      if (r.data?.loginType === 'verifyCode') {
        await call('/v1/user-service/user/sendemail/code', {method: 'POST', body: {email: account, type: 'codeLogin'}});
        return res.json({step: 'code'});
      }
      if (r.data?.loginType === 'tfa') return res.json({step: 'tfa', tfaKey: r.data.tfaKey});
      return res.status(400).json({error: loginError(r)});
    }

    if (action === 'code') {
      const r = await call('/v1/user-service/user/login', {method: 'POST', body: {account, code: String(code).trim()}});
      if (r.data?.accessToken) { await saveToken(account, r.data.accessToken, r.data.expiresIn); return res.json({ok: true}); }
      return res.status(400).json({error: loginError(r)});
    }

    if (action === 'tfa') {
      const r = await call('https://bambulab.com/api/sign-in/tfa', {method: 'POST', body: {tfaKey, tfaCode: String(code).trim()}});
      const cookie = r.headers.get('set-cookie') || '';
      const token = r.data?.accessToken || (cookie.match(/(?:^|[;,]\s*)token=([^;]+)/) || [])[1];
      if (token) { await saveToken(account, token, r.data?.expiresIn); return res.json({ok: true}); }
      return res.status(400).json({error: loginError(r)});
    }
    res.status(400).json({error: 'Action inconnue.'});
  } catch (e) {
    console.error('bambu', e.message);
    res.status(500).json({error: 'Erreur du serveur pendant l’échange avec Bambu.'});
  }
}
