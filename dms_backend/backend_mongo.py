# backend_mongo.py
from __future__ import annotations

import os
import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List


from fastapi import FastAPI, Query, HTTPException, WebSocket, WebSocketDisconnect, File, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument

# ================== Logging ==================
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("dms")

# ================== Mongo config ==================

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DMS_DB_NAME", "dms")

client = AsyncIOMotorClient(MONGO_URI)
db = client[DB_NAME]
alerts_col = db["alerts"]
counters_col = db["counters"]
settings_col = db["settings"]  


async def get_next_id(seq_name: str) -> int:
    """
    Tạo auto-increment id kiểu SQL.
    counters: { _id: "alerts", seq: 1 }
    """
    doc = await counters_col.find_one_and_update(
        {"_id": seq_name},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return int(doc["seq"])


# ================== Pydantic models ==================

class AlertIn(BaseModel):
    class_: str = Field(..., alias="class")  # map JSON {"class": "..."}
    count: int = 1
    message: Optional[str] = None
    speed: Optional[float] = None
    snapshot_url: Optional[str] = None
    audio_url: Optional[str] = None
    time: Optional[str] = None  # client có thể gửi sẵn timestamp
    drive_minutes: Optional[int] = None


    buzzer: Optional[bool] = None

    class Config:
        populate_by_name = True


class AlertOut(BaseModel):
    id: int
    class_: str = Field(..., alias="class")
    count: int
    message: Optional[str] = None
    speed: Optional[float] = None
    snapshot_url: Optional[str] = None
    audio_url: Optional[str] = None
    created_at: str
    drive_minutes: Optional[int] = None
    buzzer: Optional[bool] = None

    class Config:
        populate_by_name = True


def doc_to_alert(doc: dict) -> AlertOut:
    return AlertOut(
        id=int(doc["id"]),
        class_=doc["class"],
        count=int(doc.get("count", 1)),
        message=doc.get("message"),
        speed=doc.get("speed"),
        snapshot_url=doc.get("snapshot_url"),
        audio_url=doc.get("audio_url"),
        created_at=doc.get("created_at"),
        drive_minutes=doc.get("drive_minutes"),
        buzzer=doc.get("buzzer"),
    )


class LatestAlertResponse(BaseModel):
    latest: Optional[AlertOut] = None


class DashboardOverview(BaseModel):
    drowsy: int
    phone: int
    turning: int
    total: int
    avg_speed: Optional[float] = None
    last_alert: Optional[str] = None
    last_class: Optional[str] = None


class MonthlyPoint(BaseModel):
    month: str  # "2025-11"
    count: int


class DailyPoint(BaseModel):
    date: str  # "MM-DD"
    count: int


class SystemStatus(BaseModel):
    esp32: bool
    rtsp: bool
    backend: bool


class SettingsModel(BaseModel):

    enable_drowsy: Optional[bool] = None
    enable_texting_phone: Optional[bool] = None
    enable_talking_phone: Optional[bool] = None
    enable_turning: Optional[bool] = None

    detection_duration_sec: Optional[int] = None
    detection_duration_drowsy_sec: Optional[int] = None
    detection_duration_texting_phone_sec: Optional[int] = None
    detection_duration_talking_phone_sec: Optional[int] = None
    detection_duration_turning_sec: Optional[int] = None

    cooldown_drowsy_sec: Optional[int] = None
    cooldown_texting_phone_sec: Optional[int] = None
    cooldown_talking_phone_sec: Optional[int] = None
    cooldown_turning_sec: Optional[int] = None

    buzzer_enabled: Optional[bool] = None
    buzzer_cooldown_sec: Optional[int] = None


class SettingsUpdate(SettingsModel):
    """
    Model dùng cho PUT /api/settings – giống SettingsModel
    nhưng thêm admin_password (không lưu vào DB).
    """
    admin_password: Optional[str] = None


# ================== FastAPI app ==================

app = FastAPI(title="DMS Backend (MongoDB)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SNAPSHOT_DIR = os.getenv("DMS_SNAPSHOT_DIR", "snapshots")
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

app.mount(
    "/snapshots",
    StaticFiles(directory=SNAPSHOT_DIR),
    name="snapshots",
)

# ================== MJPEG LIVE STREAM =================
GLOBAL_LATEST_FRAME = b""
FRAME_EVENT = asyncio.Event() 

@app.post("/api/live/push_frame")
async def push_frame(file: bytes = File(...)):
    """
    AI script sẽ gọi API này thay vì cv2.imwrite
    """
    global GLOBAL_LATEST_FRAME
    GLOBAL_LATEST_FRAME = file
    FRAME_EVENT.set()
    FRAME_EVENT.clear()
    return {"ok": True}

@app.get("/api/live/latest.jpg")
async def live_latest_jpg():
    if not GLOBAL_LATEST_FRAME:
        # Trả về ảnh mặc định hoặc 404 nếu chưa có frame nào
        raise HTTPException(status_code=404, detail="No frame available yet")
    # Trả về trực tiếp từ RAM
    return Response(content=GLOBAL_LATEST_FRAME, media_type="image/jpeg")

@app.get("/api/live/mjpeg")
async def live_mjpeg(fps: int = Query(20, ge=1, le=60)):
    """
    Stream MJPEG từ RAM.
    Sử dụng asyncio.Event để chỉ gửi khi CÓ ẢNH MỚI (tiết kiệm băng thông tối đa)
    """
    boundary = "frame"

    async def gen():
        while True:
            try:
                await asyncio.wait_for(FRAME_EVENT.wait(), timeout=1.0/fps)
            except asyncio.TimeoutError:
                pass
            
            if GLOBAL_LATEST_FRAME:
                yield (
                    b"--" + boundary.encode() + b"\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(GLOBAL_LATEST_FRAME)).encode() + b"\r\n\r\n"
                    + GLOBAL_LATEST_FRAME + b"\r\n"
                )
            
            await asyncio.sleep(0.001) 

    return StreamingResponse(
        gen(),
        media_type=f"multipart/x-mixed-replace; boundary={boundary}",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )

# ================== Live State  ==================

LIVE_STATE = {
    "ts": None,             # ISO string
    "state": "UNKNOWN",     # AWAKE / DROWSY / PHONE / TURNING / UNKNOWN
    "speed": None,          # optional
    "alert_id": None,       # optional
    "spark": [],            # rolling series
    "drowsy_60s": 0,
    "alerts_per_min": 0.0,
}


@app.get("/api/live/state")
async def get_live_state():
    return LIVE_STATE


@app.post("/api/live/state")
async def set_live_state(payload: dict):
    for k in LIVE_STATE.keys():
        if k in payload:
            LIVE_STATE[k] = payload[k]
    return {"ok": True}


# ================== WebSocket: ESP32 realtime alerts ==================

class ESP32WSManager:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)
        log.info("[WS] ESP32 connected. total=%d", len(self.clients))

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)
        log.info("[WS] ESP32 disconnected. total=%d", len(self.clients))

    async def push_alert(self, alert: dict) -> None:
        """Push alert JSON tới tất cả ESP32 đang kết nối."""
        if not self.clients:
            return

        payload = json.dumps(alert, ensure_ascii=False)
        dead: list[WebSocket] = []

        for ws in list(self.clients):
            try:
                await ws.send_text(payload)
            except Exception as e:
                log.warning("[WS] send failed -> drop client: %s", e)
                dead.append(ws)

        for ws in dead:
            self.clients.discard(ws)


