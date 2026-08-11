// ============================================================================
//  Tabla compartida de "Usuarios en Destaque".
//  Guarda una sola llave en Upstash Redis: { v: <version>, rows: [...] }
//
//  Variables de entorno (las pone sola la integracion de Upstash en Vercel):
//     KV_REST_API_URL / KV_REST_API_TOKEN     (o)
//     UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//
//  Si no estan configuradas devuelve 501 y la pagina sigue funcionando
//  en modo local (solo en ese navegador).
// ============================================================================
export const config = { runtime: 'edge' };

const LLAVE = 'gpr:destaque';

const cfg = () => ({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''
});

const json = (o, s) => new Response(JSON.stringify(o), {
  status: s || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

async function redisGet(c) {
  const r = await fetch(c.url + '/get/' + LLAVE, {
    headers: { Authorization: 'Bearer ' + c.token },
    cache: 'no-store'
  });
  if (!r.ok) throw new Error('redis get ' + r.status);
  const j = await r.json();
  if (!j.result) return { v: 0, rows: [] };
  try { return JSON.parse(j.result); } catch (e) { return { v: 0, rows: [] }; }
}

async function redisSet(c, valor) {
  const r = await fetch(c.url + '/set/' + LLAVE, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + c.token, 'content-type': 'text/plain' },
    body: JSON.stringify(valor)
  });
  if (!r.ok) throw new Error('redis set ' + r.status);
}

// deja pasar solo texto y recorta, para que nadie meta basura enorme
const limpia = (s, max) => String(s == null ? '' : s).slice(0, max || 300);
function sanea(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 5000).map(r => ({
    id: limpia(r && r.id, 60),
    n: limpia(r && r.n, 200),
    pn: limpia(r && r.pn, 40),
    ea: limpia(r && r.ea, 200),
    en: limpia(r && r.en, 200),
    ao: limpia(r && r.ao, 200),
    ad: limpia(r && r.ad, 200),
    nt: limpia(r && r.nt, 1000),
    sent: !!(r && r.sent),
    fecha: limpia(r && r.fecha, 40)
  }));
}

export default async function handler(request) {
  const c = cfg();
  if (!c.url || !c.token) {
    return json({ ok: false, error: 'sin-almacen', mensaje: 'Falta conectar Upstash en Vercel.' }, 501);
  }

  try {
    if (request.method === 'GET') {
      const d = await redisGet(c);
      return json({ ok: true, v: d.v || 0, rows: d.rows || [] });
    }

    if (request.method === 'PUT') {
      let body;
      try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'datos' }, 400); }

      const actual = await redisGet(c);
      const vCliente = Number(body && body.v);

      // alguien mas guardo mientras tanto -> devolvemos lo que hay
      if (Number.isFinite(vCliente) && vCliente !== (actual.v || 0)) {
        return json({ ok: false, error: 'desfasado', v: actual.v || 0, rows: actual.rows || [] }, 409);
      }

      const nuevo = { v: (actual.v || 0) + 1, rows: sanea(body && body.rows) };
      await redisSet(c, nuevo);
      return json({ ok: true, v: nuevo.v, n: nuevo.rows.length });
    }

    return json({ ok: false, error: 'metodo' }, 405);
  } catch (e) {
    return json({ ok: false, error: 'almacen', mensaje: String(e.message || e) }, 502);
  }
}
