// firebase-config.js — Coordinación Académica
//
// Esta app NO tiene su propio proyecto de Firebase: se conecta a los
// proyectos que cada materia ya usa (Coordinación solo LEE, nunca escribe).
//
// "carrera" agrupa las materias por licenciatura en la interfaz — el
// selector superior muestra carreras, y al elegir una se listan solo las
// materias de esa carrera. Por ahora Artes Culinarias tiene 2 (Bases
// Culinarias y Origen de las Cocinas) y Ciencias de la Comunicación
// tendrá 1 (Expresión Oral y Escrita, pendiente de agregar).
//
// "esquema" indica qué fórmula de calificación usa esa materia:
//   'bloques'   → Bases Culinarias (3 Bloques de 100 pts) — calculo.js
//   'parciales' → Origen de las Cocinas / Expresión Oral y Escrita
//                 (Parcial 1, Parcial 2, Examen Final) — calculo-parciales.js
// app.js usa este campo para decidir qué lógica de cálculo y qué reportes
// aplicar a cada materia, en vez de asumir que todas son iguales.
//
// "sitioUrl" es la URL en vivo del Aula Virtual de esa materia — se usa
// para descargar el banco de reactivos del examen (data/examen_*.json),
// que vive en ESE repo, no en el de Coordinación.
//
// El usuario de Coordinación es un usuario DISTINTO al del docente, dado de
// alta en Firebase Authentication de MATERIA_LOGIN — así cada quien entra
// con su propio correo y contraseña, aunque lean la misma base.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const MATERIAS = [
  {
    id: 'bases-culinarias',
    nombre: 'Bases Culinarias',
    carrera: 'Artes Culinarias y Negocios Gastronómicos',
    asignatura: 'Bases Culinarias · Clave 0101 · Primer cuatrimestre',
    esquema: 'bloques',
    sitioUrl: 'https://jesusrodriguezgarcia749-cloud.github.io/bases-culinarias/',
    firebaseConfig: {
      apiKey: "AIzaSyCrn6_dvsj1qPvTYx05ztaW3R4p_7bGQQ0",
      authDomain: "bases-culinarias.firebaseapp.com",
      projectId: "bases-culinarias",
      storageBucket: "bases-culinarias.firebasestorage.app",
      messagingSenderId: "810616202608",
      appId: "1:810616202608:web:5a47712549207a9d0fdbb5"
    },
  },
  {
    id: 'origen-de-las-cocinas',
    nombre: 'Origen de las Cocinas',
    carrera: 'Artes Culinarias y Negocios Gastronómicos',
    asignatura: 'Origen de las Cocinas · Clave 0102 · Primer cuatrimestre',
    esquema: 'parciales',
    sitioUrl: 'https://jesusrodriguezgarcia749-cloud.github.io/origen-de-las-cocinas/',
    firebaseConfig: {
      apiKey: "AIzaSyBJwnXXGvgxDF8jpdWYCiP4GPS7n_cMK98",
      authDomain: "origen-de-las-cocinas.firebaseapp.com",
      projectId: "origen-de-las-cocinas",
      storageBucket: "origen-de-las-cocinas.firebasestorage.app",
      messagingSenderId: "951291486308",
      appId: "1:951291486308:web:eb133e2500ffe60b43ff71"
    },
  },
  {
    id: 'expresion-oral-escrita',
    nombre: 'Expresión Oral y Escrita',
    carrera: 'Ciencias de la Comunicación',
    asignatura: 'Expresión Oral y Escrita · Primer cuatrimestre',
    esquema: 'parciales',
    sitioUrl: 'https://jesusrodriguezgarcia749-cloud.github.io/expresion-oral-escrita/',
    firebaseConfig: {
      apiKey: "AIzaSyCv-1oXD5F0s33vHtXSPPL7G18Mk8L_Lc0",
      authDomain: "expresion-oral-escrita.firebaseapp.com",
      projectId: "expresion-oral-escrita",
      storageBucket: "expresion-oral-escrita.firebasestorage.app",
      messagingSenderId: "10241749923",
      appId: "1:10241749923:web:5ccdba588d4c0ea8b5a016"
    },
  },
];

// Lista de carreras únicas, en el orden en que aparecen sus materias arriba.
export const CARRERAS = [...new Set(MATERIAS.map(m => m.carrera))];

export function materiasDeCarrera(carrera) {
  return MATERIAS.filter(m => m.carrera === carrera);
}

// El usuario de Coordinación vive en el proyecto de Firebase de esta
// materia — el login SIEMPRE se hace contra ella, sin importar qué materia
// se esté consultando en un momento dado.
export const MATERIA_LOGIN = 'bases-culinarias';

// Inicializa Firebase para CADA materia y guarda su app/auth/db por id, para
// poder cambiar de materia sin perder la conexión a las demás.
const instancias = {};

function instanciaDe(materiaId) {
  if (instancias[materiaId]) return instancias[materiaId];

  const materia = MATERIAS.find(m => m.id === materiaId);
  if (!materia) throw new Error(`Materia desconocida: ${materiaId}`);

  const app = initializeApp(materia.firebaseConfig, materiaId);
  const auth = getAuth(app);
  const db = getFirestore(app);

  instancias[materiaId] = { app, auth, db };
  return instancias[materiaId];
}

export function authDe(materiaId) {
  return instanciaDe(materiaId).auth;
}

export function dbDe(materiaId) {
  return instanciaDe(materiaId).db;
}

export function sitioDe(materiaId) {
  const materia = MATERIAS.find(m => m.id === materiaId);
  return materia ? materia.sitioUrl : '';
}

export function esquemaDe(materiaId) {
  const materia = MATERIAS.find(m => m.id === materiaId);
  return materia ? materia.esquema : 'bloques';
}

export function asignaturaDe(materiaId) {
  const materia = MATERIAS.find(m => m.id === materiaId);
  return materia ? materia.asignatura : '';
}
