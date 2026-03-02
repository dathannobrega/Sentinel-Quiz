import { useCallback, useEffect, useRef } from "react";

export function useEffectEvent<Args extends unknown[], Return>(
  handler: (...args: Args) => Return
): (...args: Args) => Return {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  return useCallback((...args: Args) => handlerRef.current(...args), []);
}
