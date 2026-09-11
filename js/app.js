// app.js — Coordinación Académica
// Login → elige carrera → elige materia → elige grupo → elige alumno → ve
// su resumen y descarga lo que necesite. Es de SOLO LECTURA: esta app
// nunca escribe nada en Firestore.
//
// Cada materia pertenece a una "carrera" (licenciatura) y tiene un
// "esquema" de calificación (ver firebase-config.js):
//   'bloques'   → Bases Culinarias           → calculo.js / reporte.js
//   'parciales' → Origen de las Cocinas, etc. → calculo-parciales.js / reporte-parciales.js
// Todo lo que depende del esquema está en las funciones marcadas "según
// esquema" — el resto (login, selector de grupo/alumno) es igual para todas.

import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  MATERIAS, CARRERAS, materiasDeCarrera, MATERIA_LOGIN,
  authDe, dbDe, sitioDe, esquemaDe, asignaturaDe,
} from "./firebase-config.js";

import { calcularBloque } from "./calculo.js";
import {
  reporteExamenAlumno, reporteAsistenciaAlumno,
  reporteParticipacionAlumno, reportePracticasAlumno, reporteConcentradoAlumno,
} from "./reporte.js";

import { calcularParcial, calcularCuatrimestre } from "./calculo-parciales.js";
import {
  reporteExamenParcial, reporteAsistenciaParcial,
  reporteTareasYParticipacionAlumno, reporteConcentradoParcial,
} from "./reporte-parciales.js";

const auth = authDe(MATERIA_LOGIN);

let carreraActiva = CARRERAS[0] || null;
let materiaActiva = null;
let grupoActivo = null;
let alumnosCache = [];
let bancosExamenCache = {}; // por materia+bloque/parcial

function on(id, evento, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evento, fn);
  return el;
}

function db() {
  return dbDe(materiaActiva);
}

function esquemaActivo() {
  return esquemaDe(materiaActiva);
}

// ---------- LOGIN ----------
onAuthStateChanged(auth, async user => {
  if (user) {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app-screen').hidden = false;
    poblarCarreras();
    poblarMateriasDeCarreraActiva();
    ajustarUIPorEsquema();
    await cargarGrupos();
  } else {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('app-screen').hidden = true;
  }
});

on('login-form', 'submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errorEl = document.getElementById('login-error');
  errorEl.hidden = true;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    console.error('Error de login:', err.code, err.message);
    const MENSAJES = {
      'auth/user-not-found': 'Ese correo no está dado de alta.',
      'auth/wrong-password': 'La contraseña no coincide.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/invalid-email': 'Ese correo no tiene un formato válido.',
      'auth/too-many-requests': 'Demasiados intentos fallidos — espera unos minutos.',
      'auth/network-request-failed': 'Falla de conexión a internet.',
    };
    errorEl.textContent = MENSAJES[err.code] || `No se pudo entrar (${err.code || err.message}).`;
    errorEl.hidden = false;
  }
});

on('btn-logout', 'click', () => signOut(auth));

// ---------- CARRERA ----------
function poblarCarreras() {
  const select = document.getElementById('carrera-select');
  if (select.options.length > 0) return; // ya poblado
  CARRERAS.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
  select.value = carreraActiva;
}

on('carrera-select', 'change', async (e) => {
  carreraActiva = e.target.value;
  materiaActiva = null;
  poblarMateriasDeCarreraActiva();
  grupoActivo = null;
  ocultarPanelAlumno();
  ajustarUIPorEsquema();
  await cargarGrupos();
});

// ---------- MATERIA ----------
function poblarMateriasDeCarreraActiva() {
  const select = document.getElementById('materia-select');
  select.innerHTML = '';
  const materias = materiasDeCarrera(carreraActiva);
  materias.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.nombre;
    select.appendChild(opt);
  });
  materiaActiva = materias[0]?.id || null;
  select.value = materiaActiva;
}

on('materia-select', 'change', async (e) => {
  materiaActiva = e.target.value;
  grupoActivo = null;
  ocultarPanelAlumno();
  ajustarUIPorEsquema();
  await cargarGrupos();
});

