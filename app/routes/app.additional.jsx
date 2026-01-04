// import { authenticate } from '../shopify.server';
import {Form, useFetcher} from 'react-router';
import { useState} from 'react';

 
const METAFIELD_NAMESPACE = "volume_discount";
const METAFIELD_KEY = "rules";

export default function AdditionalPage() {
  const [discounts, setDiscounts] = useState([]);
  const [newQuantity, setNewQuantity] = useState("");
  const [newPercentage, setNewPercentage] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newProduct, setNewProduct] = useState(null);

  const getProduct = async () => {
    const selected = await shopify.resourcePicker({type: 'product', multiple: false});
    setNewProduct(selected);
  }
  console.log('Selected Product:', newProduct);

  const handleSave = () => {
    if (!newQuantity || !newPercentage) return;

    const newDiscount = {
      quantity: Number(newQuantity),
      percentage: Number(newPercentage),
      message: newMessage,
      product: newProduct,
    };

    setDiscounts((prev) => [...prev, newDiscount]);
    console.log('object of product => ', newDiscount);
    // Reset fields
    setNewQuantity("");
    setNewPercentage("");
    setNewMessage("");

    const fetcher = useFetcher();

  fetcher.submit({ formData: JSON.stringify([...discounts, newDiscount]) }, { method: 'post', action: '/app/additional' })
  };


  return (
    <s-page heading="Additional page">
      <s-section>
        <Form method="post" data-save-bar>
          <s-query-container>
            <s-stack
              direction="inline"
              gap="base"
              justifyContent="space-between"
            >
              <s-heading>Discount</s-heading>
              <s-box>
                <s-button commandFor="modal">
                  Create New Discount
                </s-button>
              </s-box>
            </s-stack>

            <s-box>
              <s-modal id="modal" heading="Details">
                <s-text-field
                  label="Quantity"
                  type="number"
                  value={newQuantity}
                  onChange={(e) => setNewQuantity(e.target.value)}
                />

                <s-text-field
                  label="Discount (%)"
                  type="number"
                  required
                  value={newPercentage}
                  onChange={(e) => setNewPercentage(e.target.value)}
                />

                <s-text-field
                  label="Message"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                />

                <s-button onClick={getProduct}>choose product</s-button>
                
                <s-button
                  tone="critical"
                  slot="secondary-actions"
                  commandFor="modal"
                  command="--hide"
                >
                  Close
                </s-button>

                <s-button
                  slot="primary-action"
                  variant="primary"
                  onClick={handleSave}
                  commandFor="modal"
                  command="--hide"
                >
                  Save
                </s-button>
              </s-modal>
            </s-box>
          </s-query-container>
        </Form>
      </s-section>

      <s-section slot="aside" heading="Resources">
        <s-unordered-list>
          <s-list-item>
            <s-link
              href="https://shopify.dev/docs/apps/design-guidelines/navigation#app-nav"
              target="_blank"
            >
              App nav best practices
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}


async function createOrUpdateMetafield(admin,formData) {

  const GET_OWNER_ID = `
   query getOwnerID {
      currentAppInstallation {
        id
      }
    }
  `;

  const ownerResponse = await admin.graphql(GET_OWNER_ID);
  const ownerjson = await ownerResponse.json();
  const ownerId = ownerjson.data.currentAppInstallation.id;
  console.log('Owner ID:', ownerId);

  const METAFIELD_MUTATION = `
     mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
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

  const input = {
    metafields:[
      {
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        type: "json",
        ownerId: ownerId,
      }
 
    ]
  }

  const response = await admin.graphql(METAFIELD_MUTATION, {metafields: input.metafields});

  const discount_input = {
    metafields:[
      {
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        type: "json",
        value: JSON.stringify(formData || []),
        ownerId: "gid://shopify/DiscountAutomaticNode/1278889197638",
      }
    ]
  }

  const discountRespone = await admin.graphql(METAFIELD_MUTATION, {metafields: discount_input.metafields});

  const responeJson = await response.json();
  if(responeJson.data.metafieldsSet.userErrors.length){
    throw new Error(responeJson.data.metafieldsSet.userErrors[0].message);
  }

    return responeJson.data.metafieldsSet.metafields;
}


async function getDiscountRules(admin) {
  const GET_OWNER_ID = `
     query getOwnerID {
      currentAppInstallation {
        id
        metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
          key
          value
        }
      }
    }
  ` 

  const ownerResponse = await admin.graphql(GET_OWNER_ID);
  const ownerjson = await ownerResponse.json();

  return ownerjson.data.currentAppInstallation.metafield; 
}
