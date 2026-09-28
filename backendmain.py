from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from pathlib import Path
import numpy as np
import joblib

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "models" / "ecg_random_forest.joblib"

CLASS_NAMES = {
    0: "Normal",
    1: "Supraventricular",
    2: "Ventricular",
    3: "Fusion",
    4: "Unknown",
}

INPUT_SAMPLES = 187

model = None
MODEL_LOADED = False
MODEL_ERROR = None

try:
    print(f"Loading ECG model from: {MODEL_PATH}")
    model = joblib.load(MODEL_PATH)
    MODEL_LOADED = True
    print("ECG model loaded successfully.")
except Exception as exc:
    MODEL_ERROR = str(exc)
    print("Model loading failed:", MODEL_ERROR)

app = FastAPI(
    title="AI-Assisted ECG Screening API",
    description="Educational/research ECG screening prototype. Not a clinical diagnostic device.",
    version="1.1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ECGRequest(BaseModel):
    samples: List[float] = Field(..., min_length=187)
    filename: Optional[str] = None


@app.get("/")
def root():
    return {
        "service": "AI-Assisted ECG Screening API",
        "status": "running",
        "model_loaded": MODEL_LOADED,
        "clinical_diagnosis": False,
    }


@app.get("/api/health")
def health():
    response = {
        "status": "ok",
        "model_loaded": MODEL_LOADED,
        "model": "Random Forest",
        "input_samples_per_heartbeat": INPUT_SAMPLES,
        "classes": CLASS_NAMES,
        "clinical_diagnosis": False,
        "message": (
            "Educational/research screening prototype. "
            "Not a clinical diagnostic device."
        ),
    }
    if MODEL_ERROR:
        response["model_error"] = MODEL_ERROR
    return response


@app.post("/api/predict")
def predict_ecg(request: ECGRequest):
    if not MODEL_LOADED or model is None:
        raise HTTPException(
            status_code=503,
            detail="ECG model is not loaded on the server.",
        )

    try:
        samples = np.asarray(request.samples, dtype=np.float64)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="ECG samples must be numeric values.",
        )

    if samples.size < INPUT_SAMPLES:
        raise HTTPException(
            status_code=400,
            detail=f"At least {INPUT_SAMPLES} ECG samples are required.",
        )

    if not np.all(np.isfinite(samples)):
        raise HTTPException(
            status_code=400,
            detail="ECG contains invalid numeric values.",
        )

    heartbeat = samples[:INPUT_SAMPLES]
    X = heartbeat.reshape(1, INPUT_SAMPLES)

    try:
        prediction = int(model.predict(X)[0])
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Model prediction failed: {exc}",
        )

    result = {
        "prediction_class": prediction,
        "prediction": CLASS_NAMES.get(prediction, "Unknown"),
        "samples_received": int(samples.size),
        "samples_used": INPUT_SAMPLES,
        "filename": request.filename,
        "screening_type": "ECG heartbeat classification",
        "clinical_diagnosis": False,
        "prototype_note": (
            "The model was trained on 187-sample heartbeat segments. "
            "For continuous ECG files, this endpoint currently uses the "
            "first 187 samples; this is not a clinical segmentation method."
        ),
    }

    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(X)[0]
        result["probabilities"] = {
            CLASS_NAMES.get(int(cls), str(cls)): round(float(prob), 4)
            for cls, prob in zip(model.classes_, probabilities)
        }

    return result
