import { Check, ChevronDown, Globe2, Search, Sparkles, Star } from "lucide-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { reasoningSupport } from "../../shared/chat-options";
import type { GatewayModel } from "../../shared/contracts";
import { isRecentlyAdded } from "../../shared/media-capabilities";
import { hasNativeWebSearch } from "../../shared/web-search";
import { modelLabel, providerLabel } from "./model-names";
import { ModelPreferences } from "./model-preferences";
import { useFocusLayer } from "./use-focus-layer";

export function ModelPicker({
  models, selected, onSelect, disabled = false
}: {
  models: GatewayModel[]; selected: string; onSelect: (id: string) => void; disabled?: boolean;
}) {
  const preferences = useContext(ModelPreferences);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const popoverId = useMemo(() => `model-picker-${crypto.randomUUID()}`, []);
  const { ref: popover, requestClose } = useFocusLayer<HTMLDivElement>({
    active: open, mode: "modal", closeOnOutside: true, restoreTo: trigger,
    onClose: () => { setOpen(false); setQuery(""); }
  });
  const priority = (id: string) => preferences.favorites.includes(id) ? 0 : preferences.recent.includes(id) ? 1 : 2;
  const filtered = [...models].sort((a, b) => priority(a.id) - priority(b.id) ||
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
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));
  const listId = `${popoverId}-options`;
  const choose = (id: string) => { preferences.update(id, "recent"); onSelect(id); requestClose("programmatic", true); };
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, listId]);
  return (
    <div className="model-picker">
      <button ref={trigger}
        className="model-trigger" type="button" aria-expanded={open} aria-haspopup="dialog"
        aria-controls={popoverId}
        onKeyDown={(event) => {
          if (!disabled && ["ArrowDown", "Enter", " "].includes(event.key) && !open) {
            event.preventDefault(); setOpen(true);
          }
        }}
        onClick={() => { if (!disabled) setOpen(!open); }} disabled={disabled}
      >
        <span className="model-dot" />
        <span className="model-trigger-text">{selected ? modelLabel(selected) : "모델 선택"}</span>
        {selected && hasNativeWebSearch(selected) && <Globe2 className="model-trigger-web" size={14} />}
        <ChevronDown size={16} />
      </button>
      {open && <div className="model-popover" id={popoverId} role="dialog" aria-modal="true" aria-label="모델 선택" ref={popover} tabIndex={-1}>
        <div className="model-search"><Search size={16} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} aria-label="모델 검색"
            role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId}
            aria-activedescendant={options.length ? `${listId}-${activeIndex}` : undefined}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && options.length) {
                event.preventDefault();
                setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
                  : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
              } else if (event.key === "Enter" && options[activeIndex]) {
                event.preventDefault(); choose(options[activeIndex].id);
              }
            }}
            placeholder="모델 이름 또는 ID 검색" autoFocus />
        </div>
        {options[activeIndex] && <button type="button" className="secondary-button model-favorite-action"
          aria-pressed={preferences.favorites.includes(options[activeIndex].id)}
          onClick={() => preferences.update(options[activeIndex].id, "favorite")}>
          <Star size={14} />{modelLabel(options[activeIndex].id)} 즐겨찾기 {preferences.favorites.includes(options[activeIndex].id) ? "해제" : "추가"}</button>}
        <div className="model-count">현재 API 키로 사용 가능한 모델 {models.length}개</div>
        <div className="model-options" id={listId} role="listbox" aria-label="사용 가능한 모델">
          {Object.entries(groups).map(([provider, items]) => (
            <div key={provider} role="group" aria-label={provider}>
              <div className="model-group" aria-hidden="true">{provider}</div>
              {items.map((model) => <button
                type="button" tabIndex={-1} id={`${listId}-${options.indexOf(model)}`}
                className={`model-option${model.id === selected ? " selected" : ""}${options[activeIndex]?.id === model.id ? " keyboard-active" : ""}`}
                role="option" aria-selected={model.id === selected}
                key={model.id} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(model.id)}
              >
                <span title={model.id}><strong>{modelLabel(model.id)}</strong></span>
                <span className="model-badges">
                  {hasNativeWebSearch(model.id) && <span className="native-search-badge">
                    <Globe2 size={12} />직접 웹검색
                  </span>}
                  {reasoningSupport(model) === "adjustable" && <span className="reasoning-badge">
                    <Sparkles size={12} />강도 조절
                  </span>}
                  {reasoningSupport(model) === "native-required" && <span className="reasoning-badge automatic">
                    <Sparkles size={12} />사고 지원 · 자동
                  </span>}
                  {reasoningSupport(model) === "model-managed" && <span className="reasoning-badge automatic">
                    <Sparkles size={12} />사고 가능 · 모델 자동
                  </span>}
                  {isRecentlyAdded(model.created) && <span className="new-model-badge">신규</span>}
                </span>
                {model.id === selected && <Check size={17} />}
              </button>)}
            </div>
          ))}
        </div>
        {!filtered.length && <div className="empty-models" role="status">검색 결과가 없습니다.</div>}
        <div className="model-permission-note">표시되는 모델은 현재 API 키의 조직·그룹 권한에 따라 달라집니다.</div>
        <button type="button" className="secondary-button" onClick={() => requestClose("programmatic", true)}>닫기</button>
      </div>}
    </div>
  );
}
