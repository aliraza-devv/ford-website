"use client";

import { useEffect, useRef, useState } from "react";
import { HERO_COPY } from "@/lib/theme";

// No audio asset shipped in public/ yet -- wire a real V8 idle loop here
// once one exists (e.g. "/audio/v8-idle.mp3") and this stub starts working
// with no other changes needed.
const ENGINE_SOUND_SRC: string | null = null;

/**
 * Bottom-left, Step 7. UI and interaction are fully built; the handler is
 * stubbed until an audio asset is added (see ENGINE_SOUND_SRC above).
 */
export function AudioToggle() {
  const [active, setActive] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!ENGINE_SOUND_SRC) return;
    if (active) {
      audioRef.current?.play().catch(() => {});
    } else {
      audioRef.current?.pause();
    }
  }, [active]);

  return (
    <div className="pointer-events-auto flex items-center gap-3">
      {ENGINE_SOUND_SRC && <audio ref={audioRef} src={ENGINE_SOUND_SRC} loop />}
      <button
        type="button"
        data-cursor-hover
        onClick={() => setActive((a) => !a)}
        className="flex items-center gap-3"
        aria-pressed={active}
        aria-label="Toggle engine sound"
      >
        <span className="flex h-4 items-end gap-[3px]">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-[1px] bg-ford-grabber transition-[height,opacity] duration-300"
              style={{
                height: active ? undefined : "3px",
                opacity: active ? 1 : 0.35,
                animation: active ? `eq-bar 0.9s ease-in-out ${i * 0.12}s infinite alternate` : "none",
              }}
            />
          ))}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">
          {HERO_COPY.audioLabel}
        </span>
      </button>
    </div>
  );
}