// Cambia las etiquetas/opciones de la interfaz según si la materia activa
// usa esquema de Bloques o de Parciales — así el mismo HTML sirve para
// ambas sin duplicar pantallas.
function ajustarUIPorEsquema() {
  const esquema = esquemaActivo();
  const selectDescarga = document.getElementById('descarga-bloque');
  const labelDescarga = document.querySelector('label[for="descarga-bloque"]');
  const btnParticipacion = document.getElementById('btn-descargar-participacion');
  const btnPracticas = document.getElementById('btn-descargar-practicas');

  if (esquema === 'parciales') {
    if (labelDescarga) labelDescarga.textContent = 'Parcial (para examen y asistencia)';
    if (selectDescarga) {
      selectDescarga.innerHTML = `
        <option value="p1">Parcial 1</option>
        <option value="p2">Parcial 2</option>
        <option value="final">Examen Final</option>`;
    }
    if (btnParticipacion) btnParticipacion.textContent = 'Tareas y Participación (PDF)';
    // Origen de las Cocinas no lleva un catálogo de "prácticas" separado
    // como Bases Culinarias (solo un examen práctico dentro del Parcial 2,
    // que ya se ve en el examen de ese parcial) — se oculta el botón.
    if (btnPracticas) btnPracticas.style.display = 'none';
  } else {
    if (labelDescarga) labelDescarga.textContent = 'Bloque (para examen y asistencia)';
    if (selectDescarga) {
      selectDescarga.innerHTML = `
        <option value="1">Bloque 1</option>
        <option value="2">Bloque 2</option>
        <option value="3">Bloque 3</option>`;
    }
    if (btnParticipacion) btnParticipacion.textContent = 'Participación (PDF)';
    if (btnPracticas) btnPracticas.style.display = '';
  }
}

// ---------- GRUPO ----------
// El selector de grupo está oculto en la interfaz: como cada materia tiene
// un solo grupo, se elige automáticamente el primero disponible y se cargan
// sus alumnos, para ahorrarle ese paso a Coordinación. Si alguna materia
// llegara a tener más de un grupo, basta con quitarle el atributo "hidden"
// al <select id="grupo-select"> en index.html y volverá a ser elegible.
async function cargarGrupos() {
  const select = document.getElementById('grupo-select');
  select.innerHTML = '<option value="">Selecciona…</option>';
  if (!materiaActiva) return;
  const snap = await getDocs(query(collection(db(), 'grupos'), orderBy('nombre')));
  snap.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.data().nombre;
    select.appendChild(opt);
  });

  // Selecciona automáticamente el primer (y normalmente único) grupo.
  const primerGrupo = snap.docs[0];
  if (primerGrupo) {
    select.value = primerGrupo.id;
    grupoActivo = primerGrupo.id;
    await cargarAlumnos();
  } else {
    grupoActivo = null;
    poblarSelectAlumnos([]);
  }
}

on('grupo-select', 'change', async (e) => {
  grupoActivo = e.target.value || null;
  ocultarPanelAlumno();
  if (grupoActivo) await cargarAlumnos();
  else poblarSelectAlumnos([]);
});

// ---------- ALUMNO ----------
async function cargarAlumnos() {
  const snap = await getDocs(query(collection(db(), 'grupos', grupoActivo, 'alumnos'), orderBy('nombre')));
  alumnosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  poblarSelectAlumnos(alumnosCache);
}

function poblarSelectAlumnos(lista) {
  const select = document.getElementById('alumno-select');
  select.innerHTML = '<option value="">Selecciona…</option>';
  lista.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.nombre;
    select.appendChild(opt);
  });
  const empty = document.getElementById('alumno-empty');
  if (empty) empty.hidden = lista.length > 0 || !!grupoActivo === false ? lista.length > 0 : true;
}

function ocultarPanelAlumno() {
  const panel = document.getElementById('alumno-panel');
  if (panel) panel.hidden = true;
}

