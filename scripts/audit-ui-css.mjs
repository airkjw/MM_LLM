import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import selectorParser from "postcss-selector-parser";

// Regression guard for trusted, reviewed source; scope and limitations: docs/UI_AUDIT.md.

const CSS_PATH = resolve(fileURLToPath(new URL("..", import.meta.url)), "src/renderer/src/styles.css");
const REQUIRED_THEME_TOKENS = [
  "bg", "bg-clear", "bg-sidebar", "bg-subtle", "bg-hover", "bg-selected",
  "text", "text-secondary", "text-tertiary", "border", "border-strong", "border-control",
  "accent", "accent-hover", "accent-subtle", "accent-text", "accent-graphic", "on-accent",
  "progress-fill", "progress-track", "focus-ring", "focus-halo", "danger", "danger-bg",
  "warning", "warning-bg", "info", "info-bg", "new", "new-bg", "overlay", "media-canvas", "shadow"
  , "speaker-1", "speaker-2", "speaker-3", "speaker-4", "speaker-5", "speaker-6"
];
const LEGACY_ALIASES = [
  "app-bg", "sidebar-bg", "surface", "surface-strong", "surface-subtle", "surface-hover", "surface-selected",
  "input-bg", "text", "muted", "text-soft", "border", "soft", "accent", "accent-soft", "user-bubble",
  "user-text", "danger-bg", "danger-text", "warning-bg", "warning-text", "footer-clear", "shadow"
];
const CSS_NAMED_COLORS = new Set((
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
  "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
  "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid " +
  "darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
  "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro " +
  "ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
  "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow " +
  "lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
  "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue " +
  "mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
  "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered " +
  "orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue " +
  "purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver " +
  "skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent " +
  "turquoise violet wheat white whitesmoke yellow yellowgreen"
).split(/\s+/));
const CSS_SYSTEM_COLORS = new Set((
  "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext " +
  "graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext " +
  "activeborder activecaption appworkspace background buttonhighlight buttonshadow captiontext inactiveborder " +
  "inactivecaption inactivecaptiontext infobackground infotext menu menutext scrollbar threedarkshadow " +
  "threedface threedhighlight threedlightshadow threedshadow window windowframe windowtext"
).split(/\s+/));
const RAW_COLOR_FUNCTIONS = new Set([
  "rgb", "rgba", "hsl", "hsla", "hwb", "oklch", "oklab", "lab", "lch", "color", "color-mix",
  "device-cmyk", "light-dark"
]);
const TYPOGRAPHY_TOKENS = [
  "--text-xs", "--text-sm", "--text-base", "--text-lg", "--text-xl", "--text-2xl", "--text-display",
  "--body-font-size"
];
const CONTRAST_PAIRS = [
  ["text", "bg", 4.5], ["text", "bg-sidebar", 4.5], ["text", "bg-subtle", 4.5],
  ["text-secondary", "bg", 4.5], ["text-secondary", "bg-sidebar", 4.5],
  ["text-tertiary", "bg", 4.5], ["text-tertiary", "bg-sidebar", 4.5],
  ["accent-text", "bg", 4.5], ["accent-text", "bg-sidebar", 4.5], ["accent-text", "bg-selected", 4.5],
  ["on-accent", "accent", 4.5],
  ["danger", "danger-bg", 4.5], ["warning", "warning-bg", 4.5], ["info", "info-bg", 4.5],
  ["new", "new-bg", 4.5], ["border-control", "bg", 3], ["border-control", "bg-sidebar", 3],
  ["accent-graphic", "accent-subtle", 3], ["progress-fill", "progress-track", 3],
  ["focus-ring", "bg", 3], ["accent", "bg", 3]
];
for (let index = 1; index <= 6; index++) {
  CONTRAST_PAIRS.push([`speaker-${index}`, "bg", 3], [`speaker-${index}`, "bg-hover", 3]);
}
const CONTROL_BOUNDARIES = [
  ".login-card form input", ".composer-card", ".model-search", ".web-mode", ".reasoning-mode",
  ".model-trigger", ".media-textarea", ".media-controls select", ".meeting-options input",
  ".settings-field input", ".settings-field select", ".settings-field textarea", ".settings-inline select",
  ".advanced-grid input", ".advanced-grid select", ".advanced-section select", ".dialog-search-input", ".custom-check",
  ".advanced-section textarea", ".media-controls input", ".speaker-grid input", ".speaker-grid select",
  ".music-options input", ".music-options textarea", ".compare-controls select", ".bookmark-form input",
  ".project-editor .settings-field input", "input[type=\"checkbox\"]", ".reference-button", ".file-drop",
  ".manual-tool-card textarea"
];

