import sys

_patch_state_vsce = {}

def replace():
    if 'numpy' in sys.modules:
        import numpy.core.arrayprint as ap
        if 'numpy_patched' not in _patch_state_vsce:
            try:
                # 保存原始函数
                _patch_state_vsce['np_original_array2string'] = ap.array2string

                def custom_array2string(arr, *args, **kwargs):
                    shape_str = str(arr.shape)
                    dtype_str = str(arr.dtype)
                    return f'ndarray(shape={shape_str}, dtype="{dtype_str}")'

                ap.array2string = custom_array2string
                _patch_state_vsce['numpy_patched'] = True

            except Exception as e:
                print(f"Error applying NumPy patch: {e}", file=sys.stderr)

    if 'torch' in sys.modules:
        import torch

        if 'torch_patched' not in _patch_state_vsce:
            try:
                def custom_torch_repr(self):
                    shape_str = str(list(self.shape))
                    dtype_str = str(self.dtype).split('.')[-1]
                    return f"Tensor(shape={shape_str}, dtype={dtype_str}), {_patch_state_vsce['torch_original_repr'](self)}"

                _patch_state_vsce['torch_original_repr'] = torch.Tensor.__repr__
                torch.Tensor.__repr__ = custom_torch_repr

                _patch_state_vsce['torch_patched'] = True

            except Exception as e:
                print(f"Error applying Torch patch: {e}", file=sys.stderr)

    return "Variable display patch applied successfully."
