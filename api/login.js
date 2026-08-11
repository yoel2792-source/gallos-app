// Valida usuario y contrasena contra las variables de entorno y abre la sesion.
export const config = { runtime: 'edge' };

const COOKIE = 'erp_sesion';
const DIAS = 30;

async function llave() {
  const raw = process.env.AUTH_SECRET
    || ((process.env.APP_USER || '') + '::' + (process.env.APP_PASSWORD || '') + '::gpr');
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(raw),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
}

function b64url(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function firmar(msg) {
  const sig = await crypto.subtle.sign('HMAC', await llave(), new TextEncoder().encode(msg));
  return b64url(sig);
}

// compara sin filtrar informacion por el tiempo que tarda
async function igualSeguro(a, b) {
  const [x, y] = await Promise.all([firmar('v:' + a), firmar('v:' + b)]);
  if (x.length !== y.length) return false;
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return dif === 0;
}

const json = (obj, status, extra) => new Response(JSON.stringify(obj), {
  status,
  headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, extra || {})
});

export default async function handler(request) {
  if (request.method !== 'POST') return json({ ok: false, error: 'metodo' }, 405);

  const U = process.env.APP_USER, P = process.env.APP_PASSWORD;
  if (!U || !P) return json({ ok: false, error: 'Faltan APP_USER y APP_PASSWORD en Vercel.' }, 503);

  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'datos' }, 400); }
  const user = String((body && body.user) || '');
  const pass = String((body && body.pass) || '');

  const ok = (await igualSeguro(user, U)) && (await igualSeguro(pass, P));

  if (!ok) {
    // pausa para que no se pueda probar contrasenas en masa
    await new Promise(r => setTimeout(r, 700));
    return json({ ok: false, error: 'Usuario o contraseña incorrectos.' }, 401);
  }

  const exp = Date.now() + DIAS * 24 * 60 * 60 * 1000;
  const valor = exp + '.' + await firmar(String(exp));
  return json({ ok: true }, 200, {
    'set-cookie': COOKIE + '=' + encodeURIComponent(valor)
      + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (DIAS * 24 * 60 * 60)
  });
}
