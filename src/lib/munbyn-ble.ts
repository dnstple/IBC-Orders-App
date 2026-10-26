/**
 * Print straight to the MUNBYN P130B (ITPP130B) over Bluetooth Low Energy
 * from Chrome/Edge on a computer — Web Bluetooth, no driver, no Munbyn app.
 * Safari (iPad/iPhone) has no Web Bluetooth, so this is computer-only.
 *
 * Known from the open-source ITPP130B bridge (cmyker/munbyn-itpp130b-macos):
 * the printer speaks TSPL at 203 dpi and takes data on a writable
 * characteristic 0xFFF2. Its service UUID isn't documented, so we ask for
 * the usual thermal-printer services and pick the first writable
 * characteristic, preferring FFF2. Every step is logged so a failed test
 * tells us what to change.
 */

/* Minimal Web Bluetooth types — not in TypeScript's DOM lib. */
interface BleCharacteristic {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithResponse(data: BufferSource): Promise<void>;
  writeValueWithoutResponse(data: BufferSource): Promise<void>;
}
interface BleService {
  uuid: string;
  getCharacteristics(): Promise<BleCharacteristic[]>;
}
interface BleDevice {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryServices(): Promise<BleService[]> }>;
    disconnect(): void;
  };
}
interface BluetoothApi {
  requestDevice(options: { acceptAllDevices: boolean; optionalServices: Array<number | string> }): Promise<BleDevice>;
}

const uuid16 = (n: number) => `0000${n.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

/** Services label printers commonly expose; Web Bluetooth only lets us see listed ones. */
const CANDIDATE_SERVICES: Array<number | string> = [
  0xfff0, 0xff00, 0xffe0, 0x18f0, 0xae30, 0xfee7,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];
const PREFERRED_CHARACTERISTIC = uuid16(0xfff2);

export const DOTS_PER_MM = 8; // 203 dpi
export const LABEL_WIDTH_DOTS = 812; // 4 in
export const LABEL_HEIGHT_DOTS = 1218; // 6 in

export function webBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export interface MunbynConnection {
  deviceName: string;
  characteristicUuid: string;
  send(data: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void>;
  disconnect(): void;
}

/** Shows Chrome's device picker, connects, and finds where to send data. */
export async function connectMunbyn(log: (line: string) => void): Promise<MunbynConnection> {
  if (!webBluetoothAvailable()) {
    throw new Error('This browser can\'t use Bluetooth. Open this page in Google Chrome on a computer.');
  }
  const bluetooth = (navigator as unknown as { bluetooth: BluetoothApi }).bluetooth;
  const device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: CANDIDATE_SERVICES });
  log(`Picked device: ${device.name ?? '(no name)'}`);
  if (!device.gatt) throw new Error('This device has no Bluetooth LE connection.');

  const server = await device.gatt.connect();
  log('Connected.');

  const services = await server.getPrimaryServices();
  log(`Services: ${services.map((s) => s.uuid).join(', ') || 'none visible'}`);

  const writable: BleCharacteristic[] = [];
  for (const service of services) {
    const chars = await service.getCharacteristics();
    for (const c of chars) {
      const kinds = [c.properties.write && 'write', c.properties.writeWithoutResponse && 'writeNoResponse'].filter(Boolean);
      log(`  ${service.uuid} → ${c.uuid} ${kinds.join('+') || '(read/notify only)'}`);
      if (kinds.length) writable.push(c);
    }
  }
  const target = writable.find((c) => c.uuid === PREFERRED_CHARACTERISTIC) ?? writable[0];
  if (!target) {
    device.gatt.disconnect();
    throw new Error('Connected, but found nowhere to send print data. Send Claude the log below.');
  }
  log(`Sending to characteristic ${target.uuid}`);

  return {
    deviceName: device.name ?? 'Printer',
    characteristicUuid: target.uuid,
    async send(data, onProgress) {
      // Small chunks with a short pause; the last one waits for an
      // acknowledgement so we know the printer took everything.
      const chunk = 180;
      const noResponse = target.properties.writeWithoutResponse;
      for (let i = 0; i < data.length; i += chunk) {
        const part = data.slice(i, i + chunk);
        const last = i + chunk >= data.length;
        if (noResponse && !last) {
          await target.writeValueWithoutResponse(part);
          await new Promise((r) => setTimeout(r, 12));
        } else {
          await target.writeValueWithResponse(part);
        }
        onProgress?.(Math.min(i + chunk, data.length), data.length);
      }
    },
    disconnect() {
      if (device.gatt?.connected) device.gatt.disconnect();
    },
  };
}

const ascii = (s: string) => new TextEncoder().encode(s);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const HEADER = 'SIZE 101.6 mm,152.4 mm\r\nGAP 3 mm,0 mm\r\nDIRECTION 0,0\r\nCLS\r\n';

/** A text-only label using the printer's built-in font — the simplest possible test. */
export function tsplTextTest(lines: string[]): Uint8Array {
  const body = lines
    .map((line, i) => `TEXT 40,${60 + i * 70},"3",0,${i === 0 ? 2 : 1},${i === 0 ? 2 : 1},"${line.replace(/"/g, "'")}"\r\n`)
    .join('');
  return ascii(`${HEADER}BOX 16,16,796,1200,4\r\n${body}PRINT 1,1\r\n`);
}

/**
 * Turn a canvas into a TSPL BITMAP label — how real shipping labels will be
 * sent. In TSPL a 0 bit prints black; `invert` flips that in case this
 * printer does the opposite.
 */
export function tsplFromCanvas(canvas: HTMLCanvasElement, invert = false): Uint8Array {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const widthBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(widthBytes * height).fill(invert ? 0x00 : 0xff);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      const black = pixels[i + 3] > 127 && luminance < 128;
      if (black) {
        const byte = y * widthBytes + (x >> 3);
        const mask = 0x80 >> (x & 7);
        if (invert) bits[byte] |= mask;
        else bits[byte] &= ~mask;
      }
    }
  }
  return concat([
    ascii(`${HEADER}BITMAP 0,0,${widthBytes},${height},0,`),
    bits,
    ascii('\r\nPRINT 1,1\r\n'),
  ]);
}
