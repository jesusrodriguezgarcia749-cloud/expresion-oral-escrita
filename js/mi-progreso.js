// mi-progreso.js — panel personal del alumno: solo lee su propia información.
// Usa la MISMA fórmula que el panel docente (js/calculo.js), para que ambos
// paneles nunca muestren números distintos.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { calcularParcial, calcularCuatrimestre, NOMBRES_PARCIAL } from "./calculo.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SESSION_KEY = 'eoe_sesion_alumno';
const PARCIALES = ['p1', 'p2', 'final'];

let sesion = null;
let datosCache = null;

function slugNombre(nombre) {
  return nombre
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('form-alumno-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('login-alumno-error');
  errorEl.hidden = true;

  const grupoId = document.getElementById('login-grupo').value;
  const nombre = document.getElementById('login-nombre').value.trim();
  const pin = document.getElementById('login-pin').value.trim();
  if (!grupoId || !nombre || !pin) return;

  const alumnoId = slugNombre(nombre);
  const ref = doc(db, 'grupos', grupoId, 'alumnos', alumnoId);
  const snap = await getDoc(ref);

  if (!snap.exists() || String(snap.data().pin) !== pin) {
    errorEl.textContent = 'No encontramos ese nombre y PIN en el grupo elegido. Verifica con tu docente.';
    errorEl.hidden = false;
    return;
  }

  sesion = { grupoId, alumnoId, nombre: snap.data().nombre, pin };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(sesion));
  await iniciarApp();
});

document.getElementById('btn-cambiar-alumno').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  sesion = null;
  document.getElementById('progreso-app').hidden = true;
  document.getElementById('alumno-login').hidden = false;
});

async function cargarGruposEnSelect() {
  const select = document.getElementById('login-grupo');
  const snap = await getDocs(query(collection(db, 'grupos'), orderBy('nombre')));
  select.innerHTML = '<option value="">— Elige tu grupo —</option>';
  snap.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.data().nombre;
    select.appendChild(opt);
  });
}

// Carga UNA sola vez todos los datos del alumno y los deja en datosCache.
async function cargarDatos() {
  const base = ['grupos', sesion.grupoId, 'alumnos', sesion.alumnoId];
  const [tareasSnap, partSnap, asisSnap, unifP1, unifP2, exaP1, exaP2, exaFinal] = await Promise.all([
    getDocs(collection(db, ...base, 'tareas')).catch(() => null),
    getDocs(collection(db, ...base, 'participaciones')).catch(() => null),
    getDocs(collection(db, ...base, 'asistencias')).catch(() => null),
    getDoc(doc(db, ...base, 'uniformes', 'p1')).catch(() => null),
    getDoc(doc(db, ...base, 'uniformes', 'p2')).catch(() => null),
    getDoc(doc(db, ...base, 'examenes', 'p1')).catch(() => null),
    getDoc(doc(db, ...base, 'examenes', 'p2')).catch(() => null),
    getDoc(doc(db, ...base, 'examenes', 'final')).catch(() => null),
  ]);

  datosCache = {
    tareas: tareasSnap ? tareasSnap.docs.map(d => d.data()) : [],
    participaciones: partSnap ? partSnap.docs.map(d => d.data()) : [],
    asistencias: asisSnap ? asisSnap.docs.map(d => d.data()) : [],
    uniformes: {
      p1: unifP1 && unifP1.exists() ? unifP1.data() : null,
      p2: unifP2 && unifP2.exists() ? unifP2.data() : null,
    },
    examenes: {
      p1: exaP1 && exaP1.exists() ? exaP1.data() : null,
      p2: exaP2 && exaP2.exists() ? exaP2.data() : null,
      final: exaFinal && exaFinal.exists() ? exaFinal.data() : null,
    },
  };
}

function filaRubro(nombre, pts, tope, detalle) {
  const pct = tope ? Math.min(100, (pts / tope) * 100) : 0;
  return `
    <div class="prog-ensayo-row">
      <span class="prog-ensayo-tema">${nombre}${detalle ? ` <span class="field-hint">(${detalle})</span>` : ''}</span>
      <span class="prog-ensayo-calif">${pts.toFixed(1)} / ${tope} pts</span>
    </div>
  `;
}

function renderListaActividades(lista, vacio) {
  if (!lista || lista.length === 0) return `<p class="empty-inline">${vacio}</p>`;
  return `<ul class="prog-cal-leyenda" style="display:block;">` +
    lista
      .slice()
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
      .map(a => `<li>${escaparHTML(a.fecha || '')} — ${escaparHTML(a.nombre || '')}: <strong>${(Number(a.calificacion) || 0).toFixed(1)}/10</strong></li>`)
      .join('') +
    `</ul>`;
}

