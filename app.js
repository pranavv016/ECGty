(() => {
  "use strict";

  // ==================================================
  // CONFIGURATION
  // ==================================================

  const DEMO_PATH = "./sample_ecg.csv";

  // Your deployed FastAPI backend
  const API_BASE = "https://ecgty.onrender.com";

  const MIN_SAMPLES = 10;
  const MODEL_MIN_SAMPLES = 187;

  let signal = null;
  let analysisToken = 0;

  const $ = id => document.getElementById(id);

  const els = {
    fileInput: $("fileInput"),
    dropzone: $("dropzone"),
    demoBtn: $("demoBtn"),
    clearBtn: $("clearBtn"),
    message: $("message"),

    filename: $("filename"),
    samples: $("samples"),
    duration: $("duration"),
    samplingRate: $("samplingRate"),

    waveform: $("waveform"),
    plotEmpty: $("plotEmpty"),
    waveNote: $("waveNote"),
    demoTag: $("demoTag"),
    statusPill: $("statusPill"),

    fMean: $("fMean"),
    fStd: $("fStd"),
    fMin: $("fMin"),
    fMax: $("fMax"),
    fRange: $("fRange"),
    fRms: $("fRms"),
    fPeaks: $("fPeaks"),
    fHr: $("fHr"),

    quality: $("quality"),

    resultBadge: $("resultBadge"),
    resultTitle: $("resultTitle"),
    resultText: $("resultText"),
    modelStatus: $("modelStatus")
  };


  // ==================================================
  // ERROR MESSAGE
  // ==================================================

  function showError(msg) {
    els.message.textContent = msg;
    els.message.classList.remove("hidden");
  }

  function clearError() {
    els.message.classList.add("hidden");
  }


  // ==================================================
  // FORMAT HELPERS
  // ==================================================

  function fmt(v, d = 3) {
    return Number.isFinite(v)
      ? v.toFixed(d)
      : "—";
  }

  function setText(el, v) {
    el.textContent = v == null ? "—" : v;
  }


  // ==================================================
  // CSV PARSER
  //
  // Supported:
  //
  // time,amplitude
  // 0.00,0.12
  // 0.01,0.15
  //
  // OR
  //
  // amplitude
  // 0.12
  // 0.15
  // ==================================================

  function parseCsv(text) {

    text = String(text || "")
      .replace(/^\uFEFF/, "");

    const lines = text
      .split(/\r?\n/)
      .map((s, i) => ({
        s: s.trim(),
        n: i + 1
      }))
      .filter(x =>
        x.s &&
        !x.s.startsWith("#")
      );

    if (!lines.length) {
      throw new Error(
        "The CSV file is empty — no ECG data was found."
      );
    }

    const header = lines[0].s
      .split(",")
      .map(x =>
        x.trim().toLowerCase()
      );

    const twoColumns =
      header.length === 2 &&
      header[0] === "time" &&
      header[1] === "amplitude";

    const oneColumn =
      header.length === 1 &&
      header[0] === "amplitude";

    if (!twoColumns && !oneColumn) {
      throw new Error(
        'Unsupported CSV format. Use "time,amplitude" or a single "amplitude" column.'
      );
    }

    const samples = [];
    const time = twoColumns
      ? []
      : null;


    // Read data rows
    for (const row of lines.slice(1)) {

      const parts = row.s
        .split(",")
        .map(x => x.trim());


      // ----------------------------------------------
      // time,amplitude
      // ----------------------------------------------

      if (twoColumns) {

        if (
          parts.length !== 2 ||
          parts.some(x => x === "")
        ) {
          throw new Error(
            `Line ${row.n}: expected time and amplitude values.`
          );
        }

        const t = Number(parts[0]);
        const a = Number(parts[1]);

        if (
          !Number.isFinite(t) ||
          !Number.isFinite(a)
        ) {
          throw new Error(
            `Line ${row.n}: values must be valid numbers.`
          );
        }

        time.push(t);
        samples.push(a);

      }


      // ----------------------------------------------
      // amplitude only
      // ----------------------------------------------

      else {

        if (
          parts.length !== 1 ||
          parts[0] === ""
        ) {
          throw new Error(
            `Line ${row.n}: expected one amplitude value.`
          );
        }

        const a = Number(parts[0]);

        if (!Number.isFinite(a)) {
          throw new Error(
            `Line ${row.n}: amplitude must be a valid number.`
          );
        }

        samples.push(a);
      }
    }


    if (samples.length < MIN_SAMPLES) {
      throw new Error(
        `Insufficient ECG data. At least ${MIN_SAMPLES} samples are required.`
      );
    }


    // ==================================================
    // TIME INFORMATION
    // ==================================================

    let fs = null;
    let duration = null;

    if (time) {

      for (
        let i = 1;
        i < time.length;
        i++
      ) {

        if (!(time[i] > time[i - 1])) {
          throw new Error(
            "Time values must be strictly increasing."
          );
        }
      }

      duration =
        time[time.length - 1] -
        time[0];

      if (!(duration > 0)) {
        throw new Error(
          "The time column must span a positive duration."
        );
      }


      const intervals = [];

      for (
        let i = 1;
        i < time.length;
        i++
      ) {
        intervals.push(
          time[i] - time[i - 1]
        );
      }


      const mean =
        intervals.reduce(
          (a, b) => a + b,
          0
        ) / intervals.length;


      const maxDeviation =
        Math.max(
          ...intervals.map(
            x =>
              Math.abs(x - mean) /
              mean
          )
        );


      // Only calculate sampling rate
      // when intervals are sufficiently uniform.

      if (
        mean > 0 &&
        maxDeviation <= 0.001
      ) {
        fs = 1 / mean;
      }
    }


    return {
      samples,
      time,
      fs,
      duration
    };
  }


  // ==================================================
  // LOAD DEMO ECG
  // ==================================================

  async function loadDemo() {

    clearError();

    try {

      const url =
        DEMO_PATH +
        "?cache=" +
        Date.now();

      const response =
        await fetch(url, {
          cache: "no-store"
        });

      if (!response.ok) {

        throw new Error(
          `Demo ECG file could not be loaded (HTTP ${response.status}).`
        );
      }


      const csvText =
        await response.text();


      if (!csvText.trim()) {

        throw new Error(
          "The demo ECG file is empty."
        );
      }


      const parsed =
        parseCsv(csvText);


      loadSignal(
        parsed,
        {
          filename: "sample_ecg.csv",
          demo: true
        }
      );

    }

    catch (error) {

      console.error(
        "Demo ECG loading error:",
        error
      );

      showError(
        "Demo ECG could not be loaded. " +
        error.message
      );
    }
  }


  // ==================================================
  // LOAD SIGNAL
  // ==================================================

  function loadSignal(parsed, meta) {

    clearError();

    // Cancel any previous analysis
    analysisToken++;

    signal = {
      ...parsed,

      filename:
        meta.filename,

      demo:
        meta.demo
    };


    // ----------------------------------------------
    // File information
    // ----------------------------------------------

    setText(
      els.filename,

      (meta.demo
        ? "DEMO ECG • "
        : "") +
      meta.filename
    );


    setText(
      els.samples,

      parsed.samples.length
        .toLocaleString()
    );


    setText(
      els.duration,

      parsed.duration != null
        ? fmt(parsed.duration, 3) +
          " s"
        : "Not available"
    );


    setText(
      els.samplingRate,

      parsed.fs != null
        ? fmt(parsed.fs, 2) +
          " Hz"
        : "Not determinable"
    );


    // ----------------------------------------------
    // Demo label
    // ----------------------------------------------

    els.demoTag.classList.toggle(
      "hidden",
      !meta.demo
    );


    els.statusPill.textContent =
      meta.demo
        ? "Demo ECG loaded"
        : "ECG loaded";


    els.statusPill.className =
      "pill ok";


    els.waveNote.textContent =
      meta.demo
        ? "DEMO ECG waveform"
        : "Uploaded ECG waveform";


    els.plotEmpty.classList.add(
      "hidden"
    );


    // ----------------------------------------------
    // Draw waveform
    // ----------------------------------------------

    drawWaveform(
      parsed.samples,
      parsed.time
    );


    // ----------------------------------------------
    // Calculate transparent features
    // ----------------------------------------------

    calculateFeatures(
      parsed.samples,
      parsed.fs
    );


    // ----------------------------------------------
    // Check model input requirement
    // ----------------------------------------------

    if (
      parsed.samples.length <
      MODEL_MIN_SAMPLES
    ) {

      els.resultBadge.textContent =
        "INSUFFICIENT DATA";

      els.resultBadge.className =
        "tag neutral";


      els.resultTitle.textContent =
        "More ECG samples required";


      els.resultText.textContent =
        `The screening model requires at least ${MODEL_MIN_SAMPLES} samples. ` +
        `This file contains ${parsed.samples.length} samples.`;


      els.modelStatus.textContent =
        "Waiting for sufficient ECG samples";

      return;
    }


    // ----------------------------------------------
    // Start ML analysis
    // ----------------------------------------------

    els.resultBadge.textContent =
      "ANALYZING";


    els.resultBadge.className =
      "tag neutral";


    els.resultTitle.textContent =
      "Running ECG screening model...";


    els.resultText.textContent =
      "Sending the ECG signal to the FastAPI screening backend.";


    els.modelStatus.textContent =
      "Connecting to FastAPI...";


    classifySignal(signal);
  }


  // ==================================================
  // SEND ECG TO FASTAPI MODEL
  // ==================================================

  async function classifySignal(currentSignal) {

    const token =
      ++analysisToken;


    try {

      const response =
        await fetch(
          API_BASE +
          "/api/predict",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body: JSON.stringify({

              samples:
                currentSignal.samples,

              filename:
                currentSignal.filename
            })
          }
        );


      let data = null;

      try {

        data =
          await response.json();

      }

      catch (_) {

        data = null;
      }


      // --------------------------------------------
      // Backend error
      // --------------------------------------------

      if (!response.ok) {

        throw new Error(
          data?.detail ||
          `Backend returned HTTP ${response.status}.`
        );
      }


      // --------------------------------------------
      // Ignore old request
      // --------------------------------------------

      if (
        token !== analysisToken ||
        signal !== currentSignal
      ) {
        return;
      }


      const prediction =
        String(
          data?.prediction ||
          "Unknown"
        );


      const predictionLower =
        prediction.toLowerCase();


      // --------------------------------------------
      // Convert model's 5 classes into
      // simple screening display
      //
      // Normal = NORMAL
      //
      // Everything else =
      // ABNORMAL / NON-NORMAL
      // --------------------------------------------

      const isNormal =
        predictionLower ===
        "normal";


      const displayResult =
        isNormal
          ? "NORMAL"
          : "ABNORMAL";


      // --------------------------------------------
      // Result badge
      // --------------------------------------------

      els.resultBadge.textContent =
        displayResult;


      els.resultBadge.className =
        isNormal
          ? "tag good"
          : "tag warning";


      // --------------------------------------------
      // Result title
      // --------------------------------------------

      els.resultTitle.textContent =
        isNormal
          ? "Normal screening pattern"
          : "Abnormal screening pattern";


      // --------------------------------------------
      // Probability information
      // --------------------------------------------

      let probabilityText = "";


      if (
        data?.probabilities &&
        typeof data.probabilities ===
          "object"
      ) {

        const entries =
          Object.entries(
            data.probabilities
          )
          .sort(
            (a, b) =>
              Number(b[1]) -
              Number(a[1])
          );


        if (entries.length) {

          const top =
            entries[0];


          const percent =
            Number(top[1]) * 100;


          if (
            Number.isFinite(percent)
          ) {

            probabilityText =
              ` Model class: ${prediction} ` +
              `(${percent.toFixed(1)}%).`;
          }
        }
      }


      // --------------------------------------------
      // User-facing result
      // --------------------------------------------

      if (isNormal) {

        els.resultText.textContent =
          "The connected Random Forest model classified " +
          "this ECG heartbeat as Normal." +
          probabilityText +
          " This is an educational/research screening result, " +
          "not a clinical diagnosis.";

      }

      else {

        els.resultText.textContent =
          "The connected Random Forest model classified " +
          `this ECG heartbeat as ${prediction}. ` +
          "For this prototype, this is displayed as an " +
          "ABNORMAL / NON-NORMAL screening pattern." +
          probabilityText +
          " This is an educational/research screening result, " +
          "not a clinical diagnosis.";
      }


      // --------------------------------------------
      // Model status
      // --------------------------------------------

      els.modelStatus.textContent =
        "FastAPI connected • Random Forest model loaded";


      console.log(
        "ECG prediction:",
        data
      );

    }


    // ==================================================
    // ERROR HANDLING
    // ==================================================

    catch (error) {

      if (
        token !== analysisToken ||
        signal !== currentSignal
      ) {
        return;
      }


      console.error(
        "ECG classification error:",
        error
      );


      els.resultBadge.textContent =
        "ANALYSIS ERROR";


      els.resultBadge.className =
        "tag neutral";


      els.resultTitle.textContent =
        "ML analysis could not be completed";


      els.resultText.textContent =
        error.message +
        " The waveform and signal features are still available.";


      els.modelStatus.textContent =
        "Backend connection/error";
    }
  }


  // ==================================================
  // SIGNAL FEATURES
  // ==================================================

  function calculateFeatures(x, fs) {

    const n =
      x.length;


    const mean =
      x.reduce(
        (a, b) => a + b,
        0
      ) / n;


    const variance =
      x.reduce(
        (sum, value) =>
          sum +
          (value - mean) ** 2,
        0
      ) / n;


    const sd =
      Math.sqrt(variance);


    const min =
      Math.min(...x);


    const max =
      Math.max(...x);


    const rms =
      Math.sqrt(
        x.reduce(
          (sum, value) =>
            sum +
            value * value,
          0
        ) / n
      );


    setText(
      els.fMean,
      fmt(mean)
    );


    setText(
      els.fStd,
      fmt(sd)
    );


    setText(
      els.fMin,
      fmt(min)
    );


    setText(
      els.fMax,
      fmt(max)
    );


    setText(
      els.fRange,
      fmt(max - min)
    );


    setText(
      els.fRms,
      fmt(rms)
    );


    // ----------------------------------------------
    // No sampling rate
    // ----------------------------------------------

    if (!fs) {

      setText(
        els.fPeaks,
        "—"
      );


      setText(
        els.fHr,
        "—"
      );


      setQuality(
        "neutral",
        "Signal quality: sampling rate unavailable"
      );

      return;
    }


    const peaks =
      findPeaks(
        x,
        fs
      );


    setText(
      els.fPeaks,
      peaks.length
    );


    const heartRate =
      peaks.length >= 2

        ? 60 /
          median(
            diff(peaks)
              .map(
                d =>
                  d / fs
              )
          )

        : null;


    setText(
      els.fHr,

      heartRate != null
        ? fmt(
            heartRate,
            1
          ) +
          " bpm"

        : "—"
    );


    const flat =
      x.reduce(
        (sum, value, i) =>
          sum +
          (
            i &&
            Math.abs(
              value -
              x[i - 1]
            ) <
            Math.max(
              sd * 1e-8,
              1e-12
            )
              ? 1
              : 0
          ),
        0
      ) /
      (n - 1);


    if (peaks.length < 2) {

      setQuality(
        "neutral",
        "Signal quality: undetermined"
      );

    }

    else if (flat < 0.05) {

      setQuality(
        "good",
        "Signal quality: good (heuristic)"
      );

    }

    else if (flat < 0.15) {

      setQuality(
        "fair",
        "Signal quality: fair (heuristic)"
      );

    }

    else {

      setQuality(
        "poor",
        "Signal quality: poor (heuristic)"
      );
    }
  }


  // ==================================================
  // PEAK DETECTION
  // ==================================================

  function findPeaks(x, fs) {

    const mean =
      x.reduce(
        (a, b) => a + b,
        0
      ) / x.length;


    const sd =
      Math.sqrt(
        x.reduce(
          (sum, value) =>
            sum +
            (value - mean) ** 2,
          0
        ) / x.length
      );


    if (!sd) {
      return [];
    }


    const distance =
      Math.max(
        1,
        Math.round(
          0.25 * fs
        )
      );


    const z =
      x.map(
        value =>
          Math.abs(
            value - mean
          )
      );


    const threshold =
      Math.max(
        0.9 * sd,
        0.25 * sd
      );


    const peaks = [];


    for (
      let i = 1;
      i < x.length - 1;
      i++
    ) {

      if (

        z[i] >= threshold &&

        z[i] >= z[i - 1] &&

        z[i] >= z[i + 1] &&

        (
          peaks.length === 0 ||
          i -
          peaks[
            peaks.length - 1
          ] >= distance
        )

      ) {

        peaks.push(i);
      }
    }


    return peaks;
  }


  function diff(a) {

    return a
      .slice(1)
      .map(
        (v, i) =>
          v - a[i]
      );
  }


  function median(a) {

    a =
      [...a].sort(
        (x, y) =>
          x - y
      );


    return a.length % 2

      ? a[
          (a.length - 1) / 2
        ]

      : (
          a[
            a.length / 2 - 1
          ] +
          a[
            a.length / 2
          ]
        ) / 2;
  }


  function setQuality(
    cls,
    text
  ) {

    els.quality.cla
