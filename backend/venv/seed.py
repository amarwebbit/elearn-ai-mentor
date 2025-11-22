# backend/seed.py
from db import engine
from sqlmodel import Session, select
from models import User, Course, Lesson, Quiz
from auth import hash_password

def seed():
    with Session(engine) as s:
        # Create admin user if not exists
        admin_username = "amartripathi"
        admin_email = "amartripathi819@gmail.com"
        admin = s.exec(select(User).where(User.username == admin_username)).first()
        if not admin:
            admin_user = User(
                username=admin_username,
                email=admin_email,
                hashed_password=hash_password("Amartripathiroadtoengineer"),  # change to secure password
                is_admin=True
            )
            s.add(admin_user)
            s.commit()
            print("Admin user created:", admin_username)
        else:
            print("Admin user already exists.")

        # Optionally seed courses if not present (keeps existing seed behavior)
        course = s.exec(select(Course)).first()
        if not course:
            c = Course(slug="sample-course", title="Sample Course", description="Seeded sample course")
            s.add(c)
            s.commit()
            s.refresh(c)
            print("Sample course created with id", c.id)

            # add lessons
            l1 = Lesson(course_id=c.id, title="Lesson 1", content="Lesson 1 content", order=1)
            l2 = Lesson(course_id=c.id, title="Lesson 2", content="Lesson 2 content", order=2)
            s.add_all([l1, l2])
            s.commit()
            print("Sample lessons created")
        else:
            print("Courses already exist.")

if __name__ == "__main__":
    seed()
    print("Seeding complete.")
