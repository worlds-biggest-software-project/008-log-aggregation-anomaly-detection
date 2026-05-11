import numpy as np
from dataclasses import dataclass


@dataclass
class PatternAnalysis:
    hourly_pattern: dict[int, float]  # hour 0-23 -> relative weight
    dow_pattern: dict[int, float]  # day 0-6 (Mon-Sun) -> relative weight
    has_strong_hourly_pattern: bool
    has_strong_dow_pattern: bool
    peak_hours: list[int]
    quiet_hours: list[int]
    peak_days: list[int]


class PatternAnalyzer:
    """Analyzes hourly and day-of-week patterns from anomaly baselines."""

    def analyze(self, hourly_data: dict, dow_data: dict) -> PatternAnalysis:
        """Analyze baseline patterns and detect strong temporal signals.

        Args:
            hourly_data: dict from anomaly_baselines hourly_pattern JSONB (hour -> value)
            dow_data: dict from anomaly_baselines dow_pattern JSONB (day -> value)

        Returns:
            PatternAnalysis with normalized weights and identified peaks/quiet periods.
        """
        hourly_pattern = self._normalize(hourly_data)
        dow_pattern = self._normalize(dow_data)

        has_strong_hourly = self._has_strong_pattern(hourly_data)
        has_strong_dow = self._has_strong_pattern(dow_data)

        peak_hours = self._find_peaks(hourly_data, factor=1.5)
        quiet_hours = self._find_quiet(hourly_data, factor=0.5)
        peak_days = self._find_peaks(dow_data, factor=1.2)

        return PatternAnalysis(
            hourly_pattern=hourly_pattern,
            dow_pattern=dow_pattern,
            has_strong_hourly_pattern=has_strong_hourly,
            has_strong_dow_pattern=has_strong_dow,
            peak_hours=peak_hours,
            quiet_hours=quiet_hours,
            peak_days=peak_days,
        )

    def get_time_adjusted_threshold(
        self,
        base_threshold: float,
        hour: int,
        dow: int,
        analysis: PatternAnalysis,
    ) -> float:
        """Adjust threshold based on time-of-day and day-of-week patterns.

        During peak hours: increase threshold by up to 50% (reduce false positives).
        During quiet hours: decrease threshold by up to 30% (increase sensitivity).

        Args:
            base_threshold: The base z-score threshold.
            hour: Current hour (0-23).
            dow: Current day of week (0-6, Mon-Sun).
            analysis: PatternAnalysis from the analyze() method.

        Returns:
            Adjusted threshold.
        """
        adjustment = 1.0

        # Hourly adjustment
        if analysis.has_strong_hourly_pattern and hour in analysis.hourly_pattern:
            hourly_weight = analysis.hourly_pattern[hour]
            mean_weight = 1.0 / max(len(analysis.hourly_pattern), 1)

            if hourly_weight > 0 and mean_weight > 0:
                ratio = hourly_weight / mean_weight
                if ratio > 1.5:
                    # Peak hour: increase threshold by up to 50%
                    scale = min((ratio - 1.5) / 1.5, 1.0)
                    adjustment += 0.5 * scale
                elif ratio < 0.5:
                    # Quiet hour: decrease threshold by up to 30%
                    scale = min((0.5 - ratio) / 0.5, 1.0)
                    adjustment -= 0.3 * scale

        # Day-of-week adjustment (smaller effect, additive)
        if analysis.has_strong_dow_pattern and dow in analysis.dow_pattern:
            dow_weight = analysis.dow_pattern[dow]
            mean_weight = 1.0 / max(len(analysis.dow_pattern), 1)

            if dow_weight > 0 and mean_weight > 0:
                ratio = dow_weight / mean_weight
                if ratio > 1.2:
                    scale = min((ratio - 1.2) / 1.0, 1.0)
                    adjustment += 0.15 * scale
                elif ratio < 0.8:
                    scale = min((0.8 - ratio) / 0.8, 1.0)
                    adjustment -= 0.1 * scale

        return base_threshold * adjustment

    @staticmethod
    def _normalize(data: dict) -> dict[int, float]:
        """Normalize pattern values so they sum to 1.0."""
        if not data:
            return {}
        total = sum(float(v) for v in data.values())
        if total == 0:
            count = len(data)
            return {int(k): 1.0 / count for k in data}
        return {int(k): float(v) / total for k, v in data.items()}

    @staticmethod
    def _has_strong_pattern(data: dict) -> bool:
        """Detect strong pattern using coefficient of variation (CV > 0.3)."""
        if not data or len(data) < 2:
            return False
        values = np.array([float(v) for v in data.values()])
        mean = np.mean(values)
        if mean == 0:
            return False
        cv = float(np.std(values) / mean)
        return cv > 0.3

    @staticmethod
    def _find_peaks(data: dict, factor: float) -> list[int]:
        """Find keys whose values exceed factor * mean."""
        if not data:
            return []
        values = [float(v) for v in data.values()]
        mean = sum(values) / len(values) if values else 0
        if mean == 0:
            return []
        return sorted(int(k) for k, v in data.items() if float(v) > factor * mean)

    @staticmethod
    def _find_quiet(data: dict, factor: float) -> list[int]:
        """Find keys whose values are below factor * mean."""
        if not data:
            return []
        values = [float(v) for v in data.values()]
        mean = sum(values) / len(values) if values else 0
        if mean == 0:
            return []
        return sorted(int(k) for k, v in data.items() if float(v) < factor * mean)
