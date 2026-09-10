export async function fetchSession() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    return data.authenticated ? data.user : null;
  } catch {
    return null;
  }
}

export async function isLoggedIn() {
  const user = await fetchSession();
  return Boolean(user);
}

export async function requireAuth() {
  /* El catálogo es público. Nunca redirigir a /login desde aquí. */
  return fetchSession();
}

export async function redirectIfLoggedIn(target = "/") {
  const user = await fetchSession();
  if (user) {
    window.location.href = target;
  }
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
}
