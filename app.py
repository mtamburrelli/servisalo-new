import os
from datetime import datetime, timezone

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, session, url_for

from admin_routes import register_admin_routes
from auth_routes import (
    get_current_user,
    login_required_api,
    register_auth_routes,
)
from emails import send_new_order_to_owner
from models import Address, Order, OrderItem, Product, db
from seed import seed_catalog

app = Flask(__name__)
# Render define RENDER=true; en local usa DevConfig
_config = (
    "config.ProdConfig"
    if os.environ.get("RENDER") or os.environ.get("FLASK_ENV") == "production"
    else "config.DevConfig"
)
app.config.from_object(_config)

if not app.config.get("SQLALCHEMY_DATABASE_URI"):
    raise RuntimeError(
        "DATABASE_URL no está definida. "
        "En Render: Environment → DATABASE_URL (Internal Database URL)."
    )

db.init_app(app)
register_auth_routes(app)
register_admin_routes(app)


@app.after_request
def _no_cache_js(response):
    path = request.path or ""
    if path.startswith("/static/js/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


def _post_login_redirect():
    """Los admin van a su panel; los clientes al catálogo."""
    user = get_current_user()
    if user and user.is_admin:
        return redirect(url_for("admin_dashboard"))
    return redirect(url_for("catalog_page"))


def _render_public_catalog():
    """Catálogo público: se ve sin sesión. El pedido sí exige cuenta."""
    user = get_current_user()
    products = (
        Product.query.filter_by(is_active=True).order_by(Product.name).all()
    )
    return render_template(
        "catalog.html",
        user=user,
        products=products,
        products_json=[p.to_dict() for p in products],
    )


# ——— Páginas ———

@app.route("/favicon.ico")
def favicon_ico():
    return send_from_directory(
        os.path.join(app.root_path, "static"),
        "favicon.png",
        mimetype="image/png",
    )


@app.route("/")
def home():
    return _render_public_catalog()


@app.route("/login")
def login_page():
    if get_current_user():
        return _post_login_redirect()
    return render_template("login.html")


@app.route("/register")
def register_page():
    if get_current_user():
        return _post_login_redirect()
    return render_template("register.html")


@app.route("/check-email")
def check_email_page():
    # Flujo de cuenta: no redirigir por sesión previa (p. ej. admin en otra pestaña)
    email = (request.args.get("email") or "").strip()
    sent_raw = (request.args.get("sent") or "1").strip()
    email_sent = sent_raw != "0"
    return render_template(
        "check_email.html",
        email=email,
        email_sent=email_sent,
    )


@app.route("/forgot-password")
def forgot_password_page():
    return render_template("forgot_password.html")


@app.route("/reset-password")
def reset_password_page():
    # Crítico: limpiar sesión. Si el dueño/admin tenía cookie activa, el link
    # de reset NO debe mandarlo al panel — debe mostrar el formulario del token.
    session.clear()
    token = (request.args.get("token") or "").strip()
    return render_template("reset_password.html", token=token)


@app.route("/catalog")
@app.route("/inicio")
def catalog_page():
    return _render_public_catalog()


# ——— API ———

@app.route("/api/products")
def api_products():
    products = Product.query.filter_by(is_active=True).order_by(Product.name).all()
    return jsonify([p.to_dict() for p in products])


@app.route("/api/orders", methods=["POST"])
@login_required_api
def api_create_order():
    user = get_current_user()
    data = request.get_json(silent=True) or {}

    items_data = data.get("items") or []
    notes = (data.get("notes") or "").strip()

    # El pago se coordina después de que el dueño acepte el pedido
    payment_method = "pending"

    if not items_data:
        return jsonify({"error": "El carrito está vacío."}), 400

    # Dirección activa del usuario (la primera; en el futuro el cliente elegirá)
    address = Address.query.filter_by(user_id=user.id, is_active=True).first()
    if not address:
        return jsonify({"error": "No tienes una dirección de despacho registrada."}), 400

    # ── Construir líneas verificando precios en la BD ──
    order_items = []
    total = 0.0

    for item in items_data:
        product_id = item.get("product_id")
        unit_type = (item.get("unit_type") or "lb").lower()
        qty = item.get("quantity", 0)

        if unit_type not in ("unit", "lb"):
            return jsonify({"error": f"unit_type inválido: {unit_type}"}), 400
        if not isinstance(qty, (int, float)) or qty <= 0:
            return jsonify({"error": "La cantidad debe ser mayor a 0."}), 400

        # Unidades: enteros. Libras: permiten decimales (máx. 2 cifras).
        if unit_type == "unit":
            if not float(qty).is_integer():
                return jsonify({"error": "La cantidad por unidad debe ser un número entero."}), 400
            qty = int(qty)
        else:
            qty = round(float(qty), 2)

        product = db.session.get(Product, product_id)
        if not product or not product.is_active:
            return jsonify({"error": f"Producto id={product_id} no existe o está inactivo."}), 400

        unit_price = product.price_per_unit if unit_type == "unit" else product.price_per_lb
        subtotal = round(unit_price * qty, 2)
        total += subtotal

        order_items.append(OrderItem(
            product_id=product.id,
            product_name=product.name,   # snapshot: el nombre puede cambiar después
            unit_type=unit_type,
            unit_price=unit_price,
            quantity=qty,
            subtotal=subtotal,
        ))

    total = round(total, 2)

    # ── Crear la orden ──
    order = Order(
        user_id=user.id,
        address_id=address.id,
        payment_method=payment_method,
        status="pending",
        total_amount=total,
        notes=notes or None,
        created_at=datetime.now(timezone.utc),
    )

    for oi in order_items:
        oi.order = order

    db.session.add(order)
    db.session.commit()

    send_new_order_to_owner(order, user, address)

    return jsonify({
        "ok": True,
        "order": order.to_dict(),
    }), 201


@app.route("/api/orders")
@login_required_api
def api_list_orders():
    user = get_current_user()
    orders = (
        Order.query
        .filter_by(user_id=user.id)
        .order_by(Order.created_at.desc())
        .all()
    )
    return jsonify([o.to_dict() for o in orders])


# ── Perfil ───────────────────────────────────────────────────────────────────

@app.route("/api/profile/address")
@login_required_api
def api_get_address():
    user = get_current_user()
    address = Address.query.filter_by(user_id=user.id, is_active=True).first()
    if not address:
        return jsonify({"address": None})
    return jsonify({
        "address": {
            "id": address.id,
            "address_line": address.address_line,
            "corregimiento": address.corregimiento,
            "latitude": address.latitude,
            "longitude": address.longitude,
        }
    })


@app.route("/api/profile/address", methods=["PUT"])
@login_required_api
def api_update_address():
    user = get_current_user()
    data = request.get_json(silent=True) or {}

    address_line  = (data.get("address_line") or "").strip()
    corregimiento = (data.get("corregimiento") or "").strip()

    if not address_line:
        return jsonify({"error": "La dirección es obligatoria."}), 400
    if not corregimiento:
        return jsonify({"error": "El corregimiento es obligatorio."}), 400

    raw_lat = data.get("latitude")
    raw_lng = data.get("longitude")
    try:
        latitude  = float(raw_lat) if raw_lat is not None else None
        longitude = float(raw_lng) if raw_lng is not None else None
    except (TypeError, ValueError):
        latitude = longitude = None

    address = Address.query.filter_by(user_id=user.id, is_active=True).first()
    if not address:
        address = Address(user_id=user.id, is_active=True)
        db.session.add(address)

    address.address_line  = address_line
    address.corregimiento = corregimiento
    address.latitude      = latitude
    address.longitude     = longitude

    db.session.commit()
    return jsonify({"ok": True})


# ——— Inicialización ———

import logging

_startup_logger = logging.getLogger(__name__)


def _existing_columns(table: str):
    """Lista columnas de una tabla (sqlite o postgres)."""
    from sqlalchemy import inspect, text

    dialect = db.engine.dialect.name
    if dialect == "sqlite":
        with db.engine.connect() as conn:
            rows = conn.execute(text(f"PRAGMA table_info({table})"))
            return {row[1] for row in rows}
    return {col["name"] for col in inspect(db.engine).get_columns(table)}


def _table_exists(table: str) -> bool:
    from sqlalchemy import inspect

    return table in inspect(db.engine).get_table_names()


def _ensure_user_auth_columns():
    """
    Añade columnas de verificación/reset si faltan.
    Evita ADD ... NOT NULL (puede tumbar Postgres con filas existentes).
    """
    from sqlalchemy import text

    if not _table_exists("users"):
        return

    dialect = db.engine.dialect.name
    # Sin NOT NULL en el ADD: más compatible; luego rellenamos valores.
    if dialect == "postgresql":
        needed = {
            "email_verified": "BOOLEAN DEFAULT FALSE",
            "email_verify_token": "VARCHAR(64)",
            "email_verify_sent_at": "TIMESTAMP WITH TIME ZONE",
            "password_reset_token": "VARCHAR(64)",
            "password_reset_sent_at": "TIMESTAMP WITH TIME ZONE",
        }
    else:
        needed = {
            "email_verified": "BOOLEAN DEFAULT 0",
            "email_verify_token": "VARCHAR(64)",
            "email_verify_sent_at": "DATETIME",
            "password_reset_token": "VARCHAR(64)",
            "password_reset_sent_at": "DATETIME",
        }

    cols = _existing_columns("users")
    added_verify = "email_verified" not in cols

    with db.engine.begin() as conn:
        for name, col_type in needed.items():
            if name not in cols:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {name} {col_type}"))

        if added_verify:
            # Cuentas ya existentes (sin token de verificación pendiente) quedan OK
            conn.execute(
                text(
                    "UPDATE users SET email_verified = TRUE "
                    "WHERE email_verify_token IS NULL"
                )
            )
            conn.execute(
                text(
                    "UPDATE users SET email_verified = FALSE "
                    "WHERE email_verified IS NULL"
                )
            )


def init_db():
    db.create_all()
    if db.engine.dialect.name == "sqlite" and _table_exists("users"):
        from sqlalchemy import text

        cols = _existing_columns("users")
        with db.engine.begin() as conn:
            if "ruc" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN ruc INTEGER"))
            if "ruc_dv" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN ruc_dv INTEGER"))
            if "created_at" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN created_at DATETIME"))
    _ensure_user_auth_columns()
    seed_catalog()


# gunicorn (Render) no ejecuta __main__; crear tablas al importar la app
with app.app_context():
    try:
        init_db()
    except Exception:
        _startup_logger.exception(
            "Fallo al inicializar la base de datos (init_db). "
            "Revisa DATABASE_URL y los logs de migración."
        )
        raise


if __name__ == "__main__":
    app.run(debug=True, port=5000)
