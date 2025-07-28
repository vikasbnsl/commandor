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
            shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
          />
          <Action
            title="Clear History"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={clearHistory}
            shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }}
          />
          <Action
            title="Clear Storage and History"
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
                shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
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
                  shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
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
                  shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                />
              </ActionPanel>
            }
          />
        ))
      )}
    </List>
  );
}
