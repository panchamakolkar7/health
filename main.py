"""
Smart Medicine Reminder - main.py
All-in-one: Database setup, Models, Schemas, and FastAPI routes.
SQLite by default; switch to PostgreSQL by changing DATABASE_URL env var.
"""

import os
import httpx
from datetime import date, datetime
from contextlib import asynccontextmanager
from typing import Optional, List

from fastapi import FastAPI, Depends, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship

# ─────────────────────────────────────────────────────────────────────────────
# DATABASE SETUP
# To migrate to PostgreSQL later: set DATABASE_URL=postgresql://user:pass@host/db
# ─────────────────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./medicine_reminder.db")

engine = create_engine(
    DATABASE_URL,
    # check_same_thread is SQLite-only; ignored by PostgreSQL
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ─────────────────────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────────────────────
class Medicine(Base):
    """Stores each medicine the user wants to track."""
    __tablename__ = "medicines"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(100), nullable=False)
    dosage      = Column(String(50),  nullable=False)   # e.g. "500mg", "2 tablets"
    time_of_day = Column(String(10),  nullable=False)   # stored as "HH:MM" (24-hr)
    notes       = Column(Text,        nullable=True)
    created_at  = Column(DateTime,    default=datetime.utcnow)

    logs = relationship("MedicineLog", back_populates="medicine", cascade="all, delete-orphan")


class MedicineLog(Base):
    """Records every time a medicine is marked as taken."""
    __tablename__ = "medicine_logs"

    id          = Column(Integer, primary_key=True, index=True)
    medicine_id = Column(Integer, ForeignKey("medicines.id"), nullable=False)
    taken_date  = Column(Date,     default=date.today)       # for daily deduplication
    taken_at    = Column(DateTime, default=datetime.utcnow)  # exact timestamp

    medicine = relationship("Medicine", back_populates="logs")


# Create tables (safe to call multiple times; skips existing tables)
Base.metadata.create_all(bind=engine)


# ─────────────────────────────────────────────────────────────────────────────
# PYDANTIC SCHEMAS  (request / response validation)
# ─────────────────────────────────────────────────────────────────────────────
class MedicineCreate(BaseModel):
    name:        str
    dosage:      str
    time_of_day: str
    notes:       Optional[str] = None


class MedicineUpdate(BaseModel):
    name:        Optional[str] = None
    dosage:      Optional[str] = None
    time_of_day: Optional[str] = None
    notes:       Optional[str] = None


class MedicineOut(BaseModel):
    id:          int
    name:        str
    dosage:      str
    time_of_day: str
    notes:       Optional[str]
    created_at:  datetime

    class Config:
        from_attributes = True   # Pydantic v2 ORM mode


class DashboardItem(BaseModel):
    id:          int
    name:        str
    dosage:      str
    time_of_day: str
    notes:       Optional[str]
    is_taken:    bool
    taken_at:    Optional[datetime]


