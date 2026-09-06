// admin.js — Panel docente de Expresión Oral y Escrita.
// Estructura de datos (ver calculo.js para la fórmula que las consume):
//   grupos/{g}/tareas_catalogo/{id}          { nombre, fecha, parcial }
//   grupos/{g}/participaciones_catalogo/{id} { nombre, fecha, parcial }
//   grupos/{g}/alumnos/{a}/tareas/{id}          { parcial, nombre, fecha, calificacion }
//   grupos/{g}/alumnos/{a}/participaciones/{id} { parcial, nombre, fecha, calificacion }
//   grupos/{g}/alumnos/{a}/asistencias/{fecha}  { parcial, fecha, estado }
//   grupos/{g}/alumnos/{a}/uniformes/{parcial}  { faltas }
//   grupos/{g}/alumnos/{a}/examenes/{parcial}   { calificacion }  (lo escribe examen.js)
//   grupos/{g}/alumnos/{a}/intentos/{parcial}   detalle completo (lo escribe examen.js)
//   grupos/{g}/config/examenes                  { abiertos: ['p1','p2','final'] }
//   grupos/{g}/avisos/{id}

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, deleteDoc, addDoc, getDoc, getDocs,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { calcularParcial, calcularCuatrimestre, NOMBRES_PARCIAL, TOPES } from "./calculo.js";
import { reporteGrupo, reporteAlumno, reporteExamenAlumno, reporteExamenGrupo } from "./reporte.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const PARCIALES = ['p1', 'p2', 'final'];
const ETIQUETA_ESTADO = { presente: 'Presente', retardo: 'Retardo', justificado: 'Justificado', falta: 'Falta' };
const CICLO_ESTADO = { presente: 'retardo', retardo: 'justificado', justificado: 'falta', falta: 'presente' };

let grupoActivo = null;
let alumnosCache = [];

function on(id, evento, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evento, fn);
  else console.warn(`[admin] No existe #${id} en este HTML.`);
  return el;
}

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function marcarResultado(botonId, msgId, exito, textoExito, textoError) {
  const boton = document.getElementById(botonId);
  if (boton) {
    boton.style.transition = 'background-color .15s ease, color .15s ease';
    boton.style.backgroundColor = exito ? '#4A5D3C' : '#A63D2F';
    boton.style.color = '#fff';
    setTimeout(() => { boton.style.backgroundColor = ''; boton.style.color = ''; }, 1100);
  }
  const msg = document.getElementById(msgId);
  if (msg) {
    msg.textContent = exito ? textoExito : textoError;
    msg.hidden = false;
    setTimeout(() => { msg.hidden = true; }, exito ? 3000 : 6000);
  }
}

// ---------- LOGIN ----------
onAuthStateChanged(auth, async user => {
  if (user) {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app-screen').hidden = false;
    await cargarGrupos();
    const select = document.getElementById('grupo-select');
    const guardado = localStorage.getItem('eoe_grupo_activo');
    if (guardado && [...select.options].some(o => o.value === guardado)) select.value = guardado;
    if (select.value) {
      grupoActivo = select.value;
      localStorage.setItem('eoe_grupo_activo', grupoActivo);
      await cargarAlumnos();
      cargarTabActiva();
    }
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
    const MENSAJES = {
      'auth/user-not-found': 'Ese correo no está dado de alta en Firebase Authentication.',
      'auth/wrong-password': 'La contraseña no coincide con la de ese usuario.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos, o el usuario no existe.',
      'auth/invalid-email': 'Ese correo no tiene un formato válido.',
      'auth/too-many-requests': 'Demasiados intentos fallidos — espera unos minutos.',
      'auth/network-request-failed': 'Falla de conexión a internet.',
    };
    errorEl.textContent = MENSAJES[err.code] || `No se pudo entrar (${err.code || err.message}).`;
    errorEl.hidden = false;
  }
});

on('btn-logout', 'click', () => signOut(auth));

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  cargarTabActiva();
}

function cargarTabActiva() {
  const btnActivo = document.querySelector('.tab-btn.active');
  if (!btnActivo) return;
  const tab = btnActivo.dataset.tab;
  if (tab === 'tareas') cargarCatalogo('tareas');
  if (tab === 'participacion') cargarCatalogo('participaciones');
  if (tab === 'proyecto') cargarProyecto();
  if (tab === 'asistencia') cargarAsistencia();
  if (tab === 'uniformes') cargarUniformes();
  if (tab === 'enlinea') { cargarExamenesAbiertos(); cargarIntentos(); }
  if (tab === 'historial') cargarHistorial();
  if (tab === 'avisos') cargarAvisos();
}

// ---------- GRUPOS ----------
async function cargarGrupos() {
  const select = document.getElementById('grupo-select');
  const snap = await getDocs(query(collection(db, 'grupos'), orderBy('nombre')));
  select.innerHTML = '<option value="">— Elige un grupo —</option>';
  snap.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.data().nombre;
    select.appendChild(opt);
  });
}

on('btn-nuevo-grupo', 'click', crearGrupo);
on('grupo-select', 'change', async (e) => {
  grupoActivo = e.target.value || null;
  if (grupoActivo) {
    localStorage.setItem('eoe_grupo_activo', grupoActivo);
    await cargarAlumnos();
    cargarTabActiva();
  } else {
    localStorage.removeItem('eoe_grupo_activo');
    renderAlumnos([]);
  }
});

async function crearGrupo() {
  const nombre = prompt('Nombre del nuevo grupo (ej. "Expresión Oral y Escrita — Vespertino A"):');
  if (!nombre || !nombre.trim()) return;
  const ref = await addDoc(collection(db, 'grupos'), { nombre: nombre.trim(), creado: serverTimestamp() });
  await cargarGrupos();
  document.getElementById('grupo-select').value = ref.id;
  grupoActivo = ref.id;
  localStorage.setItem('eoe_grupo_activo', grupoActivo);
  cargarAlumnos();
}

on('btn-eliminar-grupo', 'click', eliminarGrupo);

