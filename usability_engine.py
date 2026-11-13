
import requests
from datetime import datetime

FRONTEND_URL = "http://127.0.0.1:5500"
BACKEND_URL = "http://127.0.0.1:8000"

def run_usability_tests():
    tests = []

    checks = [
        ("Frontend", FRONTEND_URL),
        ("Backend API", f"{BACKEND_URL}/docs"),
        ("Frontend CSS", f"{FRONTEND_URL}/style.css"),
        ("Frontend JavaScript", f"{FRONTEND_URL}/app.js"),
    ]

    for name, url in checks:
        try:
            response = requests.get(url, timeout=5)
            passed = response.status_code == 200

            tests.append({
                "test": name,
                "status": "PASS" if passed else "FAIL",
                "http_code": response.status_code,
                "url": url,
            })
        except requests.RequestException as error:
            tests.append({
                "test": name,
                "status": "FAIL",
                "error": str(error),
                "url": url,
            })

    total = len(tests)
    passed = sum(t["status"] == "PASS" for t in tests)

    return {
        "project": "PathIQ",
        "tested_at": datetime.now().isoformat(
            timespec="seconds"
        ),
        "score": round(passed / total * 100),
        "passed": passed,
        "failed": total - passed,
        "tests": tests,
    }


if __name__ == "__main__":
    import json

    report = run_usability_tests()
    print(json.dumps(report, indent=2))