function cssUnescape(value) {
  return value.replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?/gi, (_, hex) => {
    const point = Number.parseInt(hex, 16);
    return String.fromCodePoint(point === 0 || point > 0x10ffff ? 0xfffd : point);
  }).replace(/\\(?:\r\n|[\n\r\f])/g, "").replace(/\\(.)/gs, "$1");
}

function canonicalSelector(selector) {
  return cssUnescape(selector).trim().replace(/\[data-theme\s*=\s*'dark'\]/gi, '[data-theme="dark"]');
}
function canonicalProperty(property) { return cssUnescape(property).trim(); }
function canonicalValue(value) { return cssUnescape(value).trim(); }

function matchingRootRules(root, selector) {
  const found = [];
  root.walkRules((rule) => {
    if (rule.selectors?.some((candidate) => canonicalSelector(candidate) === selector)) found.push(rule);
  });
  return found;
}

function rootRule(root, selector) {
  const found = matchingRootRules(root, selector);
  if (!found.length) throw new Error(`Missing CSS rule: ${selector}`);
  return found[0];
}

function declarations(rule) {
  const result = new Map();
  rule.walkDecls((declaration) => result.set(canonicalProperty(declaration.prop), canonicalValue(declaration.value)));
  return result;
}

function effectiveDeclarations(root, selector) {
  const result = new Map();
  let order = 0;
  root.walkRules((rule) => {
    if (!rule.selectors?.some((candidate) => canonicalSelector(candidate) === selector)) return;
    rule.each((node) => {
      if (node.type !== "decl") return;
      order++;
      const property = canonicalProperty(node.prop);
      const previous = result.get(property);
      if (!previous || (node.important && !previous.important) || node.important === previous.important) {
        result.set(property, { value: canonicalValue(node.value), important: node.important, order });
      }
    });
  });
  return result;
}

function effectiveFamily(values, properties) {
  let winner;
  for (const property of properties) {
    const candidate = values.get(property);
    if (!candidate) continue;
    if (!winner || (candidate.important && !winner.important) ||
      candidate.important === winner.important && candidate.order > winner.order) winner = candidate;
  }
  return winner?.value;
}

function themeTokens(rule) {
  const result = {};
  rule.walkDecls((declaration) => {
    const property = canonicalProperty(declaration.prop);
    if (!property.startsWith("--color-")) return;
    result[property.slice("--color-".length)] = canonicalValue(declaration.value);
  });
  return result;
}

function opaqueHex(value) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null;
}

function luminance(hex) {
  const values = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}

