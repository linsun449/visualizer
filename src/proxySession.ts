import * as vscode from "vscode";

let currentFrame: vscode.DebugStackFrame | undefined = undefined;

interface VariableDetail {
  shape?: string;
  dtype?: string;
  device?: string;
  grad?: boolean;
}

export class WatchVariableItem extends vscode.TreeItem {
  constructor(
    public readonly variableInfo: any,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly detail?: VariableDetail
  ) {
    const gradMark =
      variableInfo?.type === "Tensor" && detail
        ? detail.grad === true
          ? "🔥"
          : "❄️"
        : "";

    const label = variableInfo.isUserExpr
      ? `${variableInfo.name}${gradMark}🔍️`
      : variableInfo.name + gradMark;

    super(label, collapsibleState);

    this.iconPath = this.resolveIcon();
    this.description = this.buildDescription();
    this.tooltip = this.buildTooltip();

    this.contextValue = variableInfo.isUserExpr ? "userExpr" : "normalVar";
  }

  private buildDescription(): string {
    if (this.detail) {
        const shape = this.detail.shape ? `shape=[${this.detail.shape}]` : "";
        const dtype = this.detail.dtype ? `dtype=${this.detail.dtype}` : "";
        const info = [shape, dtype].filter(Boolean).join(", ");
        return ` =  ${this.variableInfo.type}${info ? `(${info})` : ""}: ${this.variableInfo.value}`;
    }
    return WatchVariableItem.formatShort(this.variableInfo.value);
  }

  private buildTooltip(): vscode.MarkdownString {
    const m = new vscode.MarkdownString(undefined, true);
    m.isTrusted = true;

    let mainInfo = this.variableInfo.evaluateName || this.variableInfo.name;
    if (this.detail) {
        const shape = this.detail.shape ? `shape=[${this.detail.shape}]` : "";
        const dtype = this.detail.dtype ? `dtype=${this.detail.dtype}` : "";
        const info = [shape, dtype].filter(Boolean).join(", ");
        mainInfo += ` = ${this.variableInfo.type}${info ? `(${info})` : ""}`;
    }
    m.appendMarkdown(`### **${mainInfo}**\n\n`);
    const valueText =
      this.variableInfo.value ??
      WatchVariableItem.formatShort(this.variableInfo.value);

    m.appendMarkdown(`**Value:**\n\`\`\`text\n${valueText}\n\`\`\`\n`);

    return m;
  }

  static formatShort(v: any): string {
    if (v == null) return "null";

    if (typeof v === "object") {
      try {
        return JSON.stringify(v).slice(0, 40) + "…";
      } catch {
        return "[Object]";
      }
    }

    const s = String(v).trim();
    return s.length > 40 ? s.slice(0, 40) + "…" : s;
  }

  private resolveIcon(): vscode.ThemeIcon {
    const v = this.variableInfo;
    const device = v.device || this.detail?.device || "cpu";

    const color = device.toLowerCase().includes("cuda") || device.toLowerCase().includes("gpu");

    const icon = (() => {
      switch (v.type) {
        case "Tensor": if (color) return "symbol-event";
        case "ndarray":
        case "array":
          return "symbol-variable";
        case "int":
        case "float":
        case "number":
          return "symbol-number";
        case "str":
        case "string":
          return "symbol-string";
        case "bool":
        case "boolean":
          return "symbol-boolean";
        case "dict": return "symbol-object";
        case "list": return "symbol-array";
        case "object":
        case "module":
        case "class":
          return "symbol-class";
        case "function":
          return "symbol-function";
        case "null":
        case "undefined":
          return "warning";
      }
      if (typeof v.value === 'string' && v.value.includes("object") && v.value !== null) return "symbol-class";

      return "warning";
    })();

    return new vscode.ThemeIcon(icon, 
      color?new vscode.ThemeColor("terminal.ansiYellow"):new vscode.ThemeColor("terminal.ansiBlue"));
  }
}

