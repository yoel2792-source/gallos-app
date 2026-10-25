/* Gallero PR · versión móvil (PWA)
   Buscar gallos, ver su familia y seguir las castas. Solo lectura. */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://lpgzeiyparsqzhwopyvc.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxwZ3plaXlwYXJzcXpod29weXZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NzQzNzYsImV4cCI6MjA5MTA1MDM3Nn0.NIh_N6xxkwT-c_iROK0FMEfdgDYW89QwsMOv_k30S04';
  var COLS = 'id,numero_pinches,nombre,sexo,color,linea_genetica,padre_id,madre_id,jaula,amarrado,fecha_nacimiento,observaciones,cruce_id';
  var CACHE_KEY = 'gallero_movil_datos_v1';
  var DIAS_INCUBACION = 21;

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  var $app = document.getElementById('app');

  var S = {
    user: null, owner: null, listo: false, cargando: false, sinConexion: false, cacheTs: null,
    gallos: [], byId: new Map(), cruces: [], eventos: [],
    q: '', mes: null, dia: null, fotos: {}, loginErr: '', instalar: null
  };

  // ---------- utilidades ----------
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
  function nombre(g) { return !g ? 'Desconocido' : (g.nombre || (g.numero_pinches ? '#' + g.numero_pinches : 'Sin nombre')); }
  function icono(g) { return g && g.sexo === 'Gallina' ? '♀' : g && g.sexo === 'Pollo' ? '🐣' : '♂'; }
  function claseAv(g) { return g && g.sexo === 'Gallina' ? 'av h' : g && g.sexo === 'Pollo' ? 'av p' : 'av'; }
  function pct(f) { var p = f * 100; return (Number.isInteger(p) ? p : +p.toFixed(p < 10 ? 2 : 1)) + '%'; }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function hoyStr() { return ymd(new Date()); }
  function parseF(s) { var a = String(s).slice(0, 10).split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); }
  function fmtF(s) { return s ? parseF(s).toLocaleDateString('es-PR', { day: 'numeric', month: 'short' }) : ''; }
  function sumarDias(s, n) { var d = parseF(s); d.setDate(d.getDate() + n); return ymd(d); }
  function diasEntre(a, b) { return Math.round((parseF(b) - parseF(a)) / 86400000); }
  function mayus(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  function cuando(f) { return f === 0 ? 'hoy' : f === 1 ? 'mañana' : f > 0 ? 'en ' + f + ' días' : 'hace ' + plural(-f, 'día', 'días'); }
  function detalleG(g) {
    return [g.nombre && g.numero_pinches ? '#' + g.numero_pinches : null, g.sexo, g.color, g.jaula ? 'Jaula ' + g.jaula : null].filter(Boolean).join(' · ');
  }

  // ---------- datos ----------
  function indexar() { S.byId = new Map(S.gallos.map(function (g) { return [g.id, g]; })); }

  function leerCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.owner === S.owner) { S.gallos = c.gallos || []; S.cruces = c.cruces || []; S.eventos = c.eventos || []; S.cacheTs = c.ts; indexar(); return true; }
    } catch (e) { /* sin cache */ }
    return false;
  }
  function guardarCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ owner: S.owner, ts: Date.now(), gallos: S.gallos, cruces: S.cruces, eventos: S.eventos })); } catch (e) { /* lleno o bloqueado */ }
  }

  async function resolverOwner() {
    S.owner = S.user.id;
    try {
      var r = await sb.from('memberships').select('owner_id,role,status').eq('collaborator_id', S.user.id).eq('status', 'active').maybeSingle();
      if (r.data && r.data.role !== 'app_user') S.owner = r.data.owner_id;
      localStorage.setItem('gallero_movil_owner', S.owner);
    } catch (e) {
      S.owner = localStorage.getItem('gallero_movil_owner') || S.user.id;
    }
  }

  async function cargar() {
    S.cargando = true;
    try {
      var r = await Promise.all([
        sb.from('gallos').select(COLS).eq('user_id', S.owner).order('nombre'),
        sb.from('cruces').select('*').eq('user_id', S.owner).order('fecha_cruce', { ascending: false }),
        sb.from('cruce_eventos').select('*').eq('user_id', S.owner).order('fecha', { ascending: true })
      ]);
      if (r[0].error) throw r[0].error;
      S.gallos = r[0].data || []; S.cruces = (r[1].data || []); S.eventos = (r[2].data || []);
      S.sinConexion = false; S.cacheTs = Date.now(); indexar(); guardarCache();
    } catch (e) {
      S.sinConexion = true;
      if (!S.gallos.length) leerCache();
    }
    S.cargando = false; S.listo = true;
  }

  // ---------- búsqueda ----------
  function buscar(q) {
    var n = norm(q).replace(/^#/, '');
    if (!n) return S.gallos.slice();
    var esNum = /^\d+$/.test(n);
    var out = [];
    S.gallos.forEach(function (g) {
      var pin = g.numero_pinches == null ? '' : String(g.numero_pinches);
      var nom = norm(g.nombre);
      var p = -1;
      var pin0 = pin.replace(/^0+(?=\d)/, ''), n0 = n.replace(/^0+(?=\d)/, '');
      if (pin && (pin === n || (esNum && pin0 === n0))) p = 0;
      else if (pin && esNum && (pin.indexOf(n) === 0 || pin0.indexOf(n0) === 0)) p = 1;
      else if (nom.indexOf(n) === 0) p = 2;
      else if ((' ' + nom).indexOf(' ' + n) !== -1) p = 3;
      else if (nom.indexOf(n) !== -1) p = 4;
      else if (pin && esNum && (pin.indexOf(n) !== -1 || pin0.indexOf(n0) !== -1)) p = 5;
      else if (esNum && g.jaula != null && String(g.jaula) === n) p = 6;
      else if (norm(g.color).indexOf(n) !== -1 || norm(g.linea_genetica).indexOf(n) !== -1) p = 7;
      if (p >= 0) out.push({ g: g, p: p });
    });
    out.sort(function (a, b) { return a.p - b.p || norm(a.g.nombre).localeCompare(norm(b.g.nombre)); });
    return out.map(function (x) { return x.g; });
  }

  // ---------- sangre ----------
  function aporteDetalle(id) {
    var m = new Map();
    (function rec(x, e, path, via) {
      if (!x || !S.byId.has(x) || e > 8 || path.has(x)) return;
      var o = m.get(x) || { g: S.byId.get(x), frac: 0, veces: 0, via: new Set() };
      o.frac += Math.pow(0.5, e); o.veces += 1; if (via) o.via.add(via); m.set(x, o);
      var g = S.byId.get(x), np = new Set(path); np.add(x);
      rec(g.padre_id, e + 1, np, x); rec(g.madre_id, e + 1, np, x);
    })(id, 0, new Set(), null);
    m.forEach(function (o) {
      var mx = 0; o.via.forEach(function (c) { if (m.has(c)) mx = Math.max(mx, m.get(c).veces); });
      o.rep = o.veces > 1 && o.veces > mx;
    });
    return m;
  }
  function sangreFuerte(g) {
    var det = aporteDetalle(g.id);
    var todos = Array.from(det.values()).filter(function (o) {
      return o.g.id !== g.id && (o.rep || (o.g.id !== g.padre_id && o.g.id !== g.madre_id));
    });
    todos.sort(function (a, b) { return (b.rep ? 1 : 0) - (a.rep ? 1 : 0) || b.frac - a.frac || a.veces - b.veces; });
    var nRep = todos.filter(function (o) { return o.rep; }).length;
    return { lista: todos.slice(0, Math.max(4, Math.min(nRep, 8))), det: det };
  }

  // ---------- castas ----------
  function resumenCasta(c) {
    var evs = S.eventos.filter(function (e) { return e.cruce_id === c.id; });
    var pollos = S.gallos.filter(function (g) { return g.cruce_id === c.id; });
    function de(t) { return evs.filter(function (e) { return e.tipo === t; }); }
    function suma(t) { return de(t).reduce(function (s, e) { return s + (e.cantidad || 0); }, 0); }
    var fH = de('huevo').map(function (e) { return e.fecha; }).sort();
    var huevos = suma('huevo');
    var empolle = de('empollar').map(function (e) { return e.fecha; }).sort()[0] || null;
    var nacidos = suma('nacimiento');
    var fNac = de('nacimiento').map(function (e) { return e.fecha; }).sort()[0] || null;
    var fallido = de('fallido').length > 0 || c.estado === 'Fallido';
    var cerrada = c.estado === 'Cerrado';
    var esperada = empolle && !fNac && !fallido && !cerrada ? sumarDias(empolle, DIAS_INCUBACION) : null;
    var hoy = hoyStr(), fase, cls, dia = empolle ? diasEntre(empolle, hoy) + 1 : null;
    if (cerrada) { fase = 'Cerrada'; cls = 'f-cerrada'; }
    else if (fallido) { fase = 'Se perdió'; cls = 'f-perdida'; }
    else if (fNac) { fase = 'Nacieron ' + plural(nacidos || pollos.length, 'pollo', 'pollos'); cls = 'f-nacidos'; }
    else if (empolle) { fase = 'Empollando · día ' + Math.max(1, dia) + ' de ' + DIAS_INCUBACION; cls = 'f-empollando'; }
    else if (huevos > 0) { fase = 'Poniendo · ' + plural(huevos, 'huevo', 'huevos'); cls = 'f-poniendo'; }
    else { fase = 'Echada · ' + cuando(-diasEntre(c.fecha_cruce, hoy)).replace('hace ', 'hace '); cls = 'f-echada'; }
    return {
      evs: evs, pollos: pollos, huevos: huevos, fH: fH, empolle: empolle, nacidos: nacidos, fNac: fNac, fallido: fallido, cerrada: cerrada,
      esperada: esperada, faltan: esperada ? diasEntre(hoy, esperada) : null, fase: fase, cls: cls,
      pinchados: pollos.filter(function (g) { return g.numero_pinches; }).length,
      activa: !cerrada && !fallido && !(fNac && pollos.length > 0 && pollos.every(function (g) { return g.numero_pinches; }))
    };
  }
  function tituloCasta(c) {
    return '<span class="gallo-c">♂ ' + esc(nombre(S.byId.get(c.padre_id))) + '</span> <span class="x">×</span> <span class="gallina-c">♀ ' + esc(nombre(S.byId.get(c.madre_id))) + '</span>';
  }
  function tituloCastaTxt(c) { return nombre(S.byId.get(c.padre_id)) + ' × ' + nombre(S.byId.get(c.madre_id)); }
  function castasActivas() { return S.cruces.filter(function (c) { return resumenCasta(c).activa; }); }

  var EV = {
    echada: { i: '❤️', t: 'Le echó el gallo', c: '#be123c' },
    huevo: { i: '🥚', t: 'Puso huevo', c: '#b45309' },
    empollar: { i: '🪺', t: 'Se echó a empollar', c: '#1d4ed8' },
    nacimiento: { i: '🐣', t: 'Nacieron pollos', c: '#15803d' },
    pinchado: { i: '🏷️', t: 'Pinchados', c: '#9333ea' },
    nota: { i: '📝', t: 'Nota', c: '#78716c' },
    fallido: { i: '✖️', t: 'Se perdió', c: '#991b1b' },
    esperada: { i: '⏳', t: 'Van a nacer', c: '#7e22ce' }
  };
  var PRIORIDAD = ['nacimiento', 'esperada', 'empollar', 'huevo', 'echada', 'fallido', 'pinchado', 'nota'];
  function marcasCalendario() {
    var map = {};
    function add(f, tipo, c, ev) { if (!f) return; var k = String(f).slice(0, 10); (map[k] = map[k] || []).push({ tipo: tipo, c: c, ev: ev }); }
    S.cruces.forEach(function (c) {
      add(c.fecha_cruce, 'echada', c, null);
      var r = resumenCasta(c);
      r.evs.forEach(function (e) { add(e.fecha, e.tipo, c, e); });
      if (r.esperada) add(r.esperada, 'esperada', c, null);
    });
    return map;
  }

  // ---------- piezas de pantalla ----------
  function filaGallo(g, extra) {
    return '<a class="fila" href="#/g/' + g.id + '"><span class="' + claseAv(g) + (g.numero_pinches ? ' num' : '') + '">' + (g.numero_pinches ? g.numero_pinches : icono(g)) + '</span>' +
      '<span class="tx"><span class="nom">' + esc(g.nombre || 'Sin nombre') + '</span>' +
      '<span class="sub" style="display:block">' + esc([g.sexo, g.color, g.jaula ? 'Jaula ' + g.jaula : null, extra].filter(Boolean).join(' · ')) + '</span></span><span class="flecha">›</span></a>';
  }
  function tarjetaPariente(g, rol, hembra, rep) {
    if (!g) return '<div class="pariente nada"><div class="rol">' + rol + '</div><div class="nom">No registrado</div></div>';
    return '<a class="pariente' + (hembra ? ' m' : '') + (rep ? ' rep' : '') + '" href="#/g/' + g.id + '"><div class="rol">' + (hembra ? '♀ ' : '♂ ') + rol + '</div>' +
      '<div class="nom">' + esc(g.nombre || 'Sin nombre') + '</div><div class="sub">' + (g.numero_pinches ? 'Pinche ' + g.numero_pinches : 'Sin pinche') + (rep ? '<br><span class="tag">se repite</span>' : '') + '</div></a>';
  }
  function tarjetaCasta(c) {
    var r = resumenCasta(c);
    var h = '<a class="casta" href="#/c/' + c.id + '"><div class="pareja">' + tituloCasta(c) + '</div><span class="fase ' + r.cls + '">' + esc(r.fase) + '</span>';
    if (r.esperada) h += '<div class="cuenta-atras"><span>Nacen el ' + fmtF(r.esperada) + '</span><b>' + esc(mayus(cuando(r.faltan))) + '</b></div>';
    var partes = ['❤️ ' + fmtF(c.fecha_cruce)];
    if (r.huevos) partes.push('🥚 ' + r.huevos);
    if (r.empolle) partes.push('🪺 ' + fmtF(r.empolle));
    if (r.fNac) partes.push('🐣 ' + fmtF(r.fNac));
    if (r.pollos.length) partes.push(r.pinchados + '/' + r.pollos.length + ' pinchados');
    return h + '<div class="resumen">' + partes.join(' · ') + '</div></a>';
  }
  function avisos() {
    var h = '';
    if (S.sinConexion) h += '<div class="aviso amb">Sin conexión. Viendo lo guardado' + (S.cacheTs ? ' el ' + new Date(S.cacheTs).toLocaleString('es-PR', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '') + '.</div>';
    return h;
  }
  function nav(act) {
    var n = castasActivas().length;
    return '<nav class="nav"><div>' +
      '<a href="#/" class="' + (act === 'buscar' ? 'act' : '') + '"><span>🔎</span>Buscar</a>' +
      '<a href="#/castas" class="' + (act === 'castas' ? 'act' : '') + '"><span>🪺</span>Castas' + (n ? '<i class="globo">' + n + '</i>' : '') + '</a>' +
      '</div></nav>';
  }
  function barra(titulo, atras) {
    return '<div class="top"><div class="top-fila">' + (atras ? '<button class="atras" data-a="atras">‹ Volver</button>' : '') +
      '<h1 style="flex:1">' + esc(titulo) + '</h1></div></div>';
  }

  // ---------- pantallas ----------
  function vistaLogin() {
    $app.innerHTML = '<div class="login"><div class="logo">🐓</div><h1>Gallero PR</h1><p>Tus gallos en el bolsillo</p>' +
      '<form id="f-login">' + (S.loginErr ? '<div class="err">' + esc(S.loginErr) + '</div>' : '') +
      '<label for="em">Email</label><input id="em" type="email" autocomplete="username" inputmode="email" autocapitalize="none" required>' +
      '<label for="pw">Contraseña</label><input id="pw" type="password" autocomplete="current-password" required>' +
      '<button class="boton" type="submit">Entrar</button></form></div>';
  }

  function resultadosHTML() {
    var L = buscar(S.q), h = '';
    if (!S.q.trim()) {
      var act = castasActivas();
      if (act.length) {
        var prox = act.map(resumenCasta).filter(function (r) { return r.esperada; }).sort(function (a, b) { return a.faltan - b.faltan; })[0];
        h += '<a class="fila" href="#/castas" style="background:var(--verde-f);border-color:#bbf7d0"><span class="av" style="background:#dcfce7">🪺</span><span class="tx">' +
          '<span class="nom">' + plural(act.length, 'casta en proceso', 'castas en proceso') + '</span>' +
          '<span class="sub" style="display:block">' + (prox ? 'Próximos pollos ' + esc(cuando(prox.faltan)) : 'Toca para ver el calendario') + '</span></span><span class="flecha">›</span></a>';
      }
      h += '<div class="cuenta">' + S.gallos.length + ' gallos y gallinas</div>';
    } else {
      h += '<div class="cuenta">' + (L.length ? plural(L.length, 'resultado', 'resultados') : '') + '</div>';
    }
    if (!L.length) h += '<div class="vacio">' + (S.gallos.length ? 'No encontré nada con “' + esc(S.q) + '”.' : 'Todavía no hay gallos registrados.') + '</div>';
    h += L.map(function (g) { return filaGallo(g); }).join('');
    if (!S.q.trim()) h += '<div class="pie"><button class="boton sec2" data-a="refrescar">Actualizar la lista</button><a class="boton sec2" href="../">Abrir la app completa</a><button class="boton sec2" data-a="salir">Cerrar sesión</button></div>';
    return h;
  }
  function vistaBuscar() {
    $app.innerHTML = '<div class="top"><div class="top-fila"><h1>🐓 Gallero PR</h1><span style="display:flex;gap:6px">' +
      (S.instalar ? '<button class="top-btn" data-a="instalar">Instalar</button>' : '') +
      '</span></div>' +
      '<div class="busca"><input id="q" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Buscar gallo por número de pinche o por nombre" placeholder="Número o nombre" value="' + esc(S.q) + '">' +
      (S.q ? '<button class="limpiar" data-a="limpiar" aria-label="Borrar">✕</button>' : '') + '</div></div>' +
      '<div class="cuerpo">' + avisos() + '<div id="res">' + resultadosHTML() + '</div></div>' + nav('buscar');
  }

  function vistaGallo(id) {
    var g = S.byId.get(id);
    if (!g) { $app.innerHTML = barra('No encontrado', true) + '<div class="cuerpo"><div class="vacio">Ese gallo ya no está en la lista.</div></div>' + nav('buscar'); return; }
    var p = S.byId.get(g.padre_id), m = S.byId.get(g.madre_id);
    var sf = sangreFuerte(g), det = sf.det;
    function rep(x) { return !!(x && det.has(x.id) && det.get(x.id).rep); }
    var foto = S.fotos[id];
    var h = barra(nombre(g), true) + '<div class="cuerpo">' + avisos();

    h += '<div class="heroe">' + (foto ? '<img class="foto" src="' + esc(foto) + '" alt="">' : '<span id="foto-hueco" class="' + claseAv(g) + '">' + icono(g) + '</span>') +
      '<div style="min-width:0">' + (g.numero_pinches ? '<div class="pinchon">Pinche ' + g.numero_pinches + '</div>' : '') + '<h2>' + esc(g.nombre || 'Sin nombre') + '</h2><div class="chips">' +
      (g.numero_pinches ? '' : '<span class="chip">Sin pinche</span>') +
      '<span class="chip">' + esc(g.sexo === 'Pollo' ? 'Pollo (sexo por definir)' : g.sexo) + '</span>' +
      (g.color ? '<span class="chip">' + esc(g.color) + '</span>' : '') +
      (g.jaula ? '<span class="chip">Jaula ' + esc(g.jaula) + '</span>' : '') +
      (g.amarrado ? '<span class="chip">Amarrado</span>' : '') +
      (g.fecha_nacimiento ? '<span class="chip">Nació ' + fmtF(g.fecha_nacimiento) + ' ' + parseF(g.fecha_nacimiento).getFullYear() + '</span>' : '') +
      '</div></div></div>';
    if (g.observaciones) h += '<div class="obs">📝 ' + esc(g.observaciones) + '</div>';

    h += '<div class="sec">Padres</div><div class="par">' + tarjetaPariente(p, 'Padre', false, rep(p)) + tarjetaPariente(m, 'Madre', true, rep(m)) + '</div>';

    if (p || m) {
      h += '<div class="sec">Abuelos</div>';
      if (p) h += '<div class="lado">Por parte de padre</div><div class="par">' + tarjetaPariente(S.byId.get(p.padre_id), 'Abuelo', false, rep(S.byId.get(p.padre_id))) + tarjetaPariente(S.byId.get(p.madre_id), 'Abuela', true, rep(S.byId.get(p.madre_id))) + '</div>';
      if (m) h += '<div class="lado">Por parte de madre</div><div class="par">' + tarjetaPariente(S.byId.get(m.padre_id), 'Abuelo', false, rep(S.byId.get(m.padre_id))) + tarjetaPariente(S.byId.get(m.madre_id), 'Abuela', true, rep(S.byId.get(m.madre_id))) + '</div>';
    }

    if (sf.lista.length) {
      var tope = Math.max.apply(null, sf.lista.map(function (o) { return o.frac; }));
      h += '<div class="sec">Sangre más fuerte</div><div class="caja">' + sf.lista.map(function (o, i) {
        return '<a class="sangre' + (o.rep ? ' rep' : '') + '" href="#/g/' + o.g.id + '" style="display:block"><div class="l1"><span class="quien">' + icono(o.g) + ' ' + esc(nombre(o.g)) +
          (o.rep ? '<br><span class="tag">sale ' + o.veces + ' veces' + (i === 0 ? ' · el más fuerte' : '') + '</span>' : '') + '</span><span class="pct">' + pct(o.frac) + '</span></div>' +
          '<div class="barra"><i style="width:' + (o.frac / tope * 100) + '%"></i></div></a>';
      }).join('') + '<div class="nota">Cuánta sangre tiene de cada uno. El que sale más de una vez suma cada vez.</div></div>';
    }

    var otros = S.gallos.filter(function (x) { return x.id !== g.id; });
    function mismoP(x) { return !!g.padre_id && x.padre_id === g.padre_id; }
    function mismaM(x) { return !!g.madre_id && x.madre_id === g.madre_id; }
    var completos = otros.filter(function (x) { return mismoP(x) && mismaM(x); });
    var medP = otros.filter(function (x) { return mismoP(x) && !mismaM(x); });
    var medM = otros.filter(function (x) { return mismaM(x) && !mismoP(x); });
    var nH = completos.length + medP.length + medM.length;
    if (nH) {
      h += '<details class="mas"><summary>Hermanos (' + nH + ')</summary>';
      if (completos.length) h += '<div class="lado">Mismo padre y misma madre</div>' + completos.map(function (x) { return filaGallo(x); }).join('');
      if (medP.length) h += '<div class="lado">Medios por parte de padre</div>' + medP.map(function (x) { return filaGallo(x, S.byId.has(x.madre_id) ? 'madre: ' + nombre(S.byId.get(x.madre_id)) : null); }).join('');
      if (medM.length) h += '<div class="lado">Medios por parte de madre</div>' + medM.map(function (x) { return filaGallo(x, S.byId.has(x.padre_id) ? 'padre: ' + nombre(S.byId.get(x.padre_id)) : null); }).join('');
      h += '</details>';
    }

    var hijos = otros.filter(function (x) { return x.padre_id === g.id || x.madre_id === g.id; });
    if (hijos.length) {
      h += '<details class="mas"><summary>Hijos (' + hijos.length + ')</summary>';
      var grupos = [];
      hijos.forEach(function (x) {
        var o = (x.padre_id === g.id ? x.madre_id : x.padre_id) || null;
        var gr = grupos.filter(function (y) { return y.o === o; })[0];
        if (!gr) { gr = { o: o, l: [] }; grupos.push(gr); }
        gr.l.push(x);
      });
      grupos.forEach(function (gr) {
        h += '<div class="lado">' + (gr.o && S.byId.has(gr.o) ? 'Con ' + esc(nombre(S.byId.get(gr.o))) : (g.sexo === 'Gallina' ? 'Padre no registrado' : 'Madre no registrada')) + '</div>' + gr.l.map(function (x) { return filaGallo(x); }).join('');
      });
      h += '</details>';
    }

    var castas = S.cruces.filter(function (c) { return c.padre_id === g.id || c.madre_id === g.id; });
    if (castas.length) h += '<div class="sec">Sus castas <small>(' + castas.length + ')</small></div>' + castas.map(tarjetaCasta).join('');

    $app.innerHTML = h + '</div>' + nav('buscar');
    if (foto === undefined && !S.sinConexion) cargarFoto(id);
  }
  async function cargarFoto(id) {
    S.fotos[id] = null;
    try {
      var r = await sb.from('gallos').select('foto').eq('id', id).maybeSingle();
      var f = r.data && r.data.foto;
      if (f) {
        S.fotos[id] = f;
        var hueco = document.getElementById('foto-hueco');
        if (hueco && location.hash === '#/g/' + id) { var img = document.createElement('img'); img.className = 'foto'; img.alt = ''; img.src = f; hueco.replaceWith(img); }
      }
    } catch (e) { delete S.fotos[id]; }
  }

  function vistaCastas() {
    var hoy = hoyStr();
    if (!S.mes) { var d0 = new Date(); S.mes = { y: d0.getFullYear(), m: d0.getMonth() }; }
    if (!S.dia) S.dia = hoy;
    var act = S.cruces.filter(function (c) { return resumenCasta(c).activa; });
    var term = S.cruces.filter(function (c) { return !resumenCasta(c).activa; });
    var marcas = marcasCalendario();
    var h = barra('Castas', false) + '<div class="cuerpo">' + avisos();

    h += '<div class="sec" style="margin-top:4px">Castando ahora <small>(' + act.length + ')</small></div>';
    h += act.length ? act.map(tarjetaCasta).join('') : '<div class="aviso">No tienes ninguna casta en proceso. Para echar una, usa la app completa.</div>';

    var primero = new Date(S.mes.y, S.mes.m, 1), nD = new Date(S.mes.y, S.mes.m + 1, 0).getDate();
    h += '<div class="sec">Calendario</div><div class="cal"><div class="cal-top"><button data-a="mes" data-n="-1" aria-label="Mes anterior">‹</button><b>' +
      esc(mayus(primero.toLocaleDateString('es-PR', { month: 'long', year: 'numeric' }))) + '</b><button data-a="mes" data-n="1" aria-label="Mes siguiente">›</button></div><div class="cal-g">' +
      ['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(function (x) { return '<div class="dn">' + x + '</div>'; }).join('');
    for (var i = 0; i < primero.getDay(); i++) h += '<div></div>';
    for (var d = 1; d <= nD; d++) {
      var k = ymd(new Date(S.mes.y, S.mes.m, d)), ms = marcas[k] || [], top = null;
      PRIORIDAD.forEach(function (t) { if (!top && ms.some(function (x) { return x.tipo === t; })) top = t; });
      var sel = k === S.dia;
      h += '<button class="dia' + (k === hoy ? ' hoy' : '') + (top ? ' con' : '') + (sel ? ' sel' : '') + '" data-a="dia" data-k="' + k + '"' + (top ? ' style="background:' + EV[top].c + '"' : '') +
        ' aria-label="' + d + (top ? ', ' + EV[top].t : '') + '"><span class="n">' + d + '</span></button>';
    }
    h += '</div><div class="ley">' + ['echada', 'huevo', 'empollar', 'esperada', 'nacimiento'].map(function (t) {
      return '<span><i style="background:' + EV[t].c + '"></i>' + EV[t].t + '</span>';
    }).join('') + '</div></div>';

    var del = marcas[S.dia] || [];
    h += '<div class="sec">' + esc(mayus(parseF(S.dia).toLocaleDateString('es-PR', { weekday: 'long', day: 'numeric', month: 'long' }))) + '</div>';
    h += del.length ? del.map(function (x) {
      return '<a class="fila" href="#/c/' + x.c.id + '"><span class="av" style="background:#f5f5f4">' + EV[x.tipo].i + '</span><span class="tx"><span class="nom" style="display:block">' + EV[x.tipo].t + (x.ev && x.ev.cantidad ? ' · ' + x.ev.cantidad : '') + '</span>' +
        '<span class="sub" style="display:block">' + esc(tituloCastaTxt(x.c)) + (x.ev && x.ev.nota ? ' — ' + esc(x.ev.nota) : '') + '</span></span><span class="flecha">›</span></a>';
    }).join('') : '<div class="aviso">Nada anotado este día.</div>';

    if (term.length) h += '<div class="sec">Terminadas <small>(' + term.length + ')</small></div>' + term.map(tarjetaCasta).join('');
    $app.innerHTML = h + '</div>' + nav('castas');
  }

  function vistaCasta(id) {
    var c = S.cruces.filter(function (x) { return x.id === id; })[0];
    if (!c) { $app.innerHTML = barra('No encontrada', true) + '<div class="cuerpo"><div class="vacio">Esa casta ya no está.</div></div>' + nav('castas'); return; }
    var r = resumenCasta(c), p = S.byId.get(c.padre_id), m = S.byId.get(c.madre_id);
    function paso(estado, titulo, sub, ultimo) {
      return '<div class="paso ' + estado + '"><div class="marca"><span class="c">' + (estado === 'ok' ? '✓' : '•') + '</span>' + (ultimo ? '' : '<span class="raya"></span>') + '</div><div class="t"><b>' + esc(titulo) + '</b><div>' + esc(sub) + '</div></div></div>';
    }
    var rango = r.fH.length ? (r.fH[0] === r.fH[r.fH.length - 1] ? fmtF(r.fH[0]) : fmtF(r.fH[0]) + ' al ' + fmtF(r.fH[r.fH.length - 1])) : 'pendiente';
    var vivo = !r.fallido && !r.cerrada;
    var h = barra('Casta', true) + '<div class="cuerpo">' + avisos() +
      '<div class="caja"><div class="casta" style="border:0;padding:0;margin:0"><div class="pareja">' + tituloCasta(c) + '</div><span class="fase ' + r.cls + '">' + esc(r.fase) + '</span>' +
      (r.esperada ? '<div class="cuenta-atras"><span>Nacen el ' + fmtF(r.esperada) + '</span><b>' + esc(mayus(cuando(r.faltan))) + '</b></div>' : '') + '</div></div>';

    h += '<div class="sec">Cómo va</div><div class="caja">' +
      paso('ok', 'Le echó el gallo', fmtF(c.fecha_cruce)) +
      paso(r.huevos ? 'ok' : (vivo && !r.empolle && !r.fNac ? 'ya' : ''), r.huevos ? 'Puso ' + plural(r.huevos, 'huevo', 'huevos') : 'Puso huevos', rango) +
      paso(r.empolle && r.fNac ? 'ok' : (r.empolle && vivo ? 'ya' : ''), 'Se echó a empollar', r.empolle ? fmtF(r.empolle) + (!r.fNac && vivo ? ' · va por el día ' + Math.max(1, diasEntre(r.empolle, hoyStr()) + 1) : '') : 'pendiente') +
      paso(r.fNac ? 'ok' : '', r.fNac ? 'Nacieron ' + plural(r.nacidos || r.pollos.length, 'pollo', 'pollos') : 'Nacen los pollos', r.fNac ? fmtF(r.fNac) : r.esperada ? 'esperado ' + fmtF(r.esperada) + ' · ' + cuando(r.faltan) : 'pendiente') +
      paso(r.pollos.length && r.pinchados === r.pollos.length ? 'ok' : '', 'Pinchados', r.pollos.length ? r.pinchados + ' de ' + r.pollos.length + ' con pinche' : 'pendiente', true) + '</div>';

    h += '<div class="sec">La pareja</div><div class="par">' + tarjetaPariente(p, 'Gallo', false, false) + tarjetaPariente(m, 'Gallina', true, false) + '</div>';
    if (r.pollos.length) h += '<div class="sec">Pollos <small>(' + r.pollos.length + ')</small></div>' + r.pollos.map(function (x) { return filaGallo(x, x.numero_pinches ? null : 'sin pinche'); }).join('');

    var evs = r.evs.slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0; });
    if (evs.length) h += '<div class="sec">Historial</div>' + evs.map(function (e) {
      return '<div class="fila"><span class="av" style="background:#f5f5f4">' + EV[e.tipo].i + '</span><span class="tx"><span class="nom" style="display:block">' + EV[e.tipo].t + (e.cantidad ? ' · ' + e.cantidad : '') + '</span>' +
        '<span class="sub" style="display:block;white-space:normal">' + fmtF(e.fecha) + (e.nota ? ' — ' + esc(e.nota) : '') + '</span></span></div>';
    }).join('');
    if (c.notas) h += '<div class="obs">📝 ' + esc(c.notas) + '</div>';
    h += '<div class="nota" style="text-align:center;margin:18px 0">Para anotar huevos o pollos, usa la app completa.</div><a class="boton sec2" href="../">Abrir la app completa</a>';
    $app.innerHTML = h + '</div>' + nav('castas');
  }

  // ---------- navegación ----------
  function render() {
    if (!S.user) return vistaLogin();
    if (!S.listo) { $app.innerHTML = '<div class="cargando"><div class="logo">🐓</div>Cargando tus gallos…</div>'; return; }
    var h = location.hash || '#/', m;
    if ((m = h.match(/^#\/g\/(.+)$/))) vistaGallo(m[1]);
    else if (h === '#/castas') vistaCastas();
    else if ((m = h.match(/^#\/c\/(.+)$/))) vistaCasta(m[1]);
    else vistaBuscar();
  }
  var saltos = 0;
  window.addEventListener('hashchange', function () { saltos++; render(); if (!/^#\/castas$/.test(location.hash)) window.scrollTo(0, 0); });

  document.addEventListener('input', function (e) {
    if (e.target.id !== 'q') return;
    var antes = !!S.q; S.q = e.target.value;
    if (antes !== !!S.q) { vistaBuscar(); var q = document.getElementById('q'); q.focus(); q.setSelectionRange(S.q.length, S.q.length); }
    else document.getElementById('res').innerHTML = resultadosHTML();
  });
  document.addEventListener('keydown', function (e) { if (e.target.id === 'q' && e.key === 'Enter') e.target.blur(); });

  document.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-a]'); if (!b) return;
    var a = b.getAttribute('data-a');
    if (a === 'atras') { if (saltos > 0) history.back(); else location.hash = '#/'; }
    else if (a === 'limpiar') { S.q = ''; vistaBuscar(); document.getElementById('q').focus(); }
    else if (a === 'refrescar') { b.textContent = 'Actualizando…'; await cargar(); render(); window.scrollTo(0, 0); }
    else if (a === 'salir') { if (confirm('¿Seguro que quieres cerrar la sesión? Tendrás que escribir el email y la contraseña otra vez.')) { try { await sb.auth.signOut(); } catch (x) { /* nada */ } S.user = null; S.listo = false; S.gallos = []; S.cruces = []; S.eventos = []; try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem('gallero_movil_user'); localStorage.removeItem('gallero_movil_owner'); } catch (x) { /* nada */ } location.hash = '#/'; render(); } }
    else if (a === 'mes') { var d = new Date(S.mes.y, S.mes.m + Number(b.getAttribute('data-n')), 1); S.mes = { y: d.getFullYear(), m: d.getMonth() }; var y = window.scrollY; vistaCastas(); window.scrollTo(0, y); }
    else if (a === 'dia') { S.dia = b.getAttribute('data-k'); var y2 = window.scrollY; vistaCastas(); window.scrollTo(0, y2); }
    else if (a === 'instalar' && S.instalar) { S.instalar.prompt(); S.instalar = null; render(); }
  });

  document.addEventListener('submit', async function (e) {
    if (e.target.id !== 'f-login') return;
    e.preventDefault();
    var btn = e.target.querySelector('button'); btn.textContent = 'Entrando…';
    var em = document.getElementById('em').value.trim().toLowerCase(), pw = document.getElementById('pw').value.trim();
    var r;
    try { r = await sb.auth.signInWithPassword({ email: em, password: pw }); } catch (x) { r = { error: { message: 'red' } }; }
    if (r.error) { S.loginErr = /invalid/i.test(r.error.message || '') ? 'Email o contraseña incorrectos.' : 'No se pudo entrar. Revisa tu conexión.'; vistaLogin(); document.getElementById('em').value = em; return; }
    S.loginErr = ''; S.user = r.data.user;
    try { localStorage.setItem('gallero_movil_user', JSON.stringify({ id: S.user.id, email: S.user.email })); } catch (x) { /* nada */ }
    await entrar();
  });

  async function entrar() {
    render();
    await resolverOwner();
    if (leerCache()) { S.listo = true; render(); }
    await cargar();
    render();
  }

  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.instalar = e; if (S.user && S.listo && (location.hash || '#/') === '#/') render(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.user && S.listo && !S.cargando && Date.now() - (S.cacheTs || 0) > 5 * 60000) {
      cargar().then(function () { if (!document.activeElement || document.activeElement.id !== 'q') render(); });
    }
  });
  window.addEventListener('online', function () {
    if (S.modoGuardado) { S.modoGuardado = false; arrancar(); }
    else if (S.user && S.listo) cargar().then(render);
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* sin SW */ }); });
  }

  // Arranque. Si no hay conexión y la sesión no se puede renovar, se entra igual con lo guardado
  // para que la app siga sirviendo en la gallera sin señal.
  async function arrancar() {
    var r = null, fallo = null;
    try { r = await sb.auth.getSession(); fallo = r.error; } catch (e) { fallo = e; }
    var ses = r && r.data && r.data.session;
    if (ses) {
      S.user = ses.user;
      try { localStorage.setItem('gallero_movil_user', JSON.stringify({ id: ses.user.id, email: ses.user.email })); } catch (e) { /* nada */ }
      return entrar();
    }
    var guardado = null;
    try { guardado = JSON.parse(localStorage.getItem('gallero_movil_user') || 'null'); } catch (e) { /* nada */ }
    var sinRed = !navigator.onLine || (fallo && /fetch|network|retry/i.test(String(fallo.name) + ' ' + String(fallo.message)));
    if (guardado && sinRed) {
      S.user = guardado; S.owner = localStorage.getItem('gallero_movil_owner') || guardado.id;
      if (leerCache()) { S.sinConexion = true; S.listo = true; S.modoGuardado = true; return render(); }
    }
    S.user = null; render();
  }
  arrancar();
})();
