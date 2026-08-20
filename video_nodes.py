from __future__ import annotations

import hashlib
import mimetypes
import os
from fractions import Fraction
from pathlib import Path, PurePosixPath

import torch
import torch.nn.functional as F
import folder_paths
from comfy_api.input_impl import VideoFromFile, VideoFromComponents
from comfy_api.latest import Types


EMPTY_VIDEO_OPTION = "（当前文件夹没有视频）"
DEFAULT_VIDEO_FOLDER = "video"

# These are the video formats recognized by the native LoadVideo node on this
# installation, with common Windows MIME gaps covered explicitly.
VIDEO_EXTENSIONS = {
    ".3gp", ".avi", ".flv", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4",
    ".mpeg", ".mpg", ".mts", ".ts", ".webm", ".wmv",
}


def normalize_video_relative_path(value: str) -> str:
    raw = str(value or "").strip().replace("\\", "/")
    if raw in {"", "."}:
        return ""
    path = PurePosixPath(raw)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("路径必须是 ComfyUI/input 下的安全相对路径")
    if path.parts and ":" in path.parts[0]:
        raise ValueError("不支持盘符或绝对路径，请填写 input 下的相对路径")
    return path.as_posix()


def resolve_video_folder(folder: str, create: bool = False) -> tuple[Path, str]:
    relative = normalize_video_relative_path(folder)
    input_root = Path(folder_paths.get_input_directory()).resolve()
    target = (input_root / relative).resolve()
    try:
        target.relative_to(input_root)
    except ValueError as error:
        raise ValueError("目标文件夹超出了 ComfyUI/input") from error
    if target.exists() and not target.is_dir():
        raise ValueError(f"目标路径不是文件夹：{relative or 'input'}")
    if create:
        target.mkdir(parents=True, exist_ok=True)
    return target, relative


def is_video_filename(filename: str) -> bool:
    name = str(filename or "")
    guessed = mimetypes.guess_type(name, strict=False)[0]
    return bool((guessed and guessed.startswith("video/")) or Path(name).suffix.lower() in VIDEO_EXTENSIONS)


def list_video_files(folder: str = DEFAULT_VIDEO_FOLDER) -> list[str]:
    target, _relative = resolve_video_folder(folder, create=True)
    files = [
        path.relative_to(target).as_posix()
        for path in target.rglob("*")
        if path.is_file() and is_video_filename(path.name)
    ]
    return sorted(files, key=lambda value: value.casefold())


def resolve_video_path(folder: str, video_file: str) -> Path:
    target, _relative = resolve_video_folder(folder, create=False)
    relative_file = normalize_video_relative_path(video_file)
    if not relative_file or not is_video_filename(relative_file):
        raise ValueError("请选择有效的视频文件")
    path = (target / relative_file).resolve()
    try:
        path.relative_to(target)
    except ValueError as error:
        raise ValueError("视频文件超出了指定文件夹") from error
    if not path.is_file():
        raise ValueError(f"找不到视频文件：{relative_file}")
    return path


class VideoFolderLoader:
    @classmethod
    def INPUT_TYPES(cls):
        files = list_video_files(DEFAULT_VIDEO_FOLDER)
        return {
            "required": {
                "视频文件夹": (
                    "STRING",
                    {
                        "default": DEFAULT_VIDEO_FOLDER,
                        "multiline": False,
                        "tooltip": "填写 ComfyUI/input 下的相对路径，默认使用 video。",
                    },
                ),
                "选择视频": (
                    files or [EMPTY_VIDEO_OPTION],
                    {"tooltip": "只显示指定视频文件夹中的视频文件。"},
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
                        "tooltip": "输出区间的结束时间（秒）；-1 表示视频结尾。",
                    },
                ),
            }
        }

    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("视频",)
    FUNCTION = "load_video"
    CATEGORY = "MiniMax H3 文件加载器"
    DESCRIPTION = "从 ComfyUI/input 的指定子文件夹选择、预览并裁剪视频。"

    def load_video(self, 视频文件夹, 选择视频, 裁剪开始=0.0, 裁剪结束=-1.0):
        video_path = resolve_video_path(视频文件夹, 选择视频)
        source = VideoFromFile(str(video_path))
        duration = max(0.0, float(source.get_duration()))
        start = max(0.0, min(float(裁剪开始), duration))
        end = duration if float(裁剪结束) < 0 else min(float(裁剪结束), duration)
        if end <= start:
            start, end = 0.0, duration
        trimmed = source.as_trimmed(start, end - start, strict_duration=False)
        if trimmed is None:
            raise ValueError(f"无法裁剪视频：{video_path.name}")
        return (trimmed,)

    @classmethod
    def VALIDATE_INPUTS(cls, 视频文件夹, 选择视频, 裁剪开始=0.0, 裁剪结束=-1.0):
        try:
            resolve_video_path(视频文件夹, 选择视频)
        except ValueError as error:
            return str(error)
        return True

    @classmethod
    def IS_CHANGED(cls, 视频文件夹, 选择视频, 裁剪开始=0.0, 裁剪结束=-1.0):
        try:
            path = resolve_video_path(视频文件夹, 选择视频)
        except ValueError:
            return float("nan")
        stat = path.stat()
        fingerprint = (
            f"{path}:{stat.st_mtime_ns}:{stat.st_size}:"
            f"{float(裁剪开始):.6f}:{float(裁剪结束):.6f}"
        ).encode("utf-8")
        return hashlib.sha256(fingerprint).hexdigest()


