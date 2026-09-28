
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
    version="2.0",
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
# Request model
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
# Prediction
# --------------------------------------------------

@app.post("/api/predict")
def predict_ecg(request: ECGRequest):

    if not MODEL_LOADED or model is None:
        raise HTTPException(
            status_code=503,
            detail="ECG model is not loaded on the server.",
        )

    # Convert input to NumPy
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

    # Check sample count
    if samples.size < INPUT_SAMPLES:

        raise HTTPException(
            status_code=400,
            detail=(
                f"At least {INPUT_SAMPLES} "
                "ECG samples are required."
            ),
        )

    # Check invalid numbers
    if not np.all(np.isfinite(samples)):

        raise HTTPException(
            status_code=400,
            detail="ECG contains invalid numeric values.",
        )

    # --------------------------------------------------
    # Use first 187 samples
    # --------------------------------------------------

    heartbeat = samples[:INPUT_SAMPLES]

    X = heartbeat.reshape(
        1,
        INPUT_SAMPLES
    )

    # --------------------------------------------------
    # Model prediction
    # --------------------------------------------------

    try:

        prediction = int(
            model.predict(X)[0]
        )

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=f"Model prediction failed: {exc}",
        )

    # --------------------------------------------------
    # Convert prediction to Normal / Abnormal
    # --------------------------------------------------

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

        "samples_received": int(
            samples.size
        ),

        "samples_used": INPUT_SAMPLES,

        "filename": request.filename,

        "screening_type":
            "Binary ECG screening",

        "clinical_diagnosis": False,

        "prototype_note": (
            "Educational/research screening prototype. "
            "The model was trained using the PTBDB ECG dataset. "
            "This output is not a clinical diagnosis."
        ),
    }

    # --------------------------------------------------
    # Prediction probabilities
    # --------------------------------------------------

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
            # Prediction itself succeeded,
            # so don't fail the whole request
            # just because probabilities failed.
            pass

    return result
