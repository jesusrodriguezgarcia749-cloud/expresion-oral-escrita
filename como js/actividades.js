// actividades.js — zona de estudio y repaso, SIN valor en la calificación.
// A diferencia de bases-culinarias, aquí no hay login de alumno ni se guarda
// nada en Firestore: es solo evaluación formativa con retroalimentación
// explicada. El alumno responde y ve el resultado de inmediato (no hay que
// esperar a completar todo el subtema). Nada persiste al recargar la página.
//
// Tipos de actividad soportados: opcion_multiple, verdadero_falso, relacionar
// (relacionar columnas — el alumno empareja cada elemento izquierdo con el
// derecho que le corresponde, usando un <select> por fila).

// Temas disponibles: agrega aquí cuando exista data/actividades_bloqueN.json
const BLOQUES_DISPONIBLES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const NOMBRES_BLOQUE = {
  1: 'Tema 1', 2: 'Tema 2', 3: 'Tema 3', 4: 'Tema 4', 5: 'Tema 5',
  6: 'Tema 6', 7: 'Tema 7', 8: 'Tema 8', 9: 'Tema 9'
};

let actividadesPorBloque = {}; // { 1: [ {...}, ... ] }
let bloqueActivo = 1;

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function barajar(arr) {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// ---------- CARGA DE DATOS ----------
async function cargarActividadesBloque(bloque) {
  if (actividadesPorBloque[bloque]) return actividadesPorBloque[bloque];
  const res = await fetch(`data/actividades_bloque${bloque}.json`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al pedir data/actividades_bloque${bloque}.json`);
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`El archivo data/actividades_bloque${bloque}.json no es JSON válido (${e.message})`);
  }
  actividadesPorBloque[bloque] = data.actividades;
  return data.actividades;
}

// ---------- RENDER ----------
function renderTabs() {
  const tabsRoot = document.getElementById('quiz-tabs');
  tabsRoot.innerHTML = '';
  BLOQUES_DISPONIBLES.forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'quiz-tab' + (b === bloqueActivo ? ' active' : '');
    btn.textContent = NOMBRES_BLOQUE[b];
    btn.addEventListener('click', async () => {
      bloqueActivo = b;
      renderTabs();
      await renderBloque();
    });
    tabsRoot.appendChild(btn);
  });
}

async function renderBloque() {
  const root = document.getElementById('quiz-root');
  root.innerHTML = '<p class="cargando-msg">Cargando…</p>';

  let actividades;
  try {
    actividades = await cargarActividadesBloque(bloqueActivo);
  } catch (err) {
    console.error('Error cargando actividades del tema', bloqueActivo, err);
    const motivo = (err && err.message) ? err.message : String(err);
    root.innerHTML = `
      <p class="subtema-retry-msg">No se pudo cargar el contenido de este tema (data/actividades_bloque${bloqueActivo}.json).<br>Motivo: ${escaparHTML(motivo)}</p>
      <button class="btn btn-primary" data-action="reintentar-carga">Reintentar</button>
    `;
    root.querySelector('[data-action="reintentar-carga"]').addEventListener('click', () => renderBloque());
    return;
  }

  root.innerHTML = '';

  const subtemas = [...new Set(actividades.map(a => a.subtema))];
  subtemas.forEach(sub => {
    const actsDelSubtema = actividades.filter(a => a.subtema === sub);
    root.appendChild(renderSubtema(sub, actsDelSubtema));
  });
}

function renderSubtema(sub, actividades) {
  const section = document.createElement('section');
  section.className = 'act-subtema-block';
  section.innerHTML = `<h2 class="act-subtema-titulo">Subtema ${escaparHTML(sub)}</h2>`;

  actividades.forEach((act, i) => {
    section.appendChild(renderTarjetaActividad(act, `${bloqueActivo}-${sub}-${i}`));
  });

  return section;
}

// ---------- LÓGICA POR TIPO DE ACTIVIDAD ----------

function esCorrecta(act, respuesta) {
  if (act.tipo === 'relacionar') {
    return act.pares.every((_, i) => respuesta[i] === i);
  }
  const correctaIdx = act.tipo === 'verdadero_falso' ? (act.correcta ? 0 : 1) : act.correcta;
  return respuesta === correctaIdx;
}

function mostrarFeedback(card, act, respuesta, acerto) {
  if (act.tipo === 'relacionar') {
    const selects = card.querySelectorAll('.relacionar-select');
    selects.forEach((sel, i) => {
      sel.disabled = true;
      sel.classList.remove('correct', 'incorrect');
      sel.classList.add(respuesta[i] === i ? 'correct' : 'incorrect');
    });
  } else {
    const correctaIdx = act.tipo === 'verdadero_falso' ? (act.correcta ? 0 : 1) : act.correcta;
    const labels = card.querySelectorAll('.quiz-option');
    labels.forEach(label => {
      const idx = parseInt(label.dataset.idx, 10);
      label.classList.remove('correct', 'incorrect');
      if (idx === correctaIdx) label.classList.add('correct');
      else if (idx === respuesta) label.classList.add('incorrect');
      label.querySelector('input').disabled = true;
    });
  }

  const feedback = card.querySelector('.quiz-feedback');
  feedback.hidden = false;
  feedback.innerHTML = acerto
    ? `<strong>Correcto.</strong> ${escaparHTML(act.explicacion)}`
    : `<strong>No exactamente.</strong> ${escaparHTML(act.explicacion)}`;
  feedback.className = 'quiz-feedback visible ' + (acerto ? 'ok' : 'no-ok');
}

function renderTarjetaActividad(act, idUnico) {
  const card = document.createElement('div');
  card.className = 'quiz-question';
  card.id = `card-${idUnico}`;

  if (act.tipo === 'relacionar') {
    const derechaBarajada = barajar(act.pares.map((p, i) => ({ texto: p.derecha, origen: i })));
    const respuesta = {};

    card.innerHTML = `
      <h3>${escaparHTML(act.pregunta)}</h3>
      <div class="relacionar-list">
        ${act.pares.map((par, i) => `
          <div class="relacionar-row">
            <span class="relacionar-izq">${escaparHTML(par.izquierda)}</span>
            <select class="relacionar-select" data-idx="${i}">
              <option value="">— Elige —</option>
              ${derechaBarajada.map(op => `<option value="${op.origen}">${escaparHTML(op.texto)}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
      <div class="quiz-actions">
        <button class="btn btn-primary btn-small" data-action="revisar">Revisar</button>
      </div>
      <p class="quiz-feedback" hidden></p>
    `;

    card.querySelectorAll('.relacionar-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const i = parseInt(sel.dataset.idx, 10);
        if (sel.value === '') delete respuesta[i];
        else respuesta[i] = parseInt(sel.value, 10);
      });
    });

    card.querySelector('[data-action="revisar"]').addEventListener('click', (e) => {
      if (Object.keys(respuesta).length < act.pares.length) {
        alert('Empareja todos los elementos antes de revisar.');
        return;
      }
      const acerto = esCorrecta(act, respuesta);
      mostrarFeedback(card, act, respuesta, acerto);
      e.target.remove();
    });

    return card;
  }

  const opciones = act.tipo === 'verdadero_falso' ? ['Verdadero', 'Falso'] : act.opciones;

  card.innerHTML = `
    <h3>${escaparHTML(act.pregunta)}</h3>
    <div class="quiz-options">
      ${opciones.map((op, i) => `
        <label class="quiz-option" data-idx="${i}">
          <input type="radio" name="q-${idUnico}" value="${i}">
          <span>${escaparHTML(op)}</span>
        </label>
      `).join('')}
    </div>
    <p class="quiz-feedback" hidden></p>
  `;

  card.querySelectorAll('.quiz-option').forEach(label => {
    label.addEventListener('click', () => {
      if (label.querySelector('input').disabled) return;
      const respuesta = parseInt(label.dataset.idx, 10);
      const acerto = esCorrecta(act, respuesta);
      mostrarFeedback(card, act, respuesta, acerto);
    });
  });

  return card;
}

// ---------- ARRANQUE ----------
document.addEventListener('DOMContentLoaded', async () => {
  renderTabs();
  await renderBloque();
});
