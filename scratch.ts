import { spawnSync } from "child_process";
import { existsSync } from "fs";

function findCliPath(name: string): string | null {
    
      const result = spawnSync("which", [name], { encoding: "utf-8" });
      if (result.status === 0 && result.stdout) {
        const cliPath = result.stdout.trim();
        if (cliPath && existsSync(cliPath)) {
          return cliPath;
        }
      }
    return null;
  }
  
console.log(findCliPath("codei"));