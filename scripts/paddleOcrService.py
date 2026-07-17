"""Local-only PaddleOCR HTTP service used by the PDF verification pipeline."""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO

from PIL import Image
import numpy as np
from paddleocr import PaddleOCR


HOST = "127.0.0.1"
PORT = int(os.environ.get("PADDLE_OCR_PORT", "8087"))
MODEL = os.environ.get("PADDLE_OCR_MODEL", "PP-OCRv6")
DEVICE = os.environ.get("PADDLE_OCR_DEVICE", "gpu:0")
CONTROL_TOKEN = os.environ.get("PADDLE_OCR_CONTROL_TOKEN", "")
MAX_IMAGE_BYTES = int(os.environ.get("PADDLE_OCR_MAX_IMAGE_BYTES", str(20 * 1024 * 1024)))


def json_safe(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


print(f"Loading {MODEL} on {DEVICE}...", flush=True)
OCR = PaddleOCR(
    ocr_version=MODEL,
    device=DEVICE,
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    return_word_box=True,
)
OCR_LOCK = threading.Lock()
print(f"PaddleOCR ready at http://{HOST}:{PORT}", flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "KidEnglishPaddleOCR/1.0"

    def log_message(self, format_string, *args):
        sys.stdout.write(f"[{self.log_date_time_string()}] {format_string % args}\n")
        sys.stdout.flush()

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            self.send_json(404, {"error": "NOT_FOUND"})
            return
        self.send_json(200, {
            "status": "ok",
            "engine": "paddleocr",
            "model": MODEL,
            "device": DEVICE,
            "pid": os.getpid(),
        })

    def do_POST(self):
        if self.path == "/shutdown":
            supplied = self.headers.get("X-Paddle-Control-Token", "")
            if not CONTROL_TOKEN or supplied != CONTROL_TOKEN:
                self.send_json(403, {"error": "FORBIDDEN"})
                return
            self.send_json(200, {"status": "stopping"})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        if self.path != "/ocr":
            self.send_json(404, {"error": "NOT_FOUND"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_IMAGE_BYTES * 2:
                raise ValueError("INVALID_CONTENT_LENGTH")
            request = json.loads(self.rfile.read(content_length))
            encoded = str(request.get("image", ""))
            image_bytes = base64.b64decode(encoded, validate=True)
            if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
                raise ValueError("INVALID_IMAGE_SIZE")

            started = time.perf_counter()
            image = Image.open(BytesIO(image_bytes)).convert("RGB")
            with OCR_LOCK:
                predictions = list(OCR.predict(np.asarray(image)))
            if not predictions:
                raise ValueError("EMPTY_OCR_RESULT")
            result = predictions[0].json["res"]
            texts = list(result.get("rec_texts") or [])
            scores = list(result.get("rec_scores") or [])
            polygons = list(result.get("rec_polys") or [])
            boxes = list(result.get("rec_boxes") or [])
            word_boxes = list(result.get("text_word_boxes") or [])
            words = list(result.get("text_word") or [])
            lines = []
            for index, text in enumerate(texts):
                lines.append({
                    "text": str(text).strip(),
                    "confidence": float(scores[index]) if index < len(scores) else 0.0,
                    "polygon": json_safe(polygons[index]) if index < len(polygons) else [],
                    "box": json_safe(boxes[index]) if index < len(boxes) else [],
                    "words": json_safe(words[index]) if index < len(words) else [],
                    "wordBoxes": json_safe(word_boxes[index]) if index < len(word_boxes) else [],
                })
            self.send_json(200, {
                "engine": "paddleocr",
                "model": MODEL,
                "device": DEVICE,
                "width": image.width,
                "height": image.height,
                "durationMs": round((time.perf_counter() - started) * 1000),
                "lines": lines,
            })
        except Exception as error:
            self.send_json(400, {"error": type(error).__name__, "message": str(error)[:500]})


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
