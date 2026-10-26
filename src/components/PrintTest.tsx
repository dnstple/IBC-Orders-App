'use client';

import { useEffect, useRef, useState } from 'react';
import {
  connectMunbyn,
  webBluetoothAvailable,
  tsplTextTest,
  tsplFromCanvas,
  LABEL_WIDTH_DOTS,
  LABEL_HEIGHT_DOTS,
  type MunbynConnection,
} from '@/lib/munbyn-ble';

/**
 * Proves the computer → Bluetooth → Munbyn route before the label flow uses
 * it. Two tests: built-in text (does the printer listen at all?) and a
 * picture (the way real shipping labels will be sent).
 */
export function PrintTest() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [conn, setConn] = useState<MunbynConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [invert, setInvert] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => setSupported(webBluetoothAvailable()), []);
  useEffect(() => () => conn?.disconnect(), [conn]);

  const add = (line: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${line}`]);

  async function connect(showAllDevices = false) {
    setBusy(true);
    try {
      setConn(await connectMunbyn(add, { showAllDevices }));
      add('✓ Ready to print.');
    } catch (e) {
      add(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function print(kind: 'text' | 'picture') {
    if (!conn) return;
    setBusy(true);
    try {
      const data = kind === 'text'
        ? tsplTextTest(['IBC TEST PRINT', 'Bluetooth from Chrome', 'works!', new Date().toLocaleString('en-GB')])
        : tsplFromCanvas(drawTestPicture(canvasRef.current!), invert);
      add(`Sending ${kind} test (${data.length.toLocaleString()} bytes)…`);
      const started = Date.now();
      let lastPct = -1;
      await conn.send(data, (sent, total) => {
        const pct = Math.floor((sent / total) * 10) * 10;
        if (pct !== lastPct) {
          lastPct = pct;
          add(`  ${pct}%`);
        }
      });
      add(`✓ Sent in ${((Date.now() - started) / 1000).toFixed(1)} s — did a label come out?`);
    } catch (e) {
      add(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const btn = 'min-h-12 w-full rounded-xl px-5 py-3 text-base font-semibold disabled:opacity-50';

  return (
    <div className="mx-auto max-w-xl space-y-4 py-4">
      <h1 className="text-xl font-semibold text-cocoa-900">Munbyn Bluetooth test</h1>

      {supported === false && (
        <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">
          This browser can&apos;t use Bluetooth. Open this page in <strong>Google Chrome</strong> (or Microsoft Edge) on a
          <strong> computer</strong>. It won&apos;t work on the iPad.
        </div>
      )}

      <ol className="space-y-2 rounded-xl border border-cocoa-100 bg-white p-5 text-base text-stone-700">
        <li><strong>1.</strong> On the iPad, <strong>close the Munbyn app</strong> and turn <strong>Bluetooth off</strong> — the printer only talks to one device at a time.</li>
        <li><strong>2.</strong> Switch the Munbyn on, with labels loaded.</li>
        <li><strong>3.</strong> Tap <strong>Connect to printer</strong>. In the box that pops up, pick the printer (called <strong>ITPP130B-</strong> and four characters) and tap <strong>Pair</strong>.</li>
        <li><strong>4.</strong> Tap <strong>Test 1</strong>. If a label comes out, tap <strong>Test 2</strong>.</li>
      </ol>

      <button onClick={() => connect()} disabled={busy || supported === false || Boolean(conn)}
        className={`${btn} bg-cocoa-700 text-white hover:bg-cocoa-600`}>
        {conn ? `✓ Connected to ${conn.deviceName}` : busy ? 'Connecting…' : 'Connect to printer'}
      </button>
      {!conn && (
        <button onClick={() => connect(true)} disabled={busy || supported === false}
          className="w-full text-center text-sm text-stone-500 underline">
          Printer not in the list? Show every nearby device instead
        </button>
      )}
      <button onClick={() => print('text')} disabled={busy || !conn}
        className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
        Test 1 — print text
      </button>
      <button onClick={() => print('picture')} disabled={busy || !conn}
        className={`${btn} border border-stone-300 bg-white text-cocoa-900 hover:border-cocoa-500`}>
        Test 2 — print a picture (how real labels will print)
      </button>
      <label className="flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
        Test 2 came out as a solid black block? Tick this and try Test 2 again.
      </label>

      <canvas ref={canvasRef} width={LABEL_WIDTH_DOTS} height={LABEL_HEIGHT_DOTS} className="hidden" />

      <div className="rounded-xl bg-stone-900 p-4 font-mono text-xs leading-relaxed text-stone-100">
        <div className="mb-1 font-sans text-[11px] uppercase tracking-wide text-stone-400">Log — screenshot this for Claude</div>
        {log.length === 0 ? <div className="text-stone-500">Nothing yet.</div> : log.map((l, i) => <div key={i} className="break-words">{l}</div>)}
      </div>
    </div>
  );
}

/** A 4×6 test picture: border, big text, a barcode-like strip and fine lines. */
function drawTestPicture(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 8;
  ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.font = 'bold 72px sans-serif';
  ctx.fillText('IBC', 48, 130);
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText('Picture test', 48, 200);
  ctx.font = '32px sans-serif';
  ctx.fillText('If this is sharp and the right', 48, 270);
  ctx.fillText('way up, real labels will work.', 48, 315);
  for (let x = 48, i = 0; x < w - 60; x += 6, i++) {
    if (i % 3 !== 1) ctx.fillRect(x, 400, i % 5 === 0 ? 6 : 3, 220);
  }
  for (let y = 700; y < h - 60; y += 40) {
    ctx.fillRect(48, y, w - 96, y % 80 === 20 ? 4 : 2);
  }
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText('▲ TOP', w - 200, 130);
  return canvas;
}
