from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def home():
    return {"message": "Hello Amar! Your backend is working 🎉"}
