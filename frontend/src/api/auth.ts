export type AuthResult = {
  access_token: string;
  token_type: "bearer";
  user: { id: number; email: string; username?: string; name?: string | null };
};

export type VerifyResult = {
  ok: boolean;
  message: string;
};

async function parseApiError(res: Response, fallback: string): Promise<Error> {
  const data = await res.json().catch(() => null);
  const detail = data?.detail || fallback;
  return new Error(detail);
}

export async function requestLoginCode(email: string): Promise<void> {
  const res = await fetch("/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw await parseApiError(res, "Код суроодо ката кетти.");
}

export async function verifyLoginCode(email: string, code: string, name?: string): Promise<VerifyResult> {
  const res = await fetch("/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code, name }),
  });
  if (!res.ok) throw await parseApiError(res, "Кодду текшерүүдө ката кетти.");
  return res.json();
}

export async function verifyRegistrationCode(email: string, code: string): Promise<VerifyResult> {
  const res = await fetch("/auth/verify-registration", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) throw await parseApiError(res, "Каттоо кодун текшерүүдө ката кетти.");
  return res.json();
}

export async function register(username: string, email: string, password: string): Promise<{message: string}> {
  if (!password || password.length > 72) {
    throw new Error("Сырсөздүн узундугу 8ден 72 символго чейин болушу керек.");
  }

  const res = await fetch("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(errorData.detail || "Каттоо учурунда ката кетти.");
  }
  return res.json();
}
export async function login(identifier: string, password: string): Promise<AuthResult> {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) throw await parseApiError(res, "Кирүү учурунда ката кетти.");
  return res.json();
}

