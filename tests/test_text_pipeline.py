"""Smoke tests for Kyrgyz text -> ID sequence (no ONNX, no Groq)."""

from app.text_processor import KyrgyzTextProcessor


def test_processor_cyrillic():
    proc = KyrgyzTextProcessor()
    seq = proc.text_to_sequence("Салам")
    assert len(seq) > 0
    assert all(isinstance(i, int) for i in seq)
