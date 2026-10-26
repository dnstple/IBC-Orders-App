import { describe, it, expect } from 'vitest';
import {
  buildOrderSlip,
  resolveAllergens,
  allergenDisagreements,
  toppingCareNote,
  toppingFlavours,
  SPREADS_NOTE,
  type SlipLineInput,
} from '@/lib/order-slip';
import { renderSlipHtml } from '@/lib/order-slip-html';

const line = (over: Partial<SlipLineInput>): SlipLineInput => ({
  title: 'Item',
  variantTitle: null,
  sku: null,
  quantity: 1,
  properties: [],
  allergens: {},
  ...over,
});

const cake = (key: string, extra: Array<{ name: string; value: string }> = []) =>
  line({
    title: 'Chocolate Cake',
    sku: 'CAK-CHC-WHL',
    properties: [{ name: '_Linked add-on key', value: key }, ...extra],
    allergens: { productAllergens: ['Gluten', 'Milk', 'Eggs', 'Soya'], variantAllergens: ['Wheat', 'Egg', 'Milk', 'Soy'] },
  });

const topping = (title: string, key: string, choice: string, quantity = 1) =>
  line({
    title,
    quantity,
    properties: [{ name: '_Linked cake key', value: key }, { name: 'Triple chocolate choice', value: choice }],
    allergens: { variantAllergens: ['Milk', 'Soy'] },
  });

describe('resolveAllergens (same rule as the website)', () => {
  it('uses the variant list first and the product list as a fallback, per statement', () => {
    expect(resolveAllergens({ productAllergens: ['Milk', 'Soya'], productTraces: ['Nuts'], variantAllergens: ['Soy'], variantTraces: null }))
      .toEqual({ contains: ['Soy'], traces: ['Nuts'] });
  });
  it('treats an empty variant list as inherit, not "none"', () => {
    expect(resolveAllergens({ productAllergens: ['Hazelnut'], variantAllergens: [] }).contains).toEqual(['Hazelnut']);
  });
});

describe('allergen disagreement flag', () => {
  it('ignores spelling-only differences', () => {
    expect(allergenDisagreements('Chocolate Cake', {
      productAllergens: ['Gluten', 'Milk', 'Eggs', 'Soya'],
      variantAllergens: ['Wheat', 'Egg', 'Milk', 'Soy'],
    })).toEqual([]);
  });
  it('flags a real difference (Big Block Dark: product says Milk, option does not)', () => {
    const w = allergenDisagreements('Big Block', { productAllergens: ['Milk', 'Soya'], variantAllergens: ['Soy'] });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/Big Block/);
    expect(w[0]).toMatch(/Soy\).*Milk, Soya/);
  });
  it('flags differing trace lists separately', () => {
    const w = allergenDisagreements('Cannoli', { productTraces: ['Nuts'], variantTraces: ['Peanut', 'Sesame Seed'] });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/may contain traces/);
  });
  it('puts the flag in staff warnings and never on the printed slip', () => {
    const slip = buildOrderSlip({
      orderNumber: '#1119',
      lines: [line({ title: 'Big Block', variantTitle: '500g / Dark', allergens: { productAllergens: ['Milk', 'Soya'], variantAllergens: ['Soy'] } })],
    });
    expect(slip.staffWarnings.join(' ')).toMatch(/Big Block/);
    expect(slip.items[0].contains).toEqual(['Soy']);
    const html = renderSlipHtml(slip);
    expect(html).not.toMatch(/doesn't match/);
  });
});

