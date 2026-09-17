import { parse as parseHtml } from "parse5";
import ts from "typescript";

// Regression guard for trusted, reviewed source; scope and limitations: docs/UI_AUDIT.md.

function walkHtml(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walkHtml(child, visit);
}

function attribute(node, name) {
  return node.attrs?.find((item) => item.name === name)?.value;
}

function sourceFile(source, kind) {
  return ts.createSourceFile("audit.ts", source, ts.ScriptTarget.Latest, true, kind);
}

function walkTs(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walkTs(child, visit));
}

function propertyPath(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    const parent = propertyPath(node.expression);
    return parent ? `${parent}.${node.name.text}` : null;
  }
  return null;
}

function staticBoolean(node) {
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (ts.isNumericLiteral(node)) return Number(node.text) !== 0;
  if (node.kind === ts.SyntaxKind.NullKeyword) return false;
  return null;
}

function isStaticallyUnreachable(node, stopAt = null) {
  let child = node;
  for (let parent = node.parent; parent && parent !== stopAt; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent)) {
      const condition = staticBoolean(parent.expression);
      if (condition === false && child === parent.thenStatement || condition === true && child === parent.elseStatement) return true;
    }
    if ((ts.isWhileStatement(parent) || ts.isDoStatement(parent)) && staticBoolean(parent.expression) === false) return true;
    if (ts.isConditionalExpression(parent)) {
      const condition = staticBoolean(parent.condition);
      if (condition === false && child === parent.whenTrue || condition === true && child === parent.whenFalse) return true;
    }
  }
  return false;
}

function isTopLevelExpression(call) {
  return ts.isExpressionStatement(call.parent) && ts.isSourceFile(call.parent.parent);
}

function enclosingFunctionDeclaration(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent)) return parent;
    if (ts.isSourceFile(parent)) return null;
  }
  return null;
}

function isWhenReadyContinuation(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isArrowFunction(parent) && !ts.isFunctionExpression(parent)) continue;
    const call = parent.parent;
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "then") return false;
    const ready = call.expression.expression;
    return ts.isCallExpression(ready) && propertyPath(ready.expression) === "app.whenReady";
  }
  return false;
}

function objectProperty(object, name) {
  return object.properties.find((property) => ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === name);
}

function isThemeComparison(node, value) {
  if (!ts.isBinaryExpression(node) || ![
    ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken
  ].includes(node.operatorToken.kind)) return false;
  return ts.isIdentifier(node.left) && node.left.text === "theme" && ts.isStringLiteral(node.right) && node.right.text === value ||
    ts.isIdentifier(node.right) && node.right.text === "theme" && ts.isStringLiteral(node.left) && node.left.text === value;
}

function isValidThemeGuard(node) {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
    (isThemeComparison(node.left, "light") && isThemeComparison(node.right, "dark") ||
      isThemeComparison(node.left, "dark") && isThemeComparison(node.right, "light"));
}

function directTopLevelThemeGuard(node, source) {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    propertyPath(node.left) !== "document.documentElement.dataset.theme" || !ts.isIdentifier(node.right) ||
    node.right.text !== "theme" || !ts.isExpressionStatement(node.parent)) return null;
  let statement = node.parent;
  while (statement.parent && !ts.isIfStatement(statement.parent)) {
    if (ts.isFunctionLike(statement.parent) || ts.isCallExpression(statement.parent)) return null;
    statement = statement.parent;
  }
  const guard = statement.parent;
  if (!guard || !ts.isIfStatement(guard) || guard.parent !== source || !isValidThemeGuard(guard.expression)) return null;
  let guardedNode = node;
  while (guardedNode.parent && guardedNode.parent !== guard) guardedNode = guardedNode.parent;
  return guardedNode === guard.thenStatement ? guard : null;
}

function isInitialDarkCondition(node) {
  if (!ts.isBinaryExpression(node) || ![
    ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken
  ].includes(node.operatorToken.kind)) return false;
  return ts.isIdentifier(node.left) && node.left.text === "initialTheme" && ts.isStringLiteral(node.right) && node.right.text === "dark" ||
    ts.isIdentifier(node.right) && node.right.text === "initialTheme" && ts.isStringLiteral(node.left) && node.left.text === "dark";
}

