/**
 * Guard: demo/seed orders must never reach Shopify.
 * Seeded orders use IDs in the reserved 900000000000–900000000999 range
 * plus a 'demo' tag. Real Shopify order IDs are ~8e12, far outside this
 * range — an open-ended >= check would (and once did) swallow real orders.
 * A real order tagged 'demo' in Shopify is a practice order: the app never
 * writes to Shopify for it and prints a placeholder label instead.
 * Pure (no server imports) so the UI can show practice mode too.
 */
export function isDemoOrder(order: { shopify_order_id: number; tags: string[] }): boolean {
  const inSeedRange = order.shopify_order_id >= 900000000000 && order.shopify_order_id < 900000001000;
  return inSeedRange || order.tags.includes('demo');
}
