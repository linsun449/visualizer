import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import jpeg from "jpeg-js";
import imageType from 'image-type';
import decodeBmp from "decode-bmp";

const tiff = require("tiff");
const { PNG } = require("pngjs");


export function activate(context: vscode.ExtensionContext) {

  const disposable_var = vscode.commands.registerCommand('visualize.debugVariable', async (variableItem?: any) => {
    let variableName: string | undefined;

    if (variableItem) variableName = variableItem?.variable?.evaluateName;

    if (!variableName && vscode.window.activeTextEditor) {
      const editor = vscode.window.activeTextEditor;
      const selection = editor.selection;
      variableName = editor.document.getText(selection).trim();
    }

    if (!variableName) {
      variableName = await vscode.window.showInputBox({
        prompt: 'Enter expression to visualize',
        placeHolder: 'variable name'
      });
    }

    if (!variableName) {
      vscode.window.showErrorMessage('No variable selected.');
      return;
    }

    const session = vscode.debug.activeDebugSession;
    if (!session) {
      vscode.window.showErrorMessage('No active debug session found.');
      return;
    }

    try {
      const threads = await session.customRequest('threads');
      const threadId = threads.threads?.[0]?.id;
      if (!threadId) throw new Error('No threads found');

      const stackTrace = await session.customRequest('stackTrace', { threadId, startFrame: 0, levels: 1 });
      const frameId = stackTrace.stackFrames?.[0]?.id;
      if (!frameId) throw new Error('No stack frame found');

      const tempDir = path.join(context.extensionPath, 'temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const pyScript = path.join(context.extensionPath, 'python');
      const outputDataPath = path.join(tempDir, 'data.b64');
      const outputMetaPath = path.join(tempDir, 'meta.json');
     
      const expr = `
      __import__('sys').path.append(r"${pyScript}") or __import__('save_data').save(${variableName}, r"${outputDataPath}", r"${outputMetaPath}")
      `
      const res = await session.customRequest('evaluate', {
        expression: expr,
        frameId,
        context: 'repl'});

      if (res?.result?.includes('OK')) {
        const content = fs.readFileSync(outputDataPath, 'utf-8');
        const metaStr = fs.readFileSync(outputMetaPath, 'utf-8');
        const meta = JSON.parse(metaStr);
        openViewer(context, content, variableName, meta);
      } else {
        vscode.window.showErrorMessage(`Failed: ${res?.result}`);
      }
      

    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to evaluate variable: ${err.message || err}`);
    }
  });

  const disposable_img = vscode.commands.registerCommand("visualize.visualizeImage", async (uri: vscode.Uri) => {
      if (!uri) {
        vscode.window.showErrorMessage("No image selected.");
        return;
      }
      const filePath = uri.fsPath;
      try {
        const res = await loadImageBuffer(filePath);
        const meta = {dtype: "uint8", shape: [res.shape[0], res.shape[1], res.shape[2]]};
        openViewer(context, res.data.toString("base64"), path.basename(filePath), meta);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to read image: ${err.message || err}`);
      }
    }
  );
  context.subscriptions.push(disposable_var);
  context.subscriptions.push(disposable_img);
}

export async function loadImageBuffer(path: string) {
  const buffer = fs.readFileSync(path);

  const info = imageType(buffer);
  const mime = info ? info.mime : "error";

  if (mime === "image/jpeg" || /jpeg|jpg$/i.test(mime)) {
    const decoded = jpeg.decode(buffer, { useTArray: true }) as {
      width: number;
      height: number;
      data: Uint8Array;
    };
    return {data: Buffer.from(decoded.data), shape:[decoded.height, decoded.width, 4] };
  }
  if (mime === "image/png" || /png$/i.test(mime)) {
    const png = PNG.sync.read(buffer);
    return {data: Buffer.from(png.data), shape:[png.height, png.width, 4] };
  }

  if (mime.includes("tiff") || /tif|tiff$/i.test(mime)) {
    const buffer = fs.readFileSync(path);
    const ifds = tiff.decode(buffer);
    const first = ifds[0];
    if (!first) throw new Error("No TIFF image found");
    const width = first.width as number;
    const height = first.height as number;
    return {data: Buffer.from(first.data), shape:[height, width, 4] };
  }

  if (mime === "image/bmp" || /bmp$/i.test(mime)) {
    const bmpObj = decodeBmp(buffer);
    return {data: Buffer.from(bmpObj.data), shape:[bmpObj.height, bmpObj.width, 4]};
  }
  throw new Error("Unsupported image format or unknown mime: " + mime);
}


function openViewer(context: vscode.ExtensionContext, base64Data: string, variableName: string, meta:any) {
  const panel = vscode.window.createWebviewPanel(
    'visualizeData', `${variableName}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))]
    }
  );
  const htmlFile = path.join(context.extensionPath, 'webview', 'viewer.html');
  let html = fs.readFileSync(htmlFile, 'utf8');
  
  const switchUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'switch.css')));
  const spbtnUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'spbtn.css')));
  const dlbtnUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'dlbtn.css')));
  const cardUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'card.css')));

  html = html.replace(/href="switch\.css"/g, `href="${switchUri}"`);
  html = html.replace(/href="spbtn\.css"/g, `href="${spbtnUri}"`);
  html = html.replace(/href="dlbtn\.css"/g, `href="${dlbtnUri}"`);
  html = html.replace(/href="card\.css"/g, `href="${cardUri}"`);

  panel.webview.html = html;

  panel.webview.onDidReceiveMessage(message => {
  switch (message.command) {
    case 'showInfo':
      vscode.window.showInformationMessage(message.text);
      break;
    case 'showError':
      vscode.window.showErrorMessage(message.text);
      break;
    case 'ready':
      panel.webview.postMessage({
        type: 'payload',
        data: base64Data,
        variableName,  
        meta: meta
      });
      break;
  }
});

}


export function deactivate() {}
