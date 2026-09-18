from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    phone = db.Column(db.String(20))
    account_type = db.Column(db.String(20), default="persona")  # persona / empresa
    ruc = db.Column(db.Integer, nullable=True)
    ruc_dv = db.Column(db.Integer, nullable=True)
    role = db.Column(db.String(20), default="customer")  # admin / customer
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, nullable=True)

    # Verificación de correo (clientes nuevos deben confirmar antes de entrar)
    email_verified = db.Column(db.Boolean, default=False, nullable=False)
    email_verify_token = db.Column(db.String(64), nullable=True, index=True)
    email_verify_sent_at = db.Column(db.DateTime, nullable=True)

    # Recuperación de contraseña
    password_reset_token = db.Column(db.String(64), nullable=True, index=True)
    password_reset_sent_at = db.Column(db.DateTime, nullable=True)

    addresses = db.relationship("Address", backref="user", lazy=True)
    orders = db.relationship("Order", backref="user", lazy=True)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def to_dict(self):
        """Representación segura (sin password_hash) para el panel admin."""
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "phone": self.phone,
            "account_type": self.account_type,
            "ruc": self.ruc,
            "ruc_dv": self.ruc_dv,
            "role": self.role,
            "is_active": self.is_active,
            "email_verified": self.email_verified,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "orders_count": len(self.orders),
        }


class Address(db.Model):
    __tablename__ = "addresses"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    address_line = db.Column(db.String(200), nullable=False)
    corregimiento = db.Column(db.String(100))   # siempre Panamá City

    # Se llenará cuando el mapa esté integrado
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)

    is_active = db.Column(db.Boolean, default=True)

    def to_dict(self):
        return {
            "id": self.id,
            "address_line": self.address_line,
            "corregimiento": self.corregimiento,
            "latitude": self.latitude,
            "longitude": self.longitude,
        }


class Product(db.Model):
    __tablename__ = "products"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    price_per_unit = db.Column(db.Float, nullable=False)
    price_per_lb = db.Column(db.Float, nullable=False)
    image_url = db.Column(db.Text)
    is_active = db.Column(db.Boolean, default=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "pricePerUnit": self.price_per_unit,
            "pricePerLb": self.price_per_lb,
            "imageUrl": self.image_url,
        }

    def to_admin_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "price_per_unit": self.price_per_unit,
            "price_per_lb": self.price_per_lb,
            "image_url": self.image_url,
            "is_active": self.is_active,
        }


class Order(db.Model):
    __tablename__ = "orders"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    address_id = db.Column(db.Integer, db.ForeignKey("addresses.id"), nullable=False)

    payment_method = db.Column(db.String(20), nullable=False, default="pending")  # pending / ach / yappy
    status = db.Column(db.String(30), nullable=False, default="pending")
    # pending → confirmed → delivered → rejected
    total_amount = db.Column(db.Float, nullable=False)
    notes = db.Column(db.String(300))
    created_at = db.Column(db.DateTime, nullable=False)
    rejection_reason = db.Column(db.String(300),nullable=True)

    items = db.relationship("OrderItem", backref="order", lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "status": self.status,
            "payment_method": self.payment_method,
            "total_amount": self.total_amount,
            "notes": self.notes,
            "created_at": self.created_at.isoformat(),
            "rejection_reason": self.rejection_reason,
            "items": [i.to_dict() for i in self.items],
        }

    def to_admin_dict(self, include_user=True, include_address=True):
        data = self.to_dict()
        data["rejection_reason"] = self.rejection_reason
        if include_user and self.user:
            data["user"] = {
                "id": self.user.id,
                "name": self.user.name,
                "email": self.user.email,
                "phone": self.user.phone,
            }
        if include_address:
            address = db.session.get(Address, self.address_id)
            data["address"] = address.to_dict() if address else None
        return data


class OrderItem(db.Model):
    __tablename__ = "order_items"

    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id"), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey("products.id"), nullable=False)

    product_name = db.Column(db.String(100), nullable=False)  # snapshot del nombre
    unit_type = db.Column(db.String(10), nullable=False)       # unit / lb
    unit_price = db.Column(db.Float, nullable=False)           # precio al momento
    quantity = db.Column(db.Float, nullable=False)
    subtotal = db.Column(db.Float, nullable=False)

    product = db.relationship("Product", backref="order_items")

    def to_dict(self):
        return {
            "id": self.id,
            "product_id": self.product_id,
            "product_name": self.product_name,
            "unit_type": self.unit_type,
            "unit_price": self.unit_price,
            "quantity": self.quantity,
            "subtotal": self.subtotal,
        }
