
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from pathlib import Path
import io
import json

import numpy as np
from tensorflow.keras.models import load_model
from PIL import Image, ImageOps, ImageFilter


# ============================================================
# PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

CNN_DIR = BASE_DIR / "models" / "ecg_cnn"

MODEL_PATH = CNN_DIR / "best_ecg_cnn_improved.keras"
NORMALIZATION_PATH = CNN_DIR / "normalization.npz"
MODEL_INFO_PATH = CNN_DIR / "model_info.json"


# ============================================================
# MODEL CONFIGURATION
# ============================================================

CLASS_NAMES = {
    0: "Normal",
    1: "Abnormal",
}

INPUT_SAMPLES = 187

# Locked using validation data only.
DECISION_THRESHOLD = 0.70

model = None
MODEL_LOADED = False
MODEL_ERROR = None

TRAIN_MEAN = None
TRAIN_STD = None


# ============================================================
# LOAD CNN MODEL
# ============================================================

try:
    print(f"Loading ECG CNN model from: {MODEL_PATH}")

    model = load_model(MODEL_PATH)

    print("ECG CNN model loaded successfully.")

    # Load training normalization parameters.
    norm_data = np.load(NORMALIZATION_PATH)

    TRAIN_MEAN = float(norm_data["mean"])
    TRAIN_STD = float(norm_data["std"])

    if not np.isfinite(TRAIN_MEAN):
        raise ValueError("Training mean is invalid.")

    if not np.isfinite(TRAIN_STD) or TRAIN_STD <= 0:
        raise ValueError("Training standard deviation is invalid.")

    print(f"Training mean: {TRAIN_MEAN:.6f}")
    print(f"Training std : {TRAIN_STD:.6f}")

    MODEL_LOADED = True

