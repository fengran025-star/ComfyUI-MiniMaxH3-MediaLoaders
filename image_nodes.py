"""MiniMax H3 image loader with an explicit unloaded state."""

import nodes


class MiniMaxH3LoadImage(nodes.LoadImage):
    """Native-style image loader that can return a genuine empty output."""

    # LoadImage is a built-in Essentials node.  Without shadowing this
    # inherited marker, ComfyUI's node library forcibly lists our custom
    # subclass under "COMFY 节点" instead of the extension category.
    ESSENTIALS_CATEGORY = None
    CATEGORY = "MiniMax H3 文件加载器"
    DESCRIPTION = "类似原生 LoadImage，但增加卸载图片按钮；卸载后文件名和 IMAGE/MASK 输出为空。"
    SEARCH_ALIASES = ["load image", "open image", "upload image", "卸载图片"]

    def load_image(self, image):
        if not str(image or "").strip():
            return (None, None)
        return super().load_image(image)

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        if not str(image or "").strip():
            return True
        return super().VALIDATE_INPUTS(image)

    @classmethod
    def IS_CHANGED(cls, image):
        if not str(image or "").strip():
            return "empty"
        return super().IS_CHANGED(image)


IMAGE_NODE_CLASS_MAPPINGS = {
    "MiniMaxH3LoadImage": MiniMaxH3LoadImage,
}

IMAGE_NODE_DISPLAY_NAME_MAPPINGS = {
    "MiniMaxH3LoadImage": "MiniMax H3 图片加载器",
}