async function eliminarGrupo() {
  if (!grupoActivo) { alert('Elige el grupo que quieres eliminar.'); return; }
  const select = document.getElementById('grupo-select');
  const nombreGrupo = select.options[select.selectedIndex].textContent;

  const ok = confirm(
    `¿ELIMINAR el grupo "${nombreGrupo}"?\n\n` +
    `Se borrarán TODOS sus alumnos y sus calificaciones (tareas, participación, asistencia, uniformes y exámenes). Esto NO se puede deshacer.`
  );
  if (!ok) return;

  const pass = prompt('Para confirmar, escribe tu contraseña del panel docente:');
  if (!pass) return;
  try {
    const cred = EmailAuthProvider.credential(auth.currentUser.email, pass);
    await reauthenticateWithCredential(auth.currentUser, cred);
  } catch {
    alert('Contraseña incorrecta. No se eliminó nada.');
    return;
  }

  const alumnosSnap = await getDocs(collection(db, 'grupos', grupoActivo, 'alumnos'));
  for (const alumnoDoc of alumnosSnap.docs) {
    const base = ['grupos', grupoActivo, 'alumnos', alumnoDoc.id];
    for (const sub of ['tareas', 'participaciones', 'asistencias', 'uniformes', 'examenes', 'intentos']) {
      const subSnap = await getDocs(collection(db, ...base, sub)).catch(() => null);
      if (subSnap) await Promise.all(subSnap.docs.map(d => deleteDoc(doc(db, ...base, sub, d.id))));
    }
    await deleteDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoDoc.id));
  }
  for (const sub of ['avisos', 'config', 'tareas_catalogo', 'participaciones_catalogo']) {
    const subSnap = await getDocs(collection(db, 'grupos', grupoActivo, sub)).catch(() => null);
    if (subSnap) await Promise.all(subSnap.docs.map(d => deleteDoc(doc(db, 'grupos', grupoActivo, sub, d.id))));
  }
  await deleteDoc(doc(db, 'grupos', grupoActivo));

  alert(`Grupo "${nombreGrupo}" eliminado.`);
  grupoActivo = null;
  alumnosCache = [];
  localStorage.removeItem('eoe_grupo_activo');
  await cargarGrupos();
  renderAlumnos([]);
}

function nombreDelGrupo() {
  const select = document.getElementById('grupo-select');
  return select.options[select.selectedIndex]?.textContent || 'Sin grupo';
}

// ---------- ALUMNOS ----------
function slugNombre(nombre) {
  return nombre.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
}

function generarPIN() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

on('form-alumno', 'submit', agregarAlumno);

async function cargarAlumnos() {
  if (!grupoActivo) return;
  const snap = await getDocs(query(collection(db, 'grupos', grupoActivo, 'alumnos'), orderBy('nombre')));
  alumnosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderAlumnos(alumnosCache);
}

function renderAlumnos(lista) {
  const ul = document.getElementById('lista-alumnos');
  const empty = document.getElementById('alumnos-empty');
  ul.innerHTML = '';
  empty.hidden = lista.length > 0;
  lista.forEach(a => {
    const li = document.createElement('li');
    li.className = 'student-row';
    li.innerHTML = `
      <span class="student-name">${escaparHTML(a.nombre)}</span>
      <span class="student-pin" title="PIN de acceso del alumno">PIN: ${escaparHTML(a.pin || '—')}</span>
      <button type="button" class="btn-delete-student" data-id="${a.id}" title="Eliminar alumno">Eliminar</button>
    `;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.btn-delete-student').forEach(btn => {
    btn.addEventListener('click', () => eliminarAlumno(btn.dataset.id));
  });
}

async function agregarAlumno(e) {
  e.preventDefault();
  if (!grupoActivo) { alert('Primero elige o crea un grupo.'); return; }
  const input = document.getElementById('input-alumno-nombre');
  const nombre = input.value.trim();
  if (!nombre) return;

  let id = slugNombre(nombre);
  if (!id) { alert('Ese nombre no es válido.'); return; }

  let idFinal = id, sufijo = 2;
  while ((await getDoc(doc(db, 'grupos', grupoActivo, 'alumnos', idFinal))).exists()) {
    idFinal = `${id}-${sufijo}`; sufijo++;
  }

  const pin = generarPIN();
  await setDoc(doc(db, 'grupos', grupoActivo, 'alumnos', idFinal), {
    nombre, pin, creado: serverTimestamp(),
  });

  input.value = '';
  await cargarAlumnos();
  alert(`Alumno agregado.\n\nDale este PIN de acceso (lo necesita para entrar a Mi Progreso y a Examen en línea):\n\n${nombre} → PIN ${pin}`);
}

async function eliminarAlumno(alumnoId) {
  const alumno = alumnosCache.find(a => a.id === alumnoId);
  if (!alumno) return;
  const ok = confirm(`¿Eliminar a "${alumno.nombre}"? No se puede deshacer.`);
  if (!ok) return;
  await deleteDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId));
  await cargarAlumnos();
}

// ---------- TAREAS Y PARTICIPACIÓN (mismo mecanismo, dos colecciones) ----------
// tipo: 'tareas' o 'participaciones'
const CONFIG_TIPO = {
  tareas: {
    catalogo: 'tareas_catalogo', sub: 'tareas',
    parcialSelect: 'tareas-parcial', nombreInput: 'tarea-nombre', fechaInput: 'tarea-fecha',
    btnAgregar: 'btn-agregar-tarea', msgNueva: 'tarea-nueva-msg',
    listaCatalogo: 'tareas-catalogo-lista', emptyCatalogo: 'tareas-catalogo-empty',
    calificarWrap: 'tarea-calificar', calificarTitulo: 'tarea-calificar-titulo',
    calificarLista: 'tarea-calificar-lista', btnGuardarCalif: 'btn-guardar-tarea-calif',
    msgCalif: 'tarea-calif-msg',
  },
  participaciones: {
    catalogo: 'participaciones_catalogo', sub: 'participaciones',
    parcialSelect: 'part-parcial', nombreInput: 'part-nombre', fechaInput: 'part-fecha',
    btnAgregar: 'btn-agregar-part', msgNueva: 'part-nueva-msg',
    listaCatalogo: 'part-catalogo-lista', emptyCatalogo: 'part-catalogo-empty',
    calificarWrap: 'part-calificar', calificarTitulo: 'part-calificar-titulo',
    calificarLista: 'part-calificar-lista', btnGuardarCalif: 'btn-guardar-part-calif',
    msgCalif: 'part-calif-msg',
  },
};

let itemCalificandoId = { tareas: null, participaciones: null };