esp32_ws = ESP32WSManager()


@app.websocket("/ws/esp32")
async def ws_esp32(ws: WebSocket):
    """ESP32 connect vào đây để nhận cảnh báo realtime (push)."""
    await esp32_ws.connect(ws)
    try:
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        esp32_ws.disconnect(ws)
    except Exception as e:
        log.warning("[WS] ws_esp32 error: %s", e)
        esp32_ws.disconnect(ws)


# ================== WebSocket: WEB timeline realtime ==================

class WebTimelineWSManager:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)
        log.info("[WS] WEB timeline connected. total=%d", len(self.clients))

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)
        log.info("[WS] WEB timeline disconnected. total=%d", len(self.clients))

    async def broadcast(self, payload: dict) -> None:
        if not self.clients:
            return

        msg = json.dumps(payload, ensure_ascii=False)
        dead: list[WebSocket] = []

        for ws in list(self.clients):
            try:
                await ws.send_text(msg)
            except Exception as e:
                log.warning("[WS] timeline send failed -> drop client: %s", e)
                dead.append(ws)

        for ws in dead:
            self.clients.discard(ws)


timeline_ws = WebTimelineWSManager()


@app.websocket("/ws/timeline")
async def ws_timeline(ws: WebSocket):
    """Web (Live page) connect vào đây để nhận alert realtime timeline."""
    await timeline_ws.connect(ws)
    try:
        while True:
            # giống ws_esp32: giữ sống, UI có thể ping hoặc không
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        timeline_ws.disconnect(ws)
    except Exception as e:
        log.warning("[WS] ws_timeline error: %s", e)
        timeline_ws.disconnect(ws)


