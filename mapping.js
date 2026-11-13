"use strict";

// PathIQ FastAPI backend
const API_BASE = "http://127.0.0.1:8000";

const $ = (id) => document.getElementById(id);

let selectedFile = null;
let map = null;
let pendingLayers = null;
let savedLayers = null;
let drawControl = null;
let markerMode = false;
let lastAnalysis = null;

// -------------------- MESSAGES --------------------

function showMessage(element, message, type = "") {
    element.textContent = message;
    element.className = "message" + (type ? ` ${type}` : "");
}

function formatBytes(bytes) {
    if (!bytes) return "0 KB";
    return bytes < 1024 * 1024
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#039;"
    })[char]);
}

// -------------------- IMAGE UPLOAD --------------------

function setSelectedFile(file) {
    const message = $("detectionMessage");

    if (!file) return;

    const allowed = ["image/jpeg", "image/png", "image/webp"];

    if (!allowed.includes(file.type)) {
        showMessage(message, "Please select a JPG, PNG or WEBP image.", "error");
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        showMessage(message, "Image must be smaller than 10 MB.", "error");
        return;
    }

    selectedFile = file;

    const reader = new FileReader();
    reader.onload = () => {
        $("previewImage").src = reader.result;
        $("previewImage").classList.remove("hidden");
        $("uploadPlaceholder").classList.add("hidden");
    };
    reader.readAsDataURL(file);

    $("fileInfo").classList.remove("hidden");
    $("fileName").textContent = file.name;
    $("fileSize").textContent = formatBytes(file.size);
    $("analyzeBtn").disabled = false;

    showMessage(message, "Image ready. Click Analyse Image with AI.", "success");
}

function removeSelectedFile() {
    selectedFile = null;
    $("imageInput").value = "";
    $("previewImage").src = "";
    $("previewImage").classList.add("hidden");
    $("uploadPlaceholder").classList.remove("hidden");
    $("fileInfo").classList.add("hidden");
    $("analyzeBtn").disabled = true;
}

// -------------------- AI DETECTION --------------------

function getConfidence(detection) {
    let value = Number(
        detection.confidence ?? detection.conf ?? detection.score ?? 0
    );
    if (value > 1) value /= 100;
    return Math.max(0, Math.min(1, value));
}

function getClassName(detection) {
    return detection.class_name ??
        detection.class ??
        detection.name ??
        detection.label ??
        "Unknown";
}

function getDetections(data) {
    if (Array.isArray(data.detections)) return data.detections;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.predictions)) return data.predictions;
    return [];
}

function displayAnnotatedImage(data) {
    const image = $("resultImage");
    const placeholder = $("resultPlaceholder");

    let source = data.annotated_image ??
                 data.image ??
                 data.result_image ??
                 null;

    if (!source) {
        image.classList.add("hidden");
        placeholder.classList.remove("hidden");
        return;
    }

    if (typeof source === "string") {
        if (source.startsWith("data:image") || source.startsWith("http")) {
            image.src = source;
        } else {
            image.src = `data:image/jpeg;base64,${source}`;
        }
    } else {
        image.classList.add("hidden");
        placeholder.classList.remove("hidden");
        return;
    }

    image.classList.remove("hidden");
    placeholder.classList.add("hidden");
}

function displayDetections(detections) {
    const tbody = $("detectionsTable");
    $("tableCount").textContent = `${detections.length} objects`;

    if (!detections.length) {
        tbody.innerHTML = `
            <tr><td colspan="4" class="empty-cell">
                No objects detected at this confidence level.
            </td></tr>`;
        return;
    }

    tbody.innerHTML = detections.map((item, index) => {
        const name = escapeHTML(getClassName(item));
        const confidence = getConfidence(item);
        const percent = (confidence * 100).toFixed(1);

        return `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${name}</strong></td>
                <td>${percent}%</td>
                <td>
                    <span class="score-track">
                        <span style="width:${percent}%"></span>
                    </span>
                    ${percent}%
                </td>
            </tr>`;
    }).join("");
}

function displayReport(report) {
    const box = $("usabilityReport");

    if (report === undefined || report === null || report === "") {
        box.textContent = "Analysis completed. No separate usability report was returned by the API.";
        return;
    }

    if (typeof report === "string") {
        box.textContent = report;
        return;
    }

    if (Array.isArray(report)) {
        box.textContent = report.map(item =>
            typeof item === "object" ? JSON.stringify(item, null, 2) : String(item)
        ).join("\n");
        return;
    }

    box.textContent = Object.entries(report)
        .map(([key, value]) => {
            const label = key.replace(/_/g, " ");
            const readable = typeof value === "object"
                ? JSON.stringify(value)
                : String(value);
            return `${label}: ${readable}`;
        })
        .join("\n");
}

