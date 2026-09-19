const POSTAL_CODE = /^\d{5}(-\d{4})?$/;

export function isValidPostalCode(value: string): boolean {
  return POSTAL_CODE.test(value.trim());
}

export function locationKeyFor(postalCode: string): string {
  return `roomsale-${postalCode.trim().slice(0, 5)}`;
}
