import { useState, useEffect } from "react";

// True while the viewport is at or below `px`. Used to swap a wide multi-column
// layout for a stacked one rather than letting it overflow into a horizontal
// scrollbar — a drag bar hides data behind a gesture people do not know exists.
//
// Pick the breakpoint by MEASURING the wide layout's real width in a browser, not
// from its declared minWidth: a table can declare 720px and occupy 1222px, and a
// breakpoint derived from the smaller number leaves a scrollbar in the gap.
export function useIsNarrow(px) {
  const query = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = e => setNarrow(e.matches);
    setNarrow(mq.matches);          // re-sync in case it changed before the effect ran
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return narrow;
}