on('tareas-parcial', 'change', () => cargarCatalogo('tareas'));
on('part-parcial', 'change', () => cargarCatalogo('participaciones'));
on('btn-agregar-tarea', 'click', () => agregarItemCatalogo('tareas'));
on('btn-agregar-part', 'click', () => agregarItemCatalogo('participaciones'));
on('btn-guardar-tarea-calif', 'click', () => guardarCalificaciones('tareas'));
on('btn-guardar-part-calif', 'click', () => guardarCalificaciones('participaciones'));

async function agregarItemCatalogo(tipo) {
  const cfg = CONFIG_TIPO[tipo];
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  const nombre = document.getElementById(cfg.nombreInput).value.trim();
  const fecha = document.getElementById(cfg.fechaInput).value;
  const parcial = document.getElementById(cfg.parcialSelect).value;
  if (!nombre) { alert('Escribe un nombre.'); return; }

  try {
    await addDoc(collection(db, 'grupos', grupoActivo, cfg.catalogo), {
      nombre, fecha, parcial, creado: serverTimestamp(),
    });
  } catch (err) {
    marcarResultado(cfg.btnAgregar, cfg.msgNueva, false, '', 'No se pudo agregar: ' + (err.message || err));
    return;
  }
  document.getElementById(cfg.nombreInput).value = '';
  marcarResultado(cfg.btnAgregar, cfg.msgNueva, true, '✓ Agregada.', '');
  cargarCatalogo(tipo);
}

async function cargarCatalogo(tipo) {
  const cfg = CONFIG_TIPO[tipo];
  const cont = document.getElementById(cfg.listaCatalogo);
  const empty = document.getElementById(cfg.emptyCatalogo);
  const calificarWrap = document.getElementById(cfg.calificarWrap);
  if (!cont) return;
  cont.innerHTML = '';
  calificarWrap.hidden = true;
  itemCalificandoId[tipo] = null;

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }

  const parcial = document.getElementById(cfg.parcialSelect).value;
  let items = [];
  try {
    const snap = await getDocs(collection(db, 'grupos', grupoActivo, cfg.catalogo));
    items = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(x => x.parcial === parcial)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  } catch { items = []; }

  empty.hidden = items.length > 0;
  if (items.length === 0) { empty.textContent = 'Sin registros en este parcial todavía.'; return; }

  items.forEach(item => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'asis-row';
    row.innerHTML = `
      <span class="student-name">${escaparHTML(item.nombre)}${item.fecha ? ` <small class="res-extra">(${escaparHTML(item.fecha)})</small>` : ''}</span>
      <span class="asis-estado-label">Calificar →</span>
    `;
    row.addEventListener('click', () => calificarItem(tipo, item));
    cont.appendChild(row);
  });
}

async function calificarItem(tipo, item) {
  const cfg = CONFIG_TIPO[tipo];
  itemCalificandoId[tipo] = item.id;
  document.getElementById(cfg.calificarWrap).hidden = false;
  document.getElementById(cfg.calificarTitulo).textContent = `Calificar: ${item.nombre}`;

  const cont = document.getElementById(cfg.calificarLista);
  cont.innerHTML = '<p class="empty-inline">Cargando…</p>';

  const valores = {};
  await Promise.all(alumnosCache.map(async (a) => {
    try {
      const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'alumnos', a.id, cfg.sub, item.id));
      valores[a.id] = snap.exists() ? snap.data().calificacion : '';
    } catch { valores[a.id] = ''; }
  }));

  cont.innerHTML = `
    <div class="quiz-actions" style="margin-bottom:12px; display:flex; gap:8px;">
      <button type="button" class="btn btn-ghost-dark btn-small" data-accion="marcar-diez">Marcar todos con 10</button>
      <button type="button" class="btn btn-ghost-dark btn-small" data-accion="limpiar-todos">Limpiar todos (nadie participó)</button>
    </div>
  `;
  const filasCont = document.createElement('div');
  filasCont.id = `${cfg.calificarLista}-filas`;
  cont.appendChild(filasCont);

  alumnosCache.forEach(a => {
    const row = document.createElement('div');
    row.className = 'ens-row';
    row.dataset.alumnoId = a.id;
    row.innerHTML = `
      <span class="student-name">${escaparHTML(a.nombre)}</span>
      <input type="number" min="0" max="10" step="0.1" class="calif-input" value="${valores[a.id] ?? ''}" placeholder="0-10">
    `;
    filasCont.appendChild(row);
  });

  cont.querySelector('[data-accion="marcar-diez"]').addEventListener('click', () => {
    filasCont.querySelectorAll('.calif-input').forEach(inp => { inp.value = '10'; });
  });
  cont.querySelector('[data-accion="limpiar-todos"]').addEventListener('click', () => {
    if (!confirm('¿Vaciar la captura de todos los alumnos para esta actividad? (nadie quedará con calificación aquí)')) return;
    filasCont.querySelectorAll('.calif-input').forEach(inp => { inp.value = ''; });
  });

  document.getElementById(cfg.calificarWrap).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function guardarCalificaciones(tipo) {
  const cfg = CONFIG_TIPO[tipo];
  const itemId = itemCalificandoId[tipo];
  if (!grupoActivo || !itemId) { alert('Elige una tarea o actividad primero.'); return; }

  let item;
  try {
    const snap = await getDoc(doc(db, 'grupos', grupoActivo, cfg.catalogo, itemId));
    item = snap.data();
  } catch { alert('No se pudo leer la tarea.'); return; }

  const filas = document.querySelectorAll(`#${cfg.calificarLista} .ens-row`);
  const escrituras = [];
  filas.forEach(row => {
    const alumnoId = row.dataset.alumnoId;
    const input = row.querySelector('.calif-input');
    const ref = doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, cfg.sub, itemId);
    if (input.value === '') {
      // Sin captura = no participó en ESTA actividad: no se guarda ningún
      // registro, para que no cuente como 0 en su promedio. Si antes tenía
      // una calificación aquí y el docente la borró a propósito, se elimina.
      escrituras.push(deleteDoc(ref).catch(() => {}));
    } else {
      const calificacion = parseFloat(input.value);
      escrituras.push(setDoc(ref, {
        parcial: item.parcial, nombre: item.nombre, fecha: item.fecha,
        calificacion, actualizado: serverTimestamp(),
      }));
    }
  });

  try {
    await Promise.all(escrituras);
  } catch (err) {
    marcarResultado(cfg.btnGuardarCalif, cfg.msgCalif, false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }
  marcarResultado(cfg.btnGuardarCalif, cfg.msgCalif, true, '✓ Calificaciones guardadas.', '');
}

