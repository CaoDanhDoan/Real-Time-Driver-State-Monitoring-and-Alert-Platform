
from __future__ import annotations

import os
import socket
import time
import uuid
import threading
import http.server
import socketserver
import random
import logging
from datetime import datetime
import pathlib
from queue import Queue

from gtts import gTTS
import requests
import cv2
import numpy as np
import tensorflow as tf
class BufferlessVideoCapture:
    def __init__(self, name):
        self.cap = cv2.VideoCapture(name)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self.q = Queue(maxsize=1)
        self.running = True
        self.t = threading.Thread(target=self._reader)
        self.t.daemon = True
        self.t.start()

    def _reader(self):
        while self.running:
            ret, frame = self.cap.read()
            if not ret:
                time.sleep(0.01) 
                continue 
            
            if not self.q.empty():
                try:
                    self.q.get_nowait()
                except Exception:
                    pass
            self.q.put(frame)

    def read(self):
        try:
            return self.q.get_nowait() 
        except Exception:
            return None

    def release(self):
        self.running = False
        self.cap.release()
# -----------------------------------------------
# ================= OpenCV stability tweaks =================
cv2.setNumThreads(0)
cv2.ocl.setUseOpenCL(False)

# ========= SPEED / DEBUG TUNING =========
INFER_EVERY_N = int(os.getenv("DMS_INFER_EVERY_N", "1"))  
UI_FPS_LIMIT = float(os.getenv("DMS_UI_FPS", "30"))       
CONF_THRES = float(os.getenv("DMS_CONF", "0.6"))
IOU_THRES = float(os.getenv("DMS_IOU", "0.45"))

DRAW_BOXES = os.getenv("DMS_DRAW", "1") == "1"
# DRAW_FPS = os.getenv("DMS_DRAW_FPS", "1") == "1"
DRAW_FPS = False  
# ========= CẤU HÌNH CỐT LÕI =========
BACKEND_ROOT = pathlib.Path(r"D:\Do_An_Tot_Nghiep\TEST\dms_backend")

AUDIO_DIR = BACKEND_ROOT / "alerts_audio"
AUDIO_DIR.mkdir(exist_ok=True)

SNAPSHOT_DIR = BACKEND_ROOT / "snapshots"
SNAPSHOT_DIR.mkdir(exist_ok=True)

BACKEND_URL = os.getenv("DMS_BACKEND_URL", "http://192.168.1.104:9000")

# RTSP từ Pi
RTSP_URL = os.getenv("DMS_RTSP_URL", "rtsp://192.168.137.2:8554/dms")
INPUT_SOURCE = RTSP_URL

MODEL_PATH = os.getenv(
    "DMS_MODEL_PATH",
    r"D:\Do_An_Tot_Nghiep\TEST\YOLO-Based-Drowsiness-Detection-System-for-Road-Safety-main\tflite\best_saved_model\best_float32.tflite",
)

AUDIO_PORT = int(os.getenv("DMS_AUDIO_PORT", "8000"))

# TCP ổn định hơn UDP -> giảm corrupt macroblock
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp|fflags;nobuffer|max_delay;0|buffer_size;1024|analyzeduration;0|probesize;32"
)
# optional: tắt debug videoio spam (không bắt buộc)
os.environ.setdefault("OPENCV_VIDEOIO_DEBUG", "0")

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
)

# ====== CLASS NAMES ======
class_names = {
    0: "awake",
    1: "drowsy",
    2: "texting_phone",
    3: "turning",
    4: "talking_phone",
}


