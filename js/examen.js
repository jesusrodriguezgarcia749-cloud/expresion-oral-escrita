// examen.js — Examen en línea autocalificable, adaptado a los tres parciales
// de Expresión Oral y Escrita (p1, p2, final) y alineado con calculo.js.
//
// Cómo funciona:
//  1. El alumno entra con grupo + nombre + PIN.
//  2. Solo puede iniciar si el docente abrió el examen de ese parcial para su grupo.
//  3. Se le sortean N reactivos del banco correspondiente, con las opciones revueltas.
//     El sorteo se guarda: si recarga la página, le tocan los mismos.
//  4. Cronómetro visible. Al llegar a 0 se entrega automáticamente.
//  5. Si sale de la pantalla (cambia de app, minimiza, cambia de pestaña), el
//     examen se cierra al instante y queda bloqueado hasta que el docente lo reabra.
//  6. Al entregar se califica solo y se guarda en dos lugares:
//     - alumno/intentos/{parcial}: el detalle completo (para "ver mis respuestas")
//     - alumno/examenes/{parcial}: solo { calificacion }, que es de donde
//       calculo.js toma el rubro de Examen para ese parcial.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { TOPES } from "./calculo.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SESSION_KEY = 'eoe_sesion_alumno';

// Configuración de cada parcial: cuántas preguntas se sortean del banco y
// cuánto tiempo tiene el alumno. El tope de puntos se toma de calculo.js
// para que este archivo nunca tenga que repetir esos números a mano.
const PARCIALES_INFO = {
  p1:    { nombre: 'Examen Parcial 1', archivo: 'data/examen_p1.json',    minutosDefault: 60, tope: TOPES.p1.examen },
  p2:    { nombre: 'Examen Parcial 2', archivo: 'data/examen_p2.json',    minutosDefault: 60, tope: TOPES.p2.examen },
  final: { nombre: 'Examen Final',     archivo: 'data/examen_final.json', minutosDefault: 60, tope: TOPES.final.examen },
};
const PARCIALES = ['p1', 'p2', 'final'];

let sesion = null;
let parcialActivo = null;
let banco = null;         // reactivos del parcial
let intento = null;       // { ids, respuestas, iniciado, minutos, ... }
let temporizador = null;
let vigilanciaActiva = false;
let entregando = false;
let salidaPendiente = null;   // margen de tolerancia antes de cerrar

// ---------- utilidades ----------
function slugNombre(n) {
  return n.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function ver(id, visible) {
  const el = document.getElementById(id);
  if (el) el.hidden = !visible;
}

// Baraja usando una semilla fija, para que el mismo alumno vea siempre el
// mismo orden aunque recargue la página.
function barajarConSemilla(arr, semilla) {
  const copia = [...arr];
  let s = semilla;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function semillaDe(texto) {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) % 233280;
  return h || 1;
}

// ---------- login ----------
async function cargarGrupos() {
  const select = document.getElementById('login-grupo');
  const snap = await getDocs(query(collection(db, 'grupos'), orderBy('nombre')));
  select.innerHTML = '<option value="">— Elige tu grupo —</option>';
  snap.forEach(d => {
    const o = document.createElement('option');
    o.value = d.id; o.textContent = d.data().nombre;
    select.appendChild(o);
  });
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.hidden = true;

  const grupoId = document.getElementById('login-grupo').value;
  const nombre = document.getElementById('login-nombre').value.trim();
  const pin = document.getElementById('login-pin').value.trim();
  if (!grupoId || !nombre || !pin) return;

  try {
    const alumnoId = slugNombre(nombre);
    const snap = await getDoc(doc(db, 'grupos', grupoId, 'alumnos', alumnoId));
    if (!snap.exists() || String(snap.data().pin) !== pin) {
      err.textContent = 'No encontramos ese nombre y PIN en el grupo elegido. Verifica con tu docente.';
      err.hidden = false;
      return;
    }
    sesion = { grupoId, alumnoId, nombre: snap.data().nombre, pin };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sesion));
    await entrarASala();
  } catch (e2) {
    err.textContent = 'No se pudo entrar: ' + (e2.message || e2);
    err.hidden = false;
  }
});

document.getElementById('btn-salir').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  location.reload();
});

