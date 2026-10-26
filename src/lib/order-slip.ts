/**
 * The "YOUR ORDER" packing slip that goes in the box. Pure: an order's line
 * items plus the website's allergen data in, slip content out — no I/O, so
 * every rule below is unit tested.
 *
 * Allergens follow the website exactly (theme snippets/ibc-allergens.liquid):
 * each statement is resolved on its own, variant list first, product list as
 * the fallback. An empty variant list means "inherit", never "none". Note the
 * keys are not symmetrical in Shopify — product custom.trace_allergen,
 * variant custom.trace_allergens.
 */

export interface AllergenSource {
  productAllergens?: string[] | null;
  productTraces?: string[] | null;
  variantAllergens?: string[] | null;
  variantTraces?: string[] | null;
}

export interface SlipLineInput {
  title: string;
  variantTitle: string | null;
  sku: string | null;
  /** Quantity still in the order (after removals/refunds). */
  quantity: number;
  /** Every line-item property, hidden underscore ones included. */
  properties: Array<{ name: string; value: string }>;
  allergens: AllergenSource;
}

export interface SlipOrderInput {
  orderNumber: string;
  lines: SlipLineInput[];
  /** Live allergen data for gift-box pieces, keyed by numeric variant id. */
  giftBoxPieces?: Record<string, { title: string; allergens: AllergenSource }>;
}

export interface SlipItem {
  kind: 'product' | 'gift_box' | 'message' | 'topping';
  title: string;
  quantity: number;
  /** Option and property lines, copied as written ("500g / Dark"). */
  details: string[];
  contains: string[];
  traces: string[];
  /** Gift box pieces, with their own quantities. */
  pieces?: Array<{ title: string; quantity: number }>;
  /** One shared trace sentence for a whole gift box. */
  boxTraceStatement?: string;
  /** Personalised message, exactly as the customer typed it. */
  message?: string;
}

export interface SlipContent {
  orderNumber: string;
  items: SlipItem[];
  careNotes: string[];
  /** For staff in the app only — never printed on the customer's slip. */
  staffWarnings: string[];
}

export const SPREADS_NOTE =
  'As the spreads are made using all-natural ingredients, you will likely notice some oil resting on the surface. This is completely normal. Before eating, please stir each spread thoroughly until the spread is smooth and even.';

const FLAVOUR_ORDER = ['Milk', 'Dark', 'White'];

const prop = (line: SlipLineInput, name: string) =>
  line.properties.find((p) => p.name.toLowerCase() === name.toLowerCase())?.value?.trim() || null;

const isMessageLine = (l: SlipLineInput) => /^personalised message$/i.test(l.title.trim()) || l.sku === 'CAK-PER';
const isToppingLine = (l: SlipLineInput) => /^triple chocolate for /i.test(l.title.trim());
const isGiftBoxLine = (l: SlipLineInput) => /^gift box\b/i.test(l.title.trim());
const isSpreadLine = (l: SlipLineInput) => /\bspreads?\b/i.test(l.title);
const isHiddenLine = (l: SlipLineInput) => Boolean(l.sku && l.sku.toUpperCase().startsWith('IBC-DEL-')) || l.quantity <= 0;

/** Properties that are shown some other way, or are shop bookkeeping. */
const HANDLED_PROPS = /^(personalised message|triple chocolate choice|gift box (limit|selection|pieces))$/i;
const JUNK_PROP = /^_|linked.*key|\bsku\b|variant\s*id/i;

const list = (v: string[] | null | undefined) => (v && v.length ? v.map((s) => s.trim()).filter(Boolean) : null);

/** The website's rule: each statement variant-first, product as fallback. */
export function resolveAllergens(src: AllergenSource): { contains: string[]; traces: string[] } {
  return {
    contains: list(src.variantAllergens) ?? list(src.productAllergens) ?? [],
    traces: list(src.variantTraces) ?? list(src.productTraces) ?? [],
  };
}

/** Spelling-only differences (Soy/Soya, Egg/Eggs, Wheat/Gluten) are not disagreements. */
const SYNONYMS: Record<string, string> = { soya: 'soy', soybean: 'soy', soybeans: 'soy', eggs: 'egg', gluten: 'wheat', nut: 'nuts', 'tree nuts': 'nuts', hazelnuts: 'hazelnut', peanuts: 'peanut', 'sesame seed': 'sesame', 'sesame seeds': 'sesame', almond: 'almonds' };
const norm = (values: string[]) =>
  [...new Set(values.map((v) => { const k = v.trim().toLowerCase(); return SYNONYMS[k] ?? k; }))].sort().join('|');

