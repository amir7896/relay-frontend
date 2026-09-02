import { useState, type InputHTMLAttributes } from 'react';

type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
> & {
  label: string;
  error?: string;
};

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12S6.5 5.5 12 5.5 21.5 12 21.5 12 17.5 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3.25 3.25 0 0 0 4.6 4.6" />
      <path d="M9.4 5.7A10.5 10.5 0 0 1 12 5.5C17.5 5.5 21.5 12 21.5 12a18.7 18.7 0 0 1-2.3 3.1" />
      <path d="M6.2 6.2A18.4 18.4 0 0 0 2.5 12S6.5 18.5 12 18.5c1.3 0 2.5-.3 3.6-.7" />
    </svg>
  );
}

export function PasswordInput({
  label,
  id,
  name,
  error,
  className,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputId = id ?? name ?? 'password';
  const errorId = `${inputId}-error`;

  return (
    <label
      className={`password-field${error ? ' field-invalid' : ''}`}
      htmlFor={inputId}
    >
      {label}
      <span className="password-input-wrap">
        <input
          {...props}
          id={inputId}
          name={name}
          type={visible ? 'text' : 'password'}
          className={`password-input${className ? ` ${className}` : ''}${error ? ' input-invalid' : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <button
          className="password-toggle"
          type="button"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </span>
      {error ? (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
