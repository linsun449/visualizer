import * as vscode from "vscode";

let currentFrame: vscode.DebugStackFrame | undefined = undefined;

interface VariableDetail {
  shape?: string;
  type?: string;
  value?: string;
  dtype?: string;
}

export class WatchVariableItem extends vscode.TreeItem {
  constructor(
    public readonly variableInfo: any,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly detail?: VariableDetail
  ) {
    super(variableInfo.name, collapsibleState);
    this.iconPath = new vscode.ThemeIcon('symbol-variable');
    if (detail) {
      this.description = ` = ${detail?.type}([${detail?.shape}], dtype=${detail.dtype})`;
      this.tooltip = new vscode.MarkdownString(`**Evaluate Result:**\n\n\`\`\`text\n${detail?.value}\n\`\`\``);
    } else {
      this.description = WatchVariableItem.formatShort(variableInfo.value);
      this.tooltip = this.createTooltip();
    }
  }

  static formatShort(v: any): string {
    if (v == null) return "null";
    const s = String(v).trim();
    if (s.length > 40) return s.slice(0, 40) + "…";
    return s;
  }

  private createTooltip(): vscode.MarkdownString {
    const v = this.variableInfo;
    const m = new vscode.MarkdownString(undefined, true);
    m.isTrusted = true;
    m.appendMarkdown(`### 🔍 **${v.name}**\n\n`);
    if (v.type) {
      m.appendMarkdown(`**Type:** \`${v.type}\`\n\n`);
    }
    m.appendMarkdown(
      `**Value:**\n\`\`\`text\n${WatchVariableItem.formatShort(v.value)}\n\`\`\`\n`
    );
    if (v.variablesReference > 0) {
      m.appendMarkdown(`---\n🔗 Has **${v.children?.length ?? "multiple"}** sub-variables.`);
    }
    return m;
  }
}

export class WatchVariableProvider implements vscode.TreeDataProvider<WatchVariableItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<WatchVariableItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private currentVariables: any[] = [];
  private variableDetailsCache = new Map<string, VariableDetail>();

  constructor() {}

  async refresh() {
    try {
      const session = vscode.debug.activeDebugSession;
      if (!session || !currentFrame?.frameId) {
        this.currentVariables = [];
        this.variableDetailsCache.clear();
        this._onDidChangeTreeData.fire(undefined);
        return;
      }

      const scopesRes = await session.customRequest("scopes", {frameId: currentFrame.frameId});

      const locals = scopesRes.scopes.find((s: any) => s.name.toLowerCase().includes("local"));

      if (!locals) {
        this.currentVariables = [];
        this.variableDetailsCache.clear();
        this._onDidChangeTreeData.fire(undefined);
        return;
      }

      const varsRes = await session.customRequest("variables", {
        variablesReference: locals.variablesReference,
      });

      this.currentVariables = varsRes.variables || [];
      this.variableDetailsCache.clear();

      for (const v of this.currentVariables) 
        this.loadVariableDetail(session, v);

      this._onDidChangeTreeData.fire(undefined);
    } catch (err) {
      this.currentVariables = [];
      this.variableDetailsCache.clear();
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  private async loadVariableDetail(session: vscode.DebugSession, variable: any) {
    try {
        const expr = `
        (lambda v: __import__('json').dumps({
            "type": type(v).__name__.capitalize(),
            "dtype": str(v.dtype) if hasattr(v, 'shape') else 'N/A',
            "shape": list(v.shape) if hasattr(v, 'shape') else (len(v) if hasattr(v, '__len__') else 'N/A'),
            "value": str(v)
        }))( ${variable.name} )
        `;
      const evalRes = await session.customRequest("evaluate", {
        expression: expr,
        frameId: currentFrame?.frameId,
      });

      const detail = JSON.parse(evalRes.result.slice(1, -1));
      this.variableDetailsCache.set(variable.name, detail);
      // 只刷新这个变量的 TreeItem，简化触发刷新
      this._onDidChangeTreeData.fire(undefined);
    } catch (e) {
        console.error(e)
    }
  }

  getTreeItem(element: WatchVariableItem): vscode.TreeItem {
    const detail = this.variableDetailsCache.get(element.variableInfo.name);
    if (detail) {
      return new WatchVariableItem(element.variableInfo, element.collapsibleState, detail);
    }
    return element;
  }

  getChildren(element?: WatchVariableItem): Thenable<WatchVariableItem[]> {
    if (!element) {
      return Promise.resolve(
        this.currentVariables.map((v) => {
          const collapsible =
            v.variablesReference > 0
              ? vscode.TreeItemCollapsibleState.Collapsed
              : vscode.TreeItemCollapsibleState.None;
          return new WatchVariableItem(v, collapsible);
        })
      );
    }
    return this.loadChildren(element.variableInfo);
  }

  private async loadChildren(variable: any): Promise<WatchVariableItem[]> {
    if (!variable.variablesReference) return [];

    try {
      const session = vscode.debug.activeDebugSession;
      if (!session) return [];

      const res = await session.customRequest("variables", {
        variablesReference: variable.variablesReference,
      });

      return res.variables.map((child: any) => {
        const collapsible =
          child.variablesReference > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        return new WatchVariableItem(child, collapsible);
      });
    } catch {
      return [];
    }
  }
}

export function showWatchVariable(context: vscode.ExtensionContext) {
  const provider = new WatchVariableProvider();
  context.subscriptions.push(
    vscode.debug.onDidChangeActiveStackItem((stackItem) => {
      if (stackItem instanceof vscode.DebugStackFrame) {
        currentFrame = stackItem;
        provider.refresh();
      }
    })
  );
  context.subscriptions.push(
    vscode.debug.onDidChangeActiveDebugSession(() => {
      provider.refresh();
    })
  );
  context.subscriptions.push(
    vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => {
      if (e.event === "stopped") {
        provider.refresh();
      } else if (e.event === "continued") {
        currentFrame = undefined;
        provider.refresh();
      }
    })
  );
  context.subscriptions.push(
    vscode.window.createTreeView("watchVariables", {
      treeDataProvider: provider,
      showCollapseAll: true,
    })
  );

}
