import { getSelectedFinderItems } from "@raycast/api";


export async function getCurrentFinderPath(debugMode = false): Promise<string | null> {
  try {
    const selected = await getSelectedFinderItems();
    let path: string | undefined;
    if (selected && selected.length > 0) {
      const itemPath = selected[0].path;
      if (itemPath) {
        const isFile = itemPath && !itemPath.endsWith("/");
        path = isFile ? itemPath.substring(0, itemPath.lastIndexOf("/")) : itemPath;
      }
    }

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
