import { describe, it, expect } from 'vitest';
import {
  validatePackage,
  buildLabelPurchaseInput,
  labelServiceConfig,
  shippingDatetime,
  explainLabelError,
  buildDemoLabelPdf,
} from '@/lib/shipping-label';

describe('validatePackage', () => {
  it('accepts a typical chocolate parcel typed as strings', () => {
    const r = validatePackage({ lengthCm: '25', widthCm: '18.5', heightCm: '8', weightGrams: '1250' });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ lengthCm: 25, widthCm: 18.5, heightCm: 8, weightGrams: 1250 });
  });

  it('flags every missing field', () => {
    const r = validatePackage({});
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['heightCm', 'lengthCm', 'weightGrams', 'widthCm']);
  });

  it('catches millimetres typed as centimetres and kilograms typed as grams', () => {
    const r = validatePackage({ lengthCm: 250, widthCm: 18, heightCm: 8, weightGrams: 1.25 });
    expect(r.errors.lengthCm).toMatch(/millimetres/);
    expect(r.errors.weightGrams).toMatch(/grams/);
  });

  it('enforces Royal Mail Tracked 24 limits whichever way round the box is measured', () => {
    expect(validatePackage({ lengthCm: 46, widthCm: 61, heightCm: 46, weightGrams: 500 }).ok).toBe(true);
    expect(validatePackage({ lengthCm: 50, widthCm: 50, heightCm: 50, weightGrams: 500 }).errors.size).toBeTruthy();
    expect(validatePackage({ lengthCm: 20, widthCm: 20, heightCm: 20, weightGrams: 20001 }).errors.weightGrams).toMatch(/20 kg/);
  });
});

describe('buildLabelPurchaseInput', () => {
  const now = new Date('2026-10-18T09:00:00Z');
  const input = buildLabelPurchaseInput({
    fulfillmentOrderGid: 'gid://shopify/FulfillmentOrder/1',
    pkg: { lengthCm: 25, widthCm: 18, heightCm: 8, weightGrams: 1250 },
    service: null,
    now,
  });

  it('leaves the service to Shopify\'s preferred carrier by default', () => {
    expect(input).not.toHaveProperty('preferredRateSelection');
  });

  it('passes an explicit service only when one is configured', () => {
    const withService = buildLabelPurchaseInput({
      fulfillmentOrderGid: 'gid://shopify/FulfillmentOrder/1',
      pkg: { lengthCm: 25, widthCm: 18, heightCm: 8, weightGrams: 1250 },
      service: { carrierCode: 'royal_mail', serviceCode: 'TRACKED_24' },
      now,
    });
    expect(withService.preferredRateSelection).toEqual({ carrierCode: 'royal_mail', serviceCode: 'TRACKED_24' });
  });

  it('uses the measured box (custom package) and the scales reading as total weight', () => {
    expect(input.totalWeight).toEqual({ value: 1250, unit: 'GRAMS' });
    expect(input.packageInfo).toMatchObject({
      customPackage: { type: 'BOX', dimensions: { length: 25, width: 18, height: 8, unit: 'CENTIMETERS' } },
    });
  });

  it('ships in the future and notifies the customer', () => {
    expect(new Date(input.shippingDatetime as string).getTime()).toBeGreaterThan(now.getTime());
    expect(input.notifyCustomer).toBe(true);
  });
});

describe('labelServiceConfig', () => {
  it('is null (use the preferred carrier) unless both override codes are set', () => {
    expect(labelServiceConfig({})).toBeNull();
    expect(labelServiceConfig({ SHOPIFY_LABEL_CARRIER_CODE: 'royal_mail' })).toBeNull();
    expect(labelServiceConfig({ SHOPIFY_LABEL_CARRIER_CODE: ' royal_mail ', SHOPIFY_LABEL_SERVICE_CODE: 'T24' }))
      .toEqual({ carrierCode: 'royal_mail', serviceCode: 'T24' });
  });
});

describe('helpers', () => {
  it('shippingDatetime is a valid future ISO instant', () => {
    const now = new Date('2026-10-18T09:00:00Z');
    expect(shippingDatetime(now)).toBe('2026-10-18T09:15:00.000Z');
  });

  it('explains Shopify error codes in plain English, passing unknown ones through', () => {
    expect(explainLabelError('RATES_NOT_FOUND', 'x')).toMatch(/Tracked 24 isn't available/);
    expect(explainLabelError(null, 'Something odd')).toBe('Something odd');
  });

  it('builds a well-formed 4x6 demo PDF', () => {
    const text = new TextDecoder().decode(buildDemoLabelPdf(['DEMO', 'Line (with) brackets', 'Café']));
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 288 432]');
    expect(text).toContain('Line \\(with\\) brackets');
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
  });
});
