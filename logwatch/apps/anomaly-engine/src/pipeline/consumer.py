import asyncio
import json
import logging
import os
from datetime import datetime, timezone

import psycopg2
import redis.asyncio as aioredis

from src.models.detector import AnomalyDetector
from src.models.manager import BaselineManager
from src.models.statistical import StatisticalDetector
from src.pipeline.scorer import AnomalyScorer

logger = logging.getLogger(__name__)

STREAM_KEY = "logwatch:ingest:logs"
CONSUMER_GROUP = "anomaly-scorers"
BATCH_SIZE = 500
POLL_INTERVAL_S = 2


class AnomalyConsumer:
    def __init__(
        self,
        redis_url: str,
        pg_dsn: str,
        ch_host: str,
        ch_port: int = 8123,
    ):
        self.redis_url = redis_url
        self.pg_dsn = pg_dsn
        self.baseline_manager = BaselineManager(pg_dsn, ch_host, ch_port)
        self.detector = AnomalyDetector(
            baseline_manager=self.baseline_manager,
            statistical=StatisticalDetector(),
        )
        self.scorer = AnomalyScorer()
        self._running = False
        self._redis: aioredis.Redis | None = None
        self._consumer_name = f"scorer-{os.getpid()}"

    async def start(self) -> None:
        self._running = True
        self._redis = aioredis.from_url(self.redis_url, decode_responses=True)

        try:
            await self._redis.xgroup_create(STREAM_KEY, CONSUMER_GROUP, id="0", mkstream=True)
        except aioredis.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise

        logger.info("AnomalyConsumer started, consumer=%s", self._consumer_name)

        while self._running:
            try:
                await self._process_batch()
            except Exception:
                logger.error("AnomalyConsumer batch error", exc_info=True)
            await asyncio.sleep(POLL_INTERVAL_S)

    async def stop(self) -> None:
        self._running = False
        if self._redis:
            await self._redis.aclose()

    async def _process_batch(self) -> None:
        results = await self._redis.xreadgroup(
            CONSUMER_GROUP, self._consumer_name,
            {STREAM_KEY: ">"},
            count=BATCH_SIZE,
            block=1000,
        )

        if not results:
            return

        logs_by_service: dict[str, list[dict]] = {}
        message_ids = []

        for stream_name, messages in results:
            for msg_id, fields in messages:
                message_ids.append(msg_id)
                try:
                    record = json.loads(fields.get("data", "{}"))
                    service = record.get(
                        "service_name",
                        record.get("resource_string", {}).get("service.name", "unknown"),
                    )
                    logs_by_service.setdefault(service, []).append(record)
                except json.JSONDecodeError:
                    logger.warning("Failed to parse log record: %s", msg_id)

        # Score each service batch
        for service_name, records in logs_by_service.items():
            try:
                await self._score_service_batch(service_name, records)
            except Exception:
                logger.error("Failed to score batch for service %s", service_name, exc_info=True)

        # ACK all messages
        if message_ids:
            await self._redis.xack(STREAM_KEY, CONSUMER_GROUP, *message_ids)

    async def _score_service_batch(self, service_name: str, records: list[dict]) -> None:
        if not records:
            return

        tenant_id = records[0].get("tenant_id", "")
        if not tenant_id:
            return

        # Look up service_id from PostgreSQL
        service_id = self._lookup_service_id(tenant_id, service_name)
        if not service_id:
            return

        # Compute current metrics
        total = len(records)
        error_count = sum(
            1 for r in records if r.get("severity_text", "").upper() in ("ERROR", "FATAL")
        )
        error_rate = error_count / total if total > 0 else 0.0
        log_messages = [r.get("body", "") for r in records]

        # Collect sample log IDs and trace IDs for correlation
        sample_log_ids = [r.get("id", "") for r in records[:10] if r.get("id")]
        related_trace_ids = list(
            {r.get("trace_id", "") for r in records if r.get("trace_id")}
        )[:5]

        # Run detection
        detection_results = self.detector.detect(
            tenant_id=tenant_id,
            service_id=service_id,
            log_messages=log_messages,
            current_error_rate=error_rate,
            current_volume=total,
        )

        if not detection_results:
            return

        # Score and persist anomalies
        window_start = min(r.get("timestamp", "") for r in records)
        window_end = max(r.get("timestamp", "") for r in records)

        for det_result in detection_results:
            scored = self.scorer.score(det_result, service_name)
            self._persist_anomaly(
                tenant_id, service_id, scored,
                window_start, window_end,
                sample_log_ids, related_trace_ids,
            )

    def _lookup_service_id(self, tenant_id: str, service_name: str) -> str | None:
        conn = psycopg2.connect(self.pg_dsn)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM services WHERE tenant_id = %s AND name = %s LIMIT 1",
                    (tenant_id, service_name),
                )
                row = cur.fetchone()
                return str(row[0]) if row else None
        finally:
            conn.close()

    def _persist_anomaly(
        self,
        tenant_id: str,
        service_id: str,
        scored: "ScoredAnomaly",
        window_start: str,
        window_end: str,
        sample_log_ids: list[str],
        related_trace_ids: list[str],
    ) -> None:
        conn = psycopg2.connect(self.pg_dsn)
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO anomalies (
                        tenant_id, service_id, anomaly_type, severity, score,
                        title, description, detected_at, window_start, window_end,
                        sample_log_ids, related_trace_ids
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, now(), %s, %s, %s, %s)
                """, (
                    tenant_id, service_id, scored.anomaly_type, scored.severity, scored.score,
                    scored.title, scored.description, window_start, window_end,
                    sample_log_ids, related_trace_ids,
                ))
            conn.commit()
            logger.info(
                "Persisted anomaly: %s (severity=%s, score=%.3f)",
                scored.title, scored.severity, scored.score,
            )
        finally:
            conn.close()