class VideoFrameRateResolution:
    """Resize and temporally resample a VIDEO while keeping its duration/audio."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "视频": ("VIDEO", {"tooltip": "接入视频文件夹加载器或其他 VIDEO 节点。"}),
                "目标帧率": (
                    "FLOAT",
                    {
                        "default": 24.0,
                        "min": 1.0,
                        "max": 120.0,
                        "step": 1.0,
                        "round": 1.0,
                        "tooltip": "目标帧率。会重新采样视频帧，但保持视频总时长。",
                    },
                ),
                "分辨率控制模式": (
                    ["按比例缩放", "限制最大边"],
                    {
                        "default": "按比例缩放",
                        "tooltip": "按比例缩放使用缩放比例；限制最大边会按原始宽高比自动计算缩放比例。",
                    },
                ),
                "分辨率缩放比例": (
                    "FLOAT",
                    {
                        "default": 0.5,
                        "min": 0.1,
                        "max": 2.0,
                        "step": 0.05,
                        "round": 0.01,
                        "tooltip": "按比例缩放宽度和高度；0.5 表示宽高各减半，画面内容不会被裁剪。",
                    },
                ),
                "最大边": (
                    "INT",
                    {
                        "default": 1024,
                        "min": 32,
                        "max": 16384,
                        "step": 2,
                        "tooltip": "限制最大边模式下的最长边像素数；只缩小，不会裁剪或强制放大。",
                    },
                ),
            }
        }

    RETURN_TYPES = ("VIDEO",)
    RETURN_NAMES = ("视频",)
    FUNCTION = "process_video"
    CATEGORY = "MiniMax H3 文件加载器"
    DESCRIPTION = "按比例缩放分辨率并转换帧率，保持视频时长和音频同步。"

    @staticmethod
    def _scaled_dimension(value: int, scale: float) -> int:
        # H.264 and most video models are happier with even dimensions.
        return max(2, int(round(value * scale / 2.0) * 2))

    def process_video(
        self,
        视频,
        目标帧率=24.0,
        分辨率缩放比例=0.5,
        分辨率控制模式="按比例缩放",
        最大边=1024,
    ):
        if 视频 is None or not hasattr(视频, "get_components"):
            return (None,)
        target_fps = float(目标帧率)
        scale = float(分辨率缩放比例)
        if target_fps <= 0:
            raise ValueError("目标帧率必须大于 0")
        if scale <= 0:
            raise ValueError("分辨率缩放比例必须大于 0")

        components = 视频.get_components()
        images = components.images
        if images.ndim != 4 or images.shape[0] == 0:
            raise ValueError("视频没有可处理的画面帧")

        source_fps = float(components.frame_rate) if components.frame_rate else 1.0
        duration = images.shape[0] / max(source_fps, 1e-6)
        target_frames = max(1, int(round(duration * target_fps)))

        # Time-based sampling preserves the original duration instead of simply
        # dropping every Nth frame, which can introduce duration drift.
        sample_positions = torch.linspace(
            0,
            max(0, images.shape[0] - 1),
            target_frames,
            device=images.device,
        ).round().long()
        images = images.index_select(0, sample_positions)

        if str(分辨率控制模式) == "限制最大边":
            max_edge = max(32, int(最大边))
            source_max_edge = max(images.shape[1], images.shape[2])
            scale = min(1.0, max_edge / max(1, source_max_edge))

        target_height = self._scaled_dimension(images.shape[1], scale)
        target_width = self._scaled_dimension(images.shape[2], scale)
        if target_height != images.shape[1] or target_width != images.shape[2]:
            # Video tensors are NHWC; interpolate expects NCHW.
            images = images.permute(0, 3, 1, 2)
            images = F.interpolate(
                images,
                size=(target_height, target_width),
                mode="bilinear",
                align_corners=False,
                antialias=True,
            )
            images = images.permute(0, 2, 3, 1).contiguous()

        result = Types.VideoComponents(
            images=images,
            audio=components.audio,
            frame_rate=Fraction(round(target_fps * 1000), 1000),
        )
        return (VideoFromComponents(result, bit_depth=视频.get_bit_depth()),)


VIDEO_NODE_CLASS_MAPPINGS = {
    "VideoFolderLoader": VideoFolderLoader,
    "VideoFrameRateResolution": VideoFrameRateResolution,
}

VIDEO_NODE_DISPLAY_NAME_MAPPINGS = {
    "VideoFolderLoader": "MiniMax H3 视频加载器",
    "VideoFrameRateResolution": "MiniMax H3 视频分辨率与帧率控制器",
}
