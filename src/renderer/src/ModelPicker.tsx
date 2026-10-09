import { Check, ChevronDown, Globe2, Plus, Search, Sparkles, Star } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { reasoningSupport } from "../../shared/chat-options";
import type { GatewayModel } from "../../shared/contracts";
import { isRecentlyAdded } from "../../shared/media-capabilities";
import { hasNativeWebSearch } from "../../shared/web-search";
import { modelLabel, providerLabel } from "./model-names";
import { ModelPreferences } from "./model-preferences";
import { useFocusLayer } from "./use-focus-layer";

/**
 * Composer model selection. The trigger is a composer model token (`primary` selects the conversation model,
 * `compare` replaces one comparison slot) or the `add` button. Shift+Enter adds the active row to the comparison
 * list without closing; Alt+Enter toggles its favorite (contract D3.6).
 */
export function ModelPicker({
  models, selected, onSelect, disabled = false, variant = "primary", compare, unavailable, openRequest, restoreFallback
}: {
  models: GatewayModel[]; selected: string; onSelect: (id: string) => void; disabled?: boolean;
  variant?: "primary" | "compare" | "add";
  /** Models already in the composer and the Shift+Enter handler; it returns the announcement to show. */
  compare?: { ids: string[]; onAdd: (id: string) => string };
  /** A reason a model cannot be chosen from this trigger (the row stays visible but refuses selection). */
  unavailable?: (model: GatewayModel) => string | undefined;
  /** Each new value opens the picker (Cmd/Ctrl+Shift+C). */
  openRequest?: number;
  restoreFallback?: () => HTMLElement | null;
}) {
  const preferences = useContext(ModelPreferences);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const popoverId = useMemo(() => `model-picker-${crypto.randomUUID()}`, []);
  const { ref: popover, requestClose } = useFocusLayer<HTMLDivElement>({
    active: open, mode: "modal", closeOnOutside: true, restoreTo: trigger, restoreFallback,
    onClose: () => { setOpen(false); setQuery(""); setStatus(""); }
  });
  useEffect(() => { if (openRequest) { setActive(0); setOpen(true); } }, [openRequest]);
  const priority = (id: string) => preferences.favorites.includes(id) ? 0 : preferences.recent.includes(id) ? 1 : 2;
  const chatModels = models.filter((model) => model.type === "llm");
  const filtered = [...chatModels].sort((a, b) => priority(a.id) - priority(b.id) ||
    (priority(a.id) === 1 ? preferences.recent.indexOf(a.id) - preferences.recent.indexOf(b.id) : 0)).filter((model) =>
    `${modelLabel(model.id)} ${model.id} ${providerLabel(model.owned_by)}`
      .toLowerCase().includes(query.toLowerCase())
  );
  const groups = filtered.reduce<Record<string, GatewayModel[]>>((acc, model) => {
    const provider = preferences.favorites.includes(model.id) ? "즐겨찾기" : preferences.recent.includes(model.id) ? "최근 사용" : providerLabel(model.owned_by);
    (acc[provider] ??= []).push(model);
    return acc;
  }, {});
  const options = Object.values(groups).flat();
  // Grid row of each group heading; its options and stars follow on the next rows.
  const rowOf = new Map<string, number>();
  let nextRow = 1;
  for (const [provider, items] of Object.entries(groups)) { rowOf.set(provider, nextRow); nextRow += items.length + 1; }
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const listId = `${popoverId}-options`;
  const hintId = `${popoverId}-hint`;
  const choose = (model: GatewayModel) => {
    const reason = unavailable?.(model);
    if (reason) { setStatus(reason); return; }
    preferences.update(model.id, "recent"); onSelect(model.id); requestClose("programmatic", true);
  };
  const addToCompare = (model: GatewayModel) => {
    if (!compare) return;
    setStatus(compare.onAdd(model.id));
  };
  const toggleFavorite = (id: string) => preferences.update(id, "favorite");
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, listId]);
  const selectedModel = chatModels.find((model) => model.id === selected);
  return (
    <div className={`model-picker model-picker-${variant}`}>
      <button ref={trigger} type="button" aria-expanded={open} aria-haspopup="dialog" aria-controls={popoverId}
        className={variant === "add" ? "composer-model-add" : `composer-model-token${variant === "primary" ? " primary" : ""}`}
        title={variant === "add" ? "비교할 모델 추가" : selected ? `${modelLabel(selected)} · ${selected}` : "모델 선택"}
        aria-label={variant === "add" ? "비교할 모델 추가" : undefined}
        onKeyDown={(event) => {
          if (!disabled && ["ArrowDown", "Enter", " "].includes(event.key) && !open) {
            event.preventDefault(); setOpen(true);
          }
        }}
        onClick={() => { if (!disabled) setOpen(!open); }} disabled={disabled}
      >
        {variant === "add" ? <><Plus size={14} aria-hidden="true" />
          {!compare || compare.ids.length < 2 ? <span className="composer-model-add-label">비교할 모델</span> : null}</>
          : <>
            {variant === "primary" && <span className="sr-only">대화 모델 </span>}
            <span className="composer-model-token-text">{selected ? `@${selected}` : "모델 선택"}</span>
            {selected && hasNativeWebSearch(selectedModel) && <Globe2 className="model-trigger-web" size={12} aria-label="직접 웹검색" />}
            {variant === "primary" && <ChevronDown size={13} aria-hidden="true" />}
          </>}
      </button>
      {open && <div className="model-popover" id={popoverId} role="dialog" aria-modal="true" aria-label="모델 선택" ref={popover} tabIndex={-1}>
        <div className="model-search"><Search size={15} aria-hidden="true" />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); setStatus(""); }} aria-label="모델 검색"
            role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-describedby={hintId}
            aria-activedescendant={options.length ? `${listId}-${activeIndex}` : undefined}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              const current = options[activeIndex];
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && options.length) {
                event.preventDefault();
                setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
                  : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
              } else if (event.key === "Enter" && current) {
                event.preventDefault();
                if (event.altKey) toggleFavorite(current.id);
                else if (event.shiftKey) addToCompare(current);
                else choose(current);
              }
            }}
            placeholder="모델 이름 또는 ID 검색" autoFocus />
        </div>
        <div className="model-count"><span>현재 API 키로 사용 가능한 모델</span><span className="mono">{chatModels.length}개</span></div>
        <div className="model-options">
          {/* The listbox owns only groups and options. Favorite stars are siblings in the same grid rows. */}
          <div className="model-listbox" id={listId} role="listbox" aria-label="사용 가능한 모델">
            {Object.entries(groups).map(([provider, items]) => {
              const headingRow = rowOf.get(provider)!;
              return <div key={provider} className="model-group-block" role="group" aria-label={provider}>
                <div className="model-group" aria-hidden="true" style={{ gridRow: headingRow }}>{provider}</div>
                {items.map((model) => {
                  const index = options.indexOf(model);
                  const reason = unavailable?.(model);
                  const chosen = model.id === selected || compare?.ids.includes(model.id);
                  return <div id={`${listId}-${index}`} role="option" aria-selected={model.id === selected} key={model.id}
                    aria-disabled={reason ? true : undefined} title={reason} style={{ gridRow: headingRow + 1 + items.indexOf(model) }}
                    className={`model-option${model.id === selected ? " selected" : ""}${index === activeIndex ? " keyboard-active" : ""}`}
                    onMouseDown={(event) => event.preventDefault()} onClick={() => { setActive(index); choose(model); }}>
                    <span className="model-option-name"><strong>{modelLabel(model.id)}</strong>
                      <small className="model-option-id">{model.id}</small></span>
                    <span className="model-badges">
                      {hasNativeWebSearch(model) && <span className="native-search-badge">
                        <Globe2 size={12} aria-hidden="true" />직접 웹검색
                      </span>}
                      {reasoningSupport(model) === "adjustable" && <span className="reasoning-badge">
                        <Sparkles size={12} aria-hidden="true" />강도 조절
                      </span>}
                      {reasoningSupport(model) === "native-required" && <span className="reasoning-badge automatic">
                        <Sparkles size={12} aria-hidden="true" />사고 지원 · 자동
                      </span>}
                      {reasoningSupport(model) === "model-managed" && <span className="reasoning-badge automatic">
                        <Sparkles size={12} aria-hidden="true" />사고 가능 · 모델 자동
                      </span>}
                      {isRecentlyAdded(model.created) && <span className="new-model-badge">신규</span>}
                      {reason && <span className="unavailable-badge">공통 근거 전용 비교 미지원</span>}
                    </span>
                    {chosen && <Check className="model-option-check" size={15} aria-hidden="true" />}
                  </div>;
                })}
              </div>;
            })}
          </div>
          {Object.entries(groups).flatMap(([provider, items]) => items.map((model, itemIndex) => {
            const favorite = preferences.favorites.includes(model.id);
            return <button type="button" className="model-favorite-action" aria-pressed={favorite} key={model.id}
              style={{ gridRow: rowOf.get(provider)! + 1 + itemIndex }} onClick={() => toggleFavorite(model.id)}>
              <Star size={14} aria-hidden="true" fill={favorite ? "currentColor" : "none"} />
              <span className="sr-only">{modelLabel(model.id)} 즐겨찾기 {favorite ? "해제" : "추가"}</span></button>;
          }))}
        </div>
        {!filtered.length && <div className="empty-models" role="status">검색 결과가 없습니다.</div>}
        <div className="model-picker-status" role="status" aria-live="polite">{status}</div>
        <div className="model-permission-note">표시되는 모델은 현재 API 키의 조직·그룹 권한에 따라 달라집니다.</div>
        <div className="model-picker-footer" id={hintId}><span>↑↓ 이동 · ↵ 선택</span><span>⇧↵ 비교에 추가 · ⌥↵ 즐겨찾기</span></div>
      </div>}
    </div>
  );
}
