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
