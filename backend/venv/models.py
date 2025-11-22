# backend/models.py
# --- models.py (only show User part) ---
from sqlmodel import SQLModel, Field
from typing import Optional

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    is_admin: bool = Field(default=False)   # NEW field

class Course(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    slug: str = Field(index=True, unique=True)
    title: str
    description: Optional[str] = None

class Lesson(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    course_id: int = Field(foreign_key="course.id")
    title: str
    content: str
    order: int = 0

class Quiz(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    course_id: int = Field(foreign_key="course.id")
    json_content: str

class Enrollment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    course_id: int = Field(foreign_key="course.id")
from datetime import datetime
from sqlmodel import SQLModel, Field
from typing import Optional

class Progress(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    lesson_id: int = Field(foreign_key="lesson.id")
    completed_at: Optional[datetime] = Field(default_factory=datetime.utcnow)


class QuizAttempt(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    course_id: int = Field(foreign_key="course.id")
    submitted_at: Optional[datetime] = Field(default_factory=datetime.utcnow)
    score: float
    raw_response: str   # JSON string of user's answers
# models.py (add these classes or merge with your existing models file)
from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field, Relationship

class Media(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    filename: str
    file_path: str  # path served by /static, e.g. "/static/uploads/xxx.mp4"
    content_type: Optional[str] = None
    size: Optional[int] = None
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)
    uploaded_by: Optional[int] = None  # user id of uploader (if you have users)

# If you want lessons to reference media with a foreign key, add/update Lesson model:
# (If your Lesson model already exists, just add media_id field.)
from sqlmodel import ForeignKey

class Lesson(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    content: Optional[str] = None
    media_id: Optional[int] = Field(default=None, foreign_key="media.id")
