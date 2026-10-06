// MV3 service workers have no `document`. Some libraries we bundle into the
// worker (notably `decode-named-character-reference` via the remark/micromark
// chain pulled in by LocalSource) touch `document.createElement` at
// module-init time and crash the worker before our code runs.
//
// We provide a minimal stub that satisfies the one call those libraries make
// (`document.createElement(tag)` returning an object whose `innerHTML` can be
// set and whose `textContent` can be read). That's enough for
// `decode-named-character-reference` to fall back to its hardcoded table.
//
// This file MUST be imported before anything that may transitively pull in
// the offending modules.

if (typeof globalThis !== "undefined" && typeof (globalThis as any).document === "undefined") {
  (globalThis as any).document = {
    createElement(_tagName: string) {
      let innerHTML = "";
      return {
        set innerHTML(html: string) {
          innerHTML = html;
        },
        get innerHTML() {
          return innerHTML;
        },
        get textContent() {
          // Naive decode: strip tags. The caller (decode-named-character-
          // reference) only inspects textContent for short HTML entity
          // fragments like "&amp;" which the browser would normally decode.
          // We don't attempt decoding here — the library has a fallback path
          // for environments without DOM-based decoding.
          return innerHTML.replace(/<[^>]*>/g, "");
        },
      };
    },
  };
}

export {};