export class WatchVariableProvider
  implements vscode.TreeDataProvider<WatchVariableItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    WatchVariableItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private currentVariables: any[] = [];
  private variableDetailsCache = new Map<string, VariableDetail>();
  private userExpressions: string[] = [];

  constructor() {}

  addExpression(expr: string) {
    this.userExpressions.push(expr);
    this.refresh();
  }

  removeExpression(expr: string) {
    this.userExpressions = this.userExpressions.filter((e) => e !== expr);
    this.refresh();
  }

  async refresh() {
    try {
      const session = vscode.debug.activeDebugSession;
      if (!session || !currentFrame?.frameId) {
        this.currentVariables = [];
        this.variableDetailsCache.clear();
        this._onDidChangeTreeData.fire(undefined);
        return;
      }

      const scopesRes = await session.customRequest("scopes", {
        frameId: currentFrame.frameId,
      });

      const locals = scopesRes.scopes.find((s: any) =>
        s.name.toLowerCase().includes("local")
      );

      let vars: any[] = [];

      if (locals) {
        const varsRes = await session.customRequest("variables", {
          variablesReference: locals.variablesReference,
        });
        vars = varsRes.variables || [];
      }

      const exprResults = [];

      for (const expr of this.userExpressions) {
        try {
          const evalRes = await session.customRequest("evaluate", {
            expression: expr,
            frameId: currentFrame?.frameId,
            context: "watch",
          });

          exprResults.push({
            name: expr,
            value: evalRes.result,
            type: evalRes.type || "",
            variablesReference: evalRes.variablesReference || 0,
            isUserExpr: true,
          });
        } catch (err: any) {
          exprResults.push({
            name: expr,
            value: `<Error: ${err?.message || err}>`,
            type: "error",
            variablesReference: 0,
            isUserExpr: true,
          });
        }
      }

      this.currentVariables = [...exprResults, ...vars];

      this.variableDetailsCache.clear();

      for (const v of this.currentVariables) {
        await this.loadVariableDetail(session, v);
        this._onDidChangeTreeData.fire(undefined);
      }

    } catch (err) {
      this.currentVariables = [];
      this.variableDetailsCache.clear();
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  private async loadVariableDetail(
    session: vscode.DebugSession,
    variable: any
  ) {
    if (!variable || variable.type === "" || variable.type === "module") return;

    try {
      const expr = `
        (lambda v: __import__('json').dumps({
            "dtype": str(v.dtype) if hasattr(v, 'dtype') else None,
            "shape": list(v.shape) if hasattr(v, 'shape') else (len(v) if hasattr(v, '__len__') else None),
            "device": str(v.device) if hasattr(v, 'device') else 'cpu',
            "grad": v.requires_grad if hasattr(v, 'requires_grad') else False
        }))( ${variable.evaluateName || variable.name} )
      `;

      const evalRes = await session.customRequest("evaluate", {
        expression: expr,
        frameId: currentFrame?.frameId,
      });

      const detail = JSON.parse(evalRes.result.slice(1, -1));
      this.variableDetailsCache.set(variable.evaluateName || variable.name, detail);
    } catch {}
  }

  getTreeItem(element: WatchVariableItem): vscode.TreeItem {
    const detail = this.variableDetailsCache.get(element.variableInfo.evaluateName || element.variableInfo.name);
    if (detail) {
      return new WatchVariableItem(
        element.variableInfo,
        element.collapsibleState,
        detail
      );
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
          const detail = this.variableDetailsCache.get(v.evaluateName || v.name);
          return new WatchVariableItem(v, collapsible, detail);
        })
      );
    }
    const thenable = this.loadChildren(element.variableInfo);
    return thenable
  }

  private async loadChildren(variable: any): Promise<WatchVariableItem[]> {
    if (!variable.variablesReference) return [];

    try {
      const session = vscode.debug.activeDebugSession;
      if (!session) return [];

      const res = await session.customRequest("variables", {
        variablesReference: variable.variablesReference,
      });

      const children = res.variables;
      const parentIsTensor = variable.type === "Tensor";
      const needLoadDetails = children.filter(
        (child: any) => child.type === "Tensor" && !parentIsTensor && child.type !== ''
      );
      await Promise.all(
        needLoadDetails.map((child: any) => this.loadVariableDetail(session, child))
      );
      return children.map((child: any) => {
        const collapsible =
          child.variablesReference > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
        const detail = this.variableDetailsCache.get(child.evaluateName || child.name);
        return new WatchVariableItem(child, collapsible, detail);
      });
    } catch {
      return [];
    }
  }

}

export function showWatchVariable(context: vscode.ExtensionContext) {
  const provider = new WatchVariableProvider();

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "watchVariables.addExpression",
      async () => {
        const expr = await vscode.window.showInputBox({
          prompt: "Enter expression to watch",
          placeHolder: "e.g. x, model.weight.mean()",
        });

        if (!expr) return;
        provider.addExpression(expr);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "watchVariables.removeExpression",
      (item: WatchVariableItem) => {
        provider.removeExpression(item.variableInfo.evaluateName || item.variableInfo.name);
      }
    )
  );

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
