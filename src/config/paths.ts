import { homedir } from "node:os";
import { join } from "node:path";

export interface ArkSpacePaths {
  home: string;
  config: string;
  state: string;
}

export function resolveArkSpacePaths(environment: NodeJS.ProcessEnv = process.env): ArkSpacePaths {
  const home = environment.ARKSPACE_HOME ?? defaultArkSpaceHome(environment);
  return {
    home,
    config: join(home, "config.json"),
    state: join(home, "state.json"),
  };
}

function defaultArkSpaceHome(environment: NodeJS.ProcessEnv): string {
  if (process.platform === "win32") {
    const appData = environment.APPDATA;
    if (appData) return join(appData, "ArkSpace");
  }
  const configHome = environment.XDG_CONFIG_HOME;
  return configHome ? join(configHome, "arkspace") : join(homedir(), ".config", "arkspace");
}
