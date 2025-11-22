from sqlmodel import Session, select
from db import engine
from models import Progress, QuizAttempt

with Session(engine) as s:
    p = s.exec(select(Progress)).all()
    print("Progress rows:", p)
    qa = s.exec(select(QuizAttempt)).all()
    print("QuizAttempt rows:", qa)
