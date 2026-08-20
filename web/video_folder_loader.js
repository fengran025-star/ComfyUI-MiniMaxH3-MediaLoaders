import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "VideoFolderLoader";
const EMPTY_OPTION = "（当前文件夹没有视频）";
const VIDEO_EXTENSIONS = [
    ".3gp", ".avi", ".flv", ".m2ts", ".m4v", ".mkv", ".mov", ".mp4",
    ".mpeg", ".mpg", ".mts", ".ts", ".webm", ".wmv",
];

function isVideoFilename(value) {
    const lower = String(value || "").toLowerCase();
    return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function chainCallback(object, property, callback) {
    const original = object[property];
    object[property] = function (...args) {
        const result = original?.apply(this, args);
        return callback.apply(this, args) ?? result;
    };
}

function ensureStyles() {
    if (document.getElementById("video-folder-loader-styles")) return;
    const style = document.createElement("style");
    style.id = "video-folder-loader-styles";
    style.textContent = `
        .video-folder-loader-preview { box-sizing: border-box; width: 100%; padding: 8px 6px 4px; color: var(--input-text, #ddd); }
        .video-folder-loader-preview video { display: block; width: 100%; height: 205px; object-fit: contain; background: #111; }
        .video-folder-loader-timeline { position: relative; height: 34px; margin: 6px 5px 0; cursor: pointer; user-select: none; touch-action: none; }
        .video-folder-loader-track { position: absolute; left: 0; right: 0; top: 11px; height: 10px; border-radius: 3px; background: var(--comfy-input-bg, #333); border: 1px solid #666; }
        .video-folder-loader-selected { position: absolute; top: 0; bottom: 0; background: rgba(105, 170, 220, .28); }
        .video-folder-loader-mask { position: absolute; top: 0; bottom: 0; background: rgba(0, 0, 0, .28); pointer-events: none; }
        .video-folder-loader-handle { position: absolute; top: 0; width: 3px; height: 32px; margin-left: -1px; background: #8ed0ff; border: 1px solid #d9f2ff; border-radius: 1px; cursor: ew-resize; z-index: 2; box-sizing: border-box; }
        .video-folder-loader-time { display: flex; justify-content: space-between; gap: 8px; margin: 0 6px 2px; min-height: 18px; font-size: 11px; line-height: 18px; color: var(--descrip-text, #aaa); white-space: nowrap; }
        .video-folder-loader-time span { overflow: hidden; text-overflow: ellipsis; }
        .video-folder-loader-meta { box-sizing: border-box; margin: 0 6px 1px; min-height: 18px; font-size: 11px; line-height: 18px; color: var(--descrip-text, #aaa); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    `;
    document.head.appendChild(style);
}

function videoUrl(folder, file) {
    const query = new URLSearchParams({ folder: folder || "", file: file || "" });
    return api.apiURL(`/video-folder-loader/view?${query}`);
}

function showError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (app.ui?.dialog?.show) app.ui.dialog.show(message); else alert(message);
}

function setComboValues(widget, files, preferred = "") {
    const values = files.length ? files : [EMPTY_OPTION];
    const selectable = files.length && preferred === "" ? ["", ...values] : values;
    widget.options ??= {};
    widget.options.values = selectable;
    widget.value = selectable.includes(preferred) ? preferred : selectable[0];
}

function createFileInput() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = VIDEO_EXTENSIONS.join(",");
    input.multiple = false;
    input.style.display = "none";
    document.body.appendChild(input);
    return input;
}

function uploadRequest(formData, onProgress) {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", api.apiURL("/video-folder-loader/upload"), true);
        request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
        request.onload = () => {
            let payload = {};
            try { payload = JSON.parse(request.responseText || "{}"); } catch { payload = {}; }
            if (request.status >= 200 && request.status < 300) resolve(payload);
            else reject(new Error(payload.error || `上传失败：HTTP ${request.status}`));
        };
        request.onerror = () => reject(new Error("上传失败：无法连接 ComfyUI 后端"));
        request.send(formData);
    });
}