/** Plain-English warnings when product-level and option-level lists disagree. */
export function allergenDisagreements(name: string, src: AllergenSource): string[] {
  const out: string[] = [];
  const check = (label: string, product: string[] | null, variant: string[] | null) => {
    if (product && variant && norm(product) !== norm(variant)) {
      out.push(
        `${name}: the website's ${label} list for this option (${variant.join(', ')}) doesn't match the product's (${product.join(', ')}). The slip uses the option's list — check the product in Shopify.`
      );
    }
  };
  check('allergen', list(src.productAllergens), list(src.variantAllergens));
  check('"may contain traces"', list(src.productTraces), list(src.variantTraces));
  return out;
}

/** "Milk, Dark, White" → ['Milk','Dark','White'] in the shop's order. */
export function toppingFlavours(choice: string | null): string[] {
  if (!choice) return [];
  const picked = choice.split(/[,/&]|\band\b/i).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return FLAVOUR_ORDER.filter((f) => picked.includes(f.toLowerCase()));
}

const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The microwave note for Triple Chocolate cake toppings, worded for what was ordered. */
export function toppingCareNote(flavours: string[], wholeCakes: number, slices: number): string | null {
  if (flavours.length === 0 || (wholeCakes === 0 && slices === 0)) return null;
  const cake = [
    wholeCakes > 0 ? (wholeCakes > 1 ? 'cakes' : 'cake') : null,
    slices > 0 ? (slices > 1 ? 'cake slices' : 'cake slice') : null,
  ].filter(Boolean).join(' and ');
  const names = andList(flavours);
  if (flavours.length === 1) {
    return `Your ${names} chocolate topping comes in a separate pot. Before heating, remove the lid and microwave the pot in 15–20 second intervals. Stir well after each interval until the chocolate is smooth and pourable. Once melted, pour the chocolate over your ${cake} and enjoy!`;
  }
  return `Your ${names} chocolate toppings come in separate pots. Before heating, remove the lids and microwave each pot separately in 15–20 second intervals. Stir well after each interval until the chocolate is smooth and pourable. Once melted, pour the chocolates over your ${cake} and enjoy!`;
}

function detailsFor(line: SlipLineInput): string[] {
  const out: string[] = [];
  const variant = (line.variantTitle ?? '').trim();
  if (variant && variant !== 'Default Title') out.push(variant);
  for (const p of line.properties) {
    if (JUNK_PROP.test(p.name) || HANDLED_PROPS.test(p.name.trim())) continue;
    let value = (p.value ?? '').replace(/\s*-\s*Default Title$/i, '').trim();
    // "Spreads Selection of 2 (selection N565)" — the code is the shop's, not the customer's.
    if (/^selection$/i.test(p.name.trim())) value = value.replace(/\s*\(selection [^)]*\)\s*$/i, '');
    if (!value || value === 'Default Title') continue;
    out.push(/^selection$/i.test(p.name.trim()) ? value : `${p.name.trim()}: ${value}`);
  }
  return out;
}

const union = (lists: string[][]) => {
  const seen = new Map<string, string>();
  for (const l of lists) for (const v of l) {
    const k = SYNONYMS[v.toLowerCase()] ?? v.toLowerCase();
    if (!seen.has(k)) seen.set(k, v);
  }
  return [...seen.values()];
};

function giftBoxItem(line: SlipLineInput, input: SlipOrderInput, warnings: string[]): SlipItem {
  let pieces: Array<{ title: string; quantity: number; variantId?: string }> = [];
  try {
    const raw = JSON.parse(prop(line, '_Gift Box Selection JSON') ?? '[]') as Array<{ variant_id: number | string; title: string; quantity: number }>;
    pieces = raw.map((p) => ({ title: String(p.title), quantity: Number(p.quantity) || 1, variantId: String(p.variant_id) }));
  } catch {
    /* fall back to the visible list below */
  }
  if (pieces.length === 0) {
    const visible = prop(line, 'Gift Box Selection') ?? '';
    pieces = visible.split(/,\s*(?=\d+\s*[×x]\s)/).map((s) => s.match(/^(\d+)\s*[×x]\s*(.+)$/)).filter(Boolean)
      .map((m) => ({ title: m![2].trim(), quantity: Number(m![1]) }));
  }

  // Allergens from each piece's live website data; the checkout snapshot only if a piece is missing.
  const live = pieces.map((p) => (p.variantId ? input.giftBoxPieces?.[p.variantId] : undefined));
  let contains: string[];
  let traces: string[];
  if (pieces.length > 0 && live.every(Boolean)) {
    const resolved = live.map((l) => resolveAllergens(l!.allergens));
    live.forEach((l) => warnings.push(...allergenDisagreements(`${line.title} — ${l!.title}`, l!.allergens)));
    contains = union(resolved.map((r) => r.contains));
    traces = union(resolved.map((r) => r.traces));
  } else {
    const split = (v: string | null) => (v ? v.split(/[|,]/).map((s) => s.trim()).filter(Boolean) : []);
    contains = union([split(prop(line, '_Gift Box Allergens'))]);
    traces = union([split(prop(line, '_Gift Box Trace Allergens'))]);
    warnings.push(`${line.title}: couldn't read the latest allergens for every piece, so the slip uses the allergens saved at checkout. Check them before sending.`);
  }

  return {
    kind: 'gift_box',
    title: line.title,
    quantity: line.quantity,
    details: detailsFor(line),
    contains,
    traces: [],
    pieces: pieces.map(({ title, quantity }) => ({ title, quantity })),
    boxTraceStatement: traces.length ? `The whole gift box may contain traces of ${andList(traces.map((t) => t.toLowerCase()))}.` : undefined,
  };
}

