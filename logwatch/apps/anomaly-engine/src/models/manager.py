import json
import logging
from datetime import datetime, timezone

import numpy as np
import psycopg2
import clickhouse_connect

logger = logging.getLogger(__name__)


class BaselineManager:
    def __init__(self, pg_dsn: str, ch_host: str, ch_port: int = 8123):
        self.pg_dsn = pg_dsn
        self.ch_host = ch_host
        self.ch_port = ch_port

    def compute_baselines(
        self, tenant_id: str, service_name: str, lookback_hours: int = 168
    ) -> dict:
        """Compute baselines from ClickHouse log data for a service over lookback period (default 7 days)."""
        ch = clickhouse_connect.get_client(host=self.ch_host, port=self.ch_port)

        query = """
            SELECT
                toHour(timestamp) AS hour,
                toDayOfWeek(timestamp) AS dow,
                count() AS volume,
                countIf(severity_text IN ('ERROR', 'FATAL')) / count() AS error_rate
            FROM otel_logs
            WHERE tenant_id = %(tenant_id)s
              AND resource_string['service.name'] = %(service_name)s
              AND timestamp >= now() - INTERVAL %(lookback)s HOUR
            GROUP BY hour, dow
            ORDER BY hour, dow
        """
        result = ch.query(
            query,
            parameters={
                "tenant_id": tenant_id,
                "service_name": service_name,
                "lookback": lookback_hours,
            },
        )

        hourly_volumes: dict[str, list] = {}
        hourly_error_rates: dict[str, list] = {}
        dow_volumes: dict[str, list] = {}
        all_volumes: list = []
        all_error_rates: list = []

        for row in result.result_rows:
            hour, dow, volume, error_rate = row
            hourly_volumes.setdefault(str(hour), []).append(volume)
            hourly_error_rates.setdefault(str(hour), []).append(error_rate)
            dow_volumes.setdefault(str(dow), []).append(volume)
            all_volumes.append(volume)
            all_error_rates.append(error_rate)

        def compute_stats(values: list) -> dict:
            arr = np.array(values) if values else np.array([0.0])
            return {
                "mean": float(np.mean(arr)),
                "stddev": float(np.std(arr)),
                "p50": float(np.percentile(arr, 50)) if len(arr) > 0 else None,
                "p95": float(np.percentile(arr, 95)) if len(arr) > 0 else None,
                "p99": float(np.percentile(arr, 99)) if len(arr) > 0 else None,
                "sample_count": len(values),
            }

        return {
            "log_volume": {
                **compute_stats(all_volumes),
                "hourly_pattern": {
                    k: float(np.mean(v)) for k, v in hourly_volumes.items()
                },
                "dow_pattern": {
                    k: float(np.mean(v)) for k, v in dow_volumes.items()
                },
            },
            "error_rate": {
                **compute_stats(all_error_rates),
                "hourly_pattern": {
                    k: float(np.mean(v)) for k, v in hourly_error_rates.items()
                },
                "dow_pattern": {},
            },
        }

    def save_baselines(self, tenant_id: str, service_id: str, baselines: dict) -> None:
        """Upsert baselines to PostgreSQL."""
        conn = psycopg2.connect(self.pg_dsn)
        try:
            with conn.cursor() as cur:
                for metric_name, stats in baselines.items():
                    cur.execute(
                        """
                        INSERT INTO anomaly_baselines (
                            tenant_id, service_id, metric_name,
                            baseline_mean, baseline_stddev, baseline_p50, baseline_p95, baseline_p99,
                            hourly_pattern, dow_pattern, sample_count, last_updated_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                        ON CONFLICT (tenant_id, service_id, metric_name) DO UPDATE SET
                            baseline_mean = EXCLUDED.baseline_mean,
                            baseline_stddev = EXCLUDED.baseline_stddev,
                            baseline_p50 = EXCLUDED.baseline_p50,
                            baseline_p95 = EXCLUDED.baseline_p95,
                            baseline_p99 = EXCLUDED.baseline_p99,
                            hourly_pattern = EXCLUDED.hourly_pattern,
                            dow_pattern = EXCLUDED.dow_pattern,
                            sample_count = EXCLUDED.sample_count,
                            last_updated_at = now()
                        """,
                        (
                            tenant_id,
                            service_id,
                            metric_name,
                            stats["mean"],
                            stats["stddev"],
                            stats.get("p50"),
                            stats.get("p95"),
                            stats.get("p99"),
                            json.dumps(stats.get("hourly_pattern", {})),
                            json.dumps(stats.get("dow_pattern", {})),
                            stats["sample_count"],
                        ),
                    )
            conn.commit()
        finally:
            conn.close()

    def load_baselines(self, tenant_id: str, service_id: str) -> dict[str, dict]:
        """Load baselines from PostgreSQL for a service."""
        conn = psycopg2.connect(self.pg_dsn)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT metric_name, baseline_mean, baseline_stddev,
                           baseline_p50, baseline_p95, baseline_p99,
                           hourly_pattern, dow_pattern, sample_count
                    FROM anomaly_baselines
                    WHERE tenant_id = %s AND service_id = %s
                    """,
                    (tenant_id, service_id),
                )
                baselines = {}
                for row in cur.fetchall():
                    baselines[row[0]] = {
                        "mean": row[1],
                        "stddev": row[2],
                        "p50": row[3],
                        "p95": row[4],
                        "p99": row[5],
                        "hourly_pattern": row[6] or {},
                        "dow_pattern": row[7] or {},
                        "sample_count": row[8],
                    }
                return baselines
        finally:
            conn.close()
