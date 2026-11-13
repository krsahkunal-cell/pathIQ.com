
import sqlite3
import json
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "pathiq.db"


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                detections TEXT NOT NULL,
                detections_count INTEGER NOT NULL,
                usability_report TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS paths (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path_name TEXT NOT NULL,
                condition TEXT NOT NULL,
                coordinates TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)


def save_report(filename, detections, usability_report):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            INSERT INTO reports
            (filename, detections, detections_count, usability_report)
            VALUES (?, ?, ?, ?)
        """, (
            filename or "unknown",
            json.dumps(detections),
            len(detections),
            json.dumps(usability_report)
        ))


def save_path(path_name, condition, coordinates):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute("""
            INSERT INTO paths (path_name, condition, coordinates)
            VALUES (?, ?, ?)
        """, (
            path_name,
            condition,
            json.dumps(coordinates)
        ))
        return cursor.lastrowid


def get_paths():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row

        rows = conn.execute("""
            SELECT * FROM paths ORDER BY id DESC
        """).fetchall()

        paths = []

        for row in rows:
            item = dict(row)
            item["coordinates"] = json.loads(item["coordinates"])
            paths.append(item)

        return paths


def delete_path(path_id):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "DELETE FROM paths WHERE id = ?",
            (path_id,)
        )
        return cursor.rowcount > 0


if __name__ == "__main__":
    init_db()
    print("PathIQ database initialized successfully!")
    print("Database location:", DB_PATH)
