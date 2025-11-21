import path from 'path';
import * as vscode from 'vscode';

let patchApplied = false;
let currentFrame: vscode.DebugStackFrame | undefined = undefined;

export function replaceRepr(context: vscode.ExtensionContext, type: string) {
    console.log('Variable display enhancer is active.');
    const pyScript = path.join(context.extensionPath, 'python');
    const expression = `__import__('sys').path.append(r"${pyScript}") or __import__('format_array').replace()`;
    context.subscriptions.push(vscode.debug.onDidChangeActiveStackItem(stackItem => {
        if (stackItem instanceof vscode.DebugStackFrame) currentFrame = stackItem;
    }));
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(() => {currentFrame = undefined;}));
    context.subscriptions.push(vscode.debug.onDidChangeBreakpoints(() => {}));
    context.subscriptions.push(vscode.debug.onDidReceiveDebugSessionCustomEvent(e => {
        if (e.event === 'continued') currentFrame = undefined;
    }));

    context.subscriptions.push(
      vscode.debug.registerDebugAdapterTrackerFactory(type, {
        createDebugAdapterTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker {
          return {
            async onDidSendMessage(msg: any) {
              if (session.type !== type || patchApplied) return;
              if (msg.type === 'event' && msg.event === 'stopped') {
                try {
                  const result = await session.customRequest('evaluate', {
                      expression, currentFrame, context: 'repl'
                  });
                  console.log('[Variable Enhancer] Patch result:', result?.result);
                  patchApplied = true;

                } catch (e) {
                  console.error("Patch failed:", e);
                }
              }
            },

            onWillStopSession() {
                patchApplied = false;
            }
          };
        }
      })
    );
}
