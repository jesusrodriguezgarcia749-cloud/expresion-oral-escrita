// firebase-config.js
//
// Authentication (correo/contraseña) debe activarse en este proyecto real de
// Firebase (Authentication → habilitar Correo/Contraseña → Add user) para
// poder entrar al Panel docente. Storage NO se está usando por ahora: Firebase
// exige el plan Blaze (con tarjeta registrada) para habilitarlo, y se decidió
// no alojar los libros de referencia de terceros por costo y por derechos de
// autor. La biblioteca queda lista para alojar material propio en el futuro
// si se decide activar Storage más adelante.
//
// IMPORTANTE: cambia DOMINIO_INSTITUCIONAL por el dominio real de correo
// de tus alumnos. Solo se permitirá registro con correos que terminen en
// ese dominio.

export const firebaseConfig = {
  apiKey: "AIzaSyCv-1oXD5F0s33vHtXSPPL7G18Mk8L_Lc0",
  authDomain: "expresion-oral-escrita.firebaseapp.com",
  projectId: "expresion-oral-escrita",
  storageBucket: "expresion-oral-escrita.firebasestorage.app",
  messagingSenderId: "10241749923",
  appId: "1:10241749923:web:5ccdba588d4c0ea8b5a016"
};

export const DOMINIO_INSTITUCIONAL = "itesrenedescartes.edu.mx"; // ← AJUSTAR

// Sin materiales de terceros por ahora (ver nota arriba). Cuando haya
// material propio para alojar, se puede activar Storage (plan Blaze,
// gratis dentro de límites generosos) y llenar esta lista de nuevo.
export const MATERIALES_BIBLIOTECA = [];
