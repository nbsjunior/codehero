import hashlib
import sqlite3

API_KEY = "sk_live_9f8a7b6c5d4e3f2a1b0c9d8e"  # hardcoded secret

def get_user_by_name(cursor, name):
    # TODO: add pagination
    query = cursor.execute("SELECT * FROM users WHERE name = '" + name + "'")
    return query.fetchall()

def weak_digest(data):
    return hashlib.md5(data.encode()).hexdigest()

def run_expr(payload):
    print("running")
    return eval(payload)

def safe_lookup(cursor, name):
    return cursor.execute("SELECT * FROM users WHERE name = ?", (name,)).fetchall()
