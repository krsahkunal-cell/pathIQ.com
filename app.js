
/* ==========================================
   PATHIQ - FOOTPATH USABILITY AI
   Frontend + YOLOv8 API Integration
========================================== */

(() => {
    "use strict";

    const API_BASE = "http://127.0.0.1:8000";

    const $ = id => document.getElementById(id);

    let selectedFile = null;
    let resultImageUrl = null;
    let history = [];

    const elements = {
        apiStatus: $("apiStatus"),
        message: $("message"),
        modelName: $("modelName"),
        imageInput: $("imageInput"),
        preview: $("preview"),
        previewWrap: $("previewWrap"),
        analyzeBtn: $("analyzeBtn"),
        confidence: $("confidence"),
        confidenceLabel: $("confidenceLabel"),
        removeImage: $("removeImage"),
        resultStage: $("resultStage"),
        resultCount: $("resultCount"),
        detectionsTable: $("detectionsTable"),
        downloadBtn: $("downloadBtn"),
        historyList: $("historyList"),
        clearHistory: $("clearHistory"),
        apiMetric: $("apiMetric"),
        objectMetric: $("objectMetric"),
        confidenceMetric: $("confidenceMetric"),
        historyMetric: $("historyMetric")
    };

    function showMessage(message, type = "info") {
        if (!elements.message) return;

        elements.message.textContent = message;
        elements.message.style.color =
            type === "error" ? "#dc2626" :
            type === "success" ? "#16a34a" : "#64748b";
    }

    // BACKEND HEALTH CHECK

    async function checkBackend() {
        try {
            const response = await fetch(`${API_BASE}/health`);

            if (!response.ok) {
                throw new Error("Backend health check failed");
            }

            const data = await response.json();

            if (elements.apiStatus) {
                elements.apiStatus.textContent = "API Connected";
            }

            if (elements.apiMetric) {
                elements.apiMetric.textContent = "Online";
            }

            if (elements.modelName) {
                elements.modelName.textContent =
                    data.model || (data.model_loaded ? "YOLOv8 Ready" : "YOLOv8");
            }

            showMessage("PathIQ backend connected successfully.", "success");

        } catch (error) {
            if (elements.apiStatus) {
                elements.apiStatus.textContent = "API Offline";
            }

            if (elements.apiMetric) {
                elements.apiMetric.textContent = "Offline";
            }

            showMessage(
                "Backend is not connected. Start FastAPI on port 8000.",
                "error"
            );

            console.error("PathIQ API:", error);
        }
    }

    // IMAGE PREVIEW

    function handleImage(event) {
        const file = event.target.files?.[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
            showMessage("Please select a valid image.", "error");
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            showMessage("Image must be smaller than 10 MB.", "error");
            return;
        }

        selectedFile = file;

        if (elements.preview) {
            elements.preview.src = URL.createObjectURL(file);
        }

        if (elements.previewWrap) {
            elements.previewWrap.hidden = false;
        }

        if (elements.analyzeBtn) {
            elements.analyzeBtn.disabled = false;
        }

        showMessage("Image ready for analysis.", "success");
    }

    function removeImage() {
        selectedFile = null;

        if (elements.imageInput) {
            elements.imageInput.value = "";
        }

        if (elements.preview) {
            elements.preview.removeAttribute("src");
        }

        if (elements.previewWrap) {
            elements.previewWrap.hidden = true;
        }

        if (elements.analyzeBtn) {
            elements.analyzeBtn.disabled = true;
        }

        showMessage("Image removed.");
    }

    // CONFIDENCE CONTROL

    function updateConfidence() {
        if (!elements.confidence) return;

        const value = Number(elements.confidence.value);

        if (elements.confidenceLabel) {
            elements.confidenceLabel.textContent =
                Math.round(value * 100) + "%";
        }
    }

    // YOLO IMAGE ANALYSIS
    // Endpoint and response format must match backend/main.py

    async function analyzeImage() {
        if (!selectedFile) {
            showMessage("Please upload an image first.", "error");
            return;
        }

        const button = elements.analyzeBtn;

        try {
            button.disabled = true;
            button.textContent = "Analyzing...";

            showMessage("YOLOv8 is analyzing your image...");

            const formData = new FormData();
            formData.append("file", selectedFile);

            const confidence = Number(
                elements.confidence?.value || 0.25
            );

            const response = await fetch(
                `${API_BASE}/predict?conf=${confidence}`,
                {
                    method: "POST",
                    body: formData
                }
            );

            if (!response.ok) {
                throw new Error(
                    "Prediction failed: HTTP " + response.status
                );
            }

            const data = await response.json();

            if (data.success === false) {
                throw new Error(data.message || "Detection failed.");
            }

            displayResults(data);

            addHistory({
                filename: selectedFile.name,
                count: getDetections(data).length,
                time: new Date().toLocaleString()
            });

            showMessage("Image analysis completed successfully.", "success");

        } catch (error) {
            console.error("PathIQ detection error:", error);
            showMessage(error.message, "error");
        } finally {
            button.disabled = !selectedFile;
            button.textContent = "Analyze Image";
        }
    }

    // SUPPORT COMMON YOLO RESPONSE SHAPES

    function getDetections(data) {
        if (Array.isArray(data.detections)) return data.detections;
        if (Array.isArray(data.results)) return data.results;
        return [];
    }

    function displayResults(data) {
        const detections = getDetections(data);

        if (elements.resultCount) {
            elements.resultCount.textContent = detections.length;
        }

        if (elements.objectMetric) {
            elements.objectMetric.textContent = detections.length;
        }

        if (elements.confidenceMetric) {
            const average = detections.length
                ? detections.reduce(
                    (sum, item) => sum + Number(item.confidence || 0), 0
                ) / detections.length
                : 0;

            elements.confidenceMetric.textContent =
                (average * 100).toFixed(1) + "%";
        }

        if (elements.detectionsTable) {
            const tbody = elements.detectionsTable.tagName === "TBODY"
                ? elements.detectionsTable
                : elements.detectionsTable.querySelector("tbody");

            if (tbody) {
                tbody.replaceChildren();

                detections.forEach((item, index) => {
                    const row = document.createElement("tr");

                    const values = [
                        index + 1,
                        item.class_name || item.name || item.class || "Object",
                        (Number(item.confidence || 0) * 100).toFixed(1) + "%"
                    ];

                    values.forEach(value => {
                        const cell = document.createElement("td");
                        cell.textContent = value;
                        row.appendChild(cell);
                    });

                    tbody.appendChild(row);
                });
            }
        }

        if (elements.resultStage) {
            elements.resultStage.textContent =
                detections.length + " objects detected.";
        }

        if (data.image) {
            const image = document.createElement("img");

            image.src = data.image.startsWith("data:")
                ? data.image
                : `data:image/jpeg;base64,${data.image}`;

            image.alt = "YOLO detection result";

            if (elements.resultStage) {
                elements.resultStage.replaceChildren(image);
            }
        }

        if (elements.downloadBtn) {
            elements.downloadBtn.disabled = !data.image;
            elements.downloadBtn.dataset.image = data.image || "";
        }
    }

    // DOWNLOAD RESULT

    function downloadResult() {
        const image = elements.downloadBtn?.dataset.image;

        if (!image) {
            showMessage("No result image available to download.", "error");
            return;
        }

        const link = document.createElement("a");

        link.href = image.startsWith("data:")
            ? image
            : `data:image/jpeg;base64,${image}`;

        link.download = "pathiq-detection-result.jpg";
        link.click();
    }

    // HISTORY

    function addHistory(item) {
        history.unshift(item);
        history = history.slice(0, 10);

        if (elements.historyMetric) {
            elements.historyMetric.textContent = history.length;
        }

        renderHistory();
    }

    function renderHistory() {
        if (!elements.historyList) return;

        elements.historyList.replaceChildren();

        if (!history.length) {
            elements.historyList.textContent = "No analysis history yet.";
            return;
        }

        history.forEach(item => {
            const card = document.createElement("div");

            const title = document.createElement("strong");
            title.textContent = item.filename;

            const details = document.createElement("p");
            details.textContent =
                item.count + " objects detected · " + item.time;

            card.append(title, details);
            elements.historyList.appendChild(card);
        });
    }

    function clearHistory() {
        history = [];
        renderHistory();

        if (elements.historyMetric) {
            elements.historyMetric.textContent = "0";
        }
    }

    // EVENT CONNECTIONS

    function initialize() {
        elements.imageInput?.addEventListener("change", handleImage);

        elements.analyzeBtn?.addEventListener("click", analyzeImage);

        elements.removeImage?.addEventListener("click", removeImage);

        elements.confidence?.addEventListener("input", updateConfidence);

        elements.downloadBtn?.addEventListener("click", downloadResult);

        elements.clearHistory?.addEventListener("click", clearHistory);

        updateConfidence();
        checkBackend();
        renderHistory();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }

})();