on('alumno-select', 'change', async (e) => {
  const alumnoId = e.target.value;
  if (!alumnoId) { ocultarPanelAlumno(); return; }
  await mostrarAlumno(alumnoId);
});

function nombreDelGrupo() {
  const select = document.getElementById('grupo-select');
  return select.options[select.selectedIndex]?.textContent || 'Sin grupo';
}

function alumnoActual() {
  const id = document.getElementById('alumno-select').value;
  return alumnosCache.find(a => a.id === id);
}

// ---------- DATOS DEL ALUMNO (según esquema) ----------

// Esquema 'bloques' (Bases Culinarias) — sin cambios respecto al original.
async function datosDeAlumnoBloques(alumnoId) {
  const base = ['grupos', grupoActivo, 'alumnos', alumnoId];
  const [actSnap, evalSnap, ensSnap, asisSnap, exaSnap, intSnap, ajusSnap] = await Promise.all([
    getDocs(collection(db(), ...base, 'actividades')).catch(() => null),
    getDocs(collection(db(), ...base, 'evaluaciones')).catch(() => null),
    getDocs(collection(db(), ...base, 'ensayos')).catch(() => null),
    getDocs(collection(db(), ...base, 'asistencias')).catch(() => null),
    getDocs(collection(db(), ...base, 'examenes')).catch(() => null),
    getDocs(collection(db(), ...base, 'intentos')).catch(() => null),
    getDocs(collection(db(), ...base, 'ajustes')).catch(() => null),
  ]);

  const ensayos = {};
  if (ensSnap) ensSnap.docs.forEach(d => { ensayos[d.id] = d.data(); });
  const examenes = {};
  if (exaSnap) exaSnap.docs.forEach(d => { examenes[d.id] = d.data(); });
  const intentos = {};
  if (intSnap) intSnap.docs.forEach(d => { intentos[d.id] = d.data(); });
  const ajustes = {};
  if (ajusSnap) ajusSnap.docs.forEach(d => { ajustes[d.id] = d.data(); });

  return {
    idsActividades: actSnap ? actSnap.docs.map(d => d.id) : [],
    ensayos,
    practicas: evalSnap ? evalSnap.docs.map(d => d.data()) : [],
    asistencias: asisSnap ? asisSnap.docs.map(d => d.data()) : [],
    examenes,
    intentos,
    ajustes,
  };
}

// Esquema 'parciales' (Origen de las Cocinas, Expresión Oral y Escrita) —
// mismo patrón que usa admin.js de cada una de esas materias.
async function datosDeAlumnoParciales(alumnoId) {
  const base = ['grupos', grupoActivo, 'alumnos', alumnoId];
  const [tarSnap, partSnap, asisSnap, unifP1, unifP2, exaP1, exaP2, exaFinal, practicoP2, proyE1, proyE2, proyEF] = await Promise.all([
    getDocs(collection(db(), ...base, 'tareas')).catch(() => null),
    getDocs(collection(db(), ...base, 'participaciones')).catch(() => null),
    getDocs(collection(db(), ...base, 'asistencias')).catch(() => null),
    getDoc(doc(db(), ...base, 'uniformes', 'p1')).catch(() => null),
    getDoc(doc(db(), ...base, 'uniformes', 'p2')).catch(() => null),
    getDoc(doc(db(), ...base, 'examenes', 'p1')).catch(() => null),
    getDoc(doc(db(), ...base, 'examenes', 'p2')).catch(() => null),
    getDoc(doc(db(), ...base, 'examenes', 'final')).catch(() => null),
    getDoc(doc(db(), ...base, 'practico', 'p2')).catch(() => null),
    getDoc(doc(db(), ...base, 'proyecto', 'entrega1')).catch(() => null),
    getDoc(doc(db(), ...base, 'proyecto', 'entrega2')).catch(() => null),
    getDoc(doc(db(), ...base, 'proyecto', 'entregaFinal')).catch(() => null),
  ]);

  return {
    tareas: tarSnap ? tarSnap.docs.map(d => d.data()) : [],
    participaciones: partSnap ? partSnap.docs.map(d => d.data()) : [],
    asistencias: asisSnap ? asisSnap.docs.map(d => d.data()) : [],
    uniformes: { p1: unifP1 && unifP1.exists() ? unifP1.data() : null, p2: unifP2 && unifP2.exists() ? unifP2.data() : null },
    examenes: { p1: exaP1 && exaP1.exists() ? exaP1.data() : null, p2: exaP2 && exaP2.exists() ? exaP2.data() : null, final: exaFinal && exaFinal.exists() ? exaFinal.data() : null },
    practico: { p2: practicoP2 && practicoP2.exists() ? practicoP2.data() : null },
    proyecto: { entrega1: proyE1 && proyE1.exists() ? proyE1.data() : null, entrega2: proyE2 && proyE2.exists() ? proyE2.data() : null, entregaFinal: proyEF && proyEF.exists() ? proyEF.data() : null },
  };
}