export function buildOrderSlip(input: SlipOrderInput): SlipContent {
  const warnings: string[] = [];
  const lines = input.lines.filter((l) => !isHiddenLine(l));
  const hasMessageLine = lines.some(isMessageLine);

  // Keep add-ons (toppings, messages) right under the cake they belong to.
  const keyOf = (l: SlipLineInput) => prop(l, '_Linked add-on key');
  const parentKeyOf = (l: SlipLineInput) => prop(l, '_Linked cake key');
  const parents = new Set(lines.map(keyOf).filter(Boolean));
  const ordered: SlipLineInput[] = [];
  for (const l of lines) {
    const pk = parentKeyOf(l);
    if (pk && parents.has(pk)) continue; // placed with its cake
    ordered.push(l);
    const k = keyOf(l);
    if (k) {
      const addons = lines.filter((a) => parentKeyOf(a) === k);
      ordered.push(...addons.filter(isToppingLine), ...addons.filter((a) => !isToppingLine(a)));
    }
  }

  const items: SlipItem[] = [];
  const flavours = new Set<string>();
  let wholeCakes = 0;
  let slices = 0;
  let spreads = false;

  for (const line of ordered) {
    if (isGiftBoxLine(line) && (prop(line, '_Gift Box Selection JSON') || prop(line, 'Gift Box Selection'))) {
      items.push(giftBoxItem(line, input, warnings));
      continue;
    }

    const { contains, traces } = resolveAllergens(line.allergens);
    warnings.push(...allergenDisagreements(line.title, line.allergens));
    if (contains.length === 0 && traces.length === 0) {
      warnings.push(`${line.title}: the website has no allergen information for this item, so none is printed. Check it in Shopify.`);
    }

    if (isMessageLine(line)) {
      items.push({
        kind: 'message',
        title: 'PERSONALISED MESSAGE',
        quantity: line.quantity,
        details: [],
        message: prop(line, 'Personalised message') ?? '',
        contains,
        traces,
      });
      continue;
    }

    let details = detailsFor(line);
    // The message has its own line on the slip; the cake doesn't repeat it.
    const message = prop(line, 'Personalised message');
    if (message && !hasMessageLine) details = [...details, `Personalised message: ${message}`];

    if (isToppingLine(line)) {
      const picked = toppingFlavours(prop(line, 'Triple chocolate choice') ?? prop(line, '_Triple Chocolate Choice'));
      if (picked.length) details = [`${andList(picked)} chocolate`, ...details];
      if (/slice/i.test(line.title)) {
        slices += line.quantity;
        picked.forEach((f) => flavours.add(f));
      } else if (/cake/i.test(line.title)) {
        wholeCakes += line.quantity;
        picked.forEach((f) => flavours.add(f));
      }
      items.push({ kind: 'topping', title: line.title, quantity: line.quantity, details, contains, traces });
      continue;
    }

    if (isSpreadLine(line)) spreads = true;
    items.push({ kind: 'product', title: line.title, quantity: line.quantity, details, contains, traces });
  }

  const careNotes: string[] = [];
  const topping = toppingCareNote(FLAVOUR_ORDER.filter((f) => flavours.has(f)), wholeCakes, slices);
  if (topping) careNotes.push(topping);
  if (spreads) careNotes.push(SPREADS_NOTE);

  return { orderNumber: input.orderNumber, items, careNotes, staffWarnings: [...new Set(warnings)] };
}
