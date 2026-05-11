from enum import StrEnum

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1")


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


@router.post("/predict", response_model=PredictResponse, tags=["inference"])
async def predict(body: PredictRequest) -> PredictResponse:
    placeholder_scores = [
        AnomalyScore(
            log_index=i,
            score=0.0,
            is_anomaly=False,
            model_id="placeholder",
        )
        for i in range(len(body.records))
    ]
    return PredictResponse(
        scores=placeholder_scores,
        model_id="placeholder",
        batch_size=len(body.records),
    )


@router.get("/models", response_model=ModelsResponse, tags=["inference"])
async def list_models() -> ModelsResponse:
    return ModelsResponse(
        models=[
            ModelInfo(
                model_id="logbert-base",
                type="transformer",
                description="LogBERT fine-tuned on system log corpora for semantic anomaly detection",
                loaded=False,
            ),
            ModelInfo(
                model_id="isolation-forest",
                type="statistical",
                description="Isolation Forest baseline for rapid, lightweight anomaly scoring",
                loaded=False,
            ),
        ]
    )
