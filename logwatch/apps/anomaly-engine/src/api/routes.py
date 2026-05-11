import logging
import os
from enum import StrEnum

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from src.models.statistical import StatisticalDetector
from src.pipeline.scorer import AnomalyScorer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")

# ---------------------------------------------------------------------------
# Shared singletons (lightweight, no GPU/model loading)
# ---------------------------------------------------------------------------
_statistical_detector = StatisticalDetector()
_scorer = AnomalyScorer()

# Check whether LogBERT is importable (it may not be deployed yet)
_logbert_available = False
try:
    from src.models.logbert import LogBERTWrapper  # noqa: F401

    _logbert_available = True
except ImportError:
    LogBERTWrapper = None  # type: ignore[misc,assignment]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class Severity(StrEnum):
    TRACE = "TRACE"
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"
    FATAL = "FATAL"


class LogRecord(BaseModel):
    timestamp: str = Field(..., description="ISO-8601 timestamp")
    tenant_id: str
    service_name: str
    severity: Severity
    body: str
    trace_id: str | None = None
    span_id: str | None = None
    attributes: dict[str, str] = Field(default_factory=dict)


class AnomalyScore(BaseModel):
    log_index: int = Field(..., description="Zero-based index into the submitted batch")
    score: float = Field(..., ge=0.0, le=1.0, description="Anomaly probability [0, 1]")
    is_anomaly: bool
    model_id: str
    severity: str | None = Field(None, description="Severity classification: critical, warning, info")
    anomaly_type: str | None = Field(None, description="Type of anomaly detected")


class PredictRequest(BaseModel):
    records: list[LogRecord] = Field(..., min_length=1, max_length=10_000)


class PredictResponse(BaseModel):
    scores: list[AnomalyScore]
    model_id: str
    batch_size: int


class ModelInfo(BaseModel):
    model_id: str
    type: str
    description: str
    loaded: bool


class ModelsResponse(BaseModel):
    models: list[ModelInfo]


class BaselineRequest(BaseModel):
    tenant_id: str
    service_name: str
    lookback_hours: int = Field(168, ge=1, le=720, description="Hours of history to use (default 7 days)")


class BaselineResponse(BaseModel):
    tenant_id: str
    service_name: str
    metrics_computed: list[str]
    message: str


# ---------------------------------------------------------------------------
# Keyword lists for heuristic scoring (used when full models are not loaded)
# ---------------------------------------------------------------------------
_ERROR_KEYWORDS = frozenset({
    "error", "exception", "fail", "fatal", "panic", "critical",
    "traceback", "segfault", "oom", "timeout", "refused",
})


def _heuristic_score(record: LogRecord) -> float:
    """Simple keyword + severity heuristic for anomaly scoring when ML models are not loaded."""
    score = 0.0

    # Severity-based component
    if record.severity in (Severity.ERROR, Severity.FATAL):
        score += 0.5
    elif record.severity == Severity.WARN:
        score += 0.2

    # Keyword-based component
    body_lower = record.body.lower()
    keyword_hits = sum(1 for kw in _ERROR_KEYWORDS if kw in body_lower)
    score += min(0.5, keyword_hits * 0.15)

    return min(1.0, score)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.post("/predict", response_model=PredictResponse, tags=["inference"])