function formatTime(seconds, precise = false) {
    const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    if (precise && Math.abs(value - Math.round(value)) > 0.005) {
        const minutes = Math.floor(value / 60);
        return `${String(minutes).padStart(2, "0")}:${(value - minutes * 60).toFixed(2).padStart(5, "0")}`;
    }
    const whole = Math.round(value);
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

app.registerExtension({
    name: "ComfyUI.VideoFolderLoader",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        chainCallback(nodeType.prototype, "onNodeCreated", function () {
            ensureStyles();
            const node = this;
            const folderWidget = node.widgets?.find((widget) => widget.name === "视频文件夹");
            const videoWidget = node.widgets?.find((widget) => widget.name === "选择视频");
            const startWidget = node.widgets?.find((widget) => widget.name === "裁剪开始");
            const endWidget = node.widgets?.find((widget) => widget.name === "裁剪结束");
            if (!folderWidget || !videoWidget || !startWidget || !endWidget) return;

            const preview = document.createElement("div");
            preview.className = "video-folder-loader-preview";
            const player = document.createElement("video");
            player.controls = true;
            player.preload = "metadata";
            player.playsInline = true;
            preview.appendChild(player);

            const timeline = document.createElement("div");
            timeline.className = "video-folder-loader-timeline";
            const track = document.createElement("div");
            track.className = "video-folder-loader-track";
            const selected = document.createElement("div");
            selected.className = "video-folder-loader-selected";
            const leftMask = document.createElement("div");
            leftMask.className = "video-folder-loader-mask";
            const rightMask = document.createElement("div");
            rightMask.className = "video-folder-loader-mask";
            const leftHandle = document.createElement("div");
            leftHandle.className = "video-folder-loader-handle";
            const rightHandle = document.createElement("div");
            rightHandle.className = "video-folder-loader-handle";
            timeline.append(track, leftMask, selected, rightMask, leftHandle, rightHandle);
            preview.appendChild(timeline);

            const timeInfo = document.createElement("div");
            timeInfo.className = "video-folder-loader-time";
            const playbackInfo = document.createElement("span");
            const outputInfo = document.createElement("span");
            const durationInfo = document.createElement("span");
            timeInfo.append(playbackInfo, outputInfo, durationInfo);
            preview.appendChild(timeInfo);
            const metaInfo = document.createElement("div");
            metaInfo.className = "video-folder-loader-meta";
            metaInfo.textContent = "视频信息：等待读取";
            preview.appendChild(metaInfo);

            node.addDOMWidget("视频播放器", "video-preview", preview, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => 310,
                getMaxHeight: () => 310,
            });

            const fileInput = createFileInput();
            let duration = 0;
            let refreshTimer = null;
            let refreshVersion = 0;
            let infoVersion = 0;
            let dragging = null;
            let previewRange = null;
            let lastFileKey = "";

            // Older versions of this node used the first widget as a root-level
            // file selector. Migrate those saved widget values after the new
            // folder + file layout has been created.
            if (isVideoFilename(folderWidget.value) && Number.isFinite(Number(videoWidget.value))) {
                const legacyFile = String(folderWidget.value);
                const legacyStart = Number(startWidget.value);
                const legacyEnd = Number(endWidget.value);
                folderWidget.value = "video";
                videoWidget.value = legacyFile;
                startWidget.value = Number.isFinite(legacyStart) ? legacyStart : 0;
                endWidget.value = Number.isFinite(legacyEnd) && legacyEnd >= 0 ? legacyEnd : -1;
            }

            const getRange = () => {
                if (previewRange) return { ...previewRange };
                const rawStart = Number(startWidget.value);
                const rawEnd = Number(endWidget.value);
                let start = Number.isFinite(rawStart) ? rawStart : 0;
                let end = Number.isFinite(rawEnd) && rawEnd >= 0 ? rawEnd : duration;
                if (duration > 0) {
                    start = Math.max(0, Math.min(start, duration));
                    end = Math.max(0, Math.min(end, duration));
                }
                if (end <= start) { start = 0; end = duration; }
                return { start, end };
            };

            const setWidgetValue = (widget, value) => {
                widget.value = Number(value.toFixed(2));
                widget.callback?.(widget.value);
            };

            const commitRange = (start, end) => {
                if (!(duration > 0)) return;
                start = Math.max(0, Math.min(start, duration));
                end = Math.max(0, Math.min(end, duration));
                if (end <= start) return;
                setWidgetValue(startWidget, start);
                setWidgetValue(endWidget, end);
                node.setDirtyCanvas?.(true, true);
            };

            const updateTimeline = () => {
                const range = getRange();
                const scale = duration > 0 ? 100 / duration : 0;
                const left = range.start * scale;
                const right = range.end * scale;
                leftMask.style.left = "0%";
                leftMask.style.width = `${left}%`;
                selected.style.left = `${left}%`;
                selected.style.width = `${Math.max(0, right - left)}%`;
                rightMask.style.left = `${right}%`;
                rightMask.style.right = "0%";
                leftHandle.style.left = `${left}%`;
                rightHandle.style.left = `${right}%`;
                const relative = Math.max(0, Math.min((player.currentTime || range.start) - range.start, range.end - range.start));
                playbackInfo.textContent = `播放 ${formatTime(relative, true)} / ${formatTime(range.end - range.start, true)}`;
                outputInfo.textContent = `输出时长：${formatTime(range.end - range.start, true)}`;
                durationInfo.textContent = `原始时长：${formatTime(duration, true)}`;
            };

            const pauseAndClamp = () => {
                const range = getRange();
                player.pause();
                if (Number.isFinite(player.currentTime)) player.currentTime = Math.max(range.start, Math.min(player.currentTime, range.end));
                updateTimeline();
            };

            const updatePreview = () => {
                player.pause();
                // Clear the old media element before assigning a new source.
                // This prevents the previous video's frame from remaining
                // visible when the combo value changes or is unloaded.
                player.removeAttribute("src");
                player.src = "";
                player.load();
                const selectedFile = String(videoWidget.value || "");
                const fileKey = `${folderWidget.value || ""}/${selectedFile}`;
                if (lastFileKey && fileKey !== lastFileKey) {
                    setWidgetValue(startWidget, 0);
                    setWidgetValue(endWidget, -1);
                }
                lastFileKey = fileKey;
                duration = 0;
                const currentInfoVersion = ++infoVersion;
                metaInfo.textContent = "视频信息：读取中";
                if (selectedFile && selectedFile !== EMPTY_OPTION) {
                    player.src = videoUrl(folderWidget.value, selectedFile);
                    player.load();
                }
                if (selectedFile && selectedFile !== EMPTY_OPTION) {
                    const query = new URLSearchParams({ folder: String(folderWidget.value || ""), file: selectedFile });
                    api.fetchApi(`/video-folder-loader/info?${query}`)
                        .then((response) => response.json().then((payload) => ({ response, payload })))
                        .then(({ response, payload }) => {
                            if (currentInfoVersion !== infoVersion) return;
                            if (!response.ok) throw new Error(payload.error || "读取视频信息失败");
                            const width = Number(payload.width) || 0;
                            const height = Number(payload.height) || 0;
                            const fps = Number(payload.fps) || 0;
                            const frames = Number(payload.frames) || 0;
                            metaInfo.textContent = `视频信息：${width}×${height} | ${fps.toFixed(2)} FPS | ${frames} 帧`;
                        })
                        .catch((error) => {
                            if (currentInfoVersion === infoVersion) metaInfo.textContent = `视频信息：读取失败（${error.message || error}）`;
                        });
                } else {
                    metaInfo.textContent = "视频信息：未选择视频";
                }
                updateTimeline();
            };

            const refreshDuration = () => {
                duration = Number.isFinite(player.duration) ? Math.max(0, player.duration) : 0;
                if (duration > 0) {
                    startWidget.options.max = duration;
                    endWidget.options.max = duration;
                    const range = getRange();
                    commitRange(range.start, range.end);
                }
                updateTimeline();
            };

            const positionFromPointer = (event) => {
                const rect = timeline.getBoundingClientRect();
                return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
            };

            const moveHandle = (event) => {
                if (!dragging || !(duration > 0)) return;
                const range = getRange();
                const value = positionFromPointer(event);
                if (dragging === "start") range.start = Math.min(value, range.end - 0.01);
                else range.end = Math.max(value, range.start + 0.01);
                previewRange = range;
                pauseAndClamp();
                updateTimeline();
            };

            const finishDrag = () => {
                if (!dragging) return;
                const range = getRange();
                commitRange(range.start, range.end);
                previewRange = null;
                dragging = null;
                window.removeEventListener("pointermove", moveHandle);
                window.removeEventListener("pointerup", finishDrag);
            };

            const beginDrag = (which, event) => {
                if (!(duration > 0)) return;
                event.preventDefault();
                dragging = which;
                previewRange = getRange();
                pauseAndClamp();
                window.addEventListener("pointermove", moveHandle);
                window.addEventListener("pointerup", finishDrag);
            };
            leftHandle.addEventListener("pointerdown", (event) => beginDrag("start", event));
            rightHandle.addEventListener("pointerdown", (event) => beginDrag("end", event));

            player.addEventListener("loadedmetadata", refreshDuration);
            player.addEventListener("timeupdate", () => {
                const range = getRange();
                if (player.currentTime >= range.end && !player.paused) { player.pause(); player.currentTime = range.end; }
                updateTimeline();
            });
            player.addEventListener("play", () => {
                const range = getRange();
                if (player.currentTime < range.start || player.currentTime >= range.end) player.currentTime = range.start;
                updateTimeline();
            });
            player.addEventListener("seeking", () => {
                const range = getRange();
                if (player.currentTime < range.start || player.currentTime > range.end) player.currentTime = Math.max(range.start, Math.min(player.currentTime, range.end));
                updateTimeline();
            });

            const refreshFiles = async (preferred = videoWidget.value) => {
                const version = ++refreshVersion;
                const query = new URLSearchParams({ folder: String(folderWidget.value || "") });
                const response = await api.fetchApi(`/video-folder-loader/files?${query}`);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || "读取视频文件夹失败");
                if (version !== refreshVersion) return;
                folderWidget.value = payload.folder;
                setComboValues(videoWidget, payload.files || [], preferred);
                updatePreview();
                node.setDirtyCanvas?.(true, true);
            };

            const uploadFile = async (file) => {
                if (!file || !VIDEO_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) { showError("请选择一个支持的视频文件"); return; }
                const formData = new FormData();
                formData.append("folder", String(folderWidget.value || ""));
                formData.append("files", file, file.name);
                try {
                    const payload = await uploadRequest(formData, (progress) => { node.progress = progress; node.setDirtyCanvas?.(true, true); });
                    node.progress = undefined;
                    folderWidget.value = payload.folder;
                    setComboValues(videoWidget, payload.files || [], payload.selected);
                    updatePreview();
                    node.setDirtyCanvas?.(true, true);
                } catch (error) { node.progress = undefined; showError(error); }
            };

            const uploadButton = node.addWidget("button", "选择要上传的视频文件", null, () => { fileInput.value = ""; fileInput.click(); });
            uploadButton.serialize = false;
            const refreshButton = node.addWidget("button", "刷新视频列表", null, () => refreshFiles(videoWidget.value).catch(showError));
            refreshButton.serialize = false;
            const unloadButton = node.addWidget("button", "卸载视频", null, () => {
                videoWidget.value = "";
                // Notify H3's Media watcher as well as the native widget UI.
                // Without this callback, the player clears but an already-open
                // @ menu can retain the old video until another graph action.
                videoWidget.callback?.(videoWidget.value);
                setWidgetValue(startWidget, 0);
                setWidgetValue(endWidget, -1);
                updatePreview();
                node.setDirtyCanvas?.(true, true);
                app.graph?.change?.();
            });
            unloadButton.serialize = false;
            fileInput.addEventListener("change", () => { const file = fileInput.files?.[0]; if (file) uploadFile(file); });

            const originalFolderCallback = folderWidget.callback;
            folderWidget.callback = function (value) {
                const result = originalFolderCallback?.call(this, value);
                clearTimeout(refreshTimer);
                refreshTimer = setTimeout(() => refreshFiles("").catch(showError), 250);
                return result;
            };
            const originalVideoCallback = videoWidget.callback;
            videoWidget.callback = function (value) {
                const result = originalVideoCallback?.call(this, value);
                // Let the native combo commit its value before reading it.
                setTimeout(updatePreview, 0);
                return result;
            };
            const originalStartCallback = startWidget.callback;
            startWidget.callback = function (value) { const result = originalStartCallback?.call(this, value); pauseAndClamp(); return result; };
            const originalEndCallback = endWidget.callback;
            endWidget.callback = function (value) { const result = originalEndCallback?.call(this, value); pauseAndClamp(); return result; };

            chainCallback(node, "onConfigure", function () { setTimeout(() => refreshFiles(videoWidget.value).catch(showError), 0); });
            chainCallback(node, "onRemoved", function () {
                clearTimeout(refreshTimer);
                player.pause();
                window.removeEventListener("pointermove", moveHandle);
                window.removeEventListener("pointerup", finishDrag);
                fileInput.remove();
            });

            node.setSize([Math.max(node.size?.[0] || 0, 520), Math.max(node.size?.[1] || 0, 430)]);
            setTimeout(() => refreshFiles(videoWidget.value).catch(showError), 0);
        });
    },
});