export function contrastRatio(first, second) {
  const [bright, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

function selectorHas(root, selector, predicate) {
  const effective = effectiveDeclarations(root, selector);
  const values = new Map([...effective].map(([property, declaration]) => [property, declaration.value]));
  return values.size > 0 && predicate(values);
}

const AUDITED_SELECTOR_EXCEPTIONS = new Map([
  [".login-card form input", new Set([".login-card form input:focus"])],
  [".composer-card", new Set([".composer-card.drop-active", ".composer-card:focus-within"])],
  [".web-mode", new Set([".web-mode:has(select:disabled)"])],
  [".reasoning-mode", new Set([".reasoning-mode:has(select:disabled)"])],
  [".media-textarea", new Set([".media-textarea:focus"])],
  [".custom-check", new Set([".deid-check input:checked + .custom-check", ".deid-check input:focus-visible + .custom-check",
    ".deid-check input:disabled + .custom-check"])],
  [".reference-button", new Set([".reference-button.drop-active"])],
  [".file-drop", new Set([".file-drop.drop-active"])],
  [".send-button.stop", new Set([".send-button.stop:disabled"])],
  ["button:disabled", new Set([".privacy-modal-actions button:disabled", ".workspace-tool-tabs button:disabled"])],
  ["select:disabled", new Set([".web-mode select:disabled", ".reasoning-mode select:disabled"])]
]);

const selectorBranchCache = new Map();

function selectorAtom(node) {
  const value = cssUnescape(node.value ?? "");
  if (node.type === "class") return `class:${value}`;
  if (node.type === "id") return `id:${value}`;
  if (node.type === "tag") return `tag:${value.toLowerCase()}`;
  if (node.type === "attribute") return `attribute:${canonicalSelector(node.toString())}`;
  if (node.type === "pseudo") return `pseudo:${value.toLowerCase()}${node.nodes?.length ? canonicalSelector(node.toString()) : ""}`;
  if (node.type === "universal") return null;
  return `${node.type}:${canonicalSelector(node.toString())}`;
}

function normalizeCombinator(value) {
  const normalized = cssUnescape(value).trim();
  return normalized || " ";
}

function cloneBranch(branch) {
  return {
    compounds: branch.compounds.map((compound) => new Set(compound)),
    combinators: [...branch.combinators]
  };
}

function mergeSelectorBranch(prefix, inserted) {
  const result = cloneBranch(prefix);
  const first = inserted.compounds[0] ?? new Set();
  for (const atom of first) result.compounds[result.compounds.length - 1].add(atom);
  for (let index = 1; index < inserted.compounds.length; index++) {
    result.combinators.push(inserted.combinators[index - 1]);
    result.compounds.push(new Set(inserted.compounds[index]));
  }
  return result;
}

function selectorNodeBranches(selectorNode) {
  let branches = [{ compounds: [new Set()], combinators: [] }];
  for (const node of selectorNode.nodes ?? []) {
    if (node.type === "combinator") {
      for (const branch of branches) {
        branch.combinators.push(normalizeCombinator(node.value));
        branch.compounds.push(new Set());
      }
      continue;
    }
    if (node.type === "pseudo" && [":is", ":where"].includes((node.value ?? "").toLowerCase()) && node.nodes?.length) {
      const alternatives = node.nodes.flatMap((alternative) => selectorNodeBranches(alternative));
      branches = branches.flatMap((branch) => alternatives.map((alternative) => mergeSelectorBranch(branch, alternative)));
      continue;
    }
    const atom = selectorAtom(node);
    if (atom) for (const branch of branches) branch.compounds[branch.compounds.length - 1].add(atom);
  }
  return branches;
}

function selectorBranches(selector) {
  const canonical = canonicalSelector(selector);
  if (!selectorBranchCache.has(canonical)) {
    const ast = selectorParser().astSync(canonical);
    selectorBranchCache.set(canonical, ast.nodes.flatMap((node) => selectorNodeBranches(node)));
  }
  return selectorBranchCache.get(canonical);
}

function compatibleCombinator(target, candidate) {
  return target === " " ? candidate === " " || candidate === ">" : target === candidate;
}

function branchContainsTarget(candidate, target) {
  if (candidate.compounds.length < target.compounds.length) return false;
  const offset = candidate.compounds.length - target.compounds.length;
  for (let index = 0; index < target.compounds.length; index++) {
    const candidateCompound = candidate.compounds[offset + index];
    if ([...target.compounds[index]].some((atom) => !candidateCompound.has(atom))) return false;
    if (index > 0 && !compatibleCombinator(target.combinators[index - 1], candidate.combinators[offset + index - 1])) {
      return false;
    }
  }
  return true;
}

function selectorContainsTarget(candidate, target) {
  const targetBranches = selectorBranches(target);
  return selectorBranches(candidate).some((candidateBranch) =>
    targetBranches.some((targetBranch) => branchContainsTarget(candidateBranch, targetBranch)));
}

function structuralOverrideCandidates(root, target, properties, allowedValues = new Set()) {
  const conflicts = [];
  root.walkRules((rule) => {
    for (const rawCandidate of rule.selectors ?? []) {
      const candidate = canonicalSelector(rawCandidate);
      if (candidate === target) continue;
      if (AUDITED_SELECTOR_EXCEPTIONS.get(target)?.has(candidate)) continue;
      if (!selectorContainsTarget(candidate, target)) continue;
      rule.each((node) => {
        if (node.type !== "decl") return;
        const property = canonicalProperty(node.prop);
        const value = canonicalValue(node.value);
        if (properties.includes(property) && !allowedValues.has(value)) conflicts.push(`${candidate} (${property}: ${value})`);
      });
    }
  });
  return conflicts;
}

function rejectStructuralOverrides(errors, root, target, properties, allowedValues) {
  const conflicts = structuralOverrideCandidates(root, target, properties, allowedValues);
  if (conflicts.length) errors.push(`Higher-specificity audited-selector conflict for ${target}: ${conflicts.join(", ")}`);
}

function minimumFontPixels(value, smallRootPixels, typography = new Map(), stack = new Set()) {
  const normalized = value.trim().toLowerCase();
  const variable = normalized.match(/^var\((--(?:text-(?:xs|sm|base|lg|xl|2xl|display)|body-font-size))\)$/);
  if (variable) {
    if (stack.has(variable[1])) return null;
    const tokenValue = typography.get(variable[1]);
    if (!tokenValue) return null;
    return minimumFontPixels(tokenValue, smallRootPixels, typography, new Set([...stack, variable[1]]));
  }
  const px = normalized.match(/^([0-9]*\.?[0-9]+)px$/);
  if (px) return Number(px[1]);
  const rem = normalized.match(/^([0-9]*\.?[0-9]+)rem$/);
  if (rem) return Number(rem[1]) * smallRootPixels;
  const max = normalized.match(/^max\(12px\s*,\s*([0-9]*\.?[0-9]+)rem\)$/);
  if (max) return Math.max(12, Number(max[1]) * smallRootPixels);
  const clamp = normalized.match(/^clamp\(\s*([0-9]*\.?[0-9]+)(px|rem)\s*,[^,]+,\s*[^)]+\)$/);
  if (clamp) return Number(clamp[1]) * (clamp[2] === "rem" ? smallRootPixels : 1);
  return null;
}

function colorTokens(value) {
  const raw = [];
  const named = [];
  const modern = [];
  valueParser(canonicalValue(value)).walk((node) => {
    if (node.type === "word") {
      if (/^#[0-9a-f]{3,8}$/i.test(node.value)) raw.push(node.value);
      const lower = node.value.toLowerCase();
      if (CSS_NAMED_COLORS.has(lower) || CSS_SYSTEM_COLORS.has(lower)) named.push(node.value);
    } else if (node.type === "function" && RAW_COLOR_FUNCTIONS.has(node.value.toLowerCase())) {
      (/(?:^|-)color|^(?:oklch|oklab|lab|lch|device-cmyk|light-dark)$/i.test(node.value) ? modern : raw)
        .push(valueParser.stringify(node));
      return false;
    }
    return undefined;
  });
  return { raw, named, modern };
}

export function auditCss(css) {
  const errors = [];
  let root;
  try { root = postcss.parse(css); }
  catch (error) { return { errors: [`CSS parse failed: ${error.message}`], metrics: {}, contrasts: {} }; }
  const lightRoots = matchingRootRules(root, ":root");
  const darkRoots = matchingRootRules(root, ':root[data-theme="dark"]');
  if (lightRoots.length !== 1) errors.push(`Expected exactly one :root theme block; found ${lightRoots.length}`);
  if (darkRoots.length !== 1) errors.push(`Expected exactly one dark theme root; found ${darkRoots.length}`);
  const lightRule = rootRule(root, ":root");
  const darkRule = rootRule(root, ':root[data-theme="dark"]');
  if (lightRule.parent?.type !== "root" || darkRule.parent?.type !== "root" ||
    lightRule.selectors.length !== 1 || darkRule.selectors.length !== 1) {
    errors.push("Theme roots must be standalone top-level rules");
  }
  const lightTokens = themeTokens(lightRule);
  const darkTokens = themeTokens(darkRule);
  const lightTokenNames = Object.keys(lightTokens).sort();
  const darkTokenNames = Object.keys(darkTokens).sort();
  if (lightTokenNames.join("\n") !== darkTokenNames.join("\n")) {
    errors.push("Light and dark theme roots must define the same color tokens");
  }
  for (const [theme, tokens] of [["light", lightTokens], ["dark", darkTokens]]) {
    for (const token of REQUIRED_THEME_TOKENS) if (!tokens[token]) errors.push(`${theme}: --color-${token} is missing`);
    const speakerValues = Array.from({ length: 6 }, (_, index) => tokens[`speaker-${index + 1}`]);
    if (new Set(speakerValues).size !== 6) errors.push(`${theme}: all six speaker colors must be distinct`);
  }

  const contrasts = {};
  for (const [theme, tokens] of [["light", lightTokens], ["dark", darkTokens]]) {
    contrasts[theme] = {};
    for (const [foreground, background, minimum] of CONTRAST_PAIRS) {
      const foregroundHex = opaqueHex(tokens[foreground] ?? "");
      const backgroundHex = opaqueHex(tokens[background] ?? "");
      if (!foregroundHex || !backgroundHex) {
        errors.push(`${theme}: ${foreground}/${background} must use opaque six-digit hex tokens`);
        continue;
      }
      const ratio = contrastRatio(foregroundHex, backgroundHex);
      contrasts[theme][`${foreground}/${background}`] = ratio;
      if (ratio + Number.EPSILON < minimum) {
        errors.push(`${theme}: ${foreground}/${background} is ${ratio.toFixed(2)}:1; expected ${minimum}:1`);
      }
    }
  }

  const rawColors = [];
  const modernColors = [];
  const namedColors = [];
  root.walkDecls((declaration) => {
    const property = canonicalProperty(declaration.prop);
    const parentRule = declaration.parent?.type === "rule" ? declaration.parent : null;
    const isThemeToken = property.startsWith("--color-") &&
      (parentRule === lightRule || parentRule === darkRule);
    if (property.startsWith("--color-") && !isThemeToken) {
      errors.push(`Color token redefined outside theme roots: ${property}`);
    }
    if (isThemeToken) return;
    const { raw, modern, named } = colorTokens(declaration.value);
    rawColors.push(...raw.map((value) => `${property}: ${value}`));
    modernColors.push(...modern.map((value) => `${property}: ${value}`));
    namedColors.push(...named.map((value) => `${property}: ${value}`));
  });
  if (rawColors.length) errors.push(`Raw colors outside theme tokens: ${rawColors.join(", ")}`);
  if (modernColors.length) errors.push(`Modern raw colors outside theme tokens: ${modernColors.join(", ")}`);
  if (namedColors.length) errors.push(`Named colors outside theme tokens: ${namedColors.join(", ")}`);

  const darkOverrides = [];
  root.walkRules((rule) => {
    const selector = canonicalSelector(rule.selector);
    if (/(?:\[[^\]]*dark[^\]]*\]|[.#][-_a-z0-9]*dark[-_a-z0-9]*)/i.test(selector) &&
      selector !== ':root[data-theme="dark"]') darkOverrides.push(selector);
  });
  root.walkAtRules("media", (atRule) => {
    const params = cssUnescape(atRule.params);
    if (/dark/i.test(params)) darkOverrides.push(`@media ${params}`);
  });
  if (darkOverrides.length) errors.push(`Selector-level dark overrides remain: ${darkOverrides.join(", ")}`);

  root.walkDecls((declaration) => {
    const property = canonicalProperty(declaration.prop);
    const value = canonicalValue(declaration.value);
    for (const alias of LEGACY_ALIASES) {
      if (property === `--${alias}` || new RegExp(`var\\(\\s*--${alias}\\s*(?:,|\\))`).test(value)) {
        errors.push(`Legacy alias remains: --${alias}`);
      }
    }
  });

  const gradients = [];
  root.walkDecls((declaration) => {
    const value = canonicalValue(declaration.value);
    if (/gradient\(/i.test(value)) gradients.push({ selector: canonicalSelector(declaration.parent.selector), value });
  });
  if (gradients.length !== 1 || !gradients[0].selector.split(",").some((selector) => selector.trim() === ".chat-footer")) {
    errors.push(`Expected only the composer fade gradient; found ${gradients.length}`);
  }

  const smallRule = rootRule(root, ':root[data-font-size="small"]');
  const smallRootPixels = Number.parseFloat(declarations(smallRule).get("font-size") ?? "0");
  if (smallRootPixels < 15) errors.push(`Small root font must be at least 15px; found ${smallRootPixels}px`);
  const typography = new Map(TYPOGRAPHY_TOKENS.map((token) => [token, declarations(lightRule).get(token)]));
  root.walkDecls((declaration) => {
    const property = canonicalProperty(declaration.prop);
    if (!TYPOGRAPHY_TOKENS.includes(property)) return;
    if (declaration.parent !== lightRule) errors.push(`Typography token redefined outside :root: ${property}`);
  });
  root.walkDecls((declaration) => {
    if (canonicalProperty(declaration.prop) !== "font-size") return;
    const value = canonicalValue(declaration.value);
    const minimum = minimumFontPixels(value, smallRootPixels, typography);
    if (minimum === null) errors.push(`Unverified font-size path: ${value}`);
    else if (minimum < 12) errors.push(`Font declaration can fall below 12px: ${value}`);
  });
  root.walkDecls((declaration) => {
    if (canonicalProperty(declaration.prop) !== "font") return;
    const value = canonicalValue(declaration.value).toLowerCase();
    if (!["inherit", "initial", "unset", "revert", "revert-layer"].includes(value)) {
      errors.push(`Font shorthand must not define a size: ${declaration.value}`);
    }
  });
  for (const token of TYPOGRAPHY_TOKENS) {
    const value = declarations(lightRule).get(token);
    const minimum = value ? minimumFontPixels(value, smallRootPixels, typography, new Set([token])) : null;
    if (minimum === null || minimum < 12) errors.push(`${token} does not enforce the 12px floor`);
  }

  for (const selector of CONTROL_BOUNDARIES) {
    const values = effectiveDeclarations(root, selector);
    const border = effectiveFamily(values, ["border", "border-color"]);
    const outline = effectiveFamily(values, ["outline", "outline-color"]);
    if (!/var\(--color-border-control\)/.test(border ?? outline ?? "")) {
      errors.push(`Control boundary does not use --color-border-control: ${selector}`);
    }
    rejectStructuralOverrides(errors, root, selector, ["border", "border-color", "outline", "outline-color"],
      new Set(["var(--color-border-control)", "1px solid var(--color-border-control)"]));
  }

  const disabledChecks = [
    ["button:disabled", { color: "var(--color-text-tertiary)", background: "var(--color-bg-subtle)" }],
    ["input:disabled", { color: "var(--color-text-tertiary)", background: "var(--color-bg-subtle)", border: "var(--color-border-control)" }],
    ["textarea:disabled", { color: "var(--color-text-tertiary)", background: "var(--color-bg-subtle)", border: "var(--color-border-control)" }],
    ["select:disabled", { color: "var(--color-text-tertiary)", background: "var(--color-bg-subtle)", border: "var(--color-border-control)" }],
    [".deid-check input:disabled + .custom-check", {
      color: "var(--color-text-tertiary)", background: "var(--color-bg-subtle)", border: "var(--color-border)"
    }]
  ];
  for (const [selector, expected] of disabledChecks) {
    const values = effectiveDeclarations(root, selector);
    const actual = {
      color: effectiveFamily(values, ["color"]),
      background: effectiveFamily(values, ["background", "background-color"]),
      border: effectiveFamily(values, ["border", "border-color"])
    };
    if (Object.entries(expected).some(([property, value]) => actual[property] !== value)) {
      errors.push(`Missing explicit disabled mapping: ${selector}`);
    }
    const properties = [];
    const allowed = new Set(Object.values(expected));
    if (expected.color) properties.push("color");
    if (expected.background) properties.push("background", "background-color");
    if (expected.border) properties.push("border", "border-color");
    rejectStructuralOverrides(errors, root, selector, properties, allowed);
  }
  root.walkRules((rule) => {
    const selector = canonicalSelector(rule.selector);
    if (selector.includes(":disabled") && declarations(rule).has("opacity")) errors.push(`Opacity-based disabled style: ${selector}`);
  });

  if (!selectorHas(root, ".send-button.stop", (values) =>
    values.get("background") === "var(--color-text)" && values.get("color") === "var(--color-bg)")) {
    errors.push(".send-button.stop must use --color-text on --color-bg");
  }
  rejectStructuralOverrides(errors, root, ".send-button.stop", ["color", "background", "background-color"],
    new Set(["var(--color-text)", "var(--color-bg)"]));
  if (!selectorHas(root, ".nav-item.active", (values) =>
    values.get("color") === "var(--color-accent-text)" &&
    values.get("background") === "var(--color-bg-selected)")) {
    errors.push(".nav-item.active must use the audited accent-text/bg-selected pair");
  }
  rejectStructuralOverrides(errors, root, ".nav-item.active", ["color", "background", "background-color"],
    new Set(["var(--color-accent-text)", "var(--color-bg-selected)"]));
  if (!selectorHas(root, ".nav-item.active svg", (values) =>
    values.get("color") === "var(--color-accent-text)")) {
    errors.push(".nav-item.active svg must use the audited accent text color");
  }
  rejectStructuralOverrides(errors, root, ".nav-item.active svg", ["color"], new Set(["var(--color-accent-text)"]));
  if (!selectorHas(root, ".nav-item.active small", (values) =>
    values.get("color") === "var(--color-accent-text)")) {
    errors.push(".nav-item.active small must use the audited accent text color");
  }
  rejectStructuralOverrides(errors, root, ".nav-item.active small", ["color"], new Set(["var(--color-accent-text)"]));

  const speakerTokens = Array.from({ length: 6 }, (_, index) => `var(--color-speaker-${index + 1})`);
  for (let index = 0; index < speakerTokens.length; index++) {
    const selector = `.speaker-${index}`;
    if (!selectorHas(root, selector, (values) => values.get("--speaker-color") === speakerTokens[index])) {
      errors.push(`${selector} must map to ${speakerTokens[index]}`);
    }
    rejectStructuralOverrides(errors, root, selector, ["--speaker-color"], new Set([speakerTokens[index]]));
  }
  if (!selectorHas(root, ".segment-speaker", (values) => values.get("color") === "var(--color-text-secondary)")) {
    errors.push(".segment-speaker must keep speaker names on --color-text-secondary");
  }
  rejectStructuralOverrides(errors, root, ".segment-speaker", ["color"],
    new Set(["var(--color-text-secondary)"]));
  if (!selectorHas(root, ".segment-speaker::before", (values) =>
    values.get("background") === "var(--speaker-color)")) {
    errors.push(".segment-speaker::before must render the categorical speaker dot");
  }
  if (!selectorHas(root, ".panel-header", (values) => values.get("min-height") === "60px")) errors.push("Panel header must be 60px");
  for (const selector of [".web-mode", ".reasoning-mode", ".model-trigger"]) {
    if (!selectorHas(root, selector, (values) => values.get("height") === "34px")) errors.push(`${selector} must be 34px high`);
  }

  for (const selector of ["button:focus-visible", "input:focus-visible", "textarea:focus-visible",
    "select:focus-visible", "a:focus-visible", "summary:focus-visible", "[tabindex]:focus-visible"]) {
    if (!selectorHas(root, selector, (values) => values.has("outline"))) errors.push(`Missing focus-visible coverage for ${selector}`);
  }
  const mediaText = root.nodes.filter((node) => node.type === "atrule").map((node) => `${node.params}`).join("\n");
  for (const media of ["prefers-reduced-motion: reduce", "forced-colors: active"]) {
    if (!mediaText.includes(media)) errors.push(`Missing ${media} safeguard`);
  }

  return {
    errors,
    metrics: {
      themeTokenCount: { light: Object.keys(lightTokens).length, dark: Object.keys(darkTokens).length },
      hardcodedColorsOutsideTokens: rawColors.length + modernColors.length + namedColors.length,
      selectorDarkOverrides: darkOverrides.length,
      gradients: gradients.length,
      contrastPairs: Object.keys(contrasts.light).length + Object.keys(contrasts.dark).length,
      controlBoundaryMappings: CONTROL_BOUNDARIES.length,
      disabledMappings: disabledChecks.length
    },
    contrasts
  };
}

export function auditUiCssFile(path = CSS_PATH) {
  return auditCss(readFileSync(path, "utf8"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditUiCssFile();
  console.log(JSON.stringify(result.metrics, null, 2));
  if (result.errors.length) {
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("UI CSS audit passed.");
  }
}
