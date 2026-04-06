"""Small helpers for ONNX TTS (Matcha-style phoneme sequence layout)."""


def intersperse(lst, item):
    """Insert `item` between each element and pad both ends (Matcha-TTS semantics)."""
    result = [item] * (len(lst) * 2 + 1)
    result[1::2] = lst
    return result
