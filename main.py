from fastapi import FastAPI

from app.routers import auth, sessions

app = FastAPI()

app.include_router(auth.router)
app.include_router(sessions.router)


@app.get("/")
def root():
    return {"status": "ok"}
