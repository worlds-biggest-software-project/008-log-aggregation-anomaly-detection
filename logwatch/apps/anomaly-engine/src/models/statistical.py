import numpy as np
from dataclasses import dataclass


@dataclass
class StatisticalResult:
    is_anomaly: bool
    score: float  # 0.0-1.0
    anomaly_type: str  # "volume_spike", "error_rate"
    detail: str


class StatisticalDetector:
    def __init__(self, z_threshold: float = 3.0, volume_spike_factor: float = 3.0):
        self.z_threshold = z_threshold
        self.volume_spike_factor = volume_spike_factor

    def detect_error_rate_anomaly(
        self, current_error_rate: float, baseline_mean: float, baseline_stddev: float
    ) -> StatisticalResult:
        """Z-score based error rate anomaly detection."""
        if baseline_stddev == 0:
            baseline_stddev = 0.001
        z_score = (current_error_rate - baseline_mean) / baseline_stddev
        score = min(1.0, max(0.0, abs(z_score) / (self.z_threshold * 2)))
        is_anomaly = abs(z_score) > self.z_threshold
        return StatisticalResult(
            is_anomaly,
            score,
            "error_rate",
            f"z-score={z_score:.2f}, threshold={self.z_threshold}",
        )

    def detect_volume_spike(
        self, current_volume: int, baseline_mean: float, baseline_stddev: float
    ) -> StatisticalResult:
        """Volume spike detection using z-score and multiplicative factor."""
        if baseline_mean == 0:
            is_spike = current_volume > 100
            return StatisticalResult(
                is_spike,
                1.0 if is_spike else 0.0,
                "volume_spike",
                "no baseline, comparing to threshold=100",
            )

        ratio = current_volume / baseline_mean
        if baseline_stddev > 0:
            z_score = (current_volume - baseline_mean) / baseline_stddev
        else:
            z_score = 0.0

        is_spike = ratio > self.volume_spike_factor or abs(z_score) > self.z_threshold
        score = min(1.0, max(0.0, (ratio - 1.0) / (self.volume_spike_factor - 1.0)))
        return StatisticalResult(
            is_spike,
            score,
            "volume_spike",
            f"ratio={ratio:.2f}, z_score={z_score:.2f}",
        )

    def detect_batch(
        self,
        error_rates: list[tuple[str, float, float, float]],  # (service, current, mean, stddev)
        volumes: list[tuple[str, int, float, float]],  # (service, current, mean, stddev)
    ) -> list[tuple[str, StatisticalResult]]:
        """Run detection on batch of service metrics."""
        results = []
        for service, current, mean, stddev in error_rates:
            result = self.detect_error_rate_anomaly(current, mean, stddev)
            if result.is_anomaly:
                results.append((service, result))
        for service, current, mean, stddev in volumes:
            result = self.detect_volume_spike(current, mean, stddev)
            if result.is_anomaly:
                results.append((service, result))
        return results