# ─────────────────────────────────────────────────────────────────────────────
# DB DEPENDENCY
# ─────────────────────────────────────────────────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# NOTIFICATION HOOK
# Set WEBHOOK_URL env var to plug in Telegram, Slack, or any HTTP webhook.
#
# Telegram example:
#   WEBHOOK_URL=https://api.telegram.org/bot<TOKEN>/sendMessage
#   Also set TELEGRAM_CHAT_ID env var.
# ─────────────────────────────────────────────────────────────────────────────
WEBHOOK_URL      = os.getenv("WEBHOOK_URL", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")


async def send_webhook_notification(message: str):
    """
    Fires an HTTP POST to WEBHOOK_URL with the reminder message.
    Runs in the background so it never blocks API responses.
    """
    if not WEBHOOK_URL:
        print(f"[Notification] No webhook configured. Message: {message}")
        return
    try:
        payload = {"text": message}
        if TELEGRAM_CHAT_ID:           # Telegram-specific field
            payload["chat_id"] = TELEGRAM_CHAT_ID
        async with httpx.AsyncClient() as client:
            resp = await client.post(WEBHOOK_URL, json=payload, timeout=5.0)
            print(f"[Notification] Sent ({resp.status_code}): {message}")
    except Exception as exc:
        print(f"[Notification] Failed: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# APP STARTUP
# ─────────────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🏥  Smart Medicine Reminder is running!")
    yield
    print("🏥  Shutting down.")


app = FastAPI(title="Smart Medicine Reminder", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


# ─────────────────────────────────────────────────────────────────────────────
# FRONTEND  – serves the single-page application
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def serve_app(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# ─────────────────────────────────────────────────────────────────────────────
# MEDICINE CRUD
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/medicines", response_model=List[MedicineOut])
def list_medicines(db: Session = Depends(get_db)):
    """Return all medicines sorted by scheduled time."""
    return db.query(Medicine).order_by(Medicine.time_of_day).all()


@app.post("/api/medicines", response_model=MedicineOut, status_code=201)
def create_medicine(payload: MedicineCreate, db: Session = Depends(get_db)):
    """Add a new medicine to the schedule."""
    med = Medicine(**payload.model_dump())
    db.add(med)
    db.commit()
    db.refresh(med)
    return med


@app.put("/api/medicines/{med_id}", response_model=MedicineOut)
def update_medicine(med_id: int, payload: MedicineUpdate, db: Session = Depends(get_db)):
    """Edit an existing medicine's details."""
    med = db.query(Medicine).filter(Medicine.id == med_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medicine not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(med, field, value)
    db.commit()
    db.refresh(med)
    return med


@app.delete("/api/medicines/{med_id}", status_code=204)
def delete_medicine(med_id: int, db: Session = Depends(get_db)):
    """Permanently remove a medicine (and all its logs via cascade)."""
    med = db.query(Medicine).filter(Medicine.id == med_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medicine not found")
    db.delete(med)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# DASHBOARD  – today's schedule with taken/pending status
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/api/dashboard", response_model=List[DashboardItem])
def get_dashboard(db: Session = Depends(get_db)):
    """Return today's medicines with their taken/pending status."""
    today     = date.today()
    medicines = db.query(Medicine).order_by(Medicine.time_of_day).all()
    result    = []

    for med in medicines:
        log = (
            db.query(MedicineLog)
            .filter(MedicineLog.medicine_id == med.id, MedicineLog.taken_date == today)
            .first()
        )
        result.append(DashboardItem(
            id          = med.id,
            name        = med.name,
            dosage      = med.dosage,
            time_of_day = med.time_of_day,
            notes       = med.notes,
            is_taken    = log is not None,
            taken_at    = log.taken_at if log else None,
        ))
    return result


# ─────────────────────────────────────────────────────────────────────────────
# MARK AS TAKEN  (toggles taken ↔ pending)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/medicines/{med_id}/take")
async def toggle_taken(
    med_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Toggle a medicine's status for today.
    First press  → marks as taken, fires webhook notification.
    Second press → unmarks (pending again).
    """
    med = db.query(Medicine).filter(Medicine.id == med_id).first()
    if not med:
        raise HTTPException(status_code=404, detail="Medicine not found")

    today    = date.today()
    existing = (
        db.query(MedicineLog)
        .filter(MedicineLog.medicine_id == med_id, MedicineLog.taken_date == today)
        .first()
    )

    if existing:
        # Unmark – delete today's log entry
        db.delete(existing)
        db.commit()
        return {"status": "pending", "message": f"{med.name} marked as pending"}

    # Mark as taken
    db.add(MedicineLog(medicine_id=med_id, taken_date=today))
    db.commit()

    # Fire webhook asynchronously (won't delay the API response)
    background_tasks.add_task(
        send_webhook_notification,
        f"✅ {med.name} ({med.dosage}) taken at {datetime.now().strftime('%I:%M %p')}",
    )
    return {"status": "taken", "message": f"{med.name} marked as taken! 💊"}


# ─────────────────────────────────────────────────────────────────────────────
# NOTIFICATION TRIGGER ENDPOINT
# Call this from a cron job / external scheduler to push reminders.
# curl -X POST https://your-app.onrender.com/api/notifications/send
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/notifications/send")
async def trigger_reminders(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Sends a webhook message listing all pending medicines for today.
    Designed to be called by an external cron scheduler for timed reminders.
    """
    today     = date.today()
    medicines = db.query(Medicine).all()
    pending   = []

    for med in medicines:
        log = (
            db.query(MedicineLog)
            .filter(MedicineLog.medicine_id == med.id, MedicineLog.taken_date == today)
            .first()
        )
        if not log:
            pending.append(f"• {med.name} ({med.dosage}) — scheduled at {med.time_of_day}")

    if pending:
        msg = "⏰ Medicine Reminder!\nPending for today:\n" + "\n".join(pending)
        background_tasks.add_task(send_webhook_notification, msg)
        return {"status": "sent", "pending_count": len(pending), "pending": pending}

    return {"status": "all_taken", "message": "🎉 All medicines taken today!"}


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT  (for local development: python main.py)
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
