"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { sleepOptionMinutes, startSleepTimer, type SleepTimerHandle, type SleepTimerOption } from "@/features/reading/lib/sleep-timer";

export interface UseSleepTimerOptions {
  /** Volume to apply while fading (1 = normal). */
  onVolume: (volume: number) => void;
  /** Time is up: pause playback. */
  onExpire: () => void;
}

/** React wrapper: the selected option, the remaining time (whole seconds) and the end-of-section flag. */
export function useSleepTimer({ onVolume, onExpire }: UseSleepTimerOptions) {
  const [option, setOptionState] = useState<SleepTimerOption>("off");
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const handleRef = useRef<SleepTimerHandle | null>(null);
  const callbacksRef = useRef({ onVolume, onExpire });
  useEffect(() => {
    callbacksRef.current = { onVolume, onExpire };
  });

  const clear = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
    setRemainingSeconds(null);
    callbacksRef.current.onVolume(1);
  }, []);

  const setOption = useCallback(
    (next: SleepTimerOption) => {
      clear();
      setOptionState(next);
      const minutes = sleepOptionMinutes(next);
      if (minutes === null) {
        return;
      }
      setRemainingSeconds(minutes * 60);
      handleRef.current = startSleepTimer(minutes * 60_000, {
        onTick: (remainingMs, volume) => {
          const seconds = Math.ceil(remainingMs / 1000);
          setRemainingSeconds((previous) => (previous === seconds ? previous : seconds));
          callbacksRef.current.onVolume(volume);
        },
        onExpire: () => {
          handleRef.current = null;
          setOptionState("off");
          setRemainingSeconds(null);
          callbacksRef.current.onExpire();
          callbacksRef.current.onVolume(1);
        }
      });
    },
    [clear]
  );

  /** Called when the section ends: true when the timer was "end of section" (and resets it). */
  const consumeEndOfSection = useCallback(() => {
    if (option !== "section") {
      return false;
    }
    setOptionState("off");
    return true;
  }, [option]);

  useEffect(() => () => handleRef.current?.cancel(), []);

  return { option, setOption, remainingSeconds, consumeEndOfSection };
}
