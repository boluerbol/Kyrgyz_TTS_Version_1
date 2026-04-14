export type AuthResult = {
  access_token: string;
  token_type: "bearer";
  user: { id: number; email: string; username?: string; name?: string | null };
};

export async function requestLoginCode(email: string): Promise<void> {
  const res = await fetch("/auth/request-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function verifyLoginCode(email: string, code: string, name?: string): Promise<AuthResult> {
  const res = await fetch("/auth/verify-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code, name }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function register(username: string, email: string, password: string): Promise<{message: string}> {
  if (!password || password.length > 72) {
    throw new Error("Сөздүн узундугу 1ден 72 символго чейин болушу керек.");
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
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