let datosAlumnoActual = null;
let bloquesAlumnoActual = null;      // solo esquema 'bloques'
let resultadosAlumnoActual = null;   // solo esquema 'parciales' — { p1, p2, final }
let totalCuatrimestreActual = null;  // solo esquema 'parciales'

async function mostrarAlumno(alumnoId) {
  const panel = document.getElementById('alumno-panel');
  const resumen = document.getElementById('alumno-resumen');
  panel.hidden = false;
  resumen.innerHTML = '<p class="empty-inline">Cargando…</p>';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (esquemaActivo() === 'parciales') {
    datosAlumnoActual = await datosDeAlumnoParciales(alumnoId);
    resultadosAlumnoActual = {
      p1: calcularParcial('p1', datosAlumnoActual),
      p2: calcularParcial('p2', datosAlumnoActual),
      final: calcularParcial('final', datosAlumnoActual),
    };
    totalCuatrimestreActual = calcularCuatrimestre(resultadosAlumnoActual);
    bloquesAlumnoActual = null;
    renderResumenParciales(resumen);
  } else {
    datosAlumnoActual = await datosDeAlumnoBloques(alumnoId);
    bloquesAlumnoActual = [1, 2, 3].map(b => calcularBloque(b, datosAlumnoActual));
    resultadosAlumnoActual = null;
    totalCuatrimestreActual = null;
    renderResumenBloques(resumen);
  }
}

function renderResumenBloques(resumen) {
  const fila = (etiqueta, r, extra) => `
    <div class="res-row">
      <span>${etiqueta}${extra ? ` <small class="res-extra">${extra}</small>` : ''}${r.manual ? ' <small class="res-extra">· ajuste manual</small>' : ''}</span>
      <strong>${r.pts.toFixed(1)} / ${r.tope}</strong>
    </div>`;

  resumen.innerHTML = `
    ${bloquesAlumnoActual.map(x => `
      <div class="res-card">
        <h4>Bloque ${x.bloque}</h4>
        ${fila('Participación', x.participacion, `${x.participacion.hechas}/${x.participacion.deTotal} actividades`)}
        ${fila('Ensayos', x.ensayos, `${x.ensayos.entregados}/${x.ensayos.deTotal} bitácoras`)}
        ${fila('Prácticas de cocina', x.practicas, `${x.practicas.cuantas}/${x.practicas.deTotal} prácticas`)}
        ${fila('Asistencia', x.asistencia, `${x.asistencia.clases}/${x.asistencia.deTotal} clases · ${x.asistencia.conteo.falta} faltas`)}
        ${fila('Examen', x.examen, x.examen.calificacion !== null ? `${x.examen.calificacion}/10 · ${x.examen.origen}` : 'sin presentar')}
        <div class="res-row res-total">
          <span>Total Bloque ${x.bloque}</span>
          <strong>${x.total.toFixed(1)} / 100 pts</strong>
        </div>
      </div>
    `).join('')}
    <div class="score-display">
      Promedio: ${(bloquesAlumnoActual.reduce((s, x) => s + x.total, 0) / 3 / 10).toFixed(1)} / 10
    </div>
  `;
}

