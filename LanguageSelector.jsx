import React from "react";
import { LANGUES } from "./i18n.js";

export default function LanguageSelector({ langue, onChange, style }) {
  return (
    <select
      value={langue}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "6px 10px", borderRadius: 8, border: "1px solid #E4DDD0", background: "#FFFEFB",
        fontSize: 12.5, color: "#16213E", fontFamily: "'Inter', sans-serif", cursor: "pointer", outline: "none",
        ...style,
      }}
    >
      {LANGUES.map((l) => (
        <option key={l.id} value={l.id}>{l.label}</option>
      ))}
    </select>
  );
}
