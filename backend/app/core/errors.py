"""Uniform JSON error envelope (contract §1).

Every JSON error carries a human readable string ``detail`` and a machine readable
``code``::

    {"detail": "Session not found.", "code": "http_404"}
    {"detail": "body.email: Field required", "code": "validation_error", "errors": [...]}
    {"detail": "Internal server error.", "code": "internal_error", "request_id": "..."}

``HTTPException(detail={"code": ..., "message": ...})`` is rendered as
``{"detail": message, "code": code}`` (any other keys of the dict are preserved).
"""
from __future__ import annotations

import logging
from typing import Any, Iterable

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


logger = logging.getLogger("app.errors")

INTERNAL_ERROR_MESSAGE = "Internal server error."
VALIDATION_SUMMARY_LIMIT = 3


def api_error(status_code: int, code: str, message: str, headers: dict[str, str] | None = None) -> HTTPException:
    """Build an HTTPException whose envelope carries an explicit ``code``."""
    return HTTPException(status_code=status_code, detail={"code": code, "message": message}, headers=headers)


def _request_id(request: Request) -> str | None:
    return getattr(getattr(request, "state", None), "request_id", None)


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        parts = [_stringify(item) for item in value]
        return "; ".join(part for part in parts if part)
    if isinstance(value, dict):
        for key in ("message", "msg", "detail"):
            if isinstance(value.get(key), str):
                return value[key]
    return str(value)


def build_error_payload(
    status_code: int,
    detail: Any,
    *,
    request_id: str | None = None,
    default_code: str | None = None,
) -> dict[str, Any]:
    code = default_code or f"http_{status_code}"
    payload: dict[str, Any] = {}
    if isinstance(detail, dict):
        extra = {key: value for key, value in detail.items() if key not in {"code", "message", "detail"}}
        code = str(detail.get("code") or code)
        message = detail.get("message")
        if message is None:
            message = detail.get("detail")
        payload.update(extra)
        payload["detail"] = _stringify(message) or _default_message(status_code)
    else:
        payload["detail"] = _stringify(detail) or _default_message(status_code)
    payload["code"] = code
    if request_id and "request_id" not in payload:
        payload["request_id"] = request_id
    return payload


def _default_message(status_code: int) -> str:
    try:
        from http import HTTPStatus

        return HTTPStatus(status_code).phrase
    except ValueError:
        return "Error"


def _format_loc(loc: Iterable[Any]) -> str:
    return ".".join(str(part) for part in loc)


def summarize_validation_errors(errors: list[dict[str, Any]]) -> str:
    parts = []
    for error in errors[:VALIDATION_SUMMARY_LIMIT]:
        loc = _format_loc(error.get("loc") or ())
        msg = str(error.get("msg") or "Invalid value")
        parts.append(f"{loc}: {msg}" if loc else msg)
    if len(errors) > VALIDATION_SUMMARY_LIMIT:
        parts.append(f"(+{len(errors) - VALIDATION_SUMMARY_LIMIT} more)")
    return "; ".join(parts) or "Invalid request."


def internal_error_response(request: Request) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "detail": INTERNAL_ERROR_MESSAGE,
            "code": "internal_error",
            "request_id": _request_id(request),
        },
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    payload = build_error_payload(exc.status_code, exc.detail, request_id=_request_id(request))
    return JSONResponse(status_code=exc.status_code, content=payload, headers=getattr(exc, "headers", None))


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    raw_errors = list(exc.errors())
    errors = [
        {
            "loc": list(error.get("loc") or ()),
            "msg": str(error.get("msg") or ""),
            "type": str(error.get("type") or ""),
        }
        for error in raw_errors
    ]
    payload = {
        "detail": summarize_validation_errors(errors),
        "code": "validation_error",
        "errors": errors,
    }
    request_id = _request_id(request)
    if request_id:
        payload["request_id"] = request_id
    return JSONResponse(status_code=422, content=payload)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "Unhandled application error",
        exc_info=(type(exc), exc, exc.__traceback__),
        extra={"event": "unhandled_exception", "request_id": _request_id(request), "path": request.url.path},
    )
    return internal_error_response(request)


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
