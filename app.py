
import os
from functools import wraps

from flask import (
    Flask,
    jsonify,
    render_template,
    request,
    session,
)
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)

# Set FLASK_SECRET_KEY in your environment before running.
app.config["SECRET_KEY"] = os.environ.get(
    "FLASK_SECRET_KEY",
    "dev-only-change-this-secret-key"
)

app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"

# Demo credentials for your capstone project.
USERNAME = "capstone"
PASSWORD_HASH = generate_password_hash("admin")


def login_required(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        if not session.get("logged_in"):
            return jsonify({
                "success": False,
                "message": "Please log in first."
            }), 401

        return function(*args, **kwargs)

    return wrapper


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}

    username = data.get("username", "")
    password = data.get("password", "")

    if (
        isinstance(username, str)
        and isinstance(password, str)
        and username == USERNAME
        and check_password_hash(PASSWORD_HASH, password)
    ):
        session.clear()
        session["logged_in"] = True
        session["username"] = USERNAME

        return jsonify({
            "success": True,
            "message": "Login successful."
        })

    return jsonify({
        "success": False,
        "message": "Invalid username or password."
    }), 401


@app.route("/api/session", methods=["GET"])
def check_session():
    return jsonify({
        "logged_in": bool(session.get("logged_in")),
        "username": session.get("username")
    })


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()

    return jsonify({
        "success": True,
        "message": "Logged out successfully."
    })


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=False
    )