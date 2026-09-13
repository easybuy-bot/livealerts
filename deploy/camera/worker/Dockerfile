# Video-processing worker (AI face blur + privacy zones).
# For GPU acceleration, base this on an nvidia/cuda image and install the CUDA
# build of OpenCV instead of opencv-python-headless.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker.py .

# Place your face-detection ONNX model at /models/face.onnx (mounted read-only).
CMD ["python", "worker.py"]
