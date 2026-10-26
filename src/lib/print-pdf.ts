/**
 * Printing a label PDF from a computer (Windows or Mac) to the USB Munbyn.
 * The PDF is loaded into a hidden frame and the browser's own print window
 * is opened on it — the Munbyn is then just a normal printer, so there is
 * no app, extension or Bluetooth involved. Browser-only helpers.
 */

/** Where Munbyn keeps the P130B / ITPP130B drivers (Windows and Mac). */
export const MUNBYN_DRIVER_URL = 'https://munbyn.biz/130BD';

/** Remembered per computer once a test label has printed. */
const READY_KEY = 'ibc_munbyn_printer_ready';

export type Platform = 'windows' | 'mac' | 'tablet' | 'other';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, so touch decides it.
  const touchOnly = navigator.maxTouchPoints > 1 && !window.matchMedia('(pointer: fine)').matches;
  if (/iPhone|iPad|Android/.test(ua) || (touchOnly && /Mac/.test(ua))) return 'tablet';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac/.test(ua)) return 'mac';
  return 'other';
}

export function printerMarkedReady(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === 'yes';
  } catch {
    return false;
  }
}

export function setPrinterReady(ready: boolean): void {
  try {
    if (ready) localStorage.setItem(READY_KEY, 'yes');
    else localStorage.removeItem(READY_KEY);
  } catch {
    /* private window — the setup card just shows again next time */
  }
}

/** Open the browser's print window on a PDF. Falls back to a new tab. */
export function printPdf(pdf: Blob): void {
  const url = URL.createObjectURL(pdf);
  const frame = document.createElement('iframe');
  // Off-screen rather than display:none — Chrome won't load a hidden PDF viewer.
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0', opacity: '0' });
  frame.src = url;
  frame.onload = () => {
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, '_blank');
      }
    }, 400);
  };
  document.body.appendChild(frame);
  // Leave it long enough for the print window to finish with it.
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 5 * 60000);
}
