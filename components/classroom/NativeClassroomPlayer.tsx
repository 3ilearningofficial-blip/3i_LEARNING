import type React from "react";
import { Platform } from "react-native";
import type { Props } from "./NativeClassroomPlayer.types";

const NativeClassroomPlayer =
  Platform.OS === "web"
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("./NativeClassroomPlayer.web").default
    : // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("./NativeClassroomPlayer.native").default;

export type { Props };
export default NativeClassroomPlayer as React.ComponentType<Props>;
