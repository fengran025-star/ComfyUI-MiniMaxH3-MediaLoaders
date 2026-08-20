import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "AudioFolderLoader";
const EMPTY_OPTION = "（当前文件夹没有音频）";
const AUDIO_EXTENSIONS = [
    ".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".oga",
    ".ogg", ".opus", ".wav", ".webm", ".wma",
];

function chainCallback(object, property, callback) {
    const original = object[property];
    object[property] = function (...args) {
        const result = original?.apply(this, args);
        return callback.apply(this, args) ?? result;
    };
}

function ensureStyles() {
    if (document.getElementById("audio-folder-loader-styles")) return;
    const style = document.createElement("style");
    style.id = "audio-folder-loader-styles";
    style.textContent = `
        .audio-folder-loader-preview { box-sizing: border-box; width: 100%; padding: 8px 6px 4px; color: var(--input-text, #ddd); }
        .audio-folder-loader-preview audio { display: block; width: 100%; height: 42px; }
        .audio-folder-loader-timeline { position: relative; height: 34px; margin: 5px 5px 0; cursor: pointer; user-select: none; touch-action: none; }
        .audio-folder-loader-track { position: absolute; left: 0; right: 0; top: 11px; height: 10px; border-radius: 3px; background: var(--comfy-input-bg, #333); border: 1px solid #666; }
        .audio-folder-loader-selected { position: absolute; top: 0; bottom: 0; background: rgba(105, 170, 220, .28); }
        .audio-folder-loader-mask { position: absolute; top: 0; bottom: 0; background: rgba(0, 0, 0, .28); pointer-events: none; }
        .audio-folder-loader-handle { position: absolute; top: 0; width: 3px; height: 32px; margin-left: -1px; background: #8ed0ff; border: 1px solid #d9f2ff; border-radius: 1px; cursor: ew-resize; z-index: 2; box-sizing: border-box; }
        .audio-folder-loader-time { display: flex; justify-content: space-between; gap: 6px; margin: 0 6px; font-size: 11px; line-height: 16px; color: var(--descrip-text, #aaa); white-space: nowrap; }
        .audio-folder-loader-time span { overflow: hidden; text-overflow: ellipsis; }
    `;
    document.head.appendChild(style);
}

function audioUrl(folder, file) {
    const query = new URLSearchParams({ folder: folder || "", file: file || "" });
    return api.apiURL(`/audio-folder-loader/view?${query}`);
}

function showError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (app.ui?.dialog?.show) app.ui.dialog.show(message); else alert(message);
}

function setComboValues(widget, files, preferred = "") {
    const values = files.length ? files : [EMPTY_OPTION];
    // Keep an actual empty selection whenever this folder has audio files.
    // Without it, an unloaded node is forced back to values[0] when its
    // workflow is restored or its file list is refreshed.
    const selectable = files.length && preferred === "" ? ["", ...values] : values;
    widget.options ??= {};
    widget.options.values = selectable;
    widget.value = selectable.includes(preferred) ? preferred : selectable[0];
}

function createFileInput() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = AUDIO_EXTENSIONS.join(",");
    input.multiple = false;
    input.style.display = "none";
    document.body.appendChild(input);
    return input;
}

