const E164Regex = /^\+[1-9]\d{1,14}$/;

/** Returns true if the given string is a valid E.164 international phone number. */
export const isPhoneE164 = (phone: string): boolean => E164Regex.test(phone);
