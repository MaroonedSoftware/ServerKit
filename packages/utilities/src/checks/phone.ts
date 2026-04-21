const E164Regex = /^\+[1-9]\d{1,14}$/;

export const isPhoneE164 = (phone: string): boolean => E164Regex.test(phone);
