/**
 * Full order read — the single source-of-truth fetch used after every
 * webhook and manual sync. Reads Fulfillment Orders (not just the Order)
 * because an order can have multiple fulfilment groups/locations.
 */
export const ORDER_FULL_QUERY = /* GraphQL */ `
  query OrderFull($id: ID!) {
    order(id: $id) {
      id
      legacyResourceId
      name
      createdAt
      updatedAt
      cancelledAt
      closedAt
      test
      displayFinancialStatus
      displayFulfillmentStatus
      note
      tags
      email
      phone
      customAttributes { key value }
      customer { displayName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }
      shippingAddress {
        name address1 address2 city province zip country phone
      }
      currencyCode
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      discountCodes
      refunds {
        id
        createdAt
        note
        totalRefundedSet { shopMoney { amount } }
      }
      lineItems(first: 100) {
        nodes {
          id
          title
          variantTitle
          sku
          quantity
          currentQuantity
          unfulfilledQuantity
          requiresShipping
          customAttributes { key value }
          originalUnitPriceSet { shopMoney { amount } }
          image { url(transform: { maxWidth: 200, maxHeight: 200 }) }
        }
      }
      fulfillmentOrders(first: 20) {
        nodes {
          id
          status
          requestStatus
          fulfillAt
          deliveryMethod { methodType }
          assignedLocation {
            name
            address1
            city
            zip
            location { id }
          }
          supportedActions { action }
          lineItems(first: 100) {
            nodes {
              id
              remainingQuantity
              totalQuantity
              lineItem { id }
            }
          }
        }
      }
      fulfillments(first: 20) {
        id
        status
        createdAt
        trackingInfo { number company url }
      }
      events(first: 30, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          createdAt
          message
        }
      }
    }
  }
`;

export const ORDERS_RECENT_QUERY = /* GraphQL */ `
  query OrdersRecent($first: Int!, $query: String, $after: String) {
    orders(first: $first, query: $query, after: $after, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes { id updatedAt }
    }
  }
`;
