import { createCart } from "./cart.js";
import { logout } from "./auth.js";
import { startCatalogTour } from "./tour.js";

const appRoot = document.getElementById("app");
const isAuthenticated = appRoot?.dataset.authenticated === "true";

const cart = createCart();

function readBootstrapProducts() {
  try {
    const el = document.getElementById("bootstrap-products");
    const data = JSON.parse(el?.textContent || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

let products = readBootstrapProducts();

const $ = (sel) => document.querySelector(sel);

// ── Elementos ──────────────────────────────────────────────────────────────

const catalogList    = $("#catalog-list");
const catalogLoading = $("#catalog-loading");
const catalogError   = $("#catalog-error");
const panelCatalog   = $("#panel-catalog");
const panelCart      = $("#panel-cart");
const panelOrders    = $("#panel-orders");
const panelProfile   = $("#panel-profile");
const cartEmpty      = $("#cart-empty");
const cartLines      = $("#cart-lines");
const cartCheckout   = $("#cart-checkout");
const cartTotal      = $("#cart-total");
const cartBadge      = $("#cart-badge");
const btnCheckout    = $("#btn-checkout");
const cartAuthGate   = $("#cart-auth-gate");
const cartCheckoutNote = $("#cart-checkout-note");
const toast          = $("#toast");
const headerUserName     = $("#header-user-name");

// ── Formato ────────────────────────────────────────────────────────────────

const IMAGE_PLACEHOLDER_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M14 6l-3.75 5 2.85 3.8-1.6 1.2C7.4 12.36 4 14.79 4 18v2h16v-2c0-3.31-3.1-5.72-7.5-8.2L14 6zm-2-4L2 18h2.5l2.04-2.73L9 18h1.5l2.46-3.27L15 18h2.5L12 2z"/>
  </svg>
  <span>Imagen</span>
`;

function formatPriceLb(value) {
  const n = Number(value);
  return `B/. ${(Number.isFinite(n) ? n : 0).toFixed(2)} / lb`;
}
function formatPriceUnit(value) {
  const n = Number(value);
  return `B/. ${(Number.isFinite(n) ? n : 0).toFixed(2)} / unidad`;
}
function formatTotal(value) {
  const n = Number(value);
  return `B/. ${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.add("toast--visible");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.remove("toast--visible");
    setTimeout(() => { toast.hidden = true; }, 200);
  }, 2500);
}

// ── Navegación ─────────────────────────────────────────────────────────────

const PANELS = {
  catalog: panelCatalog,
  cart:    panelCart,
  orders:  panelOrders,
  profile: panelProfile,
};

function switchTab(tab) {
  Object.entries(PANELS).forEach(([key, panel]) => {
    const active = key === tab;
    panel.classList.toggle("panel--active", active);
    panel.hidden = !active;
  });

  document.querySelectorAll(".bottom-nav__item").forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("bottom-nav__item--active", active);
    btn.setAttribute("aria-current", active ? "page" : "false");
  });

  if (tab === "orders" && isAuthenticated) loadOrders();
  if (tab === "profile" && isAuthenticated) {
    initProfile().then(() => {
      // invalidateSize después de que el panel sea visible en el DOM
      if (profileMap) setTimeout(() => profileMap.invalidateSize(), 100);
    });
  }
}

document.querySelectorAll(".bottom-nav__item").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

headerUserName?.addEventListener("click", () => switchTab("profile"));

// ── Catálogo ───────────────────────────────────────────────────────────────

