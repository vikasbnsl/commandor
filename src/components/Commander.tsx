import React, { useState, useEffect } from "react";
import {
  ActionPanel,
  Action,
  List,
  showToast,
  Toast,
  getPreferenceValues,
  Icon,
  Color,
  confirmAlert,
  Alert,
  Clipboard,
  Detail,
} from "@raycast/api";
import { exec } from "child_process";
import { promisify } from "util";
import { LocalStorage } from "@raycast/api";
import { CommandHistory, Preferences } from "../types";
import { getCurrentFinderPath } from "../utils/finder";

const execAsync = promisify(exec);

export default function Commander() {
  const [commandHistory, setCommandHistory] = useState<CommandHistory[]>([]);
  const [searchText, setSearchText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastExecutedCommand, setLastExecutedCommand] = useState<string | null>(null);
  const [showDetailView, setShowDetailView] = useState(false);
  const [selectedCommand, setSelectedCommand] = useState<CommandHistory | null>(null);
  const [preferences, setPreferences] = useState<Preferences>({
    maxHistorySize: 50,
    defaultShell: "/bin/zsh",
    shellProfile: "",
    debugMode: false,
  });

  // Load preferences and history on component mount
  useEffect(() => {
    loadPreferences();
    loadCommandHistory();
  }, []);

  const loadPreferences = async () => {
    try {
      const prefs = getPreferenceValues<Preferences>();
      setPreferences(prefs);
    } catch {
      console.log("Using default preferences");
    }
  };

  const loadCommandHistory = async () => {
    try {
      const history = await LocalStorage.getItem<string>("commandHistory");
      if (history) {
        setCommandHistory(JSON.parse(history));
      }
    } catch {
      console.log("No command history found");
    }
  };

  const saveCommandHistory = async (history: CommandHistory[]) => {
    try {
      await LocalStorage.setItem("commandHistory", JSON.stringify(history));
    } catch (error) {
      console.error("Failed to save command history:", error);
    }
  };

  const updateCommandHistory = (command: string, output?: string, error?: string, executionPath?: string) => {
    const now = Date.now();
    const newHistory = [...commandHistory];

    // Find existing command
    const existingIndex = newHistory.findIndex((item) => item.command === command);

    if (existingIndex !== -1) {
      // Update existing command
      newHistory[existingIndex] = {
        ...newHistory[existingIndex],
        lastUsed: now,
        useCount: newHistory[existingIndex].useCount + 1,
        output,
        error,
        executionPath,
      };
    } else {
      // Add new command
      newHistory.push({
        command,
        lastUsed: now,
        useCount: 1,
        output,
        error,
        executionPath,
      });
    }

    // Sort by most recently used first (reverse the order)
    newHistory.sort((a, b) => b.lastUsed - a.lastUsed);

    // Limit history size
    if (newHistory.length > preferences.maxHistorySize) {
      newHistory.splice(preferences.maxHistorySize);
    }

    setCommandHistory(newHistory);
    saveCommandHistory(newHistory);
  };

  const executeCommand = async (command: string) => {
    setIsLoading(true);

    try {
      await showToast({
        style: Toast.Style.Animated,
        title: "Executing command...",
        message: command,
      });

      // Check if Finder is in focus and get the current path
      const finderPath = await getCurrentFinderPath();

      // Build the command with comprehensive shell initialization
      let finalCommand = command;

      if (preferences.shellProfile && preferences.shellProfile.trim()) {
        // Use specified profile
        finalCommand = `source ${preferences.shellProfile} && ${command}`;
      } else {
        // Simplified initialization - let's test if this works better
        if (preferences.defaultShell.includes("zsh")) {
          finalCommand = `source ~/.zshrc 2>/dev/null; ${command}`;
        } else if (preferences.defaultShell.includes("bash")) {
          finalCommand = `source ~/.bash_profile 2>/dev/null || source ~/.bashrc 2>/dev/null; ${command}`;
        }
      }

      // If we have a Finder path, prepend cd command
      if (finderPath && finderPath.trim()) {
        finalCommand = `cd "${finderPath}" && ${finalCommand}`;

        if (preferences.debugMode) {
          console.log("Executing in Finder directory:", finderPath);
        }
      }

      // Debug logging
      if (preferences.debugMode) {
        console.log("Executing command:", finalCommand);
        console.log("Shell:", preferences.defaultShell);
        console.log("Environment PATH:", process.env.PATH);
      }

      const { stdout, stderr } = await execAsync(finalCommand, {
        shell: preferences.defaultShell,
        timeout: 30000, // 30 second timeout
        env: {
          ...process.env,
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USER: process.env.USER,
          NVM_DIR: process.env.NVM_DIR || `${process.env.HOME}/.nvm`,
        },
      });

      // Debug logging for output
      console.log("Raw command output:", {
        stdout: `"${stdout}"`,
        stderr: `"${stderr}"`,
        stdoutLength: stdout?.length,
        stderrLength: stderr?.length,
        command,
      });

      if (stderr) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Command completed with warnings",
          message: stderr,
        });
      } else {
        await showToast({
          style: Toast.Style.Success,
          title: "Command executed successfully",
        });
      }

      updateCommandHistory(command, stdout, stderr, finderPath || undefined);

      // Set the last executed command to highlight it in the UI
      setLastExecutedCommand(command);

      // Show detail view with the command result
      const executedCommand = {
        command,
        lastUsed: Date.now(),
        useCount: 1,
        output: stdout,
        error: stderr,
        executionPath: finderPath || undefined,
      };
      setSelectedCommand(executedCommand);
      setShowDetailView(true);

      // Debug logging for output
      if (preferences.debugMode) {
        console.log("Command output:", { stdout, stderr, command });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      let suggestion = "";

      // Provide helpful suggestions for common issues
      if (errorMessage.includes("command not found")) {
        suggestion = "Try setting a shell profile in preferences (e.g., ~/.zshrc)";
      } else if (errorMessage.includes("permission denied")) {
        suggestion = "Check if the command requires elevated permissions";
      }

      await showToast({
        style: Toast.Style.Failure,
        title: "Command failed",
        message: suggestion ? `${errorMessage}\n\n💡 ${suggestion}` : errorMessage,
      });

      updateCommandHistory(command, undefined, errorMessage);

      // Set the last executed command even for failed commands
      setLastExecutedCommand(command);

      // Show detail view with the error result
      const failedCommand = {
        command,
        lastUsed: Date.now(),
        useCount: 1,
        output: undefined,
        error: errorMessage,
        executionPath: undefined,
      };
      setSelectedCommand(failedCommand);
      setShowDetailView(true);

      // Debug logging for errors
      if (preferences.debugMode) {
        console.log("Command error:", { errorMessage, command });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const deleteCommand = async (command: string) => {
    const confirmed = await confirmAlert({
      title: "Delete Command",
      message: `Are you sure you want to delete "${command}" from history?`,
      primaryAction: {
        title: "Delete",
        style: Alert.ActionStyle.Destructive,
      },
    });

    if (confirmed) {
      const newHistory = commandHistory.filter((item) => item.command !== command);
      setCommandHistory(newHistory);
      saveCommandHistory(newHistory);

      await showToast({
        style: Toast.Style.Success,
        title: "Command deleted from history",
      });
    }
  };

  const clearHistory = async () => {
    const confirmed = await confirmAlert({
      title: "Clear History",
      message: "Are you sure you want to clear all command history?",
      primaryAction: {
        title: "Clear All",
        style: Alert.ActionStyle.Destructive,
      },
    });

    if (confirmed) {
      setCommandHistory([]);
      saveCommandHistory([]);

      await showToast({
        style: Toast.Style.Success,
        title: "Command history cleared",
      });
    }
  };

  const filteredHistory = commandHistory.filter((item) =>
    item.command.toLowerCase().includes(searchText.toLowerCase()),
  );

  // Detail view for command output
  if (showDetailView && selectedCommand) {
    const formatOutput = (output: string | undefined, error: string | undefined) => {
      if (error) {
        return `## ❌ Error\n\n\`\`\`\n${error}\n\`\`\``;
      }
      if (output !== undefined) {
        return `## ✅ Output\n\n\`\`\`\n${output || "No output"}\n\`\`\``;
      }
      return `## ℹ️ No Output Data\n\nThis command was executed before output tracking was enabled.`;
    };

    const markdown = `
# ${selectedCommand.command}

**Last executed:** ${new Date(selectedCommand.lastUsed).toLocaleString()}
**Execution Path:** ${selectedCommand.executionPath || "N/A"}

---

${formatOutput(selectedCommand.output, selectedCommand.error)}
    `.trim();

    return (
      <Detail
        markdown={markdown}
        actions={
          <ActionPanel>
            <Action
              title="Back to List"
              icon={Icon.ArrowLeft}
              onAction={() => setShowDetailView(false)}
            />
            <Action
              title="Execute Again"
              icon={Icon.Play}
              onAction={() => {
                setShowDetailView(false);
                executeCommand(selectedCommand.command);
              }}
            />
            <Action
              title="Copy Command"
              icon={Icon.CopyClipboard}
              onAction={async () => {
                await Clipboard.copy(selectedCommand.command);
                await showToast({
                  style: Toast.Style.Success,
                  title: "Command copied to clipboard",
                });
              }}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
            {(selectedCommand.output || selectedCommand.error) && (
              <Action
                title="Copy Output"
                icon={Icon.Document}
                onAction={async () => {
                  await Clipboard.copy(selectedCommand.output || selectedCommand.error || "");
                  await showToast({
                    style: Toast.Style.Success,
                    title: "Output copied to clipboard",
                  });
                }}
                shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              />
            )}
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Type a command or search history..."
      searchText={searchText}
      onSearchTextChange={setSearchText}
      actions={
        <ActionPanel>
          <Action
            title="Execute Command"
            icon={Icon.Play}
            onAction={() => {
              if (searchText.trim()) {
                executeCommand(searchText.trim());
                setSearchText("");
              }
            }}
            shortcut={{ modifiers: ["cmd"], key: "enter" }}
          />
          <Action
            title="Clear History"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={clearHistory}
            shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
          />
          <Action
            title="Test Environment"
            icon={Icon.Gear}
            onAction={async () => {
              await executeCommand("echo $PATH && which node && node --version");
            }}
          />
          <Action
            title="Simple Test"
            icon={Icon.ArrowRight}
            onAction={async () => {
              await executeCommand("echo 'Hello World'");
            }}
          />
          <Action
            title="Node Version Test"
            icon={Icon.ArrowRight}
            onAction={async () => {
              await executeCommand("node -v");
            }}
          />
          <Action
            title="Direct Test (No Shell Init)"
            icon={Icon.ArrowRight}
            onAction={async () => {
              // Test direct execution without shell initialization
              try {
                const { stdout, stderr } = await execAsync("node -v", {
                  shell: preferences.defaultShell,
                  timeout: 30000,
                });
                console.log("Direct test output:", { stdout, stderr });
                updateCommandHistory("node -v (direct)", stdout, stderr);
                await showToast({
                  style: Toast.Style.Success,
                  title: "Direct test completed",
                  message: stdout || "No output",
                });
              } catch (error) {
                console.error("Direct test error:", error);
                updateCommandHistory(
                  "node -v (direct)",
                  undefined,
                  error instanceof Error ? error.message : "Unknown error",
                );
              }
            }}
          />
          <Action
            title="Test AppleScript Access"
            icon={Icon.Gear}
            onAction={async () => {
              try {
                await showToast({
                  style: Toast.Style.Animated,
                  title: "Testing AppleScript access...",
                });

                // Simple test to see if we can access Finder
                const testScript = `
                    tell application "Finder"
                      return "Success: " & (count of windows)
                    end tell
                  `;

                const { stdout } = await execAsync(`osascript -e '${testScript}'`);

                await showToast({
                  style: Toast.Style.Success,
                  title: "AppleScript Test",
                  message: `Result: ${stdout.trim()}`,
                });
              } catch (error) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "AppleScript Failed",
                  message: error instanceof Error ? error.message : "Unknown error",
                });
              }
            }}
          />
          <Action
            title="Detailed Path Debug"
            icon={Icon.MagnifyingGlass}
            onAction={async () => {
              setPreferences((prev) => ({ ...prev, debugMode: true }));

              try {
                await showToast({
                  style: Toast.Style.Animated,
                  title: "Detailed path debugging...",
                });

                // Test 1: Check frontmost app
                const frontAppTest = `
                    tell application "System Events"
                      return "Frontmost app: " & name of first application process whose frontmost is true
                    end tell
                  `;

                const { stdout: frontAppResult } = await execAsync(`osascript -e '${frontAppTest}'`);

                // Test 2: Check desktop selection specifically
                const desktopSelectionTest = `
                    tell application "Finder"
                      try
                        set desktopSelection to selection of desktop
                        if (count of desktopSelection) > 0 then
                          set sel to item 1 of desktopSelection
                          return "Desktop selection found: " & POSIX path of (sel as alias) & " | Class: " & class of sel
                        else
                          return "No desktop selection"
                        end if
                      on error errMsg
                        return "Desktop selection error: " & errMsg
                      end try
                    end tell
                  `;

                const { stdout: desktopSelectionResult } = await execAsync(`osascript -e '${desktopSelectionTest}'`);

                // Test 3: Check global selection
                const globalSelectionTest = `
                    tell application "Finder"
                      try
                        if (count of selection) > 0 then
                          set sel to item 1 of selection
                          set selPath to POSIX path of (sel as alias)
                          set desktopPath to POSIX path of desktop
                          return "Global selection: " & selPath & " | Is on desktop: " & (selPath starts with desktopPath) & " | Class: " & class of sel
                        else
                          return "No global selection"
                        end if
                      on error errMsg
                        return "Global selection error: " & errMsg
                      end try
                    end tell
                  `;

                const { stdout: globalSelectionResult } = await execAsync(`osascript -e '${globalSelectionTest}'`);

                // Test 4: Check Finder windows
                const windowTest = `
                    tell application "Finder"
                      try
                        if (count of windows) > 0 then
                          set frontWindow to front window
                          return "Front window target: " & POSIX path of (target of frontWindow as alias)
                        else
                          return "No Finder windows"
                        end if
                      on error errMsg
                        return "Window error: " & errMsg
                      end try
                    end tell
                  `;

                const { stdout: windowResult } = await execAsync(`osascript -e '${windowTest}'`);

                // Test 5: Get desktop path
                const desktopPathTest = `
                    tell application "Finder"
                      return "Desktop path: " & POSIX path of desktop
                    end tell
                  `;

                const { stdout: desktopPathResult } = await execAsync(`osascript -e '${desktopPathTest}'`);

                // Test 6: Try the actual path detection
                const path = await getCurrentFinderPath();

                const debugOutput = `Front App: ${frontAppResult.trim()}\n\nDesktop Selection: ${desktopSelectionResult.trim()}\n\nGlobal Selection: ${globalSelectionResult.trim()}\n\nFront Window: ${windowResult.trim()}\n\nDesktop Path: ${desktopPathResult.trim()}\n\nFinal Result: ${path || "null"}`;

                const debugResult = {
                  command: "Detailed Path Debug",
                  lastUsed: Date.now(),
                  useCount: 1,
                  output: debugOutput,
                  error: undefined,
                  executionPath: path || undefined,
                };
                setSelectedCommand(debugResult);
                setShowDetailView(true);
              } catch (error) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Debug failed",
                  message: error instanceof Error ? error.message : "Unknown error",
                });
              }
            }}
          />
          <Action
            title="Debug Path Detection"
            icon={Icon.Bug}
            onAction={async () => {
              setPreferences((prev) => ({ ...prev, debugMode: true }));

              try {
                await showToast({
                  style: Toast.Style.Animated,
                  title: "Testing path detection...",
                });

                // Test 1: Basic AppleScript execution
                const basicTest = `
                    tell application "Finder"
                      return "Finder is accessible"
                    end tell
                  `;

                const { stdout: basicResult } = await execAsync(`osascript -e '${basicTest}'`);

                // Test 2: Check which app is frontmost
                const frontAppTest = `
                    tell application "System Events"
                      return "Frontmost app: " & name of first application process whose frontmost is true
                    end tell
                  `;

                const { stdout: frontAppResult } = await execAsync(`osascript -e '${frontAppTest}'`);

                // Test 3: Check selection count
                const selectionTest = `
                    tell application "Finder"
                      return "Selection count: " & (count of selection)
                    end tell
                  `;

                const { stdout: selectionResult } = await execAsync(`osascript -e '${selectionTest}'`);

                // Test 4: Check desktop selection specifically
                const desktopSelectionTest = `
                    tell application "Finder"
                      try
                        set desktopSelection to selection of desktop
                        return "Desktop selection count: " & (count of desktopSelection)
                      on error errMsg
                        return "Desktop selection error: " & errMsg
                      end try
                    end tell
                  `;

                const { stdout: desktopSelectionResult } = await execAsync(`osascript -e '${desktopSelectionTest}'`);

                // Test 5: Check window count
                const windowTest = `
                    tell application "Finder"
                      return "Window count: " & (count of windows)
                    end tell
                  `;

                const { stdout: windowResult } = await execAsync(`osascript -e '${windowTest}'`);

                // Test 6: Get desktop path
                const desktopTest = `
                    tell application "Finder"
                      return "Desktop path: " & POSIX path of desktop
                    end tell
                  `;

                const { stdout: desktopResult } = await execAsync(`osascript -e '${desktopTest}'`);

                // Test 7: Try the actual path detection
                const path = await getCurrentFinderPath();

                const debugOutput = `Basic Test: ${basicResult.trim()}\n\nFront App Test: ${frontAppResult.trim()}\n\nSelection Test: ${selectionResult.trim()}\n\nDesktop Selection Test: ${desktopSelectionResult.trim()}\n\nWindow Test: ${windowResult.trim()}\n\nDesktop Test: ${desktopResult.trim()}\n\nPath Detection Result: ${path || "null"}`;

                const debugResult = {
                  command: "Debug Path Detection",
                  lastUsed: Date.now(),
                  useCount: 1,
                  output: debugOutput,
                  error: undefined,
                  executionPath: path || undefined,
                };
                setSelectedCommand(debugResult);
                setShowDetailView(true);
              } catch (error) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Debug failed",
                  message: error instanceof Error ? error.message : "Unknown error",
                });
              }
            }}
          />
          <Action
            title="Test Finder Path"
            icon={Icon.Folder}
            onAction={async () => {
              // Enable debug mode temporarily for this test
              const wasDebugMode = preferences.debugMode;
              setPreferences((prev) => ({ ...prev, debugMode: true }));

              try {
                await showToast({
                  style: Toast.Style.Animated,
                  title: "Testing Finder Path Detection...",
                });

                const path = await getCurrentFinderPath();

                await showToast({
                  style: path ? Toast.Style.Success : Toast.Style.Failure,
                  title: path ? "Finder Path Detected" : "No Finder Path",
                  message: path || "Make sure Finder is active and try again",
                });

                // Show in detail view for better visibility
                const testResult = {
                  command: "Finder Path Test",
                  lastUsed: Date.now(),
                  useCount: 1,
                  output: path
                    ? `Detected path: ${path}`
                    : "No path detected - make sure Finder is the active application",
                  error: undefined,
                  executionPath: path || undefined,
                };
                setSelectedCommand(testResult);
                setShowDetailView(true);
              } finally {
                // Restore debug mode
                setPreferences((prev) => ({ ...prev, debugMode: wasDebugMode }));
              }
            }}
          />
          <Action
            title="Toggle Debug Mode"
            icon={Icon.Bug}
            onAction={() => {
              setPreferences((prev) => ({ ...prev, debugMode: !prev.debugMode }));
              showToast({
                style: Toast.Style.Success,
                title: `Debug mode ${preferences.debugMode ? "disabled" : "enabled"}`,
              });
            }}
          />
          <Action
            title="Clear Storage & History"
            icon={Icon.ExclamationMark}
            style={Action.Style.Destructive}
            onAction={async () => {
              await LocalStorage.clear();
              setCommandHistory([]);
              await showToast({
                style: Toast.Style.Success,
                title: "Storage cleared - try executing a command now",
              });
            }}
          />
        </ActionPanel>
      }
    >
      {searchText.trim() && (
        <List.Item
          title={searchText}
          subtitle="Press Cmd+Enter to execute"
          icon={{ source: Icon.Terminal, tintColor: Color.Blue }}
          actions={
            <ActionPanel>
              <Action
                title="Execute Command"
                icon={Icon.Play}
                onAction={() => {
                  executeCommand(searchText.trim());
                  setSearchText("");
                }}
                shortcut={{ modifiers: ["cmd"], key: "enter" }}
              />
            </ActionPanel>
          }
        />
      )}

      {filteredHistory.length === 0 && !searchText.trim() ? (
        <List.EmptyView
          icon={Icon.Terminal}
          title="No commands in history"
          description="Start by typing a command above and pressing Cmd+Enter to execute it"
        />
      ) : (
        filteredHistory.map((item, index) => (
          <List.Item
            key={`${item.command}-${item.lastUsed}`}
            title={item.command}
            subtitle={
              `Last time: ${new Date(item.lastUsed).toLocaleString()}\n` +
              (item.executionPath ? `📁 Path: ${item.executionPath}\n` : "") +
              (item.error
                ? `❌ Error: ${item.error.length > 50 ? item.error.substring(0, 50) + "..." : item.error}`
                : item.output !== undefined
                  ? `✅ Output: ${item.output && item.output.length > 50 ? item.output.substring(0, 50) + "..." : item.output || "No output"}`
                  : `Used ${item.useCount} time${item.useCount !== 1 ? "s" : ""} • Last used ${new Date(item.lastUsed).toLocaleDateString()}`)
            }
            icon={{
              source: Icon.Terminal,
              tintColor: item.error ? Color.Red : item.output !== undefined ? Color.Green : Color.SecondaryText,
            }}
            accessories={[
              { text: `#${index + 1}` },
              { icon: Icon.Clock },
              { text: `${item.useCount}x` },
              ...(lastExecutedCommand === item.command ? [{ icon: Icon.Checkmark }] : []),
            ]}
            actions={
              <ActionPanel>
                <Action
                  title="Execute Command"
                  icon={Icon.Play}
                  onAction={() => executeCommand(item.command)}
                  shortcut={{ modifiers: ["cmd"], key: "enter" }}
                />
                <Action
                  title="View Details"
                  icon={Icon.Eye}
                  onAction={() => {
                    setSelectedCommand(item);
                    setShowDetailView(true);
                  }}
                  shortcut={{ modifiers: ["cmd"], key: "d" }}
                />
                <Action
                  title="Copy Command"
                  icon={Icon.CopyClipboard}
                  onAction={async () => {
                    await Clipboard.copy(item.command);
                    await showToast({
                      style: Toast.Style.Success,
                      title: "Command copied to clipboard",
                    });
                  }}
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                />
                {(item.output || item.error) && (
                  <Action
                    title="Copy Output"
                    icon={Icon.Document}
                    onAction={async () => {
                      await Clipboard.copy(item.output || item.error || "");
                      await showToast({
                        style: Toast.Style.Success,
                        title: "Output copied to clipboard",
                      });
                    }}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                  />
                )}
                <Action
                  title="Delete from History"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => deleteCommand(item.command)}
                  shortcut={{ modifiers: ["cmd"], key: "delete" }}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
