pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const chooseFileBtn = document.getElementById("choose-file-btn");
const loadingEl = document.getElementById("loading");
const editorEl = document.getElementById("editor");
const pageGrid = document.getElementById("page-grid");
const fileNameEl = document.getElementById("file-name");
const pageCountEl = document.getElementById("page-count");
const selectedCountEl = document.getElementById("selected-count");
const downloadBtn = document.getElementById("download-btn");
const selectAllBtn = document.getElementById("select-all-btn");
const clearSelectionBtn = document.getElementById("clear-selection-btn");
const newFileBtn = document.getElementById("new-file-btn");
const errorBox = document.getElementById("error-box");

let originalBytes = null;
let originalFileName = "document.pdf";
let totalPages = 0;
const markedForDeletion = new Set();

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
  totalPages = 0;
  markedForDeletion.clear();
  pageGrid.innerHTML = "";
  editorEl.classList.add("hidden");
  dropZone.classList.remove("hidden");
  fileInput.value = "";
  clearError();
}

chooseFileBtn.addEventListener("click", () => fileInput.click());
newFileBtn.addEventListener("click", resetToDropZone);

fileInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) {
    handleFile(e.target.files[0]);
  }
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
    await renderPages(originalBytes.slice());
    loadingEl.classList.add("hidden");
    editorEl.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    loadingEl.classList.add("hidden");
    dropZone.classList.remove("hidden");
    showError("Could not read this PDF. It may be corrupted or password-protected.");
  }
}

async function renderPages(bytesForRendering) {
  const pdf = await pdfjsLib.getDocument({ data: bytesForRendering }).promise;
  totalPages = pdf.numPages;
  markedForDeletion.clear();

  fileNameEl.textContent = originalFileName;
  pageCountEl.textContent = `${totalPages} page${totalPages === 1 ? "" : "s"}`;
  pageGrid.innerHTML = "";

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.4 });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    const thumb = document.createElement("div");
    thumb.className = "page-thumb";
    thumb.dataset.pageIndex = String(pageNum - 1);

    const strike = document.createElement("div");
    strike.className = "strike";

    const badge = document.createElement("div");
    badge.className = "delete-badge";
    badge.textContent = "×";

    const label = document.createElement("div");
    label.className = "page-label";
    label.textContent = `Page ${pageNum}`;

    thumb.appendChild(canvas);
    thumb.appendChild(strike);
    thumb.appendChild(badge);
    thumb.appendChild(label);

    thumb.addEventListener("click", () => toggleMark(pageNum - 1, thumb));

    pageGrid.appendChild(thumb);
  }

  updateSelectionUI();
}

function toggleMark(pageIndex, thumbEl) {
  if (markedForDeletion.has(pageIndex)) {
    markedForDeletion.delete(pageIndex);
    thumbEl.classList.remove("marked");
  } else {
    if (markedForDeletion.size >= totalPages - 1) {
      showError("You can't delete every page — at least one page must remain.");
      return;
    }
    clearError();
    markedForDeletion.add(pageIndex);
    thumbEl.classList.add("marked");
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = markedForDeletion.size;
  selectedCountEl.textContent = `${count} page${count === 1 ? "" : "s"} selected for deletion`;
  downloadBtn.disabled = count === 0;
}

selectAllBtn.addEventListener("click", () => {
  clearError();
  const thumbs = pageGrid.querySelectorAll(".page-thumb");
  // Leave the last page unmarked so at least one page always remains.
  thumbs.forEach((thumb, idx) => {
    if (idx === thumbs.length - 1) return;
    markedForDeletion.add(idx);
    thumb.classList.add("marked");
  });
  updateSelectionUI();
});

clearSelectionBtn.addEventListener("click", () => {
  clearError();
  markedForDeletion.clear();
  pageGrid.querySelectorAll(".page-thumb").forEach((thumb) => thumb.classList.remove("marked"));
  updateSelectionUI();
});

downloadBtn.addEventListener("click", async () => {
  if (!originalBytes || markedForDeletion.size === 0) return;

  clearError();
  downloadBtn.disabled = true;
  downloadBtn.textContent = "Preparing…";

  try {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(originalBytes);

    const pagesToRemove = Array.from(markedForDeletion).sort((a, b) => b - a);
    for (const pageIndex of pagesToRemove) {
      pdfDoc.removePage(pageIndex);
    }

    const newBytes = await pdfDoc.save();
    const blob = new Blob([newBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const baseName = originalFileName.replace(/\.pdf$/i, "");
    const downloadName = `${baseName}-edited.pdf`;

    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    showError("Something went wrong while creating the new PDF.");
  } finally {
    downloadBtn.textContent = "Download edited PDF";
    downloadBtn.disabled = markedForDeletion.size === 0;
  }
});