# ========== PC YOLO gửi alert lên =====================

@app.post("/api/alerts", response_model=AlertOut)
async def create_alert(alert: AlertIn):
    created_at = alert.time or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    new_id = await get_next_id("alerts")

    doc = {
        "id": new_id,
        "class": alert.class_,
        "count": alert.count,
        "message": alert.message,
        "speed": alert.speed,
        "snapshot_url": alert.snapshot_url,
        "audio_url": alert.audio_url,
        "created_at": created_at,
        "drive_minutes": alert.drive_minutes,
        "buzzer": bool(alert.buzzer) if alert.buzzer is not None else None,
    }

    await alerts_col.insert_one(doc)

    # Push realtime cho ESP32 qua WebSocket (không block request)
    payload = doc_to_alert(doc).dict(by_alias=True)
    try:
        asyncio.create_task(esp32_ws.push_alert(payload))
    except Exception as e:
        log.warning("[WS] create_task push_alert failed: %s", e)

    # Push realtime cho WEB timeline (không block request)
    try:
        asyncio.create_task(timeline_ws.broadcast(payload))
    except Exception as e:
        log.warning("[WS] create_task timeline broadcast failed: %s", e)

    return doc_to_alert(doc)


# ========== ESP32 poll alert mới  ======================

@app.get("/api/alerts/next", response_model=List[AlertOut])
async def get_next_alerts(
    after_id: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=100),
):
    cursor = (
        alerts_col.find({"id": {"$gt": after_id}})
        .sort("id", 1)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)
    return [doc_to_alert(d) for d in docs]


# ========== Lịch sử cho web Alerts History ===========

@app.get("/api/alerts/history", response_model=List[AlertOut])
async def get_history(
    limit: int = Query(100, ge=1, le=500),
):
    cursor = alerts_col.find().sort("id", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    return [doc_to_alert(d) for d in docs]


# ========== Alert mới nhất cho Live ===================

@app.get("/api/alerts/latest", response_model=LatestAlertResponse)
async def get_latest():
    doc = await alerts_col.find_one(sort=[("id", -1)])
    if not doc:
        return {"latest": None}
    return {"latest": doc_to_alert(doc)}


# ========== Dashboard overview ========================

@app.get("/api/dashboard/overview", response_model=DashboardOverview)
async def get_dashboard_overview():
    pipeline = [
        {
            "$group": {
                "_id": None,
                "drowsy": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$class", "drowsy"]},
                            1,
                            0,
                        ]
                    }
                },
                "phone": {
                    "$sum": {
                        "$cond": [
                            {
                                "$in": [
                                    "$class",
                                    ["texting_phone", "talking_phone"],
                                ]
                            },
                            1,
                            0,
                        ]
                    }
                },
                "turning": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$class", "turning"]},
                            1,
                            0,
                        ]
                    }
                },
                "total": {"$sum": 1},
                "avg_speed": {"$avg": "$speed"},
            }
        }
    ]

    agg = await alerts_col.aggregate(pipeline).to_list(length=1)
    if agg:
        stat = agg[0]
    else:
        stat = {
            "drowsy": 0,
            "phone": 0,
            "turning": 0,
            "total": 0,
            "avg_speed": None,
        }

    latest = await alerts_col.find_one(sort=[("id", -1)])

    return DashboardOverview(
        drowsy=int(stat.get("drowsy") or 0),
        phone=int(stat.get("phone") or 0),
        turning=int(stat.get("turning") or 0),
        total=int(stat.get("total") or 0),
        avg_speed=stat.get("avg_speed"),
        last_alert=latest["created_at"] if latest else None,
        last_class=latest["class"] if latest else None,
    )


# ========== Thống kê monthly cho chart =================

@app.get("/api/stats/monthly", response_model=List[MonthlyPoint])
async def get_monthly_stats(
    cls: str = Query(..., description="drowsy / phone / turning / all"),
    months: int = Query(6, ge=1, le=36),
):
    """Group theo tháng dựa trên created_at, luôn trả về đúng `months` tháng."""

    if cls == "phone":
        match_stage = {"class": {"$in": ["texting_phone", "talking_phone"]}}
    elif cls == "all":
        match_stage = {}
    else:
        match_stage = {"class": cls}

    pipeline = [
        {"$match": match_stage},
        {
            "$addFields": {
                "created_dt": {
                    "$dateFromString": {
                        "dateString": "$created_at",
                        "format": "%Y-%m-%d %H:%M:%S",
                        "onError": None,
                    }
                }
            }
        },
        {"$match": {"created_dt": {"$ne": None}}},
        {
            "$group": {
                "_id": {
                    "y": {"$year": "$created_dt"},
                    "m": {"$month": "$created_dt"},
                },
                "count": {"$sum": 1},
            }
        },
    ]

    docs = await alerts_col.aggregate(pipeline).to_list(length=500)

    counts_map = {
        (d["_id"]["y"], d["_id"]["m"]): int(d["count"]) for d in docs
    }

    now = datetime.now()
    y = now.year
    m = now.month

    for _ in range(months - 1):
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    start_year, start_month = y, m

    result: List[MonthlyPoint] = []
    y, m = start_year, start_month
    for _ in range(months):
        cnt = counts_map.get((y, m), 0)
        month_str = f"{y:04d}-{m:02d}"
        result.append(MonthlyPoint(month=month_str, count=cnt))

        m += 1
        if m == 13:
            m = 1
            y += 1

    return result