async def predict(body: PredictRequest, request: Request) -> PredictResponse:
    """Score a batch of log records for anomalies.

    Uses the StatisticalDetector for aggregate metrics (error rate, volume)
    and a keyword heuristic for individual log scoring.  When LogBERT is
    loaded in a future release, semantic scoring will be layered on top.
    """
    scores: list[AnomalyScore] = []

    # --- Aggregate statistical detection per service ---
    service_records: dict[str, list[tuple[int, LogRecord]]] = {}
    for i, rec in enumerate(body.records):
        service_records.setdefault(rec.service_name, []).append((i, rec))

    flagged_services: set[str] = set()

    for svc, indexed_records in service_records.items():
        total = len(indexed_records)
        error_count = sum(
            1 for _, r in indexed_records if r.severity in (Severity.ERROR, Severity.FATAL)
        )
        error_rate = error_count / total if total > 0 else 0.0

        # Use a rough default baseline (no DB lookup in sync predict path)
        err_result = _statistical_detector.detect_error_rate_anomaly(
            current_error_rate=error_rate,
            baseline_mean=0.02,
            baseline_stddev=0.01,
        )
        vol_result = _statistical_detector.detect_volume_spike(
            current_volume=total,
            baseline_mean=100.0,
            baseline_stddev=30.0,
        )

        if err_result.is_anomaly or vol_result.is_anomaly:
            flagged_services.add(svc)

    # --- Per-record scoring ---
    for i, rec in enumerate(body.records):
        record_score = _heuristic_score(rec)

        # Boost score if the service is statistically flagged
        if rec.service_name in flagged_services:
            record_score = min(1.0, record_score + 0.2)

        is_anomaly = record_score >= _scorer.warning_threshold
        severity = _scorer.classify_severity(record_score) if is_anomaly else None
        anomaly_type: str | None = None
        if is_anomaly:
            if rec.severity in (Severity.ERROR, Severity.FATAL):
                anomaly_type = "error_rate"
            else:
                anomaly_type = "novel_pattern"

        scores.append(
            AnomalyScore(
                log_index=i,
                score=round(record_score, 4),
                is_anomaly=is_anomaly,
                model_id="statistical+heuristic",
                severity=severity,
                anomaly_type=anomaly_type,
            )
        )

    return PredictResponse(
        scores=scores,
        model_id="statistical+heuristic",
        batch_size=len(body.records),
    )


@router.get("/models", response_model=ModelsResponse, tags=["inference"])
async def list_models() -> ModelsResponse:
    """Return metadata about available anomaly detection models."""
    models = [
        ModelInfo(
            model_id="statistical",
            type="statistical",
            description="Z-score and volume-spike statistical detector for error rate and log volume",
            loaded=True,
        ),
        ModelInfo(
            model_id="heuristic",
            type="rule-based",
            description="Keyword and severity heuristic scorer for individual log records",
            loaded=True,
        ),
        ModelInfo(
            model_id="logbert-base",
            type="transformer",
            description="LogBERT fine-tuned on system log corpora for semantic anomaly detection",
            loaded=_logbert_available,
        ),
    ]
    return ModelsResponse(models=models)


@router.post("/baselines/compute", response_model=BaselineResponse, tags=["baselines"])
async def compute_baselines(body: BaselineRequest) -> BaselineResponse:
    """Trigger baseline computation for a tenant/service pair.

    Reads historical data from ClickHouse, computes statistical baselines,
    and persists them to PostgreSQL for use by the anomaly pipeline.
    """
    pg_dsn = os.environ.get("DATABASE_URL", "")
    ch_host = os.environ.get("CLICKHOUSE_HOST", "localhost")
    ch_port = int(os.environ.get("CLICKHOUSE_PORT", "8123"))

    if not pg_dsn:
        raise HTTPException(status_code=503, detail="DATABASE_URL not configured")

    from src.models.manager import BaselineManager

    manager = BaselineManager(pg_dsn, ch_host, ch_port)

    try:
        baselines = manager.compute_baselines(
            tenant_id=body.tenant_id,
            service_name=body.service_name,
            lookback_hours=body.lookback_hours,
        )
    except Exception as exc:
        logger.error("Baseline computation failed for %s/%s: %s", body.tenant_id, body.service_name, exc)
        raise HTTPException(status_code=500, detail=f"Baseline computation failed: {exc}") from exc

    # To save baselines we need the service_id; look it up from PG
    import psycopg2

    try:
        conn = psycopg2.connect(pg_dsn)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM services WHERE tenant_id = %s AND name = %s LIMIT 1",
                (body.tenant_id, body.service_name),
            )
            row = cur.fetchone()
        conn.close()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Service lookup failed: {exc}") from exc

    if not row:
        raise HTTPException(status_code=404, detail=f"Service '{body.service_name}' not found for tenant")

    service_id = str(row[0])
    manager.save_baselines(body.tenant_id, service_id, baselines)

    return BaselineResponse(
        tenant_id=body.tenant_id,
        service_name=body.service_name,
        metrics_computed=list(baselines.keys()),
        message=f"Baselines computed and saved for {body.service_name}",
    )
