// Notifications Web Push sans bibliothèque : chiffrement du message (RFC 8291, aes128gcm) et signature VAPID (RFC 8292).
// Uniquement WebCrypto (crypto.subtle), disponible dans Node 20 comme dans le navigateur.
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export const b64u = {
  enc: buf => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: str => Uint8Array.from(atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4)), c => c.charCodeAt(0)),
};
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
async function hkdf(salt, ikm, info, len) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt, info}, k, len * 8));
}

// Clés VAPID du serveur : {publicKey (base64url, 65 octets), privateJwk}
export async function newVapidKeys() {
  const kp = await subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  return {publicKey: b64u.enc(await subtle.exportKey('raw', kp.publicKey)), privateJwk: await subtle.exportKey('jwk', kp.privateKey)};
}

// Chiffre le message pour un abonnement (p256dh + auth du navigateur). test : clés et sel imposés (vecteurs de la RFC)
export async function encryptPayload(payload, p256dh, auth, test = {}) {
  const uaPublic = b64u.dec(p256dh), authSecret = b64u.dec(auth);
  const asKeys = test.asKeys || await subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await subtle.importKey('raw', uaPublic, {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({name: 'ECDH', public: uaKey}, asKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = test.salt || globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const data = concat(typeof payload === 'string' ? enc.encode(payload) : payload, new Uint8Array([2])); // 2 = dernier bloc
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await subtle.encrypt({name: 'AES-GCM', iv: nonce}, key, data));
  const head = new Uint8Array(21); head.set(salt); new DataView(head.buffer).setUint32(16, 4096); head[20] = asPublic.length;
  return concat(head, asPublic, cipher);
}

// En-tête Authorization VAPID pour le service de notifications de l'abonnement
export async function vapidHeader(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const part = o => b64u.enc(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({typ: 'JWT', alg: 'ES256'})}.${part({aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject})}`;
  const key = await subtle.importKey('jwk', vapid.privateJwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const sig = await subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u.enc(sig)}, k=${vapid.publicKey}`;
}

// Envoie une notification ; renvoie le code HTTP (404 / 410 = abonnement expiré, à supprimer)
export async function sendPush(sub, message, vapid, subject) {
  const body = await encryptPayload(JSON.stringify(message), sub.keys.p256dh, sub.keys.auth);
  const r = await fetch(sub.endpoint, {method: 'POST', body, headers: {
    Authorization: await vapidHeader(sub.endpoint, vapid, subject), TTL: '86400', Urgency: 'high',
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream'}});
  return r.status;
}