async function loadProducts() {
  if (catalogError) catalogError.hidden = true;
  if (products.length) {
    if (catalogLoading) catalogLoading.hidden = true;
  } else if (catalogLoading) {
    catalogLoading.hidden = false;
  }

  try {
    const res = await fetch("/api/products", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    products = await res.json();
    if (catalogLoading) catalogLoading.hidden = true;
    renderCatalog();
  } catch (err) {
    if (catalogLoading) catalogLoading.hidden = true;
    if (products.length) return;
    if (catalogError) {
      catalogError.hidden = false;
      catalogError.textContent = `No se pudo cargar el catálogo: ${err.message}`;
    }
  }
}

function renderCatalog() {
  if (!catalogList) return;
  if (!products.length) {
    catalogList.innerHTML = "";
    catalogError.hidden = false;
    catalogError.textContent = "No hay legumbres en el catálogo.";
    return;
  }

  catalogList.innerHTML = products
    .map((p) => `
    <li class="legume-card" data-id="${p.id}">
      <div class="legume-card__image">
        ${p.imageUrl ? `<img src="${p.imageUrl}" alt="" loading="lazy" />` : IMAGE_PLACEHOLDER_SVG}
      </div>
      <div class="legume-card__body">
        <h2 class="legume-card__name">${escapeHtml(p.name)}</h2>
        <div class="legume-card__prices">
          <p class="legume-card__price">${formatPriceLb(p.pricePerLb)}</p>
          <p class="legume-card__price legume-card__price--unit">${formatPriceUnit(p.pricePerUnit)}</p>
        </div>
      </div>
      <div class="legume-card__actions">
        <button type="button" class="legume-card__add" data-add="${p.id}" data-unit="lb"
          aria-label="Agregar ${escapeHtml(p.name)} por libra">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M11 9h2V6h3V4h-3V1h-2v3H8v2h3v3zm-4 9c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2S15.9 22 17 22s2-.9 2-2-.9-2-2-2zM7.16 14l.84-2h8.45l1.2 3H7.16zM6.21 6l-1.1-2H1v2h2l3.6 7.59-1.35 2.44C5.09 16.37 5.5 17 6.21 17h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12L8.1 13h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 20 4H5.21L4.27 2H1V0h3.74c.67 0 1.27.42 1.5 1.05L6.21 6z"/>
          </svg>
          <span class="legume-card__add-label">lb</span>
        </button>
        <button type="button" class="legume-card__add legume-card__add--unit" data-add="${p.id}" data-unit="unit"
          aria-label="Agregar ${escapeHtml(p.name)} por unidad">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M19 7h-3V6a4 4 0 0 0-8 0v1H5a1 1 0 0 0-1 1v11a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V8a1 1 0 0 0-1-1zM10 6a2 2 0 0 1 4 0v1h-4V6zm8 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9h2v1a1 1 0 0 0 2 0V9h4v1a1 1 0 0 0 2 0V9h2v10z"/>
          </svg>
          <span class="legume-card__add-label">ud</span>
        </button>
      </div>
    </li>
  `).join("");
}

catalogList?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-add]");
  if (!btn) return;
  const product = products.find((p) => p.id === Number(btn.dataset.add));
  const unitType = btn.dataset.unit || "lb";
  if (!product) return;
  cart.add(product, unitType);
  showToast(`${product.name} agregado (${unitType === "unit" ? "unidad" : "libra"})`);
});

const productsReady = loadProducts();

// ── Carrito ────────────────────────────────────────────────────────────────