def get_local_ip_fallback() -> str:
    host = "192.168.10.1"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((host, 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


PC_IP = os.getenv("DMS_PC_IP", get_local_ip_fallback())
print(f"[DMS] PC_IP={PC_IP}  BACKEND_URL={BACKEND_URL}  AUDIO_PORT={AUDIO_PORT}")
print(f"[DMS] MODEL_PATH={MODEL_PATH}")

# ========= LIVE SNAPSHOT / LIVE STATE  =========
LIVE_SNAPSHOT_FILENAME = os.getenv("DMS_LIVE_SNAPSHOT_NAME", "live_latest.jpg")
LIVE_SNAPSHOT_PATH = SNAPSHOT_DIR / LIVE_SNAPSHOT_FILENAME

LIVE_SNAPSHOT_INTERVAL_SEC = float(os.getenv("DMS_LIVE_SNAPSHOT_SEC", "1.0"))  
LIVE_STATE_INTERVAL_SEC = float(os.getenv("DMS_LIVE_STATE_SEC", "1.0"))        

LIVE_STATE_URL = f"{BACKEND_URL.rstrip('/')}/api/live/state"
LIVE_SNAPSHOT_URL = f"{BACKEND_URL.rstrip('/')}/snapshots/{LIVE_SNAPSHOT_FILENAME}"

# ========= HTTP SERVER  =========
_httpd_started = False


def _run_http_server():
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args, **kwargs):
            pass

    handler = lambda *a, **k: QuietHandler(*a, directory=str(AUDIO_DIR), **k)
    with socketserver.TCPServer(("0.0.0.0", AUDIO_PORT), handler) as httpd:
        logging.info(f"[HTTP] Serving MP3 at http://{PC_IP}:{AUDIO_PORT}/")
        httpd.serve_forever()


def ensure_http_server():
    global _httpd_started
    if not _httpd_started:
        threading.Thread(target=_run_http_server, daemon=True).start()
        _httpd_started = True


def _cleanup_audio(max_total_mb=200):
    """
    Giữ tổng dung lượng folder alerts_audio không vượt quá max_total_mb.
    Xóa file cũ nhất trước.
    """
    files = sorted(
        AUDIO_DIR.glob("*.mp3"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    total = 0
    for p in files:
        sz = p.stat().st_size
        if (total + sz) / (1024 * 1024) <= max_total_mb:
            total += sz
        else:
            try:
                p.unlink()
            except Exception:
                pass


# ========= TFLITE YOLO INFERENCE =========
class TFLiteYOLO:
    """
    YOLO TFLite infer + decode (anchor-free).
    Output supported:
      (1, 4+nc, 8400) OR (1, 8400, 4+nc)
    nc=5 => 9 channels.

    Fix:
      - letterbox like Ultralytics
      - optional sigmoid if logits detected
      - robust bbox normalized detection
      - batched NMS like Ultralytics (offset by class)
    """

    def __init__(self, model_path: str, names: dict[int, str]):
        self.model_path = str(model_path)
        self.names = names

        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"Model not found: {self.model_path}")

        threads = int(os.getenv("DMS_TFLITE_THREADS", str(max(2, (os.cpu_count() or 4) // 2))))
        self.threads = threads

        self.interpreter = tf.lite.Interpreter(model_path=self.model_path, num_threads=threads)
        self.interpreter.allocate_tensors()

        self.inp = self.interpreter.get_input_details()[0]
        self.out = self.interpreter.get_output_details()[0]

        self.in_h = int(self.inp["shape"][1])
        self.in_w = int(self.inp["shape"][2])

        print("[TFLITE] threads:", threads)
        print("[TFLITE] input:", self.inp["shape"], self.inp["dtype"])
        print("[TFLITE] output:", self.out.get("shape", None), self.out["dtype"])

        self._need_sigmoid = None  # auto detect
        self.debug = os.getenv("DMS_DEBUG_BBOX", "0") == "1"
        self._printed_scale = False

    @staticmethod
    def _sigmoid(x: np.ndarray) -> np.ndarray:
        return 1.0 / (1.0 + np.exp(-x))

    @staticmethod
    def _letterbox(im, new_shape=(640, 640), color=(114, 114, 114)):
        """Ultralytics-style letterbox. Return: img, ratio, (padx, pady)"""
        h0, w0 = im.shape[:2]
        new_w, new_h = new_shape[0], new_shape[1]

        r = min(new_w / w0, new_h / h0)
        rw, rh = int(round(w0 * r)), int(round(h0 * r))

        im_resized = cv2.resize(im, (rw, rh), interpolation=cv2.INTER_LINEAR)

        dw = new_w - rw
        dh = new_h - rh
        dw /= 2
        dh /= 2

        top = int(round(dh - 0.1))
        bottom = int(round(dh + 0.1))
        left = int(round(dw - 0.1))
        right = int(round(dw + 0.1))

        im_padded = cv2.copyMakeBorder(
            im_resized, top, bottom, left, right,
            cv2.BORDER_CONSTANT, value=color
        )
        return im_padded, r, (left, top)

    def infer(self, frame_bgr, conf_thres=0.3, iou_thres=0.45):
        """
        Return:
          annotated (BGR)
          detected_classes (set[str])  -> dùng cho logic alert (giữ nguyên)
          dets (list[dict])            -> debug bbox chi tiết (không ảnh hưởng logic)
        """
        h0, w0 = frame_bgr.shape[:2]

        img_lb, r, (padx, pady) = self._letterbox(frame_bgr, (self.in_w, self.in_h))

        img = cv2.cvtColor(img_lb, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        img = np.expand_dims(img, axis=0)

        self.interpreter.set_tensor(self.inp["index"], img)
        self.interpreter.invoke()
        out = self.interpreter.get_tensor(self.out["index"])
        out = np.squeeze(out)

        # normalize shape -> (8400, 9)
        if out.ndim != 2:
            return frame_bgr, set(), []
        if out.shape[0] == 9 and out.shape[1] == 8400:
            out = out.T
        if out.shape[1] != 9:
            return frame_bgr, set(), []

        boxes_xywh = out[:, :4].astype(np.float32)
        cls_scores = out[:, 4:].astype(np.float32)

        # bbox scale detect (normalized vs pixel)
        absmax = float(np.max(np.abs(boxes_xywh)))
        medwh = float(np.median(boxes_xywh[:, 2:4])) if boxes_xywh.shape[0] else 0.0

        if (absmax <= 2.0) and (medwh <= 2.0):
            boxes_xywh[:, 0] *= self.in_w
            boxes_xywh[:, 1] *= self.in_h
            boxes_xywh[:, 2] *= self.in_w
            boxes_xywh[:, 3] *= self.in_h
            if not self._printed_scale:
                print("[TFLITE] bbox_scale=normalized -> scaled to pixels")
                self._printed_scale = True
        else:
            if not self._printed_scale:
                print("[TFLITE] bbox_scale=pixel")
                self._printed_scale = True

        # auto sigmoid detect
        if self._need_sigmoid is None:
            mx = float(cls_scores.max())
            mn = float(cls_scores.min())
            self._need_sigmoid = (mx > 1.5) or (mn < -0.5)
            print(f"[TFLITE] score range mn={mn:.3f} mx={mx:.3f} -> sigmoid={self._need_sigmoid}")

        if self._need_sigmoid:
            cls_scores = self._sigmoid(cls_scores)

        cls_ids = np.argmax(cls_scores, axis=1).astype(np.int32)
        scores = cls_scores[np.arange(cls_scores.shape[0]), cls_ids].astype(np.float32)

        m = scores >= float(conf_thres)
        if not np.any(m):
            return frame_bgr, set(), []

        boxes_xywh = boxes_xywh[m]
        scores_m = scores[m]
        cls_ids_m = cls_ids[m]

        # xywh -> xyxy in letterbox space
        x = boxes_xywh[:, 0]
        y = boxes_xywh[:, 1]
        w = boxes_xywh[:, 2]
        h = boxes_xywh[:, 3]

        x1 = x - w / 2
        y1 = y - h / 2
        x2 = x + w / 2
        y2 = y + h / 2

        x1 = np.clip(x1, 0, self.in_w - 1)
        y1 = np.clip(y1, 0, self.in_h - 1)
        x2 = np.clip(x2, 0, self.in_w - 1)
        y2 = np.clip(y2, 0, self.in_h - 1)

        # map back to original
        x1 = (x1 - padx) / r
        x2 = (x2 - padx) / r
        y1 = (y1 - pady) / r
        y2 = (y2 - pady) / r

        x1 = np.clip(x1, 0, w0 - 1)
        x2 = np.clip(x2, 0, w0 - 1)
        y1 = np.clip(y1, 0, h0 - 1)
        y2 = np.clip(y2, 0, h0 - 1)

        annotated = frame_bgr.copy()
        detected_classes = set()
        dets = []

        # batched NMS
        bw = (x2 - x1).clip(min=1.0)
        bh = (y2 - y1).clip(min=1.0)

        boxes_cv = np.stack([x1, y1, bw, bh], axis=1).astype(np.float32)

        max_wh = 4096.0
        offsets = (cls_ids_m.astype(np.float32) * max_wh).reshape(-1, 1)
        boxes_for_nms = boxes_cv.copy()
        boxes_for_nms[:, 0:2] += offsets

        kept = cv2.dnn.NMSBoxes(
            bboxes=boxes_for_nms.tolist(),
            scores=scores_m.tolist(),
            score_threshold=float(conf_thres),
            nms_threshold=float(iou_thres),
        )
        if len(kept) == 0:
            return frame_bgr, set(), []

        kept = np.array(kept).reshape(-1)

        for k in kept:
            c = int(cls_ids_m[k])
            cls_name = self.names.get(c, "unknown")
            detected_classes.add(cls_name)

            x1j, y1j, x2j, y2j = int(x1[k]), int(y1[k]), int(x2[k]), int(y2[k])
            dets.append({"cls": cls_name, "score": float(scores_m[k]), "xyxy": (x1j, y1j, x2j, y2j)})

            if DRAW_BOXES:
                cv2.rectangle(annotated, (x1j, y1j), (x2j, y2j), (255, 255, 255), 2)
                cv2.putText(
                    annotated,
                    f"{cls_name} {scores_m[k]:.2f}",
                    (x1j, max(0, y1j - 10)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (255, 255, 255),
                    2,
                    cv2.LINE_AA,
                )

        if self.debug:
            try:
                print("[DBG] absmax:", absmax, "medwh:", medwh, "kept:", len(kept))
            except Exception:
                pass

        return annotated, detected_classes, dets


tflite_model = TFLiteYOLO(MODEL_PATH, names=class_names)

# ========= CẤU HÌNH CẢNH BÁO =========
DEFAULT_ALERT_COOLDOWNS = {
    "drowsy": 10,
    "texting_phone": 15,
    "talking_phone": 15,
    "turning": 5,
}
DEFAULT_DETECTION_DURATION = 3.0  

alert_cooldowns: dict[str, float] = DEFAULT_ALERT_COOLDOWNS.copy()
DETECTION_DURATION_THRESHOLD: float = DEFAULT_DETECTION_DURATION

detection_duration_per_class: dict[str, float | None] = {c: None for c in DEFAULT_ALERT_COOLDOWNS}

DISABLED_CLASSES: set[str] = set()

detection_start_times = {c: None for c in DEFAULT_ALERT_COOLDOWNS}
last_alert_times = {c: 0.0 for c in DEFAULT_ALERT_COOLDOWNS}
detection_counts = {c: 0 for c in DEFAULT_ALERT_COOLDOWNS}

# ========= BUZZER  =========
BUZZER_ENABLED: bool = True
BUZZER_COOLDOWN_SEC: float = 60.0

_last_buzzer_t: float = 0.0
_consecutive_drowsy: int = 0
_in_drowsy_run: bool = False
_buzzed_this_run: bool = False


def decide_buzzer_for_alert(cls: str) -> bool:
    global _last_buzzer_t, _consecutive_drowsy, _in_drowsy_run, _buzzed_this_run

    cls_lower = (cls or "").lower()

    if cls_lower == "drowsy":
        if not _in_drowsy_run:
            _in_drowsy_run = True
            _consecutive_drowsy = 1
            _buzzed_this_run = False
        else:
            _consecutive_drowsy += 1

        if not BUZZER_ENABLED:
            return False

        if _consecutive_drowsy >= 3:
            now = time.time()
            if not _buzzed_this_run:
                if (now - _last_buzzer_t) >= BUZZER_COOLDOWN_SEC:
                    _last_buzzer_t = now
                    _buzzed_this_run = True
                    return True
                return False
            else:
                return True

        return False

    _in_drowsy_run = False
    _consecutive_drowsy = 0
    _buzzed_this_run = False
    return False


# ========== SYNC SETTINGS FROM BACKEND ==========
def sync_detection_settings_from_backend():
    global alert_cooldowns, DETECTION_DURATION_THRESHOLD, DISABLED_CLASSES
    global detection_duration_per_class
    global BUZZER_ENABLED, BUZZER_COOLDOWN_SEC

    try:
        resp = requests.get(f"{BACKEND_URL}/api/settings", timeout=1.5)
        if not resp.ok:
            logging.warning("[SETTINGS] GET /api/settings status=%s", resp.status_code)
            return
        cfg = resp.json() or {}
    except Exception as e:
        logging.warning("[SETTINGS] fetch failed: %s", e)
        return

    disabled = set()
    if cfg.get("enable_drowsy") is False:
        disabled.add("drowsy")
    if cfg.get("enable_texting_phone") is False:
        disabled.add("texting_phone")
    if cfg.get("enable_talking_phone") is False:
        disabled.add("talking_phone")
    if cfg.get("enable_turning") is False:
        disabled.add("turning")
    DISABLED_CLASSES = disabled

    dd = cfg.get("detection_duration_sec")
    if isinstance(dd, (int, float)) and dd > 0:
        DETECTION_DURATION_THRESHOLD = float(dd)

    for key, cls in [
        ("detection_duration_drowsy_sec", "drowsy"),
        ("detection_duration_texting_phone_sec", "texting_phone"),
        ("detection_duration_talking_phone_sec", "talking_phone"),
        ("detection_duration_turning_sec", "turning"),
    ]:
        v = cfg.get(key)
        if isinstance(v, (int, float)) and v > 0:
            detection_duration_per_class[cls] = float(v)
        else:
            detection_duration_per_class[cls] = None

    for key, cls in [
        ("cooldown_drowsy_sec", "drowsy"),
        ("cooldown_texting_phone_sec", "texting_phone"),
        ("cooldown_talking_phone_sec", "talking_phone"),
        ("cooldown_turning_sec", "turning"),
    ]:
        v = cfg.get(key)
        if isinstance(v, (int, float)) and v >= 0:
            alert_cooldowns[cls] = float(v)

    bz = cfg.get("buzzer_enabled")
    if isinstance(bz, bool):
        BUZZER_ENABLED = bz

    bzc = cfg.get("buzzer_cooldown_sec")
    if isinstance(bzc, (int, float)) and bzc >= 0:
        BUZZER_COOLDOWN_SEC = float(bzc)

    logging.info(
        "[SETTINGS] synced: base_duration=%.1fs per_class=%s cooldowns=%s disabled=%s buzzer=%s buzzer_cd=%.0fs",
        DETECTION_DURATION_THRESHOLD,
        detection_duration_per_class,
        alert_cooldowns,
        list(DISABLED_CLASSES),
        BUZZER_ENABLED,
        BUZZER_COOLDOWN_SEC,
    )


def settings_poll_loop():
    while True:
        try:
            sync_detection_settings_from_backend()
        except Exception as e:
            logging.warning("[SETTINGS] background sync error: %s", e)
        time.sleep(5.0)


# ================= ALERT MESSAGES =================
alert_messages = {
    "drowsy": [
  "Ê, buồn ngủ rồi đó, tỉnh lại coi!",
  "Mắt sắp díp rồi kìa, nghỉ chút đi!",
  "Không ổn rồi, dừng xe nghỉ cho tỉnh nha!",
  "Buồn ngủ là nguy hiểm lắm đó!",
  "Tỉnh táo lên bạn ơi!!",
  "Mệt rồi thì nghỉ, đừng liều!",
  "Dậy đi ông cháu ơi. xuân này con không về giờ"
],
   "texting_phone": [
  "Bỏ điện thoại xuống coi!",
  "Lái xe mà nhắn tin là toang đó!",
  "Tập trung lái xe đi!",
  "Nhắn tin xong rồi lái xe à?",
  "Nguy hiểm đó, đừng nhìn điện thoại!",
  "Điện thoại để sau, lái xe trước!",
  "Nhắn tin là 'đăng xuất' đó",
  "Bỏ máy xuống đi bạn!"
]
,
   "talking_phone": [
  "Gọi điện thì bật tai nghe nha!",
  "Nói chuyện điện thoại dễ mất tập trung đó!",
  "Cuộc gọi quan trọng thì dừng xe đã!",
  "Lái xe mà cầm điện thoại là không ổn đâu!",
  "Bật tai nghe lên cho an toàn!",
  "Xong cuộc gọi rồi chạy tiếp nha!"
]
,
    "turning": [
  "Ê, nhìn quanh trước đã rẽ!",
  "Rẽ thì bật xi-nhan nha!",
  "Coi chừng xe phía sau đó!",
  "Quan sát kỹ rồi hãy rẽ!",
  "Coi chừng điểm mù!",
  "Tập trung lái xe đi nào",
  "Coi chừng xe phía trước",
  "Nhìn đường đi bạn!"
],
}


# ======== ALERT QUEUE (ASYNC) ========
alert_queue: "Queue[tuple]" = Queue(maxsize=32)


def save_snapshot_annotated(frame_annotated, cls: str) -> str | None:
    try:
        ts = int(time.time())
        uid = uuid.uuid4().hex[:6]
        fname = f"{ts}_{cls}_{uid}.jpg"
        path = SNAPSHOT_DIR / fname
        cv2.imwrite(str(path), frame_annotated)

        base = BACKEND_URL.rstrip("/")
        return f"{base}/snapshots/{fname}"
    except Exception as e:
        logging.warning(f"[SNAPSHOT] save failed: {e}")
        return None


# ========= LIVE HELPERS  =========
_last_live_snapshot_t = 0.0
_last_live_state_t = 0.0

_recent_alert_times: "list[float]" = []   # timestamps when alert triggered (any class)
_recent_drowsy_times: "list[float]" = []  # timestamps when drowsy alert triggered
_spark_values: "list[int]" = []           # sparkline series (counts per second)
_last_spark_bucket_sec: int | None = None
_spark_bucket_count: int = 0


def _safe_imwrite_overwrite(path: pathlib.Path, img_bgr) -> bool:
    """
    Overwrite 1 file duy nhất: live_latest.jpg
    Dùng atomic replace để web đọc không bị file half-written.
    """
    try:
        tmp = path.with_suffix(".tmp.jpg")
        ok = cv2.imwrite(str(tmp), img_bgr)
        if not ok:
            return False
        os.replace(str(tmp), str(path))  
        return True
    except Exception as e:
        logging.warning("[LIVE] write live snapshot failed: %s", e)
        return False


def _infer_state_from_detected(detected_classes: set[str]) -> str:
    """
    State ưu tiên: DROWSY > PHONE > TURNING > AWAKE
    """
    if "drowsy" in detected_classes:
        return "DROWSY"
    if ("texting_phone" in detected_classes) or ("talking_phone" in detected_classes):
        return "PHONE"
    if "turning" in detected_classes:
        return "TURNING"
    if "awake" in detected_classes:
        return "AWAKE"
    return "UNKNOWN"


def _trim_recent(now: float):
    cutoff = now - 60.0
    while _recent_alert_times and _recent_alert_times[0] < cutoff:
        _recent_alert_times.pop(0)
    while _recent_drowsy_times and _recent_drowsy_times[0] < cutoff:
        _recent_drowsy_times.pop(0)


def _update_spark(now: float):
    """
    Sparkline: count per second (bucket by int(now))
    Giữ 60 điểm.
    """
    global _last_spark_bucket_sec, _spark_bucket_count, _spark_values

    sec = int(now)
    if _last_spark_bucket_sec is None:
        _last_spark_bucket_sec = sec
        _spark_bucket_count = 0
        _spark_values = []
        return

    if sec == _last_spark_bucket_sec:
        return

    _spark_values.append(int(_spark_bucket_count))
    if len(_spark_values) > 60:
        _spark_values = _spark_values[-60:]

    _last_spark_bucket_sec = sec
    _spark_bucket_count = 0

LIVE_PUSH_FRAME_URL = f"{BACKEND_URL.rstrip('/')}/api/live/push_frame"

def push_live_frame_to_backend(now: float, frame_annotated):

    global _last_live_snapshot_t
    
    if frame_annotated is None:
        return
    if (now - _last_live_snapshot_t) < 0.05: 
        return

    try:
        
        frame_small = cv2.resize(frame_annotated, (640, 480))

        _, img_encoded = cv2.imencode('.jpg', frame_small, [int(cv2.IMWRITE_JPEG_QUALITY), 60])
        

        requests.post(
            LIVE_PUSH_FRAME_URL, 
            files={'file': ('frame.jpg', img_encoded.tobytes(), 'image/jpeg')},
            timeout=0.05 
        )
        
        _last_live_snapshot_t = now

    except Exception:
        pass

def _inc_spark():
    global _spark_bucket_count
    _spark_bucket_count += 1


def push_live_state(now: float, detected_classes: set[str]):
    """
    Gửi /api/live/state (RAM-only) để Live page poll 1s.
    Không liên quan Mongo / history.
    """
    try:
        _trim_recent(now)
        state = _infer_state_from_detected(detected_classes)

        alerts_per_min = float(len(_recent_alert_times))
        drowsy_60s = int(len(_recent_drowsy_times))

        payload = {
            "ts": int(now * 1000),
            "state": state,
            "drowsy_60s": drowsy_60s,
            "alerts_per_min": alerts_per_min,
            "spark": _spark_values[-60:],  
            "snapshot_url": LIVE_SNAPSHOT_URL,
        }
        requests.post(LIVE_STATE_URL, json=payload, timeout=0.35)
    except Exception:
        pass


def maybe_write_live_snapshot(now: float, frame_annotated):
    """
    Cứ 1–2s overwrite live_latest.jpg.
    Không đụng snapshot history (save_snapshot_annotated vẫn y nguyên).
    """
    global _last_live_snapshot_t
    if frame_annotated is None:
        return
    if (now - _last_live_snapshot_t) < LIVE_SNAPSHOT_INTERVAL_SEC:
        return
    if _safe_imwrite_overwrite(LIVE_SNAPSHOT_PATH, frame_annotated):
        _last_live_snapshot_t = now


def _do_send_alert(
    cls: str,
    message: str,
    count: int,
    frame_annotated=None,
    speed_kmh: float | None = None,
    drive_minutes: float | None = None,
):
    ensure_http_server()
    ts = int(time.time())
    uid = uuid.uuid4().hex[:6]

    mp3_name = f"{ts}_{cls}_{uid}.mp3"
    mp3_path = AUDIO_DIR / mp3_name
    try:
        gTTS(text=message, lang="vi", slow=False).save(str(mp3_path))
    except Exception as e:
        logging.warning(f"[TTS] gTTS failed: {e}")
        return

    audio_url = f"http://{PC_IP}:{AUDIO_PORT}/{mp3_name}"

    snapshot_url = None
    if frame_annotated is not None:
        snapshot_url = save_snapshot_annotated(frame_annotated, cls)

    buzzer = decide_buzzer_for_alert(cls)

    dm = int(drive_minutes) if drive_minutes is not None else None
    payload = {
        "class": cls,
        "count": count,
        "message": message,
        "speed": speed_kmh,
        "snapshot_url": snapshot_url,
        "audio_url": audio_url,
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "drive_minutes": dm,
        "buzzer": buzzer,
    }

    try:
        resp = requests.post(f"{BACKEND_URL}/api/alerts", json=payload, timeout=1.5)
        if resp.ok:
            data = resp.json()
            logging.info(
                "[ALERT] id=%s %s x%d drive=%sm buzzer=%s audio=%s snapshot=%s",
                data.get("id"),
                cls,
                count,
                dm,
                buzzer,
                audio_url,
                snapshot_url,
            )
        else:
            logging.warning("[BACKEND] POST /api/alerts status=%s", resp.status_code)
    except Exception as e:
        logging.warning(f"[BACKEND] POST /api/alerts failed: {e}")

    threading.Thread(target=_cleanup_audio, daemon=True).start()


def alert_worker_loop():
    while True:
        try:
            (
                cls,
                message,
                count,
                frame_annotated,
                speed_kmh,
                drive_minutes,
            ) = alert_queue.get()
            _do_send_alert(
                cls,
                message,
                count,
                frame_annotated=frame_annotated,
                speed_kmh=speed_kmh,
                drive_minutes=drive_minutes,
            )
        except Exception as e:
            logging.warning("[ALERT_WORKER] error: %s", e)


def send_alert(
    cls: str,
    message: str,
    count: int,
    frame_annotated=None,
    speed_kmh: float | None = None,
    drive_minutes: float | None = None,
):
    try:
        frame_copy = None
        if frame_annotated is not None:
            frame_copy = frame_annotated.copy()
        alert_queue.put_nowait((cls, message, count, frame_copy, speed_kmh, drive_minutes))
        logging.info(
            "[ALERT] enqueue cls=%s count=%d drive=%.1fm",
            cls,
            count,
            drive_minutes if drive_minutes is not None else -1,
        )
    except Exception as e:
        logging.warning("[ALERT] queue full or error: %s", e)



print("[INFO] Starting Bufferless Capture...")
cap = BufferlessVideoCapture(INPUT_SOURCE)
start_time = time.time()


def main_loop():
    global _stop_grabber
    global _last_live_state_t

    last_ui_t = 0.0
    ui_dt = 1.0 / max(1.0, UI_FPS_LIMIT)

    # fps meter
    t0 = time.time()
    frames = 0
    fps = 0.0

    cached_annotated = None
    cached_detected = set()
    cached_dets = []
    frame_id = 0

    while True:
        frame = cap.read()
        
        if frame is None:
            cv2.waitKey(1) 
            continue

        frame_id += 1
        now = time.time()

        do_infer = (frame_id % max(1, INFER_EVERY_N) == 0)

        if do_infer:
            annotated, detected_classes, dets = tflite_model.infer(
                frame, conf_thres=CONF_THRES, iou_thres=IOU_THRES
            )
            cached_annotated = annotated
            cached_detected = detected_classes
            cached_dets = dets
        else:
            annotated = cached_annotated if cached_annotated is not None else frame
            detected_classes = cached_detected
            dets = cached_dets

        driving_time = (now - start_time) / 60.0

        # LIVE: write snapshot overwrite (1–2s) + push live state (1s)
        _update_spark(now)
        # maybe_write_live_snapshot(now, annotated)
        push_live_frame_to_backend(now, annotated)
        if (now - _last_live_state_t) >= LIVE_STATE_INTERVAL_SEC:
            push_live_state(now, detected_classes)
            _last_live_state_t = now

        # time_context = get_time_context()
        speed_kmh = random.uniform(30.0, 80.0)

        # ====== ALERT DECISION WITH SETTINGS (GIỮ NGUYÊN) ======
        for cls in alert_cooldowns:
            if cls in DISABLED_CLASSES:
                detection_start_times[cls] = None
                continue

            per_cls_thr = detection_duration_per_class.get(cls) or DETECTION_DURATION_THRESHOLD

            if cls in detected_classes:
                if detection_start_times[cls] is None:
                    detection_start_times[cls] = now
                else:
                    if (now - detection_start_times[cls]) >= per_cls_thr:
                        if (now - last_alert_times[cls]) > alert_cooldowns[cls]:
                            detection_counts[cls] += 1

                            # NOTE: weather removed -> use base message only
                            msg = random.choice(alert_messages[cls])

                            # vẫn giữ logic nhắc "lần thứ N"
                            if detection_counts[cls] > 3:
                                msg = f"Này, lần thứ {detection_counts[cls]} rồi! {msg}"

                            send_alert(
                                cls,
                                msg,
                                detection_counts[cls],
                                frame_annotated=annotated,
                                speed_kmh=speed_kmh,
                                drive_minutes=driving_time,
                            )

                            # ✅ rolling stats for live (không ảnh hưởng alert logic)
                            _recent_alert_times.append(now)
                            if cls == "drowsy":
                                _recent_drowsy_times.append(now)
                            _inc_spark()

                            last_alert_times[cls] = now
                            detection_start_times[cls] = None
            else:
                detection_start_times[cls] = None

        # ===== FPS overlay ONLY =====
        frames += 1
        if now - t0 >= 1.0:
            fps = frames / (now - t0)
            t0 = now
            frames = 0

        if DRAW_FPS:
            cv2.putText(
                annotated, f"FPS:{fps:.1f}", (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA
            )

        # throttle UI
        if now - last_ui_t >= ui_dt:
            cv2.imshow("Driver Monitoring", annotated)
            last_ui_t = now

        if cv2.waitKey(1) & 0xFF == ord("q"):
            logging.info("[MAIN] Quit by user (q).")
            break

    _stop_grabber = True


# ========== START PROGRAM ==========
if __name__ == "__main__":
    sync_detection_settings_from_backend()
    threading.Thread(target=settings_poll_loop, daemon=True).start()
    threading.Thread(target=alert_worker_loop, daemon=True).start()

    try:
        main_loop()
    finally:
        try:
            cap.release()
        except Exception:
            pass
        cv2.destroyAllWindows()