function uploadRequest(formData, onProgress) {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", api.apiURL("/audio-folder-loader/upload"), true);
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
    name: "ComfyUI.AudioFolderLoader",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        chainCallback(nodeType.prototype, "onNodeCreated", function () {
            ensureStyles();
            const node = this;
            const folderWidget = node.widgets?.find((widget) => widget.name === "音频文件夹");
            const audioWidget = node.widgets?.find((widget) => widget.name === "选择音频");
            const startWidget = node.widgets?.find((widget) => widget.name === "裁剪开始");
            const endWidget = node.widgets?.find((widget) => widget.name === "裁剪结束");
            if (!folderWidget || !audioWidget || !startWidget || !endWidget) return;

            const preview = document.createElement("div");
            preview.className = "audio-folder-loader-preview";
            const player = document.createElement("audio");
            player.controls = true;
            player.preload = "metadata";
            preview.appendChild(player);

            const timeline = document.createElement("div");
            timeline.className = "audio-folder-loader-timeline";
            const track = document.createElement("div");
            track.className = "audio-folder-loader-track";
            const selected = document.createElement("div");
            selected.className = "audio-folder-loader-selected";
            const leftMask = document.createElement("div");
            leftMask.className = "audio-folder-loader-mask";
            const rightMask = document.createElement("div");
            rightMask.className = "audio-folder-loader-mask";
            const leftHandle = document.createElement("div");
            leftHandle.className = "audio-folder-loader-handle";
            const rightHandle = document.createElement("div");
            rightHandle.className = "audio-folder-loader-handle";
            timeline.append(track, leftMask, selected, rightMask, leftHandle, rightHandle);
            preview.appendChild(timeline);

            const timeInfo = document.createElement("div");
            timeInfo.className = "audio-folder-loader-time";
            const playbackInfo = document.createElement("span");
            const outputInfo = document.createElement("span");
            const durationInfo = document.createElement("span");
            timeInfo.append(playbackInfo, outputInfo, durationInfo);
            preview.appendChild(timeInfo);

            node.addDOMWidget("播放器", "audio-preview", preview, {
                serialize: false,
                hideOnZoom: false,
                getMinHeight: () => 116,
                getMaxHeight: () => 116,
            });

            const fileInput = createFileInput();
            let duration = 0;
            let refreshTimer = null;
            let refreshVersion = 0;
            let dragging = null;
            let previewRange = null;
            let lastFileKey = "";

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

            const setRangeForNewFile = () => {
                setWidgetValue(startWidget, 0);
                setWidgetValue(endWidget, -1);
            };

            const updatePreview = (resetRange = false) => {
                player.pause();
                // Explicitly discard the old media before loading a new file
                // or the empty/unloaded state.
                player.removeAttribute("src");
                player.src = "";
                player.load();
                const selectedFile = String(audioWidget.value || "");
                const fileKey = `${folderWidget.value || ""}/${selectedFile}`;
                if (resetRange && fileKey !== lastFileKey) setRangeForNewFile();
                lastFileKey = fileKey;
                duration = 0;
                if (selectedFile && selectedFile !== EMPTY_OPTION) {
                    player.src = audioUrl(folderWidget.value, selectedFile);
                    player.load();
                }
                updateTimeline();
            };

            const refreshDuration = () => {
                duration = Number.isFinite(player.duration) ? Math.max(0, player.duration) : 0;
                if (duration > 0) {
                    // Keep the numeric widgets bounded by the currently loaded file,
                    // instead of the generic 24-hour safety limit from INPUT_TYPES.
                    startWidget.options.max = duration;
                    endWidget.options.max = duration;
                }
                const range = getRange();
                if (duration > 0) commitRange(range.start, range.end);
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

            const refreshFiles = async (preferred = audioWidget.value) => {
                const version = ++refreshVersion;
                const query = new URLSearchParams({ folder: String(folderWidget.value || "") });
                const response = await api.fetchApi(`/audio-folder-loader/files?${query}`);
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || "读取音频文件夹失败");
                if (version !== refreshVersion) return;
                folderWidget.value = payload.folder;
                setComboValues(audioWidget, payload.files || [], preferred);
                updatePreview(false);
                node.setDirtyCanvas?.(true, true);
            };

            const uploadFile = async (file) => {
                if (!file || !AUDIO_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) { showError("请选择一个支持的音频文件"); return; }
                const formData = new FormData();
                formData.append("folder", String(folderWidget.value || ""));
                formData.append("files", file, file.name);
                try {
                    const payload = await uploadRequest(formData, (progress) => { node.progress = progress; node.setDirtyCanvas?.(true, true); });
                    node.progress = undefined;
                    folderWidget.value = payload.folder;
                    setComboValues(audioWidget, payload.files || [], payload.selected);
                    updatePreview(true);
                    node.setDirtyCanvas?.(true, true);
                } catch (error) { node.progress = undefined; showError(error); }
            };

            const uploadButton = node.addWidget("button", "上传音频文件", null, () => { fileInput.value = ""; fileInput.click(); });
            uploadButton.serialize = false;
            const refreshButton = node.addWidget("button", "刷新音频列表", null, () => refreshFiles(audioWidget.value).catch(showError));
            refreshButton.serialize = false;
            const unloadButton = node.addWidget("button", "卸载音频", null, () => {
                audioWidget.value = "";
                // Notify the H3 Media watcher so this audio disappears from
                // the @ menu and is not queued as a media_N input.
                audioWidget.callback?.(audioWidget.value);
                setRangeForNewFile();
                updatePreview(false);
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
            const originalAudioCallback = audioWidget.callback;
            audioWidget.callback = function (value) {
                const result = originalAudioCallback?.call(this, value);
                updatePreview(true);
                return result;
            };
            const originalStartCallback = startWidget.callback;
            startWidget.callback = function (value) { const result = originalStartCallback?.call(this, value); pauseAndClamp(); return result; };
            const originalEndCallback = endWidget.callback;
            endWidget.callback = function (value) { const result = originalEndCallback?.call(this, value); pauseAndClamp(); return result; };

            chainCallback(node, "onConfigure", function () { setTimeout(() => refreshFiles(audioWidget.value).catch(showError), 0); });
            chainCallback(node, "onRemoved", function () {
                clearTimeout(refreshTimer);
                player.pause();
                window.removeEventListener("pointermove", moveHandle);
                window.removeEventListener("pointerup", finishDrag);
                fileInput.remove();
            });

            node.setSize([Math.max(node.size?.[0] || 0, 430), Math.max(node.size?.[1] || 0, 305)]);
            setTimeout(() => refreshFiles(audioWidget.value).catch(showError), 0);
        });
    },
});
