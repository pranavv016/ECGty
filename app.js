(() => {
  "use strict";

  // =========================================================
  // CONFIGURATION
  // =========================================================

  const API_BASE = "https://ecgty.onrender.com";
  const DEMO_PATH = "./sample_ecg.csv";

  // Your Random Forest backend requires 187 samples
  const MODEL_MIN_SAMPLES = 187;
  const MIN_SAMPLES = 10;

  let signal = null;
  let analysisToken = 0;

  // =========================================================
  // GET HTML ELEMENTS
  // =========================================================

  const $ = (id) => document.getElementById(id);

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

  // =========================================================
  // CHECK PAGE ELEMENTS
  // =========================================================

  const required = [
    "fileInput",
    "dropzone",
    "demoBtn",
    "clearBtn",
    "message",
    "filename",
    "samples",
    "duration",
    "samplingRate",
    "waveform",
    "plotEmpty",
    "waveNote",
    "demoTag",
    "statusPill",
    "fMean",
    "fStd",
    "fMin",
    "fMax",
    "fRange",
    "fRms",
    "fPeaks",
    "fHr",
    "quality",
    "resultBadge",
    "resultTitle",
    "resultText",
    "modelStatus"
  ];

  const missing = required.filter((key) => !els[key]);

  if (missing.length > 0) {
    console.error("Missing HTML elements:", missing);

    alert(
      "ECG website error: some page elements are missing.\n\n" +
      "Missing: " +
      missing.join(", ")
    );

    return;
  }

  // =========================================================
  // BASIC HELPERS
  // =========================================================

  function showError(message) {
    els.message.textContent = message;
    els.message.classList.remove("hidden");
  }

  function clearError() {
    els.message.textContent = "";
    els.message.classList.add("hidden");
  }

  function fmt(value, decimals = 3) {
    return Number.isFinite(value)
      ? Number(value).toFixed(decimals)
      : "—";
  }

  function setText(element, value) {
    element.textContent =
      value === null || value === undefined
        ? "—"
        : value;
  }

  // =========================================================
  // CSV PARSER
  // =========================================================

  function parseCsv(text) {

    text = String(text || "")
      .replace(/^\uFEFF/, "")
      .trim();

    if (!text) {
      throw new Error(
        "The ECG CSV file is empty."
      );
    }

    const lines = text
      .split(/\r?\n/)
      .map((line, index) => ({
        text: line.trim(),
        number: index + 1
      }))
      .filter((row) =>
        row.text &&
        !row.text.startsWith("#")
      );

    if (lines.length < 2) {
      throw new Error(
        "The ECG CSV does not contain enough data."
      );
    }

    const header = lines[0].text
      .split(",")
      .map((x) =>
        x.trim().toLowerCase()
      );

    const hasTime =
      header.length === 2 &&
      header[0] === "time" &&
      header[1] === "amplitude";

    const amplitudeOnly =
      header.length === 1 &&
      header[0] === "amplitude";

    if (!hasTime && !amplitudeOnly) {
      throw new Error(
        'Unsupported CSV format.\n\n' +
        'Use either:\n' +
        'time,amplitude\n' +
        '0.00,0.12\n\n' +
        'or:\n' +
        'amplitude\n' +
        '0.12'
      );
    }

    const samples = [];
    const time = hasTime ? [] : null;

    for (const row of lines.slice(1)) {

      const parts = row.text
        .split(",")
        .map((x) => x.trim());

      if (hasTime) {

        if (
          parts.length !== 2 ||
          parts[0] === "" ||
          parts[1] === ""
        ) {
          throw new Error(
            `Line ${row.number}: expected time and amplitude values.`
          );
        }

        const t = Number(parts[0]);
        const a = Number(parts[1]);

        if (
          !Number.isFinite(t) ||
          !Number.isFinite(a)
        ) {
          throw new Error(
            `Line ${row.number}: invalid numeric value.`
          );
        }

        time.push(t);
        samples.push(a);

      } else {

        if (
          parts.length !== 1 ||
          parts[0] === ""
        ) {
          throw new Error(
            `Line ${row.number}: expected one amplitude value.`
          );
        }

        const a = Number(parts[0]);

        if (!Number.isFinite(a)) {
          throw new Error(
            `Line ${row.number}: amplitude must be a valid number.`
          );
        }

        samples.push(a);
      }
    }

    if (samples.length < MIN_SAMPLES) {
      throw new Error(
        `Insufficient ECG data. Only ${samples.length} samples were found.`
      );
    }

    // =======================================================
    // TIME / SAMPLING RATE
    // =======================================================

    let duration = null;
    let samplingRate = null;

    if (time) {

      for (let i = 1; i < time.length; i++) {

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
          "The time column does not contain a valid duration."
        );
      }

      const intervals = [];

      for (let i = 1; i < time.length; i++) {
        intervals.push(
          time[i] - time[i - 1]
        );
      }

      const meanInterval =
        intervals.reduce(
          (sum, value) => sum + value,
          0
        ) / intervals.length;

      const maxDeviation =
        Math.max(
          ...intervals.map(
            (value) =>
              Math.abs(
                value - meanInterval
              ) / meanInterval
          )
        );

      // Only report sampling rate if time intervals
      // are sufficiently uniform.
      if (
        meanInterval > 0 &&
        maxDeviation <= 0.001
      ) {
        samplingRate =
          1 / meanInterval;
      }
    }

    return {
      samples,
      time,
      duration,
      fs: samplingRate
    };
  }

  // =========================================================
  // BUILT-IN DEMO ECG
  //
  // This is only a synthetic demonstration signal.
  // It is NOT patient data.
  // =========================================================

  function createBuiltInDemo() {

    const n = 187;
    const samples = [];

    for (let i = 0; i < n; i++) {

      const phase =
        (i % 62) / 62;

      let value =
        0.02 *
        Math.sin(
          phase * Math.PI * 2
        );

      // P-wave
      value +=
        0.08 *
        Math.exp(
          -Math.pow(
            (phase - 0.20) / 0.055,
            2
          )
        );

      // Q wave
      value -=
        0.12 *
        Math.exp(
          -Math.pow(
            (phase - 0.36) / 0.018,
            2
          )
        );

      // R wave
      value +=
        0.95 *
        Math.exp(
          -Math.pow(
            (phase - 0.40) / 0.018,
            2
          )
        );

      // S wave
      value -=
        0.25 *
        Math.exp(
          -Math.pow(
            (phase - 0.44) / 0.025,
            2
          )
        );

      // T wave
      value +=
        0.22 *
        Math.exp(
          -Math.pow(
            (phase - 0.68) / 0.09,
            2
          )
        );

      samples.push(value);
    }

    return {
      samples,
      time: null,
      duration: null,
      fs: null
    };
  }

  // =========================================================
  // LOAD DEMO ECG
  // =========================================================

  async function loadDemo() {

    console.log("Try Demo ECG clicked");

    clearError();

    els.statusPill.textContent =
      "Loading demo ECG...";

    els.statusPill.className =
      "pill neutral";

    els.resultBadge.textContent =
      "LOADING";

    els.resultBadge.className =
      "tag neutral";

    els.resultTitle.textContent =
      "Loading demo ECG...";

    els.resultText.textContent =
      "Preparing the built-in demonstration signal.";

    els.modelStatus.textContent =
      "Loading demo signal...";

    try {

      // First try the actual CSV from GitHub Pages.
      const response =
        await fetch(
          DEMO_PATH +
          "?v=" +
          Date.now(),
          {
            cache: "no-store"
          }
        );

      if (response.ok) {

        const csv =
          await response.text();

        if (csv.trim()) {

          const parsed =
            parseCsv(csv);

          loadSignal(
            parsed,
            {
              filename:
                "sample_ecg.csv",
              demo: true
            }
          );

          return;
        }
      }

      throw new Error(
        "sample_ecg.csv could not be fetched."
      );

    } catch (error) {

      console.warn(
        "CSV demo could not be loaded. Using built-in demo.",
        error
      );

      // IMPORTANT:
      // Do NOT leave the user with a blank screen.
      // Use the built-in synthetic demo instead.

      const demo =
        createBuiltInDemo();

      loadSignal(
        demo,
        {
          filename:
            "Built-in Demo ECG",
          demo: true
        }
      );
    }
  }

  // =========================================================
  // LOAD SIGNAL
  // =========================================================

  function loadSignal(parsed, meta) {

    clearError();

    analysisToken++;

    signal = {
      samples: parsed.samples,
      time: parsed.time,
      duration: parsed.duration,
      fs: parsed.fs,
      filename: meta.filename,
      demo: meta.demo
    };

    // =======================================================
    // FILE INFORMATION
    // =======================================================

    els.filename.textContent =
      meta.demo
        ? "DEMO ECG • " + meta.filename
        : meta.filename;

    els.samples.textContent =
      parsed.samples.length.toLocaleString();

    els.duration.textContent =
      parsed.duration !== null
        ? fmt(parsed.duration, 3) + " s"
        : "Not available";

    els.samplingRate.textContent =
      parsed.fs !== null
        ? fmt(parsed.fs, 2) + " Hz"
        : "Not determinable";

    // =======================================================
    // DEMO LABEL
    // =======================================================

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
        ? "DEMO ECG waveform • synthetic/research demonstration"
        : "Uploaded ECG waveform";

    els.plotEmpty.classList.add(
      "hidden"
    );

    // =======================================================
    // DRAW
    // =======================================================

    drawWaveform(
      parsed.samples,
      parsed.time
    );

    // =======================================================
    // FEATURES
    // =======================================================

    calculateFeatures(
      parsed.samples,
      parsed.fs
    );

    // =======================================================
    // MODEL REQUIREMENT
    // =======================================================

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
        `This ECG contains ${parsed.samples.length} samples.`;

      els.modelStatus.textContent =
        "Waiting for sufficient ECG samples";

      return;
    }

    // =======================================================
    // RUN ML
    // =======================================================

    classifySignal(signal);
  }

  // =========================================================
  // SEND ECG TO FASTAPI
  // =========================================================

  async function classifySignal(currentSignal) {

    const token =
      ++analysisToken;

    els.resultBadge.textContent =
      "ANALYZING";

    els.resultBadge.className =
      "tag neutral";

    els.resultTitle.textContent =
      "Running ECG screening model...";

    els.resultText.textContent =
      "Connecting to the deployed FastAPI Random Forest model.";

    els.modelStatus.textContent =
      "Connecting to FastAPI...";

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
      } catch (_) {
        data = null;
      }

      if (!response.ok) {

        throw new Error(
          data?.detail ||
          `FastAPI returned HTTP ${response.status}.`
        );
      }

      // Ignore old requests
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

      const isNormal =
        prediction.toLowerCase() ===
        "normal";

      // =====================================================
      // DISPLAY NORMAL / ABNORMAL
      // =====================================================

      if (isNormal) {

        els.resultBadge.textContent =
          "NORMAL";

        els.resultBadge.className =
          "tag good";

        els.resultTitle.textContent =
          "Normal screening pattern";

        els.resultText.textContent =
          "The connected Random Forest model classified " +
          "this ECG heartbeat as Normal. " +
          "This is an educational/research screening result, " +
          "not a clinical diagnosis.";

      } else {

        els.resultBadge.textContent =
          "ABNORMAL";

        els.resultBadge.className =
          "tag warning";

        els.resultTitle.textContent =
          "Abnormal / non-normal screening pattern";

        els.resultText.textContent =
          "The connected Random Forest model classified " +
          `this ECG heartbeat as ${prediction}. ` +
          "For this prototype, this is displayed as " +
          "ABNORMAL / NON-NORMAL. " +
          "This is an educational/research screening result, " +
          "not a clinical diagnosis.";
      }

      // =====================================================
      // PROBABILITY
      // =====================================================

      if (
        data?.probabilities &&
        typeof data.probabilities === "object"
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

        if (entries.length > 0) {

          const probability =
            Number(entries[0][1]);

          if (
            Number.isFinite(probability)
          ) {

            els.resultText.textContent +=
              ` Model class confidence: ${(probability * 100).toFixed(1)}%.`;
          }
        }
      }

      els.modelStatus.textContent =
        "FastAPI connected • Random Forest model loaded";

      console.log(
        "ECG prediction response:",
        data
      );

    } catch (error) {

      if (
        token !== analysisToken ||
        signal !== currentSignal
      ) {
        return;
      }

      console.error(
        "ML analysis error:",
        error
      );

      els.resultBadge.textContent =
        "ANALYSIS ERROR";

      els.resultBadge.className =
        "tag neutral";

      els.resultTitle.textContent =
        "ML analysis could not be completed";

      els.resultText.textContent =
        "The ECG waveform was loaded successfully, " +
        "but the FastAPI model could not be reached. " +
        "The waveform and features are still available. " +
        "Error: " +
        error.message;

      els.modelStatus.textContent =
        "FastAPI connection/error";
    }
  }

  // =========================================================
  // SIGNAL FEATURES
  // =========================================================

  function calculateFeatures(x, fs) {

    const n = x.length;

    const mean =
      x.reduce(
        (sum, value) =>
          sum + value,
        0
      ) / n;

    const variance =
      x.reduce(
        (sum, value) =>
          sum +
          Math.pow(
            value - mean,
            2
          ),
        0
      ) / n;

    const std =
      Math.sqrt(variance);

    const min =
      Math.min(...x);

    const max =
      Math.max(...x);

    const range =
      max - min;

    const rms =
      Math.sqrt(
        x.reduce(
          (sum, value) =>
            sum +
            value * value,
          0
        ) / n
      );

    els.fMean.textContent =
      fmt(mean);

    els.fStd.textContent =
      fmt(std);

    els.fMin.textContent =
      fmt(min);

    els.fMax.textContent =
      fmt(max);

    els.fRange.textContent =
      fmt(range);

    els.fRms.textContent =
      fmt(rms);

    // Sampling rate unavailable
    if (!fs) {

      els.fPeaks.textContent =
        "—";

      els.fHr.textContent =
        "—";

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

    els.fPeaks.textContent =
      peaks.length;

    if (peaks.length >= 2) {

      const intervals =
        diff(peaks)
          .map(
            (d) =>
              d / fs
          );

      const medianInterval =
        median(intervals);

      if (
        medianInterval > 0
      ) {

        els.fHr.textContent =
          fmt(
            60 /
            medianInterval,
            1
          ) +
          " bpm";

      } else {

        els.fHr.textContent =
          "—";
      }

    } else {

      els.fHr.textContent =
        "—";
    }

    setQuality(
      "good",
      "Signal quality: calculated from available signal data"
    );
  }

  // =========================================================
  // PEAK DETECTION
  // =========================================================

  function findPeaks(x, fs) {

    if (!x.length || !fs) {
      return [];
    }

    const mean =
      x.reduce(
        (a, b) => a + b,
        0
      ) / x.length;

    const std =
      Math.sqrt(
        x.reduce(
          (sum, value) =>
            sum +
            Math.pow(
              value - mean,
              2
            ),
          0
        ) / x.length
      );

    if (!std) {
      return [];
    }

    const minDistance =
      Math.max(
        1,
        Math.round(
          0.25 * fs
        )
      );

    const threshold =
      mean +
      0.8 * std;

    const peaks = [];

    for (
      let i = 1;
      i < x.length - 1;
      i++
    ) {

      if (
        x[i] > threshold &&
        x[i] >= x[i - 1] &&
        x[i] >= x[i + 1]
      ) {

        if (
          peaks.length === 0 ||
          i -
          peaks[
            peaks.length - 1
          ] >= minDistance
        ) {

          peaks.push(i);
        }
      }
    }

    return peaks;
  }

  function diff(array) {

    return array
      .slice(1)
      .map(
        (value, index) =>
          value -
          array[index]
      );
  }

  function median(array) {

    if (!array.length) {
      return null;
    }

    const sorted =
      [...array].sort(
        (a, b) => a - b
      );

    const middle =
      Math.floor(
        sorted.length / 2
      );

    if (
      sorted.length % 2
    ) {
      return sorted[middle];
    }

    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }

  function setQuality(
    className,
    message
  ) {

    els.quality.className =
      "quality " +
      className;

    els.quality.textContent =
      message;
  }

  // =========================================================
  // DRAW ECG WAVEFORM
  // =========================================================

  function drawWaveform(
    values,
    time
  ) {

    const canvas =
      els.waveform;

    const rect =
      canvas.getBoundingClientRect();

    const width =
      Math.max(
        rect.width,
        300
      );

    const height =
      Math.max(
        rect.height,
        250
      );

    const dpr =
      window.devicePixelRatio ||
      1;

    canvas.width =
      width * dpr;

    canvas.height =
      height * dpr;

    const ctx =
      canvas.getContext("2d");

    ctx.setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );

    const w = width;
    const h = height;

    const padLeft = 45;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 28;

    // Background
    ctx.fillStyle =
      "#071923";

    ctx.fillRect(
      0,
      0,
      w,
      h
    );

    const min =
      Math.min(...values);

    const max =
      Math.max(...values);

    const range =
      max - min || 1;

    // =======================================================
    // GRID
    // =======================================================

    ctx.strokeStyle =
      "rgba(170,205,210,.13)";

    ctx.lineWidth = 1;

    for (let i = 0; i < 7; i++) {

      const y =
        padTop +
        (
          h -
          padTop -
          padBottom
        ) *
        i /
        6;

      ctx.beginPath();

      ctx.moveTo(
        padLeft,
        y
      );

      ctx.lineTo(
        w - padRight,
        y
      );

      ctx.stroke();
    }

    for (let i = 0; i < 9; i++) {

      const xx =
        padLeft +
        (
          w -
          padLeft -
          padRight
        ) *
        i /
        8;

      ctx.beginPath();

      ctx.moveTo(
        xx,
        padTop
      );

      ctx.lineTo(
        xx,
        h - padBottom
      );

      ctx.stroke();
    }

    // =======================================================
    // ECG LINE
    // =======================================================

    ctx.strokeStyle =
      "#5de1d6";

    ctx.lineWidth = 1.8;

    ctx.beginPath();

    values.forEach(
      (value, index) => {

        const x =
          padLeft +
          (
            w -
            padLeft -
            padRight
          ) *
          index /
          Math.max(
            values.length - 1,
            1
          );

        const y =
          padTop +
          (
            h -
            padTop -
            padBottom
          ) *
          (
            1 -
            (
              value - min
            ) /
            range
          );

        if (index === 0) {
          ctx.moveTo(
            x,
            y
          );
        } else {
          ctx.lineTo(
            x,
            y
          );
        }
      }
    );

    ctx.stroke();

    // =======================================================
    // AXIS LABELS
    // =======================================================

    ctx.fillStyle =
      "#9fb8c0";

    ctx.font =
      "11px system-ui";

    ctx.fillText(
      fmt(max, 2),
      7,
      18
    );

    ctx.fillText(
      fmt(min, 2),
      7,
      h - padBottom
    );

    if (time) {

      ctx.fillText(
        fmt(time[0], 2) +
        " s",
        padLeft,
        h - 8
      );

      ctx.fillText(
        fmt(
          time[
            time.length - 1
          ],
          2
        ) +
        " s",
        w - 65,
        h - 8
      );
    }
  }

  // =========================================================
  // CLEAR ECG
  // =========================================================

  function clearSignal() {

    signal = null;

    analysisToken++;

    clearError();

    els.statusPill.textContent =
      "No ECG loaded";

    els.statusPill.className =
      "pill neutral";

    [
      els.filename,
      els.samples,
      els.duration,
      els.samplingRate,
      els.fMean,
      els.fStd,
      els.fMin,
      els.fMax,
      els.fRange,
      els.fRms,
      els.fPeaks,
      els.fHr
    ].forEach(
      (element) => {
        element.textContent = "—";
      }
    );

    els.waveNote.textContent =
      "Load an ECG to display the signal.";

    els.demoTag.classList.add(
      "hidden"
    );

    els.plotEmpty.classList.remove(
      "hidden"
    );

    const ctx =
      els.waveform.getContext(
        "2d"
      );

    const rect =
      els.waveform.getBoundingClientRect();

    ctx.clearRect(
      0,
      0,
      rect.width,
      rect.height
    );

    els.resultBadge.textContent =
      "WAITING";

    els.resultBadge.className =
      "tag neutral";

    els.resultTitle.textContent =
      "No ECG analyzed";

    els.resultText.textContent =
      "Upload a file or load the demo ECG to begin.";

    els.modelStatus.textContent =
      "Frontend waiting";

    setQuality(
      "neutral",
      "Signal quality: —"
    );

    els.fileInput.value = "";
  }

  // =========================================================
  // FILE UPLOAD
  // =========================================================

  function readFile(file) {

    clearError();

    if (
      !file.name
        .toLowerCase()
        .endsWith(".csv")
    ) {

      showError(
        "Please select a CSV ECG file (.csv)."
      );

      return;
    }

    if (file.size === 0) {

      showError(
        "The selected ECG file is empty."
      );

      return;
    }

    els.statusPill.textContent =
      "Reading ECG...";

    els.statusPill.className =
      "pill neutral";

    const reader =
      new FileReader();

    reader.onload = () => {

      try {

        const parsed =
          parseCsv(
            reader.result
          );

        loadSignal(
          parsed,
          {
            filename:
              file.name,
            demo:
              false
          }
        );

      } catch (error) {

        console.error(
          "CSV error:",
          error
        );

        showError(
          error.message
        );
      }
    };

    reader.onerror = () => {

      showError(
        "The ECG CSV file could not be read."
      );
    };

    reader.readAsText(file);
  }

  // =========================================================
  // BUTTONS
  // =========================================================

  els.demoBtn.addEventListener(
    "click",
    (event) => {

      event.preventDefault();

      console.log(
        "DEMO BUTTON PRESSED"
      );

      loadDemo();
    }
  );

  els.clearBtn.addEventListener(
    "click",
    (event) => {

      event.preventDefault();

      clearSignal();
    }
  );

  // =========================================================
  // FILE INPUT
  // =========================================================

  els.fileInput.addEventListener(
    "change",
    (event) => {

      const file =
        event.target.files &&
        event.target.files[0];

      if (file) {
        readFile(file);
      }
    }
  );

  // =========================================================
  // DROPZONE
  // =========================================================

  els.dropzone.addEventListener(
    "click",
    () => {
      els.fileInput.click();
    }
  );

  els.dropzone.addEventListener(
    "keydown",
    (event) => {

      if (
        event.key === "Enter" ||
        event.key === " "
      ) {

        event.preventDefault();

        els.fileInput.click();
      }
    }
  );

  ["dragenter", "dragover"]
    .forEach(
      (eventName) => {

        els.dropzone.addEventListener(
          eventName,
          (event) => {

            event.preventDefault();

            els.dropzone.classList.add(
              "focus"
            );
          }
        );
      }
    );

  ["dragleave", "drop"]
    .forEach(
      (eventName) => {

        els.dropzone.addEventListener(
          eventName,
          (event) => {

            event.preventDefault();

            els.dropzone.classList.remove(
              "focus"
            );
          }
        );
      }
    );

  els.dropzone.addEventListener(
    "drop",
    (event) => {

      const file =
        event.dataTransfer.files &&
        event.dataTransfer.files[0];

      if (file) {
        readFile(file);
      }
    }
  );

  // =========================================================
  // WINDOW RESIZE
  // =========================================================

  window.addEventListener(
    "resize",
    () => {

      if (signal) {

        drawWaveform(
          signal.samples,
          signal.time
        );
      }
    }
  );

  // =========================================================
  // INITIAL STATE
  //
  // IMPORTANT:
  // Do NOT automatically call loadDemo().
  // The user should press Try Demo ECG.
  // =========================================================

  console.log(
    "AI ECG Screening frontend loaded successfully."
  );

})();
