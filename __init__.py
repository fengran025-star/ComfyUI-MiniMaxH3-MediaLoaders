from __future__ import annotations

import mimetypes
from pathlib import Path, PurePosixPath

from .audio_nodes import (
    AUDIO_EXTENSIONS,
    NODE_CLASS_MAPPINGS as AUDIO_NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as AUDIO_NODE_DISPLAY_NAME_MAPPINGS,
    available_destination,
    is_audio_filename,
    list_audio_files,
    normalize_relative_path,
    resolve_audio_path,
    resolve_input_folder,
    sanitize_filename_component,
)
from .video_nodes import (
    VIDEO_NODE_CLASS_MAPPINGS,
    VIDEO_NODE_DISPLAY_NAME_MAPPINGS,
    VIDEO_EXTENSIONS,
    is_video_filename,
    list_video_files,
    resolve_video_folder,
    resolve_video_path,
)
from .image_nodes import IMAGE_NODE_CLASS_MAPPINGS, IMAGE_NODE_DISPLAY_NAME_MAPPINGS
from .h3_nodes import (
    NODE_CLASS_MAPPINGS as H3_NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as H3_NODE_DISPLAY_NAME_MAPPINGS,
)


WEB_DIRECTORY = "./web"


def _upload_relative_path(value: str, filename: str) -> PurePosixPath:
    raw = str(value or filename).replace("\\", "/")
    parts = [
        sanitize_filename_component(part, "folder")
        for part in PurePosixPath(raw).parts
        if part not in {"", ".", ".."}
    ]
    if len(parts) > 1:
        parts = parts[1:]
    if not parts:
        parts = [sanitize_filename_component(Path(filename).name, "audio")]
    parts[-1] = sanitize_filename_component(Path(parts[-1]).stem, "audio") + Path(filename).suffix.lower()
    return PurePosixPath(*parts)


