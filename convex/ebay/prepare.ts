import {
  buildCategoryQuery,
  getCategoryRules,
  pickCondition,
  suggestCategory,
} from "./categoryRules";
import { fillItemDetails, type ItemFacts } from "./itemDetails";
import { EbayError, type EbayEnv, type ListingCondition } from "./types";

export type ListingSpec = {
  categoryId: string;
  categoryName: string;
  ebayCondition: string;
  aspects: Record<string, string[]>;
};

/** Everything eBay needs to know about the item itself, resolved at publish time. */
export async function resolveListingSpec(input: {
  env: EbayEnv;
  appToken: string;
  openaiApiKey: string;
  model?: string;
  facts: ItemFacts;
  title: string;
  description: string;
  condition: ListingCondition;
}): Promise<ListingSpec> {
  const query = buildCategoryQuery(input.facts);
  const category =
    (await suggestCategory(input.env, input.appToken, query)) ??
    (await suggestCategory(input.env, input.appToken, input.title));
  if (category === null) {
    throw new EbayError(`Couldn't find an eBay category for "${query}".`);
  }

  const rules = await getCategoryRules(input.env, input.appToken, category.categoryId);
  const aspects = await fillItemDetails({
    apiKey: input.openaiApiKey,
    model: input.model,
    required: rules.requiredDetails,
    facts: input.facts,
    title: input.title,
    description: input.description,
  });

  return {
    categoryId: category.categoryId,
    categoryName: category.categoryName,
    ebayCondition: pickCondition(input.condition, rules.validConditionIds),
    aspects,
  };
}
