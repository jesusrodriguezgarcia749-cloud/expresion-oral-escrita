// calculo.js — fuente única de la fórmula de calificación de Expresión Oral
// y Escrita. Tanto mi-progreso.js (vista del alumno) como admin.js (panel
// docente) importan de aquí, para que nunca muestren números distintos.
//
// Esquema (según la Concentradora de Calificaciones del docente):
//   Parcial 1 y Parcial 2: Examen 40% + Tareas 25% + Participación 25%
//                           + Asistencia 5% + Uniformes 5%
//   Examen Final:          Examen 40% + Proyecto "Mi Voz, Mi Historia" 40%
//                           + Tareas y Participación 15% + Asistencia 5%
//     El Proyecto se acumula en tres entregas a lo largo del cuatrimestre:
//       Entrega 1 (durante Parcial 1)        -> 15 de los 40 puntos
//       Entrega 2 (durante Parcial 2)        -> 15 de los 40 puntos
//       Entrega final (ensayo pulido, Final) -> 10 de los 40 puntos
//   Cuatrimestre:           Parcial 1 (25%) + Parcial 2 (25%) + Final (50%)
//                           (criterio oficial: "dos parciales 50%, final 50%")
//
// Estructura de datos esperada en Firestore, por alumno
// (grupos/{grupoId}/alumnos/{alumnoId}/...):
//   - tareas          (coleccion): { parcial: 'p1'|'p2'|'final', nombre, fecha, calificacion (0-10) }
//   - participaciones (coleccion): { parcial: 'p1'|'p2'|'final', nombre, fecha, calificacion (0-10) }
//   - asistencias     (coleccion): { parcial: 'p1'|'p2'|'final', fecha, estado: 'presente'|'justificado'|'retardo'|'falta' }
//   - uniformes       (documentos 'p1' y 'p2'): { faltas: number }
//   - examenes        (documentos 'p1', 'p2', 'final'): { calificacion (0-10) }
//   - proyecto        (documentos 'entrega1', 'entrega2', 'entregaFinal'): { calificacion (0-10) }
//     -- "Mi Voz, Mi Historia": Entrega 1 y Entrega 2 se capturan durante los
//     parciales correspondientes, pero su peso vive por completo en el Final.

export const TOPES = {
  p1:    { examen: 40, tareas: 25, participacion: 25, asistencia: 5, uniformes: 5 },
  p2:    { examen: 40, tareas: 25, participacion: 25, asistencia: 5, uniformes: 5 },
  final: { examen: 40, proyecto: 40, tareasParticipacion: 15, asistencia: 5 },
};

// Reparto interno de los 40 puntos del Proyecto entre sus tres entregas.
export const TOPES_PROYECTO = { entrega1: 15, entrega2: 15, entregaFinal: 10 };

export const NOMBRES_ENTREGA_PROYECTO = {
  entrega1: 'Entrega 1 (Parcial 1)',
  entrega2: 'Entrega 2 (Parcial 2)',
  entregaFinal: 'Entrega final (Examen Final)',
};

// Meta de participaciones por parcial para llegar al tope de 25 pts.
// Con 40 alumnos es imposible que todos hablen todos los días: llegar a
// esta meta (no participar TODOS los días) ya da la calificación completa.
export const META_PARTICIPACION = { p1: 6, p2: 6 };

export const PESO_CUATRIMESTRE = { p1: 0.25, p2: 0.25, final: 0.50 };

export const NOMBRES_PARCIAL = { p1: 'Parcial 1', p2: 'Parcial 2', final: 'Examen Final' };

// Peso de cada estado de asistencia hacia el porcentaje de clases atendidas.
const PESO_ASISTENCIA = { presente: 1, justificado: 1, retardo: 0.5, falta: 0 };

function promedioCalificaciones(lista) {
  if (!lista || lista.length === 0) return null;
  const suma = lista.reduce((s, x) => s + (Number(x.calificacion) || 0), 0);
  return suma / lista.length; // sobre 10
}

function calcularAsistencia(registros, tope) {
  if (!registros || registros.length === 0) {
    return { pts: 0, tope, presentes: 0, total: 0 };
  }
  const total = registros.length;
  const suma = registros.reduce((s, r) => s + (PESO_ASISTENCIA[r.estado] ?? 0), 0);
  const pct = suma / total;
  return { pts: pct * tope, tope, presentes: suma, total };
}

