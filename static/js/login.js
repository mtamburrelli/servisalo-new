import { redirectIfLoggedIn } from "./auth.js";

redirectIfLoggedIn("/");

const form = document.getElementById("login-form");
const errorEl = document.getElementById("login-error");
const hintEl = document.getElementById("login-hint");
const submitBtn = document.getElementById("login-submit");

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearMessages() {
  errorEl.hidden = true;
  errorEl.textContent = "";
  if (hintEl) {
    hintEl.hidden = true;
    hintEl.innerHTML = "";
  }
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessages();

  const formData = new FormData(form);
  const email = formData.get("email")?.toString().trim() || "";
  const password = formData.get("password")?.toString() || "";

  if (!email || !password) {
    showError("Correo y contraseña son obligatorios.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "INGRESANDO…";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showError(data.error || "No se pudo iniciar sesión.");
      if (data.code === "email_not_verified" && hintEl) {
        const q = encodeURIComponent(data.email || email);
        hintEl.innerHTML =
          `Puedes <a href="/check-email?email=${q}">reenviar el correo de verificación</a>.`;
        hintEl.hidden = false;
      }
      return;
    }

    window.location.href = "/";
  } catch {
    showError("Error de conexión. Intenta de nuevo.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "INGRESAR";
  }
});