// ---------- ASISTENCIA ----------
let asistenciaEstados = {};

on('asis-fecha', 'change', cargarAsistencia);
on('asis-parcial', 'change', cargarAsistencia);
on('btn-guardar-asistencia', 'click', guardarAsistencia);

const _hoy = new Date();
['asis-fecha'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.valueAsDate = _hoy;
});

async function cargarAsistencia() {
  const cont = document.getElementById('asistencia-lista');
  const empty = document.getElementById('asistencia-empty');
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  const fecha = document.getElementById('asis-fecha').value;
  asistenciaEstados = {};

  await Promise.all(alumnosCache.map(async (a) => {
    try {
      const ref = doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'asistencias', fecha);
      const snap = await getDoc(ref);
      asistenciaEstados[a.id] = snap.exists() ? snap.data().estado : 'presente';
    } catch { asistenciaEstados[a.id] = 'presente'; }
  }));

  renderAsistenciaLista();
}

function renderAsistenciaLista() {
  const cont = document.getElementById('asistencia-lista');
  cont.innerHTML = '';
  alumnosCache.forEach(a => {
    const estado = asistenciaEstados[a.id] || 'presente';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `asis-row asis-${estado}`;
    row.innerHTML = `
      <span class="asis-dot"></span>
      <span class="student-name">${escaparHTML(a.nombre)}</span>
      <span class="asis-estado-label">${ETIQUETA_ESTADO[estado]}</span>
    `;
    row.addEventListener('click', () => {
      asistenciaEstados[a.id] = CICLO_ESTADO[estado];
      renderAsistenciaLista();
    });
    cont.appendChild(row);
  });
}

async function guardarAsistencia() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  const fecha = document.getElementById('asis-fecha').value;
  const parcial = document.getElementById('asis-parcial').value;
  if (!fecha) { alert('Elige una fecha.'); return; }

  try {
    await Promise.all(alumnosCache.map(a => {
      const ref = doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'asistencias', fecha);
      return setDoc(ref, { estado: asistenciaEstados[a.id] || 'presente', fecha, parcial, actualizado: serverTimestamp() });
    }));
  } catch (err) {
    marcarResultado('btn-guardar-asistencia', 'asis-msg', false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }
  marcarResultado('btn-guardar-asistencia', 'asis-msg', true, '✓ Asistencia guardada.', '');
}

// ---------- UNIFORMES ----------
on('unif-parcial', 'change', cargarUniformes);
on('btn-guardar-uniformes', 'click', guardarUniformes);

async function cargarUniformes() {
  const cont = document.getElementById('uniformes-lista');
  const empty = document.getElementById('uniformes-empty');
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  const parcial = document.getElementById('unif-parcial').value;
  const valores = {};
  await Promise.all(alumnosCache.map(async (a) => {
    try {
      const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'uniformes', parcial));
      valores[a.id] = snap.exists() ? (snap.data().faltas ?? 0) : 0;
    } catch { valores[a.id] = 0; }
  }));

  alumnosCache.forEach(a => {
    const row = document.createElement('div');
    row.className = 'ens-row';
    row.dataset.alumnoId = a.id;
    row.innerHTML = `
      <span class="student-name">${escaparHTML(a.nombre)}</span>
      <input type="number" min="0" step="1" class="calif-input" value="${valores[a.id]}" placeholder="Faltas">
    `;
    cont.appendChild(row);
  });
}

async function guardarUniformes() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  const parcial = document.getElementById('unif-parcial').value;
  const filas = document.querySelectorAll('#uniformes-lista .ens-row');
  const escrituras = [];
  filas.forEach(row => {
    const alumnoId = row.dataset.alumnoId;
    const input = row.querySelector('.calif-input');
    const faltas = input.value === '' ? 0 : parseInt(input.value, 10);
    escrituras.push(setDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'uniformes', parcial), {
      faltas, actualizado: serverTimestamp(),
    }));
  });
  try {
    await Promise.all(escrituras);
  } catch (err) {
    marcarResultado('btn-guardar-uniformes', 'unif-msg', false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }
  marcarResultado('btn-guardar-uniformes', 'unif-msg', true, '✓ Uniformes guardados.', '');
}

// ---------- PROYECTO: MI VOZ, MI HISTORIA ----------
// Tres entregas de tope fijo (15 + 15 + 10 = 40 pts), todas dentro del
// Examen Final. Se guardan en grupos/{g}/alumnos/{a}/proyecto/{entrega}.
const ENTREGAS_PROYECTO = ['entrega1', 'entrega2', 'entregaFinal'];

ENTREGAS_PROYECTO.forEach(entrega => {
  on(`btn-guardar-${entrega}`, 'click', () => guardarEntregaProyecto(entrega));
});

async function cargarProyecto() {
  const empty = document.getElementById('proyecto-empty');
  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  for (const entrega of ENTREGAS_PROYECTO) {
    await cargarEntregaProyecto(entrega);
  }
}

async function cargarEntregaProyecto(entrega) {
  const cont = document.getElementById(`proyecto-${entrega}-lista`);
  if (!cont) return;
  cont.innerHTML = '<p class="empty-inline">Cargando…</p>';

  const valores = {};
  await Promise.all(alumnosCache.map(async (a) => {
    try {
      const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'proyecto', entrega));
      valores[a.id] = snap.exists() ? snap.data().calificacion : '';
    } catch { valores[a.id] = ''; }
  }));

  cont.innerHTML = '';
  alumnosCache.forEach(a => {
    const row = document.createElement('div');
    row.className = 'ens-row';
    row.dataset.alumnoId = a.id;
    row.innerHTML = `
      <span class="student-name">${escaparHTML(a.nombre)}</span>
      <input type="number" min="0" max="10" step="0.1" class="calif-input" value="${valores[a.id] ?? ''}" placeholder="0-10">
    `;
    cont.appendChild(row);
  });
}

