import { useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query {
      discountNodes(first: 50) {
        nodes {
          id
          discount {
            ... on DiscountAutomaticApp {
              title
              status
              metafield(
                namespace: "custom"
                key: "function-configuration"
              ) {
                value
              }
            }
          }
        }
      }
    }`,
  );

  const result = await response.json();

  const discounts = result.data.discountNodes.nodes
    .filter((n) => n.discount)
    .map((n) => {
      const config = n.discount.metafield
        ? JSON.parse(n.discount.metafield.value)
        : null;

      return {
        id: n.id,
        title: n.discount.title,
        status: n.discount.status,
        ...config,
      };
    });

  return { discounts };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const quantity = formData.get("quantity")?.trim();
  const percentage = Number(formData.get("percentage"));
  const message = formData.get("message")?.trim();

  const productRaw = formData.get("product");
  const products = productRaw ? JSON.parse(productRaw) : [];
  const productIds = products.map((p) => p.id);

  console.log(
    "all data from the comes: =>",
    quantity,
    percentage,
    message,
    productIds,
  );

  const metafieldConfig = {
    quantity,
    percentage,
    message,
    productIds,
  };

  console.log("all data belongs to the metafields are here.", metafieldConfig);

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
          title: `discount id ${Date.now()}`,
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
    },
  );

  const result = await response.json();

  const errors = result?.data?.discountAutomaticAppCreate?.userErrors ?? [];

  if (errors.length) {
    throw new Error(errors[0].message);
  }

  return { ok: true };
};

export default function AdditionalPage() {
  const fetcher = useFetcher();

  const { discounts } = useLoaderData();
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
      },
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

        <s-table>
          <s-table-header>
            <s-table-header-cell>Title</s-table-header-cell>
            <s-table-header-cell>Quantity</s-table-header-cell>
            <s-table-header-cell>Discount (%)</s-table-header-cell>
            <s-table-header-cell>Message</s-table-header-cell>
            <s-table-header-cell>Actions</s-table-header-cell>
          </s-table-header>
          <s-table-body>
            {discounts.map((d) => (
              <s-table-row key={d.id}>
                <s-table-cell>{d.title}</s-table-cell>
                <s-table-cell>{d.quantity}</s-table-cell>
                <s-table-cell>{d.percentage}</s-table-cell>
                <s-table-cell>{d.message}</s-table-cell>
                <s-table-cell>
                  <s-stack direction="inline" gap="200">
                    <s-button onClick={() => handleEdit(d)}>Edit</s-button>
                    <s-button destructive onClick={() => handleDelete(d.id)}>
                      Delete
                    </s-button>
                  </s-stack>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}