function renderCart() {
  if (!cartEmpty || !cartLines || !cartCheckout) return;
  const lines = cart.getLines();
  const empty = cart.isEmpty();

  cartEmpty.hidden = !empty;
  cartLines.hidden = empty;
  cartCheckout.hidden = empty;
  if (btnCheckout) {
    btnCheckout.hidden = !isAuthenticated;
    btnCheckout.disabled = empty || !isAuthenticated;
  }
  if (cartCheckoutNote) cartCheckoutNote.hidden = !isAuthenticated;
  if (cartAuthGate) cartAuthGate.hidden = empty || isAuthenticated;

  if (empty) {
    cartLines.innerHTML = "";
    cartTotal.textContent = formatTotal(0);
    updateBadge();
    return;
  }

  cartLines.innerHTML = lines.map(({ key, product, qty, unitType }) => {
    const unitPrice = unitType === "unit" ? product.pricePerUnit : product.pricePerLb;
    const priceLabel = unitType === "unit"
      ? formatPriceUnit(unitPrice)
      : formatPriceLb(unitPrice);
    const lineSubtotal = Math.round(unitPrice * qty * 100) / 100;

    const safeKey = escapeHtml(key);
    const qtyControls = unitType === "lb"
      ? `<div class="cart-line__qty cart-line__qty--lb">
           <label class="cart-line__qty-label" for="qty-${safeKey}">lb</label>
           <input
             id="qty-${safeKey}"
             class="cart-line__qty-input"
             type="number"
             inputmode="decimal"
             min="0.01"
             step="0.01"
             value="${qty}"
             data-qty="${safeKey}"
             aria-label="Cantidad en libras"
           />
         </div>`
      : `<div class="cart-line__qty">
           <button type="button" data-dec="${safeKey}" aria-label="Quitar una">−</button>
           <span>${qty}</span>
           <button type="button" data-inc="${safeKey}" aria-label="Agregar una">+</button>
         </div>`;

    const thumb = product.imageUrl
      ? `<img src="${escapeHtml(product.imageUrl)}" alt="" />`
      : IMAGE_PLACEHOLDER_SVG.replace("<span>Imagen</span>", "");

    return `
    <li class="cart-line" data-key="${safeKey}">
      <div class="cart-line__thumb">${thumb}</div>
      <div class="cart-line__info">
        <p class="cart-line__name">${escapeHtml(product.name)}</p>
        <p class="cart-line__price">${priceLabel}</p>
        <p class="cart-line__subtotal">Subtotal ${formatTotal(lineSubtotal)}</p>
      </div>
      ${qtyControls}
      <button type="button" class="cart-line__qty cart-line__remove" data-remove="${safeKey}" aria-label="Eliminar">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
        </svg>
      </button>
    </li>`;
  }).join("");

  cartTotal.textContent = formatTotal(cart.total);
  updateBadge();
}

function updateBadge() {
  if (!cartBadge) return;
  const count = cart.itemCount;
  cartBadge.hidden = count === 0;
  if (count > 0) cartBadge.textContent = count > 99 ? "99+" : String(count);
}

cartLines?.addEventListener("click", (e) => {
  const inc = e.target.closest("[data-inc]");
  const dec = e.target.closest("[data-dec]");
  const rem = e.target.closest("[data-remove]");

  if (inc) {
    const line = cart.getLines().find((l) => l.key === inc.dataset.inc);
    if (line) cart.add(line.product, line.unitType);
  } else if (dec) {
    const line = cart.getLines().find((l) => l.key === dec.dataset.dec);
    if (line) cart.setQuantity(dec.dataset.dec, line.qty - 1);
  } else if (rem) {
    cart.remove(rem.dataset.remove);
  }
});

function applyLbQuantity(input) {
  const key = input.dataset.qty;
  if (!key) return;
  const raw = input.value.trim().replace(",", ".");
  const qty = Number(raw);
  if (!Number.isFinite(qty) || qty <= 0) {
    cart.remove(key);
    return;
  }
  cart.setQuantity(key, qty);
}

// Aplicar cantidad al terminar de editar (evita perder el foco al escribir)
cartLines?.addEventListener("change", (e) => {
  const input = e.target.closest("[data-qty]");
  if (input) applyLbQuantity(input);
});

cartLines?.addEventListener("keydown", (e) => {
  const input = e.target.closest("[data-qty]");
  if (!input) return;
  if (e.key === "Enter") {
    e.preventDefault();
    input.blur();
  }
});

btnCheckout?.addEventListener("click", async () => {
  if (!isAuthenticated) {
    if (cartAuthGate) cartAuthGate.hidden = false;
    showToast("Inicia sesión o crea una cuenta para realizar un pedido.");
    return;
  }
  if (cart.isEmpty()) return;

  btnCheckout.disabled = true;
  btnCheckout.textContent = "Enviando…";

  const payload = {
    items: cart.getLines().map(({ product, unitType, qty }) => ({
      product_id: product.id,
      unit_type:  unitType,
      quantity:   qty,
    })),
  };

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });

    const body = await res.json();

    if (!res.ok) {
      showToast(body.error || "No se pudo registrar el pedido.");
      return;
    }

    cart.getLines().forEach(({ key }) => cart.remove(key));
    ordersLoaded = false;
    switchTab("orders");
    showToast(`Pedido #${body.order.id} enviado · B/. ${body.order.total_amount.toFixed(2)}`);
  } catch {
    showToast("Error de red. Intenta de nuevo.");
  } finally {
    btnCheckout.disabled = false;
    btnCheckout.textContent = "Enviar pedido";
  }
});

