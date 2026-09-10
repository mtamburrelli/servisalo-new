import { redirectIfLoggedIn } from "./auth.js";

redirectIfLoggedIn("/");

const form        = document.getElementById("register-form");
const errorEl     = document.getElementById("register-error");
const submitBtn   = document.getElementById("register-submit");
const coordsEl    = document.getElementById("map-coords");
const mapHintEl   = document.getElementById("map-hint");
const locateBtn   = document.getElementById("btn-locate");
const inputLat    = document.getElementById("input-latitude");
const inputLng    = document.getElementById("input-longitude");
const rucField    = document.getElementById("ruc-field");
const accountType = form.querySelector('[name="account_type"]');

function toggleRuc() {
  const isEmpresa = accountType.value === "empresa";
  rucField.hidden = !isEmpresa;
  rucField.querySelectorAll("input").forEach((inp) => {
    inp.required = isEmpresa;
  });
}

accountType.addEventListener("change", toggleRuc);
toggleRuc();

// Limitar DV a 2 dígitos (maxlength no aplica a type=number en todos los browsers)
const dvInput = document.querySelector('[name="ruc_dv"]');
dvInput.addEventListener("input", () => {
  if (dvInput.value.length > 2) dvInput.value = dvInput.value.slice(0, 2);
  if (Number(dvInput.value) > 99) dvInput.value = "99";
});

// ── Mapa ──────────────────────────────────────────────────────────────────────

// Centro de Ciudad de Panamá
const PANAMA_CENTER = [8.9936, -79.5197];

const map = L.map("map", { zoomControl: true }).setView(PANAMA_CENTER, 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

// Marcador draggable con ícono turquesa personalizado
const markerIcon = L.divIcon({
  className: "",
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10.5 16 24 16 24s16-13.5 16-24C32 7.163 24.837 0 16 0z"
      fill="#0d9488" stroke="#fff" stroke-width="1.5"/>
    <circle cx="16" cy="16" r="6" fill="#fff"/>
  </svg>`,
  iconSize: [32, 40],
  iconAnchor: [16, 40],
  popupAnchor: [0, -40],
});

const marker = L.marker(PANAMA_CENTER, {
  draggable: true,
  icon: markerIcon,
}).addTo(map);

marker.bindTooltip("Arrastra el pin a tu ubicación", {
  permanent: false,
  direction: "top",
  offset: [0, -36],
}).openTooltip();

function updateCoords(latlng) {
  const lat = latlng.lat.toFixed(6);
  const lng = latlng.lng.toFixed(6);
  inputLat.value = lat;
  inputLng.value = lng;
  coordsEl.textContent = `📍 ${lat}, ${lng}`;
}

function placePinAt(lat, lng, zoom = 16) {
  const latlng = L.latLng(lat, lng);
  marker.setLatLng(latlng);
  map.setView(latlng, zoom);
  updateCoords(latlng);
  marker.bindTooltip("Puedes ajustar el pin si no está exacto", {
    permanent: false,
    direction: "top",
    offset: [0, -36],
  }).openTooltip();
}

function requestUserLocation({ silent = false } = {}) {
  if (!navigator.geolocation) {
    coordsEl.textContent = "Tu navegador no permite geolocalización. Coloca el pin manualmente.";
    if (mapHintEl) {
      mapHintEl.textContent = "Arrastra el pin o haz clic en el mapa para marcar tu ubicación de despacho.";
    }
    return;
  }

  if (!silent) {
    coordsEl.textContent = "Buscando tu ubicación…";
    locateBtn.disabled = true;
    locateBtn.textContent = "Localizando…";
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      placePinAt(latitude, longitude);
      if (mapHintEl) {
        mapHintEl.textContent =
          "Ubicación detectada. Si el pin no está exacto, arrástralo o haz clic en el mapa.";
      }
      locateBtn.disabled = false;
      locateBtn.textContent = "Usar mi ubicación";
    },
    (error) => {
      let message = "No se pudo obtener tu ubicación. Coloca el pin manualmente.";
      if (error.code === error.PERMISSION_DENIED) {
        message = "Permiso de ubicación denegado. Coloca el pin manualmente o pulsa «Usar mi ubicación».";
      } else if (error.code === error.TIMEOUT) {
        message = "Tiempo de espera agotado. Coloca el pin manualmente o inténtalo de nuevo.";
      }
      coordsEl.textContent = message;
      if (mapHintEl) {
        mapHintEl.textContent =
          "Arrastra el pin o haz clic en el mapa para marcar tu ubicación de despacho.";
      }
      locateBtn.disabled = false;
      locateBtn.textContent = "Usar mi ubicación";
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60000,
    }
  );
}

// Actualizar al arrastrar el pin
marker.on("dragend", (e) => updateCoords(e.target.getLatLng()));

// También al hacer clic en el mapa: mueve el pin al clic
map.on("click", (e) => {
  marker.setLatLng(e.latlng);
  updateCoords(e.latlng);
});

locateBtn?.addEventListener("click", () => requestUserLocation());

// Pedir ubicación al cargar la página de registro
requestUserLocation({ silent: true });

// ── Formulario ────────────────────────────────────────────────────────────────

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const formData = new FormData(form);
  const rawRuc   = formData.get("ruc")?.toString().trim();
  const rawRucDv = formData.get("ruc_dv")?.toString().trim();
  const payload = {
    account_type:     formData.get("account_type"),
    name:             formData.get("name")?.toString().trim(),
    email:            formData.get("email")?.toString().trim(),
    phone:            formData.get("phone")?.toString().trim(),
    password:         formData.get("password")?.toString(),
    password_confirm: formData.get("password_confirm")?.toString(),
    ruc:              rawRuc   ? Number(rawRuc)   : null,
    ruc_dv:           rawRucDv ? Number(rawRucDv) : null,
    address_line:     formData.get("address_line")?.toString().trim(),
    corregimiento:    formData.get("corregimiento")?.toString().trim(),
    latitude:         formData.get("latitude")  ? Number(formData.get("latitude"))  : null,
    longitude:        formData.get("longitude") ? Number(formData.get("longitude")) : null,
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "CREANDO…";

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showError(data.error || "No se pudo crear la cuenta.");
      return;
    }

    const q = encodeURIComponent(data.email || payload.email || "");
    const sent = data.email_sent ? "1" : "0";
    if (data.email_error) {
      sessionStorage.setItem("servisalo_email_error", data.email_error);
    } else {
      sessionStorage.removeItem("servisalo_email_error");
    }
    window.location.href = `/check-email?email=${q}&sent=${sent}`;
  } catch {
    showError("Error de conexión. Intenta de nuevo.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "CREAR CUENTA";
  }
});
