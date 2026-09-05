// calculo.js — fuente única de la fórmula de calificación de Expresión Oral
// y Escrita. Tanto mi-progreso.js (vista del alumno) como admin.js (panel
// docente, próximamente) importan de aquí, para que nunca muestren números
// distintos entre sí.
//
// Esquema (según la Concentradora de Calificaciones del docente):
//   Parcial 1 y Parcial 2: Examen 40% + Tareas 25% + Participación 25%
//                           + Asistencia 5% + Uniformes 5%
//   Examen Final:          Asistencia 5% + Tareas y Participación 15%
//                           + Examen/Proyecto 80%
//   Cuatrimestre:           Parcial 1 (25%) + Parcial 2 (25%) + Final (50%)
//                           (criterio oficial: "dos parciales 50%, final 50%")
//
// Estructura de datos esperada en Firestore, por alumno
// (grupos/{grupoId}/alumnos/{alumnoId}/...):
//   - tareas          (colección): { parcial: 'p1'|'p2'|'final', nombre, fecha, calificacion (0-10) }
//   - participaciones (colección): { parcial: 'p1'|'p2'|'final', nombre, fecha, calificacion (0-10) }
//   - asistencias     (colección): { parcial: 'p1'|'p2'|'final', fecha, estado: 'presente'|'justificado'|'retardo'|'falta' }
//   - uniformes       (documentos 'p1' y 'p2' dentro de la colección "uniformes"): { faltas: number }
//   - examenes        (documentos 'p1', 'p2', 'final' dentro de la colección "examenes"): { calificacion (0-10) }

export const TOPES = {
  p1:    { examen: 40, tareas: 25, participacion: 25, asistencia: 5, uniformes: 5 },
  p2:    { examen: 40, tareas: 25, participacion: 25, asistencia: 5, uniformes: 5 },
  final: { examen: 80, tareasParticipacion: 15, asistencia: 5 },
};

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
  // Regla del docente: 2 o más faltas de uniforme en el parcial = 0 automático.
  if (faltas >= 2) return { pts: 0, tope, faltas };
  if (faltas === 1) return { pts: tope / 2, tope, faltas };
  return { pts: tope, tope, faltas };
}

function calcularRubroPromedio(lista, tope) {
  const prom = promedioCalificaciones(lista); // 0-10 o null
  const pts = prom === null ? 0 : (prom / 10) * tope;
  return { pts, tope, lista: lista || [], promedio: prom };
}

function calcularExamen(dato, tope) {
  const calificacion = dato && dato.calificacion !== undefined && dato.calificacion !== null
    ? Number(dato.calificacion)
    : null;
  const pts = calificacion === null ? 0 : (calificacion / 10) * tope;
  return { pts, tope, calificacion };
}

// datos = { tareas: [...], participaciones: [...], asistencias: [...], uniformes: {p1:{...}, p2:{...}}, examenes: {p1:{...}, p2:{...}, final:{...}} }
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
    const total = tareasParticipacion.pts + examen.pts + asistencia.pts;
    return { parcial, total, examen, tareasParticipacion, asistencia };
  }

  const tope = TOPES[parcial];
  const tareas = calcularRubroPromedio(tareasDelParcial, tope.tareas);
  const participacion = calcularRubroPromedio(participacionDelParcial, tope.participacion);
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
