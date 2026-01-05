
import {useFetcher} from 'react-router';
import { useState} from 'react';
import { authenticate } from '../shopify.server';

export const loader = async ({request}) => {
   await authenticate.admin(request);
}

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const quantity = formData.get("quantity")?.trim();
  const percentage = Number(formData.get("percentage"));
  const message = formData.get("message")?.trim();

  const productRaw = formData.get("product");
  const products = productRaw ? JSON.parse(productRaw) : [];
  const productIds = products.map(p => p.id);

console.log("all data from the comes: =>",quantity, percentage, message, productIds);

  const metafieldConfig = {
    quantity,
    percentage,
    message,
    productIds,
  };

  console.log("all data belongs to the metafields are here.",metafieldConfig)

  const response = await admin.graphql(
    `#graphql
    mutation discountAutomaticAppCreate(
      $automaticAppDiscount: DiscountAutomaticAppInput!
    ) {
      discountAutomaticAppCreate(
        automaticAppDiscount: $automaticAppDiscount
      ) {
        userErrors {
          field
          message
        }
        automaticAppDiscount {
          discountId
          title
          status
        }
      }
    }`,
    {
      variables: {
        automaticAppDiscount: {
          title:`discount id ${Date.now()}`,
          functionHandle: "discount-function",
          startsAt: new Date().toISOString(),

          // 🔑 THIS decides discountClasses
          combinesWith: {
            productDiscounts: true,
            orderDiscounts: false,
            shippingDiscounts: false,
          },

          metafields: [
            {
              namespace: "custom",
              key: "function-configuration",
              type: "json",
              value: JSON.stringify(metafieldConfig),
            },
          ],
        },
      },
    }
  );

  const result = await response.json();


  const errors =
    result?.data?.discountAutomaticAppCreate?.userErrors ?? [];

  if (errors.length) {
    throw new Error(errors[0].message);
  }

  return { ok: true };
};

export default function AdditionalPage() {
  const fetcher = useFetcher();

  const [quantity, setQuantity] = useState("");
  const [percentage, setPercentage] = useState("");
  const [message, setMessage] = useState("");
  const [products, setProducts] = useState([]);
  


  const getProduct = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });
    setProducts(selected);
  };

  const handleSave = () => {
    fetcher.submit(
      {
        quantity,
        percentage,
        message,
        product: JSON.stringify(products),
      },
      {
        method: "post",
        action: "/app/additional",
      }
    );
  };

  return (
    <s-page heading="Additional page">
      
      <s-section>
        <s-query-container>
          <s-stack direction="inline" justifyContent="space-between">
            <s-heading>Discount</s-heading>
            <s-button commandFor="modal">Create New Discount</s-button>
          </s-stack>

          <s-modal id="modal" heading="Details">
            <s-text-field
              label="Quantity"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />

            <s-text-field
              label="Discount (%)"
              type="number"
              value={percentage}
              onChange={(e) => setPercentage(e.target.value)}
            />

            <s-text-field
              label="Message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />

            <s-button onClick={getProduct}>Choose product</s-button>

            <s-button
              slot="primary-action"
              variant="primary"
              onClick={handleSave}
              commandFor="modal"
              command="--hide"
              loading={fetcher.state !== "idle"}
            >
              Save
            </s-button>
          </s-modal>
        </s-query-container>
      </s-section>
   
    </s-page>
  );
}

 
async function saveMetafield(formData, admin) {
  const quantity = formData.get("quantity")?.trim();
  const percentage = Number(formData.get("percentage"));
  const message = formData.get("message")?.trim();

  const productRaw = formData.get("product");
  const products = productRaw ? JSON.parse(productRaw) : [];
  const productIds = products.map(p => p.id);

  const metafieldValue = {
    quantity,
    percentage,
    message,
    productIds,
  };

  // 🔑 Save on SHOP (best for global config)
  const SHOP_ID_QUERY = `
    #graphql
    query {
      shop {
        id
      }
    }
  `;

  const shopRes = await admin.graphql(SHOP_ID_QUERY);
  const shopJson = await shopRes.json();
  const shopId = shopJson.data.shop.id;

  const METAFIELD_SET = `
    #graphql
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const response = await admin.graphql(METAFIELD_SET, {
    variables: {
      metafields: [
        {
          ownerId: shopId,
          namespace: "custom",
          key: "discount_config",
          type: "json",
          value: JSON.stringify(metafieldValue),
        },
      ],
    },
  });

  const result = await response.json();

  const errors = result?.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors[0].message);
  }

  return result.data.metafieldsSet.metafields[0];
}