// ── Mis pedidos ────────────────────────────────────────────────────────────

const ordersLoading = $("#orders-loading");
const ordersEmpty   = $("#orders-empty");
const ordersList    = $("#orders-list");

const STATUS_LABELS = {
  pending:    "Pendiente",
  confirmed:  "Confirmado",
  rejected:   "Rechazado",
  dispatched: "En camino",
  delivered:  "Entregado",
};

let ordersLoaded = false;

async function loadOrders() {
  if (!isAuthenticated || !ordersLoading) return;
  if (ordersLoaded) return;
  ordersLoading.hidden = false;
  ordersEmpty.hidden = true;
  ordersList.innerHTML = "";

  try {
    const res = await fetch("/api/orders", { credentials: "same-origin" });
    if (!res.ok) throw new Error();
    const orders = await res.json();
    ordersLoading.hidden = true;

    if (!orders.length) {
      ordersEmpty.hidden = false;
      return;
    }

    ordersList.innerHTML = orders.map((o) => {
      const date = new Date(o.created_at).toLocaleDateString("es-PA", {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      });
      const statusClass = `order-card__status--${o.status}`;
      const statusLabel = STATUS_LABELS[o.status] ?? o.status;

      const itemsHtml = o.items.map((item) => {
        const unitLabel = item.unit_type === "unit" ? "ud" : "lb";
        return `<li class="order-card__item">
          <span class="order-card__item-name">${escapeHtml(item.product_name)}</span>
          <span class="order-card__item-qty">${item.quantity} ${unitLabel}</span>
          <span class="order-card__item-price">B/. ${item.subtotal.toFixed(2)}</span>
        </li>`;
      }).join("");

      const rejectionHtml = o.status === "rejected" && o.rejection_reason
        ? `<p class="order-card__rejection">Motivo: ${escapeHtml(o.rejection_reason)}</p>`
        : "";

      const showPay = ["confirmed", "dispatched", "delivered"].includes(o.status);
      const paymentHtml = showPay
        ? `<p class="order-card__payinfo">Nuestro equipo se pondrá en contacto contigo para el pago y la entrega.<br>ACH: ServiSalo S.A. · Banco General · Cuenta de Ahorros 04-10-98-711134-7<br>Yappy: 66756455<br>Envía el comprobante de pago al 66756455 para proceder a coordinar la entrega.</p>`
        : "";

      return `
      <li class="order-card">
        <div class="order-card__head">
          <div>
            <span class="order-card__id">Pedido #${o.id}</span>
            <span class="order-card__date"> · ${date}</span>
          </div>
          <span class="order-card__status ${statusClass}">${statusLabel}</span>
        </div>
        <ul class="order-card__items">${itemsHtml}</ul>
        ${rejectionHtml}
        ${paymentHtml}
        <div class="order-card__foot">
          <span class="order-card__payment">${o.status === "pending" ? "Esperando confirmación" : statusLabel}</span>
          <span class="order-card__total">B/. ${o.total_amount.toFixed(2)}</span>
        </div>
      </li>`;
    }).join("");

    ordersLoaded = true;
  } catch {
    ordersLoading.hidden = true;
    ordersEmpty.hidden = false;
    ordersEmpty.querySelector(".orders-empty__text").textContent =
      "No se pudo cargar el historial.";
  }
}

// ── Mi perfil ──────────────────────────────────────────────────────────────

const PANAMA_CENTER = [8.9936, -79.5197];

let profileMap    = null;
let profileMarker = null;
let profileInitialized = false;

