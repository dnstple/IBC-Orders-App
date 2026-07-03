export type FulfillmentMethod = 'pickup' | 'local_delivery' | 'shipping' | 'unknown';

export type InternalStatus =
  | 'new'
  | 'acknowledged'
  | 'preparing'
  | 'ready_for_pickup'
  | 'packed'
  | 'courier_booked'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

export const TERMINAL_STATUSES: InternalStatus[] = ['fulfilled', 'cancelled', 'refunded'];

export interface OrderRow {
  id: string;
  shopify_order_id: number;
  shopify_order_gid: string;
  order_number: string;
  shopify_admin_url: string;
  shopify_created_at: string;
  shopify_updated_at: string;
  financial_status: string | null;
  shopify_fulfillment_status: string | null;
  cancelled_at: string | null;
  closed_at: string | null;
  test: boolean;
  fulfillment_method: FulfillmentMethod;
  pickup_location: { name?: string; address?: string } | null;
  delivery_address: Record<string, string | null> | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  note: string | null;
  note_attributes: Array<{ name: string; value: string }>;
  tags: string[];
  discounts: Array<{ code?: string; amount?: string }>;
  currency: string;
  subtotal: number | null;
  shipping_total: number | null;
  tax_total: number | null;
  total: number | null;
  refund_summary: Array<{ id: string; createdAt: string; note?: string | null; amount?: string }>;
  required_fulfilment_at: string | null;
  time_confirmed: boolean;
  date_source: string;
  pickup_slot_id: string | null;
  internal_status: InternalStatus;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  assigned_staff_id: string | null;
  needs_attention: boolean;
  needs_attention_reason: string | null;
  courier_name: string | null;
  courier_booking_ref: string | null;
  courier_tracking_url: string | null;
  synced_at: string;
  updated_at: string;
}

export interface LineItemRow {
  id: string;
  order_id: string;
  shopify_line_item_id: number;
  shopify_line_item_gid: string;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  fulfilled_quantity: number;
  refunded_quantity: number;
  unit_price: number | null;
  image_url: string | null;
  properties: Array<{ name: string; value: string }>;
  requires_shipping: boolean;
}

export interface FulfillmentGroupRow {
  id: string;
  order_id: string;
  shopify_fulfillment_order_gid: string;
  status: string;
  request_status: string | null;
  delivery_method_type: string | null;
  assigned_location: { name?: string } | null;
  fulfill_at: string | null;
  line_items: Array<{
    ffoLineItemGid: string;
    orderLineItemGid: string;
    remainingQuantity: number;
    totalQuantity: number;
  }>;
  supported_actions: string[];
}

export interface OrderEventRow {
  id: string;
  order_id: string;
  actor_id: string | null;
  actor_name: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface StaffProfileRow {
  id: string;
  full_name: string;
  role: 'staff' | 'manager' | 'admin';
  is_active: boolean;
}
