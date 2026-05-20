import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { playHandRaiseChime } from "@/lib/playHandRaiseChime";

type HandRow = { userId?: number; user_id?: number };

/** Play a chime when new students appear in the raised-hands list. */
export function useHandRaiseChime(raisedHands: HandRow[] | undefined, enabled: boolean): void {
  const seenRef = useRef<Set<number>>(new Set());
  const primedRef = useRef(false);

  useEffect(() => {
    if (!enabled || Platform.OS !== "web") return;
    const list = raisedHands ?? [];
    const ids = new Set(
      list.map((h) => Number(h.userId ?? h.user_id)).filter((id) => Number.isFinite(id))
    );

    if (!primedRef.current) {
      seenRef.current = ids;
      primedRef.current = true;
      return;
    }

    for (const id of ids) {
      if (!seenRef.current.has(id)) {
        playHandRaiseChime();
        break;
      }
    }
    seenRef.current = ids;
  }, [raisedHands, enabled]);
}
