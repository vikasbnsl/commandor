import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function getCurrentFinderPath(debugMode = false): Promise<string | null> {
  try {
    const script = `
        tell application "Finder"
          try
            if (count of selection) > 0 then
              set sel to item 1 of selection
              if class of sel is folder then
                return POSIX path of (sel as alias)
              else
                return POSIX path of (container of sel as alias)
              end if
            else if (count of windows) > 0 then
              return POSIX path of (target of front window as alias)
            else
              return POSIX path of desktop
            end if
          on error errMsg
            return ""
          end try
        end tell
      `;

    const { stdout } = await execAsync(`osascript -e '${script}'`);
    const path = stdout.trim();

    if (debugMode) {
      console.log("Finder path detected:", path);
    }

    return path || null;
  } catch (error) {
    if (debugMode) {
      console.log("Error detecting Finder path:", error);
    }
    return null;
  }
}