// ---------- sala de espera ----------
async function entrarASala() {
  ver('examen-login', false);
  ver('examen-sala', true);
  document.getElementById('whoami').textContent = `Hola, ${sesion.nombre}`;

  const cont = document.getElementById('sala-estado');
  cont.innerHTML = '<p class="empty-inline">Consultando exámenes disponibles…</p>';

  // ¿Qué exámenes abrió el docente para este grupo?
  let abiertos = [];
  try {
    const cfg = await getDoc(doc(db, 'grupos', sesion.grupoId, 'config', 'examenes'));
    abiertos = cfg.exists() && Array.isArray(cfg.data().abiertos) ? cfg.data().abiertos : [];
  } catch { abiertos = []; }

  abiertos = abiertos.filter(p => PARCIALES.includes(p));

  if (abiertos.length === 0) {
    cont.innerHTML = `
      <div class="examen-card">
        <h3>No hay exámenes abiertos</h3>
        <p>Tu docente aún no ha habilitado ningún examen para tu grupo. Vuelve cuando te lo indique.</p>
      </div>`;
    return;
  }

  // Estado de cada examen abierto para este alumno
  const tarjetas = [];
  for (const p of abiertos) {
    const est = await estadoIntento(p);
    tarjetas.push(tarjetaExamen(p, est));
  }
  cont.innerHTML = tarjetas.join('');

  cont.querySelectorAll('[data-iniciar]').forEach(btn => {
    btn.addEventListener('click', () => iniciarExamen(btn.dataset.iniciar));
  });
  cont.querySelectorAll('[data-continuar]').forEach(btn => {
    btn.addEventListener('click', () => iniciarExamen(btn.dataset.continuar));
  });
  cont.querySelectorAll('[data-ver]').forEach(btn => {
    btn.addEventListener('click', () => verResultado(btn.dataset.ver));
  });
}