function renderParciales(resultados) {
  const cont = document.getElementById('prog-parciales');

  cont.innerHTML = PARCIALES.map(p => {
    const r = resultados[p];
    const pct = Math.min(100, r.total);
    const esFinal = p === 'final';

    const filasDetalle = esFinal
      ? filaRubro('Tareas y Participación', r.tareasParticipacion.pts, r.tareasParticipacion.tope) +
        filaRubro('Examen / Proyecto', r.examen.pts, r.examen.tope, r.examen.calificacion !== null ? `${r.examen.calificacion}/10` : 'sin capturar') +
        filaRubro('Asistencia', r.asistencia.pts, r.asistencia.tope, `${r.asistencia.presentes}/${r.asistencia.total} clases`)
      : filaRubro('Examen', r.examen.pts, r.examen.tope, r.examen.calificacion !== null ? `${r.examen.calificacion}/10` : 'sin capturar') +
        filaRubro('Tareas', r.tareas.pts, r.tareas.tope, r.tareas.promedio !== null ? `prom. ${r.tareas.promedio.toFixed(1)}/10` : 'sin capturar') +
        filaRubro('Participación', r.participacion.pts, r.participacion.tope, r.participacion.promedio !== null ? `prom. ${r.participacion.promedio.toFixed(1)}/10` : 'sin capturar') +
        filaRubro('Asistencia', r.asistencia.pts, r.asistencia.tope, `${r.asistencia.presentes}/${r.asistencia.total} clases`) +
        filaRubro('Uniformes', r.uniformes.pts, r.uniformes.tope, `${r.uniformes.faltas} falta(s)`);

    const listasDetalle = esFinal
      ? `<p class="field-hint" style="margin-top:10px;">Tareas y participación de este bloque:</p>${renderListaActividades([...r.tareasParticipacion.lista], 'Sin capturas todavía.')}`
      : `<p class="field-hint" style="margin-top:10px;">Tareas:</p>${renderListaActividades(r.tareas.lista, 'Sin tareas capturadas todavía.')}
         <p class="field-hint" style="margin-top:10px;">Participación:</p>${renderListaActividades(r.participacion.lista, 'Sin participación capturada todavía.')}`;

    return `
      <div class="prog-bloque-row">
        <span class="prog-bloque-nombre">${NOMBRES_PARCIAL[p]}</span>
        <div class="prog-bloque-bar-track"><div class="prog-bloque-bar-fill" style="width:${pct}%"></div></div>
        <span class="prog-bloque-stat">${r.total.toFixed(1)} / 100 pts</span>
      </div>
      <details class="prog-detalle-bloque">
        <summary>Ver desglose de ${NOMBRES_PARCIAL[p]}</summary>
        ${filasDetalle}
        ${listasDetalle}
      </details>
    `;
  }).join('');
}

function renderCuatrimestre(resultados) {
  const cont = document.getElementById('prog-cuatrimestre');
  const total = calcularCuatrimestre(resultados);

  cont.innerHTML = `
    <div class="prog-bloque-row">
      <span class="prog-bloque-nombre">Calificación final del cuatrimestre</span>
      <div class="prog-bloque-bar-track"><div class="prog-bloque-bar-fill" style="width:${Math.min(100, total)}%"></div></div>
      <span class="prog-bloque-stat">${total.toFixed(1)} / 100 pts</span>
    </div>
    <div class="prog-desglose">
      ${PARCIALES.map(p => `
        <div class="prog-ensayo-row">
          <span class="prog-ensayo-tema">${NOMBRES_PARCIAL[p]} (${p === 'final' ? '50' : '25'}%)</span>
          <span class="prog-ensayo-calif">${resultados[p].total.toFixed(1)} / 100</span>
        </div>
      `).join('')}
    </div>
  `;
}

async function renderAvisos() {
  const cont = document.getElementById('prog-avisos');
  const empty = document.getElementById('prog-avisos-empty');
  cont.innerHTML = '';

  let docs = [];
  try {
    const snap = await getDocs(query(collection(db, 'grupos', sesion.grupoId, 'avisos'), orderBy('creado', 'desc')));
    docs = snap.docs;
  } catch (err) {
    console.warn('No se pudieron cargar los avisos:', err);
  }

  empty.hidden = docs.length > 0;
  if (docs.length === 0) return;

  cont.innerHTML = docs.map(d => {
    const a = d.data();
    return `
      <div class="prog-aviso-card">
        <div class="prog-aviso-titulo">${escaparHTML(a.titulo || 'Aviso')}</div>
        <div class="prog-aviso-texto">${escaparHTML(a.texto || '')}</div>
      </div>
    `;
  }).join('');
}

async function iniciarApp() {
  document.getElementById('alumno-login').hidden = true;
  document.getElementById('progreso-app').hidden = false;
  document.getElementById('act-whoami-nombre').textContent = `Hola, ${sesion.nombre}`;

  await cargarDatos();
  const resultados = {};
  PARCIALES.forEach(p => { resultados[p] = calcularParcial(p, datosCache); });

  renderParciales(resultados);
  renderCuatrimestre(resultados);
  await renderAvisos();
}

document.addEventListener('DOMContentLoaded', async () => {
  await cargarGruposEnSelect();

  const guardada = sessionStorage.getItem(SESSION_KEY);
  if (guardada) {
    try {
      sesion = JSON.parse(guardada);
      const ref = doc(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId);
      const snap = await getDoc(ref);
      if (snap.exists() && String(snap.data().pin) === String(sesion.pin)) {
        await iniciarApp();
        return;
      }
    } catch { /* sesión inválida */ }
    sessionStorage.removeItem(SESSION_KEY);
  }
});
