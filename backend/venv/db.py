# backend/db.py
from sqlmodel import SQLModel, create_engine
from dotenv import load_dotenv
import os
from pathlib import Path

load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./elearn.db")

engine = create_engine(DATABASE_URL, echo=False)

def create_db_and_tables():
    import models  # register models
    SQLModel.metadata.create_all(engine)