describe('gift boxes', () => {
  const selection = [
    { variant_id: 1, title: 'Praline Hazelnut', quantity: 2 },
    { variant_id: 2, title: 'Truffle Milk', quantity: 1 },
    { variant_id: 3, title: 'Praline Pistachio', quantity: 1 },
  ];
  const box = line({
    title: 'Gift Box',
    variantTitle: '4 pieces',
    properties: [
      { name: 'Gift Box Limit', value: '4' },
      { name: 'Gift Box Selection', value: '2 × Praline Hazelnut, 1 × Truffle Milk, 1 × Praline Pistachio' },
      { name: 'Gift Box Pieces', value: '4 of 4' },
      { name: '_Gift Box Selection JSON', value: JSON.stringify(selection) },
      { name: '_Gift Box Allergens', value: 'Milk|Soy' },
      { name: '_Gift Box Trace Allergens', value: 'Nuts' },
    ],
  });

  it('groups the pieces under the box with their own quantities and one shared trace sentence', () => {
    const slip = buildOrderSlip({
      orderNumber: '#1102',
      lines: [box],
      giftBoxPieces: {
        1: { title: 'Praline Hazelnut', allergens: { variantAllergens: ['Milk', 'Soy', 'Hazelnut'] } },
        2: { title: 'Truffle Milk', allergens: { variantAllergens: ['Milk', 'Soy'], variantTraces: ['Nuts'] } },
        3: { title: 'Praline Pistachio', allergens: { productAllergens: ['Milk', 'Soya', 'Pistachio'], productTraces: ['Nuts'] } },
      },
    });
    expect(slip.items).toHaveLength(1);
    const item = slip.items[0];
    expect(item.kind).toBe('gift_box');
    expect(item.pieces).toEqual([
      { title: 'Praline Hazelnut', quantity: 2 },
      { title: 'Truffle Milk', quantity: 1 },
      { title: 'Praline Pistachio', quantity: 1 },
    ]);
    expect(item.contains).toEqual(['Milk', 'Soy', 'Hazelnut', 'Pistachio']);
    expect(item.boxTraceStatement).toBe('The whole gift box may contain traces of nuts.');
    expect(item.traces).toEqual([]);
    // No bookkeeping properties leak onto the slip.
    expect(item.details).toEqual(['4 pieces']);
    const html = renderSlipHtml(slip);
    expect(html.split('<body>')[1]).not.toContain('*');
    expect(html).toContain('The whole gift box may contain traces of nuts.');
  });

  it('falls back to the checkout snapshot, with a staff warning, if a piece has no live data', () => {
    const slip = buildOrderSlip({ orderNumber: '#1102', lines: [box], giftBoxPieces: {} });
    expect(slip.items[0].contains).toEqual(['Milk', 'Soy']);
    expect(slip.items[0].boxTraceStatement).toBe('The whole gift box may contain traces of nuts.');
    expect(slip.staffWarnings.join(' ')).toMatch(/saved at checkout/);
  });
});

describe('personalised message', () => {
  const order = () => buildOrderSlip({
    orderNumber: '#1121',
    lines: [
      line({
        title: 'Personalised Message',
        sku: 'CAK-PER',
        properties: [{ name: '_Linked cake key', value: 'k1' }, { name: 'Personalised message', value: "HAPPY B'DAY ADIYAN" }],
        allergens: { variantAllergens: ['Milk', 'Soy'] },
      }),
      cake('k1', [{ name: 'Personalised message', value: "HAPPY B'DAY ADIYAN" }]),
    ],
  });

  it('gets its own PERSONALISED MESSAGE item, reproduced exactly, with the bar allergens', () => {
    const msg = order().items.find((i) => i.kind === 'message')!;
    expect(msg.title).toBe('PERSONALISED MESSAGE');
    expect(msg.message).toBe("HAPPY B'DAY ADIYAN");
    expect(msg.contains).toEqual(['Milk', 'Soy']);
  });

  it('sits under its cake, and the cake does not repeat it', () => {
    const slip = order();
    expect(slip.items.map((i) => i.title)).toEqual(['Chocolate Cake', 'PERSONALISED MESSAGE']);
    expect(slip.items[0].details.join(' ')).not.toMatch(/ADIYAN/);
  });

  it('keeps capitalisation and punctuation exactly in the printed HTML (escaped, not altered)', () => {
    const html = renderSlipHtml(buildOrderSlip({
      orderNumber: '#1',
      lines: [line({ title: 'Personalised Message', sku: 'CAK-PER', properties: [{ name: 'Personalised message', value: 'happy 21st, Vinny! <3' }] })],
    }));
    expect(html).toContain('happy 21st, Vinny! &lt;3');
  });
});

