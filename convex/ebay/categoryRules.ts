import { ebayRequest } from "./http";
import type { EbayEnv, ListingCondition } from "./types";

/** eBay US's category tree. */
const CATEGORY_TREE = "0";

export type EbayCategory = { categoryId: string; categoryName: string };

export type RequiredDetail = {
  name: string;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  allowedValues: string[];
};

export type CategoryRules = {
  requiredDetails: RequiredDetail[];
  validConditionIds: number[];
};

/**
 * The generic name is always included: eBay's category finder is text-based,
 * and a brand on its own ("Acer") matches poorly.
 */
export function buildCategoryQuery(facts: {
  brand: string | null;
  model: string | null;
  genericName: string;
}): string {
  return [facts.brand, facts.model, facts.genericName]
    .filter((part): part is string => !!part)
    .join(" ");
}

export function parseCategorySuggestion(payload: unknown): EbayCategory | null {
  const suggestions = (payload as { categorySuggestions?: unknown } | null)?.categorySuggestions;
  if (!Array.isArray(suggestions) || suggestions.length === 0) return null;

  const category = (
    suggestions[0] as { category?: { categoryId?: unknown; categoryName?: unknown } } | null
  )?.category;
  if (typeof category?.categoryId !== "string" || typeof category.categoryName !== "string") {
    return null;
  }
  return { categoryId: category.categoryId, categoryName: category.categoryName };
}

export function parseRequiredDetails(payload: unknown): RequiredDetail[] {
  const aspects = (payload as { aspects?: unknown } | null)?.aspects;
  if (!Array.isArray(aspects)) return [];

  const details: RequiredDetail[] = [];
  for (const aspect of aspects) {
    const record = aspect as {
      localizedAspectName?: unknown;
      aspectConstraint?: { aspectRequired?: unknown; aspectMode?: unknown };
      aspectValues?: unknown;
    } | null;
    if (record === null || typeof record.localizedAspectName !== "string") continue;

    const constraint = record.aspectConstraint;
    if (!constraint || constraint.aspectRequired !== true) continue;

    const restricted = constraint.aspectMode === "SELECTION_ONLY";
    const values = Array.isArray(record.aspectValues)
      ? record.aspectValues.flatMap((value) => {
          const text = (value as { localizedValue?: unknown } | null)?.localizedValue;
          return typeof text === "string" ? [text] : [];
        })
      : [];

    details.push({
      name: record.localizedAspectName,
      mode: restricted ? "SELECTION_ONLY" : "FREE_TEXT",
      allowedValues: restricted ? values : [],
    });
  }
  return details;
}

export function parseConditionIds(payload: unknown): number[] {
  const policies = (payload as { itemConditionPolicies?: unknown } | null)?.itemConditionPolicies;
  if (!Array.isArray(policies)) return [];

  const conditions = (policies[0] as { itemConditions?: unknown } | undefined)?.itemConditions;
  if (!Array.isArray(conditions)) return [];

  return conditions.flatMap((condition) => {
    const raw = (condition as { conditionId?: unknown } | null)?.conditionId;
    const id = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
    return Number.isFinite(id) ? [id] : [];
  });
}

export async function suggestCategory(
  env: EbayEnv,
  appToken: string,
  query: string,
): Promise<EbayCategory | null> {
  const payload = await ebayRequest(
    env,
    appToken,
    "GET",
    `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE}/get_category_suggestions?q=${encodeURIComponent(query)}`,
  );
  return parseCategorySuggestion(payload);
}

export async function getCategoryRules(
  env: EbayEnv,
  appToken: string,
  categoryId: string,
): Promise<CategoryRules> {
  const [aspects, conditions] = await Promise.all([
    ebayRequest(
      env,
      appToken,
      "GET",
      `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    ),
    ebayRequest(
      env,
      appToken,
      "GET",
      `/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=${encodeURIComponent(`categoryIds:{${categoryId}}`)}`,
    ),
  ]);

  return {
    requiredDetails: parseRequiredDetails(aspects),
    validConditionIds: parseConditionIds(conditions),
  };
}

/** eBay's condition IDs for the Inventory API's condition enums. */
const CONDITION_IDS: Record<string, number> = {
  NEW: 1000,
  NEW_OTHER: 1500,
  SELLER_REFURBISHED: 2500,
  LIKE_NEW: 2750,
  USED_EXCELLENT: 3000,
  USED_VERY_GOOD: 4000,
  USED_GOOD: 5000,
  USED_ACCEPTABLE: 6000,
};

/** Best match first; plain "Used" (USED_EXCELLENT) is the widest fallback. */
const PREFERENCES: Record<ListingCondition, string[]> = {
  new: ["NEW", "NEW_OTHER", "USED_EXCELLENT"],
  like_new: ["LIKE_NEW", "NEW_OTHER", "USED_EXCELLENT", "USED_VERY_GOOD"],
  good: ["USED_GOOD", "USED_VERY_GOOD", "USED_EXCELLENT"],
  fair: ["USED_ACCEPTABLE", "USED_GOOD", "USED_EXCELLENT"],
  poor: ["USED_ACCEPTABLE", "USED_GOOD", "USED_EXCELLENT"],
};

export function pickCondition(condition: ListingCondition, validConditionIds: number[]): string {
  const preferences = PREFERENCES[condition];
  return (
    preferences.find((option) => validConditionIds.includes(CONDITION_IDS[option])) ??
    preferences[0]
  );
}
