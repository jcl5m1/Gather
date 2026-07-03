"""
Upscale an image via the ComfyUI REST API (http://localhost:8188).

MODES
  Without --prompt  Pure ESRGAN pixel upscale. Fast, no SD model loaded.
  With --prompt     Ultimate SD Upscale: ESRGAN + tiled diffusion for added detail.

USAGE
  python upscale_client.py <input> [output] [options]

OPTIONS
  --model       ESRGAN model (default: 4x-UltraSharp.pth)
                  4x-UltraSharp.pth
                  4x_NMKD-Siax_200k.pth
                  RealESRGAN_x4plus_anime_6B.pth
  --prompt      Positive text prompt — activates Ultimate SD Upscale mode
  --negative    Negative prompt for USDU (default: generic quality negatives)
  --checkpoint  SD checkpoint for USDU (default: waiNSFWIllustrious_v110.safetensors)
  --denoise     0.0–1.0, how much SD changes the image (default: 0.2)
                  0.1  subtle sharpening
                  0.2  default, light detail enhancement
                  0.35 noticeable AI rework
                  0.5+ heavy reimagining
  --steps       Diffusion steps for USDU (default: 20)
  --host        ComfyUI URL (default: http://localhost:8188)

EXAMPLES
  python upscale_client.py photo.png
  python upscale_client.py photo.png out_4x.png --model 4x_NMKD-Siax_200k.pth
  python upscale_client.py photo.png out_4x.png --prompt "masterpiece, best quality, detailed skin"
  python upscale_client.py photo.png out_4x.png --prompt "..." --denoise 0.35 --steps 25
  python upscale_client.py photo.png --host http://192.168.1.10:8188

LIBRARY USE
  from upscale_client import upscale
  upscale("photo.png")
  upscale("photo.png", "out.png", prompt="best quality, detailed", denoise=0.25)
"""
import argparse
import json
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path

DEFAULT_HOST = "http://localhost:8188"
DEFAULT_MODEL = "4x-UltraSharp.pth"
DEFAULT_CHECKPOINT = "waiNSFWIllustrious_v110.safetensors"
DEFAULT_NEGATIVE = "worst quality, low quality, blurry, jpeg artifacts"

ESRGAN_WORKFLOW = {
    "1": {"class_type": "LoadImage", "inputs": {"image": "{INPUT_FILENAME}"}},
    "2": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "{MODEL}"}},
    "3": {"class_type": "ImageUpscaleWithModel", "inputs": {
        "upscale_model": ["2", 0],
        "image": ["1", 0],
    }},
    "4": {"class_type": "SaveImage", "inputs": {
        "images": ["3", 0],
        "filename_prefix": "upscaled",
    }},
}

USDU_WORKFLOW = {
    "1": {"class_type": "LoadImage", "inputs": {"image": "{INPUT_FILENAME}"}},
    "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "{CHECKPOINT}"}},
    "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "{POSITIVE}", "clip": ["2", 1]}},
    "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "{NEGATIVE}", "clip": ["2", 1]}},
    "5": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "{MODEL}"}},
    "6": {"class_type": "UltimateSDUpscale", "inputs": {
        "image": ["1", 0],
        "model": ["2", 0],
        "positive": ["3", 0],
        "negative": ["4", 0],
        "vae": ["2", 2],
        "upscale_model": ["5", 0],
        "upscale_by": 4,
        "seed": 0,
        "steps": "{STEPS}",
        "cfg": 7.0,
        "sampler_name": "dpmpp_2m",
        "scheduler": "karras",
        "denoise": "{DENOISE}",
        "mode_type": "Linear",
        "tile_width": 1024,
        "tile_height": 1024,
        "mask_blur": 8,
        "tile_padding": 32,
        "seam_fix_mode": "None",
        "seam_fix_denoise": 1.0,
        "seam_fix_width": 64,
        "seam_fix_mask_blur": 8,
        "seam_fix_padding": 16,
        "force_uniform_tiles": True,
        "tiled_decode": False,
        "batch_size": 1,
    }},
    "7": {"class_type": "SaveImage", "inputs": {
        "images": ["6", 0],
        "filename_prefix": "upscaled",
    }},
}


def upload_image(host: str, image_path: Path) -> str:
    with open(image_path, "rb") as f:
        data = f.read()
    boundary = "----ComfyBoundary"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{image_path.name}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{host}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["name"]


