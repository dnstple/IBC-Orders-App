import { shopifyGraphql, assertNoUserErrors, ShopifyUserError } from '@/lib/shopify/client';
import {
  PREPARED_FOR_PICKUP_MUTATION,
  FULFILLMENT_CREATE_MUTATION,
  TAGS_ADD_MUTATION,
  TAGS_REMOVE_MUTATION,
  METAFIELDS_SET_MUTATION,
  SHIPPING_LABEL_PURCHASE_MUTATION,
} from '@/lib/shopify/mutations';
import { LABEL_PURCHASE_RESULT_QUERY } from '@/lib/shopify/queries';
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

/** A label purchase Shopify refused, with its error code when it gave one. */
export class LabelPurchaseError extends Error {
  constructor(public code: string | null, message: string) {
    super(message);
    this.name = 'LabelPurchaseError';
  }
}

/** Start a Shopify Shipping label purchase. Returns the result GID to poll. */
export async function purchaseShippingLabel(input: Record<string, unknown>): Promise<string> {
  const data = await shopifyGraphql<{
    shippingLabelPurchase: {
      shippingLabelPurchaseResult: { id: string; status: string } | null;
      userErrors: Array<{ field?: string[] | null; code?: string | null; message: string }>;
    };
  }>(SHIPPING_LABEL_PURCHASE_MUTATION, { input }, 'shippingLabelPurchase');

  const { userErrors, shippingLabelPurchaseResult } = data.shippingLabelPurchase;
  if (userErrors.length) {
    throw new LabelPurchaseError(userErrors[0].code ?? null, userErrors.map((e) => e.message).join('; '));
  }
  if (!shippingLabelPurchaseResult) throw new Error('shippingLabelPurchase returned no result');
  return shippingLabelPurchaseResult.id;
}

export interface LabelPurchaseResult {
  status: 'PENDING_PURCHASE' | 'PURCHASED' | 'PURCHASE_FAILED';
  error: { code: string | null; message: string } | null;
  label: {
    gid: string;
    tracking: { number: string | null; company: string | null; url: string | null } | null;
    pdfUrl: string | null;
  } | null;
}

/** Read where a label purchase has got to. */
export async function getLabelPurchaseResult(resultGid: string): Promise<LabelPurchaseResult> {
  const data = await shopifyGraphql<{
    node: {
      status: LabelPurchaseResult['status'];
      errors: Array<{ code: string | null; message: string }> | null;
      shippingLabels: Array<{
        id: string;
        trackingInfo: { number: string | null; company: string | null; url: string | null } | null;
        shippingDocuments: Array<{ documentType: string; format: string; url: string }>;
      }> | null;
    } | null;
  }>(LABEL_PURCHASE_RESULT_QUERY, { id: resultGid }, 'shippingLabelPurchaseResult');

  if (!data.node) throw new Error(`Label purchase not found: ${resultGid}`);
  const label = data.node.shippingLabels?.[0];
  const doc = label?.shippingDocuments.find((d) => d.documentType === 'LABEL' && d.format === 'PDF')
    ?? label?.shippingDocuments.find((d) => d.documentType === 'LABEL');
  const err = data.node.errors?.[0];
  return {
    status: data.node.status,
    error: err ? { code: err.code, message: err.message } : null,
    label: label ? { gid: label.id, tracking: label.trackingInfo, pdfUrl: doc?.url ?? null } : null,
  };
}
