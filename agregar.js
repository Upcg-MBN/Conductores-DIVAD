// Agregaciones puras de los paneles de conductores: sin DOM, para poder
// probarlas con `node prueba.js`. Aquí va lo que se equivoca en silencio —la
// carga por responsable, las bandejas, los tramos y las reglas de alerta—;
// el dibujo queda en index.html.
//
// Cada división de datos.js trae `filas` (solo la última foto) como arreglos
// [nro, fecha, estado, responsable, díasTrámite, díasAsignado]; estado y
// responsable son índices en D.estados y B.responsables.
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- umbrales
  // Ninguna división tiene un plazo acordado para responder un conductor.
  // Estos cortes son la regla declarada del panel, en el glosario, y se
  // cambian en un solo lugar. Hay que acordarlos con DIJUR y DIVAD.
  var REGLAS = {
    alerta: 30,       // días con el mismo responsable que encienden la alerta
    critico: 180,     // 6 meses: el plazo máximo del procedimiento (Ley 19.880, art. 27)
    antiguo: 2022,    // ingresados hasta este año: candidatos a depuración
    cargaFactor: 2,   // stock sobre 2 × la mediana del equipo: carga alta
    topN: 20          // conductores más antiguos que se listan
  };

  var F = { nro: 0, fecha: 1, estado: 2, resp: 3, tramite: 4, asignado: 5 };

  var ESTADOS = ['bueno', 'alerta', 'critico'];
  function peor(a, b) {
    return ESTADOS.indexOf(a) >= ESTADOS.indexOf(b) ? a : b;
  }

  function mediana(v) {
    if (!v.length) return null;
    var s = v.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Índice de tramo: el primer límite que no se pasa; el último es abierto.
  function tramo(dias, tramos) {
    for (var i = 0; i < tramos.length; i++) if (dias <= tramos[i]) return i;
    return tramos.length;
  }

  function estadoDias(dias) {
    return dias > REGLAS.critico ? 'critico' : dias > REGLAS.alerta ? 'alerta' : 'bueno';
  }

  function esBandeja(B, i) { return B.responsables[i].rol === 'bandeja'; }

  // f = { estado, resp, tramo }: índices o null. El tramo es por días en
  // trámite, igual que la página Antigüedad.
  function filtrar(D, B, f) {
    f = f || {};
    return B.filas.filter(function (r) {
      return (f.estado == null || r[F.estado] === f.estado) &&
             (f.resp == null || r[F.resp] === f.resp) &&
             (f.tramo == null || tramo(r[F.tramite], D.tramos) === f.tramo);
    });
  }

  // ---------------------------------------------------------------- carga
  // Una fila por responsable con stock. La bandeja (recepción o jefatura,
  // marcada en responsables.csv) es trabajo sin distribuir: va aparte y no
  // entra en la mediana del equipo, o un solo buzón de miles de conductores
  // haría parecer liviano a todo el resto.
  function carga(D, B, filas) {
    var m = {};
    filas.forEach(function (r) {
      var i = r[F.resp];
      var x = m[i] || (m[i] = { i: i, alias: B.responsables[i].alias, rol: B.responsables[i].rol,
                                activo: B.responsables[i].activo, n: 0, dias: [],
                                porTramo: D.tramos.map(function () { return 0; }).concat(0),
                                alerta: 0, criticos: 0 });
      x.n++;
      x.dias.push(r[F.asignado]);
      x.porTramo[tramo(r[F.asignado], D.tramos)]++;
      var e = estadoDias(r[F.asignado]);
      if (e === 'alerta') x.alerta++;
      if (e === 'critico') x.criticos++;
    });
    var lista = Object.keys(m).map(function (k) {
      var x = m[k];
      x.medAsignado = mediana(x.dias);
      delete x.dias;
      return x;
    }).sort(function (a, b) { return b.n - a.n || (a.alias < b.alias ? -1 : 1); });
    var personas = lista.filter(function (x) { return x.rol !== 'bandeja'; });
    var med = mediana(personas.map(function (x) { return x.n; }));
    personas.forEach(function (x) { x.cargaAlta = med !== null && x.n > REGLAS.cargaFactor * med; });
    return { personas: personas, bandejas: lista.filter(function (x) { return x.rol === 'bandeja'; }),
             medianaEquipo: med };
  }

  // ---------------------------------------------------------------- KPIs
  function kpis(D, B, filas) {
    var tram = filas.map(function (r) { return r[F.tramite]; });
    var asig = filas.map(function (r) { return r[F.asignado]; });
    var criticos = asig.filter(function (d) { return d > REGLAS.critico; }).length;
    var bandeja = filas.filter(function (r) { return esBandeja(B, r[F.resp]); }).length;
    var conStock = {};
    filas.forEach(function (r) { if (!esBandeja(B, r[F.resp])) conStock[r[F.resp]] = 1; });
    var u = B.cortes[B.cortes.length - 1];
    return {
      stock: filas.length, criticos: criticos,
      pctCriticos: filas.length ? criticos / filas.length : null,
      medTramite: mediana(tram), medAsignado: mediana(asig),
      bandeja: bandeja, pctBandeja: filas.length ? bandeja / filas.length : null,
      responsables: Object.keys(conStock).length,
      ingresos: u.ingresos, egresos: u.egresos, reasignaciones: u.reasignaciones,
      desde: B.cortes.length > 1 ? B.cortes[B.cortes.length - 2].corte : null
    };
  }

  // ------------------------------------------------------------- antigüedad
  // Por días en trámite (desde que entró el conductor, no desde la última
  // asignación) y por año de ingreso.
  function antiguedad(D, filas) {
    var porTramo = D.tramos.map(function () { return 0; }).concat(0), porAnio = {};
    filas.forEach(function (r) {
      porTramo[tramo(r[F.tramite], D.tramos)]++;
      var a = r[F.fecha].slice(0, 4);
      porAnio[a] = (porAnio[a] || 0) + 1;
    });
    return {
      porTramo: porTramo,
      porAnio: Object.keys(porAnio).sort().map(function (a) { return { anio: +a, n: porAnio[a] }; })
    };
  }

  function masAntiguos(filas, n) {
    return filas.slice().sort(function (a, b) { return b[F.asignado] - a[F.asignado] || b[F.tramite] - a[F.tramite]; })
                .slice(0, n || REGLAS.topN);
  }

  // ---------------------------------------------------------------- alertas
  // Con su motivo escrito: si una alerta no puede explicarse en una línea, el
  // umbral está mal puesto. Ordenadas de peor a mejor.
  function cl(n) { return Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 }); }
  function alertas(D, B, filas) {
    var out = [], c = carga(D, B, filas), k = kpis(D, B, filas);
    if (k.criticos) {
      out.push({ estado: 'critico', tipo: 'Plazo',
                 texto: cl(k.criticos) + ' conductores llevan más de ' + REGLAS.critico +
                        ' días con el mismo responsable' });
    }
    var ex = c.personas.concat(c.bandejas).filter(function (x) { return !x.activo; });
    if (ex.length) {
      var nEx = ex.reduce(function (s, x) { return s + x.n; }, 0);
      out.push({ estado: 'critico', tipo: 'Responsable',
                 texto: cl(nEx) + ' conductores asignados a quien ya no está en la división (' +
                        ex.map(function (x) { return x.alias; }).join(', ') + ')' });
    }
    c.bandejas.forEach(function (x) {
      out.push({ estado: 'alerta', tipo: 'Sin distribuir',
                 texto: cl(x.n) + ' conductores en la bandeja ' + x.alias + ', con mediana de ' +
                        cl(x.medAsignado) + ' días sin asignar' });
    });
    var alta = c.personas.filter(function (x) { return x.cargaAlta; });
    if (alta.length) {
      // Los cinco más cargados; el resto se cuenta (la lista completa está en
      // la página Carga por responsable).
      out.push({ estado: 'alerta', tipo: 'Carga',
                 texto: alta.slice(0, 5).map(function (x) { return x.alias + ' (' + cl(x.n) + ')'; }).join(', ') +
                        (alta.length > 5 ? ' y ' + (alta.length - 5) + ' más' : '') +
                        ': más del doble de la mediana del equipo (' + cl(c.medianaEquipo) + ' conductores)' });
    }
    var corr = filas.filter(function (r) {
      return D.estados[r[F.estado]] === 'POR CORREGIR' && r[F.asignado] > REGLAS.alerta;
    }).length;
    if (corr) {
      out.push({ estado: 'alerta', tipo: 'Por corregir',
                 texto: cl(corr) + ' conductores por corregir hace más de ' + REGLAS.alerta + ' días' });
    }
    var viejos = filas.filter(function (r) { return +r[F.fecha].slice(0, 4) <= REGLAS.antiguo; }).length;
    if (viejos) {
      out.push({ estado: 'alerta', tipo: 'Depuración',
                 texto: cl(viejos) + ' conductores ingresados en ' + REGLAS.antiguo +
                        ' o antes siguen pendientes: revisar si corresponde cerrarlos' });
    }
    return out.sort(function (a, b) { return ESTADOS.indexOf(b.estado) - ESTADOS.indexOf(a.estado); });
  }

  function semaforo(D, B, filas) {
    return alertas(D, B, filas).reduce(function (e, a) { return peor(e, a.estado); }, 'bueno');
  }

  var api = {
    REGLAS: REGLAS, F: F, mediana: mediana, tramo: tramo, estadoDias: estadoDias, peor: peor,
    filtrar: filtrar, carga: carga, kpis: kpis, antiguedad: antiguedad, masAntiguos: masAntiguos,
    alertas: alertas, semaforo: semaforo
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.AGG = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
