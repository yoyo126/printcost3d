// Fichiers du catalogue (3MF, STL, notices) dans l'espace privé Vercel Blob.
// Envoi direct du navigateur vers Blob (jeton court généré ici) : pas de limite de taille des fonctions.
import { handleUpload } from '@vercel/blob/client';
import { del, issueSignedToken, presignUrl } from '@vercel/blob';
import { requireAuth, sameOrigin } from './_lib.js';

const TYPES = ['application/octet-stream', 'model/3mf', 'model/stl', 'application/sla', 'application/vnd.ms-pki.stl',
  'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', 'application/pdf', 'text/plain', 'image/jpeg', 'image/png', 'image/webp'];
const isOurs = url => { try { return new URL(url).hostname.endsWith('.blob.vercel-storage.com'); } catch { return false; } };

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  try {
    // Jeton d'envoi pour le navigateur
    if (req.method === 'POST') {
      if (!sameOrigin(req)) return res.status(403).json({error: 'Origine refusée.'});
      const out = await handleUpload({
        body: req.body, request: req,
        onBeforeGenerateToken: async pathname => {
          if (!/^modeles\//.test(pathname)) throw new Error('Chemin refusé');
          return {allowedContentTypes: TYPES, maximumSizeInBytes: 200 * 1024 * 1024, addRandomSuffix: true};
        },
      });
      return res.json(out);
    }
    const url = String(req.query?.url || '');
    if (!isOurs(url)) return res.status(400).json({error: 'Fichier inconnu.'});
    // Téléchargement : lien signé valable 10 minutes, directement depuis l'espace privé (pas de limite de taille)
    if (req.method === 'GET') {
      const pathname = decodeURIComponent(new URL(url).pathname.slice(1));
      const validUntil = Date.now() + 10 * 60 * 1000;
      const token = await issueSignedToken({pathname, operations: ['get'], validUntil});
      const {presignedUrl} = await presignUrl(token, {operation: 'get', pathname, access: 'private', validUntil});
      res.setHeader('Cache-Control', 'private, no-store');
      // json=1 : le lien seul (pour l'ouvrir dans Bambu Studio)
      if (req.query?.json) return res.json({url: presignedUrl});
      res.statusCode = 302; res.setHeader('Location', presignedUrl); res.end();
      return;
    }
    if (req.method === 'DELETE') {
      if (!sameOrigin(req)) return res.status(403).json({error: 'Origine refusée.'});
      await del(url);
      return res.json({ok: true});
    }
    res.status(405).json({error: 'Méthode non autorisée.'});
  } catch (e) {
    console.error('files', e.message);
    res.status(500).json({error: 'Erreur de l’espace de fichiers.'});
  }
}