try:
    from aiohttp import web
    from server import PromptServer

    @PromptServer.instance.routes.get("/audio-folder-loader/files")
    async def audio_folder_loader_files(request):
        try:
            folder = request.query.get("folder", "")
            _target, normalized = resolve_input_folder(folder, create=True)
            return web.json_response(
                {
                    "folder": normalized,
                    "files": list_audio_files(normalized),
                    "extensions": sorted(AUDIO_EXTENSIONS),
                }
            )
        except (OSError, ValueError) as error:
            return web.json_response({"error": str(error)}, status=400)

    @PromptServer.instance.routes.get("/audio-folder-loader/view")
    async def audio_folder_loader_view(request):
        try:
            path = resolve_audio_path(
                request.query.get("folder", ""),
                request.query.get("file", ""),
            )
        except (OSError, ValueError) as error:
            return web.Response(text=str(error), status=404)
        content_type = mimetypes.guess_type(path.name, strict=False)[0] or "application/octet-stream"
        return web.FileResponse(
            path,
            headers={
                "Content-Type": content_type,
                "Content-Disposition": f'inline; filename="{path.name}"',
            },
        )

    @PromptServer.instance.routes.post("/audio-folder-loader/upload")
    async def audio_folder_loader_upload(request):
        temporary_paths = []
        try:
            post = await request.post()
            target, normalized_folder = resolve_input_folder(
                str(post.get("folder", "")),
                create=True,
            )
            uploaded_files = list(post.getall("files", []))
            if len(uploaded_files) != 1:
                return web.json_response({"error": "每次只能上传一个音频文件"}, status=400)
            upload = uploaded_files[0]
            filename = Path(str(getattr(upload, "filename", "") or "")).name
            if not filename or not is_audio_filename(filename) or not getattr(upload, "file", None):
                return web.json_response({"error": "没有找到支持的音频文件"}, status=400)

            destination = target / Path(_upload_relative_path(filename, filename))
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination = available_destination(destination)
            temporary = destination.with_name(f".{destination.name}.uploading")
            temporary_paths.append(temporary)
            with temporary.open("wb") as output:
                while chunk := upload.file.read(1024 * 1024):
                    output.write(chunk)
            temporary.replace(destination)
            temporary_paths.remove(temporary)
            saved_file = destination.relative_to(target).as_posix()

            return web.json_response(
                {
                    "folder": normalized_folder,
                    "saved": [saved_file],
                    "selected": saved_file,
                    "files": list_audio_files(normalized_folder),
                }
            )
        except (OSError, ValueError) as error:
            for temporary in temporary_paths:
                temporary.unlink(missing_ok=True)
            return web.json_response({"error": str(error)}, status=400)

    @PromptServer.instance.routes.get("/video-folder-loader/files")
    async def video_folder_loader_files(request):
        try:
            folder = request.query.get("folder", "video")
            # Migrate old VideoFolderLoader instances whose first widget used
            # to be a root-level file selector rather than a folder field.
            if is_video_filename(folder):
                folder = "video"
            _target, normalized = resolve_video_folder(folder, create=True)
            return web.json_response(
                {
                    "folder": normalized,
                    "files": list_video_files(normalized),
                    "extensions": sorted(VIDEO_EXTENSIONS),
                }
            )
        except (OSError, ValueError) as error:
            return web.json_response({"error": str(error)}, status=400)

    @PromptServer.instance.routes.get("/video-folder-loader/view")
    async def video_folder_loader_view(request):
        try:
            folder = request.query.get("folder", "")
            if is_video_filename(folder):
                folder = "video"
            path = resolve_video_path(
                folder,
                request.query.get("file", ""),
            )
        except (OSError, ValueError) as error:
            return web.Response(text=str(error), status=404)
        content_type = mimetypes.guess_type(path.name, strict=False)[0] or "application/octet-stream"
        return web.FileResponse(
            path,
            headers={
                "Content-Type": content_type,
                "Content-Disposition": f'inline; filename="{path.name}"',
            },
        )

    @PromptServer.instance.routes.get("/video-folder-loader/info")
    async def video_folder_loader_info(request):
        try:
            import av

            folder = request.query.get("folder", "video")
            if is_video_filename(folder):
                folder = "video"
            path = resolve_video_path(folder, request.query.get("file", ""))
            with av.open(str(path), mode="r") as container:
                stream = next((item for item in container.streams if item.type == "video"), None)
                if stream is None:
                    raise ValueError("视频中没有视频流")
                duration = 0.0
                if container.duration is not None:
                    duration = max(0.0, float(container.duration / av.time_base))
                fps = float(stream.average_rate) if stream.average_rate else 0.0
                frames = int(stream.frames or 0)
                if frames <= 0 and duration > 0 and fps > 0:
                    frames = int(round(duration * fps))
                return web.json_response(
                    {
                        "width": int(stream.width or 0),
                        "height": int(stream.height or 0),
                        "fps": fps,
                        "frames": frames,
                        "duration": duration,
                    }
                )
        except (OSError, ValueError) as error:
            return web.json_response({"error": str(error)}, status=400)

    @PromptServer.instance.routes.post("/video-folder-loader/upload")
    async def video_folder_loader_upload(request):
        temporary_paths = []
        try:
            post = await request.post()
            upload_folder = str(post.get("folder", "video"))
            if is_video_filename(upload_folder):
                upload_folder = "video"
            target, normalized_folder = resolve_video_folder(
                upload_folder,
                create=True,
            )
            uploaded_files = list(post.getall("files", []))
            if len(uploaded_files) != 1:
                return web.json_response({"error": "每次只能上传一个视频文件"}, status=400)
            upload = uploaded_files[0]
            filename = Path(str(getattr(upload, "filename", "") or "")).name
            if not filename or not is_video_filename(filename) or not getattr(upload, "file", None):
                return web.json_response({"error": "没有找到支持的视频文件"}, status=400)

            destination = target / Path(_upload_relative_path(filename, filename))
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination = available_destination(destination)
            temporary = destination.with_name(f".{destination.name}.uploading")
            temporary_paths.append(temporary)
            with temporary.open("wb") as output:
                while chunk := upload.file.read(1024 * 1024):
                    output.write(chunk)
            temporary.replace(destination)
            temporary_paths.remove(temporary)
            saved_file = destination.relative_to(target).as_posix()

            return web.json_response(
                {
                    "folder": normalized_folder,
                    "saved": [saved_file],
                    "selected": saved_file,
                    "files": list_video_files(normalized_folder),
                }
            )
        except (OSError, ValueError) as error:
            for temporary in temporary_paths:
                temporary.unlink(missing_ok=True)
            return web.json_response({"error": str(error)}, status=400)

except (ImportError, AttributeError):
    # Allows lightweight imports outside a running ComfyUI server.
    pass


__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

NODE_CLASS_MAPPINGS = {
    **H3_NODE_CLASS_MAPPINGS,
    **AUDIO_NODE_CLASS_MAPPINGS,
    **VIDEO_NODE_CLASS_MAPPINGS,
    **IMAGE_NODE_CLASS_MAPPINGS,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    **H3_NODE_DISPLAY_NAME_MAPPINGS,
    **AUDIO_NODE_DISPLAY_NAME_MAPPINGS,
    **VIDEO_NODE_DISPLAY_NAME_MAPPINGS,
    **IMAGE_NODE_DISPLAY_NAME_MAPPINGS,
}
