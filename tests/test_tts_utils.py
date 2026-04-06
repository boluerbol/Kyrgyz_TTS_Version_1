from app.tts_utils import intersperse


def test_intersperse_matcha_semantics():
    assert intersperse([], 0) == [0]
    assert intersperse([1, 2], 0) == [0, 1, 0, 2, 0]
    assert intersperse([7], 99) == [99, 7, 99]
