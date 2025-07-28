import { getSelectedFinderItems } from "@raycast/api";


export async function getCurrentFinderPath(debugMode = false): Promise<string | null> {
  try {
    const selected = await getSelectedFinderItems();
    const path = selected[0].path;

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
