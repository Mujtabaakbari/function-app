// import {
//   DiscountClass,
//   ProductDiscountSelectionStrategy,
// } from '../generated/api';

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

// const VOLUME_DISCOUNT_TIERS = [
//   {
//     minQty: 2,
//     percentage: 10,
//     message: '10% OFF (Buy 2+)',
//   },
//   {
//     minQty: 3,
//     percentage: 15,
//     message: '15% OFF (Buy 5+)',
//   },
//   {
//     minQty: 5,
//     percentage: 20,
//     message: '20% OFF (Buy 5+)',
//   }
// ];

// export function cartLinesDiscountsGenerateRun(input) {
//   if (!input.cart.lines.length) {
//     return { operations: [] };
//   }

//   const hasProductDiscountClass = input.discount.discountClasses.includes(
//     DiscountClass.Product
//   );

//   if (!hasProductDiscountClass) {
//     return { operations: [] };
//   }

//   const operations = [];

//   input.cart.lines.forEach((line) => {
//     // Find best discount tier for this line
//     const tier = [...VOLUME_DISCOUNT_TIERS]
//       .sort((a, b) => b.minQty - a.minQty)
//       .find(t => line.quantity >= t.minQty);

//     if (!tier) return;

//     operations.push({
//       productDiscountsAdd: {
//         candidates: [
//           {
//             message: tier.message,
//             targets: [
//               {
//                 cartLine: {
//                   id: line.id,
//                 },
//               },
//             ],
//             value: {
//               percentage: {
//                 value: tier.percentage,
//               },
//             },
//           },
//         ],
//         selectionStrategy: ProductDiscountSelectionStrategy.First,
//       },
//     });
//   });

//   return { operations };
// }

export function cartLinesDiscountsGenerateRun(input) {
  const config = input.discount.metafield?.jsonValue;
  if (!config) return { operations: [] };

  const operations = [];

  const message =
    typeof config.message === "string"
      ? config.message
      : JSON.stringify(config.message);

  const percentage = Number(config.percentage);
  if (Number.isNaN(percentage)) return { operations: [] };

  if (
    input.cart?.lines &&
    input.discount.discountClasses.includes("PRODUCT") &&
    Array.isArray(config.productIds)
  ) {
    for (const line of input.cart.lines) {
      if (
        line.merchandise.__typename === "ProductVariant" &&
        config.productIds.includes(line.merchandise.product.id)
      ) {
        operations.push({
          productDiscountsAdd: {
            selectionStrategy: "ALL",
            candidates: [
              {
                message, 
                value: {
                  percentage: {
                    value: percentage,
                  },
                },
                targets: [
                  {
                    cartLine: {
                      id: line.id,
                    },
                  },
                ],
              },
            ],
          },
        });
      }
    }
  }

  return { operations };
}