export function auditThemeStartup({ index, bootstrap, preload, main }) {
  const errors = [];
  const html = parseHtml(index);
  let head;
  const bootstrapScripts = [];
  const allScripts = [];
  const stylesheets = [];
  const cspMetas = [];
  let htmlOrder = 0;
  walkHtml(html, (node) => {
    node.auditOrder = htmlOrder++;
    if (node.tagName === "head") head = node;
    if (node.tagName === "script") {
      allScripts.push(node);
      if (attribute(node, "src") === "./theme-bootstrap.js") bootstrapScripts.push(node);
    }
    if (node.tagName === "link" && (attribute(node, "rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) {
      stylesheets.push(node);
    }
    if (node.tagName === "meta" && (attribute(node, "http-equiv") ?? "").toLowerCase() === "content-security-policy") {
      cspMetas.push(node);
    }
  });
  if (bootstrapScripts.length !== 1 || bootstrapScripts[0].parentNode !== head) {
    errors.push("The external theme bootstrap must appear exactly once as a direct child of <head>.");
  } else if ((bootstrapScripts[0].childNodes ?? []).some((node) => node.nodeName === "#text" && node.value.trim())) {
    errors.push("The external theme bootstrap element must not contain inline script.");
  } else {
    const script = bootstrapScripts[0];
    const forbidden = ["async", "defer", "nomodule"].filter((name) => attribute(script, name) !== undefined);
    const type = (attribute(script, "type") ?? "").trim().toLowerCase();
    if (forbidden.length || type && !["text/javascript", "application/javascript"].includes(type)) {
      errors.push("The theme bootstrap must be a classic blocking external script.");
    }
    if (allScripts.some((candidate) => candidate !== script && candidate.auditOrder < script.auditOrder)) {
      errors.push("The theme bootstrap must be the first script in document order.");
    }
    if (stylesheets.some((stylesheet) => stylesheet.auditOrder < script.auditOrder)) {
      errors.push("The blocking theme bootstrap must precede stylesheets.");
    }
  }
  if (cspMetas.length !== 1 || cspMetas[0].parentNode !== head) {
    errors.push("A single CSP meta element must be a direct child of <head>.");
  } else {
    const directives = new Map((attribute(cspMetas[0], "content") ?? "").split(";")
      .map((part) => part.trim().split(/\s+/)).filter((parts) => parts[0]).map(([name, ...values]) => [name, values]));
    const scripts = directives.get("script-src") ?? [];
    if (!scripts.includes("'self'") || scripts.includes("'unsafe-inline'")) {
      errors.push("CSP script-src must allow self and reject unsafe-inline.");
    }
    if (bootstrapScripts[0] && cspMetas[0].auditOrder > bootstrapScripts[0].auditOrder) {
      errors.push("The CSP meta must precede the blocking theme bootstrap.");
    }
  }
  const rendererModule = allScripts.find((node) => attribute(node, "src") === "/src/main.tsx");
  if (!rendererModule || (attribute(rendererModule, "type") ?? "").toLowerCase() !== "module" ||
    bootstrapScripts[0] && rendererModule.auditOrder < bootstrapScripts[0].auditOrder) {
    errors.push("The renderer module must load after the blocking theme bootstrap.");
  }

  const bootstrapFile = sourceFile(bootstrap, ts.ScriptKind.JS);
  if (bootstrapFile.parseDiagnostics.length) errors.push("Theme bootstrap must be valid JavaScript.");
  let initialThemeRead = false;
  let guardedAssignment = false;
  walkTs(bootstrapFile, (node) => {
    if (isStaticallyUnreachable(node)) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "theme" && node.initializer &&
      propertyPath(node.initializer) === "window.mmllmBootstrap.initialTheme" &&
      ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent) &&
      node.parent.parent.parent === bootstrapFile) initialThemeRead = true;
    if (directTopLevelThemeGuard(node, bootstrapFile)) guardedAssignment = true;
  });
  if (!initialThemeRead) errors.push("Theme bootstrap must read the isolated initialTheme bridge value.");
  if (!guardedAssignment) {
    errors.push("Theme bootstrap must validate light/dark in a direct synchronous top-level statement before assigning the root dataset.");
  }

  const preloadFile = sourceFile(preload, ts.ScriptKind.TS);
  if (preloadFile.parseDiagnostics.length) errors.push("Preload must be valid TypeScript.");
  let bridgeExposure = false;
  let preloadDomAccess = false;
  walkTs(preloadFile, (node) => {
    if (ts.isCallExpression(node) && propertyPath(node.expression) === "contextBridge.exposeInMainWorld" &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === "mmllmBootstrap" &&
      isTopLevelExpression(node) && !isStaticallyUnreachable(node)) {
      bridgeExposure = true;
    }
    if (ts.isPropertyAccessExpression(node) && (propertyPath(node) ?? "").startsWith("document.")) preloadDomAccess = true;
  });
  if (!bridgeExposure) errors.push("Preload must expose the isolated mmllmBootstrap bridge.");
  if (preloadDomAccess) errors.push("Preload must not mutate the renderer document.");

  const mainFile = sourceFile(main, ts.ScriptKind.TS);
  if (mainFile.parseDiagnostics.length) errors.push("Main startup code must be valid TypeScript.");
  let backgroundOption = false;
  let initialArgument = false;
  let reachableWindowFactory = false;
  let reachableWindowFactoryCall = false;
  walkTs(mainFile, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "createWindow" &&
      !isStaticallyUnreachable(node) && isWhenReadyContinuation(node)) reachableWindowFactoryCall = true;
    if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "BrowserWindow") return;
    const factory = enclosingFunctionDeclaration(node);
    if (!factory || factory.name?.text !== "createWindow" || factory.parent !== mainFile ||
      isStaticallyUnreachable(node, factory)) return;
    reachableWindowFactory = true;
    const options = node.arguments?.[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return;
    const background = objectProperty(options, "backgroundColor");
    if (background && ts.isConditionalExpression(background.initializer) &&
      isInitialDarkCondition(background.initializer.condition)) backgroundOption = true;
    const webPreferences = objectProperty(options, "webPreferences");
    if (!webPreferences || !ts.isObjectLiteralExpression(webPreferences.initializer)) return;
    const additional = objectProperty(webPreferences.initializer, "additionalArguments");
    if (!additional || !ts.isArrayLiteralExpression(additional.initializer)) return;
    initialArgument = additional.initializer.elements.some((element) => ts.isTemplateExpression(element) &&
      element.head.text === "--mmllm-initial-theme=" && element.templateSpans.some((span) =>
        ts.isIdentifier(span.expression) && span.expression.text === "initialTheme"));
  });
  if (!reachableWindowFactory || !reachableWindowFactoryCall) {
    errors.push("BrowserWindow theme startup must be reachable from the top-level app-ready path.");
  }
  if (!backgroundOption) errors.push("BrowserWindow must derive its initial background from the applied theme.");
  if (!initialArgument) errors.push("BrowserWindow must pass the initial theme through an isolated process argument.");
  return errors;
}