# ========== Thống kê daily cho chart ===================

@app.get("/api/stats/daily", response_model=List[DailyPoint])
async def get_daily_stats(
    cls: str = Query(..., description="drowsy / phone / turning / all"),
    days: int = Query(14, ge=1, le=60),
):
    """
    Thống kê theo NGÀY trong N ngày gần nhất (N cột cố định).
    """

    if cls == "phone":
        match_stage = {"class": {"$in": ["texting_phone", "talking_phone"]}}
    elif cls == "all":
        match_stage = {}
    else:
        match_stage = {"class": cls}

    end = datetime.now()
    start = end - timedelta(days=days - 1)

    pipeline = [
        {"$match": match_stage},
        {
            "$addFields": {
                "created_dt": {
                    "$dateFromString": {
                        "dateString": "$created_at",
                        "format": "%Y-%m-%d %H:%M:%S",
                        "onError": None,
                    }
                }
            }
        },
        {
            "$match": {
                "created_dt": {
                    "$ne": None,
                    "$gte": start,
                    "$lte": end,
                }
            }
        },
        {
            "$group": {
                "_id": {
                    "y": {"$year": "$created_dt"},
                    "m": {"$month": "$created_dt"},
                    "d": {"$dayOfMonth": "$created_dt"},
                },
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"_id.y": 1, "_id.m": 1, "_id.d": 1}},
    ]

    docs = await alerts_col.aggregate(pipeline).to_list(length=days * 2)

    counts_map = {
        (d["_id"]["y"], d["_id"]["m"], d["_id"]["d"]): int(d["count"])
        for d in docs
    }

    result: List[DailyPoint] = []

    for offset in range(days - 1, -1, -1):
        day_dt = (end - timedelta(days=offset)).date()
        key = (day_dt.year, day_dt.month, day_dt.day)
        cnt = counts_map.get(key, 0)
        label = f"{day_dt.month:02d}-{day_dt.day:02d}"  # MM-DD
        result.append(DailyPoint(date=label, count=cnt))

    return result


# ========== System status cho Dashboard =================

@app.get("/api/system/status", response_model=SystemStatus)
async def get_system_status():
    return SystemStatus(
        esp32=True,
        rtsp=True,
        backend=True,
    )


# ========== Settings cho trang Settings + ESP32 =================

@app.get("/api/settings", response_model=SettingsModel)
async def get_settings():
    doc = await settings_col.find_one({"_id": "global"})
    if not doc:
        return SettingsModel()
    doc.pop("_id", None)
    return SettingsModel(**doc)


@app.put("/api/settings", response_model=SettingsModel)
async def update_settings(payload: SettingsUpdate):
    if payload.admin_password != "admin":
        raise HTTPException(status_code=403, detail="Invalid admin password")

    data = payload.dict(exclude_none=True, exclude={"admin_password"})

    await settings_col.update_one(
        {"_id": "global"},
        {"$set": data},
        upsert=True,
    )
    doc = await settings_col.find_one({"_id": "global"})
    doc.pop("_id", None)
    return SettingsModel(**doc)


# ================== SERVE REACT BUILD (PROD) ==================
WEB_DIR = os.getenv("DMS_WEB_DIR", r"D:\Do_An_Tot_Nghiep\TEST\dms_backend\web_dist")

if os.path.isdir(WEB_DIR):
    assets_dir = os.path.join(WEB_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/")
    async def web_root():
        return FileResponse(os.path.join(WEB_DIR, "index.html"))

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        if full_path.startswith("api") or full_path.startswith("snapshots") or full_path.startswith("assets"):
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(os.path.join(WEB_DIR, "index.html"))
else:
    print(f"[WEB] WEB_DIR not found: {WEB_DIR}")
