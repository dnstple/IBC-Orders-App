/**
 * Shipping labels bought from inside the app, always Royal Mail Tracked 24,
 * always with the box measurements staff type in for that order — never a
 * saved package. Pure helpers only (no I/O) so they can be unit tested.
 */

export interface PackageInput {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightGrams: number;
}

/** Royal Mail Tracked 24 parcel limits: 20 kg, 61 × 46 × 46 cm. */
export const MAX_WEIGHT_GRAMS = 20000;
export const MAX_SIDES_CM: [number, number, number] = [61, 46, 46];

export type PackageErrors = Partial<Record<keyof PackageInput | 'size', string>>;

/** Validate the numbers staff typed. Returns a plain-English message per bad field. */
export function validatePackage(raw: Partial<Record<keyof PackageInput, unknown>>): {
  ok: boolean;
  value?: PackageInput;
  errors: PackageErrors;
} {
  const errors: PackageErrors = {};
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN);

  const lengthCm = num(raw.lengthCm);
  const widthCm = num(raw.widthCm);
  const heightCm = num(raw.heightCm);
  const weightGrams = num(raw.weightGrams);

  const side = (key: 'lengthCm' | 'widthCm' | 'heightCm', v: number, name: string) => {
    if (!Number.isFinite(v) || v <= 0) errors[key] = `Enter the box ${name} in centimetres`;
    else if (v > 100) errors[key] = `${v} cm looks too big — measure the ${name} in centimetres, not millimetres`;
  };
  side('lengthCm', lengthCm, 'length');
  side('widthCm', widthCm, 'width');
  side('heightCm', heightCm, 'height');

  if (!Number.isFinite(weightGrams) || weightGrams <= 0) {
    errors.weightGrams = 'Put the closed box on the scales and enter the weight in grams';
  } else if (weightGrams < 10) {
    errors.weightGrams = `${weightGrams} g looks too light — enter the weight in grams (1 kg = 1000 g)`;
  } else if (weightGrams > MAX_WEIGHT_GRAMS) {
    errors.weightGrams = 'Royal Mail Tracked 24 takes parcels up to 20 kg (20000 g)';
  }

  if (!errors.lengthCm && !errors.widthCm && !errors.heightCm) {
    const sorted = [lengthCm, widthCm, heightCm].sort((a, b) => b - a);
    if (sorted.some((s, i) => s > MAX_SIDES_CM[i])) {
      errors.size = 'This box is bigger than Royal Mail Tracked 24 allows (61 × 46 × 46 cm). Use a smaller box or ask a manager.';
    }
  }

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok ? { lengthCm: round1(lengthCm), widthCm: round1(widthCm), heightCm: round1(heightCm), weightGrams: Math.round(weightGrams) } : undefined,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Labels are bought for a shipping time a little in the future — Shopify
 * rejects a shippingDatetime in the past (SHIPPING_DATE_IN_THE_PAST), and
 * the request can take a moment to arrive.
 */
export function shippingDatetime(now: Date = new Date()): string {
  return new Date(now.getTime() + 15 * 60000).toISOString();
}

/** The ShippingLabelPurchaseInput for one fulfillment order. */
export function buildLabelPurchaseInput(params: {
  fulfillmentOrderGid: string;
  pkg: PackageInput;
  /** Optional override; normally null so Shopify's preferred carrier decides. */
  service: { carrierCode: string; serviceCode: string } | null;
  now?: Date;
}): Record<string, unknown> {
  const { pkg } = params;
  const input: Record<string, unknown> = {
    fulfillmentOrderId: params.fulfillmentOrderGid,
    shippingDatetime: shippingDatetime(params.now),
    // The scales reading is the whole parcel, so it goes in totalWeight,
    // which overrides Shopify's own package + products estimate.
    totalWeight: { value: pkg.weightGrams, unit: 'GRAMS' },
    packageInfo: {
      customPackage: {
        type: 'BOX',
        dimensions: { length: pkg.lengthCm, width: pkg.widthCm, height: pkg.heightCm, unit: 'CENTIMETERS' },
        // Empty-box weight is required but irrelevant once totalWeight is set.
        weight: { value: 1, unit: 'GRAMS' },
      },
    },
    // Shopify's shipping confirmation email, with tracking.
    notifyCustomer: true,
  };
  // Without preferredRateSelection Shopify keeps the buyer's checkout rate
  // if it is a carrier rate, else uses the shop's preferred carrier/service
  // (Settings → Shipping labels → Manage preferred carriers). IBC's checkout
  // rates are all flat custom rates, so the preferred carrier — Royal Mail
  // Tracked 24 — always decides. Shopify publishes no codes for UK
  // services, so the override is only for if Shopify ever supplies them.
  if (params.service) input.preferredRateSelection = params.service;
  return input;
}

/** Optional carrier/service override from env. Null (the normal case) unless both are set. */
export function labelServiceConfig(env: Record<string, string | undefined> = process.env): {
  carrierCode: string;
  serviceCode: string;
} | null {
  const carrierCode = env.SHOPIFY_LABEL_CARRIER_CODE?.trim();
  const serviceCode = env.SHOPIFY_LABEL_SERVICE_CODE?.trim();
  return carrierCode && serviceCode ? { carrierCode, serviceCode } : null;
}

/** Plain-English explanation for Shopify's purchase error codes. */
export function explainLabelError(code: string | null | undefined, message: string): string {
  switch (code) {
    case 'RATES_NOT_FOUND':
      return 'Royal Mail Tracked 24 isn\'t available for this parcel. Check the box size and weight, then try again — if it keeps happening, ask a manager.';
    case 'CARRIER_NOT_AVAILABLE':
      return 'Royal Mail isn\'t available right now. Wait a minute and try again.';
    case 'SHIPPING_DATE_IN_THE_PAST':
      return 'The iPad clock may be wrong. Try again.';
    case 'FULFILLMENT_ORDER_INVALID':
      return 'Shopify says this order can\'t be shipped yet (it may already be fulfilled or on hold). Ask a manager.';
    default:
      return message;
  }
}

/**
 * A 4×6 inch placeholder label PDF for demo orders, so the whole flow —
 * including the share sheet and the Munbyn app — can be rehearsed without
 * buying anything. ASCII text only.
 */
export function buildDemoLabelPdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
  const text = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 20 : 12} Tf 24 ${400 - i * 26} Td (${esc(l)}) Tj ET`)
    .join('\n');
  const content = `${text}\n4 w 12 12 264 408 re S`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
