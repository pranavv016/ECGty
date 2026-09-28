# AI-Assisted ECG Screening System

**Cardio AI — educational/research prototype**

This repository is a replacement for the deleted GitHub project.

## What works immediately

The root `index.html` is a standalone website and can be deployed directly with **GitHub Pages**.

It supports:

- CSV upload
- drag-and-drop
- `time,amplitude` CSV
- single `amplitude` CSV
- validation for empty/invalid data
- ECG waveform visualization without a chart library
- sample count
- duration only when time data exists
- sampling rate only when it can be determined from uniform timestamps
- basic signal-level features
- a built-in **DEMO ECG** clearly labeled as demo data
- responsive healthcare dashboard

The standalone frontend **does not invent an ML prediction**. A genuine NORMAL/ABNORMAL result requires a trained model.

## Project structure

```text
AI-ECG-Screening/
├── index.html
├── style.css
├── app.js
├── data/
│   └── sample_ecg.csv
├── backend/
│   ├── main.py
│   └── __init__.py
├── models/
├── requirements.txt
└── README.md
```

## GitHub Pages deployment

1. Create a new GitHub repository, for example `AI-ECG-Screening`.
2. Upload **all files and folders in this repository**.
3. Open GitHub → repository → **Settings** → **Pages**.
4. Under **Build and deployment**, choose:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
5. Save.
6. GitHub will provide the website URL.

Because the frontend is at the repository root, GitHub Pages can serve it directly.

## Optional FastAPI backend

Install:

```bash
pip install -r requirements.txt
```

Run:

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

The backend provides:

- `GET /api/health`
- `POST /api/analyze`

The backend intentionally does not claim a disease diagnosis.

## Adding a real ML model later

The original project used a Random Forest trained on MIT-BIH-derived heartbeat segments:

- 187 samples per heartbeat
- binary benchmark task: `NORMAL` vs `ABNORMAL`

Keep the distinction clear:

- `NORMAL` / `ABNORMAL` is a dataset classification label.
- `ABNORMAL` is **not** the name of a disease.
- A model probability is not a clinical risk score.
- Model performance from a student dataset is not clinical validation.

Do not put patient-identifiable ECG data into a public GitHub repository.

## Safety

This is an educational/research prototype and is **not a clinical diagnostic device**.
It must not be used for diagnosis, treatment, triage or medical decision-making.
