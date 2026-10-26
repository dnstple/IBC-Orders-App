/**
 * The packing slip as a print-ready 4×6 inch HTML page for the Munbyn. HTML
 * rather than PDF so the browser lays the text out at the printer's own
 * 203 dpi with the site's fonts, and @page fixes the paper size and removes
 * margins (and with them Chrome's header/footer). Black on white only.
 * Pure: content in, string out.
 */
import type { SlipContent, SlipItem } from '@/lib/order-slip';
import { SLIP_LOGO_SVG } from '@/lib/slip-logo';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function allergenLines(contains: string[], traces: string[]): string {
  return [
    contains.length ? `<p class="alg"><b>Contains:</b> ${esc(contains.join(', '))}</p>` : '',
    traces.length ? `<p class="alg"><b>May contain traces of:</b> ${esc(traces.join(', '))}</p>` : '',
  ].join('');
}

function itemHtml(item: SlipItem): string {
  const head = `<div class="row"><h2>${esc(item.title)}</h2><span class="qty">Qty ${item.quantity}</span></div>`;
  const details = item.details.map((d) => `<p class="detail">${esc(d)}</p>`).join('');
  const message = item.kind === 'message' ? `<p class="message">${esc(item.message ?? '')}</p>` : '';
  const pieces = item.pieces?.length
    ? `<ul class="pieces">${item.pieces.map((p) => `<li><span>${esc(p.title)}</span><span class="qty">Qty ${p.quantity}</span></li>`).join('')}</ul>`
    : '';
  const boxTraces = item.boxTraceStatement ? `<p class="alg">${esc(item.boxTraceStatement)}</p>` : '';
  return `<section class="item">${head}${details}${message}${pieces}${allergenLines(item.contains, item.traces)}${boxTraces}</section>`;
}

export function renderSlipHtml(content: SlipContent, opts: { fontBase?: string } = {}): string {
  const f = (opts.fontBase ?? '/fonts').replace(/\/$/, '');
  const care = content.careNotes.length
    ? `<section class="care"><h3>Care instructions</h3>${content.careNotes.map((n) => `<p>${esc(n)}</p>`).join('')}</section>`
    : '';

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>Order slip ${esc(content.orderNumber)}</title>
<style>
@font-face { font-family: 'Oswald'; font-weight: 500; src: url('${f}/oswald-latin-500-normal.woff2') format('woff2'); }
@font-face { font-family: 'Cabin'; font-weight: 400; src: url('${f}/cabin-latin-400-normal.woff2') format('woff2'); }
@font-face { font-family: 'Cabin'; font-weight: 600; src: url('${f}/cabin-latin-600-normal.woff2') format('woff2'); }
@page { size: 4in 6in; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 4in; background: #fff; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Cabin', Arial, sans-serif; font-size: 8pt; line-height: 1.3; }
.page { min-height: 5.98in; padding: 0.2in 0.22in 0.16in; display: flex; flex-direction: column; }
.logo { width: 0.9in; height: 0.9in; margin: 0 auto; }
.logo svg { display: block; width: 100%; height: 100%; }
h1 { font-family: 'Oswald', 'Arial Narrow', sans-serif; font-weight: 500; font-size: 12pt; letter-spacing: 0.14em; text-align: center; margin-top: 0.1in; }
.order-no { text-align: center; font-size: 7.5pt; margin-top: 1pt; }
hr, .item, .care { border: 0; border-top: 0.6pt solid #000; }
hr { margin-top: 0.08in; }
.item { padding: 0.07in 0 0.07in; break-inside: avoid; }
.item:first-of-type { border-top: 0; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 0.1in; }
h2 { font-family: 'Oswald', 'Arial Narrow', sans-serif; font-weight: 500; font-size: 11.5pt; line-height: 1.15; letter-spacing: 0.02em; }
.qty { font-size: 7pt; white-space: nowrap; }
.detail { font-size: 8pt; margin-top: 1pt; }
.message { font-weight: 600; font-size: 10pt; margin: 2pt 0 1pt; white-space: pre-wrap; overflow-wrap: anywhere; }
.pieces { list-style: none; margin: 2pt 0 1pt; }
.pieces li { display: flex; justify-content: space-between; gap: 0.1in; font-size: 8pt; line-height: 1.35; }
.alg { font-size: 7pt; margin-top: 2pt; }
.alg b { font-weight: 600; }
.care { padding-top: 0.07in; break-inside: avoid; }
.care h3 { font-family: 'Oswald', 'Arial Narrow', sans-serif; font-weight: 500; font-size: 8.5pt; letter-spacing: 0.1em; text-transform: uppercase; }
.care p { font-size: 7.5pt; margin-top: 2pt; }
footer { margin-top: auto; padding-top: 0.12in; text-align: center; break-inside: avoid; }
footer .thanks { font-size: 9pt; border-top: 0.6pt solid #000; padding-top: 0.08in; }
footer .site { font-family: 'Oswald', 'Arial Narrow', sans-serif; font-weight: 500; font-size: 8pt; letter-spacing: 0.08em; margin-top: 2pt; }
</style>
</head>
<body>
<div class="page">
<div class="logo">${SLIP_LOGO_SVG}</div>
<h1>YOUR ORDER</h1>
<p class="order-no">Order ${esc(content.orderNumber)}</p>
<hr>
${content.items.map(itemHtml).join('\n')}
${care}
<footer><p class="thanks">Thank you for your order.</p><p class="site">italianbearchocolate.com</p></footer>
</div>
</body>
</html>`;
}
