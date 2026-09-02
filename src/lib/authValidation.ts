const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_COMPLEXITY_RE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).+$/;

export type LoginFields = {
  email: string;
  password: string;
};

export type RegisterFields = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
};

export type FieldErrors<T extends string> = Partial<Record<T, string>>;

function trim(value: string): string {
  return value.trim();
}

export function validateEmail(value: string): string | undefined {
  const email = trim(value).toLowerCase();
  if (!email) return 'Email is required';
  if (email.length > 255) return 'Email cannot exceed 255 characters';
  if (!EMAIL_RE.test(email)) return 'Enter a valid email address';
  return undefined;
}

export function validateLoginPassword(value: string): string | undefined {
  if (!value) return 'Password is required';
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value.length > 72) return 'Password cannot exceed 72 characters';
  return undefined;
}

export function validateRegisterPassword(value: string): string | undefined {
  const required = validateLoginPassword(value);
  if (required) return required;
  if (!PASSWORD_COMPLEXITY_RE.test(value)) {
    return 'Use upper, lower, a number, and a symbol';
  }
  return undefined;
}

export function validateName(
  value: string,
  label: 'First name' | 'Last name',
): string | undefined {
  const name = trim(value);
  if (!name) return `${label} is required`;
  if (name.length > 80) return `${label} cannot exceed 80 characters`;
  return undefined;
}

export function validateLogin(
  fields: LoginFields,
): FieldErrors<keyof LoginFields> {
  const errors: FieldErrors<keyof LoginFields> = {};
  const email = validateEmail(fields.email);
  const password = validateLoginPassword(fields.password);
  if (email) errors.email = email;
  if (password) errors.password = password;
  return errors;
}

export function validateRegister(
  fields: RegisterFields,
): FieldErrors<keyof RegisterFields> {
  const errors: FieldErrors<keyof RegisterFields> = {};
  const firstName = validateName(fields.firstName, 'First name');
  const lastName = validateName(fields.lastName, 'Last name');
  const email = validateEmail(fields.email);
  const password = validateRegisterPassword(fields.password);
  if (firstName) errors.firstName = firstName;
  if (lastName) errors.lastName = lastName;
  if (email) errors.email = email;
  if (password) errors.password = password;
  return errors;
}

export function hasFieldErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).some(Boolean);
}