function calcularUniformes(datoUniforme, tope) {
  const faltas = datoUniforme ? Number(datoUniforme.faltas) || 0 : 0;
  // Regla del docente: 2 o mas faltas de uniforme en el parcial = 0 automatico.
  if (faltas >= 2) return { pts: 0, tope, faltas };
  if (faltas === 1) return { pts: tope / 2, tope, faltas };
  return { pts: tope, tope, faltas };
}

function calcularRubroPromedio(lista, tope) {
  const prom = promedioCalificaciones(lista); // 0-10 o null
  const pts = prom === null ? 0 : (prom / 10) * tope;
  return { pts, tope, lista: lista || [], promedio: prom };
}

// Participacion por CONTEO contra una meta (no promedio, no todo-o-nada):
// llegar a la meta de participaciones da el tope completo; menos, proporcional.
// Ej. con meta 6 y tope 25: 6+ participaciones = 25 pts; 3 = 12.5; 2 = 8.33.
function calcularParticipacionConteo(lista, meta, tope) {
  const cantidad = (lista || []).length;
  const efectiva = Math.min(cantidad, meta);
  const pts = meta > 0 ? (efectiva / meta) * tope : 0;
  return { pts, tope, cantidad, meta, lista: lista || [] };
}

function calcularExamen(dato, tope) {
  const calificacion = dato && dato.calificacion !== undefined && dato.calificacion !== null
    ? Number(dato.calificacion)
    : null;
  const pts = calificacion === null ? 0 : (calificacion / 10) * tope;
  return { pts, tope, calificacion };
}

// Suma (no promedia) las tres entregas del proyecto -- cada una tiene su
// propio tope fijo, asi que una entrega faltante simplemente aporta 0 sin
// diluir el valor de las demas.
function calcularProyecto(datosProyecto) {
  const detalle = {};
  let pts = 0;
  Object.entries(TOPES_PROYECTO).forEach(([entrega, tope]) => {
    const dato = (datosProyecto || {})[entrega];
    const r = calcularExamen(dato, tope);
    detalle[entrega] = r;
    pts += r.pts;
  });
  return { pts, tope: 40, detalle };
}

// datos = { tareas, participaciones, asistencias, uniformes, examenes, proyecto }
export function calcularParcial(parcial, datos) {
  const tareasDelParcial = (datos.tareas || []).filter(t => t.parcial === parcial);
  const participacionDelParcial = (datos.participaciones || []).filter(p => p.parcial === parcial);
  const asistenciaDelParcial = (datos.asistencias || []).filter(a => a.parcial === parcial);

  if (parcial === 'final') {
    const tope = TOPES.final;
    const combinado = [...tareasDelParcial, ...participacionDelParcial];
    const tareasParticipacion = calcularRubroPromedio(combinado, tope.tareasParticipacion);
    const examen = calcularExamen((datos.examenes || {}).final, tope.examen);
    const asistencia = calcularAsistencia(asistenciaDelParcial, tope.asistencia);
    const proyecto = calcularProyecto(datos.proyecto);
    const total = tareasParticipacion.pts + examen.pts + asistencia.pts + proyecto.pts;
    return { parcial, total, examen, tareasParticipacion, asistencia, proyecto };
  }

  const tope = TOPES[parcial];
  const tareas = calcularRubroPromedio(tareasDelParcial, tope.tareas);
  const participacion = calcularParticipacionConteo(participacionDelParcial, META_PARTICIPACION[parcial], tope.participacion);
  const asistencia = calcularAsistencia(asistenciaDelParcial, tope.asistencia);
  const uniformes = calcularUniformes((datos.uniformes || {})[parcial], tope.uniformes);
  const examen = calcularExamen((datos.examenes || {})[parcial], tope.examen);
  const total = tareas.pts + participacion.pts + asistencia.pts + uniformes.pts + examen.pts;

  return { parcial, total, examen, tareas, participacion, asistencia, uniformes };
}

export function calcularCuatrimestre(resultadosPorParcial) {
  const total = ['p1', 'p2', 'final'].reduce(
    (s, p) => s + (resultadosPorParcial[p]?.total || 0) * PESO_CUATRIMESTRE[p],
    0
  );
  return total;
}