async function analyseImage() {
    if (!selectedFile) {
        showMessage($("detectionMessage"), "Please upload an image first.", "error");
        return;
    }

    const button = $("analyzeBtn");
    const buttonText = $("analyzeBtnText");

    button.disabled = true;
    buttonText.textContent = "Analysing image...";
    $("resultStatus").textContent = "Processing";
    $("resultStatus").classList.remove("ready");
    showMessage($("detectionMessage"), "Sending image to your YOLOv8 model...");

    try {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append(
            "confidence",
            (Number($("confidenceSlider").value) / 100).toString()
        );

        const response = await fetch(`${API_BASE}/predict`, {
            method: "POST",
            body: formData
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.detail || data.message || `API error: ${response.status}`);
        }

        if (data.success === false) {
            throw new Error(data.message || "The AI model could not analyse this image.");
        }

        lastAnalysis = data;

        const detections = getDetections(data);
        const average = detections.length
            ? detections.reduce((sum, item) => sum + getConfidence(item), 0) / detections.length
            : 0;

        $("detectionCount").textContent =
            data.detection_count ?? data.total_detections ?? detections.length;

        $("averageConfidence").textContent =
            detections.length ? `${(average * 100).toFixed(1)}%` : "0%";

        const width = data.width ?? data.image_width;
        const height = data.height ?? data.image_height;

        $("imageResolution").textContent =
            width && height ? `${width} × ${height}` : "Available in report";

        displayAnnotatedImage(data);
        displayDetections(detections);
        displayReport(data.usability_report ?? data.analysis ?? data.report);

        $("resultStatus").textContent = "Completed";
        $("resultStatus").classList.add("ready");
        showMessage($("detectionMessage"), "AI analysis completed successfully.", "success");

    } catch (error) {
        console.error("PathIQ detection error:", error);
        showMessage(
            $("detectionMessage"),
            `${error.message}. Check that your backend is running at ${API_BASE}.`,
            "error"
        );
        $("resultStatus").textContent = "Failed";
    } finally {
        button.disabled = false;
        buttonText.textContent = "Analyse Image with AI";
    }
}

// -------------------- SATELLITE MAP --------------------

function initialiseMap() {
    if (!window.L) {
        showMessage($("mapMessage"), "Leaflet map library did not load. Check your internet connection.", "error");
        return;
    }

    map = L.map("map").setView([18.5204, 73.8567], 15);

    // Esri World Imagery satellite tiles
    L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
            attribution: "Tiles &copy; Esri",
            maxZoom: 19
        }
    ).addTo(map);

    pendingLayers = new L.FeatureGroup();
    savedLayers = new L.FeatureGroup();

    map.addLayer(savedLayers);
    map.addLayer(pendingLayers);

    // Leaflet drawing controls are disabled; custom buttons activate drawing.
    map.on(L.Draw.Event.CREATED, (event) => {
        const layer = event.layer;

        if (event.layerType === "polygon") {
            layer.pathiqType = "AREA";
            layer.setStyle({
                color: "#1769e0",
                fillColor: "#1769e0",
                fillOpacity: 0.22,
                weight: 3
            });
        } else if (event.layerType === "polyline") {
            layer.pathiqType = "PATH";
            layer.setStyle({ color: "#f0a12c", weight: 5 });
        }

        layer.pathiqName = $("pathName").value.trim();
        layer.pathiqCondition = $("pathCondition").value;
        pendingLayers.addLayer(layer);
        updatePendingCount();
        showMessage($("mapMessage"), "Drawing added. Click Save Mapping to store it.", "success");
    });

    map.on("click", (event) => {
        if (!markerMode) return;

        const markerType = $("markerType").value;
        const marker = L.marker(event.latlng).bindPopup(
            `<strong>${escapeHTML(markerType)}</strong><br>Unsaved marker`
        );

        marker.pathiqType = "MARKER";
        marker.pathiqMarkerType = markerType;
        marker.pathiqName = $("pathName").value.trim() || markerType;
        marker.pathiqCondition = $("pathCondition").value;

        pendingLayers.addLayer(marker);
        markerMode = false;
        $("markerModeBtn").classList.remove("active");
        $("markerModeBtn").textContent = "＋ Add map marker";
        map.getContainer().style.cursor = "";
        updatePendingCount();

        showMessage($("mapMessage"), `${markerType} marker added. Save it to the database.`, "success");
    });

    map.on("draw:drawstop", () => {
        $("drawAreaBtn").classList.remove("active");
        $("drawPathBtn").classList.remove("active");
    });

    const areaSelect = $("areaSelect");
    areaSelect.addEventListener("change", () => {
        const [lat, lng] = areaSelect.value.split(",").map(Number);
        map.setView([lat, lng], 15);
    });

    loadSavedMappings();
    setTimeout(() => map.invalidateSize(), 250);
}

