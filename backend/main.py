%%writefile ecg_backend/main.py

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from pathlib import Path

import numpy as np
import joblib

# --------------------------------------------------
# Paths
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "models" / "ecg_random_forest.joblib"

# --------------------------------------------------
# Load model
# --------------------------------------------------

print("Loading ECG model...")

try:
    model = joblib.load(MODEL_PATH)
    MODEL_LOADED = True
    print("ECG model loaded successfully.")
except Exception as e:
    model = None
    MODEL_LOADED = False
    print("Model loading failed:", e)

# --------------------------------------------------
# FastAPI
# --------------------------------------------------

app = FastAPI(
    title="AI-Assisted ECG Screening API",
    description="Educational/research ECG screening prototype",
    version="1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --------------------------------------------------
# ECG classes
# --------------------------------------------------

CLASS_NAMES = {
    0: "Normal",
    1: "Supraventricular",
    2: "Ventricular",
    3: "Fusion",
    4: "Unknown"
}

# --------------------------------------------------
# Request format
# --------------------------------------------------

class ECGRequest(BaseModel):
    samples: List[float] = Field(..., min_length=187)
    filename: Optional[str] = None

# --------------------------------------------------
# Health endpoint
# --------------------------------------------------

@app.get("/api/health")
def health():

    return {
        "status": "ok",
        "model_loaded": MODEL_LOADED,
        "model": "Random Forest",
        "input_samples_per_beat": 187,
        "classes": CLASS_NAMES
    }

# --------------------------------------------------
# Prediction endpoint
# --------------------------------------------------

@app.post("/api/predict")
def predict_ecg(request: ECGRequest):

    if not MODEL_LOADED:
        raise HTTPException(
            status_code=500,
            detail="ECG model is not loaded."
        )

    samples = np.asarray(request.samples, dtype=np.float64)

    # Validate numbers
    if not np.all(np.isfinite(samples)):
        raise HTTPException(
            status_code=400,
            detail="ECG contains invalid numeric values."
        )

    if len(samples) < 187:
        raise HTTPException(
            status_code=400,
            detail="At least 187 ECG samples are required."
        )

    # --------------------------------------------------
    # Current prototype:
    # Use first 187 samples as one heartbeat segment.
    #
    # Later we can improve this using R-peak detection
    # and automatic heartbeat segmentation.
    # --------------------------------------------------

    heartbeat = samples[:187]

    X = heartbeat.reshape(1, -1)

    prediction = int(model.predict(X)[0])

    probabilities = None

    if hasattr(model, "predict_proba"):
        probabilities = model.predict_proba(X)[0]

    result = {
        "prediction_class": prediction,
        "prediction": CLASS_NAMES.get(
            prediction,
            "Unknown"
        ),
        "samples_used": 187,
        "filename": request.filename,
        "screening_type": "ECG heartbeat classification",
        "clinical_diagnosis": False
    }

    if probabilities is not None:

        result["probabilities"] = {
            CLASS_NAMES.get(
                int(cls),
                str(cls)
            ): round(float(prob), 4)
            for cls, prob in zip(
                model.classes_,
                probabilities
            )
        }

    return result
