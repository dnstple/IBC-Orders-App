/**
 * Online sales that came from the visit emails, two ways:
 *  1. Via the email's links: Shopify orders whose visit carried our
 *     utm_campaign (from customerJourneySummary). The strict measure.
 *  2. By emailed guests: orders (synced in this app) from an address we
 *     emailed, placed within 30 days of the email, however they got to the
 *     shop. A broader "influenced" measure.
 * Cancelled and test orders are left out. Read-only.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { shopifyGraphql } from '@/lib/shopify/client';
import type { VisitEmailSettings } from './settings';

const WINDOW_DAYS = 30;

const ORDERS_QUERY = `query VisitEmailSales($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      name
      createdAt
      cancelledAt
      test
      currentTotalPriceSet { shopMoney { amount } }
      customerJourneySummary {
        firstVisit { utmParameters { campaign content } }
        lastVisit { utmParameters { campaign content } }
      }
    }
  }
}`;

type OrdersPage = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      name: string; createdAt: string; cancelledAt: string | null; test: boolean;
      currentTotalPriceSet: { shopMoney: { amount: string } };
      customerJourneySummary: null | {
        firstVisit: null | { utmParameters: null | { campaign: string | null; content: string | null } };
        lastVisit: null | { utmParameters: null | { campaign: string | null; content: string | null } };
      };
    }>;
  };
};

export interface SalesSummary {
  since: string | null;
  viaLink: { orders: number; revenue: number; byLink: Record<string, { orders: number; revenue: number }>; error?: string };
  byGuests: { orders: number; revenue: number; guests: number; windowDays: number; error?: string };
}

const money = (n: number) => Math.round(n * 100) / 100;

export async function salesFromVisitEmails(s: VisitEmailSettings): Promise<SalesSummary> {
  const db = supabaseAdmin();
  const { data: sentRows } = await db.from('visit_emails').select('email, sent_at').eq('state', 'sent').not('sent_at', 'is', null).limit(50000);
  const sent = (sentRows ?? []).filter((r) => r.sent_at);
  const out: SalesSummary = {
    since: null,
    viaLink: { orders: 0, revenue: 0, byLink: {} },
    byGuests: { orders: 0, revenue: 0, guests: 0, windowDays: WINDOW_DAYS },
  };
  if (!sent.length) return out;
  const since = sent.map((r) => r.sent_at as string).sort()[0];
  out.since = since;

  // 1. Via the email's links (UTM on the Shopify visit).
  try {
    let after: string | null = null;
    for (let page = 0; page < 20; page++) {
      const data: OrdersPage = await shopifyGraphql<OrdersPage>(ORDERS_QUERY, { q: `created_at:>='${since}'`, after }, 'visitEmailSales');
      for (const o of data.orders.nodes) {
        if (o.cancelledAt || o.test) continue;
        const j = o.customerJourneySummary;
        const hit = [j?.lastVisit?.utmParameters, j?.firstVisit?.utmParameters].find((u) => u?.campaign === s.utm_campaign);
        if (!hit) continue;
        const amount = Number(o.currentTotalPriceSet.shopMoney.amount) || 0;
        out.viaLink.orders++;
        out.viaLink.revenue += amount;
        const key = (hit.content ?? 'unknown').replace(/-(soho|fitzrovia)$/, '');
        const b = (out.viaLink.byLink[key] ??= { orders: 0, revenue: 0 });
        b.orders++; b.revenue = money(b.revenue + amount);
      }
      if (!data.orders.pageInfo.hasNextPage) break;
      after = data.orders.pageInfo.endCursor;
    }
    out.viaLink.revenue = money(out.viaLink.revenue);
  } catch (e) {
    out.viaLink.error = String((e as Error).message).slice(0, 200);
  }

  // 2. Orders by guests we emailed, within 30 days of their email.
  try {
    const firstSent = new Map<string, number>();
    for (const r of sent) {
      if (!r.email) continue;
      const t = Date.parse(r.sent_at as string);
      if (!firstSent.has(r.email) || t < (firstSent.get(r.email) as number)) firstSent.set(r.email, t);
    }
    const emails = [...firstSent.keys()];
    const buyers = new Set<string>();
    for (let i = 0; i < emails.length; i += 300) {
      const { data: orders } = await db.from('orders')
        .select('customer_email, total, shopify_created_at')
        .in('customer_email', emails.slice(i, i + 300))
        .gte('shopify_created_at', since).is('cancelled_at', null).eq('test', false).limit(5000);
      for (const o of orders ?? []) {
        const e = String(o.customer_email ?? '').toLowerCase();
        const t0 = firstSent.get(e);
        const t = Date.parse(o.shopify_created_at);
        if (t0 === undefined || t < t0 || t > t0 + WINDOW_DAYS * 86_400_000) continue;
        out.byGuests.orders++;
        out.byGuests.revenue += Number(o.total) || 0;
        buyers.add(e);
      }
    }
    out.byGuests.revenue = money(out.byGuests.revenue);
    out.byGuests.guests = buyers.size;
  } catch (e) {
    out.byGuests.error = String((e as Error).message).slice(0, 200);
  }
  return out;
}
