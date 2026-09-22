import { createContext } from "react";
export const ModelPreferences = createContext<{
  favorites: string[]; recent: string[];
  update: (id: string, action: "favorite" | "recent") => void;
}>({ favorites: [], recent: [], update: () => {} });
