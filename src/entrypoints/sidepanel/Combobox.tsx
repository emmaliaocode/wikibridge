import React, { useEffect, useRef, useState } from "react";

export type ComboboxItem = {
  id: string;
  primary: string; // bigger text shown on the left
  secondary?: string; // smaller text shown on the right (key / id / hint)
};

export type ComboboxProps = {
  // Current input text (what the user has typed, or the label of the picked
  // item — managed by the caller so the caller can override / persist it).
  query: string;
  onQueryChange: (next: string) => void;

  // Items to display in the dropdown.
  items: ComboboxItem[];

  // Fires when the user picks one. Caller is responsible for whatever side
  // effects (saving an id, updating the query label, etc.).
  onPick: (item: ComboboxItem) => void;

  // Optional: fires when the input gains focus. Useful for triggering an
  // initial fetch (e.g. blank-query Notion search) or re-opening the menu.
  onFocus?: () => void;

  placeholder?: string;
  disabled?: boolean;

  // When true, the input shows a loading hint and disables typing.
  loading?: boolean;
  loadingText?: string;

  // Optional message shown beneath the dropdown when items is empty after a
  // query (e.g. "No matching spaces.").
  emptyText?: string;

  // Optional fixed-height max so long lists scroll. Defaults to 220px.
  maxHeight?: number;
};

export function Combobox({
  query,
  onQueryChange,
  items,
  onPick,
  onFocus,
  placeholder,
  disabled,
  loading,
  loadingText,
  emptyText = "No matches.",
  maxHeight = 220,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          onFocus?.();
        }}
        onBlur={() => {
          // Defer collapse so onMouseDown on a list item still fires.
          if (blurTimer.current) clearTimeout(blurTimer.current);
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        placeholder={loading ? (loadingText ?? "Loading…") : placeholder}
        disabled={disabled || loading}
        style={textInputStyle}
      />
      {open && !loading && (items.length > 0 || query.length > 0) && (
        <div style={{ ...dropdownStyle, maxHeight }}>
          {items.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: 8,
                fontSize: 12,
                color: "#888",
              }}
            >
              {emptyText}
            </p>
          ) : (
            items.map((it) => (
              <button
                key={it.id}
                // onMouseDown so the click registers before input's onBlur.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(it);
                  setOpen(false);
                }}
                style={dropdownItemStyle}
              >
                <span style={{ fontSize: 13 }}>{it.primary}</span>
                {it.secondary && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "#888",
                      marginLeft: 8,
                    }}
                  >
                    {it.secondary}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export const textInputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 13,
  boxSizing: "border-box",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  top: "100%",
  marginTop: 2,
  overflowY: "auto",
  background: "white",
  border: "1px solid #ccc",
  borderRadius: 6,
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  zIndex: 10,
};

const dropdownItemStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  padding: "6px 10px",
  border: 0,
  borderBottom: "1px solid #f0f0f0",
  background: "white",
  cursor: "pointer",
  textAlign: "left",
};
