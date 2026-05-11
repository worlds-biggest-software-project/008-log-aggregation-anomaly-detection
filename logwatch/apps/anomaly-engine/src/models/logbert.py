import logging
from typing import Optional

import numpy as np
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

logger = logging.getLogger(__name__)


class LogBERTWrapper:
    """Wrapper for LogBERT-style transformer model for log anomaly detection."""

    def __init__(
        self,
        model_name: str = "bert-base-uncased",
        device: Optional[str] = None,
        max_length: int = 128,
        anomaly_threshold: float = 0.5,
    ):
        self.model_name = model_name
        self.max_length = max_length
        self.anomaly_threshold = anomaly_threshold
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = None
        self.model = None
        self._loaded = False

    def load(self) -> None:
        """Load tokenizer and model."""
        logger.info("Loading LogBERT model: %s on %s", self.model_name, self.device)
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        # For actual LogBERT, use a fine-tuned binary classification head
        # Here we load base model - in production, load from artifact_path
        self.model = AutoModelForSequenceClassification.from_pretrained(
            self.model_name, num_labels=2
        )
        self.model.to(self.device)
        self.model.eval()
        self._loaded = True
        logger.info("LogBERT model loaded successfully")

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def predict(self, log_messages: list[str]) -> list[tuple[float, bool]]:
        """Score log messages. Returns (score, is_anomaly) tuples."""
        if not self._loaded:
            raise RuntimeError("Model not loaded. Call load() first.")

        if not log_messages:
            return []

        inputs = self.tokenizer(
            log_messages,
            padding=True,
            truncation=True,
            max_length=self.max_length,
            return_tensors="pt",
        ).to(self.device)

        with torch.no_grad():
            outputs = self.model(**inputs)
            probs = torch.softmax(outputs.logits, dim=-1)
            anomaly_probs = probs[:, 1].cpu().numpy()  # class 1 = anomaly

        results = []
        for prob in anomaly_probs:
            score = float(prob)
            results.append((score, score >= self.anomaly_threshold))
        return results

    def predict_batch(
        self, log_messages: list[str], batch_size: int = 64
    ) -> list[tuple[float, bool]]:
        """Score in batches to avoid OOM."""
        all_results = []
        for i in range(0, len(log_messages), batch_size):
            batch = log_messages[i : i + batch_size]
            all_results.extend(self.predict(batch))
        return all_results
