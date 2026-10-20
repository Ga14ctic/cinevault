import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api.js";

const ConfigContext = createContext({ cinesrc: null, siteName: "CineVault" });

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState({ cinesrc: null, siteName: "CineVault" });

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => {});
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  return useContext(ConfigContext);
}