def queue_prompt(host: str, workflow: dict) -> str:
    payload = json.dumps({"prompt": workflow}).encode()
    req = urllib.request.Request(
        f"{host}/prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["prompt_id"]


def wait_for_completion(host: str, prompt_id: str, poll_interval: float = 1.0) -> dict:
    url = f"{host}/history/{prompt_id}"
    while True:
        with urllib.request.urlopen(url) as resp:
            history = json.loads(resp.read())
        if prompt_id in history:
            return history[prompt_id]
        time.sleep(poll_interval)


def download_output(host: str, history_entry: dict, output_path: Path):
    for node_output in history_entry.get("outputs", {}).values():
        images = node_output.get("images", [])
        if images:
            img = images[0]
            params = urllib.parse.urlencode({
                "filename": img["filename"],
                "subfolder": img.get("subfolder", ""),
                "type": img.get("type", "output"),
            })
            output_path.write_bytes(urllib.request.urlopen(f"{host}/view?{params}").read())
            return
    raise RuntimeError("No image output found in history")


def upscale(
    image_path: str,
    output_path: str | None = None,
    model: str = DEFAULT_MODEL,
    host: str = DEFAULT_HOST,
    prompt: str | None = None,
    negative: str = DEFAULT_NEGATIVE,
    checkpoint: str = DEFAULT_CHECKPOINT,
    denoise: float = 0.2,
    steps: int = 20,
) -> Path:
    src = Path(image_path)
    dst = Path(output_path) if output_path else src.with_stem(src.stem + "_4x")

    print(f"Uploading {src.name}...", flush=True)
    uploaded_name = upload_image(host, src)

    if prompt is not None:
        print("Mode: Ultimate SD Upscale (diffusion)", flush=True)
        workflow = json.loads(
            json.dumps(USDU_WORKFLOW)
            .replace("{INPUT_FILENAME}", uploaded_name)
            .replace("{MODEL}", model)
            .replace("{CHECKPOINT}", checkpoint)
            .replace("{POSITIVE}", prompt)
            .replace("{NEGATIVE}", negative)
            .replace('"{STEPS}"', str(steps))
            .replace('"{DENOISE}"', str(denoise))
        )
    else:
        print("Mode: ESRGAN (pixel upscale)", flush=True)
        workflow = json.loads(
            json.dumps(ESRGAN_WORKFLOW)
            .replace("{INPUT_FILENAME}", uploaded_name)
            .replace("{MODEL}", model)
        )

    print("Queuing job...", flush=True)
    prompt_id = queue_prompt(host, workflow)
    print(f"Prompt ID: {prompt_id}", flush=True)

    print("Waiting for completion...", flush=True)
    history = wait_for_completion(host, prompt_id)

    if history.get("status", {}).get("status_str") == "error":
        raise RuntimeError(f"Job failed: {history['status'].get('messages', [])}")

    print(f"Downloading result to {dst}...", flush=True)
    download_output(host, history, dst)
    print(f"Done: {dst}", flush=True)
    return dst


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upscale image via ComfyUI API")
    parser.add_argument("input", help="Input image path")
    parser.add_argument("output", nargs="?", help="Output path (default: input_4x.ext)")
    parser.add_argument("--model", default=DEFAULT_MODEL,
                        choices=["4x-UltraSharp.pth", "4x_NMKD-Siax_200k.pth", "RealESRGAN_x4plus_anime_6B.pth"],
                        help="ESRGAN upscale model")
    parser.add_argument("--prompt", default=None,
                        help="Positive text prompt — enables Ultimate SD Upscale mode")
    parser.add_argument("--negative", default=DEFAULT_NEGATIVE,
                        help="Negative prompt (USDU mode only)")
    parser.add_argument("--checkpoint", default=DEFAULT_CHECKPOINT,
                        help="SD checkpoint for USDU mode")
    parser.add_argument("--denoise", type=float, default=0.2,
                        help="Denoise strength for USDU (0.1=subtle, 0.4=heavy, default=0.2)")
    parser.add_argument("--steps", type=int, default=20,
                        help="Diffusion steps for USDU mode (default=20)")
    parser.add_argument("--host", default=DEFAULT_HOST, help="ComfyUI host URL")
    args = parser.parse_args()

    try:
        upscale(
            args.input, args.output,
            model=args.model, host=args.host,
            prompt=args.prompt, negative=args.negative,
            checkpoint=args.checkpoint, denoise=args.denoise, steps=args.steps,
        )
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
