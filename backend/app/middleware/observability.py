from __future__ import annotations

import hashlib
import ipaddress
import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import Settings, settings
from app.core.errors import internal_error_response


logger = logging.getLogger("app.http")


def _valid_ip(value: str | None) -> str | None:
    candidate = str(value or "").strip()
    if not candidate:
        return None
    # Strip an optional port from IPv4 "a.b.c.d:port" and brackets from "[v6]:port".
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1:candidate.index("]")]
    elif candidate.count(":") == 1 and "." in candidate:
        candidate = candidate.split(":", 1)[0]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def resolve_client_ip(request: Request, *, trust_forwarded: bool | None = None) -> str:
    """Return the client IP used for rate limiting and logs.

    Forwarded headers are only honoured when TRUST_FORWARDED_FOR_HEADER is enabled
    (i.e. the API is only reachable through our reverse proxy). In that case the
    RIGHT-MOST X-Forwarded-For entry (the one appended/set by our proxy) or
    X-Real-IP is used - never the left-most entry, which the client controls.
    """
    should_trust_forwarded = settings.trust_forwarded_for_header if trust_forwarded is None else bool(trust_forwarded)
    if should_trust_forwarded:
        forwarded_entries = [
            item.strip()
            for item in str(request.headers.get("x-forwarded-for") or "").split(",")
            if item.strip()
        ]
        if forwarded_entries:
            rightmost = _valid_ip(forwarded_entries[-1])
            if rightmost:
                return rightmost
        real_ip = _valid_ip(request.headers.get("x-real-ip"))
        if real_ip:
            return real_ip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _hash_identity_fragment(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def resolve_supplemental_identity(request: Request) -> str | None:
    client_key = str(request.headers.get("x-client-key") or "").strip()
    if client_key:
        return f"client:{_hash_identity_fragment(client_key[:64])}"

    authorization = str(request.headers.get("authorization") or "").strip()
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token:
            return f"token:{_hash_identity_fragment(token)}"
    return None


def resolve_request_identity(request: Request) -> str:
    base_ip = resolve_client_ip(request)
    supplemental = resolve_supplemental_identity(request)
    if supplemental:
        return f"ip:{base_ip}|{supplemental}"
    return f"ip:{base_ip}"


def resolve_rate_limit_identity(request: Request) -> str:
    base_ip = resolve_client_ip(request)
    return f"ip:{base_ip}"


def _sanitize_request_id(value: str | None) -> str | None:
    if not value:
        return None
    candidate = str(value).strip()
    if not candidate:
        return None
    if len(candidate) > 128:
        return None
    normalized = "".join(ch for ch in candidate if ch.isalnum() or ch in {"-", "_", "."})
    return normalized[:128] or None


def resolve_request_id(request: Request, trust_incoming: bool) -> str:
    if trust_incoming:
        inbound = _sanitize_request_id(request.headers.get("x-request-id"))
        if inbound:
            return inbound
    return uuid.uuid4().hex


class ObservabilityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings):
        super().__init__(app)
        self._slow_request_threshold_ms = max(int(settings.slow_request_threshold_ms or 0), 1)
        self._trust_request_id_header = bool(settings.trust_request_id_header)

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = resolve_request_id(request, self._trust_request_id_header)
        request.state.request_id = request_id
        request.state.identity_hint = getattr(request.state, "identity_hint", None) or resolve_request_identity(request)

        started_at = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            logger.exception(
                "Unhandled request failure",
                extra=self._build_log_payload(request, 500, duration_ms, is_unhandled_error=True),
            )
            # Answer with the generic envelope here (inside CORS) instead of letting the
            # exception reach Starlette's outermost ServerErrorMiddleware, so that 5xx
            # responses still carry CORS headers and X-Request-ID - and no stack trace.
            response = internal_error_response(request)
            response.headers["X-Request-ID"] = request_id
            return response

        response.headers["X-Request-ID"] = request_id
        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
        self._log_completed_request(request, response, duration_ms)
        return response

    def _log_completed_request(self, request: Request, response: Response, duration_ms: float) -> None:
        status_code = int(getattr(response, "status_code", 500) or 500)
        level = self._resolve_log_level(request, status_code, duration_ms)

        logger.log(
            level,
            "HTTP request completed",
            extra=self._build_log_payload(request, status_code, duration_ms, response=response),
        )

    def _resolve_log_level(self, request: Request, status_code: int, duration_ms: float) -> int:
        if request.url.path == "/api/health" and status_code < 400:
            return logging.DEBUG
        if status_code >= 500:
            return logging.ERROR
        if status_code >= 400 or duration_ms >= self._slow_request_threshold_ms:
            return logging.WARNING
        return logging.INFO

    def _build_log_payload(
        self,
        request: Request,
        status_code: int,
        duration_ms: float,
        *,
        is_unhandled_error: bool = False,
        response: Response | None = None,
    ) -> dict[str, object]:
        request_bytes = 0
        try:
            header_value = request.headers.get("content-length")
            if header_value:
                request_bytes = max(int(header_value), 0)
        except (TypeError, ValueError):
            request_bytes = 0

        response_bytes = 0
        if response is not None:
            try:
                header_value = response.headers.get("content-length")
                if header_value:
                    response_bytes = max(int(header_value), 0)
            except (TypeError, ValueError):
                response_bytes = 0

        route = request.scope.get("route")
        route_path = getattr(route, "path", None)
        user_agent = str(request.headers.get("user-agent") or "").strip()[:200]

        payload: dict[str, object] = {
            "event": "http_request_unhandled_exception" if is_unhandled_error else "http_request",
            "request_id": getattr(request.state, "request_id", None),
            "method": request.method,
            "path": request.url.path,
            "route": route_path or request.url.path,
            "status_code": status_code,
            "duration_ms": duration_ms,
            "client_ip": resolve_client_ip(request),
            "identity": getattr(request.state, "identity_hint", None),
            "request_bytes": request_bytes,
            "response_bytes": response_bytes,
            "user_agent": user_agent or None,
            "rate_limit_bucket": getattr(request.state, "rate_limit_bucket", None),
            "abuse_signal": getattr(request.state, "abuse_signal", None),
            "unhandled_error": is_unhandled_error,
        }
        if request.url.query:
            payload["query_length"] = len(request.url.query)
        return payload
