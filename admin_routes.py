"""
Panel de administración — páginas protegidas (/admin/*) y API (/api/admin/*).

Solo usuarios con role == "admin" pueden acceder (ver admin_required_page /
admin_required_api en auth_routes.py).
"""
from flask import jsonify, render_template, request

from auth_routes import admin_required_api, admin_required_page, get_current_user
from emails import send_order_confirmed_to_customer, send_order_rejected_to_customer
from models import Address, Order, OrderItem, Product, User, db

ORDER_STATUSES = ["pending", "confirmed", "dispatched", "delivered", "rejected"]


# ── Helpers de validación ─────────────────────────────────────────────────────

def _parse_price(value, *, allow_zero: bool = True):
    """Convierte a float >= 0. None si es inválido."""
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    if allow_zero:
        if price < 0:
            return None
    elif price <= 0:
        return None
    return round(price, 2)


def register_admin_routes(app):

    # ── Páginas ────────────────────────────────────────────────────────────

    @app.route("/admin")
    @admin_required_page
    def admin_dashboard():
        return render_template(
            "admin/dashboard.html", admin=get_current_user(), active_nav="dashboard"
        )

    @app.route("/admin/products")
    @admin_required_page
    def admin_products_page():
        return render_template(
            "admin/products.html", admin=get_current_user(), active_nav="products"
        )

    @app.route("/admin/orders")
    @admin_required_page
    def admin_orders_page():
        return render_template(
            "admin/orders.html",
            admin=get_current_user(),
            active_nav="orders",
            statuses=ORDER_STATUSES,
        )

    @app.route("/admin/orders/<int:order_id>")
    @admin_required_page
    def admin_order_detail_page(order_id):
        order = db.session.get(Order, order_id)
        status_code = 200 if order else 404
        return render_template(
            "admin/order_detail.html",
            admin=get_current_user(),
            active_nav="orders",
            order_id=order_id,
            statuses=ORDER_STATUSES,
            not_found=order is None,
        ), status_code

    @app.route("/admin/users")
    @admin_required_page
    def admin_users_page():
        return render_template(
            "admin/users.html", admin=get_current_user(), active_nav="users"
        )

    @app.route("/admin/users/<int:user_id>")
    @admin_required_page
    def admin_user_detail_page(user_id):
        user = db.session.get(User, user_id)
        status_code = 200 if user else 404
        return render_template(
            "admin/user_detail.html",
            admin=get_current_user(),
            active_nav="users",
            user_id=user_id,
            not_found=user is None,
        ), status_code

    # ── API: dashboard ───────────────────────────────────────────────────────

    @app.route("/api/admin/stats")
    @admin_required_api
    def api_admin_stats():
        total_products = Product.query.count()
        active_products = Product.query.filter_by(is_active=True).count()
        total_users = User.query.filter_by(role="customer").count()
        total_orders = Order.query.count()
        pending_orders = Order.query.filter_by(status="pending").count()
        revenue = (
            db.session.query(db.func.coalesce(db.func.sum(Order.total_amount), 0.0))
            .filter(Order.status.in_(["confirmed", "dispatched", "delivered"]))
            .scalar()
        )
        recent_orders = (
            Order.query.order_by(Order.created_at.desc()).limit(5).all()
        )

        return jsonify({
            "total_products": total_products,
            "active_products": active_products,
            "total_users": total_users,
            "total_orders": total_orders,
            "pending_orders": pending_orders,
            "revenue": round(revenue or 0.0, 2),
            "recent_orders": [o.to_admin_dict(include_address=False) for o in recent_orders],
        })

    # ── API: productos ───────────────────────────────────────────────────────

    @app.route("/api/admin/products")
    @admin_required_api
    def api_admin_list_products():
        q = (request.args.get("q") or "").strip()
        query = Product.query
        if q:
            query = query.filter(Product.name.ilike(f"%{q}%"))
        products = query.order_by(Product.name).all()
        return jsonify([p.to_admin_dict() for p in products])

    @app.route("/api/admin/products", methods=["POST"])
    @admin_required_api
    def api_admin_create_product():
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        price_per_unit = _parse_price(data.get("price_per_unit"))
        price_per_lb = _parse_price(data.get("price_per_lb"))
        image_url = (data.get("image_url") or "").strip() or None

        errors = []
        if not name:
            errors.append("El nombre es obligatorio.")
        if price_per_unit is None:
            errors.append("El precio por unidad debe ser un número mayor o igual a 0.")
        if price_per_lb is None:
            errors.append("El precio por libra debe ser un número mayor o igual a 0.")
        if errors:
            return jsonify({"error": errors[0], "errors": errors}), 400

        product = Product(
            name=name,
            price_per_unit=price_per_unit,
            price_per_lb=price_per_lb,
            image_url=image_url,
            is_active=True,
        )
        db.session.add(product)
        db.session.commit()
        return jsonify({"ok": True, "product": product.to_admin_dict()}), 201

    @app.route("/api/admin/products/<int:product_id>", methods=["PUT"])
    @admin_required_api
    def api_admin_update_product(product_id):
        product = db.session.get(Product, product_id)
        if not product:
            return jsonify({"error": "Producto no encontrado."}), 404

        data = request.get_json(silent=True) or {}
        errors = []

        if "name" in data:
            name = (data.get("name") or "").strip()
            if not name:
                errors.append("El nombre no puede estar vacío.")
            else:
                product.name = name

        if "price_per_unit" in data:
            price = _parse_price(data.get("price_per_unit"))
            if price is None:
                errors.append("El precio por unidad debe ser un número mayor o igual a 0.")
            else:
                product.price_per_unit = price

        if "price_per_lb" in data:
            price = _parse_price(data.get("price_per_lb"))
            if price is None:
                errors.append("El precio por libra debe ser un número mayor o igual a 0.")
            else:
                product.price_per_lb = price

        if "image_url" in data:
            product.image_url = (data.get("image_url") or "").strip() or None

        if errors:
            return jsonify({"error": errors[0], "errors": errors}), 400

        db.session.commit()
        return jsonify({"ok": True, "product": product.to_admin_dict()})

    @app.route("/api/admin/products/multiply-prices", methods=["POST"])
    @admin_required_api
    def api_admin_multiply_prices():
        """
        Multiplica precios de todos los productos.
        Ej.: multiplier=1.10 sube 10%; multiplier=0.90 baja 10%.
        """
        data = request.get_json(silent=True) or {}
        try:
            multiplier = float(data.get("multiplier"))
        except (TypeError, ValueError):
            return jsonify({"error": "El multiplicador debe ser un número válido."}), 400

        if multiplier <= 0:
            return jsonify({"error": "El multiplicador debe ser mayor que 0."}), 400
        if multiplier > 10:
            return jsonify({
                "error": "El multiplicador no puede ser mayor que 10 (eso sería un aumento de 900%)."
            }), 400

        apply_to = (data.get("apply_to") or "both").strip().lower()
        if apply_to not in ("both", "lb", "unit"):
            return jsonify({
                "error": "apply_to inválido. Usa 'both', 'lb' o 'unit'."
            }), 400

        only_active = bool(data.get("only_active", False))
        query = Product.query
        if only_active:
            query = query.filter_by(is_active=True)

        products = query.all()
        if not products:
            return jsonify({"error": "No hay productos para actualizar."}), 400

        skipped_zero = 0
        changed = 0
        for product in products:
            if apply_to in ("both", "lb"):
                current_lb = float(product.price_per_lb or 0)
                if current_lb > 0:
                    product.price_per_lb = round(current_lb * multiplier, 2)
                    changed += 1
                else:
                    skipped_zero += 1
            if apply_to in ("both", "unit"):
                current_unit = float(product.price_per_unit or 0)
                if current_unit > 0:
                    product.price_per_unit = round(current_unit * multiplier, 2)
                    changed += 1
                else:
                    skipped_zero += 1

        if changed == 0:
            return jsonify({
                "error": "Ningún precio era mayor que 0; no hubo cambios.",
            }), 400

        db.session.commit()
        updated = [p.to_admin_dict() for p in Product.query.order_by(Product.name).all()]
        return jsonify({
            "ok": True,
            "multiplier": multiplier,
            "apply_to": apply_to,
            "updated_count": len(products),
            "changed_prices": changed,
            "skipped_zero_prices": skipped_zero,
            "products": updated,
        })

    @app.route("/api/admin/products/<int:product_id>/toggle", methods=["PATCH"])
    @admin_required_api
    def api_admin_toggle_product(product_id):
        product = db.session.get(Product, product_id)
        if not product:
            return jsonify({"error": "Producto no encontrado."}), 404

        product.is_active = not product.is_active
        db.session.commit()
        return jsonify({"ok": True, "product": product.to_admin_dict()})

    @app.route("/api/admin/products/<int:product_id>", methods=["DELETE"])
    @admin_required_api
    def api_admin_delete_product(product_id):
        product = db.session.get(Product, product_id)
        if not product:
            return jsonify({"error": "Producto no encontrado."}), 404

        used = OrderItem.query.filter_by(product_id=product.id).count()
        if used:
            return jsonify({
                "error": (
                    f"No se puede borrar «{product.name}»: aparece en {used} línea(s) "
                    "de pedidos. Desactívalo para ocultarlo del catálogo."
                ),
            }), 409

        name = product.name
        db.session.delete(product)
        db.session.commit()
        return jsonify({"ok": True, "deleted_id": product_id, "name": name})

    # ── API: órdenes ──────────────────────────────────────────────────────────

    @app.route("/api/admin/orders")
    @admin_required_api
    def api_admin_list_orders():
        status = (request.args.get("status") or "").strip()
        q = (request.args.get("q") or "").strip()
        user_id = request.args.get("user_id")
        sort = (request.args.get("sort") or "created_at").strip()
        direction = (request.args.get("dir") or "desc").strip()

        query = Order.query.join(User, Order.user_id == User.id)

        if status and status in ORDER_STATUSES:
            query = query.filter(Order.status == status)

        if user_id:
            try:
                query = query.filter(Order.user_id == int(user_id))
            except ValueError:
                pass

        if q:
            like = f"%{q}%"
            query = query.filter(
                db.or_(User.name.ilike(like), User.email.ilike(like))
            )

        sort_column = {
            "created_at": Order.created_at,
            "total_amount": Order.total_amount,
        }.get(sort, Order.created_at)

        query = query.order_by(
            sort_column.asc() if direction == "asc" else sort_column.desc()
        )

        orders = query.all()
        return jsonify([o.to_admin_dict(include_address=False) for o in orders])

    @app.route("/api/admin/orders/<int:order_id>")
    @admin_required_api
    def api_admin_order_detail(order_id):
        order = db.session.get(Order, order_id)
        if not order:
            return jsonify({"error": "Orden no encontrada."}), 404
        return jsonify(order.to_admin_dict())

    @app.route("/api/admin/orders/<int:order_id>/status", methods=["PUT"])
    @admin_required_api
    def api_admin_update_order_status(order_id):
        order = db.session.get(Order, order_id)
        if not order:
            return jsonify({"error": "Orden no encontrada."}), 404

        data = request.get_json(silent=True) or {}
        new_status = (data.get("status") or "").strip().lower()
        rejection_reason = (data.get("rejection_reason") or "").strip() or None

        if new_status not in ORDER_STATUSES:
            return jsonify({
                "error": f"Estado inválido. Usa uno de: {', '.join(ORDER_STATUSES)}."
            }), 400

        if new_status == "rejected" and not rejection_reason:
            return jsonify({"error": "Indica el motivo del rechazo."}), 400

        previous_status = order.status
        order.status = new_status
        order.rejection_reason = rejection_reason if new_status == "rejected" else None
        db.session.commit()

        if previous_status != new_status:
            user = order.user
            if new_status == "confirmed":
                send_order_confirmed_to_customer(order, user)
            elif new_status == "rejected":
                send_order_rejected_to_customer(order, user)

        return jsonify({"ok": True, "order": order.to_admin_dict()})

    # ── API: usuarios ─────────────────────────────────────────────────────────

    @app.route("/api/admin/users")
    @admin_required_api
    def api_admin_list_users():
        q = (request.args.get("q") or "").strip()
        account_type = (request.args.get("account_type") or "").strip()
        sort = (request.args.get("sort") or "name").strip()
        direction = (request.args.get("dir") or "asc").strip()

        query = User.query.filter(User.role == "customer")

        if q:
            like = f"%{q}%"
            query = query.filter(
                db.or_(User.name.ilike(like), User.email.ilike(like), User.phone.ilike(like))
            )

        if account_type in ("persona", "empresa"):
            query = query.filter(User.account_type == account_type)

        sort_column = {
            "name": User.name,
            "created_at": User.created_at,
        }.get(sort, User.name)

        query = query.order_by(
            sort_column.asc() if direction == "asc" else sort_column.desc()
        )

        users = query.all()
        return jsonify([u.to_dict() for u in users])

    @app.route("/api/admin/users/<int:user_id>")
    @admin_required_api
    def api_admin_user_detail(user_id):
        user = db.session.get(User, user_id)
        if not user:
            return jsonify({"error": "Usuario no encontrado."}), 404

        address = Address.query.filter_by(user_id=user.id, is_active=True).first()
        orders = (
            Order.query.filter_by(user_id=user.id)
            .order_by(Order.created_at.desc())
            .all()
        )

        return jsonify({
            "user": user.to_dict(),
            "address": address.to_dict() if address else None,
            "orders": [o.to_admin_dict(include_user=False, include_address=False) for o in orders],
        })

    @app.route("/api/admin/users/<int:user_id>/verify-email", methods=["POST"])
    @admin_required_api
    def api_admin_verify_user_email(user_id):
        """Marca el correo como verificado (útil si Resend no entregó el link)."""
        user = db.session.get(User, user_id)
        if not user:
            return jsonify({"error": "Usuario no encontrado."}), 404
        user.email_verified = True
        user.email_verify_token = None
        user.email_verify_sent_at = None
        db.session.commit()
        return jsonify({"ok": True, "user": user.to_dict()})

    @app.route("/api/admin/users/<int:user_id>", methods=["DELETE"])
    @admin_required_api
    def api_admin_delete_user(user_id):
        user = db.session.get(User, user_id)
        if not user:
            return jsonify({"error": "Usuario no encontrado."}), 404
        if user.is_admin:
            return jsonify({"error": "No se puede borrar una cuenta de administrador."}), 403
        current = get_current_user()
        if current and current.id == user.id:
            return jsonify({"error": "No puedes borrar tu propia cuenta."}), 403

        for order in list(user.orders):
            for item in list(order.items):
                db.session.delete(item)
            db.session.delete(order)
        for address in list(user.addresses):
            db.session.delete(address)
        name = user.name
        db.session.delete(user)
        db.session.commit()
        return jsonify({"ok": True, "deleted_id": user_id, "name": name})
