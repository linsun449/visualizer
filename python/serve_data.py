#!/usr/bin/env python3
import argparse, json, sys, os
import base64
from io import BytesIO

def to_base64_png_pil(img):
    buf = BytesIO()
    img.save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode('ascii')

def handle_image(path):
    from PIL import Image
    img = Image.open(path).convert('RGBA')
    b64 = to_base64_png_pil(img)
    return {"type":"image", "format":"png", "base64":b64, "shape": img.size[::-1]}

def handle_npy(path):
    import numpy as np
    arr = np.load(path)
    return tensor_payload_from_array(arr)

def tensor_payload_from_array(arr):
    import numpy as np
    # 确保是 numpy array
    arr = np.asarray(arr)
    shape = arr.shape
    dtype = str(arr.dtype)
    # 为了速度/显示，若是多维且是图像形状 (H,W,3/4) -> 转图片
    if arr.ndim == 3 and arr.shape[2] in (3,4):
        from PIL import Image
        a = arr
        # 如果 dtype 不是 uint8，归一化到 0-255
        if a.dtype != np.uint8:
            a_min = a.min()
            a_max = a.max()
            if a_max - a_min > 0:
                a = ((a - a_min) / (a_max - a_min) * 255).astype('uint8')
            else:
                a = (a*0).astype('uint8')
        img = Image.fromarray(a)
        return {"type":"image", "format":"png", "base64": to_base64_png_pil(img), "shape": img.size[::-1], "origin":"npy"}
    # 否则作为 tensor：降采样到最大边 256 展示
    max_dim = 256
    h = arr.shape[-2] if arr.ndim >= 2 else 1
    w = arr.shape[-1] if arr.ndim >= 2 else 1
    scale = max(1, max(h,w)/max_dim)
    if scale>1:
        # 简单降采样 by slicing (更好可用 skimage)
        import numpy as np
        new_h = max(1, int(h/scale))
        new_w = max(1, int(w/scale))
        # 使用 numpy 的 reshape stride trick 可能复杂，先用 simple resize via PIL if 2D
        if arr.ndim >=2:
            from PIL import Image
            # convert to float image for resample
            a = arr
            # normalize to 0-255
            amin=a.min(); amax=a.max()
            if amax-amin>0:
                norm = ((a - amin)/(amax-amin)*255).astype('uint8')
            else:
                norm = (a*0).astype('uint8')
            if arr.ndim==2:
                img = Image.fromarray(norm)
            else:
                # for >2 dims, take first channel or mean
                img = Image.fromarray(norm[...,0])
            img = img.resize((new_w, new_h))
            arr_small = np.array(img)
        else:
            arr_small = arr
    else:
        arr_small = arr

    # Convert to list (careful size)
    small_list = arr_small.tolist()
    return {"type":"tensor", "shape": shape, "dtype": dtype, "data": small_list}

def handle_torch(path):
    try:
        import torch
    except Exception as e:
        print(json.dumps({"error":"torch not installed"}))
        sys.exit(1)
    obj = torch.load(path, map_location='cpu')
    # If it's tensor, convert
    import numpy as np
    if hasattr(obj, 'numpy'):
        arr = obj.numpy()
    else:
        # try to find a tensor inside dict
        if isinstance(obj, dict):
            for k,v in obj.items():
                if hasattr(v, 'numpy'):
                    arr = v.numpy(); break
            else:
                arr = None
        else:
            arr = None
    if arr is None:
        print(json.dumps({"error":"no tensor found in file"}))
        sys.exit(1)
    return tensor_payload_from_array(arr)

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--file', required=True)
    args = p.parse_args()
    path = args.file
    ext = os.path.splitext(path.lower())[1]

    try:
        if ext in ('.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff'):
            out = handle_image(path)
        elif ext in ('.npy',):
            out = handle_npy(path)
        elif ext in ('.pt', '.pth',):
            out = handle_torch(path)
        else:
            # 尝试用 PIL open，如果失败再试numpy load
            try:
                out = handle_image(path)
            except Exception:
                try:
                    out = handle_npy(path)
                except Exception as e:
                    out = {"error":"unsupported format", "exception": str(e)}
    except Exception as e:
        out = {"error":"exception","exception":str(e)}

    print(json.dumps(out))

if __name__ == '__main__':
    main()
