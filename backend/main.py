
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from pathlib import Path
import io

import numpy as np
import joblib
from PIL import Image, ImageOps, ImageFilter


# --------------------------------------------------
# Paths
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

MODEL_PATH = (
    BASE_DIR
    / "models"
    / "ecg_binary_random_forest.joblib"
)


# --------------------------------------------------
# Model configuration
# --------------------------------------------------

CLASS_NAMES = {
    0: "Normal",
    1: "Abnormal",
}

INPUT_SAMPLES = 187

model = None
MODEL_LOADED = False
MODEL_ERROR = None


# --------------------------------------------------
# Load model
# --------------------------------------------------

try:
    print(f"Loading ECG model from: {MODEL_PATH}")

    model = joblib.load(MODEL_PATH)

    MODEL_LOADED = True

    print("ECG binary model loaded successfully.")
    print("Model classes:", getattr(model, "classes_", "unknown"))

except Exception as exc:
    MODEL_ERROR = str(exc)
    print("Model loading failed:", MODEL_ERROR)


# --------------------------------------------------
# FastAPI
# --------------------------------------------------

app = FastAPI(
    title="AI-Assisted ECG Screening API",
    description=(
        "Educational/research ECG screening prototype. "
        "Not a clinical diagnostic device."
    ),
    version="2.1",
)


# --------------------------------------------------
# CORS
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# Request model for CSV
# --------------------------------------------------

class ECGRequest(BaseModel):
    samples: List[float] = Field(..., min_length=187)
    filename: Optional[str] = None


# --------------------------------------------------
# Root
# --------------------------------------------------

@app.get("/")
def root():
    return {
        "service": "AI-Assisted ECG Screening API",
        "status": "running",
        "model_loaded": MODEL_LOADED,
        "model_type": "Random Forest",
        "classes": CLASS_NAMES,
        "image_upload": True,
        "clinical_diagnosis": False,
        "message": (
            "Educational/research ECG screening prototype. "
            "Not a clinical diagnostic device."
        ),
    }


# --------------------------------------------------
# Health
# --------------------------------------------------

