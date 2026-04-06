"""
Optional dev utility: copies local app/text/*.py into a pip-installed matcha-tts tree.
Not used by the Docker image or the default API (ONNX path does not require matcha).
"""
import os
import shutil

import matcha

matcha_path = os.path.dirname(matcha.__file__)
print(f"Targeting Matcha at: {matcha_path}")

src_dir = "app/text"
files_to_patch = ["cleaners.py", "symbols.py", "__init__.py"]

for fileName in files_to_patch:
    src = os.path.join(src_dir, fileName)
    dest = os.path.join(matcha_path, "text", fileName)
    if os.path.exists(src):
        shutil.copy(src, dest)
        print(f"Patched: {fileName}")

print("Patching sequence complete.")
