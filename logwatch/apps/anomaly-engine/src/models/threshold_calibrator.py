from dataclasses import dataclass


@dataclass
class ThresholdAdjustment:
    metric_name: str
    current_threshold: float
    recommended_threshold: float
    adjustment_reason: str
    confidence: float  # 0.0-1.0


class ThresholdCalibrator:
    """Adaptive threshold calibrator that adjusts z-score thresholds based on
    baseline statistics, false positive/negative rates, and signal stability."""

    DEFAULT_THRESHOLD = 3.0

    def __init__(self, min_data_points: int = 168):
        """Initialize calibrator.

        Args:
            min_data_points: Minimum number of data points required (default 168 = 1 week of hourly data).
        """
        self.min_data_points = min_data_points

    def calibrate(
        self,
        baselines: list[dict],
        false_positive_rate: float = 0.0,
        false_negative_rate: float = 0.0,
    ) -> list[ThresholdAdjustment]:
        """Calibrate thresholds for a list of baseline metrics.

        Each baseline dict should have:
            metric_name, baseline_mean, baseline_stddev, sample_count,
            hourly_pattern, dow_pattern

        Args:
            baselines: List of baseline metric dicts.
            false_positive_rate: Rate of false positive anomalies (0.0-1.0).
            false_negative_rate: Rate of false negative anomalies (0.0-1.0).

        Returns:
            List of ThresholdAdjustment recommendations.
        """
        adjustments: list[ThresholdAdjustment] = []

        for baseline in baselines:
            metric_name = baseline["metric_name"]
            mean = baseline["baseline_mean"]
            stddev = baseline["baseline_stddev"]
            sample_count = baseline.get("sample_count", 0)

            # Skip metrics with insufficient data
            if sample_count < self.min_data_points:
                adjustments.append(
                    ThresholdAdjustment(
                        metric_name=metric_name,
                        current_threshold=self.DEFAULT_THRESHOLD,
                        recommended_threshold=self.DEFAULT_THRESHOLD,
                        adjustment_reason=(
                            f"Insufficient data ({sample_count}/{self.min_data_points} points). "
                            f"Keeping default threshold until more data is collected."
                        ),
                        confidence=0.2,
                    )
                )
                continue

            threshold = self.DEFAULT_THRESHOLD
            reasons: list[str] = []
            confidence = 0.7  # Base confidence for sufficient data

            # Adjust based on false positive rate
            if false_positive_rate > 0.1:
                increase = min(false_positive_rate * 2.0, 1.0)
                threshold += increase
                reasons.append(
                    f"High false positive rate ({false_positive_rate:.1%}): "
                    f"increased threshold by {increase:.2f} to reduce noise."
                )
                confidence = min(confidence + 0.1, 1.0)

            # Adjust based on false negative rate
            if false_negative_rate > 0.1:
                decrease = min(false_negative_rate * 1.5, 0.8)
                threshold -= decrease
                reasons.append(
                    f"High false negative rate ({false_negative_rate:.1%}): "
                    f"decreased threshold by {decrease:.2f} to catch more anomalies."
                )
                confidence = min(confidence + 0.1, 1.0)

            # Adjust based on coefficient of variation (signal stability)
            if mean > 0:
                cv = stddev / mean
                if cv < 0.05:
                    threshold = min(threshold, 2.5)
                    reasons.append(
                        f"Very stable metric (CV={cv:.3f}): lowered threshold to 2.5 "
                        f"for tighter anomaly detection."
                    )
                    confidence = min(confidence + 0.15, 1.0)
                elif cv > 0.5:
                    threshold = max(threshold, 3.5)
                    reasons.append(
                        f"Volatile metric (CV={cv:.3f}): raised threshold to 3.5 "
                        f"to reduce false positives from natural variance."
                    )
                    confidence = max(confidence - 0.1, 0.3)

            # Clamp threshold to valid range
            threshold = max(2.0, min(5.0, threshold))

            # Build final reason
            if not reasons:
                reasons.append(
                    f"Metric is within normal parameters (mean={mean:.4f}, "
                    f"stddev={stddev:.4f}). No adjustment needed."
                )

            adjustments.append(
                ThresholdAdjustment(
                    metric_name=metric_name,
                    current_threshold=self.DEFAULT_THRESHOLD,
                    recommended_threshold=round(threshold, 2),
                    adjustment_reason=" ".join(reasons),
                    confidence=round(confidence, 2),
                )
            )

        return adjustments

    def compute_false_rates(
        self,
        baselines: list[dict],
        recent_anomalies: list[dict],
    ) -> tuple[float, float]:
        """Compute false positive and false negative rates from recent anomalies.

        Args:
            baselines: List of baseline dicts (unused but kept for context).
            recent_anomalies: List of anomaly dicts with user_feedback field.
                Each should have at minimum: { "user_feedback": str | None }

        Returns:
            Tuple of (false_positive_rate, false_negative_rate).
            false_negative_rate defaults to 0.0 as it cannot be easily measured.
        """
        if not recent_anomalies:
            return 0.0, 0.0

        total = len(recent_anomalies)
        false_positives = sum(
            1
            for a in recent_anomalies
            if a.get("user_feedback") == "false_positive"
            or a.get("status") == "false_positive"
        )

        false_positive_rate = false_positives / total if total > 0 else 0.0

        # False negatives cannot be directly measured from detected anomalies,
        # since by definition they were not detected. Default to 0.0.
        false_negative_rate = 0.0

        return false_positive_rate, false_negative_rate
