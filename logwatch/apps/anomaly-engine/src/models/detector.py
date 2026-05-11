import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta

from src.models.statistical import StatisticalDetector, StatisticalResult
from src.models.logbert import LogBERTWrapper
from src.models.manager import BaselineManager

logger = logging.getLogger(__name__)

LEARNING_PERIOD_DAYS = 7


@dataclass
class DetectionResult:
    is_anomaly: bool
    score: float
    anomaly_type: str
    model_used: str  # "statistical" or "logbert"
    detail: str


class AnomalyDetector:
    """Two-phase anomaly detector.

    Phase 1 (learning period, first 7 days): statistical detection only
    Phase 2 (after baseline): LogBERT for semantic anomalies + statistical for volume/rate
    """

    def __init__(
        self,
        baseline_manager: BaselineManager,
        statistical: StatisticalDetector | None = None,
        logbert: LogBERTWrapper | None = None,
    ):
        self.baseline_manager = baseline_manager
        self.statistical = statistical or StatisticalDetector()
        self.logbert = logbert or LogBERTWrapper()
        self._logbert_loaded = False

    def _ensure_logbert(self) -> bool:
        if self._logbert_loaded:
            return True
        try:
            self.logbert.load()
            self._logbert_loaded = True
            return True
        except Exception:
            logger.warning(
                "Failed to load LogBERT model, falling back to statistical only",
                exc_info=True,
            )
            return False

    def _has_baseline(self, baselines: dict) -> bool:
        if not baselines:
            return False
        for metric in baselines.values():
            if metric.get("sample_count", 0) >= 24:  # at least 24 data points
                return True
        return False

    def detect(
        self,
        tenant_id: str,
        service_id: str,
        log_messages: list[str],
        current_error_rate: float,
        current_volume: int,
        service_first_seen: datetime | None = None,
    ) -> list[DetectionResult]:
        """Run anomaly detection on a batch of logs with service metrics."""
        results: list[DetectionResult] = []

        baselines = self.baseline_manager.load_baselines(tenant_id, service_id)
        has_baseline = self._has_baseline(baselines)

        # Determine if we're past the learning period
        past_learning = False
        if service_first_seen:
            past_learning = (
                datetime.now(timezone.utc) - service_first_seen
                > timedelta(days=LEARNING_PERIOD_DAYS)
            )

        # Statistical detection (always runs if baselines exist)
        if has_baseline:
            vol_baseline = baselines.get("log_volume", {})
            err_baseline = baselines.get("error_rate", {})

            if vol_baseline:
                vol_result = self.statistical.detect_volume_spike(
                    current_volume, vol_baseline["mean"], vol_baseline["stddev"]
                )
                if vol_result.is_anomaly:
                    results.append(
                        DetectionResult(
                            True,
                            vol_result.score,
                            "volume_spike",
                            "statistical",
                            vol_result.detail,
                        )
                    )

            if err_baseline:
                err_result = self.statistical.detect_error_rate_anomaly(
                    current_error_rate, err_baseline["mean"], err_baseline["stddev"]
                )
                if err_result.is_anomaly:
                    results.append(
                        DetectionResult(
                            True,
                            err_result.score,
                            "error_rate",
                            "statistical",
                            err_result.detail,
                        )
                    )

        # LogBERT detection (only after learning period and if model loads)
        if past_learning and has_baseline and log_messages:
            if self._ensure_logbert():
                try:
                    predictions = self.logbert.predict_batch(log_messages)
                    for i, (score, is_anomaly) in enumerate(predictions):
                        if is_anomaly:
                            results.append(
                                DetectionResult(
                                    True,
                                    score,
                                    "novel_pattern",
                                    "logbert",
                                    f"log_index={i}, semantic anomaly score={score:.3f}",
                                )
                            )
                except Exception:
                    logger.error("LogBERT prediction failed", exc_info=True)

        return results
