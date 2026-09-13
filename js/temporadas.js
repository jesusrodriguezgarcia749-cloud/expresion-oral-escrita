// ============================================================
// temporadas.js — Capa de personalización estacional
//
// Muestra una cinta de temporada y elementos cayendo suavemente
// según la FECHA DEL DÍA. Fuera de las fechas configuradas no
// hace absolutamente nada (ni cinta, ni animación, ni botón).
//
// Se sube UNA sola vez: el calendario de todo el año ya viene
// aquí abajo y se repite cada año automáticamente. Para agregar
// una fecha nueva, basta con añadir un objeto a la lista
// TEMPORADAS — no hay que tocar ninguna otra parte del código.
//
// Cómo se usa en una página:
//     <script src="js/temporadas.js"></script>
// (o "temporadas.js" si está en la raíz del repo)
//
// El visitante puede apagarlo con el botón × de la cinta; la
// preferencia se recuerda en ese navegador hasta que empiece la
// siguiente temporada.
// ============================================================

(function () {
  'use strict';

  // ---------- Calendario de temporadas ----------
  // desde / hasta en formato 'MM-DD' (inclusive ambos extremos).
  // Se evalúan en orden: la primera que coincida es la que se usa.
  const TEMPORADAS = [
    {
      id: 'patrio',
      mensaje: '¡Viva México!',
      desde: '09-01', hasta: '09-30',
      emojis: ['🇲🇽', '🎉', '🪅', '🎊', '🌽'],
      colorCinta: '#006341',   // verde bandera
      colorTexto: '#FFFFFF',
    },
    {
      id: 'muertos',
      mensaje: 'Día de Muertos',
      desde: '10-25', hasta: '11-03',
      emojis: ['💀', '🕯️', '🌼', '🍬', '🎃'],
      colorCinta: '#5B2C6F',
      colorTexto: '#FFF4D6',
    },
    {
      id: 'navidad',
      mensaje: 'Felices fiestas',
      desde: '12-01', hasta: '12-31',
      emojis: ['🎄', '❄️', '⭐', '🎁', '🔔'],
      colorCinta: '#A63D2F',
      colorTexto: '#FFF8EC',
    },
    {
      id: 'anio-nuevo',
      mensaje: 'Feliz Año Nuevo',
      desde: '01-01', hasta: '01-06',
      emojis: ['🎆', '✨', '🥂', '🎊'],
      colorCinta: '#C98A2C',
      colorTexto: '#231F1A',
    },
    {
      id: 'primavera',
      mensaje: 'Bienvenida, primavera',
      desde: '03-20', hasta: '03-31',
      emojis: ['🌸', '🌱', '🦋', '🌷'],
      colorCinta: '#6B7A5E',
      colorTexto: '#FFFFFF',
    },
    {
      id: 'dia-maestro',
      mensaje: 'Feliz Día del Maestro',
      desde: '05-15', hasta: '05-15',
      emojis: ['📚', '✏️', '🍎', '🎓'],
      colorCinta: '#8A5E12',
      colorTexto: '#FFF8EC',
    },
  ];

  // ---------- Ajustes generales ----------
  const CANTIDAD_ELEMENTOS = 14;   // cuántos caen a la vez
  const CLAVE_APAGADO = 'temporada_apagada';

  // ---------- ¿Qué temporada toca hoy? ----------
  function temporadaDeHoy() {
    const hoy = new Date();
    const mmdd = String(hoy.getMonth() + 1).padStart(2, '0') + '-' +
                 String(hoy.getDate()).padStart(2, '0');

    return TEMPORADAS.find(t => {
      // Rango normal dentro del mismo año (ej. 09-01 a 09-30).
      if (t.desde <= t.hasta) return mmdd >= t.desde && mmdd <= t.hasta;
      // Rango que cruza el fin de año (ej. 12-20 a 01-05).
      return mmdd >= t.desde || mmdd <= t.hasta;
    });
  }

  const temporada = temporadaDeHoy();
  if (!temporada) return; // fuera de temporada: no se hace nada

  // Si el visitante la apagó para ESTA temporada, se respeta.
  try {
    if (localStorage.getItem(CLAVE_APAGADO) === temporada.id) return;
  } catch (e) { /* si no hay localStorage, seguimos normal */ }

  // Respeta a quien pidió al sistema reducir animaciones.
  const sinMovimiento = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Estilos (van aquí para no tocar los CSS de cada página) ----------
  const estilos = document.createElement('style');
  estilos.textContent = `
    .temporada-cinta{
      position:relative; z-index:60;
      display:flex; align-items:center; justify-content:center; gap:10px;
      padding:9px 46px 9px 16px;
      font-family:'Public Sans', -apple-system, sans-serif;
      font-size:.88rem; font-weight:600; letter-spacing:.02em;
      text-align:center; line-height:1.35;
    }
    .temporada-cinta-emojis{ font-size:1rem; letter-spacing:.12em; }
    .temporada-cerrar{
      position:absolute; right:10px; top:50%; transform:translateY(-50%);
      width:28px; height:28px; border:0; border-radius:50%;
      background:rgba(255,255,255,.18); color:inherit;
      font-size:1rem; line-height:1; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      transition:background .15s ease;
    }
    .temporada-cerrar:hover{ background:rgba(255,255,255,.32); }

    .temporada-lluvia{
      position:fixed; inset:0; z-index:1;
      pointer-events:none; overflow:hidden;
    }
    .temporada-pieza{
      position:absolute; top:-40px;
      font-size:1.4rem; line-height:1;
      opacity:.55;
      animation-name:temporada-caer;
      animation-timing-function:linear;
      animation-iteration-count:infinite;
    }
    @keyframes temporada-caer{
      0%   { transform:translateY(-40px) rotate(0deg); }
      100% { transform:translateY(105vh) rotate(360deg); }
    }
    @media print{
      .temporada-cinta, .temporada-lluvia{ display:none !important; }
    }
  `;
  document.head.appendChild(estilos);

  // ---------- Cinta superior ----------
  function crearCinta() {
    const cinta = document.createElement('div');
    cinta.className = 'temporada-cinta';
    cinta.style.background = temporada.colorCinta;
    cinta.style.color = temporada.colorTexto;

    const emojis = temporada.emojis.slice(0, 3).join(' ');
    cinta.innerHTML =
      `<span class="temporada-cinta-emojis">${emojis}</span>` +
      `<span>${temporada.mensaje}</span>` +
      `<span class="temporada-cinta-emojis">${emojis}</span>`;

    const cerrar = document.createElement('button');
    cerrar.className = 'temporada-cerrar';
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Ocultar decoración de temporada');
    cerrar.textContent = '×';
    cerrar.addEventListener('click', apagar);
    cinta.appendChild(cerrar);

    document.body.insertBefore(cinta, document.body.firstChild);
    return cinta;
  }

  // ---------- Elementos cayendo ----------
  function crearLluvia() {
    const capa = document.createElement('div');
    capa.className = 'temporada-lluvia';
    capa.setAttribute('aria-hidden', 'true');

    for (let i = 0; i < CANTIDAD_ELEMENTOS; i++) {
      const pieza = document.createElement('span');
      pieza.className = 'temporada-pieza';
      pieza.textContent = temporada.emojis[i % temporada.emojis.length];
      pieza.style.left = Math.random() * 100 + '%';
      pieza.style.fontSize = (1.1 + Math.random() * 1.1).toFixed(2) + 'rem';
      pieza.style.animationDuration = (9 + Math.random() * 9).toFixed(1) + 's';
      pieza.style.animationDelay = (Math.random() * 10).toFixed(1) + 's';
      pieza.style.opacity = (0.35 + Math.random() * 0.35).toFixed(2);
      capa.appendChild(pieza);
    }

    document.body.appendChild(capa);
    return capa;
  }

  // ---------- Apagar ----------
  let cinta = null;
  let lluvia = null;

  function apagar() {
    if (cinta) cinta.remove();
    if (lluvia) lluvia.remove();
    try { localStorage.setItem(CLAVE_APAGADO, temporada.id); } catch (e) { /* nada */ }
  }

  // ---------- Arranque ----------
  function iniciar() {
    cinta = crearCinta();
    if (!sinMovimiento) lluvia = crearLluvia();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