async function guardarEntregaProyecto(entrega) {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  const filas = document.querySelectorAll(`#proyecto-${entrega}-lista .ens-row`);
  const escrituras = [];
  filas.forEach(row => {
    const alumnoId = row.dataset.alumnoId;
    const input = row.querySelector('.calif-input');
    const calificacion = input.value === '' ? null : parseFloat(input.value);
    escrituras.push(setDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'proyecto', entrega), {
      calificacion, actualizado: serverTimestamp(),
    }));
  });
  try {
    await Promise.all(escrituras);
  } catch (err) {
    marcarResultado(`btn-guardar-${entrega}`, `${entrega}-msg`, false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }
  marcarResultado(`btn-guardar-${entrega}`, `${entrega}-msg`, true, '✓ Guardado.', '');
}

// ---------- EXAMEN EN LÍNEA ----------
let examenesAbiertos = [];

on('btn-guardar-examenes-abiertos', 'click', guardarExamenesAbiertos);
on('enlinea-parcial', 'change', cargarIntentos);

async function cargarExamenesAbiertos() {
  const cont = document.getElementById('examenes-abiertos-lista');
  if (!cont) return;
  if (!grupoActivo) { cont.innerHTML = '<p class="empty-inline">Elige un grupo primero.</p>'; return; }
  try {
    const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'config', 'examenes'));
    examenesAbiertos = snap.exists() && Array.isArray(snap.data().abiertos) ? snap.data().abiertos : [];
  } catch { examenesAbiertos = []; }
  renderExamenesAbiertos();
}

function renderExamenesAbiertos() {
  const cont = document.getElementById('examenes-abiertos-lista');
  cont.innerHTML = '';
  PARCIALES.forEach(p => {
    const abierto = examenesAbiertos.includes(p);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'asis-row ' + (abierto ? 'asis-presente' : 'asis-falta');
    row.innerHTML = `
      <span class="asis-dot"></span>
      <span class="student-name">${NOMBRES_PARCIAL[p]}</span>
      <span class="asis-estado-label">${abierto ? 'Abierto' : 'Cerrado'}</span>`;
    row.addEventListener('click', () => {
      examenesAbiertos = abierto ? examenesAbiertos.filter(x => x !== p) : [...examenesAbiertos, p];
      renderExamenesAbiertos();
    });
    cont.appendChild(row);
  });
}

async function guardarExamenesAbiertos() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  try {
    await setDoc(doc(db, 'grupos', grupoActivo, 'config', 'examenes'), {
      abiertos: examenesAbiertos, actualizado: serverTimestamp(),
    });
  } catch (err) {
    marcarResultado('btn-guardar-examenes-abiertos', 'abiertos-msg', false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }
  marcarResultado('btn-guardar-examenes-abiertos', 'abiertos-msg', true, '✓ Guardado.', '');
}

async function cargarIntentos() {
  const cont = document.getElementById('intentos-lista');
  const empty = document.getElementById('intentos-empty');
  if (!cont) return;
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  const parcial = document.getElementById('enlinea-parcial').value;

  let btnTodos = document.getElementById('btn-descargar-examenes-grupo');
  if (!btnTodos) {
    btnTodos = document.createElement('button');
    btnTodos.id = 'btn-descargar-examenes-grupo';
    btnTodos.type = 'button';
    btnTodos.className = 'btn btn-ghost-dark btn-small';
    btnTodos.style.marginBottom = '14px';
    cont.parentNode.insertBefore(btnTodos, cont);
  }
  btnTodos.textContent = `Descargar todos los exámenes de ${NOMBRES_PARCIAL[parcial]} (PDF)`;
  btnTodos.onclick = () => descargarExamenesGrupo(parcial);

  cont.innerHTML = '<p class="empty-inline">Cargando…</p>';

  const filas = [];
  for (const a of alumnosCache) {
    let est = null;
    try {
      const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'intentos', parcial));
      est = snap.exists() ? snap.data() : null;
    } catch { /* sin intento */ }
    filas.push({ alumno: a, est });
  }

  cont.innerHTML = '';
  filas.forEach(({ alumno, est }) => {
    const div = document.createElement('div');
    div.className = 'intento-card';

    if (!est) {
      div.innerHTML = `
        <div class="intento-top">
          <span class="student-name">${escaparHTML(alumno.nombre)}</span>
          <span class="intento-estado est-sin">Sin iniciar</span>
        </div>`;
    } else if (est.estado === 'entregado') {
      div.innerHTML = `
        <div class="intento-top">
          <span class="student-name">${escaparHTML(alumno.nombre)}</span>
          <span class="intento-estado est-ok">${Number(est.calificacion).toFixed(1)} / 10</span>
        </div>
        <p class="intento-detalle">${est.aciertos}/${est.total} correctas${est.automatico ? ' · se acabó el tiempo' : ''}${est.salidas ? ` · ${est.salidas} salida(s) previas` : ''}</p>
        <div class="intento-acciones">
          <button class="btn btn-ghost-dark btn-small" data-descargar-examen="${alumno.id}">Descargar examen (PDF)</button>
        </div>`;
    } else if (est.estado === 'bloqueado') {
      div.innerHTML = `
        <div class="intento-top">
          <span class="student-name">${escaparHTML(alumno.nombre)}</span>
          <span class="intento-estado est-bloq">Bloqueado</span>
        </div>
        <p class="intento-detalle">Salió de la pantalla ${est.salidas || 1} vez(ces). Contestadas: ${Object.keys(est.respuestas || {}).length} de ${(est.ids || []).length}</p>
        <div class="intento-acciones">
          <button class="btn btn-primary btn-small" data-reabrir="${alumno.id}">Reabrir examen</button>
          <button class="btn btn-ghost-dark btn-small" data-extra="${alumno.id}">+ tiempo</button>
        </div>`;
    } else {
      const totalMin = (est.minutos || 60) + (est.minutosExtra || 0);
      const restante = Math.max(0, Math.round(totalMin - (Date.now() - est.iniciado) / 60000));
      div.innerHTML = `
        <div class="intento-top">
          <span class="student-name">${escaparHTML(alumno.nombre)}</span>
          <span class="intento-estado est-curso">En curso</span>
        </div>
        <p class="intento-detalle">Le quedan ~${restante} min · contestadas ${Object.keys(est.respuestas || {}).length} de ${(est.ids || []).length}</p>
        <div class="intento-acciones">
          <button class="btn btn-ghost-dark btn-small" data-extra="${alumno.id}">+ tiempo</button>
        </div>`;
    }
    cont.appendChild(div);
  });

  cont.querySelectorAll('[data-reabrir]').forEach(b => {
    b.addEventListener('click', () => reabrirExamen(b.dataset.reabrir, parcial));
  });
  cont.querySelectorAll('[data-extra]').forEach(b => {
    b.addEventListener('click', () => darTiempoExtra(b.dataset.extra, parcial));
  });
  cont.querySelectorAll('[data-descargar-examen]').forEach(b => {
    b.addEventListener('click', () => descargarExamenAlumno(b.dataset.descargarExamen, parcial));
  });
}

