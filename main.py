from pathlib import Path
from typing import Optional, List
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT=Path(__file__).resolve().parents[1]
FRONTEND=ROOT

app=FastAPI(title="AI-Assisted ECG Screening System API",version="1.0")
app.add_middleware(CORSMiddleware,allow_origins=["*"],allow_credentials=False,allow_methods=["*"],allow_headers=["*"])

class ECGRequest(BaseModel):
    samples: List[float]=Field(...,min_length=10)
    time: Optional[List[float]]=None
    sampling_rate_hz: Optional[float]=None
    filename: Optional[str]=None

def infer_fs(t):
    if not t or len(t)<2:return None
    a=np.asarray(t,float)
    if not np.isfinite(a).all() or np.any(np.diff(a)<=0):return None
    dt=np.diff(a);m=float(np.mean(dt))
    if m<=0:return None
    dev=float(np.max(np.abs(dt-m))/m)
    return 1/m if dev<=0.001 else None

@app.get("/api/health")
def health():
    return {"status":"ok","api":"ready","model_loaded":False,
            "message":"Standalone ECG analysis API is running. Add a trained model before enabling ML predictions."}

@app.post("/api/analyze")
def analyze(p:ECGRequest):
    x=np.asarray(p.samples,float)
    if not np.isfinite(x).all():raise HTTPException(400,"ECG samples must be finite numeric values.")
    if len(x)<10:raise HTTPException(400,"At least 10 ECG samples are required.")
    fs=p.sampling_rate_hz or infer_fs(p.time)
    if p.time is not None and len(p.time)!=len(p.samples):raise HTTPException(400,"Time and sample arrays must have equal length.")
    return {"status":"ok","filename":p.filename,"samples":len(x),
            "sampling_rate_hz":fs,"min":float(x.min()),"max":float(x.max()),
            "mean":float(x.mean()),"std":float(x.std()),
            "clinical_diagnosis":False,
            "message":"Signal validated. This endpoint does not diagnose disease."}

if FRONTEND.exists():
    app.mount("/",StaticFiles(directory=FRONTEND,html=True),name="frontend")
