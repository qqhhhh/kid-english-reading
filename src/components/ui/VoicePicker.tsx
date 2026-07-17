import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { TtsVoice } from "../../lib/types";

export type VoicePickerProps = {
  label: string;
  voices: TtsVoice[];
  value: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
  className?: string;
};

export function VoicePicker({ label, voices, value, onChange, disabled = false, className = "" }: VoicePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    voices.findIndex((voice) => voice.id === value)
  );
  const selectedVoice = voices[selectedIndex];
  const selectedLabel = selectedVoice ? `${selectedVoice.name} - ${selectedVoice.description}` : "";

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const animationFrame = window.requestAnimationFrame(() => optionRefs.current[activeIndex]?.focus());
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeIndex, isOpen]);

  const rootClassName = useMemo(
    () => ["voice-picker", "compact-voice-picker", "ui-voice-pill", isOpen ? "open" : "", className].filter(Boolean).join(" "),
    [className, isOpen]
  );

  function openMenu(nextIndex = selectedIndex) {
    if (disabled || voices.length === 0) return;
    setActiveIndex(nextIndex);
    setIsOpen(true);
  }

  function closeMenu(restoreFocus = false) {
    setIsOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function selectVoice(voiceId: string) {
    onChange(voiceId);
    closeMenu(true);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const fallbackIndex = event.key === "ArrowDown" ? 0 : voices.length - 1;
      openMenu(value ? selectedIndex : fallbackIndex);
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, optionIndex: number) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectVoice(voices[optionIndex].id);
      return;
    }

    let nextIndex = optionIndex;
    if (event.key === "ArrowDown") nextIndex = (optionIndex + 1) % voices.length;
    else if (event.key === "ArrowUp") nextIndex = (optionIndex - 1 + voices.length) % voices.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = voices.length - 1;
    else return;

    event.preventDefault();
    setActiveIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div className={rootClassName} ref={rootRef}>
      <span className="voice-picker-label">{label}</span>
      <button
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`${label}: ${selectedLabel}`}
        className="voice-picker-trigger"
        disabled={disabled || voices.length === 0}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span className="voice-picker-value" title={selectedLabel}>
          {selectedLabel}
        </span>
        <ChevronDown aria-hidden="true" className="voice-picker-chevron" size={16} />
      </button>

      {isOpen ? (
        <div className="voice-picker-menu" id={listboxId} role="listbox" aria-label={label}>
          {voices.map((voice, optionIndex) => {
            const isSelected = voice.id === value;
            return (
              <button
                aria-selected={isSelected}
                className={`voice-picker-option ${isSelected ? "selected" : ""}`}
                key={voice.id}
                onClick={() => selectVoice(voice.id)}
                onKeyDown={(event) => handleOptionKeyDown(event, optionIndex)}
                ref={(element) => {
                  optionRefs.current[optionIndex] = element;
                }}
                role="option"
                tabIndex={optionIndex === activeIndex ? 0 : -1}
                type="button"
              >
                <span>
                  <strong>{voice.name}</strong>
                  <small>{voice.description}</small>
                </span>
                <Check aria-hidden="true" className="voice-picker-check" size={16} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
