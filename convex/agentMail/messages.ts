export function listingLiveEmail(input: {
  title: string;
  price: number;
  url: string;
  mode: string;
}): { subject: string; text: string } {
  const demo = input.mode === "mock";

  const subject = demo
    ? `(Demo) Your ${input.title} is listed`
    : `Your ${input.title} is live on eBay`;

  const text = [
    demo
      ? "This is a demo listing — it was simulated and is not on real eBay."
      : "Your listing is live on eBay.",
    "",
    input.title,
    `Price: $${input.price}`,
    input.url,
    "",
    "I'll email you when a buyer makes an offer.",
  ].join("\n");

  return { subject, text };
}

/**
 * Closes the loop the offer email opened. Sent once a sale settles, whether the
 * owner accepted outright or the buyer took their counter.
 *
 * Marks a simulated sale the same way `listingLiveEmail` marks a simulated
 * listing: "sold" is the strongest claim this app makes, so it must not read as
 * real money when nothing was sold.
 */
export function listingSoldEmail(input: {
  title: string;
  price: number;
  /** True when the buyer took the owner's counter rather than the owner accepting. */
  viaCounter: boolean;
  mode: string;
}): { subject: string; text: string } {
  const demo = input.mode === "mock";

  const subject = demo
    ? `(Demo) Your ${input.title} sold for $${input.price}`
    : `Your ${input.title} sold for $${input.price}`;

  const text = [
    demo ? "This is a demo sale — it was simulated and nothing was really sold." : null,
    demo ? "" : null,
    input.viaCounter
      ? "The buyer accepted your counter — it's sold."
      : "You accepted the offer — it's sold.",
    "",
    input.title,
    `Sold for: $${input.price}`,
    "",
    "Nothing else to do here; the marketplace takes it from here.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return { subject, text };
}
