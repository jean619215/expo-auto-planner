// Shared email/password rules. Kept aligned with the backend route handlers
// (src/app/api/auth/register/route.ts) so client-side checks never diverge
// from what the server enforces.
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 6;
export const NICKNAME_MAX_LENGTH = 50;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

export function isValidNickname(value: string): boolean {
  return [...value].length <= NICKNAME_MAX_LENGTH;
}
