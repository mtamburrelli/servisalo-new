import { debounce, escapeHtml, fetchJson, showToast } from "./common.js";

const tbody = document.querySelector("#products-table tbody");
const errorEl = document.getElementById("products-error");
const searchInput = document.getElementById("products-search");

const modal = document.getElementById("product-modal");
const form = document.getElementById("product-form");
const formError = document.getElementById("product-form-error");
const saveBtn = document.getElementById("btn-save-product");

const multiplierInput = document.getElementById("price-multiplier");
const applyToSelect = document.getElementById("price-apply-to");
const onlyActiveCheck = document.getElementById("price-only-active");
const applyMultiplierBtn = document.getElementById("btn-apply-multiplier");
const multiplierPreview = document.getElementById("price-multiplier-preview");

let products = [];
const savingRows = new Set();

function thumbHtml(url) {
  if (url) {
    return `<img class="admin-product-thumb" src="${escapeHtml(url)}" alt="" />`;
  }
  return `<span class="admin-product-thumb admin-product-thumb--empty">—</span>`;
}

function renderRow(p) {
  return `
    <tr data-id="${p.id}">
      <td class="admin-table__center" data-thumb>${thumbHtml(p.image_url)}</td>
      <td>
        <input class="admin-inline-input admin-inline-input--name" style="width:160px;text-align:left"
          data-field="name" value="${escapeHtml(p.name)}" />
      </td>
      <td class="admin-table__num">
        <input class="admin-inline-input" type="number" min="0" step="0.01" data-field="price_per_lb" value="${p.price_per_lb}" />
      </td>
      <td class="admin-table__num">
        <input class="admin-inline-input" type="number" min="0" step="0.01" data-field="price_per_unit" value="${p.price_per_unit}" />
      </td>
      <td>
        <input class="admin-inline-input admin-inline-input--url" type="text"
          data-field="image_url" value="${escapeHtml(p.image_url || "")}"
          placeholder="https://… o /static/images/products/foto.jpg" />
      </td>
      <td class="admin-table__center">
        <span class="badge badge--${p.is_active ? "active" : "inactive"}">${p.is_active ? "Activo" : "Inactivo"}</span>
      </td>
      <td class="admin-table__center">
        <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
          <button type="button" class="admin-btn admin-btn--sm ${p.is_active ? "admin-btn--danger" : "admin-btn--gold"}" data-toggle="${p.id}">
            ${p.is_active ? "Desactivar" : "Activar"}
          </button>
          <button type="button" class="admin-btn admin-btn--sm admin-btn--danger" data-delete="${p.id}" data-name="${escapeHtml(p.name)}">
            Borrar
          </button>
        </div>
      </td>
    </tr>
  `;
}

function render() {
  if (!products.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="admin-table__empty">No hay productos que coincidan.</td></tr>`;
    return;
  }
  tbody.innerHTML = products.map(renderRow).join("");
}

async function loadProducts() {
  errorEl.hidden = true;
  try {
    const q = searchInput.value.trim();
    const url = q ? `/api/admin/products?q=${encodeURIComponent(q)}` : "/api/admin/products";
    products = await fetchJson(url);
    render();
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = err.message || "No se pudieron cargar los productos.";
  }
}

function describeMultiplier(value) {
  const m = Number(value);
  if (!Number.isFinite(m) || m <= 0) {
    return "Ingresa un multiplicador mayor que 0.";
  }
  if (m === 1) {
    return "Con 1.00 los precios no cambian.";
  }
  const pct = Math.round(Math.abs(m - 1) * 1000) / 10;
  if (m > 1) {
    return `Esto subirá los precios mayores que 0 un ${pct}% (× ${m}). Los que estén en 0 se quedan en 0.`;
  }
  return `Esto bajará los precios mayores que 0 un ${pct}% (× ${m}). Los que estén en 0 se quedan en 0.`;
}

function updateMultiplierPreview() {
  multiplierPreview.textContent = describeMultiplier(multiplierInput.value);
}

function rowPayload(row) {
  const nameEl = row.querySelector('[data-field="name"]');
  const lbEl = row.querySelector('[data-field="price_per_lb"]');
  const unitEl = row.querySelector('[data-field="price_per_unit"]');
  const imgEl = row.querySelector('[data-field="image_url"]');
  const name = nameEl?.value.trim() || "";
  const pricePerLb = Number(lbEl?.value);
  const pricePerUnit = Number(unitEl?.value);
  const imageUrl = imgEl?.value.trim() || "";
  return {
    name,
    price_per_lb: pricePerLb,
    price_per_unit: pricePerUnit,
    image_url: imageUrl || null,
  };
}

function applySavedProduct(row, saved) {
  if (!saved) return;
  const idx = products.findIndex((p) => p.id === saved.id);
  if (idx >= 0) products[idx] = saved;
  const thumb = row.querySelector("[data-thumb]");
  if (thumb) thumb.innerHTML = thumbHtml(saved.image_url);
}

async function saveRow(row, { silent = false } = {}) {
  const id = row.dataset.id;
  if (!id) return;
  const payload = rowPayload(row);
  if (!payload.name) {
    throw new Error("El nombre no puede estar vacío.");
  }
  if (!Number.isFinite(payload.price_per_lb) || payload.price_per_lb < 0) {
    throw new Error("El precio por libra debe ser ≥ 0.");
  }
  if (!Number.isFinite(payload.price_per_unit) || payload.price_per_unit < 0) {
    throw new Error("El precio por unidad debe ser ≥ 0.");
  }
  savingRows.add(id);
  try {
    const result = await fetchJson(`/api/admin/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    applySavedProduct(row, result.product);
    if (!silent) showToast("Producto actualizado.");
  } finally {
    savingRows.delete(id);
  }
}