@app.get("/api/health")
def health():

    response = {
        "status": "ok",
        "model_loaded": MODEL_LOADED,
        "model": "Random Forest",
        "model_file": "ecg_binary_random_forest.joblib",
        "input_samples_per_heartbeat": INPUT_SAMPLES,
        "classes": CLASS_NAMES,
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


# --------------------------------------------------
# Existing CSV prediction
# --------------------------------------------------

@app.post("/api/predict")
def predict_ecg(request: ECGRequest):

    if not MODEL_LOADED or model is None:
        raise HTTPException(
            status_code=503,
            detail="ECG model is not loaded on the server.",
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

    if samples.size < INPUT_SAMPLES:

        raise HTTPException(
            status_code=400,
            detail=(
                f"At least {INPUT_SAMPLES} "
                "ECG samples are required."
            ),
        )

    if not np.all(np.isfinite(samples)):

        raise HTTPException(
            status_code=400,
            detail="ECG contains invalid numeric values.",
        )

    heartbeat = samples[:INPUT_SAMPLES]

    X = heartbeat.reshape(1, INPUT_SAMPLES)

    try:
        prediction = int(
            model.predict(X)[0]
        )

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=f"Model prediction failed: {exc}",
        )

    return build_prediction_result(
        prediction=prediction,
        X=X,
        samples_received=int(samples.size),
        samples_used=INPUT_SAMPLES,
        filename=request.filename,
        screening_type="Binary ECG screening",
        image_derived=False,
    )


# --------------------------------------------------
# Prediction result helper
# --------------------------------------------------

def build_prediction_result(
    prediction,
    X,
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

    result = {

        "prediction_class": prediction,

        "prediction": prediction_name,

        "screening_result": (
            "NORMAL"
            if prediction == 0
            else "ABNORMAL"
        ),

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

    if hasattr(model, "predict_proba"):

        try:

            probabilities = model.predict_proba(X)[0]

            result["probabilities"] = {

                CLASS_NAMES.get(
                    int(cls),
                    str(cls)
                ): round(
                    float(prob),
                    4
                )

                for cls, prob in zip(
                    model.classes_,
                    probabilities
                )
            }

        except Exception:
            pass

    return result


# --------------------------------------------------
# ECG image waveform extraction
# --------------------------------------------------

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

    # Limit processing dimensions to keep the API lightweight.
    max_width = 1600

    if width > max_width:

        new_height = int(
            height * max_width / width
        )

        image = image.resize(
            (max_width, new_height)
        )

        width, height = image.size

    # Slight smoothing reduces isolated pixels/noise.
    image = image.filter(
        ImageFilter.GaussianBlur(radius=0.5)
    )

    arr = np.asarray(
        image,
        dtype=np.float32
    )

    # Dark ECG traces have lower grayscale values.
    darkness = 255.0 - arr

    # Ignore a small border because ECG images often contain
    # labels, margins, and other non-waveform content there.
    x0 = max(0, int(width * 0.03))
    x1 = min(width, int(width * 0.97))

    y0 = max(0, int(height * 0.08))
    y1 = min(height, int(height * 0.92))

    cropped = darkness[y0:y1, x0:x1]

    if cropped.size == 0:
        raise HTTPException(
            status_code=400,
            detail="Could not locate usable image content."
        )

    # Estimate the waveform position column by column.
    #
    # A small amount of darkness is ignored so that a bright
    # background does not dominate the calculation.
    threshold = np.percentile(
        cropped,
        80
    )

    positions = []

    for column in range(cropped.shape[1]):

        weights = cropped[:, column].copy()

        weights[weights < threshold] = 0

        total = float(
            np.sum(weights)
        )

        if total <= 0:
            positions.append(np.nan)
            continue

        rows = np.arange(
            cropped.shape[0],
            dtype=np.float32
        )

        center = float(
            np.sum(rows * weights) / total
        )

        positions.append(center)

    positions = np.asarray(
        positions,
        dtype=np.float32
    )

    valid = np.isfinite(positions)

    if np.sum(valid) < max(50, int(positions.size * 0.25)):

        raise HTTPException(
            status_code=422,
            detail=(
                "The uploaded image did not contain enough "
                "detectable waveform information. "
                "Try a clearer ECG image with the waveform visible."
            ),
        )

    # Fill missing columns by interpolation.
    indices = np.arange(
        positions.size
    )

    positions[~valid] = np.interp(
        indices[~valid],
        indices[valid],
        positions[valid]
    )

    # Remove slow baseline drift.
    baseline = np.median(
        positions
    )

    signal = (
        baseline - positions
    )

    # Normalize.
    signal = signal - np.mean(signal)

    std = np.std(signal)

    if std > 1e-8:
        signal = signal / std

    # Resample to the model's expected 187 values.
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
            detail="The ECG waveform could not be extracted from the image."
        )

    return waveform


# --------------------------------------------------
# ECG image upload and screening
# --------------------------------------------------

@app.post("/api/analyze-image")
async def analyze_ecg_image(
    file: UploadFile = File(...)
):

    if not MODEL_LOADED or model is None:

        raise HTTPException(
            status_code=503,
            detail="ECG model is not loaded on the server.",
        )

    filename = file.filename or "uploaded_ecg_image"

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

    # 10 MB safety limit.
    if len(image_bytes) > 10 * 1024 * 1024:

        raise HTTPException(
            status_code=400,
            detail="The ECG image is too large. Maximum size is 10 MB.",
        )

    waveform = extract_waveform_from_image(
        image_bytes
    )

    X = waveform.reshape(
        1,
        INPUT_SAMPLES
    )

    try:

        prediction = int(
            model.predict(X)[0]
        )

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=f"Image ECG screening failed: {exc}",
        )

    result = build_prediction_result(
        prediction=prediction,
        X=X,
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
