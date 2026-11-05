pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const chooseFileBtn = document.getElementById("choose-file-btn");
const loadingEl = document.getElementById("loading");
const editorEl = document.getElementById("editor");
const fileNameEl = document.getElementById("file-name");
const pageCountEl = document.getElementById("page-count");
const newFileBtn = document.getElementById("new-file-btn");
const errorBox = document.getElementById("error-box");
const pagesContainer = document.getElementById("pages-container");
const addSignatureBtn = document.getElementById("add-signature-btn");
const placementCountEl = document.getElementById("placement-count");
const downloadBtn = document.getElementById("download-btn");

const typeInput = document.getElementById("type-input");
const typeFont = document.getElementById("type-font");
const typeColor = document.getElementById("type-color");
const typePreview = document.getElementById("type-preview");

const drawCanvas = document.getElementById("draw-canvas");
const drawColor = document.getElementById("draw-color");
const drawClearBtn = document.getElementById("draw-clear-btn");

const uploadInput = document.getElementById("upload-input");
const uploadPreview = document.getElementById("upload-preview");

let originalBytes = null;
let originalFileName = "document.pdf";
let pageOffsets = []; // { top, height, widthPt, heightPt, scale, index }
let placements = new Map(); // id -> { el, dataUrl, mime }
let selectedPlacementId = null;
let placementSeq = 0;
let activeTab = "type";
let hasDrawnOnCanvas = false;

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function resetToDropZone() {
  originalBytes = null;
  pageOffsets = [];
  placements.clear();
  selectedPlacementId = null;
  pagesContainer.innerHTML = "";
  editorEl.classList.add("hidden");
  dropZone.classList.remove("hidden");
  fileInput.value = "";
  clearError();
  updatePlacementCount();
}

chooseFileBtn.addEventListener("click", () => fileInput.click());
newFileBtn.addEventListener("click", resetToDropZone);

fileInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
});

["dragenter", "dragover"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
  });
});

dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  clearError();

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showError("Please choose a PDF file.");
    return;
  }

  originalFileName = file.name;
  dropZone.classList.add("hidden");
  loadingEl.classList.remove("hidden");

  try {
    const arrayBuffer = await file.arrayBuffer();
    originalBytes = new Uint8Array(arrayBuffer);
    loadingEl.classList.add("hidden");
    editorEl.classList.remove("hidden");
    await renderPages(originalBytes.slice());
  } catch (err) {
    console.error(err);
    loadingEl.classList.add("hidden");
    dropZone.classList.remove("hidden");
    showError("Could not read this PDF. It may be corrupted or password-protected.");
  }
}

async function renderPages(bytesForRendering) {
  const pdf = await pdfjsLib.getDocument({ data: bytesForRendering }).promise;
  const numPages = pdf.numPages;

  fileNameEl.textContent = originalFileName;
  pageCountEl.textContent = `${numPages} page${numPages === 1 ? "" : "s"}`;
  pagesContainer.innerHTML = "";
  pageOffsets = [];
  placements.clear();
  selectedPlacementId = null;
  updatePlacementCount();

  const displayWidth = pagesContainer.clientWidth || 700;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const nativeViewport = page.getViewport({ scale: 1 });
    const scale = displayWidth / nativeViewport.width;
    const viewport = page.getViewport({ scale });

    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page-wrapper";
    wrapper.style.width = `${viewport.width}px`;

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    wrapper.appendChild(canvas);
    pagesContainer.appendChild(wrapper);

    pageOffsets.push({
      top: wrapper.offsetTop,
      height: wrapper.offsetHeight,
      widthPt: nativeViewport.width,
      heightPt: nativeViewport.height,
      scale,
      index: pageNum - 1,
    });
  }
}

pagesContainer.addEventListener("click", (e) => {
  if (e.target.closest(".placement")) return;
  if (!selectedPlacementId) return;

  const placement = placements.get(selectedPlacementId);
  if (!placement) return;

  const rect = pagesContainer.getBoundingClientRect();
  const x = e.clientX - rect.left + pagesContainer.scrollLeft;
  const y = e.clientY - rect.top + pagesContainer.scrollTop;

  const el = placement.el;
  const width = el.offsetWidth;
  const height = el.offsetHeight;

  el.style.left = `${Math.max(0, x - width / 2)}px`;
  el.style.top = `${Math.max(0, y - height / 2)}px`;
});

