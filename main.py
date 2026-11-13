
import base64
import io
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from PIL import Image, UnidentifiedImageError
from ultralytics import YOLO

from database import (
    init_db,
    save_report,
    save_path,
    get_paths,
    delete_path
)


# --------------------------------------------------
# PATHIQ CONFIGURATION
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "models" / "best.pt"

MAX_UPLOAD_SIZE = 10 * 1024 * 1024

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp"
}

# --------------------------------------------------
# FASTAPI APPLICATION
# --------------------------------------------------

app = FastAPI(
    title="PathIQ FootPath Usability AI",
    description="AI-powered footpath detection and pathway mapping API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"]
)

# --------------------------------------------------
# DATABASE INITIALIZATION
# --------------------------------------------------

init_db()

# --------------------------------------------------
# YOLO MODEL LOADING
# --------------------------------------------------

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"YOLO model not found: {MODEL_PATH}"
    )

model = YOLO(str(MODEL_PATH))

print("PathIQ YOLO model loaded successfully!")


# --------------------------------------------------
# PATHWAY REQUEST MODEL
# --------------------------------------------------

class PathwayRequest(BaseModel):
    path_name: str
    condition: str
    coordinates: list[dict[str, float]]


# --------------------------------------------------
# HOME API
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "success": True,
        "message": "Welcome to PathIQ AI Backend"
    }


# --------------------------------------------------
# HEALTH CHECK API
# --------------------------------------------------

@app.get("/health")
def health():
    return {
        "success": True,
        "message": "PathIQ AI is running",
        "model": MODEL_PATH.name
    }


# --------------------------------------------------
# YOLO IMAGE PREDICTION API
# --------------------------------------------------

@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    confidence: float = Form(0.25)
):

    if not 0.05 <= confidence <= 0.95:
        raise HTTPException(
            status_code=400,
            detail="Confidence must be between 0.05 and 0.95."
        )

    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Upload a JPG, PNG or WEBP image."
        )

    contents = await file.read()

    if not contents:
        raise HTTPException(
            status_code=400,
            detail="Uploaded image is empty."
        )

    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Image size must be less than 10 MB."
        )

    try:
        image = Image.open(io.BytesIO(contents)).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(
            status_code=400,
            detail="Invalid image file."
        )

    try:
        results = model.predict(
            source=image,
            conf=confidence,
            verbose=False
        )

        result = results[0]

        detections = []

        if result.boxes is not None:
            for box in result.boxes:

                class_id = int(box.cls[0].item())
                score = float(box.conf[0].item())
                coordinates = [
                    round(float(value), 2)
                    for value in box.xyxy[0].tolist()
                ]

                class_name = result.names.get(
                    class_id,
                    str(class_id)
                )

                detections.append({
                    "class_id": class_id,
                    "class_name": class_name,
                    "confidence": round(score, 4),
                    "bbox": coordinates
                })

        # Generate annotated image
        annotated_array = result.plot()
        annotated_image = Image.fromarray(
            annotated_array[:, :, ::-1]
        )

        image_buffer = io.BytesIO()

        annotated_image.save(
            image_buffer,
            format="JPEG",
            quality=90
        )

        encoded_image = base64.b64encode(
            image_buffer.getvalue()
        ).decode("utf-8")

        # Basic usability summary
        usability_report = {
            "total_objects": len(detections),
            "status": (
                "Objects detected"
                if detections
                else "No objects detected"
            ),
            "detected_classes": list({
                item["class_name"]
                for item in detections
            })
        }

        # Save prediction report in database
        save_report(
            file.filename or "uploaded_image",
            detections,
            usability_report
        )

        return {
            "success": True,
            "filename": file.filename,
            "detections": detections,
            "detections_count": len(detections),
            "annotated_image": encoded_image,
            "image_width": image.width,
            "image_height": image.height,
            "usability_report": usability_report
        }

    except HTTPException:
        raise

    except Exception as error:
        print("Prediction error:", str(error))

        raise HTTPException(
            status_code=500,
            detail="AI prediction failed. Check backend terminal."
        )


# --------------------------------------------------
# SAVE CAMPUS PATHWAY API
# --------------------------------------------------

@app.post("/paths")
def create_pathway(data: PathwayRequest):

    if not data.path_name.strip():
        raise HTTPException(
            status_code=400,
            detail="Pathway name is required."
        )

    if len(data.coordinates) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least two mapping points are required."
        )

    for point in data.coordinates:

        if "lat" not in point or "lng" not in point:
            raise HTTPException(
                status_code=400,
                detail="Each point must contain lat and lng."
            )

        lat = point["lat"]
        lng = point["lng"]

        if not -90 <= lat <= 90:
            raise HTTPException(
                status_code=400,
                detail="Invalid latitude."
            )

        if not -180 <= lng <= 180:
            raise HTTPException(
                status_code=400,
                detail="Invalid longitude."
            )

    allowed_conditions = [
        "Good",
        "Needs Attention",
        "Blocked",
        "Not Accessible"
    ]

    if data.condition not in allowed_conditions:
        raise HTTPException(
            status_code=400,
            detail="Invalid pathway condition."
        )

    path_id = save_path(
        data.path_name.strip(),
        data.condition,
        data.coordinates
    )

    return {
        "success": True,
        "message": "Pathway saved successfully!",
        "path_id": path_id
    }


# --------------------------------------------------
# GET ALL SAVED PATHWAYS API
# --------------------------------------------------

@app.get("/paths")
def list_pathways():

    paths = get_paths()

    return {
        "success": True,
        "total": len(paths),
        "paths": paths
    }


# --------------------------------------------------
# DELETE SAVED PATHWAY API
# --------------------------------------------------

@app.delete("/paths/{path_id}")
def remove_pathway(path_id: int):

    deleted = delete_path(path_id)

    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Pathway not found."
        )

    return {
        "success": True,
        "message": "Pathway deleted successfully."
    }


# --------------------------------------------------
# STARTUP MESSAGE
# --------------------------------------------------

@app.on_event("startup")
def startup_message():
    print("PathIQ API started successfully!")
    print("Database:", BASE_DIR / "pathiq.db")
    print("YOLO Model:", MODEL_PATH)
