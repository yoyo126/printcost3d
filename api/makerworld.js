// Modèle MakerWorld à partir de son numéro : profils d'impression (temps, grammes par couleur, plateaux), licence.
// Accès public (non officiel) ; réservé au compte connecté pour ne pas servir de relais ouvert.
import { sql, schema, requireAuth, sameOrigin, decrypt } from './_lib.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

const BH = {'User-Agent': 'bambu_network_agent/01.09.05.01', 'X-BBL-Client-Type': 'slicer', 'X-BBL-Client-Name': 'BambuStudio', 'X-BBL-Language': 'fr', 'Accept-Language': 'fr', Accept: 'application/json'};
const text = h => String(h || '').replace(/<br\s*\/?>|<\/(p|h\d|li|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

const API = 'https://api.bambulab.com/v1';

// Jeton du compte Bambu connecté (le même que Bambu Handy) : favoris, « Pour vous », « Suivis »
async function bambuToken() {
  await schema();
  const [row] = await sql`select token_enc from pc_bambu where id = 1`;
  return row?.token_enc ? decrypt(row.token_enc) : null;
}
async function mw(path, token, {method = 'GET', body} = {}) {
  const r = await fetch(API + path, {method, headers: {...BH, ...(token ? {Authorization: `Bearer ${token}`} : {}), ...(body ? {'Content-Type': 'application/json'} : {})}, body: body ? JSON.stringify(body) : undefined});
  const t = await r.text(); let data = null; try { data = JSON.parse(t); } catch {}
  return {ok: r.ok, status: r.status, data, text: t.slice(0, 200)};
}
const fail = (res, r, what) => res.status(r.status === 401 || r.status === 403 ? 401 : 502).json({
  error: r.status === 401 || r.status === 403 ? 'Compte Bambu à reconnecter (Filaments › Imprimantes).' : `${what} : MakerWorld répond ${r.status}.`, detail: r.text});

// Une vignette de modèle, quelle que soit la liste d'origine (recherche, rubrique, favoris, pour vous)
const hit = h => ({id: h.id, title: (h.titleTranslated || h.title || '').trim(), cover: h.cover || '', likes: h.likeCount || 0, prints: h.printCount || 0,
  downloads: h.downloadCount || 0, license: h.license ?? null, creator: h.designCreator?.name || '', collected: !!h.hasCollect, collects: h.collectionCount || 0});
const hitsOf = d => (d?.hits || []).map(h => h.design || h).filter(h => h && h.id && !h.nsfw && (h.designType ?? 0) !== 3);

let uidCache = null;
async function myUid(token) {
  if (uidCache?.token === token) return uidCache.uid;
  const r = await mw('/design-user-service/my/preference', token);
  const uid = r.data?.uid || null; if (uid) uidCache = {token, uid};
  return uid;
}

// Rubriques et listes « comme dans Bambu Handy »
async function browse(req, res) {
  const token = await bambuToken().catch(() => null);
  const offset = Math.max(0, parseInt(req.query.offset) || 0), limit = Math.min(40, parseInt(req.query.limit) || 30);
  if (req.query.nav != null) {
    const r = await mw('/search-service/homepage/nav', token);
    if (!r.ok) return fail(res, r, 'Rubriques');
    return res.json({bambu: !!token, navs: (r.data?.navs || []).filter(n => token || !['Following', 'Foryou'].includes(n.key)).map(n => ({key: n.key, name: n.name}))});
  }
  if (req.query.feed != null) {
    const key = String(req.query.feed).slice(0, 80);
    const r = key === 'Foryou'
      ? await mw(`/design-recommend-service/my/for-you?limit=${limit}&offset=${offset}&seed=${parseInt(req.query.seed) || 0}&acceptTypes=0,2`, token)
      : await mw(`/search-service/select/design/nav?navKey=${encodeURIComponent(key)}&offset=${offset}&limit=${limit}`, token);
    if (!r.ok) return fail(res, r, 'Rubrique');
    const raw = r.data?.hits || [];
    return res.json({total: r.data?.total ?? (raw.length >= limit ? offset + raw.length + 1 : offset + raw.length), got: raw.length, seed: r.data?.seed ?? 0, hits: hitsOf(r.data).map(hit)});
  }
  if (!token) return res.status(401).json({error: 'Connecte d’abord ton compte Bambu (Filaments › Imprimantes) pour voir tes favoris.'});
  // Dossiers de favoris
  if (req.query.folders != null) {
    const r = await mw('/design-service/my/favorites/listlite?query=', token);
    if (!r.ok) return fail(res, r, 'Favoris');
    const list = r.data?.hits || r.data?.list || r.data?.favorites || (Array.isArray(r.data) ? r.data : []);
    return res.json({folders: list.map(f => ({id: f.id, name: (f.titleTranslated || f.title || f.name || 'Favoris').trim(), isDefault: !!f.isDefault, count: f.designCnt ?? f.designCount ?? f.count ?? null, cover: f.cover || f.designCover || ''}))});
  }
  // Modèles d'un dossier (ou de tous les favoris)
  if (req.query.fav != null) {
    const f = String(req.query.fav).replace(/[^\w]/g, '');
    let path;
    if (f === 'all') { const uid = await myUid(token); if (!uid) return res.status(502).json({error: 'Profil Bambu illisible.'}); path = `/design-service/favorites/designs/${uid}`; }
    else path = `/design-service/favorites/${f}/designs`;
    const r = await mw(`${path}?offset=${offset}&limit=${limit}`, token);
    if (!r.ok) return fail(res, r, 'Favoris');
    return res.json({total: r.data?.total || 0, got: (r.data?.hits || []).length, hits: hitsOf(r.data).map(h => ({...hit(h), collected: true}))});
  }
  // Dans quels dossiers est ce modèle ?
  if (req.query.collect != null) {
    const id = String(req.query.collect).replace(/\D/g, '');
    const r = await mw(`/design-service/my/design/favoriteslist?designId=${id}`, token);
    if (!r.ok) return fail(res, r, 'Favoris');
    return res.json({favoritesIds: (r.data?.favoritesIds || []).map(Number)});
  }
  res.status(400).json({error: 'Demande inconnue.'});
}

// Ajouter / retirer un modèle des favoris (liste des dossiers où il doit être ; vide = retiré)
async function setCollect(req, res) {
  if (!sameOrigin(req)) return res.status(403).json({error: 'Origine refusée.'});
  const token = await bambuToken().catch(() => null);
  if (!token) return res.status(401).json({error: 'Connecte d’abord ton compte Bambu.'});
  const designId = Number(req.body?.designId), favoritesIds = (req.body?.favoritesIds || []).map(Number).filter(Number.isFinite).slice(0, 50);
  if (!designId) return res.status(400).json({error: 'Modèle manquant.'});
  const r = await mw('/design-service/my/design/favoriteslist', token, {method: 'PUT', body: {designId, favoritesIds}});
  if (!r.ok) return fail(res, r, 'Favoris');
  res.json({ok: true, favoritesIds});
}

// Recherche MakerWorld (même moteur que l'appli Bambu)
async function search(req, res) {
  const q = String(req.query.q || '').slice(0, 100), offset = Math.max(0, parseInt(req.query.offset) || 0), limit = Math.min(40, parseInt(req.query.limit) || 24);
  // sell=1 : seulement les licences qui autorisent la vente des impressions (filtre fait par MakerWorld)
  const lic = req.query.sell === '1' ? '&licenses=BY,BY-SA,BY-ND,CC0' : '';
  const token = await bambuToken().catch(() => null);
  const r = await mw(`/search-service/select/design2?keyword=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}${lic}`, token);
  if (!r.ok) return fail(res, r, 'Recherche');
  res.json({total: r.data?.total || 0, got: (r.data?.hits || []).length, hits: hitsOf(r.data).map(hit)});
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === 'POST') return await setCollect(req, res);
    if (req.query?.q != null) return await search(req, res);
    if (['nav', 'feed', 'folders', 'fav', 'collect'].some(k => req.query?.[k] != null)) return await browse(req, res);
  } catch (e) { console.error('makerworld', e.message); return res.status(502).json({error: 'Impossible de joindre MakerWorld.'}); }
  const id = String(req.query?.id || '').replace(/\D/g, '');
  if (!id) return res.status(400).json({error: 'Lien MakerWorld invalide.'});
  try {
    // Même données via l'API Bambu (utilisée par Bambu Studio) : pas de protection anti-robots ; MakerWorld en secours
    let r = await fetch(`https://api.bambulab.com/v1/design-service/design/${id}`, {headers: {'User-Agent': 'bambu_network_agent/01.09.05.01', 'X-BBL-Client-Type': 'slicer', 'X-BBL-Client-Name': 'BambuStudio', 'X-BBL-Language': 'fr', 'Accept-Language': 'fr', Accept: 'application/json'}});
    if (!r.ok && r.status !== 404) r = await fetch(`https://makerworld.com/api/v1/design-service/design/${id}`, {headers: {'User-Agent': UA, Accept: 'application/json'}});
    if (r.status === 404) return res.status(404).json({error: 'Modèle introuvable sur MakerWorld.'});
    if (!r.ok) return res.status(502).json({error: `MakerWorld ne répond pas (code ${r.status}).`});
    const d = await r.json();
    const fil = f => ({type: f.type || 'PLA', color: f.color || '#999999', grams: Number(f.usedG) || 0, id: Number(f.id) || 1});
    const instances = (d.instances || []).map(i => {
      const mi = i.extention?.modelInfo || {};
      return {
        id: i.id, title: (i.titleTranslated || i.title || '').trim(), isDefault: !!i.isDefault,
        seconds: Number(i.prediction) || 0, grams: Number(i.weight) || 0,
        filaments: (i.instanceFilaments || []).map(fil),
        printer: mi.compatibility?.devProductName || '', cover: i.cover || i.pictures?.[0]?.url || '',
        pictures: (i.pictures || []).map(x => x.url).filter(Boolean),
        compat: [...new Set([mi.compatibility?.devProductName, ...(mi.otherCompatibility || []).map(c => c.devProductName)].filter(Boolean))],
        prints: Number(i.printCount) || 0, ams: !!i.needAms,
        plates: (mi.plates || []).map(p => ({index: p.index, name: p.name || '', seconds: Number(p.prediction) || 0, grams: Number(p.weight) || 0,
          thumb: p.thumbnail?.url || p.pick_picture?.url || p.top_picture?.url || '',
          objects: (p.objects || []).length, filaments: (p.filaments || []).map(fil)})),
      };
    }).filter(i => i.seconds > 0 || i.grams > 0);
    const de = d.designExtension || {};
    res.json({id: d.id, title: (d.titleTranslated || d.title || '').trim(), cover: d.coverUrl || '', license: d.license || '',
      creator: d.designCreator?.name || '', defaultInstanceId: d.defaultInstanceId || null, instances,
      gallery: [d.coverUrl, ...(de.design_pictures || []).map(x => x.url), ...(de.real_pictures || []).map(x => x.url)].filter(Boolean).slice(0, 12),
      summary: text(d.summaryTranslated || d.summary).slice(0, 1500), tags: (d.tagsTranslated?.length ? d.tagsTranslated : d.tags || []).slice(0, 12),
      categories: (d.categories || []).map(c => c.name), likes: d.likeCount || 0, prints: d.printCount || 0, downloads: d.downloadCount || 0});
  } catch (e) {
    console.error('makerworld', e.message);
    res.status(502).json({error: 'Impossible de joindre MakerWorld.'});
  }
}
