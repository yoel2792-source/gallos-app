// Cierra la sesion borrando la cookie.
export const config = { runtime: 'edge' };

export default async function handler() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': 'erp_sesion=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
    }
  });
}
