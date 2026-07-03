/**
 * Shopify write operations. Every mutation returns userErrors which MUST be
 * checked via assertNoUserErrors — an internal status is only advanced after
 * Shopify confirms success.
 */

/** Marks local-pickup fulfillment order line items ready; Shopify sends the
 *  "Ready for pickup" customer notification automatically. */
export const PREPARED_FOR_PICKUP_MUTATION = /* GraphQL */ `
  mutation ReadyForPickup($input: FulfillmentOrderLineItemsPreparedForPickupInput!) {
    fulfillmentOrderLineItemsPreparedForPickup(input: $input) {
      userErrors { field message }
    }
  }
`;

/** Official fulfilment creation against Fulfillment Orders — supports full
 *  and partial quantities, optional tracking, and customer notification. */
export const FULFILLMENT_CREATE_MUTATION = /* GraphQL */ `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
        createdAt
        trackingInfo { number company url }
      }
      userErrors { field message }
    }
  }
`;

export const TAGS_ADD_MUTATION = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { message }
    }
  }
`;

export const TAGS_REMOVE_MUTATION = /* GraphQL */ `
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors { message }
    }
  }
`;

/** Internal operational status mirrored to a Shopify metafield (ib.status)
 *  so it is visible from the Shopify admin — never a fulfilment claim. */
export const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;
