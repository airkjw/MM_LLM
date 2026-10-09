import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import type { ThreadSummary } from "../../../shared/contracts";
import { useDialogFocus } from "../use-focus-layer";

/** A conversation row. `snippet` is present on `ThreadSearchResult`s and shown beside the title when set. */
export type PaletteThread = ThreadSummary & { snippet?: string };

export type PaletteCommand = {
  id: string;
  label: string;
  /** Display-only key hint such as "⌘N"; the host owns the actual shortcut handling. */
  shortcut?: string;
  /** Parent label, shown as `group › label` (for example 화면 모드 › 다크) and matched by the query. */
  group?: string;
};

export type CommandPaletteProps = {
  open: boolean;
  /** Called for Escape, backdrop clicks and after a conversation or command was chosen. */
  onClose: () => void;
  searchThreads: (query: string) => Promise<readonly PaletteThread[]>;
  onSelectThread: (id: string) => void;
  commands: readonly PaletteCommand[];
  onRunCommand: (id: string) => void;
  /** Debounce before searchThreads runs for a changed query. Defaults to 160ms. */
  searchDelayMs?: number;
};

type SearchStatus = "idle" | "loading" | "ready" | "error";
type Row =
  | { kind: "thread"; key: string; thread: PaletteThread }
  | { kind: "command"; key: string; command: PaletteCommand };

const DEFAULT_SEARCH_DELAY_MS = 160;

function queryTokens(term: string) {
  return term.toLowerCase().split(/\s+/).filter(Boolean);
}

