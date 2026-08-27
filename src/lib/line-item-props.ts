/**
 * Line-item property hygiene, shared by the order detail page and the
 * packing flow. Filters technical junk (hidden underscore properties,
 * linked add-on/cake keys, SKUs, variant IDs, "Default Title" noise) so
 * staff only ever see real product options and add-ons.
 */
export interface CleanProp {
  name: string;
  value: string;
}

const JUNK_NAME = /^_|linked.*key|\bsku\b|variant\s*id/i;

export function cleanLineItemProperties(
  properties: Array<{ name: string; value: string }>
): CleanProp[] {
  return properties
    .filter((p) => !JUNK_NAME.test(p.name))
    .map((p) => ({
      name: p.name,
      value: (p.value ?? '').replace(/\s*-\s*Default Title$/i, '').trim(),
    }))
    .filter((p) => p.value && p.value !== 'Default Title');
}

/** "2 × Praline Hazelnut, 3 × Truffle Gianduia" → one entry per flavour. */
export function asSelectionList(value: string): string[] | null {
  const parts = value.split(/,\s+(?=\d+\s*[×x]\s)/).map((x) => x.trim()).filter(Boolean);
  return parts.length >= 2 && parts.every((x) => /^\d+\s*[×x]\s/.test(x)) ? parts : null;
}