function startAreaDrawing() {
    const name = $("pathName").value.trim();

    if (!name) {
        showMessage($("mapMessage"), "Please enter an area/path name first.", "error");
        $("pathName").focus();
        return;
    }

    markerMode = false;
    map.getContainer().style.cursor = "";

    new L.Draw.Polygon(map, {
        allowIntersection: false,
        showArea: true,
        shapeOptions: {
            color: "#1769e0",
            fillColor: "#1769e0",
            fillOpacity: 0.22,
            weight: 3
        }
    }).enable();

    $("drawAreaBtn").classList.add("active");
    $("drawPathBtn").classList.remove("active");
    showMessage($("mapMessage"), "Click around the area on the satellite map. Double-click to finish.");
}

function startPathDrawing() {
    const name = $("pathName").value.trim();

    if (!name) {
        showMessage($("mapMessage"), "Please enter a path name first.", "error");
        $("pathName").focus();
        return;
    }

    markerMode = false;
    map.getContainer().style.cursor = "";

    new L.Draw.Polyline(map, {
        shapeOptions: { color: "#f0a12c", weight: 5 }
    }).enable();

    $("drawPathBtn").classList.add("active");
    $("drawAreaBtn").classList.remove("active");
    showMessage($("mapMessage"), "Click along the footpath route. Double-click to finish.");
}

function activateMarkerMode() {
    markerMode = !markerMode;

    if (markerMode) {
        $("markerModeBtn").classList.add("active");
        $("markerModeBtn").textContent = "Click map to place marker";
        map.getContainer().style.cursor = "crosshair";
        showMessage($("mapMessage"), "Now click on the satellite map to place your marker.");
    } else {
        $("markerModeBtn").classList.remove("active");
        $("markerModeBtn").textContent = "＋ Add map marker";
        map.getContainer().style.cursor = "";
        showMessage($("mapMessage"), "Marker mode cancelled.");
    }
}

function updatePendingCount() {
    const count = pendingLayers ? pendingLayers.getLayers().length : 0;
    $("pendingCount").textContent = `${count} item${count === 1 ? "" : "s"} drawn`;
}

// -------------------- SAVE MAPPING --------------------

function getLayerCoordinates(layer) {
    if (layer instanceof L.Marker) {
        const point = layer.getLatLng();
        // Existing backend requires at least two coordinates.
        return [
            { lat: point.lat, lng: point.lng },
            { lat: point.lat, lng: point.lng }
        ];
    }

    if (layer instanceof L.Polygon) {
        return layer.getLatLngs()[0].map(point => ({
            lat: point.lat,
            lng: point.lng
        }));
    }

    if (layer instanceof L.Polyline) {
        return layer.getLatLngs().map(point => ({
            lat: point.lat,
            lng: point.lng
        }));
    }

    return [];
}

function getMappingName(layer) {
    const name = layer.pathiqName || $("pathName").value.trim() || "Footpath mapping";

    if (layer.pathiqType === "AREA") return `AREA::${name}`;
    if (layer.pathiqType === "PATH") return `PATH::${name}`;
    if (layer.pathiqType === "MARKER") {
        return `MARKER::${layer.pathiqMarkerType || "Marker"}::${name}`;
    }

    return name;
}

