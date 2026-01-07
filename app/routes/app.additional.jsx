import { useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const res = await admin.graphql(`
    #graphql
    query {
      shop {
        metafield(namespace: "custom", key: "discount_config") {
          value
        }
      }
    }
  `);

  const json = await res.json();
  const rawValue = json?.data?.shop?.metafield?.value;

  let discountConfig = [];

  if (rawValue) {
    try {
      const parsed = JSON.parse(rawValue);
      if (Array.isArray(parsed)) {
        discountConfig = parsed;
      }
    } catch (err) {
      console.error("Failed to parse discount_config metafield:", err);
    }
  }

  return { discountConfig };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const intent = formData.get("intent"); // create | update | delete

  const quantity = formData.get("quantity")?.trim();
  const percentage = Number(formData.get("percentage"));
  const message = formData.get("message")?.trim();
  const localId = Number(formData.get("localId")); // shop metafield id
  const discountId = formData.get("discountId"); // Shopify ID

  const productRaw = formData.get("product");
  const products = productRaw ? JSON.parse(productRaw) : [];
  const productIds = products.map((p) => p.id);

  const metafieldConfig = {
    quantity,
    percentage,
    message,
    productIds,
  };

  /* ===========================
     CREATE
  ============================ */
  if (intent === "create") {
    const response = await admin.graphql(
      `#graphql
      mutation CreateDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
          automaticAppDiscount {
            discountId
          }
          userErrors {
            message
          }
        }
      }`,
      {
        variables: {
          automaticAppDiscount: {
            title: `Discount ${Date.now()}`,
            functionHandle: "discount-function",
            startsAt: new Date().toISOString(),
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

    const json = await response.json();
    const errors = json?.data?.discountAutomaticAppCreate?.userErrors ?? [];
    if (errors.length) throw new Error(errors[0].message);

    const createdDiscountId =
      json.data.discountAutomaticAppCreate.automaticAppDiscount.discountId;

    await saveMetafield({
      admin,
      discount: {
        id: Date.now(),
        discountId: createdDiscountId,
        ...metafieldConfig,
      },
    });

    return { ok: true };
  }


  /* ===========================
     UPDATE
  ============================ */

  if (intent === "update") {
  // 1️⃣ Update the discount itself
  const response = await admin.graphql(
    `#graphql
    mutation UpdateDiscountAutomaticApp(
      $id: ID!
      $automaticAppDiscount: DiscountAutomaticAppInput!
    ) {
      discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    {
      variables: {
        id: discountId,
        automaticAppDiscount: {
          title: metafieldConfig.title || `Discount ${Date.now()}`,
          functionHandle: "discount-function",
          // add startsAt / endsAt / combinesWith only if you are changing them
        },
      },
    }
  );

  const json = await response.json();

  var updateErrors = [];
  if (
    json &&
    json.data &&
    json.data.discountAutomaticAppUpdate &&
    json.data.discountAutomaticAppUpdate.userErrors
  ) {
    updateErrors = json.data.discountAutomaticAppUpdate.userErrors;
  }

  if (updateErrors.length > 0) {
    throw new Error(updateErrors.map(function (e) {
      return e.message;
    }).join(", "));
  }

  // 2️⃣ Upsert the function configuration metafield on the discount
  const metaResponse = await admin.graphql(
    `#graphql
    mutation SetDiscountFunctionConfigurationMetafield($ownerId: ID!, $value: String!) {
      metafieldsSet(metafields: [
        {
          ownerId: $ownerId
          namespace: "custom"
          key: "function-configuration"
          type: "json"
          value: $value
        }
      ]) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    {
      variables: {
        ownerId: discountId, // DiscountAutomaticNode ID
        value: JSON.stringify(metafieldConfig),
      },
    }
  );

  const metaJson = await metaResponse.json();

  var metaErrors = [];
  if (
    metaJson &&
    metaJson.data &&
    metaJson.data.metafieldsSet &&
    metaJson.data.metafieldsSet.userErrors
  ) {
    metaErrors = metaJson.data.metafieldsSet.userErrors;
  }

  if (metaErrors.length > 0) {
    throw new Error(metaErrors.map(function (e) {
      return e.message;
    }).join(", "));
  }

  // await updateShopMetafield(admin, localId, {
  //   discountId: discountId,
  //   ...metafieldConfig,
  // });

  const shopId = await getShopId(admin);
const discounts = await getShopDiscounts(admin);

const updatedDiscounts = discounts.map((d) => {
  if (d.id === localId) {
    return {
      ...d,
      discountId: discountId, // keep Shopify discount ID
      ...metafieldConfig,     // updated fields
    };
  }
  return d;
});

await setShopDiscounts(admin, shopId, updatedDiscounts);


  return { ok: true };
}



  /* ===========================
     DELETE
  ============================ */
  if (intent === "delete") {
    // 1️⃣ Delete discount
    await admin.graphql(
      `#graphql
      mutation DeleteDiscount($id: ID!) {
        discountAutomaticDelete(id: $id) {
          deletedAutomaticDiscountId
          userErrors { message }
        }
      }
    `,
      { variables: { id: discountId } }
    );

    // 2️⃣ Remove from shop metafield
    await deleteShopMetafield(admin, localId);

    return { ok: true };
  }

  throw new Error("Invalid intent");
};



export default function AdditionalPage() {
  const fetcher = useFetcher();
  const { discountConfig } = useLoaderData();

  // CREATE
  const [quantity, setQuantity] = useState("");
  const [percentage, setPercentage] = useState("");
  const [message, setMessage] = useState("");
  const [products, setProducts] = useState([]);

  // EDIT / DELETE
  const [selectedDiscount, setSelectedDiscount] = useState(null);
  const [editQuantity, setEditQuantity] = useState("");
  const [editPercentage, setEditPercentage] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editProducts, setEditProducts] = useState([]);

  const getProduct = async (setter) => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });
    setter(selected);
  };

  const handleSave = () => {
    fetcher.submit(
      {
        intent: "create",
        quantity,
        percentage,
        message,
        product: JSON.stringify(products),
      },
      { method: "post" }
    );
  };

  return (
    <s-page heading="Additional page">
      {/* CREATE */}
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

            <s-button onClick={() => getProduct(setProducts)}>
              Choose product
            </s-button>

            <s-button
              slot="primary-action"
              variant="primary"
              loading={fetcher.state !== "idle"}
              onClick={handleSave}
              commandFor="modal"
              command="--hide"
            >
              Save
            </s-button>
          </s-modal>
        </s-query-container>
      </s-section>

      {/* TABLE */}
      <s-section>
        <s-table>
          <s-table-header-row>
            <s-table-header>Quantity</s-table-header>
            <s-table-header>Percentage</s-table-header>
            <s-table-header>Message</s-table-header>
            <s-table-header>Action</s-table-header>
          </s-table-header-row>

          <s-table-body>
            {discountConfig.length ? (
              discountConfig.map((item) => (
                <s-table-row key={item.id}>
                  <s-table-cell>{item.quantity}</s-table-cell>
                  <s-table-cell>{item.percentage}%</s-table-cell>
                  <s-table-cell>{item.message}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="200">
                      {/* EDIT */}
                 <s-button
                    size="slim"
                    icon="edit"
                    commandFor="edit"
                    onClick={() => {
                      setSelectedDiscount(item);

                      // populate edit fields
                      setEditQuantity(item.quantity);
                      setEditPercentage(item.percentage);
                      setEditMessage(item.message);
                      setEditProducts(item.productIds || []);

                      shopify.modal.open("edit");
                    }}
                  />


                      {/* DELETE */}
                      <s-button
                        size="slim"
                        tone="critical"
                        icon="delete"
                        commandFor="delete"
                      onClick={() => {
                        setSelectedDiscount(item);
                        shopify.modal.open("delete");
                      }}

                      />
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))
            ) : (
              <s-table-row>
                <s-table-cell colSpan="4">
                  No discount configured
                </s-table-cell>
              </s-table-row>
            )}
          </s-table-body>
        </s-table>
      </s-section>

      {/* EDIT MODAL */}
      <s-modal id="edit" heading="Edit Discount">
        <s-text-field
          label="Quantity"
          type="number"
          value={editQuantity}
          onChange={(e) => setEditQuantity(e.target.value)}
        />

        <s-text-field
          label="Percentage"
          type="number"
          value={editPercentage}
          onChange={(e) => setEditPercentage(e.target.value)}
        />

        <s-text-field
          label="Message"
          value={editMessage}
          onChange={(e) => setEditMessage(e.target.value)}
        />

        <s-button onClick={() => getProduct(setEditProducts)}>
          Edit product
        </s-button>

        <s-button
          slot="secondary-actions"
          commandFor="edit"
          command="--hide"
        >
          Close
        </s-button>

        <s-button
          slot="primary-action"
          variant="primary"
          loading={fetcher.state !== "idle"}
          onClick={() => {
            fetcher.submit(
              {
                intent: "update",
                localId: selectedDiscount.id,
                discountId: selectedDiscount.discountId,
                quantity: editQuantity,
                percentage: editPercentage,
                message: editMessage,
                product: JSON.stringify(editProducts),
              },
              { method: "post" }
            );
          }}
          commandFor="edit"
          command="--hide"
        >
          Save
        </s-button>
      </s-modal>

      {/* DELETE MODAL */}
      <s-modal id="delete" heading="Delete Discount">
        <s-paragraph>
          Are you sure you want to delete this discount?
        </s-paragraph>

        <s-button
          slot="secondary-actions"
          commandFor="delete"
          command="--hide"
        >
          Close
        </s-button>

        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={fetcher.state !== "idle"}
          onClick={() => {
            fetcher.submit(
              {
                intent: "delete",
                localId: selectedDiscount.id,
                discountId: selectedDiscount.discountId,
              },
              { method: "post" }
            );
          }}
          commandFor="delete"
          command="--hide"
        >
          Delete
        </s-button>
      </s-modal>
    </s-page>
  );
}


async function getShopDiscounts(admin) {
  const res = await admin.graphql(`
    { shop { metafield(namespace: "custom", key: "discount_config") { value } } }
  `);
  const raw = (await res.json()).data.shop.metafield?.value;
  return raw ? JSON.parse(raw) : [];
}



async function saveMetafield({ admin, discount }) {
  const shopId = await getShopId(admin);

  const existing = await getShopDiscounts(admin);
  existing.push(discount);

  await setShopDiscounts(admin, shopId, existing);
}



async function deleteShopMetafield(admin, localId) {
  const shopId = await getShopId(admin);
  const discounts = await getShopDiscounts(admin);

  const filtered = discounts.filter(d => d.id !== localId);
  await setShopDiscounts(admin, shopId, filtered);
}


async function getShopId(admin) {
  const res = await admin.graphql(`{ shop { id } }`);
  return (await res.json()).data.shop.id;
}


async function setShopDiscounts(admin, shopId, discounts) {
  await admin.graphql(
    `#graphql
    mutation Set($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { message }
      }
    }
  `,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: "custom",
            key: "discount_config",
            type: "json",
            value: JSON.stringify(discounts),
          },
        ],
      },
    }
  );

}


async function updateShopMetafield(admin, localId, data) {
  const value = JSON.stringify(data);

  const response = await admin.graphql(
    `#graphql
    mutation SetShopMetafield($value: String!) {
      metafieldsSet(metafields: [
        {
          ownerId: "gid://shopify/Shop/76785385700"
          namespace: "your_app"
          key: "discounts"
          type: "json"
          value: $value
        }
      ]) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    { variables: { value: value } }
  );

  const json = await response.json();

  var errors = [];
  if (
    json &&
    json.data &&
    json.data.metafieldsSet &&
    json.data.metafieldsSet.userErrors
  ) {
    errors = json.data.metafieldsSet.userErrors;
  }

  if (errors.length > 0) {
    throw new Error(
      errors.map(function (e) {
        return e.message;
      }).join(", ")
    );
  }
}
