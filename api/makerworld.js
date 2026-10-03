// Modèle MakerWorld à partir de son numéro : profils d'impression (temps, grammes par couleur, plateaux), licence.
// Accès public (non officiel) ; réservé au compte connecté pour ne pas servir de relais ouvert.
import { requireAuth } from './_lib.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

const BH = {'User-Agent': 'bambu_network_agent/01.09.05.01', 'X-BBL-Client-Type': 'slicer', 'X-BBL-Client-Name': 'BambuStudio', 'X-BBL-Language': 'fr', 'Accept-Language': 'fr', Accept: 'application/json'};
const text = h => String(h || '').replace(/<br\s*\/?>|<\/(p|h\d|li|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// Recherche MakerWorld (même moteur que l'appli Bambu)
async function search(req, res) {
  const q = String(req.query.q || '').slice(0, 100), offset = Math.max(0, parseInt(req.query.offset) || 0), limit = Math.min(40, parseInt(req.query.limit) || 24);
  // sell=1 : seulement les licences qui autorisent la vente des impressions (filtre fait par MakerWorld)
  const lic = req.query.sell === '1' ? '&licenses=BY,BY-SA,BY-ND,CC0' : '';
  const r = await fetch(`https://api.bambulab.com/v1/search-service/select/design2?keyword=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}${lic}`, {headers: BH});
  if (!r.ok) return res.status(502).json({error: `MakerWorld ne répond pas (code ${r.status}).`});
  const d = await r.json();
  res.json({total: d.total || 0, hits: (d.hits || []).filter(h => !h.nsfw).map(h => ({
    id: h.id, title: (h.titleTranslated || h.title || '').trim(), cover: h.cover || '', likes: h.likeCount || 0, prints: h.printCount || 0,
    downloads: h.downloadCount || 0, license: h.license || '', creator: h.designCreator?.name || '', printable: h.is_printable !== false,
  }))});
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.query?.q != null) { try { return await search(req, res); } catch (e) { return res.status(502).json({error: 'Impossible de joindre MakerWorld.'}); } }
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