function renderResumenParciales(resumen) {
  const fila = (etiqueta, pts, tope) => `<div class="res-row"><span>${etiqueta}</span><strong>${pts.toFixed(1)} / ${tope}</strong></div>`;

  const NOMBRES = { p1: 'Parcial 1', p2: 'Parcial 2', final: 'Examen Final' };
  const bloquesHTML = ['p1', 'p2', 'final'].map(p => {
    const r = resultadosAlumnoActual[p];
    let cuerpo;
    if (p === 'final') {
      cuerpo = fila('Examen', r.examen.pts, r.examen.tope) +
        fila('Proyecto', r.proyecto.pts, r.proyecto.tope) +
        fila('Tareas y Participación', r.tareasParticipacion.pts, r.tareasParticipacion.tope) +
        fila('Asistencia', r.asistencia.pts, r.asistencia.tope);
    } else if (p === 'p2') {
      cuerpo = fila('Examen escrito', r.examenEscrito.pts, r.examenEscrito.tope) +
        fila('Examen práctico', r.practico.pts, r.practico.tope) +
        fila('Tareas', r.tareas.pts, r.tareas.tope) +
        fila(`Participación (${r.participacion.cantidad}/${r.participacion.meta})`, r.participacion.pts, r.participacion.tope) +
        fila('Asistencia', r.asistencia.pts, r.asistencia.tope) +
        fila('Uniformes', r.uniformes.pts, r.uniformes.tope);
    } else {
      cuerpo = fila('Examen', r.examen.pts, r.examen.tope) +
        fila('Tareas', r.tareas.pts, r.tareas.tope) +
        fila(`Participación (${r.participacion.cantidad}/${r.participacion.meta})`, r.participacion.pts, r.participacion.tope) +
        fila('Asistencia', r.asistencia.pts, r.asistencia.tope) +
        fila('Uniformes', r.uniformes.pts, r.uniformes.tope);
    }
    return `<div class="res-card"><h4>${NOMBRES[p]}</h4>${cuerpo}
      <div class="res-row res-total"><span>Total</span><strong>${r.total.toFixed(1)} / 100 pts</strong></div>
    </div>`;
  }).join('');

  resumen.innerHTML = `${bloquesHTML}
    <div class="score-display">
      Calificación final del cuatrimestre: ${(totalCuatrimestreActual / 10).toFixed(1)} / 10
    </div>`;
}

// ---------- DESCARGAS ----------
function mostrarMsgDescarga(texto, esError) {
  const msg = document.getElementById('descarga-msg');
  if (!msg) return;
  msg.textContent = texto;
  msg.style.color = esError ? '#A63D2F' : '#6B7A5E';
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, esError ? 6000 : 3000);
}

async function cargarBancoExamen(claveBloqueOParcial) {
  const clave = `${materiaActiva}-${claveBloqueOParcial}`;
  if (bancosExamenCache[clave]) return bancosExamenCache[clave];
  const nombreArchivo = esquemaActivo() === 'parciales'
    ? `examen_${claveBloqueOParcial}.json`
    : `examen_bloque${claveBloqueOParcial}.json`;
  const url = `${sitioDe(materiaActiva)}data/${nombreArchivo}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se encontró el banco de reactivos (HTTP ${res.status})`);
  const banco = await res.json();
  bancosExamenCache[clave] = banco;
  return banco;
}

on('btn-descargar-examen', 'click', async () => {
  const alumno = alumnoActual();
  if (!alumno) return;
  const clave = document.getElementById('descarga-bloque').value;
  try {
    const [snap, banco] = await Promise.all([
      getDoc(doc(db(), 'grupos', grupoActivo, 'alumnos', alumno.id, 'intentos', String(clave))),
      cargarBancoExamen(clave),
    ]);
    const intento = snap.exists() ? snap.data() : null;
    if (esquemaActivo() === 'parciales') {
      await reporteExamenParcial({ nombreGrupo: nombreDelGrupo(), alumno, asignatura: asignaturaDe(materiaActiva), parcial: clave, intento, banco });
    } else {
      await reporteExamenAlumno({ nombreGrupo: nombreDelGrupo(), alumno, bloque: clave, intento, banco });
    }
  } catch (err) {
    console.error(err);
    mostrarMsgDescarga('No se pudo generar el examen: ' + (err.message || err), true);
  }
});

