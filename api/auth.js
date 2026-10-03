// Compte unique : création (avec le code de création), connexion, déconnexion
import { sql, schema, authed, setSession, clearSession, sameOrigin, hashPw, checkPw, safeEq, tooManyFails } from './_lib.js';

export default async function handler(req, res) {
  await schema();
  const [user] = await sql`select 1 from pc_user where id = 1`;
  if (req.method === 'GET') return res.json({setupNeeded: !user, logged: authed(req)});
  if (req.method !== 'POST') return res.status(405).json({error: 'Méthode non autorisée.'});
  if (!sameOrigin(req)) return res.status(403).json({error: 'Origine refusée.'});
  if (!process.env.SESSION_SECRET) return res.status(503).json({error: 'Serveur pas encore configuré.'});

  const {action, password = '', code = ''} = req.body || {};
  if (action === 'logout') { clearSession(res); return res.json({ok: true}); }
  if (await tooManyFails()) return res.status(429).json({error: 'Trop d’essais : réessaie dans 15 minutes.'});

  if (action === 'setup') {
    if (user) return res.status(409).json({error: 'Le compte existe déjà : connecte-toi.'});
    if (!process.env.SETUP_CODE || !safeEq(String(code).trim(), process.env.SETUP_CODE)) {
      await sql`insert into pc_login_fail default values`;
      return res.status(403).json({error: 'Code de création incorrect.'});
    }
    if (String(password).length < 8) return res.status(400).json({error: 'Le mot de passe doit faire au moins 8 caractères.'});
    await sql`insert into pc_user (id, password_hash) values (1, ${hashPw(String(password))})`;
    setSession(res);
    return res.json({ok: true});
  }

  if (action === 'login') {
    const [row] = await sql`select password_hash from pc_user where id = 1`;
    if (!row || !checkPw(String(password), row.password_hash)) {
      await sql`insert into pc_login_fail default values`;
      return res.status(401).json({error: 'Mot de passe incorrect.'});
    }
    await sql`delete from pc_login_fail`;
    setSession(res);
    return res.json({ok: true});
  }
  res.status(400).json({error: 'Action inconnue.'});
}