// Caché del banco de reactivos por parcial — evita volver a descargar el
// mismo JSON varias veces en una sesión de revisión.
let bancosExamenCache = {};

async function cargarBancoExamen(parcial) {
  if (bancosExamenCache[parcial]) return bancosExamenCache[parcial];
  const res = await fetch(`data/examen_${parcial}.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No se encontró el banco de reactivos de ${NOMBRES_PARCIAL[parcial]} (HTTP ${res.status})`);
  const banco = await res.json();
  bancosExamenCache[parcial] = banco;
  return banco;
}

async function descargarExamenAlumno(alumnoId, parcial) {
  const alumno = alumnosCache.find(a => a.id === alumnoId);
  if (!alumno) return;
  try {
    const [snap, banco] = await Promise.all([
      getDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'intentos', parcial)),
      cargarBancoExamen(parcial),
    ]);
    if (!snap.exists()) { alert('Este alumno no tiene un examen registrado en este parcial.'); return; }
    const intento = snap.data();
    await reporteExamenAlumno({ nombreGrupo: nombreDelGrupo(), alumno, parcial, intento, banco });
  } catch (err) {
    console.error('Error generando el PDF del examen:', err);
    alert('No se pudo generar el examen: ' + (err.message || err));
  }
}

async function descargarExamenesGrupo(parcial) {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  if (alumnosCache.length === 0) { alert('Este grupo no tiene alumnos.'); return; }

  const btnTodos = document.getElementById('btn-descargar-examenes-grupo');
  const textoOriginal = btnTodos ? btnTodos.textContent : '';
  if (btnTodos) { btnTodos.disabled = true; btnTodos.textContent = 'Generando…'; }

  try {
    const banco = await cargarBancoExamen(parcial);
    const entregas = [];
    for (const alumno of alumnosCache) {
      let intento = null;
      try {
        const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumno.id, 'intentos', parcial));
        intento = snap.exists() ? snap.data() : null;
      } catch { /* sin intento */ }
      entregas.push({ alumno, intento });
    }
    await reporteExamenGrupo({ nombreGrupo: nombreDelGrupo(), parcial, entregas, banco });
  } catch (err) {
    console.error('Error generando el PDF de exámenes del grupo:', err);
    alert('No se pudo generar el PDF: ' + (err.message || err));
  } finally {
    if (btnTodos) { btnTodos.disabled = false; btnTodos.textContent = textoOriginal; }
  }
}


async function reabrirExamen(alumnoId, parcial) {
  const alumno = alumnosCache.find(a => a.id === alumnoId);
  if (!confirm(`¿Reabrir el examen de ${alumno?.nombre || 'este alumno'}?\n\nConservará las respuestas que ya había dado y el tiempo que le quedaba.`)) return;

  const ref = doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'intentos', parcial);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const est = snap.data();
  const seg = est.segundosAlPausar ?? ((est.minutos || 60) * 60);

  await setDoc(ref, {
    ...est, estado: 'en_curso', segundosAlPausar: seg, minutosExtra: 0,
    reanudadoEn: Date.now(), reabiertoEn: new Date().toISOString(), actualizado: serverTimestamp(),
  });

  const m = Math.floor(seg / 60), s = seg % 60;
  alert(`Examen reabierto. Continuará con ${m}:${String(s).padStart(2, '0')} — el tiempo exacto que le quedaba.`);
  cargarIntentos();
}

async function darTiempoExtra(alumnoId, parcial) {
  const alumno = alumnosCache.find(a => a.id === alumnoId);
  const ref = doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'intentos', parcial);
  const snap = await getDoc(ref);
  if (!snap.exists()) { alert('Ese alumno todavía no ha iniciado el examen.'); return; }
  const est = snap.data();

  const base = est.segundosAlPausar ?? ((est.minutos || 60) * 60);
  const desde = est.reanudadoEn || est.iniciado;
  const restante = est.estado === 'bloqueado'
    ? base
    : Math.max(0, base + (est.minutosExtra || 0) * 60 - Math.floor((Date.now() - desde) / 1000));
  const rm = Math.floor(restante / 60), rs = restante % 60;

  const min = prompt(
    `${alumno?.nombre || 'Este alumno'} tiene ${rm}:${String(rs).padStart(2, '0')} restantes.\n\n¿Cuántos minutos EXTRA le agrego?`, '10');
  const n = parseInt(min, 10);
  if (isNaN(n) || n <= 0) return;

  await setDoc(ref, { ...est, minutosExtra: (est.minutosExtra || 0) + n, actualizado: serverTimestamp() });
  alert(`Se agregaron ${n} minutos.`);
  cargarIntentos();
}

// ---------- HISTORIAL ----------
async function datosDeAlumno(alumnoId) {
  const base = ['grupos', grupoActivo, 'alumnos', alumnoId];
  const [tarSnap, partSnap, asisSnap, unifP1, unifP2, exaP1, exaP2, exaFinal, proyE1, proyE2, proyEF] = await Promise.all([
    getDocs(collection(db, ...base, 'tareas')).catch(() => null),
    getDocs(collection(db, ...base, 'participaciones')).catch(() => null),
    getDocs(collection(db, ...base, 'asistencias')).catch(() => null),
    getDoc(doc(db, ...base, 'uniformes', 'p1')).catch(() => null),
    getDoc(doc(db, ...base, 'uniformes', 'p2')).catch(() => null),
    getDoc(doc(db, ...base, 'examenes', 'p1')).catch(() => null),
    getDoc(doc(db, ...base, 'examenes', 'p2')).catch(() => null),
    getDoc(doc(db, ...base, 'examenes', 'final')).catch(() => null),
    getDoc(doc(db, ...base, 'proyecto', 'entrega1')).catch(() => null),
    getDoc(doc(db, ...base, 'proyecto', 'entrega2')).catch(() => null),
    getDoc(doc(db, ...base, 'proyecto', 'entregaFinal')).catch(() => null),
  ]);

  return {
    tareas: tarSnap ? tarSnap.docs.map(d => d.data()) : [],
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
    proyecto: {
      entrega1: proyE1 && proyE1.exists() ? proyE1.data() : null,
      entrega2: proyE2 && proyE2.exists() ? proyE2.data() : null,
      entregaFinal: proyEF && proyEF.exists() ? proyEF.data() : null,
    },
  };
}