const profileForm    = $("#profile-form");
const profileError   = $("#profile-error");
const profileSaveBtn = $("#profile-save-btn");
const profileMapCoords = $("#profile-map-coords");
const pAddressLine  = $("#p-address-line");
const pCorregimiento = $("#p-corregimiento");
const pLat  = $("#p-latitude");
const pLng  = $("#p-longitude");

function createMarkerIcon() {
  if (typeof L === "undefined") return null;
  return L.divIcon({
    className: "",
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10.5 16 24 16 24s16-13.5 16-24C32 7.163 24.837 0 16 0z"
      fill="#0d9488" stroke="#fff" stroke-width="1.5"/>
    <circle cx="16" cy="16" r="6" fill="#fff"/>
  </svg>`,
    iconSize: [32, 40],
    iconAnchor: [16, 40],
  });
}

function loadLeaflet() {
  if (typeof L !== "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar el mapa"));
    document.head.appendChild(script);
  });
}

function updateProfileCoords(latlng) {
  const lat = latlng.lat.toFixed(6);
  const lng = latlng.lng.toFixed(6);
  pLat.value = lat;
  pLng.value = lng;
  profileMapCoords.textContent = `📍 ${lat}, ${lng}`;
}

async function initProfile() {
  if (!document.getElementById("profile-map")) return;

  if (profileInitialized) {
    setTimeout(() => profileMap?.invalidateSize(), 100);
    return;
  }

  try {
    await loadLeaflet();
  } catch {
    return;
  }

  profileInitialized = true;

  // Inicializar mapa
  profileMap = L.map("profile-map").setView(PANAMA_CENTER, 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(profileMap);

  profileMarker = L.marker(PANAMA_CENTER, { draggable: true, icon: createMarkerIcon() })
    .addTo(profileMap);

  profileMarker.on("dragend", (e) => updateProfileCoords(e.target.getLatLng()));
  profileMap.on("click", (e) => {
    profileMarker.setLatLng(e.latlng);
    updateProfileCoords(e.latlng);
  });

  // Cargar datos actuales
  try {
    const res = await fetch("/api/profile/address", { credentials: "same-origin" });
    const data = await res.json();
    const addr = data.address;
    if (addr) {
      pAddressLine.value   = addr.address_line ?? "";
      pCorregimiento.value = addr.corregimiento ?? "";
      if (addr.latitude && addr.longitude) {
        const latlng = [addr.latitude, addr.longitude];
        profileMap.setView(latlng, 15);
        profileMarker.setLatLng(latlng);
        updateProfileCoords({ lat: addr.latitude, lng: addr.longitude });
      }
    }
  } catch { /* si falla, el formulario queda vacío */ }

  // Re-render del mapa: el div estuvo oculto, Leaflet necesita recalcular
  setTimeout(() => profileMap.invalidateSize(), 80);
}

profileForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  profileError.hidden = true;

  const payload = {
    address_line:  pAddressLine.value.trim(),
    corregimiento: pCorregimiento.value.trim(),
    latitude:  pLat.value  ? Number(pLat.value)  : null,
    longitude: pLng.value  ? Number(pLng.value) : null,
  };

  profileSaveBtn.disabled = true;
  profileSaveBtn.textContent = "Guardando…";

  try {
    const res = await fetch("/api/profile/address", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });

    const body = await res.json();

    if (!res.ok) {
      profileError.textContent = body.error || "No se pudo guardar.";
      profileError.hidden = false;
      return;
    }

    showToast("Dirección actualizada.");
  } catch {
    profileError.textContent = "Error de conexión.";
    profileError.hidden = false;
  } finally {
    profileSaveBtn.disabled = false;
    profileSaveBtn.textContent = "Guardar cambios";
  }
});

$("#btn-logout")?.addEventListener("click", async () => {
  await logout();
  window.location.href = "/";
});

$("#btn-replay-tour")?.addEventListener("click", () => {
  startCatalogTour({ switchTab, force: true });
});

// ── Arranque ───────────────────────────────────────────────────────────────

cart.subscribe(renderCart);
productsReady.then(() => {
  if (isAuthenticated) startCatalogTour({ switchTab });
});
renderCart();