// ---- Tabs ----

document.querySelectorAll(".sig-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".sig-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".sig-tab-panel").forEach((p) => {
      p.classList.toggle("hidden", p.dataset.panel !== activeTab);
    });
  });
});

// ---- Type tab ----

function refreshTypePreview() {
  const text = typeInput.value.trim() || "Your name";
  typePreview.textContent = text;
  typePreview.style.fontFamily = typeFont.value;
  typePreview.style.color = typeColor.value;
}

typeInput.addEventListener("input", refreshTypePreview);
typeFont.addEventListener("change", refreshTypePreview);
typeColor.addEventListener("change", refreshTypePreview);
refreshTypePreview();

async function renderTypeSignatureDataUrl() {
  const text = typeInput.value.trim();
  if (!text) {
    showError("Type your name to create a signature.");
    return null;
  }

  const fontFamily = typeFont.value;
  const fontSize = 72;

  try {
    await document.fonts.load(`${fontSize}px ${fontFamily}`);
    await document.fonts.ready;
  } catch (e) {
    // Font API not fully supported — proceed anyway with fallback font.
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(text);
  const padding = 20;
  canvas.width = Math.ceil(metrics.width) + padding * 2;
  canvas.height = Math.ceil(fontSize * 1.6);

  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = typeColor.value;
  ctx.textBaseline = "middle";
  ctx.fillText(text, padding, canvas.height / 2);

  return canvas.toDataURL("image/png");
}

// ---- Draw tab ----

const drawCtx = drawCanvas.getContext("2d");
let drawing = false;

function getCanvasPoint(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const scaleX = drawCanvas.width / rect.width;
  const scaleY = drawCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function startDraw(e) {
  drawing = true;
  hasDrawnOnCanvas = true;
  const { x, y } = getCanvasPoint(e);
  drawCtx.beginPath();
  drawCtx.moveTo(x, y);
  drawCanvas.setPointerCapture(e.pointerId);
}

function moveDraw(e) {
  if (!drawing) return;
  const { x, y } = getCanvasPoint(e);
  drawCtx.lineWidth = 3;
  drawCtx.lineCap = "round";
  drawCtx.strokeStyle = drawColor.value;
  drawCtx.lineTo(x, y);
  drawCtx.stroke();
}

function endDraw() {
  drawing = false;
}

drawCanvas.addEventListener("pointerdown", startDraw);
drawCanvas.addEventListener("pointermove", moveDraw);
drawCanvas.addEventListener("pointerup", endDraw);
drawCanvas.addEventListener("pointercancel", endDraw);

drawClearBtn.addEventListener("click", () => {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  hasDrawnOnCanvas = false;
});

// ---- Upload tab ----

let uploadDataUrl = null;

uploadInput.addEventListener("change", () => {
  const file = uploadInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    uploadDataUrl = reader.result;
    uploadPreview.src = uploadDataUrl;
    uploadPreview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});

// ---- Create + place signature ----

async function getCurrentSignatureDataUrl() {
  if (activeTab === "type") {
    return renderTypeSignatureDataUrl();
  }
  if (activeTab === "draw") {
    if (!hasDrawnOnCanvas) {
      showError("Draw your signature first.");
      return null;
    }
    return drawCanvas.toDataURL("image/png");
  }
  if (activeTab === "upload") {
    if (!uploadDataUrl) {
      showError("Choose an image file first.");
      return null;
    }
    return uploadDataUrl;
  }
  return null;
}

addSignatureBtn.addEventListener("click", async () => {
  clearError();
  const dataUrl = await getCurrentSignatureDataUrl();
  if (!dataUrl) return;

  const img = new Image();
  img.onload = () => {
    const defaultWidth = 180;
    const aspect = img.naturalHeight / img.naturalWidth || 0.4;
    const defaultHeight = Math.max(30, defaultWidth * aspect);
    createPlacement(dataUrl, defaultWidth, defaultHeight);
  };
  img.src = dataUrl;
});

function createPlacement(dataUrl, width, height) {
  const id = `sig-${placementSeq++}`;
  const el = document.createElement("div");
  el.className = "placement selected";
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;

  const scrollTop = pagesContainer.scrollTop;
  el.style.left = "20px";
  el.style.top = `${scrollTop + 20}px`;

  const img = document.createElement("img");
  img.src = dataUrl;
  el.appendChild(img);

  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    el.remove();
    placements.delete(id);
    if (selectedPlacementId === id) selectedPlacementId = null;
    updatePlacementCount();
  });
  el.appendChild(removeBtn);

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "resize-handle";
  el.appendChild(resizeHandle);

  el.addEventListener("pointerdown", (e) => {
    if (e.target === resizeHandle || e.target === removeBtn) return;
    e.stopPropagation();
    selectPlacement(id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = parseFloat(el.style.left);
    const startTop = parseFloat(el.style.top);

    function onMove(ev) {
      el.style.left = `${Math.max(0, startLeft + (ev.clientX - startX))}px`;
      el.style.top = `${Math.max(0, startTop + (ev.clientY - startY))}px`;
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  resizeHandle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    selectPlacement(id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = el.offsetWidth;
    const startHeight = el.offsetHeight;

    function onMove(ev) {
      const newWidth = Math.max(30, startWidth + (ev.clientX - startX));
      const newHeight = Math.max(20, startHeight + (ev.clientY - startY));
      el.style.width = `${newWidth}px`;
      el.style.height = `${newHeight}px`;
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });

  pagesContainer.appendChild(el);
  placements.set(id, { el, dataUrl });
  selectPlacement(id);
  updatePlacementCount();
}

function selectPlacement(id) {
  if (selectedPlacementId && placements.has(selectedPlacementId)) {
    placements.get(selectedPlacementId).el.classList.remove("selected");
  }
  selectedPlacementId = id;
  if (placements.has(id)) {
    placements.get(id).el.classList.add("selected");
  }
}

function updatePlacementCount() {
  const count = placements.size;
  placementCountEl.textContent = `${count} signature${count === 1 ? "" : "s"} placed`;
  downloadBtn.disabled = count === 0;
}

// ---- Download ----

function findPageForPlacement(top, height) {
  const center = top + height / 2;
  for (const p of pageOffsets) {
    if (center >= p.top && center <= p.top + p.height) return p;
  }
  // fallback: clamp to nearest page
  if (pageOffsets.length === 0) return null;
  return center < pageOffsets[0].top
    ? pageOffsets[0]
    : pageOffsets[pageOffsets.length - 1];
}

async function dataUrlToBytes(dataUrl) {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

downloadBtn.addEventListener("click", async () => {
  if (!originalBytes || placements.size === 0) return;

  clearError();
  downloadBtn.disabled = true;
  downloadBtn.textContent = "Preparing…";

  try {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(originalBytes);
    const pdfPages = pdfDoc.getPages();

    for (const { el, dataUrl } of placements.values()) {
      const left = parseFloat(el.style.left);
      const top = parseFloat(el.style.top);
      const width = el.offsetWidth;
      const height = el.offsetHeight;

      const pageInfo = findPageForPlacement(top, height);
      if (!pageInfo) continue;
      const pdfPage = pdfPages[pageInfo.index];

      const bytes = await dataUrlToBytes(dataUrl);
      const isJpeg = dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg");
      let image;
      try {
        image = isJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
      } catch (e) {
        image = isJpeg ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      }

      const scale = pageInfo.scale;
      const localTop = top - pageInfo.top;
      const pdfX = left / scale;
      const pdfYFromTop = localTop / scale;
      const pdfWidth = width / scale;
      const pdfHeight = height / scale;
      const pdfY = pageInfo.heightPt - pdfYFromTop - pdfHeight;

      pdfPage.drawImage(image, {
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight,
      });
    }

    const newBytes = await pdfDoc.save();
    const blob = new Blob([newBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const baseName = originalFileName.replace(/\.pdf$/i, "");
    const downloadName = `${baseName}-signed.pdf`;

    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    showError("Something went wrong while creating the signed PDF.");
  } finally {
    downloadBtn.textContent = "Download signed PDF";
    downloadBtn.disabled = placements.size === 0;
  }
});
