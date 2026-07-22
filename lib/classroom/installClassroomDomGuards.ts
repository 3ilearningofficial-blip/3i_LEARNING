/**
 * Browser console spam from tldraw / gesture handlers:
 * "Unable to preventDefault inside passive event listener"
 *
 * Two cooperating patches (idempotent, web-only):
 * 1) Force `{ passive: false }` on touch/wheel listeners so preventDefault can work.
 * 2) No-op `preventDefault` when the event is already non-cancelable (Chrome
 *    Intervention on touchend during scroll) — matches tldraw upstream guard.
 */
import { Platform } from "react-native";

let installed = false;

const NON_PASSIVE_EVENTS = new Set([
  "touchstart",
  "touchmove",
  "touchend",
  "touchcancel",
  "wheel",
  "mousewheel",
]);

export function installClassroomDomGuards(): void {
  if (installed || Platform.OS !== "web") return;
  if (typeof EventTarget === "undefined" || typeof Event === "undefined") return;
  installed = true;

  const proto = EventTarget.prototype as typeof EventTarget.prototype & {
    __classroomAddEventListener?: EventTarget["addEventListener"];
  };
  if (!proto.__classroomAddEventListener) {
    const originalAdd = proto.addEventListener;
    proto.__classroomAddEventListener = originalAdd;
    proto.addEventListener = function patchedAddEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ) {
      if (NON_PASSIVE_EVENTS.has(type) && options !== false) {
        // Always force passive:false — even if the caller set passive:true.
        const nextOptions =
          typeof options === "object" && options !== null
            ? { ...options, passive: false }
            : { capture: options === true, passive: false };
        return originalAdd.call(this, type, listener, nextOptions);
      }
      return originalAdd.call(this, type, listener, options);
    };
  }

  const eventProto = Event.prototype as Event & {
    __classroomPreventDefault?: Event["preventDefault"];
  };
  if (!eventProto.__classroomPreventDefault) {
    const originalPrevent = eventProto.preventDefault;
    eventProto.__classroomPreventDefault = originalPrevent;
    eventProto.preventDefault = function patchedPreventDefault(this: Event) {
      if (this.cancelable === false) return;
      return originalPrevent.call(this);
    };
  }
}
