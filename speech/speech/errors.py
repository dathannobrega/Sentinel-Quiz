"""Error envelope ``{code, message}`` shared with the main API (contract §5.1).

The API proxies these bodies to the browser almost verbatim, so the envelope is kept
minimal and stable: ``code`` is machine readable (``text_too_long``, ``busy``...),
``message`` is for humans/logs.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("speech.errors")


def api_error(status_code: int, code: str, message: str, headers: dict[str, str] | None = None) -> HTTPException:
    """Build an HTTPException whose body renders as ``{"code": code, "message": message}``."""
    return HTTPException(status_code=status_code, detail={"code": code, "message": message}, headers=headers)


def _payload(status_code: int, detail: Any) -> dict[str, Any]:
    if isinstance(detail, dict) and "code" in detail:
        return {"code": str(detail["code"]), "message": str(detail.get("message") or "")}
    return {"code": f"http_{status_code}", "message": str(detail) if detail else "Error"}


async def _http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=_payload(exc.status_code, exc.detail),
        headers=getattr(exc, "headers", None),
    )


async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = list(exc.errors())
    parts = []
    for err in errors[:3]:
        loc = ".".join(str(p) for p in (err.get("loc") or ()))
        parts.append(f"{loc}: {err.get('msg')}" if loc else str(err.get("msg")))
    return JSONResponse(status_code=422, content={"code": "validation_error", "message": "; ".join(parts) or "Invalid request."})


async def _unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled error on %s", request.url.path, exc_info=(type(exc), exc, exc.__traceback__))
    return JSONResponse(status_code=500, content={"code": "internal_error", "message": "Internal server error."})


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(Exception, _unhandled_handler)
