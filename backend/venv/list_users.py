# list_users.py — prints users in the DB
from sqlmodel import Session, select
from db import engine
from models import User

with Session(engine) as s:
    users = s.exec(select(User)).all()
    if not users:
        print("No users found.")
    else:
        for u in users:
            print("id:", u.id, "username:", repr(u.username), "email:", repr(u.email), "hashed_len:", len(u.hashed_password or ""))
