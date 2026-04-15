import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def run_cmd(cmd: list[str], cwd: Path) -> None:
    print("Running:", " ".join(cmd))
    env = os.environ.copy()
    env["TRANSFORMERS_NO_TF"] = "1"
    proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        print(proc.stdout)
        print(proc.stderr)
        raise RuntimeError(f"Command failed: {' '.join(cmd)}")
    if proc.stdout:
        print(proc.stdout)


def copy_if_exists(src: Path, dst: Path) -> None:
    if src.exists() and src.is_file():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def find_exported_onnx(root: Path) -> Path:
    candidates = sorted(root.rglob("*.onnx"))
    if not candidates:
        raise RuntimeError("No ONNX file produced by exporter")
    preferred = [p for p in candidates if p.name == "model.onnx"]
    return preferred[0] if preferred else candidates[0]


def export_with_torch(source: Path, output_file: Path) -> None:
    import torch
    from transformers import AutoModelForCTC

    model = AutoModelForCTC.from_pretrained(str(source))
    model.eval()

    class CtcWrapper(torch.nn.Module):
        def __init__(self, wrapped_model):
            super().__init__()
            self.wrapped_model = wrapped_model

        def forward(self, input_values, attention_mask):
            return self.wrapped_model(input_values=input_values, attention_mask=attention_mask).logits

    wrapper = CtcWrapper(model)
    dummy_len = 16000
    input_values = torch.randn(1, dummy_len, dtype=torch.float32)
    attention_mask = torch.ones(1, dummy_len, dtype=torch.int64)

    output_file.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        wrapper,
        (input_values, attention_mask),
        str(output_file),
        input_names=["input_values", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_values": {1: "sequence"},
            "attention_mask": {1: "sequence"},
            "logits": {1: "frames"},
        },
        opset_version=17,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Export local STT model to browser ONNX layout")
    parser.add_argument(
        "--source",
        default="wav2vec2-datasetstt02/wav2vec2-datasetstt",
        help="Source HuggingFace model directory",
    )
    parser.add_argument(
        "--target",
        default="frontend/public/models/datasetstt/wav2vec2-datasetstt",
        help="Target browser model directory",
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root path",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    src = (repo_root / args.source).resolve()
    dst = (repo_root / args.target).resolve()

    if not src.exists():
        raise RuntimeError(f"Source model folder not found: {src}")

    dst.mkdir(parents=True, exist_ok=True)
    onnx_dst = dst / "onnx" / "model.onnx"

    with tempfile.TemporaryDirectory(prefix="stt_onnx_export_") as tmp:
        tmp_path = Path(tmp)
        exported_onnx: Path | None = None

        # Preferred exporter for ASR models.
        try:
            run_cmd(
                [
                    sys.executable,
                    "-m",
                    "optimum.exporters.onnx",
                    "--model",
                    str(src),
                    "--task",
                    "automatic-speech-recognition",
                    str(tmp_path),
                ],
                cwd=repo_root,
            )
            exported_onnx = find_exported_onnx(tmp_path)
        except Exception:
            # Fallback exporter available in transformers.
            try:
                run_cmd(
                    [
                        sys.executable,
                        "-m",
                        "transformers.onnx",
                        "--model",
                        str(src),
                        "--feature",
                        "automatic-speech-recognition",
                        str(tmp_path),
                    ],
                    cwd=repo_root,
                )
                exported_onnx = find_exported_onnx(tmp_path)
            except Exception:
                exported_onnx = None

        if exported_onnx is None:
            export_with_torch(src, onnx_dst)
        else:
            onnx_dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(exported_onnx, onnx_dst)

        onnx_dst.parent.mkdir(parents=True, exist_ok=True)

    # Copy tokenizer / config files needed by transformers.js style loading.
    for file_name in [
        "config.json",
        "preprocessor_config.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "vocab.json",
        "added_tokens.json",
    ]:
        copy_if_exists(src / file_name, dst / file_name)

    print(f"ONNX export complete: {onnx_dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