async function estadoIntento(parcial) {
  try {
    const snap = await getDoc(doc(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'intentos', parcial));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

function tarjetaExamen(parcial, est) {
  const info = PARCIALES_INFO[parcial];

  if (!est) {
    return `
      <div class="examen-card">
        <h3>${info.nombre}</h3>
        <p>${info.minutosDefault} minutos · vale ${info.tope}% de tu calificación de este parcial.</p>
        <p class="reglas-titulo">Antes de comenzar, prepara tu teléfono:</p>
        <ul class="examen-reglas">
          <li>Silencia el timbre (baja el volumen o usa el interruptor lateral).</li>
          <li>Cierra WhatsApp y las demás apps que tengas abiertas.</li>
          <li><strong>No actives modo avión</strong> — necesitas internet durante todo el examen.</li>
          <li>Si entra una llamada, cuélgala sin salir de esta pantalla.</li>
          <li>Asegúrate de tener batería suficiente para ${info.minutosDefault} minutos.</li>
        </ul>
        <p class="reglas-titulo">Reglas del examen:</p>
        <ul class="examen-reglas">
          <li>Una vez iniciado, el cronómetro no se detiene.</li>
          <li>Si sales de esta pantalla, cambias de aplicación o minimizas el navegador, el examen se cierra y necesitarás autorización de tu docente.</li>
          <li>Solo tienes un intento.</li>
        </ul>
        <button class="btn btn-primary" data-iniciar="${parcial}">Iniciar examen</button>
      </div>`;
  }

  if (est.estado === 'entregado') {
    const calif = Number(est.calificacion ?? 0).toFixed(1);
    return `
      <div class="examen-card examen-hecho">
        <h3>${info.nombre}</h3>
        <p class="examen-calif-mini">Tu calificación: <strong>${calif} / 10</strong></p>
        <button class="btn btn-ghost-dark btn-small" data-ver="${parcial}">Ver mis respuestas</button>
      </div>`;
  }

  if (est.estado === 'bloqueado') {
    return `
      <div class="examen-card examen-bloqueado-card">
        <h3>${info.nombre} — bloqueado</h3>
        <p>Tu examen se cerró porque saliste de la pantalla. Avisa a tu docente para que lo reabra.</p>
        <p class="examen-detalle">Salidas registradas: ${est.salidas || 1}</p>
      </div>`;
  }

  // en curso
  return `
    <div class="examen-card">
      <h3>${info.nombre} — en curso</h3>
      <p>Tienes un examen iniciado. Continúa antes de que se acabe el tiempo.</p>
      <button class="btn btn-primary" data-continuar="${parcial}">Continuar examen</button>
    </div>`;
}

// ---------- iniciar / reanudar ----------
async function iniciarExamen(parcial) {
  parcialActivo = parcial;
  const info = PARCIALES_INFO[parcial];

  try {
    const res = await fetch(info.archivo, { cache: 'no-store' });
    if (!res.ok) throw new Error(`No se encontró el banco de reactivos (HTTP ${res.status})`);
    banco = await res.json();
  } catch (e) {
    alert('No se pudo cargar el examen: ' + e.message);
    return;
  }

  const ref = doc(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'intentos', parcial);
  const prev = await getDoc(ref);

  if (prev.exists() && prev.data().estado === 'entregado') { verResultado(parcial); return; }
  if (prev.exists() && prev.data().estado === 'bloqueado') { mostrarBloqueado(prev.data()); return; }

  if (prev.exists()) {
    intento = prev.data();
    // Si el respaldo local tiene más respuestas que la nube (se cayó internet
    // en la sesión anterior), recuperamos lo que se quedó sin sincronizar.
    const local = leerLocal();
    if (local && local.parcial === parcial &&
        Object.keys(local.respuestas || {}).length > Object.keys(intento.respuestas || {}).length) {
      intento.respuestas = { ...intento.respuestas, ...local.respuestas };
    }
  } else {
    // Sorteo de reactivos: semilla estable por alumno+parcial
    const semilla = semillaDe(sesion.alumnoId + '-' + parcial);
    const n = banco.config?.preguntasPorExamen || banco.reactivos.length;
    const ids = barajarConSemilla(banco.reactivos.map(r => r.id), semilla).slice(0, n);

    intento = {
      parcial,
      ids,
      semilla,
      respuestas: {},
      minutos: banco.config?.minutos || info.minutosDefault,
      minutosExtra: 0,
      iniciado: Date.now(),
      reanudadoEn: Date.now(),
      segundosAlPausar: (banco.config?.minutos || info.minutosDefault) * 60,
      estado: 'en_curso',
      salidas: 0,
      pinVerificado: sesion.pin,
    };
    await setDoc(ref, { ...intento, creado: serverTimestamp() });
  }

  ver('examen-sala', false);
  ver('examen-curso', true);
  document.getElementById('site-header').style.display = 'none';
  document.getElementById('barra-alumno').textContent = `${sesion.nombre} · ${info.nombre}`;

  renderReactivos();
  arrancarCronometro();
  activarVigilancia();
}

// ---------- render de reactivos ----------
function reactivoPorId(id) {
  return banco.reactivos.find(r => r.id === id);
}

function renderReactivos() {
  const root = document.getElementById('reactivos-root');
  root.innerHTML = '';

  intento.ids.forEach((id, i) => {
    const r = reactivoPorId(id);
    if (!r) return;
    root.appendChild(tarjetaReactivo(r, i + 1));
  });

  actualizarAvance();
}

function tarjetaReactivo(r, numero) {
  const card = document.createElement('div');
  card.className = 'reactivo-card';
  card.dataset.id = r.id;

  const guardada = intento.respuestas[r.id];

  let cuerpo = '';

  if (r.tipo === 'relacionar') {
    const semilla = semillaDe(r.id + intento.semilla);
    const derechas = barajarConSemilla(r.pares.map((p, i) => ({ t: p.derecha, i })), semilla);
    cuerpo = `<div class="relacionar-list">${r.pares.map((p, i) => `
      <div class="relacionar-row">
        <span class="relacionar-izq">${esc(p.izquierda)}</span>
        <select class="relacionar-select" data-idx="${i}">
          <option value="">— Elige —</option>
          ${derechas.map(d => `<option value="${d.i}" ${guardada && guardada[i] === d.i ? 'selected' : ''}>${esc(d.t)}</option>`).join('')}
        </select>
      </div>`).join('')}</div>`;

  } else {
    // opcion_multiple y verdadero_falso comparten formato
    const semilla = semillaDe(r.id + intento.semilla);
    const ops = barajarConSemilla(r.opciones.map((o, i) => ({ t: o, i })), semilla);
    cuerpo = `<div class="quiz-options">${ops.map(o => `
      <label class="quiz-option ${guardada === o.i ? 'selected' : ''}" data-idx="${o.i}">
        <input type="radio" name="q-${r.id}" value="${o.i}" ${guardada === o.i ? 'checked' : ''}>
        <span>${esc(o.t)}</span>
      </label>`).join('')}</div>`;
  }

  card.innerHTML = `
    <div class="reactivo-head">
      <span class="reactivo-num">${numero}</span>
      <span class="reactivo-tipo">${etiquetaTipo(r.tipo)}</span>
    </div>
    <h3 class="reactivo-pregunta">${esc(r.pregunta)}</h3>
    ${cuerpo}`;

  card.querySelectorAll('.quiz-option').forEach(l => {
    l.addEventListener('click', () => {
      intento.respuestas[r.id] = Number(l.dataset.idx);
      card.querySelectorAll('.quiz-option').forEach(x => x.classList.remove('selected'));
      l.classList.add('selected');
      guardarProgreso();
      actualizarAvance();
    });
  });

  card.querySelectorAll('.relacionar-select').forEach(sel => {
    sel.addEventListener('change', () => {
      intento.respuestas[r.id] = intento.respuestas[r.id] || {};
      const i = Number(sel.dataset.idx);
      if (sel.value === '') delete intento.respuestas[r.id][i];
      else intento.respuestas[r.id][i] = Number(sel.value);
      guardarProgreso();
      actualizarAvance();
    });
  });

  return card;
}

function etiquetaTipo(t) {
  return {
    opcion_multiple: 'Opción múltiple',
    verdadero_falso: 'Verdadero o falso',
    relacionar: 'Relaciona columnas',
  }[t] || '';
}

function contestada(r) {
  const g = intento.respuestas[r.id];
  if (g === undefined || g === null) return false;
  if (r.tipo === 'relacionar') return r.pares.every((_, i) => g[i] !== undefined);
  return true;
}

function actualizarAvance() {
  const total = intento.ids.length;
  const hechas = intento.ids.filter(id => {
    const r = reactivoPorId(id);
    return r && contestada(r);
  }).length;
  document.getElementById('barra-avance').textContent = `${hechas} de ${total} contestadas`;
}

let guardadoPendiente = null;

function claveLocal() {
  return `eoe_examen_${sesion.grupoId}_${sesion.alumnoId}_${parcialActivo}`;
}

// Respaldo en el propio teléfono: si se cae internet y el alumno cierra la
// página, al volver a entrar recupera lo que llevaba contestado.
function guardarLocal() {
  try { localStorage.setItem(claveLocal(), JSON.stringify(intento)); } catch { /* sin espacio */ }
}

function leerLocal() {
  try {
    const s = localStorage.getItem(claveLocal());
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function guardarProgreso() {
  guardarLocal();
  clearTimeout(guardadoPendiente);
  guardadoPendiente = setTimeout(async () => {
    try {
      await setDoc(doc(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'intentos', parcialActivo),
        { ...intento, actualizado: serverTimestamp() });
      marcarConexion(true);
    } catch (e) {
      console.warn('No se pudo guardar el avance:', e);
      marcarConexion(false);
    }
  }, 900);
}

// ---------- indicador de conexión ----------
function marcarConexion(ok) {
  const el = document.getElementById('estado-conexion');
  if (!el) return;
  el.className = 'estado-conexion ' + (ok ? 'con-ok' : 'con-mal');
  el.textContent = ok ? 'En línea' : 'Sin conexión';
}

function vigilarConexion() {
  window.addEventListener('online', () => marcarConexion(true));
  window.addEventListener('offline', () => marcarConexion(false));
  marcarConexion(navigator.onLine);
}

// ---------- cronómetro ----------
function segundosRestantes() {
  const base = intento.segundosAlPausar !== undefined && intento.segundosAlPausar !== null
    ? intento.segundosAlPausar
    : (intento.minutos || 60) * 60;
  const extra = (intento.minutosExtra || 0) * 60;
  const desde = intento.reanudadoEn || intento.iniciado;
  const transcurrido = Math.floor((Date.now() - desde) / 1000);
  return Math.max(0, base + extra - transcurrido);
}

function arrancarCronometro() {
  const el = document.getElementById('cronometro');
  const pinta = () => {
    const s = segundosRestantes();
    const m = Math.floor(s / 60);
    const seg = s % 60;
    el.textContent = `${String(m).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
    el.classList.toggle('urgente', s <= 300);
    el.classList.toggle('critico', s <= 60);
    if (s <= 0) {
      clearInterval(temporizador);
      entregar(true);
    }
  };
  pinta();
  temporizador = setInterval(pinta, 1000);
}

// ---------- vigilancia de salida ----------
function activarVigilancia() {
  vigilanciaActiva = true;
  document.addEventListener('visibilitychange', alSalir);
  window.addEventListener('blur', alSalir);
  window.addEventListener('focus', alVolver);
  window.addEventListener('beforeunload', avisarSalida);
  vigilarConexion();
}

function desactivarVigilancia() {
  vigilanciaActiva = false;
  clearTimeout(salidaPendiente);
  document.removeEventListener('visibilitychange', alSalir);
  window.removeEventListener('blur', alSalir);
  window.removeEventListener('focus', alVolver);
  window.removeEventListener('beforeunload', avisarSalida);
}

function avisarSalida(e) {
  if (!vigilanciaActiva || entregando) return;
  e.preventDefault();
  e.returnValue = '';
}

function alSalir() {
  if (!vigilanciaActiva || entregando) return;
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    clearTimeout(salidaPendiente);
    salidaPendiente = null;
    return;
  }
  if (salidaPendiente) return;
  salidaPendiente = setTimeout(() => {
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    cerrarPorSalida();
  }, 2000);
}

function alVolver() {
  if (salidaPendiente) { clearTimeout(salidaPendiente); salidaPendiente = null; }
}

async function cerrarPorSalida() {
  if (!vigilanciaActiva || entregando) return;

  vigilanciaActiva = false;
  clearInterval(temporizador);

  intento.estado = 'bloqueado';
  intento.salidas = (intento.salidas || 0) + 1;
  intento.bloqueadoEn = new Date().toISOString();
  intento.segundosAlPausar = segundosRestantes();
  intento.minutosExtra = 0;

  try {
    await setDoc(doc(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'intentos', parcialActivo),
      { ...intento, actualizado: serverTimestamp() });
  } catch (e) { console.warn('No se pudo registrar la salida:', e); }

  desactivarVigilancia();
  mostrarBloqueado(intento);
}

function mostrarBloqueado(est) {
  ver('examen-curso', false);
  ver('examen-sala', false);
  ver('examen-bloqueado', true);
  document.getElementById('site-header').style.display = '';
  document.getElementById('examen-bloqueado').innerHTML = `
    <div class="examen-card examen-bloqueado-card">
      <h2>Examen cerrado</h2>
      <p>Saliste de la pantalla del examen, así que se cerró automáticamente. Esto quedó registrado.</p>
      <p><strong>Salidas registradas:</strong> ${est.salidas || 1}</p>
      <p>Avisa a tu docente. Si fue accidental, puede reabrirte el examen desde su panel y continuarás donde te quedaste.</p>
      <a href="mi-progreso.html" class="btn btn-ghost-dark">Ir a Mi progreso</a>
    </div>`;
}

// ---------- calificación ----------
function esCorrecta(r) {
  const g = intento.respuestas[r.id];
  if (g === undefined || g === null) return false;
  if (r.tipo === 'relacionar') return r.pares.every((_, i) => g[i] === i);
  return g === r.correcta;
}

document.getElementById('btn-entregar').addEventListener('click', () => entregar(false));

async function entregar(automatico) {
  if (entregando) return;

  const sinContestar = intento.ids.filter(id => {
    const r = reactivoPorId(id);
    return r && !contestada(r);
  }).length;

  if (!automatico && sinContestar > 0) {
    const ok = confirm(`Te faltan ${sinContestar} pregunta${sinContestar !== 1 ? 's' : ''} por contestar. Si entregas ahora contarán como incorrectas.\n\n¿Entregar de todos modos?`);
    if (!ok) return;
  }

  entregando = true;
  desactivarVigilancia();
  clearInterval(temporizador);

  const detalle = intento.ids.map(id => {
    const r = reactivoPorId(id);
    if (!r) return null;
    return { id, correcto: esCorrecta(r) };
  }).filter(Boolean);

  const aciertos = detalle.filter(d => d.correcto).length;
  const total = detalle.length;
  const calificacion = total ? Math.round(aciertos / total * 100) / 10 : 0;

  intento.estado = 'entregado';
  intento.aciertos = aciertos;
  intento.total = total;
  intento.calificacion = calificacion;
  intento.detalle = detalle;
  intento.entregadoEn = new Date().toISOString();
  intento.automatico = !!automatico;

  guardarLocal();

  const base = ['grupos', sesion.grupoId, 'alumnos', sesion.alumnoId];

  const barra = document.getElementById('estado-conexion');
  let guardado = false;
  for (let i = 0; i < 10 && !guardado; i++) {
    try {
      // Detalle completo para "ver mis respuestas":
      await setDoc(doc(db, ...base, 'intentos', parcialActivo),
        { ...intento, actualizado: serverTimestamp() });
      // Resumen simple que calculo.js lee para el rubro de Examen de este parcial:
      await setDoc(doc(db, ...base, 'examenes', parcialActivo),
        { calificacion, origen: 'examen en línea', actualizado: serverTimestamp() });
      guardado = true;
      marcarConexion(true);
    } catch (e) {
      console.warn('Reintento de entrega', i + 1, e);
      marcarConexion(false);
      if (barra) barra.textContent = `Guardando… reintento ${i + 1}`;
      await new Promise(r => setTimeout(r, 6000));
    }
  }

  if (!guardado) {
    const sinRed = !navigator.onLine;
    alert(sinRed
      ? 'Tu examen se calificó, pero no hay conexión para guardarlo.\n\n' +
        'Tus respuestas quedaron guardadas en este teléfono. NO cierres esta pantalla ' +
        'y avisa a tu docente: en cuanto vuelva la señal, vuelve a entrar y se guardará solo.'
      : 'Tu examen se calificó, pero el servidor rechazó guardarlo.\n\n' +
        'Tus respuestas están guardadas en este teléfono. Avisa a tu docente ' +
        'mostrándole esta pantalla — es un problema de configuración, no tuyo.');
  } else {
    try { localStorage.removeItem(claveLocal()); } catch { /* nada */ }
  }

  mostrarResultado();
}

function mostrarResultado() {
  ver('examen-curso', false);
  ver('examen-resultado', true);
  document.getElementById('site-header').style.display = '';

  const info = PARCIALES_INFO[intento.parcial];
  const pct = intento.total ? intento.aciertos / intento.total * 100 : 0;
  const clase = pct >= 80 ? 'res-ok' : (pct >= 60 ? 'res-riesgo' : 'res-bajo');

  const fallos = intento.detalle.filter(d => !d.correcto);

  const revision = fallos.map(d => {
    const r = reactivoPorId(d.id);
    if (!r) return '';
    let correcta = '';
    if (r.tipo === 'relacionar') {
      correcta = '<ul class="rev-lista">' + r.pares.map(p => `<li><strong>${esc(p.izquierda)}</strong> → ${esc(p.derecha)}</li>`).join('') + '</ul>';
    } else {
      correcta = `<p class="rev-correcta">${esc(r.opciones[r.correcta])}</p>`;
    }
    return `
      <div class="rev-card">
        <p class="rev-pregunta">${esc(r.pregunta)}</p>
        <p class="rev-etq">Respuesta correcta:</p>
        ${correcta}
        <p class="rev-expl">${esc(r.explicacion)}</p>
      </div>`;
  }).join('');

  const ptsEquivalentes = (intento.calificacion / 10 * info.tope).toFixed(1);

  document.getElementById('examen-resultado').innerHTML = `
    <div class="resultado-hero ${clase}">
      <p class="res-etq">${info.nombre}</p>
      <p class="res-calif">${intento.calificacion.toFixed(1)}</p>
      <p class="res-sub">${intento.aciertos} de ${intento.total} correctas${intento.automatico ? ' · entregado por tiempo agotado' : ''}</p>
      <p class="res-pts">Equivale a ${ptsEquivalentes} de los ${info.tope} puntos de Examen en este parcial</p>
    </div>

    ${fallos.length === 0
      ? '<div class="examen-card"><h3>Examen perfecto</h3><p>Contestaste todo correctamente. Bien hecho.</p></div>'
      : `<h2 class="rev-titulo">Lo que fallaste (${fallos.length})</h2>
         <p class="rev-intro">Revisa con calma: aquí está la respuesta correcta y por qué lo es.</p>
         ${revision}`}

    <a href="mi-progreso.html" class="btn btn-primary btn-block">Ver mi progreso</a>`;
}

async function verResultado(parcial) {
  parcialActivo = parcial;
  if (!banco) {
    const res = await fetch(PARCIALES_INFO[parcial].archivo, { cache: 'no-store' });
    banco = await res.json();
  }
  const snap = await getDoc(doc(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'intentos', parcial));
  if (!snap.exists()) return;
  intento = snap.data();
  ver('examen-sala', false);
  mostrarResultado();
}

// ---------- arranque ----------
document.addEventListener('DOMContentLoaded', async () => {
  await cargarGrupos();
  const g = sessionStorage.getItem(SESSION_KEY);
  if (g) {
    try {
      sesion = JSON.parse(g);
      const snap = await getDoc(doc(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId));
      if (snap.exists() && String(snap.data().pin) === String(sesion.pin)) {
        await entrarASala();
        return;
      }
    } catch { /* sesión inválida */ }
    sessionStorage.removeItem(SESSION_KEY);
  }
});
