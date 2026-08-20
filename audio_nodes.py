from __future__ import annotations

import hashlib
import re
from pathlib import Path, PurePosixPath

import folder_paths
from comfy_extras.nodes_audio import load as load_audio_file


AUDIO_EXTENSIONS = {
    ".aac",
    ".aif",
    ".aiff",
    ".flac",
    ".m4a",
    ".mp3",
    ".oga",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
    ".wma",
}
EMPTY_AUDIO_OPTION = "（当前文件夹没有音频）"
DEFAULT_FOLDER = "audio"

_INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{index}" for index in range(1, 10)),
    *(f"lpt{index}" for index in range(1, 10)),
}


def normalize_relative_path(value: str) -> str:
    raw = str(value or "").strip().replace("\\", "/")
    if raw in {"", "."}:
        return ""
    path = PurePosixPath(raw)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("路径必须是 ComfyUI/input 下的安全相对路径")
    if path.parts and ":" in path.parts[0]:
        raise ValueError("不支持盘符或绝对路径，请填写 input 下的相对路径")
    return path.as_posix()


def resolve_input_folder(folder: str, create: bool = False) -> tuple[Path, str]:
    relative = normalize_relative_path(folder)
    input_root = Path(folder_paths.get_input_directory()).resolve()
    target = (input_root / relative).resolve()
    try:
        target.relative_to(input_root)
    except ValueError as error:
        raise ValueError("目标文件夹超出了 ComfyUI/input") from error
    if create:
        target.mkdir(parents=True, exist_ok=True)
    return target, relative


def is_audio_filename(filename: str) -> bool:
    return Path(str(filename or "")).suffix.lower() in AUDIO_EXTENSIONS


def list_audio_files(folder: str = DEFAULT_FOLDER) -> list[str]:
    target, _relative = resolve_input_folder(folder, create=True)
    files = [
        path.relative_to(target).as_posix()
        for path in target.rglob("*")
        if path.is_file() and is_audio_filename(path.name)
    ]
    return sorted(files, key=lambda value: value.casefold())


def resolve_audio_path(folder: str, audio_file: str) -> Path:
    target, _relative = resolve_input_folder(folder, create=False)
    relative_file = normalize_relative_path(audio_file)
    if not relative_file or not is_audio_filename(relative_file):
        raise ValueError("请选择有效的音频文件")
    path = (target / relative_file).resolve()
    try:
        path.relative_to(target)
    except ValueError as error:
        raise ValueError("音频文件超出了指定文件夹") from error
    if not path.is_file():
        raise ValueError(f"找不到音频文件：{relative_file}")
    return path


def sanitize_filename_component(value: str, fallback: str = "audio") -> str:
    cleaned = _INVALID_FILENAME.sub("_", str(value or "")).strip().rstrip(". ")
    if not cleaned:
        cleaned = fallback
    if cleaned.casefold() in _WINDOWS_RESERVED_NAMES:
        cleaned = f"_{cleaned}"
    return cleaned[:160]


def available_destination(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(1, 10000):
        candidate = path.with_name(f"{path.stem} ({index}){path.suffix}")
        if not candidate.exists():
            return candidate
    raise ValueError(f"同名文件过多，无法保存：{path.name}")


class AudioFolderLoader:
    @classmethod
    def INPUT_TYPES(cls):
        files = list_audio_files(DEFAULT_FOLDER)
        return {
            "required": {
                "音频文件夹": (
                    "STRING",
                    {
                        "default": DEFAULT_FOLDER,
                        "multiline": False,
                        "tooltip": "填写 ComfyUI/input 下的相对路径，例如 audio/reference。",
                    },
                ),
                "选择音频": (
                    files or [EMPTY_AUDIO_OPTION],
                    {
                        "tooltip": "只显示指定文件夹中的常见音频文件。",
                    },
                ),
                "裁剪开始": (
                    "FLOAT",
                    {
                        "default": 0.0,
                        "min": 0.0,
                        "max": 86400.0,
                        "step": 0.01,
                        "round": 0.01,
                        "tooltip": "输出区间的开始时间（秒）。",
                    },
                ),
                "裁剪结束": (
                    "FLOAT",
                    {
                        "default": -1.0,
                        "min": -1.0,
                        "max": 86400.0,
                        "step": 0.01,
                        "round": 0.01,
                        "tooltip": "输出区间的结束时间（秒）；-1 表示音频结尾。",
                    },
                ),
            }
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("音频",)
    FUNCTION = "load_audio"
    CATEGORY = "MiniMax H3 文件加载器"
    DESCRIPTION = "从 ComfyUI/input 的指定子文件夹筛选、预览并加载音频。"

    def load_audio(self, 音频文件夹, 选择音频, 裁剪开始=0.0, 裁剪结束=-1.0):
        audio_path = resolve_audio_path(音频文件夹, 选择音频)
        waveform, sample_rate = load_audio_file(str(audio_path))
        # load_audio_file returns [channels, samples]. Keep the existing batch
        # dimension added by this node, and slice only the final sample axis.
        waveform = waveform.unsqueeze(0)
        total_samples = waveform.shape[-1]
        duration = total_samples / float(sample_rate)
        start_seconds = max(0.0, min(float(裁剪开始), duration))
        end_seconds = duration if float(裁剪结束) < 0 else min(float(裁剪结束), duration)
        if end_seconds <= start_seconds:
            start_seconds, end_seconds = 0.0, duration
        start_sample = max(0, min(int(round(start_seconds * sample_rate)), total_samples - 1))
        end_sample = max(start_sample + 1, min(int(round(end_seconds * sample_rate)), total_samples))
        waveform = waveform[..., start_sample:end_sample]
        return ({"waveform": waveform, "sample_rate": sample_rate},)

    @classmethod
    def VALIDATE_INPUTS(cls, 音频文件夹, 选择音频, 裁剪开始=0.0, 裁剪结束=-1.0):
        try:
            resolve_audio_path(音频文件夹, 选择音频)
        except ValueError as error:
            return str(error)
        return True

    @classmethod
    def IS_CHANGED(cls, 音频文件夹, 选择音频, 裁剪开始=0.0, 裁剪结束=-1.0):
        try:
            path = resolve_audio_path(音频文件夹, 选择音频)
        except ValueError:
            return float("nan")
        stat = path.stat()
        fingerprint = (
            f"{path}:{stat.st_mtime_ns}:{stat.st_size}:"
            f"{float(裁剪开始):.6f}:{float(裁剪结束):.6f}"
        ).encode("utf-8")
        return hashlib.sha256(fingerprint).hexdigest()


NODE_CLASS_MAPPINGS = {
    "AudioFolderLoader": AudioFolderLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AudioFolderLoader": "MiniMax H3 音频加载器",
}