// ---------- SELECTOR DE PARCIALES PARA EL REPORTE ----------
let parcialesReporte = ['p1', 'p2', 'final'];

function renderParcialesReporte() {
  const cont = document.getElementById('hist-parciales');
  if (!cont) return;
  cont.innerHTML = '';
  PARCIALES.forEach(p => {
    const incluido = parcialesReporte.includes(p);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'asis-row ' + (incluido ? 'asis-presente' : 'asis-falta');
    row.innerHTML = `
      <span class="asis-dot"></span>
      <span class="student-name">${NOMBRES_PARCIAL[p]}</span>
      <span class="asis-estado-label">${incluido ? 'Incluido' : 'Omitido'}</span>
    `;
    row.addEventListener('click', () => {
      if (incluido) {
        if (parcialesReporte.length === 1) { alert('Deja al menos un parcial incluido.'); return; }
        parcialesReporte = parcialesReporte.filter(x => x !== p);
      } else {
        parcialesReporte = [...parcialesReporte, p];
      }
      renderParcialesReporte();
    });
    cont.appendChild(row);
  });
}

on('hist-modo', 'change', () => {
  const esAlumno = document.getElementById('hist-modo').value === 'alumno';
  document.getElementById('hist-alumno-wrap').hidden = !esAlumno;
});

function renderSelectHistAlumno() {
  const selectHist = document.getElementById('hist-alumno-select');
  if (!selectHist) return;
  const actual = selectHist.value;
  selectHist.innerHTML = '<option value="">— Elige un alumno —</option>';
  alumnosCache.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.nombre;
    selectHist.appendChild(opt);
  });
  if (actual && alumnosCache.some(a => a.id === actual)) selectHist.value = actual;
}

on('btn-pdf', 'click', generarPDF);

async function generarPDF() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  if (alumnosCache.length === 0) { alert('Este grupo no tiene alumnos.'); return; }

  const modo = document.getElementById('hist-modo').value;
  const msg = document.getElementById('export-msg');
  msg.textContent = 'Generando reporte…';
  msg.hidden = false;

  try {
    if (modo === 'alumno') {
      const alumnoId = document.getElementById('hist-alumno-select').value;
      if (!alumnoId) { alert('Elige un alumno de la lista.'); msg.hidden = true; return; }
      const alumno = alumnosCache.find(a => a.id === alumnoId);
      if (!alumno) { msg.hidden = true; return; }
      const datos = await datosDeAlumno(alumno.id);
      await reporteAlumno({ nombreGrupo: nombreDelGrupo(), alumno, datos });
    } else {
      const alumnos = [];
      for (const alumno of alumnosCache) {
        alumnos.push({ alumno, datos: await datosDeAlumno(alumno.id) });
      }
      await reporteGrupo({ nombreGrupo: nombreDelGrupo(), alumnos, parciales: parcialesReporte });
    }
    msg.textContent = '✓ Reporte abierto en una ventana nueva.';
    setTimeout(() => { msg.hidden = true; }, 4000);
  } catch (err) {
    console.error('Error generando el reporte:', err);
    msg.textContent = 'No se pudo generar el reporte: ' + (err.message || err);
  }
}

function cargarHistorial() {
  const cont = document.getElementById('hist-lista-alumnos');
  const empty = document.getElementById('historial-empty');
  const resumen = document.getElementById('hist-resumen');
  if (!cont) return;
  cont.innerHTML = '';
  resumen.hidden = true;
  renderParcialesReporte();
  renderSelectHistAlumno();

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  alumnosCache.forEach(a => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'asis-row';
    row.innerHTML = `<span class="student-name">${escaparHTML(a.nombre)}</span><span class="asis-estado-label">Ver resumen →</span>`;
    row.addEventListener('click', () => mostrarResumenAlumno(a));
    cont.appendChild(row);
  });
}

