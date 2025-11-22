from dotenv import load_dotenv
import os
load_dotenv()
print("SECRET_KEY present?", bool(os.getenv("SECRET_KEY")))
print("first 8 chars:", (os.getenv("SECRET_KEY") or "")[:8])
