(() => {
  "use strict";
  const DEMO_PATH = "data/sample_ecg.csv";
  const MIN_SAMPLES = 10;
  let signal = null;

  const $ = id => document.getElementById(id);
  const els = {
    fileInput:$("fileInput"),dropzone:$("dropzone"),demoBtn:$("demoBtn"),clearBtn:$("clearBtn"),
    message:$("message"),filename:$("filename"),samples:$("samples"),duration:$("duration"),
    samplingRate:$("samplingRate"),waveform:$("waveform"),plotEmpty:$("plotEmpty"),waveNote:$("waveNote"),
    demoTag:$("demoTag"),statusPill:$("statusPill"),fMean:$("fMean"),fStd:$("fStd"),fMin:$("fMin"),
    fMax:$("fMax"),fRange:$("fRange"),fRms:$("fRms"),fPeaks:$("fPeaks"),fHr:$("fHr"),
    quality:$("quality"),resultBadge:$("resultBadge"),resultTitle:$("resultTitle"),
    resultText:$("resultText"),modelStatus:$("modelStatus")
  };

  function showError(msg){ els.message.textContent=msg; els.message.classList.remove("hidden"); }
  function clearError(){ els.message.classList.add("hidden"); }
  function fmt(v,d=3){return Number.isFinite(v)?v.toFixed(d):"—";}
  function setText(el,v){el.textContent=v==null?"—":v;}

  function parseCsv(text){
    const lines=text.replace(/^\\uFEFF/,"").split(/\\r?\\n/);
    const rows=lines.map((s,i)=>({s:s.trim(),n:i+1})).filter(x=>x.s && !x.s.startsWith("#"));
    if(!rows.length) throw Error("The CSV file is empty — no ECG data was found.");
    const header=rows[0].s.split(",").map(x=>x.trim().toLowerCase());
    const two=header.length===2 && header[0]==="time" && header[1]==="amplitude";
    const one=header.length===1 && header[0]==="amplitude";
    if(!two && !one) throw Error('Unsupported CSV format. Use "time,amplitude" or a single "amplitude" column.');
    const samples=[], time=two?[]:null;
    for(const r of rows.slice(1)){
      const p=r.s.split(",").map(x=>x.trim());
      if(two){
        if(p.length!==2 || p.some(x=>x==="")) throw Error(`Line ${r.n}: expected time and amplitude values.`);
        const t=Number(p[0]), a=Number(p[1]);
        if(!Number.isFinite(t)||!Number.isFinite(a)) throw Error(`Line ${r.n}: values must be valid numbers.`);
        time.push(t);samples.push(a);
      }else{
        if(p.length!==1 || p[0]==="") throw Error(`Line ${r.n}: expected one amplitude value.`);
        const a=Number(p[0]);if(!Number.isFinite(a)) throw Error(`Line ${r.n}: amplitude must be a valid number.`);
        samples.push(a);
      }
    }
    if(samples.length<MIN_SAMPLES) throw Error(`Insufficient ECG data. At least ${MIN_SAMPLES} samples are required.`);
    let fs=null,dur=null;
    if(time){
      for(let i=1;i<time.length;i++) if(!(time[i]>time[i-1])) throw Error("Time values must be strictly increasing.");
      dur=time[time.length-1]-time[0]; if(!(dur>0)) throw Error("The time column must span a positive duration.");
      const dt=[];for(let i=1;i<time.length;i++)dt.push(time[i]-time[i-1]);
      const mean=dt.reduce((a,b)=>a+b,0)/dt.length;
      const dev=Math.max(...dt.map(x=>Math.abs(x-mean)/mean));
      if(mean>0 && dev<=0.001) fs=1/mean;
    }
    return {samples,time,fs,duration:dur};
  }

  async function loadDemo(){
    try{
      const r=await fetch(DEMO_PATH+"?v=1"); if(!r.ok) throw Error("Demo ECG file could not be loaded.");
      const parsed=parseCsv(await r.text());
      loadSignal(parsed,{filename:"sample_ecg.csv",demo:true});
    }catch(e){showError(e.message);}
  }

  function loadSignal(parsed,meta){
    clearError();
    signal={...parsed,filename:meta.filename,demo:meta.demo};
    setText(els.filename,(meta.demo?"DEMO ECG • ":"")+meta.filename);
    setText(els.samples,parsed.samples.length.toLocaleString());
    setText(els.duration,parsed.duration!=null?fmt(parsed.duration,3)+" s":"Not available");
    setText(els.samplingRate,parsed.fs!=null?fmt(parsed.fs,2)+" Hz":"Not determinable");
    els.demoTag.classList.toggle("hidden",!meta.demo);
    els.statusPill.textContent=meta.demo?"Demo ECG loaded":"ECG loaded";
    els.statusPill.className="pill ok";
    els.waveNote.textContent=meta.demo?"DEMO ECG waveform":"Uploaded ECG waveform";
    els.plotEmpty.classList.add("hidden");
    drawWaveform(parsed.samples,parsed.time);
    calculateFeatures(parsed.samples,parsed.fs);
    els.resultBadge.textContent="SCREENING PROTOTYPE";
    els.resultBadge.className="tag neutral";
    els.resultTitle.textContent=meta.demo?"Demo signal loaded":"Signal loaded";
    els.resultText.textContent="The waveform and transparent signal features are available. A genuine ML classification requires a trained model connected to the FastAPI backend.";
    els.modelStatus.textContent="Not connected in standalone GitHub Pages mode";
  }

  function calculateFeatures(x,fs){
    const n=x.length,mean=x.reduce((a,b)=>a+b,0)/n;
    const variance=x.reduce((s,v)=>s+(v-mean)**2,0)/n, sd=Math.sqrt(variance);
    const min=Math.min(...x),max=Math.max(...x),rms=Math.sqrt(x.reduce((s,v)=>s+v*v,0)/n);
    setText(els.fMean,fmt(mean));setText(els.fStd,fmt(sd));setText(els.fMin,fmt(min));
    setText(els.fMax,fmt(max));setText(els.fRange,fmt(max-min));setText(els.fRms,fmt(rms));
    if(!fs){setText(els.fPeaks,"—");setText(els.fHr,"—");setQuality("neutral","Signal quality: sampling rate unavailable");return;}
    const peaks=findPeaks(x,fs);
    setText(els.fPeaks,peaks.length);
    const hr=peaks.length>=2?60/median(diff(peaks).map(d=>d/fs)):null;
    setText(els.fHr,hr!=null?fmt(hr,1)+" bpm":"—");
    const flat=x.reduce((s,v,i)=>s+(i&&Math.abs(v-x[i-1])<Math.max(sd*1e-8,1e-12)?1:0),0)/(n-1);
    if(peaks.length<2)setQuality("neutral","Signal quality: undetermined (fewer than two candidate peaks)");
    else if(flat<.05)setQuality("good","Signal quality: good (heuristic)");
    else if(flat<.15)setQuality("fair","Signal quality: fair (heuristic)");
    else setQuality("poor","Signal quality: poor (heuristic)");
  }

  function findPeaks(x,fs){
    const sd=Math.sqrt(x.reduce((s,v)=>s+v*v,0)/x.length);
    if(!sd)return[];
    const dist=Math.max(1,Math.round(.25*fs));
    const mean=x.reduce((a,b)=>a+b,0)/x.length;
    const z=x.map(v=>Math.abs(v-mean));
    const threshold=Math.max(.9*sd,0.25*sd);
    const peaks=[];
    for(let i=1;i<x.length-1;i++){
      if(z[i]>=threshold&&z[i]>=z[i-1]&&z[i]>=z[i+1]&&(peaks.length===0||i-peaks[peaks.length-1]>=dist))peaks.push(i);
    }
    return peaks;
  }
  function diff(a){return a.slice(1).map((v,i)=>v-a[i]);}
  function median(a){a=[...a].sort((x,y)=>x-y);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;}
  function setQuality(cls,text){els.quality.className="quality "+cls;els.quality.textContent=text;}

  function drawWaveform(x,time){
    const c=els.waveform, dpr=devicePixelRatio||1, rect=c.getBoundingClientRect();
    c.width=rect.width*dpr;c.height=rect.height*dpr;
    const ctx=c.getContext("2d");ctx.scale(dpr,dpr);
    const w=rect.width,h=rect.height,pad={l:45,r:18,t:18,b:28};
    ctx.fillStyle="#071923";ctx.fillRect(0,0,w,h);
    const min=Math.min(...x),max=Math.max(...x),range=(max-min)||1;
    ctx.strokeStyle="rgba(170,205,210,.13)";ctx.lineWidth=1;
    for(let i=0;i<7;i++){const y=pad.t+(h-pad.t-pad.b)*i/6;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();}
    for(let i=0;i<9;i++){const xx=pad.l+(w-pad.l-pad.r)*i/8;ctx.beginPath();ctx.moveTo(xx,pad.t);ctx.lineTo(xx,h-pad.b);ctx.stroke();}
    ctx.strokeStyle="#5de1d6";ctx.lineWidth=1.7;ctx.beginPath();
    x.forEach((v,i)=>{const xx=pad.l+(w-pad.l-pad.r)*i/(x.length-1),yy=pad.t+(h-pad.t-pad.b)*(1-(v-min)/range);i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});
    ctx.stroke();
    ctx.fillStyle="#9fb8c0";ctx.font="11px system-ui";ctx.fillText(fmt(max,2),7,18);ctx.fillText(fmt(min,2),7,h-pad.b);
    if(time){ctx.fillText(fmt(time[0],2)+" s",pad.l,h-8);ctx.fillText(fmt(time[time.length-1],2)+" s",w-65,h-8);}
  }

  function clearSignal(){
    signal=null;clearError();els.statusPill.textContent="No ECG loaded";els.statusPill.className="pill neutral";
    ["filename","samples","duration","samplingRate","fMean","fStd","fMin","fMax","fRange","fRms","fPeaks","fHr"].forEach(id=>setText($(id),"—"));
    els.waveNote.textContent="Load an ECG to display the signal.";els.demoTag.classList.add("hidden");els.plotEmpty.classList.remove("hidden");
    const ctx=els.waveform.getContext("2d"),r=els.waveform.getBoundingClientRect();ctx.clearRect(0,0,r.width,r.height);
    els.resultBadge.textContent="WAITING";els.resultBadge.className="tag neutral";els.resultTitle.textContent="No ECG analyzed";
    els.resultText.textContent="Upload a file or load the demo ECG to begin.";els.modelStatus.textContent="Frontend demo mode";setQuality("neutral","Signal quality: —");
    els.fileInput.value="";
  }

  els.fileInput.addEventListener("change",e=>{const f=e.target.files?.[0];if(f)readFile(f);});
  els.dropzone.addEventListener("click",()=>els.fileInput.click());
  els.dropzone.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();els.fileInput.click();}});
  ["dragenter","dragover"].forEach(ev=>els.dropzone.addEventListener(ev,e=>{e.preventDefault();els.dropzone.classList.add("focus");}));
  ["dragleave","drop"].forEach(ev=>els.dropzone.addEventListener(ev,e=>{e.preventDefault();els.dropzone.classList.remove("focus");}));
  els.dropzone.addEventListener("drop",e=>{const f=e.dataTransfer.files?.[0];if(f)readFile(f);});
  els.demoBtn.addEventListener("click",loadDemo);els.clearBtn.addEventListener("click",clearSignal);
  window.addEventListener("resize",()=>{if(signal)drawWaveform(signal.samples,signal.time);});
  function readFile(file){
    if(!/\.csv$/i.test(file.name)){showError("Please select a CSV file (.csv).");return;}
    if(file.size===0){showError("The selected CSV file is empty.");return;}
    const reader=new FileReader();reader.onload=()=>{try{loadSignal(parseCsv(String(reader.result)),{filename:file.name,demo:false});}catch(e){showError(e.message);}};reader.onerror=()=>showError("The CSV file could not be read.");reader.readAsText(file);
  }
  loadDemo();
})();