async function mostrarResumenAlumno(alumno) {
  const resumen = document.getElementById('hist-resumen');
  resumen.hidden = false;
  resumen.innerHTML = `<p class="eval-alumno-activo">Resumen de: ${escaparHTML(alumno.nombre)}</p><p class="empty-inline">Cargando…</p>`;
  resumen.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const datos = await datosDeAlumno(alumno.id);
  const resultados = {};
  PARCIALES.forEach(p => { resultados[p] = calcularParcial(p, datos); });
  const totalCuatrimestre = calcularCuatrimestre(resultados);

  const filaRubro = (nombre, pts, tope) => `
    <div class="res-row"><span>${nombre}</span><strong>${pts.toFixed(1)} / ${tope}</strong></div>`;

  // Detalle de fechas (para revisiones): qué tareas entregó y en qué días
  // participó, ordenado cronológicamente. Se muestra en un desplegable para
  // no saturar la vista por defecto.
  const listaDetalleHTML = (lista, vacio, conCalificacion) => {
    if (!lista || lista.length === 0) return `<p class="empty-inline">${vacio}</p>`;
    const filas = lista
      .slice()
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
      .map(x => `<li>${escaparHTML(x.fecha || 'sin fecha')} — ${escaparHTML(x.nombre || '')}${conCalificacion ? `: <strong>${(Number(x.calificacion) || 0).toFixed(1)}/10</strong>` : ''}</li>`)
      .join('');
    return `<ul style="margin:6px 0 0; padding-left:18px; font-size:.85em;">${filas}</ul>`;
  };

  resumen.innerHTML = `
    <p class="eval-alumno-activo">Resumen de: ${escaparHTML(alumno.nombre)}</p>
    ${PARCIALES.map(p => {
      const r = resultados[p];
      const esFinal = p === 'final';
      return `
        <div class="res-card">
          <h4>${NOMBRES_PARCIAL[p]}</h4>
          ${esFinal
            ? filaRubro('Examen', r.examen.pts, r.examen.tope) +
              filaRubro('Proyecto — Entrega 1', r.proyecto.detalle.entrega1.pts, r.proyecto.detalle.entrega1.tope) +
              filaRubro('Proyecto — Entrega 2', r.proyecto.detalle.entrega2.pts, r.proyecto.detalle.entrega2.tope) +
              filaRubro('Proyecto — Entrega final', r.proyecto.detalle.entregaFinal.pts, r.proyecto.detalle.entregaFinal.tope) +
              filaRubro('Tareas y Participación', r.tareasParticipacion.pts, r.tareasParticipacion.tope) +
              filaRubro('Asistencia', r.asistencia.pts, r.asistencia.tope)
            : filaRubro('Examen', r.examen.pts, r.examen.tope) +
              filaRubro('Tareas', r.tareas.pts, r.tareas.tope) +
              filaRubro(`Participación (${r.participacion.cantidad} de ${r.participacion.meta})`, r.participacion.pts, r.participacion.tope) +
              filaRubro('Asistencia', r.asistencia.pts, r.asistencia.tope) +
              filaRubro('Uniformes', r.uniformes.pts, r.uniformes.tope)}
          ${!esFinal ? `
          <details class="prog-detalle-bloque" style="margin-top:8px;">
            <summary>Ver fechas — Tareas y Participación</summary>
            <p class="field-hint" style="margin:8px 0 2px;">Tareas:</p>
            ${listaDetalleHTML(r.tareas.lista, 'Sin tareas capturadas.', true)}
            <p class="field-hint" style="margin:10px 0 2px;">Participación:</p>
            ${listaDetalleHTML(r.participacion.lista, 'Sin participación capturada.', false)}
          </details>` : `
          <details class="prog-detalle-bloque" style="margin-top:8px;">
            <summary>Ver fechas — Tareas y Participación</summary>
            ${listaDetalleHTML([...r.tareasParticipacion.lista], 'Sin capturas.', true)}
          </details>`}
          <div class="res-row res-total"><span>Total</span><strong>${r.total.toFixed(1)} / 100 pts</strong></div>
        </div>`;
    }).join('')}
    <div class="score-display">Calificación final del cuatrimestre: ${(totalCuatrimestre / 10).toFixed(1)} / 10</div>
    <p class="field-hint">Parcial 1 (25%) + Parcial 2 (25%) + Examen Final (50%).</p>
  `;
}

on('btn-exportar', 'click', exportarCalificaciones);

async function exportarCalificaciones() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  if (alumnosCache.length === 0) { alert('Este grupo no tiene alumnos.'); return; }

  const msg = document.getElementById('export-msg');
  msg.textContent = 'Preparando archivo…';
  msg.hidden = false;

  const filas = [['Alumno', 'Parcial', 'Examen', 'Proyecto', 'Tareas', 'Participación', 'Asistencia', 'Uniformes', 'TOTAL (100)']];

  for (const alumno of alumnosCache) {
    const datos = await datosDeAlumno(alumno.id);
    PARCIALES.forEach(p => {
      const r = calcularParcial(p, datos);
      if (p === 'final') {
        filas.push([
          alumno.nombre, NOMBRES_PARCIAL[p],
          r.examen.pts.toFixed(1), r.proyecto.pts.toFixed(1), r.tareasParticipacion.pts.toFixed(1), '—',
          r.asistencia.pts.toFixed(1), '—', r.total.toFixed(1),
        ]);
      } else {
        filas.push([
          alumno.nombre, NOMBRES_PARCIAL[p],
          r.examen.pts.toFixed(1), '—', r.tareas.pts.toFixed(1), r.participacion.pts.toFixed(1),
          r.asistencia.pts.toFixed(1), r.uniformes.pts.toFixed(1), r.total.toFixed(1),
        ]);
      }
    });
  }

  const csv = (arr) => arr.map(f =>
    f.map(v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')
  ).join('\n');

  const contenido = '\uFEFF' +
    `CALIFICACIONES — ${nombreDelGrupo()}\n` +
    `Generado: ${new Date().toLocaleString('es-MX')}\n\n` +
    csv(filas);

  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `calificaciones-grupo-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  msg.textContent = '✓ Archivo descargado. Ábrelo con Excel.';
  setTimeout(() => { msg.hidden = true; }, 4000);
}

// ---------- AVISOS ----------
on('btn-publicar-aviso', 'click', publicarAviso);

async function cargarAvisos() {
  const cont = document.getElementById('avisos-lista');
  const empty = document.getElementById('avisos-empty');
  cont.innerHTML = '';
  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }

  const snap = await getDocs(query(collection(db, 'grupos', grupoActivo, 'avisos'), orderBy('creado', 'desc')));
  empty.hidden = !snap.empty;
  if (snap.empty) { empty.textContent = 'Aún no has publicado avisos en este grupo.'; return; }

  snap.forEach(d => {
    const a = d.data();
    const div = document.createElement('div');
    div.className = 'aviso-card';
    div.innerHTML = `
      <div class="aviso-card-top">
        <span class="aviso-card-titulo">${escaparHTML(a.titulo || 'Sin título')}</span>
        <button type="button" class="btn-delete-student" data-id="${d.id}">Eliminar</button>
      </div>
      <div class="aviso-card-texto">${escaparHTML(a.texto || '')}</div>
    `;
    div.querySelector('.btn-delete-student').addEventListener('click', async () => {
      if (!confirm('¿Eliminar este aviso?')) return;
      await deleteDoc(doc(db, 'grupos', grupoActivo, 'avisos', d.id));
      cargarAvisos();
    });
    cont.appendChild(div);
  });
}

async function publicarAviso() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  const titulo = document.getElementById('aviso-titulo').value.trim();
  const texto = document.getElementById('aviso-texto').value.trim();
  if (!titulo && !texto) { alert('Escribe al menos un título o contenido.'); return; }

  try {
    await addDoc(collection(db, 'grupos', grupoActivo, 'avisos'), { titulo, texto, creado: serverTimestamp() });
  } catch (err) {
    marcarResultado('btn-publicar-aviso', 'aviso-msg', false, '', 'No se pudo publicar: ' + (err.message || err));
    return;
  }
  document.getElementById('aviso-titulo').value = '';
  document.getElementById('aviso-texto').value = '';
  marcarResultado('btn-publicar-aviso', 'aviso-msg', true, '✓ Aviso publicado.', '');
  cargarAvisos();
}