async function saveAllVisibleRows() {
  const rows = [...tbody.querySelectorAll("tr[data-id]")];
  for (const row of rows) {
    try {
      await saveRow(row, { silent: true });
    } catch {
      /* se intenta el resto; el multiplicador usa lo ya guardado en BD */
    }
  }
}

async function autosaveFromEvent(e) {
  const input = e.target.closest("[data-field]");
  if (!input) return;
  const row = input.closest("tr[data-id]");
  if (!row) return;
  try {
    await saveRow(row, { silent: true });
    if (input.dataset.field === "image_url") {
      const thumb = row.querySelector("[data-thumb]");
      if (thumb) thumb.innerHTML = thumbHtml(input.value.trim());
    }
    showToast("Guardado.");
  } catch (err) {
    showToast(err.message || "No se pudo guardar.", "error");
  }
}

tbody.addEventListener("click", async (e) => {
  const toggleBtn = e.target.closest("[data-toggle]");
  const deleteBtn = e.target.closest("[data-delete]");

  if (toggleBtn) {
    const id = toggleBtn.dataset.toggle;
    toggleBtn.disabled = true;
    try {
      await fetchJson(`/api/admin/products/${id}/toggle`, { method: "PATCH" });
      await loadProducts();
      showToast("Disponibilidad actualizada.");
    } catch (err) {
      showToast(err.message || "No se pudo actualizar.", "error");
      toggleBtn.disabled = false;
    }
  }

  if (deleteBtn) {
    const id = deleteBtn.dataset.delete;
    const name = deleteBtn.dataset.name || "este producto";
    const ok = window.confirm(
      `¿Borrar permanentemente «${name}»?\n\nSi ya está en pedidos, no se podrá borrar (usa Desactivar).`
    );
    if (!ok) return;

    deleteBtn.disabled = true;
    deleteBtn.textContent = "Borrando…";
    try {
      await fetchJson(`/api/admin/products/${id}`, { method: "DELETE" });
      showToast(`Producto «${name}» eliminado.`);
      await loadProducts();
    } catch (err) {
      showToast(err.message || "No se pudo borrar.", "error");
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Borrar";
    }
  }
});

tbody.addEventListener("input", debounce(autosaveFromEvent, 700));
tbody.addEventListener("change", autosaveFromEvent);

searchInput.addEventListener("input", debounce(loadProducts, 300));

multiplierInput.addEventListener("input", updateMultiplierPreview);
updateMultiplierPreview();

applyMultiplierBtn.addEventListener("click", async () => {
  const multiplier = Number(multiplierInput.value);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    showToast("El multiplicador debe ser un número mayor que 0.", "error");
    return;
  }
  if (multiplier === 1) {
    showToast("Con 1.00 no hay cambios que aplicar.");
    return;
  }

  const applyTo = applyToSelect.value;
  const onlyActive = onlyActiveCheck.checked;
  const scopeLabel = {
    both: "precios por libra y por unidad",
    lb: "solo precios por libra",
    unit: "solo precios por unidad",
  }[applyTo];
  const activeLabel = onlyActive ? "solo productos activos" : "todos los productos";

  const ok = window.confirm(
    `${describeMultiplier(multiplier)}\n\nSe actualizarán ${scopeLabel} de ${activeLabel}.\nLos precios en 0 no cambian.\n\n¿Continuar?`
  );
  if (!ok) return;

  applyMultiplierBtn.disabled = true;
  applyMultiplierBtn.textContent = "Guardando…";
  try {
    await saveAllVisibleRows();
    applyMultiplierBtn.textContent = "Aplicando…";
    const result = await fetchJson("/api/admin/products/multiply-prices", {
      method: "POST",
      body: JSON.stringify({
        multiplier,
        apply_to: applyTo,
        only_active: onlyActive,
      }),
    });
    const skipped = result.skipped_zero_prices || 0;
    const msg =
      skipped > 0
        ? `Actualizados ${result.changed_prices} precio(s). ${skipped} en 0 se dejaron igual.`
        : `Precios actualizados (${result.changed_prices} cambios).`;
    showToast(msg);
    await loadProducts();
  } catch (err) {
    showToast(err.message || "No se pudieron actualizar los precios.", "error");
  } finally {
    applyMultiplierBtn.disabled = false;
    applyMultiplierBtn.textContent = "Aplicar multiplicador";
  }
});

document.getElementById("btn-new-product").addEventListener("click", () => {
  form.reset();
  formError.hidden = true;
  modal.hidden = false;
});

document.getElementById("btn-cancel-product").addEventListener("click", () => {
  modal.hidden = true;
});

modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.hidden = true;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const data = new FormData(form);
  const payload = {
    name: data.get("name")?.toString().trim(),
    price_per_lb: Number(data.get("price_per_lb")),
    price_per_unit: Number(data.get("price_per_unit")),
    image_url: data.get("image_url")?.toString().trim() || null,
  };

  saveBtn.disabled = true;
  saveBtn.textContent = "Creando…";
  try {
    await fetchJson("/api/admin/products", { method: "POST", body: JSON.stringify(payload) });
    modal.hidden = true;
    showToast("Producto creado.");
    await loadProducts();
  } catch (err) {
    formError.hidden = false;
    formError.textContent = err.message || "No se pudo crear el producto.";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Crear";
  }
});

loadProducts();
