#!/usr/bin/env python3
"""
Live Camera Studio — video-processing worker.

For each live camera it:
  1. pulls the raw stream from the media server (rtmp://.../live/<path>),
  2. detects faces and blurs them (AI face blur),
  3. blurs any fixed privacy zones configured for the device,
  4. re-publishes the processed stream to rtmp://.../processed/<path>,
     which players/OBS pull over WebRTC/HLS.

The privacy-zone geometry is fetched from the PHP REST API. Face detection uses
an OpenCV DNN model (ONNX/Caffe); on a machine with an NVIDIA GPU + the CUDA
build of OpenCV it runs on the GPU, otherwise on CPU.

This is a companion service — it is NOT part of the PHP app and does not run on
shared hosting. See ../README.md for deployment.
"""
import os
import sys
import time
import subprocess

import cv2            # opencv-python (build with CUDA for GPU)
import numpy as np
import requests

MEDIA_RTMP_BASE      = os.environ.get("MEDIA_RTMP_BASE", "rtmp://127.0.0.1:1935/live")
MEDIA_RTMP_PROCESSED = os.environ.get("MEDIA_RTMP_PROCESSED", "rtmp://127.0.0.1:1935/processed")
APP_API_BASE         = os.environ.get("APP_API_BASE", "")
WORKER_API_KEY       = os.environ.get("WORKER_API_KEY", "")
FACE_MODEL           = os.environ.get("FACE_BLUR_MODEL", "/models/face.onnx")

WIDTH, HEIGHT, FPS = 1920, 1080, 30


def api(path):
    """GET a JSON document from the PHP REST API using the worker's api key."""
    if not APP_API_BASE or not WORKER_API_KEY:
        return {}
    try:
        r = requests.get(f"{APP_API_BASE}?action={path}",
                         headers={"Authorization": f"Bearer {WORKER_API_KEY}"},
                         timeout=5)
        return r.json() if r.ok else {}
    except Exception:
        return {}


def load_face_net():
    """Load the ONNX face-detection network, enabling CUDA when available."""
    if not os.path.exists(FACE_MODEL):
        print("[worker] no face model, face blur disabled", file=sys.stderr)
        return None
    net = cv2.dnn.readNet(FACE_MODEL)
    try:
        net.setPreferableBackend(cv2.dnn.DNN_BACKEND_CUDA)
        net.setPreferableTarget(cv2.dnn.DNN_TARGET_CUDA)
        print("[worker] face blur on GPU (CUDA)")
    except Exception:
        print("[worker] face blur on CPU")
    return net


def detect_faces(net, frame):
    """Return a list of (x, y, w, h) face boxes in pixel coords."""
    if net is None:
        return []
    h, w = frame.shape[:2]
    blob = cv2.dnn.blobFromImage(frame, 1.0, (300, 300), (104, 177, 123))
    net.setInput(blob)
    det = net.forward()
    boxes = []
    for i in range(det.shape[2]):
        conf = det[0, 0, i, 2]
        if conf < 0.5:
            continue
        x1 = int(det[0, 0, i, 3] * w); y1 = int(det[0, 0, i, 4] * h)
        x2 = int(det[0, 0, i, 5] * w); y2 = int(det[0, 0, i, 6] * h)
        boxes.append((x1, y1, max(1, x2 - x1), max(1, y2 - y1)))
    return boxes


def blur_region(frame, x, y, w, h, strength):
    """Gaussian-blur a rectangular region in place (strength ~ blur radius)."""
    fh, fw = frame.shape[:2]
    x = max(0, min(x, fw - 1)); y = max(0, min(y, fh - 1))
    w = max(1, min(w, fw - x)); h = max(1, min(h, fh - y))
    k = max(3, int(strength) | 1)  # odd kernel
    roi = frame[y:y + h, x:x + w]
    frame[y:y + h, x:x + w] = cv2.GaussianBlur(roi, (k, k), 0)


def process_device(device, net):
    """Run one ffmpeg->opencv->ffmpeg processing pipeline for a device."""
    path = device["stream_path"]
    src  = f"{MEDIA_RTMP_BASE}/{path}"
    dst  = f"{MEDIA_RTMP_PROCESSED}/{path}"

    zones = api(f"privacy_zones&device_id={device['id']}").get("zones", [])
    face_blur = device.get("face_blur_enabled", True)

    # Decode raw frames from the source with ffmpeg.
    dec = subprocess.Popen(
        ["ffmpeg", "-i", src, "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    # Encode processed frames and publish back to the media server.
    enc = subprocess.Popen(
        ["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
         "-pix_fmt", "yuv420p", "-f", "flv", dst],
        stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)

    frame_bytes = WIDTH * HEIGHT * 3
    while True:
        raw = dec.stdout.read(frame_bytes)
        if len(raw) < frame_bytes:
            break
        frame = np.frombuffer(raw, np.uint8).reshape((HEIGHT, WIDTH, 3)).copy()

        if face_blur:
            for (x, y, w, h) in detect_faces(net, frame):
                blur_region(frame, x, y, w, h, 45)

        for z in zones:
            if not z.get("enabled", True):
                continue
            x = int(float(z["x"]) / 100 * WIDTH); y = int(float(z["y"]) / 100 * HEIGHT)
            w = int(float(z["w"]) / 100 * WIDTH); h = int(float(z["h"]) / 100 * HEIGHT)
            blur_region(frame, x, y, w, h, int(z.get("blur_strength", 25)))

        try:
            enc.stdin.write(frame.tobytes())
        except BrokenPipeError:
            break

    dec.terminate(); enc.terminate()


def main():
    net = load_face_net()
    print("[worker] started; polling for live cameras")
    while True:
        devices = api("devices").get("devices", [])
        live = [d for d in devices if d.get("status") == "streaming"]
        for d in live:
            try:
                process_device(d, net)
            except Exception as e:
                print(f"[worker] error on {d.get('stream_path')}: {e}", file=sys.stderr)
        time.sleep(3)


if __name__ == "__main__":
    main()
