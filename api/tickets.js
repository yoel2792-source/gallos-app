// ============================================================================
//  Log de tickets compartido. Misma mecanica que /api/destaque pero con su
//  propia llave en Upstash Redis: { v: <version>, rows: [...] }
// ============================================================================
export const config = { runtime: 'edge' };

const LLAVE = 'gpr:tickets';

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
    headers: { Authorization: 'Bearer ' + c.token }, cache: 'no-store'
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

const limpia = (s, max) => String(s == null ? '' : s).slice(0, max || 300);
function sanea(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 20000).map(r => ({
    id: limpia(r && r.id, 60),
    u: limpia(r && r.u, 200),
    pn: limpia(r && r.pn, 40),
    ag: limpia(r && r.ag, 200),
    tk: limpia(r && r.tk, 60),
    cat: limpia(r && r.cat, 120),
    com: limpia(r && r.com, 4000),
    prob: limpia(r && r.prob, 4000),
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