function commandMatches(command: PaletteCommand, tokens: readonly string[]) {
  const haystack = `${command.group ?? ""} ${command.label}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/** Wraps query matches in <mark>. Only React text nodes are produced, so markup in `text` stays inert. */
function Highlight({ text, tokens }: { text: string; tokens: readonly string[] }): ReactNode {
  if (!tokens.length) return text;
  const pattern = new RegExp(`(${[...tokens].sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>);
}

export function CommandPalette(props: CommandPaletteProps) {
  return props.open ? <PaletteDialog {...props} /> : null;
}

function PaletteDialog({
  onClose, searchThreads, onSelectThread, commands, onRunCommand, searchDelayMs = DEFAULT_SEARCH_DELAY_MS
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<readonly PaletteThread[]>([]);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose);
  const searchRef = useRef(searchThreads);
  const requestRef = useRef(0);
  searchRef.current = searchThreads;
  const baseId = useId();
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const optionId = (key: string) => `${baseId}-${key}`;

  const commandsOnly = query.startsWith("/");
  const term = (commandsOnly ? query.slice(1) : query).trim();
  const tokens = useMemo(() => queryTokens(term), [term]);

  useEffect(() => () => { requestRef.current += 1; }, []);

  useEffect(() => {
    const request = ++requestRef.current;
    if (commandsOnly || !term) { setThreads([]); setStatus("idle"); return; }
    setStatus("loading");
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchRef.current(term);
        if (requestRef.current !== request) return;
        setThreads(Array.isArray(found) ? found : []);
        setStatus("ready");
      } catch {
        // The raw error may carry internal detail; the palette only reports that the search failed.
        if (requestRef.current !== request) return;
        setThreads([]);
        setStatus("error");
      }
    }, searchDelayMs);
    return () => window.clearTimeout(timer);
  }, [commandsOnly, term, searchDelayMs]);

  const shownCommands = useMemo(
    () => commands.filter((command) => commandMatches(command, tokens)), [commands, tokens]);
  const rows = useMemo<Row[]>(() => [
    ...(commandsOnly ? [] : threads.map((thread): Row => ({ kind: "thread", key: `thread-${thread.id}`, thread }))),
    ...shownCommands.map((command): Row => ({ kind: "command", key: `command-${command.id}`, command }))
  ], [commandsOnly, threads, shownCommands]);
  const threadRows = rows.filter((row) => row.kind === "thread");
  const commandRows = rows.filter((row) => row.kind === "command");

  const activeIndex = Math.max(0, rows.findIndex((row) => row.key === activeKey));
  const active = rows[activeIndex] as Row | undefined;
  const activeId = active ? optionId(active.key) : undefined;
  useEffect(() => {
    // scrollIntoView is missing in some test DOMs; the palette still works without it.
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  function choose(row: Row) {
    if (row.kind === "thread") onSelectThread(row.thread.id); else onRunCommand(row.command.id);
    onClose();
  }

  function move(index: number) {
    if (!rows.length) return;
    setActiveKey(rows[(index + rows.length) % rows.length].key);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown") { event.preventDefault(); move(activeIndex + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(activeIndex - 1); }
    else if (event.key === "Home") { event.preventDefault(); move(0); }
    else if (event.key === "End") { event.preventDefault(); move(rows.length - 1); }
    else if (event.key === "Enter" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (active) choose(active);
    }
  }

  const statusTone = status === "loading" ? "loading" : status === "error" ? "error" : !rows.length && term ? "empty" : "count";
  const statusText = statusTone === "loading" ? "대화를 검색하는 중…"
    : statusTone === "error" ? "대화 검색에 실패했습니다. 명령은 그대로 사용할 수 있습니다."
      : statusTone === "empty" ? commandsOnly ? "일치하는 명령이 없습니다." : "일치하는 항목이 없습니다."
        : rows.length ? `대화 ${threadRows.length}건 · 명령 ${commandRows.length}건` : "";

  const section = (label: string, id: string, items: Row[]) => items.length > 0 &&
    <div role="group" aria-labelledby={id} key={id}>
      <div className="command-palette-section" id={id}>{label}</div>
      {items.map((row) => {
        const selected = row.key === active?.key;
        return <div key={row.key} id={optionId(row.key)} role="option" aria-selected={selected}
          data-kind={row.kind} className="command-palette-option"
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => { if (!selected) setActiveKey(row.key); }}
          onClick={() => choose(row)}>
          {row.kind === "thread"
            ? <>
              <span className="command-palette-title"><Highlight text={row.thread.title} tokens={tokens} /></span>
              {row.thread.snippet && <span className="command-palette-hint">
                <Highlight text={row.thread.snippet} tokens={tokens} /></span>}
            </>
            : <span className="command-palette-title">
              {row.command.group && <><span className="command-palette-group">
                <Highlight text={row.command.group} tokens={tokens} /></span>
                <span className="command-palette-chevron" aria-hidden="true"> › </span></>}
              <Highlight text={row.command.label} tokens={tokens} />
            </span>}
          {row.kind === "command" && row.command.shortcut &&
            <kbd className="command-palette-shortcut">{row.command.shortcut}</kbd>}
          {selected && <CornerDownLeft className="command-palette-enter" size={14} aria-hidden="true" />}
        </div>;
      })}
    </div>;

  return <div className="command-palette-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="명령 팔레트"
      aria-describedby={hintId} ref={dialogRef} tabIndex={-1}>
      <div className="command-palette-input">
        <Search size={16} aria-hidden="true" />
        <input type="text" role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={activeId} aria-label="대화 검색 또는 명령 실행"
          placeholder="대화를 검색하거나 명령을 입력하세요" autoComplete="off" spellCheck={false}
          value={query} onChange={(event) => { setQuery(event.target.value); setActiveKey(null); }} onKeyDown={onKeyDown} />
        <kbd aria-hidden="true">esc</kbd>
      </div>
      <div className="command-palette-list" id={listId} role="listbox" aria-label="검색 결과">
        {section("대화", `${baseId}-threads`, threadRows)}
        {section("명령", `${baseId}-commands`, commandRows)}
      </div>
      <div role="status" className={statusTone === "count" ? "sr-only" : "command-palette-status"}
        data-tone={statusTone}>{statusText}</div>
      <div className="command-palette-footer" id={hintId}>
        <span>↑↓ 이동</span><span>↵ 열기</span><span>/ 로 명령만 보기</span>
      </div>
    </div>
  </div>;
}
