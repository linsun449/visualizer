import base64, io
import json
import numpy as np

try:
    import torch
    from PIL import Image
except ImportError:
    torch = None
    Image = None

def to_numpy(obj):
    if torch and isinstance(obj, torch.Tensor):
        return obj.detach().cpu().numpy()
    if isinstance(obj, np.ndarray):
        return obj
    if Image and isinstance(obj, Image.Image):
        return np.array(obj)
    raise TypeError(f"Unsupported type: {type(obj)}")

def encode_base64(arr):
    raw_bytes = arr.tobytes()
    b64_str = base64.b64encode(raw_bytes).decode('utf-8')
    meta = {
        "shape": arr.shape,
        "dtype": str(arr.dtype)
    }
    meta_str = json.dumps(meta)
    return b64_str, meta_str

def save(expr, out_data_path, out_meta_path):
    try:
        arr = to_numpy(expr)
        assert arr.ndim <= 3, f"Unsupported dim: the dims of data must be no more than 3, now is {arr.ndim}"
        encoded, meta_str = encode_base64(arr)
        with open(out_data_path, "w", encoding="utf-8") as f:
            f.write(encoded)
        with open(out_meta_path, "w", encoding="utf-8") as f:
            f.write(meta_str)
        return "OK"
    except Exception as e:
        return "ERROR: " + str(e)