async function saveMappings() {
    const layers = pendingLayers.getLayers();

    if (!layers.length) {
        showMessage($("mapMessage"), "Draw an area, path or marker before saving.", "error");
        return;
    }

    const button = $("saveMappingBtn");
    button.disabled = true;
    button.textContent = "Saving...";

    try {
        for (const layer of layers) {
            const coordinates = getLayerCoordinates(layer);

            if (coordinates.length < 2) {
                throw new Error("A mapping must contain at least two points.");
            }

            const payload = {
                path_name: getMappingName(layer),
                condition: layer.pathiqCondition || $("pathCondition").value,
                coordinates
            };

            const response = await fetch(`${API_BASE}/paths`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok || data.success === false) {
                throw new Error(data.detail || data.message || "Could not save mapping.");
            }
        }

        pendingLayers.clearLayers();
        updatePendingCount();
        showMessage($("mapMessage"), "Mapping saved successfully to PathIQ database.", "success");
        await loadSavedMappings();

    } catch (error) {
        console.error("Save mapping error:", error);
        showMessage($("mapMessage"), error.message, "error");
    } finally {
        button.disabled = false;
        button.textContent = "Save Mapping";
    }
}

function clearPendingDrawings() {
    pendingLayers.clearLayers();
    markerMode = false;
    $("markerModeBtn").classList.remove("active");
    $("markerModeBtn").textContent = "＋ Add map marker";
    $("drawAreaBtn").classList.remove("active");
    $("drawPathBtn").classList.remove("active");
    map.getContainer().style.cursor = "";
    updatePendingCount();
    showMessage($("mapMessage"), "Unsaved drawings cleared.");
}

// -------------------- LOAD SAVED MAPPINGS --------------------

function parseCoordinates(record) {
    let coordinates = record.coordinates ?? record.coords ?? [];

    if (typeof coordinates === "string") {
        try {
            coordinates = JSON.parse(coordinates);
        } catch {
            return [];
        }
    }

    if (!Array.isArray(coordinates)) return [];

    return coordinates.map(point => ({
        lat: Number(point.lat ?? point.latitude),
        lng: Number(point.lng ?? point.lon ?? point.longitude)
    })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function recordId(record) {
    return record.id ?? record.path_id ?? record._id ?? null;
}

function recordName(record) {
    return String(record.path_name ?? record.name ?? "Footpath mapping");
}

function recordCondition(record) {
    return record.condition ?? "Needs Attention";
}

function getConditionClass(condition) {
    if (condition === "Good") return "condition-good";
    if (condition === "Needs Attention") return "condition-attention";
    return "condition-blocked";
}

function addSavedLayer(record) {
    const coords = parseCoordinates(record);
    if (coords.length < 2) return;

    const fullName = recordName(record);
    let layer;
    let displayName = fullName;

    if (fullName.startsWith("AREA::")) {
        displayName = fullName.slice(6);
        layer = L.polygon(coords, {
            color: "#1769e0", fillColor: "#1769e0",
            fillOpacity: 0.2, weight: 3
        });
    } else if (fullName.startsWith("PATH::")) {
        displayName = fullName.slice(6);
        layer = L.polyline(coords, { color: "#f0a12c", weight: 5 });
    } else if (fullName.startsWith("MARKER::")) {
        const parts = fullName.split("::");
        const markerType = parts[1] || "Marker";
        displayName = parts.slice(2).join("::") || markerType;
        layer = L.marker(coords[0]).bindPopup(
            `<strong>${escapeHTML(markerType)}</strong><br>${escapeHTML(displayName)}`
        );
    } else {
        layer = L.polyline(coords, { color: "#1769e0", weight: 4 });
    }

    layer.bindPopup(
        `<strong>${escapeHTML(displayName)}</strong><br>` +
        `Condition: ${escapeHTML(recordCondition(record))}`
    );
    layer.addTo(savedLayers);
}

function renderSavedList(records) {
    const container = $("savedPathsList");

    if (!records.length) {
        container.innerHTML = `<div class="empty-state">No saved mappings yet. Draw an area or path and save it.</div>`;
        return;
    }

    container.innerHTML = records.map((record, index) => {
        const name = recordName(record);
        let displayName = name;

        if (name.startsWith("AREA::")) displayName = name.slice(6);
        if (name.startsWith("PATH::")) displayName = name.slice(6);
        if (name.startsWith("MARKER::")) displayName = name.split("::").slice(1).join(" — ");

        const condition = recordCondition(record);
        const id = recordId(record);
        const coords = parseCoordinates(record);

        return `
            <div class="saved-item">
                <div class="saved-item-info">
                    <strong>${escapeHTML(displayName)}</strong>
                    <small>${escapeHTML(name.split("::")[0] === name ? "Mapping" : name.split("::")[0])}
                    · ${coords.length} coordinate points</small>
                    <div><span class="condition-tag ${getConditionClass(condition)}">${escapeHTML(condition)}</span></div>
                </div>
                <div class="saved-actions">
                    <button class="small-action" type="button"
                        data-action="view" data-index="${index}">View on map</button>
                    <button class="small-action delete" type="button"
                        data-action="delete" data-id="${escapeHTML(id ?? "")}"
                        ${id == null ? "disabled title='No record ID returned by API'" : ""}>Delete</button>
                </div>
            </div>`;
    }).join("");

    container.querySelectorAll("[data-action='view']").forEach(button => {
        button.addEventListener("click", () => {
            const record = records[Number(button.dataset.index)];
            const coords = parseCoordinates(record);
            if (coords.length) {
                map.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 18 });
            }
        });
    });

    container.querySelectorAll("[data-action='delete']").forEach(button => {
        button.addEventListener("click", () => deleteMapping(button.dataset.id));
    });
}