describe('Triple Chocolate toppings', () => {
  it('reads only the flavours ordered, in Milk/Dark/White order', () => {
    expect(toppingFlavours('White, Milk')).toEqual(['Milk', 'White']);
    expect(toppingFlavours('Dark')).toEqual(['Dark']);
    expect(toppingFlavours(null)).toEqual([]);
  });

  it('whole cake, three flavours — the shop\'s wording', () => {
    expect(toppingCareNote(['Milk', 'Dark', 'White'], 1, 0)).toBe(
      'Your Milk, Dark and White chocolate toppings come in separate pots. Before heating, remove the lids and microwave each pot separately in 15–20 second intervals. Stir well after each interval until the chocolate is smooth and pourable. Once melted, pour the chocolates over your cake and enjoy!'
    );
  });

  it('two flavours on slices', () => {
    expect(toppingCareNote(['Milk', 'White'], 0, 2)).toBe(
      'Your Milk and White chocolate toppings come in separate pots. Before heating, remove the lids and microwave each pot separately in 15–20 second intervals. Stir well after each interval until the chocolate is smooth and pourable. Once melted, pour the chocolates over your cake slices and enjoy!'
    );
  });

  it('one flavour on one slice reads in the singular', () => {
    expect(toppingCareNote(['Dark'], 0, 1)).toBe(
      'Your Dark chocolate topping comes in a separate pot. Before heating, remove the lid and microwave the pot in 15–20 second intervals. Stir well after each interval until the chocolate is smooth and pourable. Once melted, pour the chocolate over your cake slice and enjoy!'
    );
  });

  it('slice toppings and whole-cake toppings are named apart and the note covers both', () => {
    const slip = buildOrderSlip({
      orderNumber: '#9',
      lines: [
        topping('Triple Chocolate for Whole Cake', 'w', 'Milk, Dark'),
        cake('w'),
        topping('Triple Chocolate for Slice', 's', 'White'),
        line({ title: 'Chocolate Cake Slice', properties: [{ name: '_Linked add-on key', value: 's' }], allergens: { variantAllergens: ['Wheat', 'Egg', 'Milk', 'Soy'] } }),
      ],
    });
    expect(slip.items.map((i) => i.title)).toEqual([
      'Chocolate Cake', 'Triple Chocolate for Whole Cake', 'Chocolate Cake Slice', 'Triple Chocolate for Slice',
    ]);
    expect(slip.items[1].details[0]).toBe('Milk and Dark chocolate');
    expect(slip.items[3].details[0]).toBe('White chocolate');
    expect(slip.careNotes).toHaveLength(1);
    expect(slip.careNotes[0]).toMatch(/^Your Milk, Dark and White chocolate toppings/);
    expect(slip.careNotes[0]).toMatch(/over your cake and cake slice and enjoy!$/);
  });

  it('hot chocolate toppings get no cake care note', () => {
    const slip = buildOrderSlip({ orderNumber: '#1122', lines: [topping('Triple Chocolate for Hot Chocolate', 'h', 'Milk, Dark, White', 2)] });
    expect(slip.careNotes).toEqual([]);
  });
});

describe('spreads and care notes', () => {
  it('adds the spreads note exactly, once, only when spreads are ordered', () => {
    const slip = buildOrderSlip({
      orderNumber: '#1110',
      lines: [
        line({ title: 'Gianduja Spread 250g', properties: [{ name: 'Selection', value: 'Spreads Selection of 2 (selection N565)' }], allergens: { variantAllergens: ['Hazelnut'] } }),
        line({ title: 'Dark Chocolate Spread 250g', allergens: { productAllergens: ['Hazelnut'] } }),
      ],
    });
    expect(slip.careNotes).toEqual([SPREADS_NOTE]);
    expect(SPREADS_NOTE).toBe('As the spreads are made using all-natural ingredients, you will likely notice some oil resting on the surface. This is completely normal. Before eating, please stir each spread thoroughly until the spread is smooth and even.');
    expect(slip.items[0].details).toEqual(['Spreads Selection of 2']);
  });

  it('adds no care notes to an order that needs none', () => {
    const slip = buildOrderSlip({ orderNumber: '#1117', lines: [line({ title: 'Chocolate Bar 70g', variantTitle: 'Milk', allergens: { variantAllergens: ['Milk', 'Soy'] } })] });
    expect(slip.careNotes).toEqual([]);
  });
});

describe('what goes on the slip', () => {
  it('copies titles, options and quantities, skips the courier charge and removed items, shows no prices', () => {
    const slip = buildOrderSlip({
      orderNumber: '#1119',
      lines: [
        line({ title: 'Same-day delivery', variantTitle: '£12.95', sku: 'IBC-DEL-1295' }),
        line({ title: 'Big Block', variantTitle: '500g / Milk', quantity: 2, allergens: { variantAllergens: ['Soy', 'Milk'] } }),
        line({ title: 'Vegan Cake', quantity: 0 }),
      ],
    });
    expect(slip.items).toHaveLength(1);
    expect(slip.items[0]).toMatchObject({ title: 'Big Block', quantity: 2, details: ['500g / Milk'] });
    const html = renderSlipHtml(slip);
    expect(html).toContain('Qty 2');
    expect(html).not.toContain('£');
    expect(html).toContain('YOUR ORDER');
    expect(html).toContain('Thank you for your order.');
    expect(html).toContain('italianbearchocolate.com');
    expect(html).toContain('size: 4in 6in');
  });

  it('warns staff when the website has no allergen data for an item', () => {
    const slip = buildOrderSlip({ orderNumber: '#1100', lines: [line({ title: 'Home Coffee Bags', variantTitle: '400g' })] });
    expect(slip.staffWarnings[0]).toMatch(/no allergen information/);
  });
});
