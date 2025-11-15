# VS Code 图像数据可视化插件

## 插件概述

本插件用于在 VS Code 中可视化显示多维数组（NumPy, Tensor）、图像文件。

---

## 主要功能

- **多通道数据支持**
- **数据格式兼容**
- **归一化显示**  
- **伪彩色映射**  
- **缩放与拖拽**
- **像素值查看**
- **数据统计信息**
- **导出与复制**
---

## 源码安装说明

### 1. 克隆源码仓库
```bash
git clone https://github.com/your-repo/image-data-visualizer.git
cd visualizer
```
### 2. 安装依赖
```bash
# 确保已安装 Node.js
npm install
npm install jpeg-js image-type decode-bmp tiff pngjs
```
### 3. 编译打包插件
```bash
npm run build
npm run package
# 生成的 .vsix 文件可通过 VS Code 扩展面板“从 VSIX 安装...”进行安装。
```
**手动安装**：直接从 [Release 页面](https://github.com/linsun449/visualizer/releases) 下载 `.vsix` 文件，然后在 VS Code 中通过“扩展”侧栏右上角的“···”菜单选择“从 VSIX 安装...”进行安装。

## 使用方法

### 1.在editor中打开

<img src="asset/editor_in.png" width="70%">

### 2.在watch监控中打开
<img src="asset/watch_in.png" width="70%">

### 3.在顶部手动输入表达式
<img src="asset/input_in1.png" width="70%">

<img src="asset/input_in2.png" width="70%">

### 4.右击图像文件直接打开
<img src="asset/file_in.png" width="70%">

<img src="asset/title_in.png" width="70%">