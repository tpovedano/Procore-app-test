/**
 * Página final del login (ventana emergente). Lee la sesión cifrada del
 * fragmento, lo borra de la barra de direcciones y la entrega al iframe con
 * procore-iframe-helpers (postMessage al mismo origen); la ventana se cierra sola.
 */
import { getIframeContext } from './lib/iframeHelpers';

const params = new URLSearchParams(window.location.hash.slice(1));
history.replaceState(null, '', window.location.pathname);
const msg = document.getElementById('msg');

try {
  const auth = getIframeContext().authentication;
  const session = params.get('session');
  if (session) {
    auth.notifySuccess({ session });
  } else {
    const error = params.get('error') ?? 'No se pudo iniciar sesión.';
    if (msg) msg.textContent = error;
    auth.notifyFailure({ error });
  }
} catch {
  if (msg) msg.textContent = 'No se pudo comunicar con la aplicación. Cierra esta ventana e inténtalo de nuevo.';
}
