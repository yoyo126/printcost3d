// Modèle MakerWorld à partir de son numéro : profils d'impression (temps, grammes par couleur, plateaux), licence.
// Accès public (non officiel) ; réservé au compte connecté pour ne pas servir de relais ouvert.
import { requireAuth } from './_lib.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const id = String(req.query?.id || '').replace(/\D/g, '');
  if (!id) return res.status(400).json({error: 'Lien MakerWorld invalide.'});
  try {
    // Même données via l'API Bambu (utilisée par Bambu Studio) : pas de protection anti-robots ; MakerWorld en secours
    let r = await fetch(`https://api.bambulab.com/v1/design-service/design/${id}`, {headers: {'User-Agent': 'bambu_network_agent/01.09.05.01', 'X-BBL-Client-Type': 'slicer', 'X-BBL-Client-Name': 'BambuStudio', 'X-BBL-Language': 'fr-FR', Accept: 'application/json'}});
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
        printer: mi.compatibility?.devProductName || '', cover: i.cover || '',
        plates: (mi.plates || []).map(p => ({index: p.index, name: p.name || '', seconds: Number(p.prediction) || 0, grams: Number(p.weight) || 0,
          objects: (p.objects || []).length, filaments: (p.filaments || []).map(fil)})),
      };
    }).filter(i => i.seconds > 0 || i.grams > 0);
    res.json({id: d.id, title: (d.titleTranslated || d.title || '').trim(), cover: d.coverUrl || '', license: d.license || '',
      creator: d.designCreator?.name || '', defaultInstanceId: d.defaultInstanceId || null, instances});
  } catch (e) {
    console.error('makerworld', e.message);
    res.status(502).json({error: 'Impossible de joindre MakerWorld.'});
  }
}
