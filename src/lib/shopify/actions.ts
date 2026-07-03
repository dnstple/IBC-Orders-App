import { shopifyGraphql, assertNoUserErrors, ShopifyUserError } from '@/lib/shopify/client';
import {
  PREPARED_FOR_PICKUP_MUTATION,
  FULFILLMENT_CREATE_MUTATION,
  TAGS_ADD_MUTATION,
  TAGS_REMOVE_MUTATION,
  METAFIELDS_SET_MUTATION,
} from '@/lib/shopify/mutations';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Shopify write actions. Callers only advance internal state AFTER these
 * resolve without throwing. Failures are recorded in shopify_write_errors
 * for the admin retry log — no silent failures.
 */

export async function logWriteError(params: {
  orderId?: string;
  action: string;
  request: Record<string, unknown>;
  error: unknown;
  actorId?: string;
}): Promise<void> {
  const userErrors = params.error instanceof ShopifyUserError ? params.error.userErrors : null;
  try {
    await supabaseAdmin().from('shopify_write_errors').insert({
      order_id: params.orderId ?? null,
      action: params.action,
      request: params.request,
      user_errors: userErrors ?? { message: params.error instanceof Error ? params.error.message : String(params.error) },
      actor_id: params.actorId ?? null,
    });
  } catch (e) {
    console.error('[write-error-log] failed', e);
  }
}

interface UserErrorsPayload { userErrors: Array<{ field?: string[] | null; message: string }> }

/** Mark local-pickup fulfillment orders ready — Shopify notifies the customer. */
export async function markReadyForPickup(fulfillmentOrderGids: string[]): Promise<void> {
  const data = await shopifyGraphql<{ fulfillmentOrderLineItemsPreparedForPickup: UserErrorsPayload }>(
    PREPARED_FOR_PICKUP_MUTATION,
    { input: { lineItemsByFulfillmentOrder: fulfillmentOrderGids.map((id) => ({ fulfillmentOrderId: id })) } },
    'fulfillmentOrderLineItemsPreparedForPickup'
  );
  assertNoUserErrors(data.fulfillmentOrderLineItemsPreparedForPickup, 'fulfillmentOrderLineItemsPreparedForPickup');
}

export interface FulfillmentLineSelection {
  fulfillmentOrderGid: string;
  /** Omit for "fulfil everything remaining in this fulfillment order". */
  lines?: Array<{ ffoLineItemGid: string; quantity: number }>;
}

export interface TrackingDetails {
  number?: string;
  company?: string;
  url?: string;
}

/** Create a fulfilment (full or partial) against Fulfillment Orders. */
export async function createFulfillment(
  selections: FulfillmentLineSelection[],
  opts: { notifyCustomer: boolean; tracking?: TrackingDetails }
): Promise<{ fulfillmentGid: string; status: string }> {
  const fulfillment: Record<string, unknown> = {
    notifyCustomer: opts.notifyCustomer,
    lineItemsByFulfillmentOrder: selections.map((s) => ({
      fulfillmentOrderId: s.fulfillmentOrderGid,
      ...(s.lines?.length
        ? { fulfillmentOrderLineItems: s.lines.map((l) => ({ id: l.ffoLineItemGid, quantity: l.quantity })) }
        : {}),
    })),
  };
  if (opts.tracking && (opts.tracking.number || opts.tracking.company || opts.tracking.url)) {
    fulfillment.trackingInfo = {
      number: opts.tracking.number || undefined,
      company: opts.tracking.company || undefined,
      url: opts.tracking.url || undefined,
    };
  }

  const data = await shopifyGraphql<{
    fulfillmentCreate: UserErrorsPayload & { fulfillment: { id: string; status: string } | null };
  }>(FULFILLMENT_CREATE_MUTATION, { fulfillment }, 'fulfillmentCreate');

  assertNoUserErrors(data.fulfillmentCreate, 'fulfillmentCreate');
  if (!data.fulfillmentCreate.fulfillment) throw new Error('fulfillmentCreate returned no fulfillment');
  return {
    fulfillmentGid: data.fulfillmentCreate.fulfillment.id,
    status: data.fulfillmentCreate.fulfillment.status,
  };
}

const IB_STATUS_TAGS = ['ib_status:preparing', 'ib_status:packed', 'ib_status:courier_booked', 'ib_status:ready'];

/** Mirror an internal status to Shopify as tag + metafield (visible in admin, never a fulfilment claim). Best-effort. */
export async function mirrorStatusToShopify(orderGid: string, status: string): Promise<void> {
  const remove = await shopifyGraphql<{ tagsRemove: { userErrors: Array<{ message: string }> } }>(
    TAGS_REMOVE_MUTATION, { id: orderGid, tags: IB_STATUS_TAGS }, 'tagsRemove'
  );
  assertNoUserErrors(remove.tagsRemove, 'tagsRemove');

  const tag = status === 'ready_for_pickup' ? 'ib_status:ready' : `ib_status:${status}`;
  const add = await shopifyGraphql<{ tagsAdd: { userErrors: Array<{ message: string }> } }>(
    TAGS_ADD_MUTATION, { id: orderGid, tags: [tag] }, 'tagsAdd'
  );
  assertNoUserErrors(add.tagsAdd, 'tagsAdd');

  const mf = await shopifyGraphql<{ metafieldsSet: UserErrorsPayload }>(
    METAFIELDS_SET_MUTATION,
    {
      metafields: [{
        ownerId: orderGid,
        namespace: 'italian_bear',
        key: 'ib_status',
        type: 'single_line_text_field',
        value: status,
      }],
    },
    'metafieldsSet'
  );
  assertNoUserErrors(mf.metafieldsSet, 'metafieldsSet');
}

/** Store courier booking details on the order as a metafield. */
export async function writeCourierMetafield(
  orderGid: string,
  courier: { name?: string; bookingRef?: string; trackingUrl?: string }
): Promise<void> {
  const data = await shopifyGraphql<{ metafieldsSet: UserErrorsPayload }>(
    METAFIELDS_SET_MUTATION,
    {
      metafields: [{
        ownerId: orderGid,
        namespace: 'italian_bear',
        key: 'courier_details',
        type: 'json',
        value: JSON.stringify(courier),
      }],
    },
    'metafieldsSet'
  );
  assertNoUserErrors(data.metafieldsSet, 'metafieldsSet');
}