except Exception as exc:
    MODEL_ERROR = str(exc)
    print("CNN model loading failed:", MODEL_ERROR)


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI(
    title="AI-Assisted ECG Screening API",
    description=(
        "Educational/research ECG screening prototype. "
        "Not a clinical diagnostic device."
    ),
    version="3.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# REQUEST MODEL
# ============================================================

class ECGRequest(BaseModel):
    samples: List[float] = Field(..., min_length=187)
    filename: Optional[str] = None


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {
        "service": "AI-Assisted ECG Screening API",
        "status": "running",
        "model_loaded": MODEL_LOADED,
        "model_type": "Improved 1D CNN",
        "model_parameters": 54017,
        "decision_threshold": DECISION_THRESHOLD,
        "input_samples_per_heartbeat": INPUT_SAMPLES,
        "classes": CLASS_NAMES,
        "image_upload": True,
        "clinical_diagnosis": False,
        "message": (
            "Educational/research ECG screening prototype. "
            "Not a clinical diagnostic device."
        ),
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/api/health")
def health():

    response = {
        "status": "ok",
        "model_loaded": MODEL_LOADED,
        "model": "Improved 1D CNN",
        "model_file": "best_ecg_cnn_improved.keras",
        "model_parameters": 54017,
        "input_samples_per_heartbeat": INPUT_SAMPLES,
        "decision_threshold": DECISION_THRESHOLD,
        "classes": CLASS_NAMES,
        "normalization_loaded": (
            TRAIN_MEAN is not None and TRAIN_STD is not None
        ),
        "image_upload": True,
        "clinical_diagnosis": False,
        "message": (
            "Educational/research screening prototype. "
            "Not a clinical diagnostic device."
        ),
    }

    if MODEL_ERROR:
        response["model_error"] = MODEL_ERROR

    return response


# ============================================================
# PREPROCESS ECG
# ============================================================

def preprocess_ecg(samples):

    samples = np.asarray(
        samples,
        dtype=np.float64
    )

    if samples.size < INPUT_SAMPLES:

        raise HTTPException(
            status_code=400,
            detail=(
                f"At least {INPUT_SAMPLES} ECG samples are required."
            ),
        )

    if not np.all(np.isfinite(samples)):

        raise HTTPException(
            status_code=400,
            detail="ECG contains invalid numeric values.",
        )

    # Use the first 187 samples, matching the current
    # training pipeline.
    heartbeat = samples[:INPUT_SAMPLES]

    # Apply ONLY the normalization calculated from training data.
    normalized = (
        heartbeat - TRAIN_MEAN
    ) / TRAIN_STD

    if not np.all(np.isfinite(normalized)):

        raise HTTPException(
            status_code=422,
            detail="ECG preprocessing produced invalid values.",
        )

    # CNN expects: (batch, samples, channel)
    X = normalized.reshape(
        1,
        INPUT_SAMPLES,
        1
    ).astype(np.float32)

    return X


# ============================================================
# CNN PREDICTION
# ============================================================

def predict_with_cnn(X):

    if not MODEL_LOADED or model is None:

        raise HTTPException(
            status_code=503,
            detail="ECG CNN model is not loaded on the server.",
        )

    try:

        probability = float(
            model.predict(
                X,
                verbose=0
            ).ravel()[0]
        )

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=f"CNN prediction failed: {exc}",
        )

    if not np.isfinite(probability):

        raise HTTPException(
            status_code=500,
            detail="CNN returned an invalid prediction.",
        )

    probability = float(
        np.clip(
            probability,
            0.0,
            1.0
        )
    )

    prediction = int(
        probability >= DECISION_THRESHOLD
    )

    return prediction, probability


# ============================================================
# PREDICTION RESULT
# ============================================================

def build_prediction_result(
    prediction,
    probability,
    samples_received,
    samples_used,
    filename,
    screening_type,
    image_derived=False,
):

    prediction_name = CLASS_NAMES.get(
        prediction,
        "Unknown"
    )

    normal_probability = 1.0 - probability
    abnormal_probability = probability

    result = {

        "prediction_class": prediction,

        "prediction": prediction_name,

        "screening_result": (
            "NORMAL"
            if prediction == 0
            else "ABNORMAL"
        ),

        "abnormal_probability": round(
            abnormal_probability,
            4
        ),

        "normal_probability": round(
            normal_probability,
            4
        ),

        "decision_threshold": DECISION_THRESHOLD,

        "samples_received": samples_received,

        "samples_used": samples_used,

        "filename": filename,

        "screening_type": screening_type,

        "image_derived": image_derived,

        "clinical_diagnosis": False,

        "prototype_note": (
            "Educational/research screening prototype. "
            "This output is not a clinical diagnosis."
        ),
    }

    if image_derived:

        result["prototype_note"] = (
            "Educational/research prototype. "
            "The waveform was estimated from the uploaded ECG image "
            "and is not the original digital ECG signal. "
            "This output is not a clinical diagnosis."
        )

    return result


# ============================================================
# CSV / DIGITAL ECG PREDICTION
# ============================================================

@app.post("/api/predict")
def predict_ecg(request: ECGRequest):

    if not MODEL_LOADED:

        raise HTTPException(
            status_code=503,
            detail="ECG CNN model is not loaded on the server.",
        )

    try:

        samples = np.asarray(
            request.samples,
            dtype=np.float64
        )

    except (TypeError, ValueError):

        raise HTTPException(
            status_code=400,
            detail="ECG samples must be numeric values.",
        )

    X = preprocess_ecg(samples)

    prediction, probability = predict_with_cnn(X)

    return build_prediction_result(
        prediction=prediction,
        probability=probability,
        samples_received=int(samples.size),
        samples_used=INPUT_SAMPLES,
        filename=request.filename,
        screening_type="Binary ECG screening",
        image_derived=False,
    )


# ============================================================
# ECG IMAGE WAVEFORM EXTRACTION
# ============================================================

def extract_waveform_from_image(image_bytes):

    try:

        image = Image.open(
            io.BytesIO(image_bytes)
        )

        image = ImageOps.exif_transpose(image)
        image = image.convert("L")

    except Exception as exc:

        raise HTTPException(
            status_code=400,
            detail=f"Invalid ECG image: {exc}",
        )

    width, height = image.size

    if width < 100 or height < 50:

        raise HTTPException(
            status_code=400,
            detail=(
                "The ECG image is too small. "
                "Please upload a clearer ECG image."
            ),
        )

    max_width = 1600

    if width > max_width:

        new_height = int(
            height * max_width / width
        )

        image = image.resize(
            (max_width, new_height)
        )

        width, height = image.size

    image = image.filter(
        ImageFilter.GaussianBlur(
            radius=0.5
        )
    )

    arr = np.asarray(
        image,
        dtype=np.float32
    )

    darkness = 255.0 - arr

    x0 = max(
        0,
        int(width * 0.03)
    )

    x1 = min(
        width,
        int(width * 0.97)
    )

    y0 = max(
        0,
        int(height * 0.08)
    )

    y1 = min(
        height,
        int(height * 0.92)
    )

    cropped = darkness[
        y0:y1,
        x0:x1
    ]

    if cropped.size == 0:

        raise HTTPException(
            status_code=400,
            detail="Could not locate usable image content."
        )

    threshold = np.percentile(
        cropped,
        80
    )

    positions = []

    for column in range(
        cropped.shape[1]
    ):

        weights = cropped[
            :,
            column
        ].copy()

        weights[
            weights < threshold
        ] = 0

        total = float(
            np.sum(weights)
        )

        if total <= 0:

            positions.append(
                np.nan
            )

            continue

        rows = np.arange(
            cropped.shape[0],
            dtype=np.float32
        )

        center = float(
            np.sum(
                rows * weights
            )
            / total
        )

        positions.append(
            center
        )

    positions = np.asarray(
        positions,
        dtype=np.float32
    )

    valid = np.isfinite(
        positions
    )

    if np.sum(valid) < max(
        50,
        int(positions.size * 0.25)
    ):

        raise HTTPException(
            status_code=422,
            detail=(
                "The uploaded image did not contain enough "
                "detectable waveform information. "
                "Try a clearer ECG image with the waveform visible."
            ),
        )

    indices = np.arange(
        positions.size
    )

    positions[~valid] = np.interp(
        indices[~valid],
        indices[valid],
        positions[valid]
    )

    baseline = np.median(
        positions
    )

    signal = (
        baseline - positions
    )

    signal = (
        signal - np.mean(signal)
    )

    std = np.std(
        signal
    )

    if std > 1e-8:

        signal = (
            signal / std
        )

    source_x = np.linspace(
        0,
        1,
        signal.size
    )

    target_x = np.linspace(
        0,
        1,
        INPUT_SAMPLES
    )

    waveform = np.interp(
        target_x,
        source_x,
        signal
    )

    waveform = np.asarray(
        waveform,
        dtype=np.float64
    )

    if not np.all(
        np.isfinite(waveform)
    ):

        raise HTTPException(
            status_code=422,
            detail=(
                "The ECG waveform could not "
                "be extracted from the image."
            ),
        )

    return waveform


# ============================================================
# ECG IMAGE SCREENING
# ============================================================

@app.post("/api/analyze-image")
async def analyze_ecg_image(
    file: UploadFile = File(...)
):

    if not MODEL_LOADED:

        raise HTTPException(
            status_code=503,
            detail="ECG CNN model is not loaded on the server.",
        )

    filename = (
        file.filename
        or "uploaded_ecg_image"
    )

    extension = Path(
        filename
    ).suffix.lower()

    allowed_extensions = {
        ".jpg",
        ".jpeg",
        ".png",
    }

    if extension not in allowed_extensions:

        raise HTTPException(
            status_code=400,
            detail=(
                "Unsupported image type. "
                "Please upload JPG, JPEG or PNG."
            ),
        )

    image_bytes = await file.read()

    if not image_bytes:

        raise HTTPException(
            status_code=400,
            detail="The uploaded ECG image is empty.",
        )

    if len(image_bytes) > 10 * 1024 * 1024:

        raise HTTPException(
            status_code=400,
            detail=(
                "The ECG image is too large. "
                "Maximum size is 10 MB."
            ),
        )

    waveform = extract_waveform_from_image(
        image_bytes
    )

    X = preprocess_ecg(
        waveform
    )

    prediction, probability = predict_with_cnn(
        X
    )

    result = build_prediction_result(
        prediction=prediction,
        probability=probability,
        samples_received=INPUT_SAMPLES,
        samples_used=INPUT_SAMPLES,
        filename=filename,
        screening_type="Image-derived ECG screening",
        image_derived=True,
    )

    result["image_processing"] = {

        "status": "completed",

        "waveform_samples_generated": INPUT_SAMPLES,

        "sampling_rate": None,

        "duration": None,

        "note": (
            "Sampling rate and duration are not inferred from the image."
        ),
    }

    return result
