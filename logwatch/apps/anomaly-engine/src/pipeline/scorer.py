import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ScoredAnomaly:
    score: float
    severity: str  # "critical", "warning", "info"
    anomaly_type: str
    title: str
    description: str
    model_used: str


class AnomalyScorer:
    def __init__(
        self,
        critical_threshold: float = 0.8,
        warning_threshold: float = 0.5,
    ):
        self.critical_threshold = critical_threshold
        self.warning_threshold = warning_threshold

    def classify_severity(self, score: float) -> str:
        if score >= self.critical_threshold:
            return "critical"
        if score >= self.warning_threshold:
            return "warning"
        return "info"

    def generate_title(self, anomaly_type: str, service_name: str) -> str:
        titles = {
            "volume_spike": f"Log volume spike detected in {service_name}",
            "error_rate": f"Elevated error rate in {service_name}",
            "novel_pattern": f"Unusual log pattern detected in {service_name}",
            "latency": f"Latency anomaly in {service_name}",
        }
        return titles.get(anomaly_type, f"Anomaly detected in {service_name}")

    def generate_description(self, anomaly_type: str, detail: str, score: float) -> str:
        return f"Anomaly type: {anomaly_type}, score: {score:.3f}. {detail}"

    def score(self, detection_result, service_name: str) -> ScoredAnomaly:
        """Convert a DetectionResult into a ScoredAnomaly with severity classification."""
        severity = self.classify_severity(detection_result.score)
        title = self.generate_title(detection_result.anomaly_type, service_name)
        description = self.generate_description(
            detection_result.anomaly_type, detection_result.detail, detection_result.score
        )
        return ScoredAnomaly(
            score=detection_result.score,
            severity=severity,
            anomaly_type=detection_result.anomaly_type,
            title=title,
            description=description,
            model_used=detection_result.model_used,
        )
