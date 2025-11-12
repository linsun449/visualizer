import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {

  const disposable = vscode.commands.registerCommand('visualize.debugVariable', async (variableItem?: any) => {
    let variableName: string | undefined;

    if (variableItem) {
      variableName = variableItem?.variable?.evaluateName;
    }

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
      vscode.window.showErrorMessage('Please select or right-click a variable.');
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

      const pyScript = path.join(context.extensionPath, 'python');
      const outputDataPath = path.join(context.extensionPath, 'temp', 'data.b64');
      const outputMetaPath = path.join(context.extensionPath, 'temp', 'meta.json');
     
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

  context.subscriptions.push(disposable);
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