async function loadSavedMappings() {
    try {
        const response = await fetch(`${API_BASE}/paths`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || "Could not load saved mappings.");
        }

        const records = Array.isArray(data) ? data : (data.paths ?? data.records ?? []);

        savedLayers.clearLayers();
        records.forEach(addSavedLayer);
        renderSavedList(records);

        $("totalPaths").textContent = records.length;
        $("goodPaths").textContent = records.filter(r => recordCondition(r) === "Good").length;
        $("attentionPaths").textContent = records.filter(r => recordCondition(r) === "Needs Attention").length;
        $("blockedPaths").textContent = records.filter(r =>
            ["Blocked", "Not Accessible"].includes(recordCondition(r))
        ).length;

    } catch (error) {
        console.error("Load mappings error:", error);
        $("savedPathsList").innerHTML =
            `<div class="empty-state">Could not load mappings. Check that the backend is running.</div>`;
    }
}

async function deleteMapping(id) {
    if (!id) return;

    if (!confirm("Are you sure you want to delete this mapping?")) return;

    try {
        const response = await fetch(`${API_BASE}/paths/${encodeURIComponent(id)}`, {
            method: "DELETE"
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || data.success === false) {
            throw new Error(data.detail || data.message || "Could not delete mapping.");
        }

        await loadSavedMappings();
    } catch (error) {
        alert(`Delete failed: ${error.message}`);
    }
}

// -------------------- LOCATION --------------------

function useMyLocation() {
    if (!navigator.geolocation) {
        showMessage($("mapMessage"), "Geolocation is not supported by this browser.", "error");
        return;
    }

    showMessage($("mapMessage"), "Getting your current location...");

    navigator.geolocation.getCurrentPosition(
        position => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            map.setView([lat, lng], 18);

            L.marker([lat, lng])
                .addTo(map)
                .bindPopup("Your current location")
                .openPopup();

            showMessage($("mapMessage"), "Map moved to your current location.", "success");
        },
        error => {
            showMessage($("mapMessage"), `Location unavailable: ${error.message}`, "error");
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// -------------------- START WEBSITE --------------------

document.addEventListener("DOMContentLoaded", () => {
    $("imageInput").addEventListener("change", event => {
        setSelectedFile(event.target.files[0]);
    });

    $("removeImageBtn").addEventListener("click", removeSelectedFile);
    $("analyzeBtn").addEventListener("click", analyseImage);

    $("confidenceSlider").addEventListener("input", event => {
        $("confidenceValue").textContent = `${event.target.value}%`;
    });

    const uploadZone = $("uploadZone");

    uploadZone.addEventListener("dragover", event => {
        event.preventDefault();
        uploadZone.classList.add("dragover");
    });

    uploadZone.addEventListener("dragleave", () => {
        uploadZone.classList.remove("dragover");
    });

    uploadZone.addEventListener("drop", event => {
        event.preventDefault();
        uploadZone.classList.remove("dragover");
        setSelectedFile(event.dataTransfer.files[0]);
    });

    initialiseMap();

    $("drawAreaBtn").addEventListener("click", startAreaDrawing);
    $("drawPathBtn").addEventListener("click", startPathDrawing);
    $("markerModeBtn").addEventListener("click", activateMarkerMode);
    $("saveMappingBtn").addEventListener("click", saveMappings);
    $("clearDrawingBtn").addEventListener("click", clearPendingDrawings);
    $("gpsBtn").addEventListener("click", useMyLocation);
    $("refreshSavedBtn").addEventListener("click", loadSavedMappings);
});