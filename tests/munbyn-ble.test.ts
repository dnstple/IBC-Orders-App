import { describe, it, expect } from 'vitest';
import { tsplTextTest } from '@/lib/munbyn-ble';

describe('TSPL text test label', () => {
  const tspl = new TextDecoder().decode(tsplTextTest(['IBC TEST', 'Say "hi"']));

  it('sets up a 4x6 label, then prints exactly one copy', () => {
    expect(tspl.startsWith('SIZE 101.6 mm,152.4 mm\r\nGAP 3 mm,0 mm\r\n')).toBe(true);
    expect(tspl.endsWith('PRINT 1,1\r\n')).toBe(true);
  });

  it('never lets a quote break out of a TEXT command', () => {
    expect(tspl).toContain('"Say \'hi\'"');
  });
});
