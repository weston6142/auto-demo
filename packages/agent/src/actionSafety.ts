const DESTRUCTIVE_ACTION =
  /\b(delete|destroy|erase|wipe|remove|clear all|save|create|register|sign up|purchase|buy|pay|checkout|submit|confirm|send|publish|post|deploy|invite|transfer|approve|merge|enable|disable|revoke|archive|restore|upload|commit|cancel account|close account)\b/i;

const CREDENTIAL_KEY =
  /(^|[-_.])(auth|authorization|token|api[-_]?key|key|secret|password|passcode|credential|signature|sig|code)($|[-_.])/i;

export function hasDestructiveActionLanguage(value: string): boolean {
  return DESTRUCTIVE_ACTION.test(value);
}

export function normalizeHttpOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username !== "" || url.password !== "") {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function hasCredentialLikeUrlData(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }

  let rawFragment: string;
  try {
    rawFragment = decodeURIComponent(url.hash.replace(/^#/, ""));
  } catch {
    return true;
  }
  if (rawFragment.length > 0 && !rawFragment.includes("=") && isSecretLikeValue(rawFragment)) {
    return true;
  }

  const parameterSets = [url.searchParams];
  if (url.hash.includes("=")) {
    parameterSets.push(new URLSearchParams(url.hash.replace(/^#/, "")));
  }
  return parameterSets.some((parameters) =>
    Array.from(parameters).some(
      ([key, parameterValue]) => CREDENTIAL_KEY.test(key) || isSecretLikeValue(parameterValue),
    ),
  );
}

export function isSecretLikeValue(value: string): boolean {
  if (/^sk-[a-z0-9_-]{8,}$/i.test(value)) {
    return true;
  }
  if (/^[a-z0-9_-]{8,}\.[a-z0-9_-]{4,}\.[a-z0-9_-]{4,}$/i.test(value)) {
    return true;
  }
  return value.length >= 24 && /[a-z]/i.test(value) && /\d/.test(value);
}