on('btn-descargar-asistencia', 'click', async () => {
  const alumno = alumnoActual();
  if (!alumno) return;
  const clave = document.getElementById('descarga-bloque').value;

  if (esquemaActivo() === 'parciales') {
    if (!resultadosAlumnoActual) return;
    const r = resultadosAlumnoActual[clave];
    const dias = (datosAlumnoActual.asistencias || [])
      .filter(a => a.parcial === clave)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
    try {
      await reporteAsistenciaParcial({ nombreGrupo: nombreDelGrupo(), alumno, asignatura: asignaturaDe(materiaActiva), parcial: clave, r, diasOrdenados: dias });
    } catch (err) {
      console.error(err);
      mostrarMsgDescarga('No se pudo generar la asistencia: ' + (err.message || err), true);
    }
    return;
  }

  if (!bloquesAlumnoActual) return;
  const bloque = parseInt(clave, 10);
  const r = bloquesAlumnoActual.find(x => x.bloque === bloque);
  const diasOrdenados = (datosAlumnoActual.asistencias || [])
    .filter(a => Number(a.bloque) === bloque)
    .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  try {
    await reporteAsistenciaAlumno({ nombreGrupo: nombreDelGrupo(), alumno, bloque, r: { ...r, diasOrdenados } });
  } catch (err) {
    console.error(err);
    mostrarMsgDescarga('No se pudo generar la asistencia: ' + (err.message || err), true);
  }
});

on('btn-descargar-participacion', 'click', async () => {
  const alumno = alumnoActual();
  if (!alumno) return;
  try {
    if (esquemaActivo() === 'parciales') {
      if (!resultadosAlumnoActual) return;
      await reporteTareasYParticipacionAlumno({ nombreGrupo: nombreDelGrupo(), alumno, asignatura: asignaturaDe(materiaActiva), resultados: resultadosAlumnoActual });
    } else {
      if (!bloquesAlumnoActual) return;
      await reporteParticipacionAlumno({ nombreGrupo: nombreDelGrupo(), alumno, bloques: bloquesAlumnoActual });
    }
  } catch (err) {
    console.error(err);
    mostrarMsgDescarga('No se pudo generar el reporte: ' + (err.message || err), true);
  }
});

on('btn-descargar-practicas', 'click', async () => {
  // No aplica en esquema 'parciales' — el botón se oculta en
  // ajustarUIPorEsquema(), esto es solo un resguardo adicional.
  if (esquemaActivo() === 'parciales') return;
  const alumno = alumnoActual();
  if (!alumno || !bloquesAlumnoActual) return;
  try {
    await reportePracticasAlumno({ nombreGrupo: nombreDelGrupo(), alumno, bloques: bloquesAlumnoActual });
  } catch (err) {
    console.error(err);
    mostrarMsgDescarga('No se pudo generar el reporte: ' + (err.message || err), true);
  }
});

on('btn-descargar-concentrado', 'click', async () => {
  const alumno = alumnoActual();
  if (!alumno) return;
  try {
    if (esquemaActivo() === 'parciales') {
      if (!resultadosAlumnoActual) return;
      await reporteConcentradoParcial({ nombreGrupo: nombreDelGrupo(), alumno, asignatura: asignaturaDe(materiaActiva), resultados: resultadosAlumnoActual, totalCuatrimestre: totalCuatrimestreActual });
    } else {
      if (!datosAlumnoActual) return;
      await reporteConcentradoAlumno({ nombreGrupo: nombreDelGrupo(), alumno, datos: datosAlumnoActual });
    }
  } catch (err) {
    console.error(err);
    mostrarMsgDescarga('No se pudo generar el concentrado: ' + (err.message || err), true);
  }
});
