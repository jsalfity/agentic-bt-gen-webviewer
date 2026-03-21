#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from build_catalog import OUTPUT_PATH, build_catalog

APP_ROOT = Path(__file__).resolve().parent
PUBLIC_ROOT = APP_ROOT / "public"


def ensure_catalog() -> None:
    if OUTPUT_PATH.exists():
        return
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(build_catalog(), indent=2), encoding="utf-8")


def read_json_body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def normalize_robot_name(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def call_control(
    control_url: str,
    endpoint: str,
    payload: dict | None = None,
    expect_binary: bool = False,
    method: str = "POST",
):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(control_url.rstrip("/") + endpoint, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            blob = response.read()
            if expect_binary:
                return blob, response.headers.get_content_type() or "application/octet-stream"
            return json.loads(blob.decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(str(exc.reason)) from exc


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:
        return

    def _send_json(self, payload: dict, status: int = HTTPStatus.OK) -> None:
        blob = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(blob)))
        self.end_headers()
        self.wfile.write(blob)

    def _send_bytes(self, payload: bytes, content_type: str, status: int = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_static(self, rel_path: str) -> None:
        clean = rel_path.lstrip("/") or "index.html"
        target = (PUBLIC_ROOT / clean).resolve()
        if not str(target).startswith(str(PUBLIC_ROOT.resolve())) or not target.exists() or not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_type = "text/plain; charset=utf-8"
        if target.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        elif target.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif target.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif target.suffix == ".json":
            content_type = "application/json; charset=utf-8"
        elif target.suffix == ".png":
            content_type = "image/png"
        self._send_bytes(target.read_bytes(), content_type)

    def do_GET(self) -> None:
        ensure_catalog()
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/runtime/"):
            self._handle_runtime_get(parsed)
            return
        if parsed.path == "/":
            self._serve_static("index.html")
            return
        self._serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/runtime/"):
            self._handle_runtime_post(parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def _handle_runtime_get(self, parsed) -> None:
        query = parse_qs(parsed.query)
        control_url = (query.get("control_url") or ["http://127.0.0.1:8080"])[0]
        robot = normalize_robot_name((query.get("robot") or [None])[0])

        try:
            if parsed.path == "/api/runtime/health":
                payload = call_control(control_url, "/world_state", {"robot": robot})
                frame_ok = True
                frame_error = None
                try:
                    call_control(
                        control_url,
                        "/world_frame",
                        None,
                        expect_binary=True,
                        method="GET",
                    )
                except RuntimeError as exc:
                    frame_ok = False
                    frame_error = str(exc)
                self._send_json(
                    {
                        "ok": True,
                        "control_url": control_url,
                        "sim_app": payload,
                        "frame_ok": frame_ok,
                        "frame_error": frame_error,
                    }
                )
                return
            if parsed.path == "/api/runtime/status":
                run_id = (query.get("run_id") or [""])[0]
                if not run_id:
                    self._send_json({"error": "Missing run_id"}, status=HTTPStatus.BAD_REQUEST)
                    return
                payload = call_control(control_url, "/bt_status", {"run_id": run_id})
                self._send_json(payload)
                return
            if parsed.path == "/api/runtime/world-state":
                payload = call_control(control_url, "/world_state", {"robot": robot})
                self._send_json(payload)
                return
            if parsed.path == "/api/runtime/world-frame":
                payload, content_type = call_control(
                    control_url,
                    "/world_frame",
                    None,
                    expect_binary=True,
                    method="GET",
                )
                self._send_bytes(payload, content_type)
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except RuntimeError as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def _handle_runtime_post(self, parsed) -> None:
        payload = read_json_body(self)
        control_url = str(payload.get("control_url") or "http://127.0.0.1:8080")
        robot = normalize_robot_name(payload.get("robot"))

        try:
            if parsed.path == "/api/runtime/run":
                bt_json = payload.get("bt_json")
                if not isinstance(bt_json, dict):
                    self._send_json({"error": "Missing bt_json"}, status=HTTPStatus.BAD_REQUEST)
                    return
                result = call_control(
                    control_url,
                    "/run_bt",
                    {
                        "bt_json": bt_json,
                        "robot": robot,
                        "tick_ms": int(payload.get("tick_ms") or 100),
                        "realtime_factor": float(payload.get("realtime_factor") or 1.0),
                        "print_every": int(payload.get("print_every") or 0),
                    },
                )
                self._send_json(result)
                return
            if parsed.path == "/api/runtime/reset":
                result = call_control(
                    control_url,
                    "/reset_world",
                    {
                        "deterministic": bool(payload.get("deterministic") or False),
                        "seed": int(payload.get("seed") or -1),
                    },
                )
                self._send_json(result)
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except RuntimeError as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the BT project webpage and local runtime adapter")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8123, type=int)
    args = parser.parse_args()

    ensure_catalog()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Serving webviewer on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
